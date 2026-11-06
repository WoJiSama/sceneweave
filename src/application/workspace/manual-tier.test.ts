import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { cloneJson } from '../../shared/validation/json.js'
import { fromBundle, toBundle } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace } from './workspace.js'

const opened: { workspace: Workspace; repository: ProjectRepository }[] = []
afterEach(async () => {
  for (const { workspace, repository } of opened.splice(0)) {
    await workspace.close(); const name = repository.database.name; repository.close(); await Dexie.delete(name)
  }
})
async function setup(count: number, grouped = false, physicalCount = grouped ? Math.min(1800, count) : count) {
  const source = fixture({ image: true }), scene = cloneJson(source.project.document), prop = scene.props.item, layerId = scene.entityLayers.item
  scene.props = {}; scene.entityLayers = {}
  scene.userLayers.target = { id: 'target', floorId: 'blank-floor', name: '目标', order: 1, editLocked: false }
  for (let index = 0; index < physicalCount; index++) {
    const id = `dense-${index}`
    scene.props[id] = { ...cloneJson(prop), id }; scene.entityLayers[id] = layerId
  }
  if (grouped) {
    scene.terrainAreas.ground = { id: 'ground', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      boundaryMm: [{ x: 3000, y: 3000 }, { x: 13000, y: 3000 }, { x: 13000, y: 13000 }, { x: 3000, y: 13000 }]
        .map((positionMm, index) => ({ id: `ground-p${index}`, segmentId: `ground-s${index}`, positionMm })),
      groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.entityLayers.ground = layerId
    for (const item of Object.values(scene.props)) item.supportRef = { kind: 'terrainArea', id: 'ground' }
    for (let index = physicalCount; index < count; index++) {
      const id = `note-${index}`
      scene.notes[id] = { id, floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'private member', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'dense-0' } }
      scene.entityLayers[id] = layerId
    }
    scene.aggregateCoordinates = { encoding: 'world', groups: { natural: { id: 'natural', floorId: 'blank-floor', parentId: null,
      frame: { translationMm: { x: 8000, y: 8000 }, quarterTurns: 0 }, editLocked: false,
      members: [{ kind: 'terrainArea', id: 'ground' }, ...Object.keys(scene.props).map(id => ({ kind: 'prop' as const, id })), ...Object.keys(scene.notes).map(id => ({ kind: 'note' as const, id }))] } } }
  }
  Object.assign(source.project, createCompositionContent(scene, runtime))
  const repository = new ProjectRepository({ name: `manual-tier-${crypto.randomUUID()}`, runtime, validation })
  const workspace = new Workspace(repository, { runtime, validation }); opened.push({ workspace, repository })
  await workspace.adoptNew(await fromBundle(source, validation))
  return { workspace, repository, sceneId: scene.sceneId, layerId }
}

describe('load-selected ordinary transaction tiers', () => {
  it('carries 2000 real members through one core edit, full lock checks, undo and cold save', async () => {
    const { workspace, repository, sceneId } = await setup(2000, true), before = workspace.getState().project!
    const command = { type: 'transformAggregateNatural' as const, id: 'natural', offsetMm: { x: 100, y: 0 }, pivotMm: { x: 8000, y: 8000 }, quarterTurns: 0 as const }
    const preview = await workspace.preview([command])
    expect(preview.budgetUsage?.semanticTargets).toBe(1)
    expect(preview.budgetUsage?.groupMembers).toBe(2001)
    expect(preview.budgetUsage?.geometryPoints).toBeGreaterThan(2000)
    expect(workspace.getState().project).toBe(before)
    await workspace.adoptPreview(preview); await workspace.flush()
    const cold = await repository.load(sceneId)
    expect(cold!.project.document.props['dense-1799'].positionMm.x).toBe(before.document.props['dense-1799'].positionMm.x + 100)
    expect(cold!.project.historyIdentity).toEqual(before.historyIdentity)
    workspace.undo(); await workspace.flush()
    expect(workspace.getDocument()!.props).toEqual(before.document.props)
    workspace.redo(); await workspace.flush()
    expect((await repository.load(sceneId))!.project.document.revision).toBe(3)
    await workspace.execute([{ type: 'setEditLock', kind: 'prop', id: 'dense-1799', locked: true }]); await workspace.flush()
    const locked = workspace.getState().project!
    await expect(workspace.preview([command])).rejects.toThrow(/锁/)
    expect(workspace.getState().project).toBe(locked)
    expect((await repository.load(sceneId))!.project.document.revision).toBe(4)
  }, 90000)

  it('selects a larger tier for new copies while the current scene is small', async () => {
    const { workspace } = await setup(1)
    const preview = await workspace.preview(Array.from({ length: 257 }, (_, index) => ({
      type: 'copyProp' as const, id: 'dense-0', newId: `new-${index}`, offsetMm: { x: 0, y: 0 },
    })))
    expect(preview.budgetProfile?.semanticTargets).toBe(512)
    expect(preview.budgetUsage?.semanticTargets).toBe(257)
    expect(Object.keys(workspace.getDocument()!.props)).toHaveLength(1)
    workspace.cancelPreview(preview)
    await expect(workspace.adoptPreview(preview)).rejects.toThrow(/预览/)
  }, 90000)

  it('still refuses excessive geometry for a one-core edit without changing either branch', async () => {
    const { workspace, repository, sceneId } = await setup(2000, true, 2000), before = workspace.getState().project!
    await expect(workspace.preview([{ type: 'transformAggregateNatural', id: 'natural', offsetMm: { x: 100, y: 0 },
      pivotMm: { x: 8000, y: 8000 }, quarterTurns: 0 }])).rejects.toThrow(/intersectionPairs/)
    expect(workspace.getState().project).toBe(before)
    expect((await repository.load(sceneId))!.project.document.revision).toBe(0)
  }, 90000)

  it('expands a historical layer request before freezing its restoration tier', async () => {
    const { workspace, repository, layerId, sceneId } = await setup(800)
    const snapshot = await workspace.createNamedSnapshot('layer before adjustment')
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId },
      adjustment: { id: 'dim', kind: 'brightness', enabled: true, value: .5 } }])
    await workspace.flush()
    const current = workspace.getState().project!, preview = await workspace.prepareRestore(snapshot.id, { ids: [layerId], mode: 'layer' })
    expect(preview.budgetProfile.semanticTargets).toBe(1024)
    expect(preview.plan.commandCost).toBe(800)
    expect(workspace.getState().project).toBe(current)
    await workspace.applyRestore(preview); await workspace.flush()
    expect((await repository.load(sceneId))!.project.document.revision).toBe(2)
    expect(workspace.getState().project!.appearance.layerAdjustments[layerId]).toBeUndefined()
    workspace.undo()
    expect(workspace.getState().project!.appearance.layerAdjustments[layerId][0].id).toBe('dim')
  }, 90000)

  it.each([[500, 500, 512], [800, 800, 1024], [2000, 1024, 1024]])('adopts %i retained / %i layer targets with a frozen %i envelope as one reversible save', async (count, targets, limit) => {
    const { workspace, repository, sceneId, layerId } = await setup(count)
    const ids = Array.from({ length: targets }, (_, index) => `dense-${index}`), before = workspace.getState().project!
    const preview = await workspace.preview([{ type: 'moveEntitiesToLayer', ids, layerId: 'target' }])
    expect(preview.budgetProfile?.semanticTargets).toBe(limit)
    expect(preview.budgetUsage?.semanticTargets).toBe(targets)
    expect(Object.isFrozen(preview.budgetProfile)).toBe(true)
    expect(workspace.getState().project).toBe(before)
    expect((await repository.load(sceneId))!.project.document.revision).toBe(0)
    await expect(workspace.adoptPreview({ ...preview })).rejects.toThrow(/不可重复采用/)
    await workspace.adoptPreview(preview); await workspace.flush()
    expect(workspace.getDocument()!.revision).toBe(1)
    const saved = await repository.load(sceneId)
    expect(projectContentHash(saved!.project)).toBe(projectContentHash(toBundle(workspace.getState().project!).project))
    expect(ids.every(id => saved!.project.document.entityLayers[id] === 'target')).toBe(true)
    workspace.undo(); await workspace.flush()
    expect(workspace.getDocument()!.revision).toBe(2)
    expect(ids.every(id => workspace.getDocument()!.entityLayers[id] === layerId)).toBe(true)
    workspace.redo(); await workspace.flush()
    expect(workspace.getDocument()!.revision).toBe(3)
    expect((await repository.load(sceneId))!.project.document.entityLayers[ids.at(-1)!]).toBe('target')
    const current = workspace.getState().project!
    await expect(workspace.preview([{ type: 'moveEntitiesToLayer', ids: Array.from({ length: 1025 }, (_, index) => `dense-${index}`), layerId }])).rejects.toThrow()
    expect(workspace.getState().project).toBe(current)
    expect((await repository.load(sceneId))!.project.document.revision).toBe(3)
  }, 90000)
})
