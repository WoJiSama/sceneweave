import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { resolvePropContact } from '../attachments/contact.js'
import { propTopSnap } from '../attachments/prop-top-snap.js'
import { buildingAggregateMembers, inspectAggregateBuilding, previewBuildingCommands } from '../commands/building.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { createFurnitureRoomQuery } from '../geometry/furniture-room.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import type { SceneDocument } from '../model/scene.js'
import { planFurnitureMove } from './room-move.js'
import { roomFurnitureIds } from './room-members.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'

const floorId = 'blank-floor'
function house() {
  const scene = fixture({ building: true, image: true }).project.document
  scene.props.item.positionMm = { x: 1000, y: 1000 }
  scene.props.other.positionMm = { x: 1500, y: 1500 }
  return scene
}
function group(scene: SceneDocument, roomId = 'room', id = 'house') {
  return applyCommands(scene, [{ type: 'createAggregateGroup', group: { id, floorId, parentId: null,
    frame: { translationMm: { x: 3000, y: 3000 }, quarterTurns: 0 }, editLocked: false, members: buildingAggregateMembers(scene, roomId) } }], runtime)
}
function add(id: string, x: number, y: number): Extract<SceneCommand, { type: 'addProp' }> {
  return { type: 'addProp', id, floorId, positionMm: { x, y }, definitionRef: { id: 'definition', version: 1 } }
}
function destination(scene: SceneDocument, id: string, x: number, y: number) {
  return planFurnitureMove(scene, scene.prefabInstances[id] ? { type: 'transformPrefab', id, anchorMm: { x, y } }
    : { type: 'updateProp', id, changes: { positionMm: { x, y } } }, createFurnitureRoomQuery(scene, floorId))
}
const translate: SceneCommand = { type: 'transformAggregateBuilding', id: 'house', offsetMm: { x: 1000, y: 0 }, pivotMm: { x: 0, y: 0 }, quarterTurns: 0 }
function kitchen(scene: SceneDocument, left: number, visibility: 'gm' | 'public' = 'public') {
  return applyCommands(scene, [{ type: 'createRoom', id: 'kitchen', floorId, thicknessMm: 200, purpose: '厨房', visibility,
    boundaryMm: [{ x: left, y: 3000 }, { x: 18000, y: 3000 }, { x: 18000, y: 10000 }, { x: left, y: 10000 }] }], runtime)
}

describe('room furniture placement and membership', () => {
  it('adopts furniture in either creation order and respects an explicitly independent prop', () => {
    for (const furnitureFirst of [false, true]) {
      const initial = house(), chair = add('chair', 6000, 6000)
      const scene = furnitureFirst ? group(applyCommands(initial, [chair], runtime)) : applyCommands(group(initial), [chair], runtime)
      const furnished = applyCommands(scene, [{ ...add('rug', 7000, 6000), supportRef: { kind: 'floor', id: floorId } }], runtime)
      expect(furnished.props.chair.roomId).toBe('room')
      expect(furnished.props.rug.roomId).toBeUndefined()
      expect(destination(furnished, 'rug', 7200, 6000).type).toBe('updateProp')
      expect(inspectAggregateBuilding(furnished, 'house').members).toContainEqual({ kind: 'prop', id: 'chair' })
      const moved = applyCommands(furnished, [translate], runtime)
      expect(moved.props.chair.positionMm.x).toBe(7000)
      expect(moved.props.rug.positionMm.x).toBe(7000)
      expect(moved.props.item).toEqual(initial.props.item)
    }
  })

  it('uses the whole footprint, retains doorway ownership and only changes the room after clearing the threshold', () => {
    let scene = applyCommands(group(kitchen(house(), 10000)), [add('chair', 6000, 6000)], runtime)
    expect(destination(scene, 'chair', 6500, 6000).type).toBe('updateProp')
    const hidden = createFurnitureRoomQuery(scene, floorId, new Set(['room']))
    expect(planFurnitureMove(scene, { type: 'updateProp', id: 'chair', changes: { positionMm: { x: 6500, y: 6000 } } }, hidden).type).toBe('updateProp')
    const doorway = destination(scene, 'chair', 10000, 6000)
    expect(doorway).toMatchObject({ type: 'moveRoomFurniture', roomId: 'room', supportRef: { kind: 'floor', id: floorId } })
    scene = applyCommands(scene, [doorway], runtime)
    const chosen = applyCommands(scene, [{ type: 'moveRoomFurniture', id: 'chair', positionMm: scene.props.chair.positionMm,
      roomId: 'kitchen', supportRef: { kind: 'floor', id: floorId } }], runtime)
    expect(chosen.props.chair).toMatchObject({ roomId: 'kitchen', positionMm: scene.props.chair.positionMm })
    scene = applyCommands(scene, [destination(scene, 'chair', 13000, 6000)], runtime)
    expect(scene.props.chair).toMatchObject({ roomId: 'kitchen', supportRef: { kind: 'room', id: 'kitchen' } })
    expect(inspectAggregateBuilding(scene, 'house').members.filter(m => m.id === 'chair')).toHaveLength(1)
    scene = applyCommands(scene, [destination(scene, 'chair', 19000, 6000)], runtime)
    expect(scene.props.chair.roomId).toBeUndefined()
    expect(inspectAggregateBuilding(scene, 'house').members.some(m => m.id === 'chair')).toBe(false)
  })

  it('keeps an existing independent item in place when a wall is extended around it', () => {
    const source = house()
    source.props.item.positionMm = { x: 10500, y: 5000 }
    const expanded = applyCommands(group(source), [{ type: 'translateWall', id: 'wall-1', offsetMm: { x: 1000, y: 0 } }], runtime)
    expect(expanded.vertices['vertex-1'].xMm).toBe(11000)
    expect(expanded.props.item).toEqual(source.props.item)
    expect(inspectAggregateBuilding(expanded, 'house').members.some(ref => ref.id === 'item')).toBe(false)
    expect(applyCommands(expanded, [translate], runtime).props.item).toEqual(source.props.item)
  })

  it('reads fresh ownership for mutable drafts and protects a certified room index from its callers', () => {
    const source = house(), rooms = new Set(['room'])
    expect(roomFurnitureIds(source, rooms)).toEqual([])
    Object.assign(source.props.item, { positionMm: { x: 6000, y: 6000 }, supportRef: { kind: 'room', id: 'room' } })
    expect(roomFurnitureIds(source, rooms)).toEqual(['item'])
    const checked = validateSceneSnapshot(source)
    if (!checked.ok) throw new Error('Expected a valid room fixture')
    roomFurnitureIds(checked.document, rooms).pop()
    delete source.props.item
    expect(roomFurnitureIds(source, rooms)).toEqual([])
    expect(roomFurnitureIds(checked.document, rooms)).toEqual(['item'])
  })

  it('transfers direct room subgroup membership and keeps shared walls in the parent group', () => {
    let scene = group(kitchen(house(), 10000))
    const groups = scene.aggregateCoordinates!.groups
    for (const id of ['room', 'kitchen']) {
      groups[id + '-group'] = { ...structuredClone(groups.house), id: id + '-group', parentId: 'house', members: [{ kind: 'room', id }] }
      groups.house.members = groups.house.members.filter(ref => ref.id !== id)
    }
    scene = applyCommands(scene, [add('chair', 6000, 6000)], runtime)
    expect(scene.aggregateCoordinates!.groups['room-group'].members.map(ref => ref.id)).toContain('chair')
    scene = applyCommands(scene, [destination(scene, 'chair', 14000, 6000)], runtime)
    expect(scene.aggregateCoordinates!.groups['room-group'].members).toEqual([{ kind: 'room', id: 'room' }])
    expect(scene.aggregateCoordinates!.groups['kitchen-group'].members.map(ref => ref.id)).toContain('chair')
    expect(scene.aggregateCoordinates!.groups.house.members).toContainEqual({ kind: 'wall', id: 'wall-1' })
    expect(inspectAggregateBuilding(scene, 'house').members.filter(ref => ref.id === 'chair')).toHaveLength(1)
  })

  it('atomically transfers between separate existing buildings and preserves privacy when leaving a private room', () => {
    let scene = group(group(kitchen(house(), 12000, 'gm')), 'kitchen', 'annex')
    scene = applyCommands(scene, [add('chair', 6000, 6000)], runtime)
    const lock = structuredClone(scene)
    lock.aggregateCoordinates!.groups.annex.editLocked = true
    expect(() => applyCommands(lock, [destination(lock, 'chair', 14000, 6000)], runtime)).toThrow(/锁/)
    expect(lock.props.chair.roomId).toBe('room')
    scene = applyCommands(scene, [destination(scene, 'chair', 14000, 6000)], runtime)
    expect(inspectAggregateBuilding(scene, 'house').members.some(m => m.id === 'chair')).toBe(false)
    expect(inspectAggregateBuilding(scene, 'annex').members).toContainEqual({ kind: 'prop', id: 'chair' })
    scene = applyCommands(scene, [destination(scene, 'chair', 6000, 6000)], runtime)
    expect(createPublicVisibility(scene).prop(scene.props.chair)).toBe(false)
  })

  it('moves a table and its lamp once with the house and keeps the surface and local anchor across room transfers', () => {
    const scene = kitchen(house(), 12000)
    Object.assign(scene.props.item, { positionMm: { x: 6000, y: 6000 }, footprintMm: { width: 2000, height: 1400 }, roomId: 'room', supportRef: { kind: 'room', id: 'room' } })
    Object.assign(scene.props.other, { positionMm: { x: 6200, y: 6000 }, roomId: 'room', supportRef: { kind: 'room', id: 'room' } })
    let content = createCompositionContent(group(group(scene), 'kitchen', 'annex'), runtime)
    content = applyCompositionCommands(content, [{ type: 'addAttachmentSurface', id: 'top', owner: { kind: 'prop', id: 'item' }, capabilities: ['support'],
      feature: { kind: 'propTop', heightLocalMm: 800, polygonLocalMm: [{ x: -800, y: -500 }, { x: 800, y: -500 }, { x: 800, y: 500 }, { x: -800, y: 500 }] } },
    { type: 'bindPropAttachment', id: 'lamp-on-table', childId: 'other', surfaceId: 'top', mode: 'support', follow: 'follow', anchorState: 'manual',
      anchor: { kind: 'horizontal', localMm: { x: 200, y: 0 }, heightOffsetMm: 0, rotationOffsetDeg: 0 } }], runtime)
    expect(previewBuildingCommands(content.document, [translate]).reason).toBeNull()
    content = applyCompositionCommands(content, [translate], runtime)
    expect(content.document.props.other.positionMm).toEqual({ x: 7200, y: 6000 })
    content = applyCompositionCommands(content, [destination(content.document, 'item', 14000, 6000)], runtime)
    expect(content.document.props.other).toMatchObject({ positionMm: { x: 14200, y: 6000 }, roomId: 'kitchen' })
    expect(resolvePropContact(content.document, 'other')).toMatchObject({ actualSurfaceId: 'top', contactElevationMm: 800 })
    expect(inspectAggregateBuilding(content.document, 'annex').members.filter(m => m.kind === 'prop')).toHaveLength(2)
  })

  it('keeps an independent table usable in a room and inherits the table’s chosen room at a threshold', () => {
    const scene = kitchen(house(), 10000)
    Object.assign(scene.props.item, { positionMm: { x: 6000, y: 6000 }, footprintMm: { width: 1800, height: 1000 } })
    let content = applyCompositionCommands(createCompositionContent(scene, runtime), [
      { type: 'addAttachmentSurface', id: 'lid', owner: { kind: 'prop', id: 'item' }, capabilities: ['support'],
        feature: { kind: 'propTop', heightLocalMm: 800, polygonLocalMm: [{ x: -800, y: -400 }, { x: 800, y: -400 }, { x: 800, y: 400 }, { x: -800, y: 400 }] } },
    ], runtime)
    const root = propTopSnap(content.document, scene.props.other, { x: 6000, y: 6000 }, new Set(), { kind: 'room', id: 'room' })
    expect(root?.supportRef).toEqual({ kind: 'floor', id: floorId })
    content = applyCompositionCommands(content, [
      { type: 'moveRoomFurniture', id: 'item', positionMm: { x: 10000, y: 6000 }, roomId: 'room', supportRef: { kind: 'floor', id: floorId } },
      { type: 'bindPropAttachment', id: 'lamp', childId: 'other', surfaceId: 'lid', mode: 'support', follow: 'follow', anchorState: 'manual',
        anchor: { kind: 'horizontal', localMm: { x: 200, y: 0 }, heightOffsetMm: 0, rotationOffsetDeg: 0 } },
    ], runtime)
    expect(content.document.props.other).toMatchObject({ roomId: 'room', supportRef: { kind: 'floor', id: floorId } })
    expect(resolvePropContact(content.document, 'other')).toMatchObject({ actualSurfaceId: 'lid', contactElevationMm: 800 })
    const adjustLamp = destination(content.document, 'other', 10400, 6000)
    expect(adjustLamp.type).toBe('updateProp')
    const adjusted = applyCompositionCommands(content, [adjustLamp], runtime)
    expect(adjusted.document.props.other.roomId).toBe('room')
    expect(adjusted.document.attachments!.lamp).toMatchObject({ anchor: { localMm: { x: 400, y: 0 } } })
  })

  it('uses every rotated prefab member for automatic placement and carries the intact set between buildings', () => {
    const scene = kitchen(house(), 12000)
    scene.props.item.positionMm = { x: 1000, y: 1000 }
    scene.props.other.positionMm = { x: 2000, y: 1000 }
    let content = createCompositionContent(group(group(scene), 'kitchen', 'annex'), runtime)
    content = applyCompositionCommands(content, [{ type: 'createPrefab', id: 'source-set', definitionId: 'pair', name: '餐桌组', ids: ['item', 'other'], anchorMm: { x: 1000, y: 1000 } }], runtime)
    const members = content.document.prefabDefinitions.pair.members
    const place = (id: string, y: number) => ({ type: 'instantiatePrefab' as const, id, layerId: scene.entityLayers.item,
      memberIds: Object.fromEntries(members.map((m, i) => [m.key, id + i])), definitionRef: { id: 'pair', version: 1 }, anchorMm: { x: 7000, y }, rotationDeg: 90 })
    content = applyCompositionCommands(content, [place('straddling', 9500), place('dining', 5000)], runtime)
    expect(content.document.props.straddling0.roomId).toBeUndefined()
    expect(content.document.props.straddling1.roomId).toBeUndefined()
    expect(content.document.props.dining0.roomId).toBe('room')
    expect(content.document.props.dining1.roomId).toBe('room')
    const before = structuredClone(content.document.prefabInstances.dining.members)
    content = applyCompositionCommands(content, [destination(content.document, 'dining', 14500, 5000)], runtime)
    const owned = inspectAggregateBuilding(content.document, 'annex').members.map(m => m.id)
    expect(owned).toEqual(expect.arrayContaining(['dining', 'dining0', 'dining1']))
    expect(content.document.prefabInstances.dining.members).toEqual(before)
    expect(content.document.props.dining1.positionMm).toEqual({ x: 14500, y: 6000 })
  })

  it('can move an existing hand-made set with members in different rooms into one destination', () => {
    const scene = kitchen(house(), 10000)
    Object.assign(scene.props.item, { positionMm: { x: 9500, y: 5000 }, supportRef: { kind: 'room', id: 'room' } })
    Object.assign(scene.props.other, { positionMm: { x: 10500, y: 5000 }, supportRef: { kind: 'room', id: 'kitchen' } })
    let content = applyCompositionCommands(createCompositionContent(scene, runtime), [{ type: 'createPrefab', id: 'set', definitionId: 'pair',
      name: '手工家具组', ids: ['item', 'other'], anchorMm: { x: 10000, y: 5000 } }], runtime)
    content = applyCompositionCommands(content, [destination(content.document, 'set', 14000, 5000)], runtime)
    expect([content.document.props.item.roomId, content.document.props.other.roomId]).toEqual(['kitchen', 'kitchen'])
  })
})
