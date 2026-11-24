import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import type { Path, PointMm } from '../model/scene.js'
import { projectScene } from '../projection/projection.js'
import { AUTOMATIC_ROAD_VERSION, createAutomaticRoadPlanner, roadPointEquals } from './automatic-road.js'
import { ROAD_RISER_LIMIT_MM, ROAD_PPM, buildRoadSurface, roadSurfaceFrame, type RoadLanding } from './road-surface.js'
import { createSupportQuery } from './support-sample.js'
import { defaultStaircase } from '../stairs/contracts.js'
import { gradeRoadSurface } from './road-grading.js'
import { checkTerrainTravel } from './terrain-travel.js'
import { createTerrainRelief } from './terrain-relief.js'
import { polygonsOverlap } from './geometry.js'

const floorId = 'blank-floor'
const widthMm = 1200
const request = { floorId, widthMm, visibility: 'public' as const }
const point = (x: number, y: number) => ({ x, y })
const rectangle = (x: number, y: number, width: number, height: number) => [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)]

function emptyDocument() {
  const source = fixture().project.document
  const scene = applyCommands(source, Object.keys(source.props).map(id => ({ type: 'deleteProp', id })), runtime)
  scene.floors[floorId].boundsMm = scene.exportBoundsMm = { x: 0, y: 0, width: 42000, height: 33000 }
  return scene
}

function hillside() {
  const bounds = { x: 0, y: 0, width: 42000, height: 33000 }
  const relief = createTerrainRelief(bounds, ({ x, y }) => Math.min(8200, Math.max(0, (1 - Math.hypot((x - 22500) / 17500, (y - 16000) / 13200)) * 13900)), 600)
  return applyCommands(emptyDocument(), [{ type: 'createTerrainArea', id: 'hill', floorId, boundaryMm: rectangle(0, 0, 42000, 33000), relief }], runtime)
}

function obstruction(scene: ReturnType<typeof emptyDocument>, visibility: 'public' | 'gm', boundaryMm: PointMm[]) {
  return applyCommands(scene, [{ type: 'createRegion', id: 'obstruction', floorId, boundaryMm, kind: 'hazard', blocksMovement: true, visibility }], runtime)
}

describe('contextual automatic roads', () => {
  it('finds a gentler winding route and saves bounded risers only for the climb', () => {
    const scene = hillside(), plan = createAutomaticRoadPlanner(scene, request)
    const fixed = [point(4300, 16000), point(22500, 16000)]
    const result = plan(fixed)
    expect(result.centerlineMm.length).toBeGreaterThan(2)
    expect(result.lengthMm).toBeGreaterThan(19000)
    expect(result.geometry!.risers.length).toBeGreaterThan(10)
    expect(result.geometry!.risers.every(({ lower, upper }) => upper[1].z - lower[1].z <= ROAD_RISER_LIMIT_MM)).toBe(true)
    expect(result.geometry!.risers.at(-1)!.atPpm).toBeLessThan(ROAD_PPM * .96)
    expect(plan(fixed)).toEqual(result)
    expect(createAutomaticRoadPlanner(emptyDocument(), request)(fixed).geometry?.risers).toHaveLength(0)
    expect(result.supportRefs).toEqual([{ kind: 'terrainArea', id: 'hill' }])
  })

  it('retains the exact fixed point and untouched leg, supports removing one constraint, and round-trips the full route', () => {
    const scene = hillside(), plan = createAutomaticRoadPlanner(scene, request)
    const from = point(4300, 16000), to = point(22500, 16000)
    const original = plan([from, to])
    const bend = original.centerlineMm[1], fixed = { ...bend, y: bend.y - 150 }
    const pinned = plan([from, fixed, to], original)
    const movedStart = point(4000, 16000), moved = plan([movedStart, fixed, to], pinned)
    const retained = (points: PointMm[]) => points.slice(points.findIndex(p => roadPointEquals(p, fixed)))
    expect(retained(moved.centerlineMm)).toEqual(retained(pinned.centerlineMm))
    const tailRisers = (plan: typeof moved) => {
      const frame = roadSurfaceFrame({ ...plan, widthMm }), join = frame.length - retained(plan.centerlineMm).slice(1)
        .reduce((sum, p, i, points) => { const a = points[i - 1] ?? fixed; return sum + Math.hypot(p.x - a.x, p.y - a.y) }, 0)
      return plan.geometry!.risers.filter(riser => frame.distance(riser.atPpm) > join + 1200)
        .map(({ lower, upper, atPpm }) => ({ from: lower[1].z, to: upper[1].z, offset: frame.distance(atPpm) - join }))
    }
    const beforeTail = tailRisers(pinned), afterTail = tailRisers(moved)
    expect(afterTail.length).toBeGreaterThan(0)
    expect(afterTail).toHaveLength(beforeTail.length)
    for (const [i, step] of afterTail.entries()) {
      expect(step.from).toBe(beforeTail[i].from)
      expect(step.to).toBe(beforeTail[i].to)
      expect(Math.abs(step.offset - beforeTail[i].offset)).toBeLessThan(.05)
    }
    const restored = plan([movedStart, to], moved)
    expect(restored).toEqual(plan([movedStart, to]))

    const automaticRoute: Path['automaticRoute'] = { algorithm: AUTOMATIC_ROAD_VERSION, fixedPointsMm: [movedStart, fixed, to], automaticStairs: true }
    const adopted = applyCommands(scene, [{ type: 'createPath', id: 'road', ...request, centerlineMm: moved.centerlineMm,
      supportRefs: moved.supportRefs, automaticRoute, roadSurface: moved.roadSurface }], runtime)
    expect(adopted.paths.road.automaticRoute).toEqual(automaticRoute)
    expect(adopted.paths.road.centerlineMm).toEqual(moved.centerlineMm)
    expect(adopted.terrainAreas).toEqual(scene.terrainAreas)
    const projected = projectScene(adopted, 'player').paths.find(path => path.id === 'road')!
    expect(projected.gradedSurface?.spans).toEqual(moved.geometry?.spans)
    expect(projected).not.toHaveProperty('automaticRoute')
    expect(() => applyCommands(adopted, [{ type: 'updatePath', id: 'road', changes: { centerlineMm: restored.centerlineMm } }], runtime)).toThrow()
    const finished = applyCommands(adopted, [{ type: 'updatePath', id: 'road', changes: { staircase: defaultStaircase() } }], runtime)
    expect(finished.paths.road.roadSurface).toEqual(moved.roadSurface)
  })

  it('detours around public blockers at full width and refuses a private conflict without baking it into public geometry', () => {
    const empty = emptyDocument(), boundary = rectangle(11500, 11600, 5900, 8800)
    const fixed = [point(4000, 16000), point(22000, 16000)]
    const detour = createAutomaticRoadPlanner(obstruction(empty, 'public', boundary), request)(fixed)
    expect(detour.centerlineMm.length).toBeGreaterThan(2)
    expect(polygonsOverlap(detour.band, boundary)).toBe(false)
    const secret = obstruction(empty, 'gm', boundary)
    expect(() => createAutomaticRoadPlanner(secret, request)(fixed)).toThrow(/现有地面或内容/)
    expect(createAutomaticRoadPlanner(secret, { ...request, visibility: 'gm' })(fixed).centerlineMm).toEqual(detour.centerlineMm)
  })

  it('finds another line when only the downhill shoulder clips an obstruction', () => {
    const blank = emptyDocument(), bounds = blank.floors[floorId].boundsMm
    const relief = createTerrainRelief(bounds, ({ y }) => 5200 - y * .23, 500)
    const slope = applyCommands(blank, [{ type: 'createTerrainArea', id: 'bank', floorId,
      boundaryMm: rectangle(0, 0, bounds.width, bounds.height), relief }], runtime)
    const from = point(3400, 16000), via = point(7900, 16000), to = point(24500, 16000)
    const strip = rectangle(13000, 16700, 6100, 900)
    const original = createAutomaticRoadPlanner(slope, request)([from, via])
    const obvious = createAutomaticRoadPlanner(slope, request)([from, via, to], original)
    expect(polygonsOverlap(obvious.geometry!.coreMm, strip)).toBe(false)
    expect(polygonsOverlap(obvious.band, strip)).toBe(true)
    const blocked = obstruction(slope, 'public', strip)
    const detour = createAutomaticRoadPlanner(blocked, request)([from, via, to], original)
    expect(polygonsOverlap(detour.band, strip)).toBe(false)
    expect(detour.centerlineMm.slice(0, original.centerlineMm.length)).toEqual(original.centerlineMm)
    expect(detour.centerlineMm.at(-1)).toEqual(to)
    // A private obstruction may refuse adoption, but must never guide public routing.
    expect(() => createAutomaticRoadPlanner(obstruction(slope, 'gm', strip), request)([from, via, to], original)).toThrow(/现有地面或内容/)
  })

  it('adopts a gentle approach, two steep flights and a fixed landing as actual walk surfaces', () => {
    const blank = emptyDocument(), bounds = blank.floors[floorId].boundsMm
    const section = (x: number, start: number, length: number) => Math.min(length, Math.max(0, x - start))
    const relief = createTerrainRelief(bounds, ({ x, y }) => .10 * section(x, 2400, 3800) + .54 * section(x, 6200, 3800)
      + .48 * section(x, 12500, 4200) + .08 * section(x, 16700, 4400) + .24 * (y - 16000), 430)
    const scene = applyCommands(blank, [{ type: 'createTerrainArea', id: 'hill', floorId, boundaryMm: rectangle(0, 0, bounds.width, bounds.height), relief }], runtime)
    const from = point(3000, 16000), bend = point(11150, 16000), to = point(18800, 16000), fixedPointsMm = [from, bend, to]
    const path = { centerlineMm: fixedPointsMm, widthMm }
    const ground = createSupportQuery(scene, floorId)
    const heightAt = (p: PointMm) => ground.sample(p)?.zMm ?? null
    const automatic = createAutomaticRoadPlanner(scene, request)([from, to], { centerlineMm: [from, to], fixedPointsMm: [from, to] })
    expect(automatic.geometry?.spans.some(span => span.kind === 'landing')).toBe(true)
    const landing: RoadLanding = { pointMm: bend, lengthMm: 1450, elevationMm: Math.round(ground.sample(bend)!.zMm) + 32 }
    const roadSurface = gradeRoadSurface(path, fixedPointsMm, [landing], heightAt)
    const geometry = buildRoadSurface(path, roadSurface)
    expect(geometry.spans[0].kind).toBe('trail')
    expect(geometry.risers.length).toBeGreaterThan(12)
    expect(new Set(geometry.spans.filter(span => span.kind === 'landing').map(span => span.start[1].z))).toEqual(new Set([landing.elevationMm]))
    expect(roadSurface.stations.some(row => row.inZMm[0] > row.bankZMm[0] && row.inZMm[1] < row.bankZMm[1])).toBe(true)
    const adoptions: SceneCommand[] = [{ type: 'createPath', id: 'road', ...request, ...path, supportRefs: [{ kind: 'terrainArea', id: 'hill' }],
      automaticRoute: { algorithm: AUTOMATIC_ROAD_VERSION, fixedPointsMm, automaticStairs: true, landings: [landing] }, roadSurface }]
    const adopted = applyCommands(scene, adoptions, runtime)
    const query = createSupportQuery(adopted, floorId)
    expect(query.sample(bend)).toMatchObject({ sourcePathId: 'road', zMm: landing.elevationMm, walkable: true })
    expect(query.sourceSample(bend)).toEqual(ground.sample(bend))
    expect(checkTerrainTravel(adopted, { floorId, from, to, widthMm: 950 }).ok).toBe(true)
    expect(checkTerrainTravel(adopted, { floorId, from, to, widthMm: 1280 }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'TERRAIN_ROAD_RISER' })]))
    const invalid = structuredClone(roadSurface)
    invalid.stations[1].bankZMm[0] += 20
    expect(() => applyCommands(adopted, [{ type: 'updatePath', id: 'road', changes: { roadSurface: invalid } }], runtime)).toThrow(/接合/)
    expect(() => applyCommands(adopted, [{ type: 'updatePath', id: 'road', changes: { widthMm: 1250 } }], runtime)).toThrow(/新的道路地表/)
    expect(() => applyCommands(adopted, [{ type: 'createRegion', id: 'bank-conflict', floorId, boundaryMm: rectangle(8050, 16650, 1000, 130),
      kind: 'hazard', blocksMovement: true }], runtime)).toThrow(/实际占地/)
    const locked = structuredClone(scene)
    locked.terrainAreas.hill.editLocked = true
    expect(() => applyCommands(locked, adoptions, runtime)).toThrow(/锁定/)
  })

  it('preserves the previous manual staircase and keeps a private adopted road out of player projection', () => {
    const scene = hillside(), from = point(4300,16000), to = point(22500,16000)
    const gm = { ...request, visibility: 'gm' as const }
    const planned = createAutomaticRoadPlanner(scene, gm)([from, to])
    const supportRefs = planned.supportRefs, centerlineMm = planned.centerlineMm
    const staircase = { ...defaultStaircase(), material: 'earth' as const }
    const legacy = applyCommands(scene, [{ type: 'createPath', id: 'road', ...request, centerlineMm, supportRefs, staircase,
      automaticRoute: { algorithm: 'terrain-road2', fixedPointsMm: [from, to], automaticStairs: false } }], runtime)
    expect(projectScene(legacy, 'gm').paths[0].stairs?.config).toEqual(staircase)
    const edited = createAutomaticRoadPlanner(legacy, request, 'road')([point(3800, 16000), to], { centerlineMm, fixedPointsMm: [from, to] }, { legacyStaircase: staircase })
    expect(edited.roadSurface).toBeUndefined()
    const adopted = applyCommands(scene, [{ type: 'createPath', id: 'graded', ...gm, centerlineMm, supportRefs, roadSurface: planned.roadSurface,
      automaticRoute: { algorithm: AUTOMATIC_ROAD_VERSION, fixedPointsMm: [from, to], automaticStairs: true } }], runtime)
    const layerId = adopted.entityLayers.graded
    adopted.regions.mask = { id: 'mask', floorId, kind: 'manualMask', boundaryMm: rectangle(2500, 3500, 23000, 24500),
      editLocked: false, visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }
    adopted.entityLayers.mask = layerId
    expect(projectScene(adopted, 'gm').paths[0].gradedSurface?.risers.length).toBeGreaterThan(0)
    expect(projectScene(adopted, 'player').paths).toHaveLength(0)
  })
})
