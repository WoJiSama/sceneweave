import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from './shore-blank.js'
import { applyCommands } from '../../../shared/commands/commands.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { resolveBuildingEntrancePort } from '../../../shared/generation/building-port.js'
import { checkTerrainRoute } from '../../../shared/geometry/terrain-travel.js'
import { planOutpostEntranceRoad } from './outpost-roads.js'

const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function fixture() {
  const source = createShoreBlankDocument('island', { sceneId: 'outpost-road', title: '哨站入口道路', now: '2026-11-10T00:00:00.000Z', widthMm: 20000, heightMm: 26000, preset: 'narrative' })
  let sequence = 0
  const runtime = { clock: { now: () => source.updatedAt }, ids: { nextId: () => `outpost-road-${++sequence}` } }
  let document = applyCommands(source, [
    { type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(0, 0, 20000, 26000), groundElevationMm: 0, coveragePriority: 0 },
    { type: 'createRoom', id: 'watch-room', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(4000, 3500, 5500, 8000), thicknessMm: 220, supportRef: { kind: 'terrainArea', id: 'ground' } },
  ], runtime)
  const wall = Object.values(document.walls).find(wall => document.vertices[wall.startVertexId].yMm === 11500 && document.vertices[wall.endVertexId].yMm === 11500)!
  const reference = [wall.startVertexId, wall.endVertexId].find(id => document.vertices[id].xMm === 9500)!
  document = applyCommands(document, [{ type: 'addOpening', id: 'watch-entrance', wallId: wall.id, offsetReferenceVertexId: reference, offsetMm: 2050, widthMm: 1400, kind: 'door', state: 'open' }], runtime)
  return { document, runtime, wall }
}
const join = { x: 11500, y: 20000 }, via = [{ x: 6750, y: 14600 }, { x: 8700, y: 17500 }]
const plan = (document: ReturnType<typeof fixture>['document']) => planOutpostEntranceRoad(document, 'watch-entrance', 1400, join, via)

describe('new outpost roads from actual exterior doorway geometry', () => {
  it('starts at the actual outside anchor and validates the full doorway and road without changing inputs', () => {
    const { document } = fixture(), before = canonicalJson(document), originalVia = canonicalJson(via), result = plan(document)
    expect(result.pointsMm).toEqual([{ x: 6750, y: 12311 }, ...via, join])
    expect(result.supportRefs).toEqual([{ kind: 'terrainArea', id: 'ground' }])
    const port = resolveBuildingEntrancePort(document, 'watch-entrance', 1400)
    expect(checkTerrainRoute(document, { floorId: port.floorId, pointsMm: [port.insideMm, ...result.pointsMm], widthMm: 1400 }).ok).toBe(true)
    result.pointsMm[1].x = 1; result.supportRefs[0].id = 'changed'
    expect(canonicalJson(document)).toBe(before); expect(canonicalJson(via)).toBe(originalVia)
    expect(plan(document).pointsMm[0]).toEqual(port.outsideMm)
  })
  it('recomputes the start when wall thickness or the adopted door position changes', () => {
    const { document, wall } = fixture(), changed = cloneJson(document)
    changed.walls[wall.id].thicknessMm = 400
    expect(plan(changed).pointsMm[0]).toEqual({ x: 6750, y: 12401 })
    changed.openings['watch-entrance'].offsetMm += 300
    const result = planOutpostEntranceRoad(changed, 'watch-entrance', 1400, join, [{ x: 6450, y: 14600 }, via[1]])
    expect(result.pointsMm[0]).toEqual({ x: 6450, y: 12401 })
    expect(() => plan(changed)).toThrow(/首段/)
  })
  it('refuses a blocked road strip without moving or deleting the obstacle', () => {
    const { document, runtime } = fixture()
    const blocked = applyCommands(document, [{ type: 'createRegion', id: 'road-obstacle', floorId: 'visual-floor', layerId: 'visual-layer-ground', kind: 'hazard', visibility: 'public',
      boundaryMm: rectangle(6800, 16000, 2000, 1000), blocksMovement: true, movementCostMultiplier: 1 }], runtime)
    const before = canonicalJson(blocked)
    expect(() => plan(blocked)).toThrow(/完整带区不通.*阻挡/)
    expect(canonicalJson(blocked)).toBe(before)
  })
  it('refuses hidden, closed, locked or narrower doorways without changing their state', () => {
    const { document } = fixture()
    for (const changes of [{ state: 'closed' as const }, { locked: true }, { secret: true, revealed: false }, { widthMm: 1300 }]) {
      const changed = cloneJson(document); Object.assign(changed.openings['watch-entrance'], changes)
      const before = canonicalJson(changed)
      expect(() => plan(changed)).toThrow(/打开|上锁|可见|净宽不足/)
      expect(canonicalJson(changed)).toBe(before)
    }
  })
  it('rejects an inward or diagonal departure and invalid or excessive route points', () => {
    const { document } = fixture()
    for (const first of [{ x: 6750, y: 12000 }, { x: 6850, y: 14600 }]) {
      expect(() => planOutpostEntranceRoad(document, 'watch-entrance', 1400, join, [first])).toThrow(/首段/)
    }
    expect(() => planOutpostEntranceRoad(document, 'watch-entrance', 1400, { x: 11500.5, y: 20000 }, via)).toThrow(/整数/)
    expect(() => planOutpostEntranceRoad(document, 'watch-entrance', 1400, join, [via[0], ...Array.from({ length: 127 }, (_, index) => ({ x: 6750, y: 15000 + index }))])).toThrow(/128/)
  })
  it('rejects private route support even where the physical corridor remains walkable', () => {
    const { document, runtime } = fixture()
    const changed = applyCommands(document, [{ type: 'createTerrainArea', id: 'private-ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(9000, 18000, 4000, 4000), groundElevationMm: 0, coveragePriority: 1, visibility: 'gm' }], runtime)
    expect(() => plan(changed)).toThrow(/公开真实地形支撑/)
  })
})
