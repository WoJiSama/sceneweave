import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARTWORK_SVG, artworkDraft, artworkValidation } from '../../../tests/helpers/m24-artwork-fixtures'
import { ProjectRepository } from '../../platform/browser/storage/repository'
import { replayAuthoring } from '../../shared/ai/authoring'
import { normalizeStaticSvg } from '../../shared/ai/svg'
import type { AuthoringOperation } from '../../shared/ai/authoring-protocol'
import { createCompositionContent, effectiveAdjustments } from '../../shared/appearance/graph'
import { exportHistoryArchive, exportProject, importHistoryArchive, importProject } from '../../shared/project/file'
import { decodeUtf8, sha256Bytes } from '../../shared/project/binary'
import { projectResourceHashes } from '../../shared/project/source-resources'
import { canonicalJson, cloneJson } from '../../shared/validation/json'
import { materializeAuthoringArtwork } from './artwork'
import { captureEditableDraft, fromBundle, toBundle, type EditableProject } from './project'
import { prepareCompositionCommands } from './prepare'
import { fixture, runtime } from './test-fixtures'
import { Workspace } from './workspace'

const svg = (sourceSvg = ARTWORK_SVG): AuthoringOperation => ({ kind: 'svg', id: 'item', sourceSvg, longEdgePx: 16, name: 'Immutable SVG variation' })
const single = { mode: 'single' as const, targetIds: ['item'], operations: ['svg', 'style'] as ('svg' | 'style')[] }
const physical = ({ appearance: _appearance, definitionRef: _definition, ...prop }: EditableProject['document']['props'][string]) => prop
const repos: ProjectRepository[] = [], names = new Set<string>(), sessions: Workspace[] = []
afterEach(async () => {
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('deferred SVG/style artwork materialization using actual PNG fixtures', () => {
  it('creates fixed SVG/PNG versions and preserves originals, licence, physical data and other objects', async () => {
    const input = fixture({ image: true }), validation = artworkValidation(), editable = await fromBundle(input, validation)
    const before = canonicalJson(input.project), oldProp = editable.document.props.item, oldAsset = editable.document.assets.image, oldSource = editable.appearance.propSources.item
    const draft = artworkDraft(input, [[svg()]], single), output = await materializeAuthoringArtwork(editable, draft, validation)
    const changed = output.document.props.item, source = output.authoringSources[changed.appearance.kind === 'image' ? changed.appearance.assetId : '']
    expect(source).toBeDefined(); expect(source.processorId).toBe('sceneweave-static-svg')
    expect(physical(changed)).toEqual(physical(oldProp)); expect(output.document.props.other).toEqual(editable.document.props.other)
    expect(output.document.propDefinitions.definition).toEqual(editable.document.propDefinitions.definition)
    expect(output.document.assets.image).toEqual(oldAsset); expect(await output.resources.read(oldAsset.sha256)).toEqual(await editable.resources.read(oldAsset.sha256))
    expect(output.appearance.sources[output.appearance.propSources.item].parentSourceId).toBe(oldSource)
    expect(decodeUtf8(await output.resources.read(source.sourceSha256))).toBe(ARTWORK_SVG)
    expect(decodeUtf8(await output.resources.read(source.normalizedSha256))).toBe(normalizeStaticSvg(ARTWORK_SVG).normalizedSource)
    const definition = output.document.propDefinitions[changed.definitionRef!.id]
    expect(definition.licenseRef).toBe(oldAsset.licenseRef); expect(definition.origin).toEqual(oldAsset.origin)
    expect(output.licenses).toEqual(editable.licenses)
    expect(output.licenseBindings.find(b => b.subjectId === definition.id)?.licensePath).toBe(input.project.licenseBindings.find(b => b.subjectId === 'definition')!.licensePath)
    expect(canonicalJson(input.project)).toBe(before); expect(output.document.revision).toBe(editable.document.revision)
    expect(canonicalJson(toBundle(await materializeAuthoringArtwork(editable, draft, validation)).project)).toBe(canonicalJson(toBundle(output).project))
  })

  it('appends successive SVG ancestors and materializes tint/brightness/opacity with unchanged physical data', async () => {
    const input = fixture({ image: true }), validation = artworkValidation(), editable = await fromBundle(input, validation)
    const secondSvg = ARTWORK_SVG.replace('#2468ac', '#abcdef')
    const draft = artworkDraft(input, [[svg()], [svg(secondSvg)], [{ kind: 'style', ids: ['item'], tint: '#808080', brightness: .5, opacity: .4 }]], single)
    const output = await materializeAuthoringArtwork(editable, draft, validation), prop = output.document.props.item
    expect(Object.keys(output.authoringSources)).toHaveLength(2)
    expect(Object.keys(output.appearance.variants)).toHaveLength(1)
    expect(physical(prop)).toEqual(physical(editable.document.props.item))
    expect(effectiveAdjustments(output, 'item')).toMatchObject({ tint: '#808080', brightness: .5, opacity: .4 })
    expect(prop.appearance.opacity).toBe(.4)
    for (const source of Object.values(output.authoringSources)) expect(sha256Bytes(await output.resources.read(source.sourceSha256))).toBe(source.sourceSha256)
    const reopened = await fromBundle(await importProject(await exportProject(toBundle(output), validation), validation), validation)
    expect(reopened.authoringSources).toEqual(output.authoringSources); expect(reopened.appearance).toEqual(output.appearance)
    expect(reopened.document.props.item).toEqual(prop)
  })

  it('preserves existing direct opacity when only replacing SVG artwork', async () => {
    const input = fixture({ image: true })
    input.project.document.props.item.appearance.opacity = .35
    Object.assign(input.project, createCompositionContent(input.project.document, runtime))
    const validation = artworkValidation(), editable = await fromBundle(input, validation)
    const output = await materializeAuthoringArtwork(editable, artworkDraft(input, [[svg()]], single), validation)
    expect(output.document.props.item.appearance.opacity).toBe(.35)
  })

  it('styles explicitly expanded prefab members and retains manual movement/deletion records', async () => {
    const input = fixture({ image: true }), validation = artworkValidation()
    input.project.document.props.other = { ...cloneJson(input.project.document.props.item), id: 'other', positionMm: { x: 9000, y: 9000 } }
    Object.assign(input.project, createCompositionContent(input.project.document, runtime))
    let editable = await prepareCompositionCommands(await fromBundle(input, validation), [{ type: 'createPrefab', id: 'group', definitionId: 'group-definition', name: 'Camp furniture', ids: ['item', 'other'], anchorMm: { x: 5000, y: 5000 } }], { runtime, validation })
    editable = await prepareCompositionCommands(editable, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 5000, y: 5100 } } }], { runtime, validation })
    const beforeGroup = cloneJson(editable.document.prefabInstances.group), beforeDefinition = cloneJson(editable.document.prefabDefinitions['group-definition'])
    const draft = artworkDraft(toBundle(editable), [[{ kind: 'style', ids: ['item', 'other'], brightness: .5, opacity: .7 }]], { mode: 'prefab', targetIds: ['group'], operations: ['style'] })
    const output = await materializeAuthoringArtwork(editable, draft, validation)
    expect(output.document.prefabDefinitions['group-definition']).toEqual(beforeDefinition)
    for (const [key, member] of Object.entries(beforeGroup.members)) {
      expect(output.document.prefabInstances.group.members[key].propId).toBe(member.propId)
      expect(output.document.prefabInstances.group.members[key].overrideFields).toEqual(expect.arrayContaining(member.overrideFields))
    }
    for (const id of ['item', 'other']) { expect(physical(output.document.props[id])).toEqual(physical(editable.document.props[id])); expect(output.document.props[id].appearance.opacity).toBe(.7) }
    const deleted = await prepareCompositionCommands(output, [{ type: 'deleteProp', id: 'other' }], { runtime, validation })
    const deletedMember = cloneJson(Object.values(deleted.document.prefabInstances.group.members).find(member => member.propId === null))
    const afterDelete = await materializeAuthoringArtwork(deleted, artworkDraft(toBundle(deleted), [[{ kind: 'style', ids: ['item'], opacity: .8 }]], { mode: 'prefab', targetIds: ['group'], operations: ['style'] }), validation)
    expect(afterDelete.document.props.other).toBeUndefined()
    expect(Object.values(afterDelete.document.prefabInstances.group.members).find(member => member.propId === null)).toEqual(deletedMember)
  })

  it('limits style to frozen range targets and rejects outside/secret/locked or unsupported SVG recipes during replay', async () => {
    const input = fixture({ image: true }), validation = artworkValidation(), boundsMm = { x: 0, y: 0, width: 7000, height: 7000 }
    const scope = { mode: 'range' as const, targetIds: ['item'], boundsMm, operations: ['style'] as ('style')[] }
    const draft = artworkDraft(input, [[{ kind: 'style', ids: ['item'], brightness: .5 }]], scope)
    const editable = await fromBundle(input, validation), output = await materializeAuthoringArtwork(editable, draft, validation)
    expect(output.document.props.other).toEqual(editable.document.props.other)
    expect(output.appearance.instanceAdjustments.other).toEqual(editable.appearance.instanceAdjustments.other)
    expect(() => artworkDraft(input, [[{ kind: 'style', ids: ['other'], opacity: .5 }]], scope)).toThrow(/范围/)
    expect(() => artworkDraft(input, [[svg('<svg><script/></svg>')]], single)).toThrow()
    for (const mode of ['secret', 'locked'] as const) {
      const bad = { project: cloneJson(input.project), resources: input.resources }
      if (mode === 'secret') bad.project.document.props.item.visibility = 'gm'; else bad.project.document.props.item.editLocked = true
      expect(() => artworkDraft(bad, [[svg()]], single)).toThrow(/公开|锁定/)
    }
  })

  it('returns no adopted changes when PNG encoding, source verification or cancellation fails', async () => {
    const input = fixture({ image: true }), validation = artworkValidation(), editable = await fromBundle(input, validation), before = canonicalJson(toBundle(editable).project)
    const draft = artworkDraft(input, [[svg()]], single), corrupt = artworkValidation()
    corrupt.images.encodePng = async () => new Uint8Array([0])
    await expect(materializeAuthoringArtwork(editable, draft, corrupt)).rejects.toThrow()
    const cancelled = artworkValidation(), signal = { aborted: false }, rasterize = cancelled.svg!.rasterize
    cancelled.svg!.rasterize = async (...args) => { signal.aborted = true; return rasterize(...args) }
    await expect(materializeAuthoringArtwork(editable, draft, { ...cancelled, signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(canonicalJson(toBundle(editable).project)).toBe(before)
  })

  it('preserves SVG/PNG source closure through protected adoption, cold reopen, offline history and appearance recovery', async () => {
    const validation = artworkValidation(), name = `m24-artwork-history-${crypto.randomUUID()}`, repo = new ProjectRepository({ name, validation, runtime })
    repos.push(repo); names.add(name)
    const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
    await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
    const before = workspace.getState().project!, owner = before.document.sceneId
    const authorization = await workspace.authorizeAtomic({ targetIds: [], operations: [], placement: null, artwork: single })
    const draft = artworkDraft(toBundle(before), [[svg()]], single); draft.start = authorization.start
    draft.state = replayAuthoring(draft.start, draft.state.steps).state
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft)
    const result = await workspace.adoptAtomicCandidate(candidate, { claim: async () => ({ schemaVersion: 1, taskId: candidate.taskId, generation: candidate.generation,
      draftRevision: candidate.draftRevision, contentHash: candidate.contentHash, claimId: crypto.randomUUID(), serverNow: 1000, expiresAt: 31000 }) })
    await result.save
    const artwork = workspace.getState().project!, named = await workspace.createNamedSnapshot('SVG adopted')
    const source = Object.values(artwork.authoringSources)[0]
    expect(result.protection.project.authoringSources).toEqual({})
    await workspace.updateProp('other', { rotationDeg: 25 }); await workspace.flush()
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'later-opacity', kind: 'opacity', value: .2, enabled: true } }])
    await workspace.flush(); await workspace.close()
    const cold = (await repo.load(owner))!, reopened = new Workspace(repo, { runtime, validation }); sessions.push(reopened)
    await reopened.openPersisted(await fromBundle(cold, validation))
    const preview = await reopened.prepareRestore(named.id, { ids: ['item'], mode: 'appearance' })
    await reopened.applyRestore(preview); await reopened.flush()
    expect(reopened.getDocument()!.props.other.rotationDeg).toBe(25)
    expect(reopened.getDocument()!.props.item.appearance.opacity).toBe(1)
    const history = await importHistoryArchive(await exportHistoryArchive({ current: toBundle(reopened.getState().project!), snapshots: [(await repo.loadSnapshot(owner, named.id))!] }, validation), validation)
    for (const bundle of [history.current, history.snapshots[0].bundle]) {
      expect(decodeUtf8(await bundle.resources.read(source.sourceSha256))).toBe(ARTWORK_SVG)
      for (const hash of projectResourceHashes(bundle.project)) expect(sha256Bytes(await bundle.resources.read(hash))).toBe(hash)
    }
  })

  it('revalidates historic SVG/PNG and licences when appearance recovery reintroduces an undone artwork closure', async () => {
    const validation = artworkValidation(), name = `m24-artwork-undo-restore-${crypto.randomUUID()}`
    const repo = new ProjectRepository({ name, validation, runtime })
    repos.push(repo); names.add(name)
    const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
    await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
    const before = workspace.getState().project!, owner = before.document.sceneId
    const authorization = await workspace.authorizeAtomic({ targetIds: [], operations: [], placement: null, artwork: single })
    const draft = artworkDraft(toBundle(before), [[svg()]], single); draft.start = authorization.start
    draft.state = replayAuthoring(draft.start, draft.state.steps).state
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft)
    const adopted = await workspace.adoptAtomicCandidate(candidate, { claim: async () => ({ schemaVersion: 1, taskId: candidate.taskId, generation: candidate.generation,
      draftRevision: candidate.draftRevision, contentHash: candidate.contentHash, claimId: crypto.randomUUID(), serverNow: 1000, expiresAt: 31000 }) })
    await adopted.save
    const artwork = workspace.getState().project!, named = await workspace.createNamedSnapshot('SVG before undo')
    const [assetId, source] = Object.entries(artwork.authoringSources)[0], pngHash = artwork.document.assets[assetId].sha256
    workspace.undo()
    await workspace.updateProp('other', { rotationDeg: 25 }); await workspace.flush()
    const current = workspace.getState().project!, stored = await repo.database.projects.get(owner)
    expect(current.authoringSources).toEqual({})
    expect(current.assets[pngHash]).toBeUndefined()
    await expect(current.resources.read(source.sourceSha256)).rejects.toThrow(/闭包/)
    await expect(current.resources.read(pngHash)).rejects.toThrow(/闭包/)

    // Each boundary must reject damaged persisted data even though the older
    // current branch and the snapshot previously held real private proofs.
    for (const hash of new Set([source.sourceSha256, source.normalizedSha256, pngHash])) {
      const actual = (await repo.database.resources.get(hash))!
      await repo.database.resources.put({ ...actual, bytes: new Uint8Array([0]) })
      await expect(workspace.prepareRestore(named.id, { ids: ['item'], mode: 'appearance' })).rejects.toThrow(/资源|字节|SHA256/)
      expect(workspace.getState().project).toBe(current)
      expect(await repo.database.projects.get(owner)).toEqual(stored)
      await repo.database.resources.put(actual)
    }
    const licenseHash = artwork.licenseBindings.find(binding => binding.subjectKind === 'asset' && binding.subjectId === assetId)!.licensePath.slice(9, -4)
    const license = (await repo.database.licenseTexts.get(licenseHash))!
    await repo.database.licenseTexts.put({ ...license, text: 'tampered historic licence' })
    await expect(workspace.prepareRestore(named.id, { ids: ['item'], mode: 'appearance' })).rejects.toThrow(/许可/)
    expect(workspace.getState().project).toBe(current)
    expect(await repo.database.projects.get(owner)).toEqual(stored)
    await repo.database.licenseTexts.put(license)

    const rasterize = vi.spyOn(validation.svg!, 'rasterize'), decode = vi.spyOn(validation.images, 'decode')
    const preview = await workspace.prepareRestore(named.id, { ids: ['item'], mode: 'appearance' })
    // Both the cold snapshot and the newly merged candidate validate the real
    // SVG/PNG pair; the current branch cannot grant a proof for absent bytes.
    expect(rasterize.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(decode.mock.calls.filter(([, record]) => record.sha256 === pngHash).length).toBeGreaterThanOrEqual(4)
    expect(preview.project.resources).not.toBe(current.resources)
    expect(preview.project.authoringSources).toEqual(artwork.authoringSources)
    expect(preview.project.licenseBindings).toEqual(expect.arrayContaining(artwork.licenseBindings))
    expect(preview.project.licenses[licenseHash]).toEqual(license)
    expect(decodeUtf8(await preview.project.resources.read(source.sourceSha256))).toBe(ARTWORK_SVG)
    expect(decodeUtf8(await preview.project.resources.read(source.normalizedSha256))).toBe(normalizeStaticSvg(ARTWORK_SVG).normalizedSource)
    expect(await preview.project.resources.read(pngHash)).toEqual(await artwork.resources.read(pngHash))
    const protection = await workspace.applyRestore(preview); await workspace.flush()
    expect(protection.project.authoringSources).toEqual({})
    const cold = (await repo.load(owner))!
    expect(cold.project.document.revision).toBe(4)
    expect(cold.project.document.props.other.rotationDeg).toBe(25)
    expect(cold.project.document.props.item.appearance).toEqual(artwork.document.props.item.appearance)
    expect(cold.project.authoringSources).toEqual(artwork.authoringSources)
    expect(cold.project.licenseBindings).toEqual(expect.arrayContaining(artwork.licenseBindings))
    for (const hash of projectResourceHashes(cold.project)) expect(sha256Bytes(await cold.resources.read(hash))).toBe(hash)
  })
})
