import { visualBase } from '../../shared/visual/base.js'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository'
import { emptyVisualSystem, type VisualLight } from '../../shared/visual/types'
import { exportProject, importProject, exportHistoryArchive, importHistoryArchive } from '../../shared/project/file'
import { projectContentHash, validateProjectData } from '../../shared/project/validate'
import { fromBundle, toBundle } from './project'
import { Workspace } from './workspace'
import { atomicChanges } from './atomic'
import { replayAuthoring } from '../../shared/ai/authoring'
import { fixture, runtime, validation } from './test-fixtures'

const sessions: Workspace[] = [], repos: ProjectRepository[] = []
async function setup() {
  const repo = new ProjectRepository({ name: `visual-workspace-${crypto.randomUUID()}`, runtime, validation })
  repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }), project = await fromBundle(fixture({ image: true }), validation)
  sessions.push(workspace); await workspace.adoptNew(project)
  return { workspace, repo, original: project }
}
const lamp = (scene: NonNullable<ReturnType<Workspace['getDocument']>>): VisualLight => ({ id: 'visual-lamp', floorId: Object.keys(scene.floors)[0], layerId: Object.keys(scene.userLayers)[0], visibility: 'public', editLocked: false,
  positionMm: { x: 3000, y: 3000 }, radiusMm: 1500, color: '#FFD080', intensity: .4, wallOcclusion: true, enabled: true })
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close().catch(() => {})
  vi.restoreAllMocks()
  for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

describe('complete visual v2 workspace persistence and protection', () => {
  it('saves the original and an independently validated v2 copy, preserving real resource bytes', async () => {
    const { workspace, repo, original } = await setup()
    await workspace.updateProp('item', { rotationDeg: 25 })
    const originalId = original.document.sceneId
    await workspace.enableVisualCopy()
    const current = workspace.getState().project!
    expect(current.schemaVersion).toBe(2); expect(current.document.schemaVersion).toBe(2)
    expect(current.document.visual).toEqual(emptyVisualSystem())
    expect(current.document.sceneId).not.toBe(originalId)
    expect(current.document.props.item.rotationDeg).toBe(25)
    const source = (await repo.load(originalId))!
    expect(source.project.schemaVersion).toBe(1); expect(source.project.document.visual).toBeUndefined()
    expect(source.project.document.props.item.rotationDeg).toBe(25)
    expect(Object.keys(current.assets)).toEqual(Object.keys(source.project.assets))
    for (const hash of Object.keys(current.assets)) expect(await current.resources.read(hash)).toEqual(await source.resources.read(hash))
    const currentId = current.document.sceneId
    await workspace.enableVisualCopy(); expect(workspace.getDocument()!.sceneId).toBe(currentId)
    expect(await repo.list()).toHaveLength(2)
  })

  it('keeps the original active if independent-copy storage fails', async () => {
    const { workspace, repo, original } = await setup(), before = workspace.getState().project
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('visual copy quota'))
    await expect(workspace.enableVisualCopy()).rejects.toThrow(/quota/)
    expect(workspace.getState().project).toBe(before)
    expect((await repo.load(original.document.sceneId))!.project.schemaVersion).toBe(1)
  })

  it('round trips cold v2, real PNG bytes and strict manifest while rejecting mismatched envelopes', async () => {
    const { workspace, repo } = await setup(); await workspace.enableVisualCopy()
    const light = lamp(workspace.getDocument()!)
    await workspace.execute([{ type: 'upsertVisualLight', light }]); await workspace.flush()
    const current = workspace.getState().project!, cold = await repo.load(current.document.sceneId)
    expect(visualBase(cold!.project.document)!.lights[light.id]).toEqual(light)
    const encoded = await exportProject(toBundle(current), validation), imported = await importProject(encoded, validation)
    expect(projectContentHash(imported.project)).toBe(projectContentHash(toBundle(current).project))
    expect(() => validateProjectData({ ...imported.project, schemaVersion: 1 })).toThrow()
    expect(() => validateProjectData({ ...imported.project, document: { ...imported.project.document, schemaVersion: 1 } })).toThrow()
  })

  it('protects a scoped visual restore, preserves outside edits, and expires its witness after reopen', async () => {
    const { workspace, repo } = await setup(); await workspace.enableVisualCopy()
    const light = lamp(workspace.getDocument()!)
    await workspace.execute([{ type: 'upsertVisualLight', light }])
    const snapshot = await workspace.createNamedSnapshot('original lighting')
    await workspace.execute([{ type: 'upsertVisualLight', light: { ...light, intensity: .8 } }, { type: 'updateProp', id: 'other', changes: { rotationDeg: 75 } }])
    const preview = await workspace.prepareRestore(snapshot.id, { mode: 'visual', ids: [light.id] })
    expect(preview.plan.changes.some(change => change.id === light.id && change.kind === 'visual')).toBe(true)
    const protection = await workspace.applyRestore(preview)
    expect(protection.kind).toBe('protection')
    expect(visualBase(workspace.getDocument()!)!.lights[light.id].intensity).toBe(.4)
    expect(workspace.getDocument()!.props.other.rotationDeg).toBe(75)
    workspace.undo(); await workspace.flush()
    expect(visualBase(workspace.getDocument()!)!.lights[light.id].intensity).toBe(.8)
    const loaded = await repo.load(workspace.getDocument()!.sceneId)
    await workspace.openPersisted(await fromBundle(loaded!, validation))
    await expect(workspace.prepareRestore(snapshot.id, { mode: 'visual', ids: [light.id] })).rejects.toThrow(/本会话/)
  })

  it('invalidates same-batch delete/recreate even when the final visual parameters are equal', async () => {
    const { workspace } = await setup(); await workspace.enableVisualCopy()
    const light = lamp(workspace.getDocument()!)
    await workspace.execute([{ type: 'upsertVisualLight', light }])
    const snapshot = await workspace.createNamedSnapshot('birth')
    await workspace.execute([{ type: 'removeVisualEffect', kind: 'light', id: light.id }, { type: 'upsertVisualLight', light }])
    await expect(workspace.prepareRestore(snapshot.id, { mode: 'visual', ids: [light.id] })).rejects.toThrow(/删除.*重建/)
  })

  it('carries locally replayed AI recreation through adoption and undo instead of trusting final JSON equality', async () => {
    const { workspace } = await setup(); await workspace.enableVisualCopy()
    const light = lamp(workspace.getDocument()!)
    await workspace.execute([{ type: 'upsertVisualLight', light }])
    const snapshot = await workspace.createNamedSnapshot('before AI recreation')
    const authorization = await workspace.authorizeAtomic({ targetIds: [], operations: [], placement: null,
      visual: { floorId: light.floorId, layerId: light.layerId, boundsMm: workspace.getDocument()!.floors[light.floorId].boundsMm,
        entityIds: [light.id], definitionIds: [], materialIds: [], operations: ['visualRemove', 'visualLight'] } })
    const { id, positionMm, radiusMm, color, intensity, wallOcclusion, enabled } = light
    const replayed = replayAuthoring(authorization.start, [{ index: 1, stepId: 'recreate-light', operations: [
      { kind: 'visualRemove', effectKind: 'light', id }, { kind: 'visualLight', id, positionMm, radiusMm, color, intensity, wallOcclusion, enabled },
    ] }])
    const candidate = await workspace.prepareAtomicCandidate(authorization, { schemaVersion: 1, taskId: 'visual-recreate-task', generation: 1, start: authorization.start, state: replayed.state })
    expect(candidate.changes).toContainEqual(expect.objectContaining({ id, collection: 'visual.lights', fields: ['identity'] }))
    const result = await workspace.adoptAtomicCandidate(candidate, { claim: async () => ({ schemaVersion: 1, taskId: candidate.taskId,
      generation: 1, draftRevision: candidate.draftRevision, contentHash: candidate.contentHash, claimId: crypto.randomUUID(), serverNow: 1000, expiresAt: 31000 }) })
    await result.save
    expect(visualBase(workspace.getDocument()!)!.lights[id]).toEqual(light)
    await expect(workspace.prepareRestore(snapshot.id, { mode: 'visual', ids: [id] })).rejects.toThrow(/删除.*重建/)
    workspace.undo(); await workspace.flush()
    await expect(workspace.prepareRestore(snapshot.id, { mode: 'visual', ids: [id] })).rejects.toThrow(/删除.*重建/)
  })

  it('preserves independently strict v1 and v2 scenes in a selected mixed-version history package', async () => {
    const { workspace } = await setup(); await workspace.enableVisualCopy()
    const current = toBundle(workspace.getState().project!), historical = structuredClone(current.project)
    historical.schemaVersion = 1; historical.document.schemaVersion = 1; delete historical.document.visual
    const summary = { id: 'v1-snapshot', ownerSceneId: current.project.document.sceneId, lineageId: historical.historyIdentity.lineageId,
      sourceRevision: historical.document.revision, name: 'pre-visual scene', kind: 'named' as const, createdAt: historical.document.updatedAt,
      contentHash: projectContentHash(historical) }
    const encoded = await exportHistoryArchive({ current, snapshots: [{ ...summary, bundle: { project: historical, resources: current.resources } }] }, validation)
    const imported = await importHistoryArchive(encoded, validation)
    expect(imported.current.project.schemaVersion).toBe(2); expect(imported.current.project.document.visual).toBeDefined()
    expect(imported.snapshots[0].bundle.project.schemaVersion).toBe(1); expect(imported.snapshots[0].bundle.project.document.visual).toBeUndefined()
    expect(imported.snapshots[0].contentHash).toBe(summary.contentHash)
    for (const hash of Object.keys(current.project.assets)) expect(await imported.snapshots[0].bundle.resources.read(hash)).toEqual(await current.resources.read(hash))
  })

  it('includes actual visual records and environment in AI review differences', async () => {
    const { workspace } = await setup(); await workspace.enableVisualCopy()
    const before = toBundle(workspace.getState().project!).project, light = lamp(workspace.getDocument()!)
    await workspace.execute([{ type: 'upsertVisualLight', light }, { type: 'setVisualEnvironment', environment: { ...emptyVisualSystem().environment, ambientOpacity: .2 } }])
    const after = toBundle(workspace.getState().project!).project
    expect(atomicChanges(before, after, []).map(change => change.collection)).toEqual(['visual.lights', 'visual.environment'])
  })
})
