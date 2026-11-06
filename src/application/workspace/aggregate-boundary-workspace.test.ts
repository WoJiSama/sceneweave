import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { projectScene } from '../../shared/projection/projection.js'
import { getSceneDerivationEvidence } from '../../shared/validation/snapshots.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import { validateSceneDocument } from '../../shared/validation/scene.js'
import { canonicalJson, cloneJson } from '../../shared/validation/json.js'
import { fromBundle } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace } from './workspace.js'

const opened: { workspace: Workspace; repository: ProjectRepository }[] = []
afterEach(async () => {
  for (const { workspace, repository } of opened.splice(0)) {
    await workspace.close(); const name = repository.database.name; repository.close(); await Dexie.delete(name)
  }
})
async function setup(batch = false) {
  const source = fixture(), before = cloneJson(source.project.document)
  source.project.document.aggregateCoordinates = { encoding: 'world', groups: {
    'boundary-root': { id: 'boundary-root', parentId: null, floorId: 'blank-floor', editLocked: false,
      frame: { translationMm: { x: 200, y: -300 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }] },
  } }
  if (batch) source.project.document.aggregateCoordinates!.groups.neighbor = { id: 'neighbor', parentId: null, floorId: 'blank-floor', editLocked: false, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [{ kind: 'prop', id: 'other' }] }
  source.project.historyIdentity = advanceHistoryIdentity(source.project.historyIdentity, before, source.project.document, runtime)
  const repository = new ProjectRepository({ name: `aggregate-boundary-${crypto.randomUUID()}`, runtime, validation })
  const workspace = new Workspace(repository, { runtime, validation }); opened.push({ workspace, repository })
  await workspace.adoptNew(await fromBundle(source, validation))
  return { workspace, repository, project: workspace.getState().project! }
}

describe('aggregate boundary diagnostics through normal workspace preview', () => {
  it('previews without writing, adopts one undo unit, and cold-loads geometry without diagnostic metadata', async () => {
    const { workspace, repository, project } = await setup(), point = project.document.props.item.positionMm
    const move = { type: 'updateProp' as const, id: 'item', changes: { positionMm: { x: 9000, y: 9000 } } }
    const preview = await workspace.preview([move]), report = preview.aggregateBoundaryImpact!
    expect(getSceneDerivationEvidence(preview.document)).toMatchObject({ algorithmContract: 'aggregate-prop-move-geometry@1', changedPropIds: ['item'] })
    expect(validateSceneDocument(preview.document)).toMatchObject({ ok: true })
    expect(report.groups[0]).toMatchObject({ groupId: 'boundary-root', baselineProofValid: true, queryScope: 'supplied-bounds', requiresFullDomainValidation: true })
    expect(report.groups[0].externalCandidates.next.some(row => row.entity.id === 'other')).toBe(true)
    expect(workspace.getState().project).toBe(project)
    expect((await repository.load(project.document.sceneId))!.project.document.props.item.positionMm).toEqual(point)
    const repeated = await workspace.preview([move])
    expect(repeated.aggregateBoundaryImpact!.dependencyClosure).toBe(report.dependencyClosure)
    workspace.cancelPreview(repeated)
    await workspace.adoptPreview(preview)
    expect(workspace.getState().project!.document.props.item.positionMm).toEqual(move.changes.positionMm)
    workspace.undo()
    expect(workspace.getState().project!.document.props.item.positionMm).toEqual(point)
    workspace.redo()
    await workspace.flush()
    const cold = (await repository.load(project.document.sceneId))!.project.document
    expect(cold.props.item.positionMm).toEqual(move.changes.positionMm)
    expect(cold.aggregateCoordinates!.groups['boundary-root'].members).toEqual([{ kind: 'prop', id: 'item' }])
    expect(canonicalJson(cold)).not.toContain('baselineProofValid')
    expect(canonicalJson(projectScene(cold, 'player'))).not.toContain('boundary-root')
    expect(canonicalJson(projectScene(cold, 'player'))).not.toContain('externalCandidates')
  })

  it('retains exact lock, geometry, cancellation and stale-preview rejection', async () => {
    const { workspace, project } = await setup(), before = canonicalJson(project.document)
    await expect(workspace.preview([{ type: 'updateProp', id: 'item', changes: { positionMm: { x: -1000, y: -1000 } } }])).rejects.toThrow()
    expect(canonicalJson(workspace.getState().project!.document)).toBe(before)
    const cancelled = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 20 } }])
    workspace.cancelPreview(cancelled)
    await expect(workspace.adoptPreview(cancelled)).rejects.toThrow(/预览/)
    const stale = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 30 } }])
    await workspace.execute([{ type: 'updateProp', id: 'other', changes: { rotationDeg: 10 } }])
    await expect(workspace.adoptPreview(stale)).rejects.toThrow()
    await workspace.execute([{ type: 'setEditLock', kind: 'prop', id: 'item', locked: true }])
    const locked = canonicalJson(workspace.getState().project!.document)
    await expect(workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 40 } }])).rejects.toThrow(/锁/)
    expect(canonicalJson(workspace.getState().project!.document)).toBe(locked)
  })
  it('keeps multi-group moves atomic through adoption, undo and cold storage', async () => {
    const { workspace, repository, project } = await setup(true)
    const commands = ['item', 'other'].map(id => ({ type: 'updateProp' as const, id, changes: { positionMm: { x: 7000, y: 7000 } } }))
    const preview = await workspace.preview(commands), report = preview.aggregateBoundaryImpact!
    expect(getSceneDerivationEvidence(preview.document)?.changedPropIds).toEqual(['item', 'other'])
    expect(report.groups.map(group => group.groupId)).toEqual(['boundary-root', 'neighbor'])
    expect(report.groups.every(group => group.externalCandidates.next.some(row => row.entity.kind === 'prop'))).toBe(true)
    expect(workspace.getState().project).toBe(project)
    await workspace.adoptPreview(preview)
    expect(workspace.getState().project!.document.revision).toBe(1)
    for (const id of ['item', 'other']) expect(workspace.getState().project!.document.props[id].positionMm).toEqual({ x: 7000, y: 7000 })
    workspace.undo()
    for (const id of ['item', 'other']) expect(workspace.getState().project!.document.props[id].positionMm).toEqual(project.document.props[id].positionMm)
    workspace.redo(); await workspace.flush()
    const cold = (await repository.load(project.document.sceneId))!.project.document
    for (const id of ['item', 'other']) expect(cold.props[id].positionMm).toEqual({ x: 7000, y: 7000 })
    expect(canonicalJson(cold)).not.toContain('unboundedTargets')
    expect(canonicalJson(cold)).not.toContain('aggregate-prop-move-geometry')
    expect(getSceneDerivationEvidence(cold)).toBeUndefined()
    expect(canonicalJson(projectScene(cold, 'player'))).not.toContain('aggregateBoundaryImpact')
  })

})
