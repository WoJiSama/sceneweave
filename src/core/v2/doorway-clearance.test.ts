import { describe, expect, it } from 'vitest'
import { createHouse } from '../seed'
import { applyCommandsV2 } from './commands'
import { assertDoorwayClearancesV2, type DoorwayFixtureV2 } from './doorway-clearance'
import { migrateSceneV1 } from './migration'
import { validateSceneV2 } from './schema'
import type { PropV2, SceneDocumentV2 } from './types'

const fixture: DoorwayFixtureV2[] = [{ openingId: 'door', minWidthMm: 1200, approachDepthMm: 1500 }]
function scene(): SceneDocumentV2 {
  const original = createHouse('source')
  original.vertices = {}; original.rooms = {}; original.walls = {}; original.openings = {}; original.props = {}; original.notes = {}; original.regions = {}; original.constraints.entranceOpeningIds = []
  original.floors['f-a1'].boundsMm = { x: 0, y: 0, width: 12000, height: 12000 }
  const document = migrateSceneV1(original, { sceneId: 'doorway-test', now: '2026-10-20T00:00:00.000Z' })
  document.vertices.a = { id: 'a', floorId: 'f-a1', editLocked: false, xMm: 3000, yMm: 6000 }
  document.vertices.b = { id: 'b', floorId: 'f-a1', editLocked: false, xMm: 9000, yMm: 6000 }
  document.walls.wall = { id: 'wall', floorId: 'f-a1', editLocked: false, startVertexId: 'a', endVertexId: 'b', thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
  document.openings.door = { id: 'door', floorId: 'f-a1', editLocked: false, wallId: 'wall', offsetReferenceVertexId: 'a', offsetMm: 2000, widthMm: 1200, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
  return document
}
function prop(id: string, x: number, y: number): PropV2 {
  return { id, floorId: 'f-a1', editLocked: false, visibility: 'public', definitionRef: null, appearance: { kind: 'symbol', symbol: 'chair', opacity: 1, tint: null }, visualBoundsMm: { x: -300, y: -300, width: 600, height: 600 }, positionMm: { x, y }, rotationDeg: 0, footprintMm: { width: 600, height: 600 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: true, blocksSight: false, supportRef: { kind: 'floor', id: 'f-a1' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
}
function wall(document: SceneDocumentV2, id: string, a: [number, number], b: [number, number], thicknessMm = 200) {
  for (const [key, value] of [[`${id}-a`, a], [`${id}-b`, b]] as const) document.vertices[key] = { id: key, floorId: 'f-a1', editLocked: false, xMm: value[0], yMm: value[1] }
  document.walls[id] = { id, floorId: 'f-a1', editLocked: false, startVertexId: `${id}-a`, endVertexId: `${id}-b`, thicknessMm, blocksMovement: true, blocksSight: true, topStyle: null }
}

describe('finite current-geometry doorway clearances', () => {
  it('exempts the actual doorway interval from its own thick wall and preserves the source', () => {
    const document = scene(), before = structuredClone(document)
    expect(() => assertDoorwayClearancesV2(document, fixture)).not.toThrow()
    document.walls.wall.thicknessMm = 1800
    expect(() => assertDoorwayClearancesV2(document, fixture)).not.toThrow()
    document.walls.wall.thicknessMm = 200
    expect(document).toEqual(before)
  })
  it('uses complete rotated footprints, including GM objects and offset footprints whose centres lie outside', () => {
    const document = scene(); document.props.chair = prop('chair', 6550, 6600)
    expect(() => assertDoorwayClearancesV2(document, fixture)).not.toThrow()
    document.props.chair.rotationDeg = 45; document.props.chair.visibility = 'gm'
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/chair/)
    document.props.chair.rotationDeg = 0; document.props.chair.footprintOffsetMm.x = -100
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/chair/)
  })
  it('allows exact boundary touching and nonblocking decorations without using image transparency as occupancy', () => {
    const document = scene(); document.props.touch = prop('touch', 6500, 6600)
    expect(() => assertDoorwayClearancesV2(document, fixture)).not.toThrow()
    document.props.touch.positionMm.x = 6499
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/touch/)
    document.props.touch.blocksMovement = false
    expect(() => assertDoorwayClearancesV2(document, fixture)).not.toThrow()
    document.props.touch.blocksMovement = true
    document.props.touch.visualBoundsMm = { x: 3000, y: 3000, width: 10, height: 10 }
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/touch/)
  })
  it('follows a moved door and reversed wall instead of preserving baseline world rectangles', () => {
    const document = scene(); document.props.oldApproach = prop('oldApproach', 4500, 7000)
    const moved = applyCommandsV2(document, [
      { type: 'moveVertex', id: 'a', positionMm: { x: 4500, y: 6000 } },
      { type: 'moveVertex', id: 'b', positionMm: { x: 10500, y: 6000 } },
      { type: 'reverseWall', id: 'wall' },
    ])
    expect(() => assertDoorwayClearancesV2(moved, fixture)).not.toThrow()
    moved.props.oldApproach.positionMm.x = 7000
    expect(() => assertDoorwayClearancesV2(moved, fixture)).toThrow(/oldApproach/)
  })
  it('measures a slanted doorway and its normal-depth corridor with actual along-wall units', () => {
    const document = scene()
    document.vertices.b = { ...document.vertices.b, xMm: 9000, yMm: 9000 }
    document.props.p = prop('p', 5200, 7300)
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/p/)
    document.props.p.positionMm = { x: 9000, y: 9000 }
    expect(() => assertDoorwayClearancesV2(document, fixture)).not.toThrow()
  })
  it('detects actual blocking wall bands, permits nonblocking walls, and honors other structural door gaps', () => {
    const document = scene()
    wall(document, 'other', [4500, 7000], [7000, 7000])
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/other/)
    document.walls.other.blocksMovement = false
    expect(() => assertDoorwayClearancesV2(document, fixture)).not.toThrow()
    document.walls.other.blocksMovement = true
    document.openings.otherDoor = { ...document.openings.door, id: 'otherDoor', wallId: 'other', offsetReferenceVertexId: 'other-a', offsetMm: 300, widthMm: 1700 }
    expect(() => assertDoorwayClearancesV2(document, fixture)).not.toThrow()
    document.openings.otherDoor.kind = 'window'
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/other/)
  })
  it('detects miter joins entering a corridor even when both individual wall bands stay outside it', () => {
    const document = scene()
    wall(document, 'horizontal', [6300, 4400], [8000, 4400], 400)
    wall(document, 'vertical', [6300, 3000], [6300, 4400], 400)
    document.walls.vertical.endVertexId = 'horizontal-a'; delete document.vertices['vertical-b']
    expect(validateSceneV2(document).ok).toBe(true)
    // Bands: horizontal x>=6300, vertical y<=4400. The 400 mm miter
    // enters x6100..6200/y4500..4600 of this x5000..6200/y4500..7500 corridor.
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/horizontal.*vertical/)
  })
  it('checks the full declared width, the minimum threshold and floor world bounds', () => {
    const document = scene()
    document.openings.door.widthMm = 1199
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/净宽不足/)
    document.openings.door.widthMm = 1800; document.props.side = prop('side', 6600, 6600)
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/side/)
    delete document.props.side
    expect(() => assertDoorwayClearancesV2(document, [{ ...fixture[0], approachDepthMm: 7000 }])).toThrow(/世界边界/)
  })
  it('rejects unsupported or malformed fixtures and checks structural potential independently of the door leaf state', () => {
    const document = scene()
    document.openings.door.state = 'closed'; document.openings.door.locked = true
    expect(() => assertDoorwayClearancesV2(document, fixture)).not.toThrow()
    expect(() => assertDoorwayClearancesV2(document, [{ ...fixture[0], openingId: 'absent' }])).toThrow(/现存的门/)
    document.openings.door.kind = 'window'
    expect(() => assertDoorwayClearancesV2(document, fixture)).toThrow(/现存的门/)
    expect(() => assertDoorwayClearancesV2(document, [fixture[0], fixture[0]])).toThrow(/配置无效/)
    expect(() => assertDoorwayClearancesV2(document, [{ ...fixture[0], approachDepthMm: 1.5 }])).toThrow(/正整数毫米/)
  })
})
