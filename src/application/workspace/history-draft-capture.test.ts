import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { getVerifiedProjectBundle } from '../../shared/project/resources.js'
import { cloneJson } from '../../shared/validation/json.js'
import * as projectModule from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace, type WorkspaceOptions } from './workspace.js'

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = [], names = new Set<string>()
function repository(checking: CompleteValidationOptions, name = `history-draft-capture-${crypto.randomUUID()}`) {
  const result = new ProjectRepository({ name, runtime, validation: checking })
  repositories.push(result); names.add(name)
  return result
}
async function setup(validateCandidate?: WorkspaceOptions['validateCandidate']) {
  const decode = vi.fn(validation.images.decode), checking = { images: { ...validation.images, decode } }
  const repo = repository(checking), workspace = new Workspace(repo, { runtime, validation: checking, validateCandidate })
  workspaces.push(workspace)
  await workspace.adoptNew(await projectModule.fromBundle(fixture({ image: true }), checking))
  return { workspace, repo, checking, decode, before: workspace.getState().project! }
}
// Directly exercise this synchronous internal boundary without exposing it as a
// product API or widening the private validator certificate registry.
const prepare = (workspace: Workspace, candidate: projectModule.EditableProject) =>
  (workspace as unknown as { prepareRestoredProject(input: projectModule.EditableProject): projectModule.EditableProject }).prepareRestoredProject(candidate)
const metadata = (project: projectModule.EditableProject) => structuredClone(projectModule.toBundle(project).project)
function contentWithoutRevision(project: projectModule.EditableProject) {
  const data = metadata(project)
  const { revision: _revision, updatedAt: _updatedAt, ...document } = data.document
  return { ...data, document }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('history restoration draft capture boundary', () => {
  it('detaches the three mutable branches of an exact verified history entry without changing its frozen content', async () => {
    let observing = false, observedDocument: projectModule.EditableProject['document'] | undefined
    const { workspace, before } = await setup(document => {
      if (!observing) return
      observedDocument = document
      expect(document).not.toBe(before.document)
      expect(document.props.item.positionMm).not.toBe(before.document.props.item.positionMm)
      expect(Object.isFrozen(document.props.item.positionMm)).toBe(false)
      const x = document.props.item.positionMm.x
      document.props.item.positionMm.x = x + 1
      expect(before.document.props.item.positionMm.x).toBe(x)
      document.props.item.positionMm.x = x
    }), original = metadata(before)
    await workspace.updateProp('item', { rotationDeg: 25 }); await workspace.flush()
    const current = workspace.getState().project!, capture = vi.spyOn(projectModule, 'captureEditableDraft')
    observing = true
    const draft = prepare(workspace, before)
    observing = false
    expect(capture).not.toHaveBeenCalled()
    expect(projectModule.getVerifiedEditableProject(before)).toBe(before)
    expect(projectModule.getVerifiedEditableProject(draft)).toBeUndefined()
    expect(draft).not.toBe(before)
    expect(observedDocument).toBeDefined()
    expect(draft.document).toBe(before.document)
    expect(draft.appearance).toBe(before.appearance)
    expect(draft.historyIdentity).not.toBe(before.historyIdentity)
    for (const key of ['assets', 'licenses', 'licenseBindings', 'authoringSources', 'resources'] as const) expect(draft[key]).toBe(before[key])
    expect(draft.historyIdentity.propTokens).not.toBe(before.historyIdentity.propTokens)
    expect(Object.isFrozen(before.document.props.item.positionMm)).toBe(true)
    expect(Object.isFrozen(before.historyIdentity.propTokens)).toBe(true)
    expect(Object.isFrozen(before.appearance.propSources)).toBe(true)
    expect(draft.document.props.item.rotationDeg).toBe(original.document.props.item.rotationDeg)
    // The callback saw a mutable independent document. Final equality may
    // reuse only the original frozen document/appearance, never its wrapper.
    draft.historyIdentity.propTokens.item = 'detached-draft-token'
    expect(metadata(before)).toEqual(original)
    expect(workspace.getState().project).toBe(current)
    expect(projectModule.getVerifiedEditableProject(draft)).toBeUndefined()
  })

  it.each(['spread', 'cloned-document', 'replacement-resources'] as const)('uses real strict capture for an unfamiliar %s wrapper and never transfers its certificate', async kind => {
    const { workspace, before, checking, decode } = await setup()
    const read = vi.fn((hash: string) => before.resources.read(hash))
    const candidate = Object.freeze({ ...before,
      ...(kind === 'cloned-document' ? { document: cloneJson(before.document) } : {}),
      ...(kind === 'replacement-resources' ? { resources: Object.freeze({ read }) } : {}),
    })
    const capture = vi.spyOn(projectModule, 'captureEditableDraft'), draft = prepare(workspace, candidate)
    expect(projectModule.getVerifiedEditableProject(candidate)).toBeUndefined()
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(candidate)
    expect(capture.mock.results[0].type).toBe('return')
    for (const key of ['document', 'historyIdentity', 'appearance'] as const) expect(draft[key]).not.toBe(candidate[key])
    expect(draft.resources).toBe(candidate.resources)
    expect(projectModule.getVerifiedEditableProject(draft)).toBeUndefined()
    expect(projectModule.tryDeriveEditableProject(draft, candidate)).toBeUndefined()
    expect(getVerifiedProjectBundle(projectModule.toBundle(draft))).toBeUndefined()
    decode.mockClear(); read.mockClear()
    const verified = await projectModule.validateEditableProject(draft, checking)
    expect(decode).toHaveBeenCalledTimes(1)
    if (kind === 'replacement-resources') expect(read).toHaveBeenCalled()
    expect(projectModule.getVerifiedEditableProject(verified)).toBe(verified)
    expect(projectModule.getVerifiedEditableProject(draft)).toBeUndefined()
    expect(metadata(verified)).toEqual(metadata(before))
  })

  it('preserves strict descriptor rejection for an unfamiliar accessor wrapper without evaluating it', async () => {
    const { workspace, before } = await setup(), read = vi.fn(() => before.document)
    const hostile = Object.defineProperty({ ...before }, 'document', { enumerable: true, get: read })
    const capture = vi.spyOn(projectModule, 'captureEditableDraft')
    expect(() => prepare(workspace, hostile)).toThrow(/访问器/)
    expect(read).not.toHaveBeenCalled()
    expect(capture).toHaveBeenCalledTimes(1)
    // Argument deep matching can itself evaluate hostile getters. Inspect only
    // the captured reference after checking the product did not read it.
    expect(capture.mock.calls[0]?.[0]).toBe(hostile)
    expect(workspace.getState().project).toBe(before)
    expect(projectModule.getVerifiedEditableProject(hostile)).toBeUndefined()
  })

  it('does not certify replacement resource bytes during draft capture and still rejects their real corruption at public validation', async () => {
    const { workspace, before, checking } = await setup(), hash = Object.keys(before.assets)[0]
    const originalBytes = await before.resources.read(hash)
    const read = vi.fn(async (requested: string) => { const bytes = await before.resources.read(requested); bytes[0] ^= 1; return bytes })
    const candidate = Object.freeze({ ...before, resources: Object.freeze({ read }) })
    const capture = vi.spyOn(projectModule, 'captureEditableDraft'), draft = prepare(workspace, candidate)
    expect(capture).toHaveBeenCalledWith(candidate)
    expect(read).not.toHaveBeenCalled()
    expect(draft.resources).toBe(candidate.resources)
    expect(projectModule.getVerifiedEditableProject(draft)).toBeUndefined()
    await expect(projectModule.validateEditableProject(draft, checking)).rejects.toThrow(/字节|SHA|格式/)
    expect(read).toHaveBeenCalledWith(hash)
    expect(await before.resources.read(hash)).toEqual(originalBytes)
    expect(projectModule.getVerifiedEditableProject(before)).toBe(before)
    expect(projectModule.getVerifiedEditableProject(draft)).toBeUndefined()
    expect(workspace.getState().project).toBe(before)
  })

  it('keeps undo and redo content, identity, full resources and monotonic revisions through save and a cold repository read', async () => {
    const { workspace, repo, before, checking, decode } = await setup(), original = metadata(before)
    const hash = Object.keys(before.assets)[0], bytes = await before.resources.read(hash)
    await workspace.updateProp('item', { rotationDeg: 25 }); await workspace.flush()
    const edited = workspace.getState().project!, editedMetadata = metadata(edited)
    const capture = vi.spyOn(projectModule, 'captureEditableDraft')
    workspace.undo()
    const undone = workspace.getState().project!
    expect(undone.document.revision).toBe(edited.document.revision + 1)
    expect(contentWithoutRevision(undone)).toEqual(contentWithoutRevision(before))
    expect(undone.historyIdentity).toEqual(before.historyIdentity)
    expect(undone.resources).toBe(before.resources)
    expect(projectModule.getVerifiedEditableProject(undone)).toBe(undone)
    await workspace.flush()
    workspace.redo()
    const redone = workspace.getState().project!
    expect(redone.document.revision).toBe(undone.document.revision + 1)
    expect(contentWithoutRevision(redone)).toEqual(contentWithoutRevision(edited))
    expect(redone.historyIdentity).toEqual(edited.historyIdentity)
    expect(projectModule.getVerifiedEditableProject(redone)).toBe(redone)
    expect(capture).not.toHaveBeenCalled()
    await workspace.flush()
    expect(metadata(before)).toEqual(original)
    expect(metadata(edited)).toEqual(editedMetadata)
    const expected = metadata(redone), owner = redone.document.sceneId, name = repo.database.name
    await workspace.close(); repo.close()
    const cold = repository(checking, name)
    decode.mockClear()
    const loaded = (await cold.load(owner))!
    expect(loaded.project).toEqual(expected)
    expect(loaded.project.historyIdentity).toEqual(redone.historyIdentity)
    expect(await loaded.resources.read(hash)).toEqual(bytes)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(getVerifiedProjectBundle(loaded)).toBeDefined()
  })
})
