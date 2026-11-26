import { describe, expect, it } from 'vitest'
import { groupLayerScene, layerScene, scatterLayerScene, symbolProp } from '../../tests/helpers/current-project-fixtures.js'
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

const apply = (scene: SceneDocument, ...commands: SceneCommand[]) => applyCommands(scene, commands, context())
const rectangle = (x = 1000, y = 1000, width = 6000, height = 6000): PointMm[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
const createRoom = (id: string, boundaryMm = rectangle(), layerId?: string): Extract<SceneCommand, { type: 'createRoom' }> => ({
  type: 'createRoom', id, floorId, boundaryMm, thicknessMm: 200, ...(layerId === undefined ? {} : { layerId }),
})
function blank(): SceneDocument {
  const scene = layerScene()
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
  const old = groupLayerScene(), layerId = old.entityLayers.group
  const template = structuredClone(old.prefabDefinitions.definition.members[0].propTemplate)
  delete old.props.left
  delete old.props.right
  delete old.entityLayers.left
  delete old.entityLayers.right
  old.prefabDefinitions.definition.members = []
  old.prefabInstances.group.members = {}
  for (let index = 0; index < 127; index++) {
    const key = `member-${index}`, propId = `prefab-prop-${index}`
    old.prefabDefinitions.definition.members.push({ key, propTemplate: structuredClone(template) })
    old.prefabInstances.group.members[key] = { propId, overrideFields: ['positionMm'] }
    old.props[propId] = symbolProp(propId, 4000 + index % 16 * 300, 6000 + Math.floor(index / 16) * 300)
    old.entityLayers[propId] = layerId
  }
  return old
}

describe('Complete-v1 scene command and atomic boundaries', () => {
  it('applies prop move, copy and delete atomically and preserves the input and revision', () => {
    const source = layerScene(), before = structuredClone(source)
    const commands: SceneCommand[] = [
      { type: 'updateProp', id: 'item', changes: { positionMm: { x: 5000, y: 5000 }, rotationDeg: 45 } },
      { type: 'copyProp', id: 'item', newId: 'copy', offsetMm: { x: 1200, y: 0 } },
      { type: 'deleteProp', id: 'item' },
    ]
    const next = applyCommands(source, commands, context())
    expect(next.props.copy).toMatchObject({ positionMm: { x: 6200, y: 5000 }, rotationDeg: 45 })
    expect(next.props.item).toBeUndefined()
    expect(next.revision).toBe(source.revision)
    expect(next.entityLayers.copy).toBe(source.entityLayers.item)
    expect(next.entityLayers).not.toHaveProperty('item')
    expect(source).toEqual(before)
  })

  it('preserves layer organization and expands a member move to the intact private group', () => {
    const source = groupLayerScene()
    const organization: SceneCommand[] = [
      { type: 'createLayer', id: 'target', floorId, name: '  道具  ' },
      { type: 'renameLayer', id: 'target', name: '组合' },
      { type: 'reorderLayers', floorId, ids: ['target', source.entityLayers.group] },
    ]
    const current = applyCommands(source, organization, context())
    expect(current.userLayers.target).toMatchObject({ name: '组合', order: 0 })
    const preview = previewLayerMove(current, ['left'], 'target')
    expect(preview.reason).toBeNull()
    expect(preview.expandedIds).toEqual(['group', 'left', 'right'])
    const command: SceneCommand = { type: 'moveEntitiesToLayer', ids: ['left'], layerId: 'target' }
    const next = apply(current, command)
    expect(['group', 'left', 'right'].map(id => next.entityLayers[id])).toEqual(['target', 'target', 'target'])
    expect(next.prefabInstances.group.visibility).toBe('gm')
    expect(next.prefabInstances.group.members.removed).toEqual(current.prefabInstances.group.members.removed)
  })

  it('builds two adjacent rooms with one common wall and unchanged shared vertex identities', () => {
    const old = blank(), commands = [createRoom('a'), createRoom('b', rectangle(7000, 1000))]
    const next = apply(old, ...commands)
    expect(Object.keys(next.rooms)).toHaveLength(2)
    expect(Object.keys(next.walls)).toHaveLength(7)
    expect(Object.keys(next.vertices)).toHaveLength(6)
    const common = verticalWall(next, 7000)
    expect(next.rooms.a.boundaryVertexIds).toContain(common.startVertexId)
    expect(next.rooms.b.boundaryVertexIds).toContain(common.startVertexId)
    expect(validateSceneDocument(next).ok).toBe(true)
  })

  it('handles partial common-wall splitting and preserves actual secret-door endpoints', () => {
    let old = apply(blank(), createRoom('a', rectangle(1000, 1000, 6000, 12000)))
    const wall = verticalWall(old, 7000)
    old = apply(old, { type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.endVertexId,
      offsetMm: 5000, widthMm: 1200, kind: 'door', state: 'open', locked: true, secret: true, revealed: true })
    const source = old, command = createRoom('b', rectangle(7000, 4000, 6000, 6000))
    const preview = previewBuildingCommands(source, [command]), next = apply(source, command)
    expect(preview.reason).toBeNull()
    expect(preview.changedIds).toContain('a')
    const after = openingEndpoints(next, next.openings.door), before = openingEndpoints(old, old.openings.door)
    after.forEach((point, index) => { expect(point.x).toBeCloseTo(before[index].x, 6); expect(point.y).toBeCloseTo(before[index].y, 6) })
    expect(next.openings.door).toMatchObject({ state: 'open', locked: true, secret: true, revealed: true })
  })

  it('rejects a later invalid operation without exposing the earlier successful draft edit', () => {
    const source = layerScene(), before = structuredClone(source)
    const commands: SceneCommand[] = [
      { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } },
      { type: 'deleteProp', id: 'missing' },
    ]
    expect(() => applyCommands(source, commands, context())).toThrow(/不存在/)
    expect(source).toEqual(before)
    expect(source.props.item.rotationDeg).toBe(0)
    expect(() => apply(source, { type: 'updateProp', id: 'item', changes: { rotationDeg: 45 }, hiddenOperation: 'delete' } as unknown as SceneCommand)).toThrow(/指令无效/)
    expect(source).toEqual(before)
  })

  it('keeps entity unlocking, layer unlocking and content editing in separate atomic batches', () => {
    const old = layerScene(), source = old, layerId = source.entityLayers.item
    const batches: SceneCommand[][] = [
      [{ type: 'setEditLock', kind: 'prop', id: 'item', locked: false }, { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } }],
      [{ type: 'setLayerLock', id: layerId, locked: false }, { type: 'deleteProp', id: 'item' }],
      [{ type: 'renameLayer', id: layerId, name: '新名称' }, { type: 'deleteProp', id: 'item' }],
    ]
    const before = structuredClone(source)
    for (const commands of batches) {
      expect(() => applyCommands(source, commands, context())).toThrow(/独立/)
    }
    expect(source).toEqual(before)
  })

  it('retains recursive cross-layer note locks and never persists synthetic entity lock flags', () => {
    const old = apply(layerScene(), { type: 'createLayer', id: 'notes-layer', floorId, name: '注记' })
    old.notes.first = { id: 'first', floorId, editLocked: false, visibility: 'gm', kind: 'note', text: 'first', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
    old.notes.second = { id: 'second', floorId, editLocked: false, visibility: 'gm', kind: 'note', text: 'second', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    old.entityLayers.first = old.entityLayers.item
    old.entityLayers.second = 'notes-layer'
    old.userLayers['notes-layer'].editLocked = true
    const source = old, before = structuredClone(source)
    const move: SceneCommand = { type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } }
    expect(() => apply(source, move)).toThrow(/锁定/)
    expect(source).toEqual(before)
    const unlocked = apply(source, { type: 'setLayerLock', id: 'notes-layer', locked: false })
    const next = apply(unlocked, move)
    expect(next.props.item.editLocked).toBe(false)
    expect(next.notes.second.editLocked).toBe(false)
    expect(next.props.item.rotationDeg).toBe(90)
  })

  it('blocks a shared-wall edit when supported furniture on another layer is locked', () => {
    let old = apply(blank(), createRoom('a'), createRoom('b', rectangle(7000, 1000)))
    old = apply(old, { type: 'createLayer', id: 'furniture', floorId, name: '家具' })
    old.props.supported = { ...symbolProp('supported', 4000, 4000), supportRef: { kind: 'room', id: 'a' }, roomId: 'a' }
    old.entityLayers.supported = 'furniture'
    old.userLayers.furniture.editLocked = true
    const source = old, before = structuredClone(source), wall = verticalWall(source, 7000)
    expect(validateSceneDocument(source).ok).toBe(true)
    const command: SceneCommand = { type: 'setWallThickness', id: wall.id, thicknessMm: 300 }
    expect(() => apply(source, command)).toThrow(/锁定/)
    expect(source).toEqual(before)
  })

  it('uses injected placement IDs and checks the explicit support layer independently from the target layer', () => {
    const old = apply(scatterLayerScene(0), { type: 'createLayer', id: 'target', floorId, name: '放置' })
    const source = old, options = { layerId: 'target', supportRef: { kind: 'terrainArea' as const, id: 'domain' } }
    const ghost = createPlacedProp(source, 'scatter-definition', { x: 3000, y: 3000 }, context(), options)
    expect(ghost.id).toBe('prepared-0')
    source.userLayers[source.entityLayers.domain].editLocked = true
    const before = structuredClone(source)
    expect(() => createPlacedProp(source, 'scatter-definition', ghost.positionMm, context(), options)).toThrow(/锁定/)
    expect(source).toEqual(before)
  })

  it('charges every prefab member and intermediate transformation even when the final geometry would cancel out', () => {
    const source = fullPrefab(), before = structuredClone(source), group = source.prefabInstances.group
    expect(validateSceneDocument(source).ok).toBe(true)
    const moved = { x: group.anchorMm.x + 1000, y: group.anchorMm.y }
    const one = apply(source, { type: 'transformPrefab', id: group.id, anchorMm: moved })
    expect(Object.values(one.prefabInstances.group.members).filter(member => member.propId !== null)).toHaveLength(127)
    expect(one.props['prefab-prop-0'].positionMm.x).toBe(source.props['prefab-prop-0'].positionMm.x + 1000)
    // Each step expands the 127 props and parent through current accounting. Two raw commands exceed 256.
    expect(() => apply(source,
      { type: 'transformPrefab', id: group.id, anchorMm: moved },
      { type: 'transformPrefab', id: group.id, anchorMm: group.anchorMm },
    )).toThrow(/256/)
    expect(source).toEqual(before)
  })

  it('applies outdoor geometry changes and exposes native intermediate drafts without losing layers', () => {
    const source = blank(), observations: SceneDocument[] = []
    const commands: SceneCommand[] = [
      { type: 'createTerrainArea', id: 'area', floorId, boundaryMm: rectangle(1000, 1000, 8000, 8000) },
      { type: 'createPath', id: 'path', floorId, centerlineMm: [{ x: 2500, y: 3000 }, { x: 7500, y: 3000 }], widthMm: 400, supportRefs: [{ kind: 'terrainArea', id: 'area' }] },
      { type: 'moveTerrainPoint', areaId: 'area', pointId: 'area:point:1', positionMm: { x: 9500, y: 1000 } },
    ]
    const next = applyCommands(source, commands, context(), { onOutdoorDraft: draft => observations.push(structuredClone(draft)) })
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
    const source = scatterLayerScene(1), before = structuredClone(source)
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
