import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../commands/commands.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { resolveBuildingEntrancePort, resolveBuildingStructurePort } from './building-port.js'
import { BuildingEntranceRoadError, planBuildingEntranceRoad } from './building-entrance-road.js'

const p = (x: number, y: number) => ({ x, y })
const rect = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
function fixture(side: 'top' | 'right' | 'bottom' | 'left' = 'top', reverseInput = false) {
  const source = createShoreBlankDocument('island', { sceneId: 'ordinary-building-road', title: '普通建筑接路', now: '2026-11-10T00:00:00.000Z', widthMm: 30000, heightMm: 30000, preset: 'narrative' })
  let sequence = 0
  const runtime = { clock: { now: () => source.updatedAt }, ids: { nextId: () => `ordinary-building-${++sequence}` } }
  const boundary = rect(10000, 10000, 6000, 6000)
  let document = applyCommands(source, [
    { type: 'createTerrainArea', id: 'ordinary-ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rect(0, 0, 30000, 30000), groundElevationMm: 1200, coveragePriority: 0 },
    { type: 'createRoom', id: 'ordinary-room', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: reverseInput ? boundary.reverse() : boundary, thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ordinary-ground' } },
  ], runtime)
  const wall = Object.values(document.walls).find(row => {
    const a = document.vertices[row.startVertexId], b = document.vertices[row.endVertexId]
    return side === 'top' ? a.yMm === 10000 && b.yMm === 10000 : side === 'bottom' ? a.yMm === 16000 && b.yMm === 16000
      : side === 'left' ? a.xMm === 10000 && b.xMm === 10000 : a.xMm === 16000 && b.xMm === 16000
  })!
  document = applyCommands(document, [{ type: 'addOpening', id: 'ordinary-door', wallId: wall.id,
    offsetReferenceVertexId: reverseInput ? wall.endVertexId : wall.startVertexId, offsetMm: 2400, widthMm: 1200, kind: 'door', state: 'open' }], runtime)
  const port = resolveBuildingEntrancePort(document, 'ordinary-door', 1000), nx = Math.round(Math.cos(port.directionDeg * Math.PI / 180)), ny = Math.round(Math.sin(port.directionDeg * Math.PI / 180))
  const via = [p(port.outsideMm.x + nx * 2000, port.outsideMm.y + ny * 2000)]
  const join = p(port.outsideMm.x + nx * 5000 - ny * 2000, port.outsideMm.y + ny * 5000 + nx * 2000)
  return { document, runtime, port, via, join, wall }
}

describe('neutral current building entrance road plans', () => {
  it.each(['top', 'right', 'bottom', 'left'] as const)('uses arbitrary %s door geometry in either input ring direction and preserves explicit waypoints', side => {
    for (const reverseInput of [false, true]) {
      const f = fixture(side, reverseInput), before = canonicalJson(f.document), waypoints = canonicalJson(f.via)
      const plan = planBuildingEntranceRoad(f.document, 'ordinary-door', 1000, f.join, f.via)
      expect(plan.pointsMm).toEqual([f.port.outsideMm, ...f.via, f.join])
      expect(plan.supportRefs).toEqual([{ kind: 'terrainArea', id: 'ordinary-ground' }])
      expect(checkTerrainRoute(f.document, { floorId: f.port.floorId, widthMm: 1000, pointsMm: [f.port.insideMm, ...plan.pointsMm] }).ok).toBe(true)
      plan.pointsMm[1].x++; plan.supportRefs[0].id = 'detached-result'
      expect(canonicalJson(f.document)).toBe(before); expect(canonicalJson(f.via)).toBe(waypoints)
    }
  })

  it('keeps closed/door-locked structural ports but refuses current route creation', () => {
    const f = fixture()
    for (const changes of [{ state: 'closed' as const }, { locked: true }, { state: 'closed' as const, locked: true }]) {
      const document = cloneJson(f.document); Object.assign(document.openings['ordinary-door'], changes)
      const before = canonicalJson(document)
      expect(resolveBuildingStructurePort(document, 'ordinary-door', 1000)).toEqual(f.port)
      expect(() => planBuildingEntranceRoad(document, 'ordinary-door', 1000, f.join, f.via)).toThrow(/已打开且未上锁/)
      expect(canonicalJson(document)).toBe(before)
    }
  })

  it('rechecks actual outside depth after wall thickness, width and door-position edits', () => {
    const f = fixture(), document = cloneJson(f.document)
    document.walls[f.wall.id].thicknessMm = 600
    const port = resolveBuildingEntrancePort(document, 'ordinary-door', 1000)
    expect(port.outsideMm.y).toBe(f.port.outsideMm.y - 100)
    document.openings['ordinary-door'].offsetMm += 200
    const moved = resolveBuildingEntrancePort(document, 'ordinary-door', 1001)
    const plan = planBuildingEntranceRoad(document, 'ordinary-door', 1001, p(moved.outsideMm.x, moved.outsideMm.y - 4000))
    expect(plan.pointsMm[0]).toEqual(moved.outsideMm)
    expect(() => planBuildingEntranceRoad(document, 'ordinary-door', 1000, f.join, f.via)).toThrow(/首段/)
  })

  it('rejects a full-width doorway or route obstacle without moving it', () => {
    for (const doorway of [true, false]) {
      const f = fixture(), y = doorway ? 9900 : 7500
      const document = applyCommands(f.document, [{ type: 'createRegion', id: 'explicit-blocker', floorId: 'visual-floor', layerId: 'visual-layer-ground',
        kind: 'hazard', boundaryMm: rect(13200, y, 1000, 300), blocksMovement: true }], f.runtime), before = canonicalJson(document)
      try { planBuildingEntranceRoad(document, 'ordinary-door', 1000, f.join, f.via); throw new Error('expected rejection') }
      catch (error) {
        expect(error).toBeInstanceOf(BuildingEntranceRoadError)
        expect((error as BuildingEntranceRoadError).code).toBe(doorway ? 'doorway-blocked' : 'route-blocked')
        expect((error as Error).message).not.toContain('哨站')
      }
      expect(canonicalJson(document)).toBe(before)
    }
  })

  it('rejects inward/diagonal departures, noninteger coordinates and the true point budget', () => {
    const f = fixture(), start = f.port.outsideMm
    for (const via of [[p(start.x, start.y + 100)], [p(start.x + 100, start.y - 2000)]]) {
      expect(() => planBuildingEntranceRoad(f.document, 'ordinary-door', 1000, f.join, via)).toThrow(/首段/)
    }
    expect(() => planBuildingEntranceRoad(f.document, 'ordinary-door', 1000, p(f.join.x + .5, f.join.y), f.via)).toThrow(/整数/)
    expect(() => planBuildingEntranceRoad(f.document, 'ordinary-door', 1000, f.join,
      [f.via[0], ...Array.from({ length: 127 }, (_, index) => p(start.x, start.y - 3000 - index))])).toThrow(/128/)
  })

  it('rejects a private same-height support while leaving the supplied route and secrets untouched', () => {
    const f = fixture(), document = applyCommands(f.document, [{ type: 'createTerrainArea', id: 'private-route-support', floorId: 'visual-floor',
      layerId: 'visual-layer-ground', boundaryMm: rect(f.join.x - 1000, f.join.y - 1000, 2000, 2000), groundElevationMm: 1200, coveragePriority: 1, visibility: 'gm' }], f.runtime)
    const before = canonicalJson(document)
    expect(() => planBuildingEntranceRoad(document, 'ordinary-door', 1000, f.join, f.via)).toThrow(/公开真实地形支撑/)
    expect(canonicalJson(document)).toBe(before)
  })
})
