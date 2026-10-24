import { describe, expect, it } from 'vitest'
import { applyCommandsV3, createPlacedPropV3, type SceneCommandV3 } from '../core/v3/commands.js'
import { openingEndpointsV2 } from '../core/v2/geometry.js'
import { groupLayerSceneV3, layerSceneV3, scatterLayerSceneV3, symbolPropV3 } from '../core/v3/test-fixtures.js'
import type { SceneDocumentV3 } from '../core/v3/types.js'
import { applyCommands, applySnapshotCommands, createPlacedProp, type SceneCommand } from './commands/commands.js'
import { previewLayerMove } from './commands/layers.js'
import { previewBuildingCommands } from './commands/building.js'
import { geometryDocumentForValidation } from './commands/domain.js'
import { openingEndpoints } from './geometry/geometry.js'
import type { PointMm, SceneDocument, Wall } from './model/scene.js'
import type { PreparationContext } from './ports/runtime.js'
import { validateSceneDocument } from './validation/scene.js'
import { validateSceneSnapshot } from './validation/snapshots.js'

const floorId = 'blank-floor'
const context = (): PreparationContext => {
  let next = 0
  return { ids: { nextId: () => `prepared-${next++}` }, clock: { now: () => '2026-10-24T00:00:00.000Z' } }
}

/** Test-only fixture adaptation; production conversion is a later M2-0 slice. */
const native = (legacy: SceneDocumentV3): SceneDocument => ({ ...structuredClone(legacy), format: 'sceneweave-scene', schemaVersion: 1 })
const apply = (scene: SceneDocument, ...commands: SceneCommand[]) => applyCommands(scene, commands, context())
const legacyApply = (scene: SceneDocumentV3, ...commands: SceneCommandV3[]) => applyCommandsV3(scene, commands)
const rectangle = (x = 1000, y = 1000, width = 6000, height = 6000): PointMm[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
const createRoom = (id: string, boundaryMm = rectangle(), layerId?: string): Extract<SceneCommand, { type: 'createRoom' }> => ({
  type: 'createRoom', id, floorId, boundaryMm, thicknessMm: 200, ...(layerId === undefined ? {} : { layerId }),
})
function blank(): SceneDocumentV3 {
  const scene = layerSceneV3()
  delete scene.props.item
  delete scene.entityLayers.item
  return scene
}
function verticalWall(scene: SceneDocument, x: number): Wall {
  const wall = Object.values(scene.walls).find(wall => scene.vertices[wall.startVertexId].xMm === x && scene.vertices[wall.endVertexId].xMm === x)
  if (!wall) throw new Error(`Missing fixture wall at x=${x}`)
  return wall
}
function fullPrefab(): SceneDocument {
  const old = groupLayerSceneV3(), layerId = old.entityLayers.group
  const template = structuredClone(old.prefabDefinitions.definition.members[0].propTemplate)
  delete old.props.left
  delete old.props.right
  delete old.entityLayers.left
  delete old.entityLayers.right
  old.prefabDefinitions.definition.members = []
  old.prefabInstances.group.members = {}
  for (let index = 0; index < 128; index++) {
    const key = `member-${index}`, propId = `prefab-prop-${index}`
    old.prefabDefinitions.definition.members.push({ key, propTemplate: structuredClone(template) })
    old.prefabInstances.group.members[key] = { propId, overrideFields: ['positionMm'] }
    old.props[propId] = symbolPropV3(propId, 4000 + index % 16 * 300, 6000 + Math.floor(index / 16) * 300)
    old.entityLayers[propId] = layerId
  }
  return native(old)
}

describe('M2-0b native scene command equivalence and atomic boundaries', () => {
  it('matches legacy prop move/copy/delete fields and preserves the input and revision', () => {
    const old = layerSceneV3(), source = native(old), before = structuredClone(source)
    const commands: SceneCommandV3[] = [
      { type: 'updateProp', id: 'item', changes: { positionMm: { x: 5000, y: 5000 }, rotationDeg: 45 } },
      { type: 'copyProp', id: 'item', newId: 'copy', offsetMm: { x: 1200, y: 0 } },
      { type: 'deleteProp', id: 'item' },
    ]
    const next = applyCommands(source, commands, context())
    expect(next).toEqual(native(legacyApply(old, ...commands)))
    expect(next.revision).toBe(source.revision)
    expect(next.entityLayers.copy).toBe(source.entityLayers.item)
    expect(next.entityLayers).not.toHaveProperty('item')
    expect(source).toEqual(before)
  })

  it('matches complete layer organization and expands a member move to the intact private group', () => {
    let old = groupLayerSceneV3(), current = native(old)
    const organization: SceneCommandV3[] = [
      { type: 'createLayer', id: 'target', floorId, name: '  道具  ' },
      { type: 'renameLayer', id: 'target', name: '组合' },
      { type: 'reorderLayers', floorId, ids: ['target', old.entityLayers.group] },
    ]
    old = legacyApply(old, ...organization)
    current = applyCommands(current, organization, context())
    expect(current).toEqual(native(old))
    const preview = previewLayerMove(current, ['left'], 'target')
    expect(preview.reason).toBeNull()
    expect(preview.expandedIds).toEqual(['group', 'left', 'right'])
    const command: SceneCommandV3 = { type: 'moveEntitiesToLayer', ids: ['left'], layerId: 'target' }
    const next = apply(current, command)
    expect(next).toEqual(native(legacyApply(old, command)))
    expect(next.prefabInstances.group.visibility).toBe('gm')
    expect(next.prefabInstances.group.members.removed).toEqual(current.prefabInstances.group.members.removed)
  })

  it('matches two adjacent rooms with one common wall and unchanged shared vertex identities', () => {
    const old = blank(), commands = [createRoom('a'), createRoom('b', rectangle(7000, 1000))]
    const next = apply(native(old), ...commands)
    expect(next).toEqual(native(legacyApply(old, ...commands)))
    expect(Object.keys(next.rooms)).toHaveLength(2)
    expect(Object.keys(next.walls)).toHaveLength(7)
    expect(Object.keys(next.vertices)).toHaveLength(6)
    const common = verticalWall(next, 7000)
    expect(next.rooms.a.boundaryVertexIds).toContain(common.startVertexId)
    expect(next.rooms.b.boundaryVertexIds).toContain(common.startVertexId)
    expect(validateSceneDocument(next).ok).toBe(true)
  })

  it('matches partial common-wall splitting and preserves actual secret-door endpoints', () => {
    let old = legacyApply(blank(), createRoom('a', rectangle(1000, 1000, 6000, 12000)))
    const wall = verticalWall(native(old), 7000)
    old = legacyApply(old, { type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.endVertexId,
      offsetMm: 5000, widthMm: 1200, kind: 'door', state: 'open', locked: true, secret: true, revealed: true })
    const source = native(old), command = createRoom('b', rectangle(7000, 4000, 6000, 6000))
    const preview = previewBuildingCommands(source, [command]), next = apply(source, command)
    expect(preview.reason).toBeNull()
    expect(preview.changedIds).toContain('a')
    expect(next).toEqual(native(legacyApply(old, command)))
    const after = openingEndpoints(next, next.openings.door), before = openingEndpointsV2(old, old.openings.door)
    after.forEach((point, index) => { expect(point.x).toBeCloseTo(before[index].x, 6); expect(point.y).toBeCloseTo(before[index].y, 6) })
    expect(next.openings.door).toMatchObject({ state: 'open', locked: true, secret: true, revealed: true })
  })

  it('rejects a later invalid operation without exposing the earlier successful draft edit', () => {
    const old = layerSceneV3(), source = native(old), before = structuredClone(source)
    const commands: SceneCommandV3[] = [
      { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } },
      { type: 'deleteProp', id: 'missing' },
    ]
    expect(() => applyCommands(source, commands, context())).toThrow(/不存在/)
    expect(() => legacyApply(old, ...commands)).toThrow(/不存在/)
    expect(source).toEqual(before)
    expect(old.props.item.rotationDeg).toBe(0)
    expect(() => apply(source, { type: 'updateProp', id: 'item', changes: { rotationDeg: 45 }, hiddenOperation: 'delete' } as unknown as SceneCommand)).toThrow(/指令无效/)
    expect(source).toEqual(before)
  })

  it('keeps entity unlocking, layer unlocking and content editing in separate atomic batches', () => {
    const old = layerSceneV3(), source = native(old), layerId = source.entityLayers.item
    const batches: SceneCommandV3[][] = [
      [{ type: 'setEditLock', kind: 'prop', id: 'item', locked: false }, { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } }],
      [{ type: 'setLayerLock', id: layerId, locked: false }, { type: 'deleteProp', id: 'item' }],
      [{ type: 'renameLayer', id: layerId, name: '新名称' }, { type: 'deleteProp', id: 'item' }],
    ]
    const before = structuredClone(source)
    for (const commands of batches) {
      expect(() => applyCommands(source, commands, context())).toThrow(/独立/)
      expect(() => legacyApply(old, ...commands)).toThrow(/独立/)
    }
    expect(source).toEqual(before)
  })

  it('retains recursive cross-layer note locks and never persists synthetic entity lock flags', () => {
    const old = legacyApply(layerSceneV3(), { type: 'createLayer', id: 'notes-layer', floorId, name: '注记' })
    old.notes.first = { id: 'first', floorId, editLocked: false, visibility: 'gm', kind: 'note', text: 'first', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
    old.notes.second = { id: 'second', floorId, editLocked: false, visibility: 'gm', kind: 'note', text: 'second', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    old.entityLayers.first = old.entityLayers.item
    old.entityLayers.second = 'notes-layer'
    old.userLayers['notes-layer'].editLocked = true
    const source = native(old), before = structuredClone(source)
    const move: SceneCommandV3 = { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } }
    expect(() => apply(source, move)).toThrow(/锁定/)
    expect(() => legacyApply(old, move)).toThrow(/锁定/)
    expect(source).toEqual(before)
    const unlocked = apply(source, { type: 'setLayerLock', id: 'notes-layer', locked: false })
    const next = apply(unlocked, move)
    expect(next.props.item.editLocked).toBe(false)
    expect(next.notes.second.editLocked).toBe(false)
    expect(next.props.item.rotationDeg).toBe(90)
  })

  it('blocks a shared-wall edit when supported furniture on another layer is locked', () => {
    let old = legacyApply(blank(), createRoom('a'), createRoom('b', rectangle(7000, 1000)))
    old = legacyApply(old, { type: 'createLayer', id: 'furniture', floorId, name: '家具' })
    old.props.supported = { ...symbolPropV3('supported', 4000, 4000), supportRef: { kind: 'room', id: 'a' }, roomId: 'a' }
    old.entityLayers.supported = 'furniture'
    old.userLayers.furniture.editLocked = true
    const source = native(old), before = structuredClone(source), wall = verticalWall(source, 7000)
    expect(validateSceneDocument(source).ok).toBe(true)
    const command: SceneCommandV3 = { type: 'setWallThickness', id: wall.id, thicknessMm: 300 }
    expect(() => apply(source, command)).toThrow(/锁定/)
    expect(() => legacyApply(old, command)).toThrow(/锁定/)
    expect(source).toEqual(before)
  })

  it('uses injected placement IDs and checks the explicit support layer independently from the target layer', () => {
    const old = legacyApply(scatterLayerSceneV3(0), { type: 'createLayer', id: 'target', floorId, name: '放置' })
    const source = native(old), options = { layerId: 'target', supportRef: { kind: 'terrainArea' as const, id: 'domain' } }
    const ghost = createPlacedProp(source, 'scatter-definition', { x: 3000, y: 3000 }, context(), options)
    expect(ghost.id).toBe('prepared-0')
    expect(ghost).toEqual(createPlacedPropV3(old, 'scatter-definition', ghost.positionMm, { ...options, id: ghost.id }))
    source.userLayers[source.entityLayers.domain].editLocked = true
    old.userLayers[old.entityLayers.domain].editLocked = true
    const before = structuredClone(source)
    expect(() => createPlacedProp(source, 'scatter-definition', ghost.positionMm, context(), options)).toThrow(/锁定/)
    expect(() => createPlacedPropV3(old, 'scatter-definition', ghost.positionMm, options)).toThrow(/锁定/)
    expect(source).toEqual(before)
  })

  it('charges every prefab member and intermediate transformation even when the final geometry would cancel out', () => {
    const source = fullPrefab(), before = structuredClone(source), group = source.prefabInstances.group
    expect(validateSceneDocument(source).ok).toBe(true)
    const moved = { x: group.anchorMm.x + 1000, y: group.anchorMm.y }
    const one = apply(source, { type: 'transformPrefab', id: group.id, anchorMm: moved })
    expect(Object.values(one.prefabInstances.group.members).filter(member => member.propId !== null)).toHaveLength(128)
    expect(one.props['prefab-prop-0'].positionMm.x).toBe(source.props['prefab-prop-0'].positionMm.x + 1000)
    // Each step writes 128 props plus their parent. Two raw commands exceed 256.
    expect(() => apply(source,
      { type: 'transformPrefab', id: group.id, anchorMm: moved },
      { type: 'transformPrefab', id: group.id, anchorMm: group.anchorMm },
    )).toThrow(/256/)
    expect(source).toEqual(before)
  })

  it('matches outdoor geometry changes and exposes native intermediate drafts without losing layers', () => {
    const old = blank(), source = native(old), observations: SceneDocument[] = []
    const commands: SceneCommandV3[] = [
      { type: 'createTerrainArea', id: 'area', floorId, boundaryMm: rectangle(1000, 1000, 8000, 8000) },
      { type: 'createPath', id: 'path', floorId, centerlineMm: [{ x: 2500, y: 3000 }, { x: 7500, y: 3000 }], widthMm: 400, supportRefs: [{ kind: 'terrainArea', id: 'area' }] },
      { type: 'moveTerrainPoint', areaId: 'area', pointId: 'area:point:1', positionMm: { x: 9500, y: 1000 } },
    ]
    const next = applyCommands(source, commands, context(), { onOutdoorDraft: draft => observations.push(structuredClone(draft)) })
    expect(next).toEqual(native(legacyApply(old, ...commands)))
    expect(observations).toHaveLength(3)
    for (const draft of observations) {
      expect(draft).toMatchObject({ format: 'sceneweave-scene', schemaVersion: 1 })
      expect(draft.userLayers).toEqual(source.userLayers)
      expect(draft.entityLayers.area).toBe(Object.keys(source.userLayers)[0])
    }
    const effective = geometryDocumentForValidation(next, true)
    expect(effective.format).toBe('sceneweave-scene')
    expect(effective.schemaVersion).toBe(1)
    expect(effective.userLayers).toEqual(next.userLayers)
    expect(effective.entityLayers).toEqual(next.entityLayers)
  })

  it('keeps native no-op snapshot identity and deterministic scatter births while retaining manual records', () => {
    const old = scatterLayerSceneV3(1), source = native(old), before = structuredClone(source)
    const checked = validateSceneSnapshot(source)
    if (!checked.ok) throw new Error(checked.errors.map(issue => issue.message).join('; '))
    expect(applySnapshotCommands(checked.document, [], context())).toBe(checked.document)
    const commands: SceneCommand[] = [{ type: 'regenerateScatter', id: 'scatter', densityFactor: 1 }]
    const first = applyCommands(source, commands, context()), second = applyCommands(source, commands, context())
    expect(first).toEqual(second)
    const manualKey = '1'.padStart(64, '0')
    expect(first.scatterGroups.scatter.members[manualKey]).toEqual(source.scatterGroups.scatter.members[manualKey])
    expect(first.props['scatter-item-0']).toEqual(source.props['scatter-item-0'])
    const births = Object.keys(first.props).filter(id => !(id in source.props))
    expect(births.length).toBeGreaterThan(10)
    expect(births.every(id => /^prepared-\d+$/.test(id))).toBe(true)
    expect(source).toEqual(before)
  })
})
