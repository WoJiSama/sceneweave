import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { Workspace } from '../../../application/workspace/workspace.js'
import { fromBundle } from '../../../application/workspace/project.js'
import * as delta from '../../../shared/project/delta.js'
import * as hash from '../../../shared/validation/hash.js'
import * as validator from '../../../shared/project/validate.js'
import { encodeProjectContentData } from '../../../shared/project/encoding.js'
import { validateProjectBundle } from '../../../shared/project/resources.js'
import { canonicalJson, cloneJson, freezeJson } from '../../../shared/validation/json.js'
import * as context from './content-context.js'
import { PROJECT_TABLES } from './database.js'
import { ProjectConflictError, ProjectRepository } from './repository.js'

const repositories: ProjectRepository[] = [], names = new Set<string>()
function repository(name = `generic-delta-${crypto.randomUUID()}`) {
  const repo = new ProjectRepository({ name, runtime, validation }); repositories.push(repo); names.add(name); return repo
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

it('prepares exactly the full generic delta from private validated endpoints without duplicate domain parses or hashes', async () => {
  const before = await validateProjectBundle(fixture(), validation)
  const project = cloneJson(before.project); project.document.revision++; project.document.title = 'generic change'; project.document.props.item.rotationDeg = 90
  const after = await validateProjectBundle({ project, resources: before.resources }, validation)
  const a = context.prepareEncodedSnapshot(before), b = context.prepareEncodedSnapshot(after)
  const expected = delta.createProjectDelta(before.project, after.project)
  const parse = vi.spyOn(validator, 'validateProjectData'), digest = vi.spyOn(hash, 'sha256Bytes')
  const plan = context.prepareEncodedProjectDelta(a, b)!
  expect(plan).toBeDefined(); expect(parse).not.toHaveBeenCalled(); expect(digest).not.toHaveBeenCalled()
  const repo = repository(); await repo.open()
  try {
    await repo.database.transaction('r', PROJECT_TABLES, async tx => {
      context.pinEncodedSnapshot(tx.idbtrans, 'baseline', a); context.pinEncodedSnapshot(tx.idbtrans, 'result', b)
      expect(canonicalJson(context.consumeEncodedProjectDelta(tx.idbtrans, plan, cloneJson(before.project), cloneJson(after.project))!.delta)).toBe(canonicalJson(expected))
      const wrongBefore = cloneJson(before.project); wrongBefore.document.title += ' stale'
      const wrongAfter = cloneJson(after.project); wrongAfter.document.props.item.rotationDeg = 450
      expect(context.consumeEncodedProjectDelta(tx.idbtrans, plan, wrongBefore, after.project)).toBeUndefined()
      expect(context.consumeEncodedProjectDelta(tx.idbtrans, plan, before.project, wrongAfter)).toBeUndefined()
      const accessor = cloneJson(after.project)
      Object.defineProperty(accessor.document, 'title', { enumerable: true, get() { throw new Error('getter must not execute') } })
      expect(() => context.consumeEncodedProjectDelta(tx.idbtrans, plan, before.project, accessor)).toThrow()
      expect(context.consumeEncodedProjectDelta(tx.idbtrans, { ...plan }, before.project, after.project)).toBeUndefined()
    })
  } finally { context.releaseEncodedSnapshot(a); context.releaseEncodedSnapshot(b) }
})

it('declines copied/frozen bundles, forged encodings and accessor fields without granting proof', async () => {
  const before = await validateProjectBundle(fixture(), validation)
  const project = cloneJson(before.project); project.document.revision++
  const after = await validateProjectBundle({ project, resources: before.resources }, validation)
  const encodings = { before: encodeProjectContentData(before.project), after: encodeProjectContentData(after.project) }
  const fake = { project: freezeJson(cloneJson(before.project)), resources: before.resources }
  expect(delta.tryCreateVerifiedProjectDelta(fake.project, after.project, encodings)).toBeUndefined()
  expect(delta.tryCreateVerifiedProjectDelta(before.project, after.project, { ...encodings, before: { ...encodings.before } })).toBeUndefined()
  let getters = 0
  const accessor = Object.defineProperty({ after: encodings.after }, 'before', { enumerable: true, get() { getters++; return encodings.before } })
  expect(delta.tryCreateVerifiedProjectDelta(before.project, after.project, accessor as typeof encodings)).toBeUndefined()
  expect(getters).toBe(0)
})

it('uses preparation on a warm generic save, keeps cold fallback and complete checkpoint cadence', async () => {
  const repo = repository(), input = fixture(), owner = input.project.document.sceneId
  await repo.save(input, null)
  const create = vi.spyOn(delta, 'createProjectDelta'), prepare = vi.spyOn(context, 'prepareEncodedProjectDelta')
  let project = cloneJson(input.project)
  for (let revision = 1; revision <= 5; revision++) {
    project = cloneJson(project); project.document.revision = revision; project.document.title = `generic ${revision}`
    await repo.save({ project, resources: input.resources }, revision - 1)
  }
  expect(prepare).toHaveBeenCalledTimes(5); expect(create).not.toHaveBeenCalled()
  const versions = await repo.listHistoryVersions(owner)
  expect(versions.versions.filter(row => row.checkpoint).map(row => row.revision).sort()).toEqual([0, 4])
  repo.close()
  project = cloneJson(project); project.document.revision = 6
  await repo.save({ project, resources: input.resources }, 5)
  expect(create).toHaveBeenCalledOnce()
  repo.close(); expect((await repo.load(owner))!.project).toEqual(project)
})

it('adds no generic preparation to the existing Workspace local edit path', async () => {
  const repo = repository(), workspace = new Workspace(repo, { runtime, validation })
  try {
    await workspace.adoptNew(await fromBundle(fixture(), validation))
    const prepare = vi.spyOn(context, 'prepareEncodedProjectDelta')
    for (const rotationDeg of [90, 180, 270]) { await workspace.updateProp('item', { rotationDeg }); await workspace.flush() }
    expect(prepare).not.toHaveBeenCalled()
  } finally { await workspace.close() }
})

it.each(['CAS', 'bad block', 'cancel'] as const)('retains final actual state confirmation after generic preparation: %s', async kind => {
  const repo = repository(), input = fixture(), owner = input.project.document.sceneId
  await repo.save(input, null)
  const other = repository(repo.database.name); await other.open()
  const next = cloneJson(input.project); next.document.revision = 1; next.document.title = 'candidate'
  const controller = new AbortController(), prepare = context.prepareEncodedProjectDelta
  let preparation: Promise<unknown> = Promise.resolve()
  vi.spyOn(context, 'prepareEncodedProjectDelta').mockImplementation((a, b) => {
    const plan = prepare(a, b)
    if (kind === 'cancel') controller.abort()
    if (kind === 'CAS') {
      const winner = cloneJson(next); winner.document.title = 'winner'
      preparation = other.save({ project: winner, resources: input.resources }, 0)
    }
    if (kind === 'bad block') preparation = repo.database.projectContentBlocks.toArray().then(async blocks => {
      const block = blocks[0]; block.bytes[0] ^= 1; await repo.database.projectContentBlocks.put(block)
    })
    return plan
  })
  // Ensure the injected foreign write finishes before this save's atomic step.
  const original = (repo as unknown as { ensureHistory(...args: unknown[]): Promise<void> }).ensureHistory
  vi.spyOn(repo as unknown as { ensureHistory(...args: unknown[]): Promise<void> }, 'ensureHistory').mockImplementation(async (...args) => { await preparation; return original.apply(repo, args) })
  const saving = repo.save({ project: next, resources: input.resources }, 0, { signal: controller.signal })
  if (kind === 'CAS') await expect(saving).rejects.toBeInstanceOf(ProjectConflictError)
  else if (kind === 'cancel') await expect(saving).rejects.toMatchObject({ name: 'AbortError' })
  else await expect(saving).rejects.toThrow(/hash/)
  expect(await repo.database.historyVersions.count()).toBe(kind === 'CAS' ? 2 : 1)
  if (kind !== 'bad block') expect((await repo.load(owner))!.project.document.title).toBe(kind === 'CAS' ? 'winner' : input.project.document.title)
})
