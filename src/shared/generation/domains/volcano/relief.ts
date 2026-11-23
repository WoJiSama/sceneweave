import type { SceneCommand } from '../../../commands/commands.js'
import { connectionCenterline } from '../../../geometry/connection-route.js'
import { distanceToSegment, pointInPolygon, terrainPoints } from '../../../geometry/geometry.js'
import { createTerrainRelief, reliefBounds } from '../../../geometry/terrain-relief.js'
import type { PointMm, SceneDocument } from '../../../model/scene.js'
import { cloneJson } from '../../../validation/json.js'
import { visualBase } from '../../../visual/base.js'

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

/** Builds persistent authoring geometry for the natural-volcano template.
 * The ordinary relief sampler, editor, renderer and archive own it thereafter. */
export function naturalVolcanoReliefCommands(scene: SceneDocument, ids: {
  mountainAreaId: string; craterAreaId: string; groundAreaId: string; platformAreaId: string; flowAreaId: string | null; connectionIds: string[]; pathIds: string[]
}): SceneCommand[] {
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
  const stairs = ids.connectionIds.map(id => scene.terrainConnections[id]).filter(Boolean).map(connection => {
    const points = connectionCenterline(connection)
    return { segments: edges(points, false), width: connection.widthMm, start: connection.from, end: connection.to }
  })
  const routes = ids.pathIds.map(id => scene.paths[id]).filter(Boolean).map(path => ({ segments: edges(path.centerlineMm, false), width: path.widthMm }))
  const height = (p: PointMm, insideCrater: boolean) => {
    const dx = (p.x - origin.x) / basin.width, dy = (p.y - origin.y) / basin.height, theta = Math.atan2(dy, dx)
    const summit = plateau + size * (3750 + 480 * Math.sin(theta * 3 + .64) + 330 * Math.cos(theta * 7 - 1.1) - 1500 * dy)
    const distanceToRim = nearest(p, rim), distanceToFoot = nearest(p, foot)
    const t = distanceToFoot / Math.max(10, distanceToFoot + distanceToRim)
    const ridges = 340 * Math.sin(theta * 15 + dx * 7) + 130 * Math.cos(theta * 26 + dx * 16)
    let z = insideCrater ? mix(summit, floor, smooth(distanceToRim / (3700 * size)))
      : pointInPolygon(p, mountainOutline) ? mix(base, summit, t * t * (1.63 - .63 * t)) + Math.sin(Math.PI * t) * size * ridges : base
    if (insideCrater && lava.length) z = mix(floor, z, pointInPolygon(p, lava) ? 0 : smooth((nearest(p, lavaEdges) - 400 * size) / (1100 * size)))
    if (!insideCrater) z = mix(plateau, z, pointInPolygon(p, platformOutline) ? 0 : smooth((nearest(p, landing) - 400 * size) / (1600 * size)))
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
        z = mix(areas[areaId].groundElevationMm, z, smooth((stepDistance - 950 * size) / (1200 * size)))
      }
    }
    return insideCrater ? z : mix(base, z, smooth(distanceToFoot / (1150 * size)))
  }
  const commands: SceneCommand[] = [
    { type: 'updateTerrainArea', id: mountain.id, changes: { boundaryBlendMm: Math.round(size * 1250), relief: createTerrainRelief(box, p => height(p, false) - mountain.groundElevationMm) } },
    { type: 'updateTerrainArea', id: crater.id, changes: { relief: createTerrainRelief(basin, p => height(p, true) - crater.groundElevationMm, 240) } },
  ]
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
