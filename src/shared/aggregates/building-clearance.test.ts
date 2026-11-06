import { describe, expect, it } from 'vitest'
import { fixture as workspaceFixture } from '../../application/workspace/test-fixtures.js'
import type { AggregateEntityRef } from '../model/aggregate.js'
import type { Path, PointMm, SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { assertAggregateBuildingClearance } from './building-clearance.js'

const point = (x: number, y: number): PointMm => ({ x, y })
function fixture() {
  const scene = workspaceFixture({ building: true }).project.document
  delete scene.props.other; delete scene.entityLayers.other
  scene.props.item.positionMm = point(6000, 6000)
  scene.props.item.supportRef = { kind: 'room', id: 'room' }; scene.props.item.roomId = 'room'
  scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0',
    offsetMm: 2500, widthMm: 1000, kind: 'door', state: 'closed', locked: true, secret: true, revealed: false }
  scene.entityLayers.door = scene.entityLayers.room
  const members: AggregateEntityRef[] = [
    ...Object.keys(scene.vertices).map(id => ({ kind: 'vertex' as const, id })),
    ...Object.keys(scene.walls).map(id => ({ kind: 'wall' as const, id })),
    { kind: 'room', id: 'room' }, { kind: 'prop', id: 'item' }, { kind: 'opening', id: 'door' },
  ]
  return { scene, members }
}
function addPath(scene: SceneDocument, id: string, centerlineMm: PointMm[], widthMm: number, floorId = 'blank-floor'): Path {
  const path: Path = { id, floorId, editLocked: false, visibility: 'public', centerlineMm, widthMm,
    supportRefs: [{ kind: 'floor', id: floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  scene.paths[id] = path; scene.entityLayers[id] = scene.entityLayers.room
  return path
}
function addBlocker(scene: SceneDocument, id: string, positionMm: PointMm) {
  scene.props[id] = { ...cloneJson(scene.props.item), id, positionMm, supportRef: { kind: 'floor', id: 'blank-floor' }, blocksMovement: true }
  delete scene.props[id].roomId
  scene.entityLayers[id] = scene.entityLayers.item
  return scene.props[id]
}

describe('finite exact clearance across a transformed building boundary', () => {
  it('allows an exact full-width structural doorway and preserves its closed/locked/secret state', () => {
    const { scene, members } = fixture()
    addPath(scene, 'door-road', [point(6000, 2000), point(6000, 4000)], 1000)
    const before = canonicalJson(scene)
    expect(() => assertAggregateBuildingClearance(scene, members)).not.toThrow()
    expect(canonicalJson(scene)).toBe(before)
    expect(scene.openings.door).toMatchObject({ state: 'closed', locked: true, secret: true, revealed: false })
  })

  it('rejects a full-width road clipping the actual jamb, while leaving the source untouched', () => {
    const { scene, members } = fixture()
    addPath(scene, 'jamb-road', [point(6100, 2000), point(6100, 4000)], 1000)
    const before = canonicalJson(scene)
    expect(() => assertAggregateBuildingClearance(scene, members)).toThrow(/整栋.*jamb-road.*wall-0/)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('checks a true miter extension beyond the centreline half-thickness bounding box', () => {
    const { scene, members } = fixture()
    scene.vertices['vertex-2'].xMm = 7000; scene.vertices['vertex-2'].yMm = 9000
    scene.walls['wall-0'].thicknessMm = 400; scene.walls['wall-1'].thicknessMm = 400
    // The rightmost wall centreline is 10000 and both half-widths are 200.
    // Only the actual corner miter reaches this entire road above x=10200.
    addPath(scene, 'corner-road', [point(10240, 2820), point(10260, 2820)], 40)
    expect(() => assertAggregateBuildingClearance(scene, members)).toThrow(/整栋.*corner-road.*wall-0、wall-1/)
  })

  it('uses rotated footprint offsets instead of a large image rectangle for external objects', () => {
    const { scene, members } = fixture(), blocker = addBlocker(scene, 'tree', point(12000, 6000))
    blocker.visualBoundsMm = { x: -13000, y: -5000, width: 16000, height: 10000 }
    expect(() => assertAggregateBuildingClearance(scene, members)).not.toThrow()
    blocker.footprintOffsetMm = point(2500, 0); blocker.rotationDeg = 180
    expect(() => assertAggregateBuildingClearance(scene, members)).toThrow(/整栋.*room.*tree/)
  })

  it('rejects an external blocking region inside the building and keeps unrelated existing road obstacles out of scope', () => {
    const { scene, members } = fixture()
    addPath(scene, 'remote-road', [point(15000, 15000), point(17000, 15000)], 800)
    addBlocker(scene, 'remote-rock', point(16000, 15000))
    expect(() => assertAggregateBuildingClearance(scene, members)).not.toThrow()
    scene.regions.lava = { id: 'lava', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'hazard',
      boundaryMm: [point(4000, 4000), point(5000, 4000), point(5000, 5000), point(4000, 5000)], blocksMovement: true, movementCostMultiplier: 2 }
    expect(() => assertAggregateBuildingClearance(scene, members)).toThrow(/整栋.*room.*lava/)
  })

  it('checks the finite outer door approach even when the blocker is clear of the actual wall and room', () => {
    const { scene, members } = fixture()
    addBlocker(scene, 'doorstep', point(6000, 2500))
    expect(() => assertAggregateBuildingClearance(scene, members)).toThrow(/整栋.*门前净空.*door.*doorstep/)
  })

  it('checks moving room paths and blocking furniture against their opposite-side geometry', () => {
    const { scene, members } = fixture()
    addPath(scene, 'door-road', [point(6000, 2000), point(6000, 4000)], 1000)
    scene.props.item.positionMm = point(6000, 3500); scene.props.item.blocksMovement = true
    expect(() => assertAggregateBuildingClearance(scene, members)).toThrow(/整栋.*door-road.*item/)

    const internal = fixture()
    const path = addPath(internal.scene, 'room-path', [point(4000, 5000), point(8000, 5000)], 400)
    path.supportRefs = [{ kind: 'room', id: 'room' }]
    addBlocker(internal.scene, 'external-rock', point(7000, 5000))
    // Exercise the route predicate independently; membership completeness is
    // established by the command owner before this geometry-only helper runs.
    expect(() => assertAggregateBuildingClearance(internal.scene, [{ kind: 'path', id: 'room-path' }]))
      .toThrow(/整栋.*路线.*room-path.*external-rock/)
  })

  it('keeps positive-area contact and Floor separation exact for foreign geometry', () => {
    const { scene, members } = fixture(), touching = addBlocker(scene, 'touching-rock', point(10100, 6000))
    scene.walls['wall-1'].blocksMovement = false
    expect(() => assertAggregateBuildingClearance(scene, members)).not.toThrow()
    touching.positionMm.x = 10099
    expect(() => assertAggregateBuildingClearance(scene, members)).toThrow(/整栋.*touching-rock/)
    touching.floorId = 'another-floor'
    scene.floors['another-floor'] = { id: 'another-floor', name: 'another floor', boundsMm: { x: 0, y: 0, width: 20000, height: 20000 } }
    addPath(scene, 'other-floor-road', [point(4000, 3000), point(9000, 3000)], 1000, 'another-floor')
    expect(() => assertAggregateBuildingClearance(scene, members)).not.toThrow()
  })
})
