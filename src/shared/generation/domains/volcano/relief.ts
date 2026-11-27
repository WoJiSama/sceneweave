import type { SceneCommand } from '../../../commands/commands.js'
import { connectionCenterline } from '../../../geometry/connection-route.js'
import { distanceToSegment, pointInPolygon, terrainPoints } from '../../../geometry/geometry.js'
import { createTerrainRelief, reliefBounds, TERRAIN_RELIEF_GRID_LIMIT } from '../../../geometry/terrain-relief.js'
import type { PointMm, SceneDocument, TerrainConnection } from '../../../model/scene.js'
import { cloneJson } from '../../../validation/json.js'
import { visualBase } from '../../../visual/base.js'
import type { ExecutionBudget } from '../../../budget/task-budget.js'
import { terrainValueNoise } from '../../../terrain-generation/field.js'
import { volcanoSideVector } from './caldera.js'
import type { VolcanoSide } from './contracts.js'

export const NATURAL_VOLCANO_OBSERVATION = '西南清理区与岩阶的山肩接点同为1800mm，火口底部为-400mm。岩阶沿实际路线铺完整，地表的高程可继续修改。冷壳区域危险但可通行，移动代价2。熔岩池的同形区域危险、阻挡并保存移动代价4。'
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const edges = (points: PointMm[], ring: boolean) =>
  points.slice(0, ring ? points.length : -1).map((point, i) => [point, points[(i + 1) % points.length]] as const)
const nearest = (p: PointMm, segments: ReturnType<typeof edges>) => {
  let result = Infinity
  for (const [a, b] of segments) result = Math.min(result, distanceToSegment(p, a, b))
  return result
}
interface ReliefPlan {
  seed: string
  routes: { points: PointMm[]; width: number }[]
  crossings: Pick<TerrainConnection, 'from' | 'to' | 'widthMm' | 'kind'>[]
  meter: ExecutionBudget
  adaptive?: boolean
  breachSide?: VolcanoSide
}

/** Builds persistent authoring geometry for natural volcanoes.
 * The ordinary relief sampler, editor, renderer and archive own it thereafter. */
export function naturalVolcanoReliefCommands(scene: SceneDocument, ids: {
  mountainAreaId: string; craterAreaId: string; groundAreaId: string; platformAreaId: string; flowAreaId: string | null; connectionIds: string[]; pathIds: string[]
}, planned?: ReliefPlan): SceneCommand[] {
  const { mountainAreaId, craterAreaId, groundAreaId, platformAreaId, flowAreaId } = ids
  const { terrainAreas: areas } = scene
  const mountain = areas[mountainAreaId], crater = areas[craterAreaId], ground = areas[groundAreaId], platform = areas[platformAreaId]
  if (!mountain || !crater || !ground || !platform) throw new Error('火山塑形需要四块实际地表。')
  const mountainOutline = terrainPoints(mountain), craterOutline = terrainPoints(crater), platformOutline = terrainPoints(platform)
  const foot = edges(mountainOutline, true), rim = edges(craterOutline, true), landing = edges(platformOutline, true)
  const lava = flowAreaId && areas[flowAreaId] ? terrainPoints(areas[flowAreaId]) : []
  const lavaEdges = edges(lava, true)
  const basin = reliefBounds(craterOutline), box = reliefBounds(mountainOutline)
  const size = Math.min(box.width / 34840, box.height / 30400)
  const origin = { x: basin.x + basin.width * .5, y: basin.y + basin.height * .5 }
  const base = ground.groundElevationMm, floor = crater.groundElevationMm, plateau = platform.groundElevationMm
  const breach = planned?.breachSide && volcanoSideVector(planned.breachSide)
  const reliefScale = planned?.adaptive ? Math.max(0, Math.min(1.45, (plateau - floor) / 2900)) : 1
  const mountainSpacing = planned?.adaptive ? 480 : planned ? 540 : 350
  const craterSpacing = planned?.adaptive ? 300 : planned ? 330 : 240
  const plateauMargin = planned?.adaptive ? Math.max(400 * size, Math.hypot(
    Math.max(mountainSpacing, box.width / (TERRAIN_RELIEF_GRID_LIMIT - 1)),
    Math.max(mountainSpacing, box.height / (TERRAIN_RELIEF_GRID_LIMIT - 1)))) : 400 * size
  const stairs = planned ? planned.crossings.map(({ from, to, widthMm }) => ({
    start: from, end: to, width: widthMm, segments: edges([from.positionMm, to.positionMm], false),
  })) : ids.connectionIds.map(id => scene.terrainConnections[id]).filter(Boolean).map(connection => {
    const points = connectionCenterline(connection)
    return { segments: edges(points, false), width: connection.widthMm, start: connection.from, end: connection.to }
  })
  const routes = (planned?.routes ?? ids.pathIds.map(id => scene.paths[id]).filter(Boolean).map(path => ({ points: path.centerlineMm, width: path.widthMm })))
    .map(path => ({ segments: edges(path.points, false), width: path.width }))
  const settling = planned ? Math.max(950 * size, ...stairs.map(stair => stair.width / 2 + 600)) : 950 * size
  const rampAscent = planned?.crossings[0].kind === 'ramp'
  const ramps = planned?.adaptive ? planned.crossings.filter(crossing => crossing.kind === 'ramp').map(({ from, to, widthMm }) => {
    const start = from.positionMm, dx = to.positionMm.x - start.x, dy = to.positionMm.y - start.y
    return { start, dx, dy, run: Math.hypot(dx, dy), widthMm, startZ: areas[from.surfaceRef.id].groundElevationMm, endZ: areas[to.surfaceRef.id].groundElevationMm }
  }) : []
  const ascent = stairs[0]
  const along = ascent && { x: ascent.end.positionMm.x - ascent.start.positionMm.x, y: ascent.end.positionMm.y - ascent.start.positionMm.y }
  const run = along ? Math.hypot(along.x, along.y) : 0
  const footFeather = rampAscent ? 2300 * size : 1150 * size
  const height = (p: PointMm, insideCrater: boolean) => {
    const dx = (p.x - origin.x) / basin.width, dy = (p.y - origin.y) / basin.height, theta = Math.atan2(dy, dx)
    const nearRim = Math.max(0, Math.sin(theta))
    const summit = planned
      ? plateau + size * (2820 + 540 * Math.sin(theta * 3 + .64) + 480 * Math.cos(theta * 7 - 1.1)
        - 1700 * Math.max(-.60, Math.min(.60, dy)) - 1550 * nearRim ** 2)
      : plateau + size * (3750 + 480 * Math.sin(theta * 3 + .64) + 330 * Math.cos(theta * 7 - 1.1) - 1500 * dy)
    const distanceToRim = nearest(p, rim), distanceToFoot = nearest(p, foot)
    const t = distanceToFoot / Math.max(10, distanceToFoot + distanceToRim)
    const ridges = planned
      ? 260 * Math.sin(theta * 15 + dx * 7) + 230 * terrainValueNoise(planned.seed, 'caldera/weathered-faces', dx * 6, dy * 7)
      : 340 * Math.sin(theta * 15 + dx * 7) + 130 * Math.cos(theta * 26 + dx * 16)
    let z = insideCrater ? mix(summit, floor, smooth(distanceToRim / (3700 * size)))
      : pointInPolygon(p, mountainOutline) ? mix(base, summit, t * t * (1.63 - .63 * t)) + Math.sin(Math.PI * t) * size * ridges : base
    if (planned?.adaptive) {
      const walls = 1 - smooth(distanceToRim / (2800 * size))
      const fracture = 430 * Math.sin(theta * 6 + dx * 9) + 210 * terrainValueNoise(planned.seed, 'caldera/rim-faces', dx * 9, dy * 9)
      z += size * reliefScale * walls * (1180 + fracture)
    }
    if (breach) {
      const outward = dx * breach.x + dy * breach.y, cross = Math.abs(dy * breach.x - dx * breach.y)
      const notch = smooth((outward - .13) / .25) * (1 - smooth((cross - .095) / .16))
      const openingLevel = insideCrater ? floor : mix(base, floor, smooth(distanceToFoot / Math.max(500 * size, distanceToRim + distanceToFoot)))
      z = mix(z, openingLevel, notch)
    }
    if (insideCrater && lava.length) z = mix(floor, z, pointInPolygon(p, lava) ? 0 : smooth((nearest(p, lavaEdges) - 400 * size) / (1100 * size)))
    if (!insideCrater) z = mix(plateau, z, pointInPolygon(p, platformOutline) ? 0 : smooth((nearest(p, landing) - plateauMargin) / (1600 * size)))
    const routeLevel = insideCrater ? floor : plateau
    for (const route of routes) z = mix(routeLevel, z, smooth((nearest(p, route.segments) - route.width / 2 - 240 * size) / (2400 * size)))
    for (const stair of stairs) {
      // Keep each side's original datum through its fixed landing. The treads
      // own the visible crossing band between the two landings.
      const distance = nearest(p, stair.segments)
      z = mix(routeLevel, z, smooth((distance - stair.width / 2 - 450 * size) / (1750 * size)))
      for (const end of [stair.start, stair.end]) {
        const areaId = insideCrater ? crater.id : mountain.id
        if (end.surfaceRef.id !== areaId) continue
        const stepDistance = Math.hypot(p.x - end.positionMm.x, p.y - end.positionMm.y)
        z = mix(areas[areaId].groundElevationMm, z, smooth((stepDistance - settling) / (1200 * size)))
      }
    }
    let heightMm = insideCrater ? z : mix(base, z, smooth(distanceToFoot / footFeather))
    if (rampAscent && !planned?.adaptive && !insideCrater && along && run) {
      const { x, y } = ascent.start.positionMm, dx = p.x - x, dy = p.y - y
      const lateral = Math.abs(dx * along.y - dy * along.x) / run
      const station = (dx * along.x + dy * along.y) / run
      const crest = mix(base, plateau, smooth((station - 1000 * size) / (run - 1800 * size)))
      const shoulder = smooth((lateral - ascent.width / 2 - 300) / (1500 * size))
      const influence = smooth((station + 750 * size) / (750 * size)) * smooth((run + 1550 * size - station) / (1550 * size))
      heightMm = mix(heightMm, mix(crest, heightMm, shoulder), influence)
    }
    for (const ramp of ramps) {
      const dx = p.x - ramp.start.x, dy = p.y - ramp.start.y
      const lateral = Math.abs(dx * ramp.dy - dy * ramp.dx) / ramp.run
      const station = (dx * ramp.dx + dy * ramp.dy) / ramp.run
      // A complete grid cell at either landing stays on its level datum.
      const landingDepth = Math.min(plateauMargin, ramp.run / 3)
      const heightOnRamp = mix(ramp.startZ, ramp.endZ, clamp((station - landingDepth) / (ramp.run - 2 * landingDepth)))
      const feather = 950 * size, margin = ramp.widthMm / 2 + plateauMargin
      const shoulder = 1 - smooth((lateral - margin) / feather)
      const ends = 1 - smooth((Math.max(-station, station - ramp.run) - margin) / feather)
      heightMm = mix(heightMm, heightOnRamp, shoulder * ends)
    }
    return planned && !insideCrater ? Math.max(base, heightMm) : heightMm
  }
  const mountainRelief = createTerrainRelief(box, p => height(p, false) - mountain.groundElevationMm, mountainSpacing)
  const craterRelief = createTerrainRelief(basin, p => height(p, true) - crater.groundElevationMm, craterSpacing)
  const nodes = mountainRelief.offsetsMm.length + craterRelief.offsetsMm.length
  planned?.meter.charge({ gridNodes: nodes, fieldEvaluations: planned.adaptive
    ? nodes * (6 + Number(!!breach) + routes.length + stairs.length * 3 + ramps.length) : nodes })
  const commands: SceneCommand[] = [
    { type: 'updateTerrainArea', id: mountain.id, changes: { boundaryBlendMm: Math.round(size * (planned?.adaptive ? 900 : 1250)), relief: mountainRelief,
      ...(planned?.adaptive ? { reliefFinish: 'weathered-v2' as const } : {}) } },
    { type: 'updateTerrainArea', id: crater.id, changes: { relief: craterRelief,
      ...(planned?.adaptive ? { reliefFinish: 'weathered-v1' as const, boundaryBlendMm: Math.round(size * 780) } : {}) } },
  ]
  if (planned) {
    if (flowAreaId && areas[flowAreaId]) commands.push({ type: 'updateTerrainArea', id: flowAreaId, changes: { boundaryBlendMm: 125 } })
    return commands
  }
  const visual = visualBase(scene)
  const observation = scene.notes['natural-volcano-gm-observation-area']
  if (observation?.text.includes('没有连续坡面') && !observation.editLocked) commands.push({
    type: 'updateNote', id: observation.id,
    changes: { text: NATURAL_VOLCANO_OBSERVATION },
  })
  for (const look of Object.values(visual?.edgeLooks ?? {})) {
    const boundary = visual?.boundaries[look.boundaryId]
    if (look.kind === 'cliff' && look.renderProfile === 'rockRelief4' && boundary?.binding.kind === 'terrain'
      && boundary.binding.sides.some(side => side.areaId === mountain.id || side.areaId === crater.id)) {
      commands.push({ type: 'upsertVisualEdgeLook', edgeLook: { ...cloneJson(look), enabled: false } })
    }
  }
  return commands
}
