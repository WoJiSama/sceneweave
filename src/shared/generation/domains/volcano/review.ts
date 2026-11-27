import { connectionArcFrame, connectionCenterline } from '../../../geometry/connection-route.js'
import { pointInPolygon, polygonInside, segmentCuts, terrainPoints, pathPolygon } from '../../../geometry/geometry.js'
import { ROAD_MIN_GOING_MM, ROAD_RISER_LIMIT_MM } from '../../../geometry/road-surface.js'
import { reliefBounds, reliefSegmentCuts, sampleTerrainRelief } from '../../../geometry/terrain-relief.js'
import { assertTerrainConnectionClearances, checkRouteOnValidScene, type TerrainTravelIssue } from '../../../geometry/terrain-travel.js'
import type { PointMm, SceneDocument, TerrainArea } from '../../../model/scene.js'
import { planStaircase } from '../../../stairs/geometry.js'
import { volcanoCrossingMinimumRun, volcanoSideVector } from './caldera.js'
import type { VolcanoParametersV2, VolcanoSide } from './contracts.js'

export const volcanoRouteKeys = [
  ['approach', 'ascent', 'ground', 'mountain', '入口到观测台'],
  ['crater-route', 'descent', 'mountain', 'crater', '观测台到火口'],
] as const

type VolcanoId = (key: string) => string

export function reviewVolcanoRoutes(scene: SceneDocument, p: VolcanoParametersV2, id: VolcanoId) {
  const platform = scene.terrainAreas[id('platform')], crater = scene.terrainAreas[id('crater')]
  const bounds = p.boundsMm, right = bounds.x + bounds.width, bottom = bounds.y + bounds.height
  const perimeter = [{ x: bounds.x, y: bounds.y }, { x: right, y: bounds.y }, { x: right, y: bottom }, { x: bounds.x, y: bottom }]
  return volcanoRouteKeys.map(([key, crossing, from, to, label]) => {
    const pathId = id(key), connectionId = id(crossing), path = scene.paths[pathId], connection = scene.terrainConnections[connectionId]
    const widthMm = path?.widthMm ?? p.route.widthMm
    const issues: TerrainTravelIssue[] = [], issue = (code: string, message: string, atMm?: PointMm) => issues.push({ code, message, ...(atMm ? { atMm } : {}) })
    const route = path?.floorId === p.floorId ? checkRouteOnValidScene(scene, { floorId: p.floorId, pointsMm: path.centerlineMm, widthMm }) : undefined
    const on = (point: PointMm, area: TerrainArea | undefined) => !!area && pointInPolygon(point, terrainPoints(area), false)
    const reaches = path && (key === 'approach'
      ? path.centerlineMm[0].x === p.entrance.positionMm.x && path.centerlineMm[0].y === p.entrance.positionMm.y && on(path.centerlineMm.at(-1)!, platform)
      : on(path.centerlineMm[0], platform) && on(path.centerlineMm.at(-1)!, crater))
    if (!route || !reaches || path.widthMm < p.route.widthMm || !polygonInside(pathPolygon(path), perimeter)) {
      issue('VOLCANO_ROUTE', `${label}的公开路线未连接指定落脚点，或其完整净宽超出范围。`, path?.centerlineMm[0])
    }
    if (route) issues.push(...route.issues)
    const a = scene.terrainAreas[id(from)], b = scene.terrainAreas[id(to)]
    let traversal: { id: string; kind: 'stairs' | 'ramp'; widthMm: number; riseMm: number; runMm: number; stepCount?: number } | undefined
    if (!connection || !a || !b || connection.kind !== p[crossing].kind || connection.floorId !== p.floorId
      || connection.from.surfaceRef.kind !== 'terrainArea' || connection.from.surfaceRef.id !== a.id
      || connection.to.surfaceRef.kind !== 'terrainArea' || connection.to.surfaceRef.id !== b.id
      || !route?.connectionIds.includes(connectionId)) {
      issue('VOLCANO_CONNECTION', `${label}的公开路线须穿过指定高差连接。`, path?.centerlineMm[0])
    } else {
      const line = connectionCenterline(connection), runMm = connectionArcFrame(line).length
      const elevationChange = b.groundElevationMm - a.groundElevationMm, riseMm = Math.abs(elevationChange)
      const minRun = volcanoCrossingMinimumRun(connection.kind, riseMm)
      traversal = { id: connectionId, kind: connection.kind, widthMm: connection.widthMm, riseMm, runMm: Math.round(runMm) }
      if ((crossing === 'ascent' ? elevationChange : -elevationChange) <= 0 || runMm < minRun) {
        issue('VOLCANO_GRADE', `${label}的实测高差 ${riseMm} mm，水平距离 ${Math.round(runMm)} mm，至少需要 ${minRun} mm。`, line[0])
      }
      if (connection.kind === 'stairs') {
        const stairs = connection.staircase && planStaircase(line, connection.widthMm, connection.staircase)
        if (stairs) traversal.stepCount = stairs.treads.length
        if (!stairs || connection.staircase?.range || stairs.treads.some(tread => {
          const depth = tread.endMm - tread.startMm
          return depth + 1e-6 < ROAD_MIN_GOING_MM || riseMm * depth / runMm > ROAD_RISER_LIMIT_MM + 1e-6
        })) issue('VOLCANO_TREADS', `${label}的踏步须覆盖整段，并满足实际阶高和踏面。`, line[0])
      }
      try {
        assertTerrainConnectionClearances(scene, [{ connectionId, minWidthMm: widthMm, approachDepthMm: Math.max(1, Math.floor(widthMm / 3)) }])
      } catch (error) {
        issue('VOLCANO_LANDING', error instanceof Error ? error.message : String(error), line[0])
      }
    }
    return { id: pathId, source: 'volcano' as const, label, required: true as const, ok: !issues.length, widthMm,
      lengthMm: route?.lengthMm ?? 0, issues, connectionIds: route?.connectionIds ?? [], ...(traversal ? { traversal } : {}) }
  })
}

const between = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const edges = (ring: PointMm[]): [PointMm, PointMm][] => ring.map((point, i) => [point, ring[(i + 1) % ring.length]])
const MIN_BREACH_RELIEF_MM = 250

/** Measure the highest point along the opening, including both relief grids at
 * the seam, against the two intact lips at the edges of the notch. */
export function reviewVolcanoBreach(scene: SceneDocument, p: VolcanoParametersV2, id: VolcanoId) {
  const side = p.breachSide
  if (!side) return
  const mountain = scene.terrainAreas[id('mountain')], crater = scene.terrainAreas[id('crater')]
  const evidence = mountain?.relief && crater?.relief ? breachRelief(mountain, crater, side) : undefined
  const lowMm = evidence?.openingMm ?? { x: p.boundsMm.x, y: p.boundsMm.y }
  const highMm = evidence?.rimMm ?? lowMm
  const riseMm = evidence ? evidence.rimElevationMm - evidence.openingElevationMm : null
  return { id: 'volcano-breach', side, required: true as const, ok: riseMm !== null && riseMm >= MIN_BREACH_RELIEF_MM,
    lowMm, highMm, riseMm, minRiseMm: MIN_BREACH_RELIEF_MM,
    lowElevationMm: evidence?.openingElevationMm ?? null, highElevationMm: evidence?.rimElevationMm ?? null }
}

function breachRelief(mountain: TerrainArea, crater: TerrainArea, side: VolcanoSide) {
  const rim = terrainPoints(crater), foot = terrainPoints(mountain), rimEdges = edges(rim), footEdges = edges(foot)
  const basin = reliefBounds(rim), bank = reliefBounds(foot), facing = volcanoSideVector(side)
  const centre = { x: basin.x + basin.width / 2, y: basin.y + basin.height / 2 }
  const probeLength = Math.max(bank.width, bank.height) * 2, span = facing.x ? basin.height : basin.width
  const endAt = (start: PointMm) => ({ x: start.x + facing.x * probeLength, y: start.y + facing.y * probeLength })
  const probe = (start: PointMm) => {
    if (!pointInPolygon(start, rim, false)) return
    const end = endAt(start)
    const [, lip] = segmentCuts(start, end, rimEdges), [, edge] = segmentCuts(start, end, footEdges)
    if (!(lip < edge && edge < 1)) return
    return { lip: between(start, end, lip), outer: between(start, end, edge) }
  }
  const centreLine = probe(centre)
  if (!centreLine) return
  const height = (area: TerrainArea, bounds: typeof basin, at: PointMm) => area.groundElevationMm + sampleTerrainRelief(area.relief!, bounds, at).offsetMm
  const peak = (area: TerrainArea, bounds: typeof basin, start: PointMm, end: PointMm) =>
    reliefSegmentCuts(area.relief!, bounds, start, end).map(t => {
      const at = between(start, end, t)
      return { at, elevation: height(area, bounds, at) }
    }).reduce((highest, sample) => sample.elevation > highest.elevation ? sample : highest)
  const inner = between(centre, centreLine.lip, .70), outer = between(centreLine.lip, centreLine.outer, .68)
  const opening = [peak(crater, basin, inner, centreLine.lip), peak(mountain, bank, centreLine.lip, outer)]
    .reduce((highest, sample) => sample.elevation > highest.elevation ? sample : highest)
  const shoulders = [-1, 1].map(sign => [.25, .32, .38].flatMap(offset => {
    const start = { x: centre.x + facing.y * span * offset * sign, y: centre.y - facing.x * span * offset * sign }
    const line = probe(start)
    return line ? [peak(crater, basin, between(start, line.lip, .84), line.lip)] : []
  }).sort((a, b) => b.elevation - a.elevation)[0])
  if (!shoulders[0] || !shoulders[1]) return
  const shoulder = shoulders[0].elevation < shoulders[1].elevation ? shoulders[0] : shoulders[1]
  const rounded = (at: PointMm) => ({ x: Math.round(at.x), y: Math.round(at.y) })
  return { openingMm: rounded(opening.at), openingElevationMm: Math.round(opening.elevation), rimMm: rounded(shoulder.at), rimElevationMm: Math.round(shoulder.elevation) }
}
