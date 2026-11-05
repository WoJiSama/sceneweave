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




  it('round trips cold v2, real PNG bytes and strict manifest while rejecting mismatched envelopes', async () => {
    const { workspace, repo } = await setup();
    const light = lamp(workspace.getDocument()!)
    await workspace.execute([{ type: 'upsertVisualLight', light }]); await workspace.flush()
    const current = workspace.getState().project!, cold = await repo.load(current.document.sceneId)
    expect(visualBase(cold!.project.document)!.lights[light.id]).toEqual(light)
    const encoded = await exportProject(toBundle(current), validation), imported = await importProject(encoded, validation)
    expect(projectContentHash(imported.project)).toBe(projectContentHash(toBundle(current).project))
    expect(() => validateProjectData({ ...imported.project, schemaVersion: 2 })).toThrow()
    expect(() => validateProjectData({ ...imported.project, document: { ...imported.project.document, schemaVersion: 2 } })).toThrow()
  })

  it('protects a scoped visual restore, preserves outside edits, and expires its witness after reopen', async () => {
    const { workspace, repo } = await setup();
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
    const { workspace } = await setup();
    const light = lamp(workspace.getDocument()!)
    await workspace.execute([{ type: 'upsertVisualLight', light }])
    const snapshot = await workspace.createNamedSnapshot('birth')
    await workspace.execute([{ type: 'removeVisualEffect', kind: 'light', id: light.id }, { type: 'upsertVisualLight', light }])
    await expect(workspace.prepareRestore(snapshot.id, { mode: 'visual', ids: [light.id] })).rejects.toThrow(/删除.*重建/)
  })

  it('carries locally replayed AI recreation through adoption and undo instead of trusting final JSON equality', async () => {
    const { workspace } = await setup();
    const light = lamp(workspace.getDocument()!)
    await workspace.execute([{ type: 'upsertVisualLight', light }])
    const snapshot = await workspace.createNamedSnapshot('before AI recreation')
    const authorization = await workspace.authorizeCurrentAtomic({ targetIds: [], operations: [], placement: null,
      visual: { floorId: light.floorId, layerId: light.layerId, boundsMm: workspace.getDocument()!.floors[light.floorId].boundsMm,
        entityIds: [light.id], definitionIds: [], materialIds: [], operations: ['visualRemove', 'visualLight'] } })
    const { id, positionMm, radiusMm, color, intensity, wallOcclusion, enabled } = light
    const replayed = replayAuthoring(authorization.start, [{ index: 1, stepId: 'recreate-light', operations: [
      { kind: 'visualRemove', effectKind: 'light', id }, { kind: 'visualLight', id, positionMm, radiusMm, color, intensity, wallOcclusion, enabled },
    ] }])
    const candidate = await workspace.prepareAtomicCandidate(authorization, { schemaVersion: 4, taskId: 'visual-recreate-task', generation: 1, start: authorization.start, state: replayed.state })
    expect(candidate.changes).toContainEqual(expect.objectContaining({ id, collection: 'visual.base.base.lights', fields: ['identity'] }))
    if (candidate.schemaVersion !== 4 || !candidate.budgetIdentity) throw new Error('Expected a current-authoring credential')
    const result = await workspace.adoptAtomicCandidate(candidate, { claim: async () => ({ schemaVersion: 4, taskId: candidate.taskId,
      generation: 1, draftRevision: candidate.draftRevision, contentHash: candidate.contentHash, ...candidate.budgetIdentity!, claimId: crypto.randomUUID(), serverNow: 1000, expiresAt: 31000 }) })
    await result.save
    expect(visualBase(workspace.getDocument()!)!.lights[id]).toEqual(light)
    await expect(workspace.prepareRestore(snapshot.id, { mode: 'visual', ids: [id] })).rejects.toThrow(/删除.*重建/)
    workspace.undo(); await workspace.flush()
    await expect(workspace.prepareRestore(snapshot.id, { mode: 'visual', ids: [id] })).rejects.toThrow(/删除.*重建/)
  })



  it('includes actual visual records and environment in AI review differences', async () => {
    const { workspace } = await setup();
    const before = toBundle(workspace.getState().project!).project, light = lamp(workspace.getDocument()!)
    await workspace.execute([{ type: 'upsertVisualLight', light }, { type: 'setVisualEnvironment', environment: { ...emptyVisualSystem().environment, ambientOpacity: .2 } }])
    const after = toBundle(workspace.getState().project!).project
    expect(atomicChanges(before, after, []).map(change => change.collection)).toEqual(['visual.base.base.lights', 'visual.base.base.environment'])
  })
})
