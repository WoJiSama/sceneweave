import { pathPolygon, polygonValid } from '../geometry/geometry.js'
import { levelGroundPolygon } from '../geometry/support-sample.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import type { Issue, Path, PointMm, SceneDocument, SurfaceStyle } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { PATH_ENDS, type PathEnd } from './bridge-link-contracts.js'

export const BRIDGE_FOLLOW_DISTANCE_MM = 1800
const DIRECTIONS_DOT_LIMIT = .55

export const pathEndPosition = (path: Path, end: PathEnd) => path.centerlineMm[end === 'start' ? 0 : path.centerlineMm.length - 1]
const inwardPoint = (path: Path, end: PathEnd, steps = 1) => path.centerlineMm[end === 'start' ? steps : path.centerlineMm.length - 1 - steps]
export const offsetPoint = (a: PointMm, b: PointMm) => ({ x: a.x + b.x, y: a.y + b.y })
export const subtract = (a: PointMm, b: PointMm) => ({ x: a.x - b.x, y: a.y - b.y })
export const samePoint = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
export const distance = (a: PointMm, b: PointMm) => Math.hypot(a.x - b.x, a.y - b.y)

function bridgeFrame(path: Path, end: PathEnd) {
  const point = pathEndPosition(path, end), direction = subtract(point, inwardPoint(path, end))
  const length = Math.hypot(direction.x, direction.y)
  return { point, direction: { x: direction.x / length, y: direction.y / length } }
}

/** Roads have square caps, so their centerline ends half a width outside the deck. */
export function approachEndpoint(bridge: Path, bridgeEnd: PathEnd, road: Path) {
  const frame = bridgeFrame(bridge, bridgeEnd), head = bridge.assembly?.recipe.structure?.bridgehead
  const reach = head && (head.ends === 'both' || head.ends === bridgeEnd) ? head.lengthMm : 2
  const advance = reach + road.widthMm / 2 + 1
  return { x: Math.round(frame.point.x + frame.direction.x * advance) || 0,
    y: Math.round(frame.point.y + frame.direction.y * advance) || 0 }
}

export function withBridgeApproach(bridge: Path, bridgeEnd: PathEnd, road: Path, roadEnd: PathEnd, bound: boolean): Path {
  const point = approachEndpoint(bridge, bridgeEnd, road), { direction } = bridgeFrame(bridge, bridgeEnd)
  const leadMm = Math.max(250, Math.ceil(road.widthMm / 2))
  const lead = { x: Math.round(point.x + direction.x * leadMm) || 0, y: Math.round(point.y + direction.y * leadMm) || 0 }
  const points = roadEnd === 'start' ? road.centerlineMm : road.centerlineMm.slice().reverse()
  const centerlineMm = [point, lead, ...points.slice(bound ? 2 : 1)]
  return { ...road, centerlineMm: roadEnd === 'start' ? centerlineMm : centerlineMm.reverse() }
}

export function facesRoad(bridge: Path, bridgeEnd: PathEnd, road: Path, roadEnd: PathEnd, point: PointMm, hasLead = false) {
  const { direction } = bridgeFrame(bridge, bridgeEnd), inward = subtract(inwardPoint(road, roadEnd, hasLead ? 2 : 1), point)
  const length = Math.hypot(inward.x, inward.y)
  return length > 0 && (inward.x * direction.x + inward.y * direction.y) / length >= DIRECTIONS_DOT_LIMIT
}

export function compatible(bridge: Path, road: Path | undefined): road is Path {
  return !!road && bridge.floorId === road.floorId && bridge.visibility === road.visibility && !road.assembly && !road.widthSections
}

export function hasLevelApproach(scene: SceneDocument, path: Path, elevationMm: number) {
  const band = pathPolygon(path)
  return polygonValid(band, true) && levelGroundPolygon(scene, path.floorId, band, path.supportRefs, elevationMm)
}

export function translateBridgeSurfaceStyle(style: SurfaceStyle, offsetMm: PointMm): SurfaceStyle {
  const next = cloneJson(style)
  for (const paint of [next.base, ...next.overlays.map(overlay => overlay.paint)]) {
    if (paint.alignment === 'surface') paint.originMm = offsetPoint(paint.originMm, offsetMm)
  }
  for (const overlay of next.overlays) overlay.boundaryMm = overlay.boundaryMm.map(point => offsetPoint(point, offsetMm))
  return next
}

export function inspectBridgeRoadLinks(scene: SceneDocument): Issue[] {
  const bridges = Object.values(scene.paths).filter(path => path.assembly?.bridge?.roadLinks)
  if (!bridges.length) return []
  const issues: Issue[] = [], occupied = new Set<string>(), doors = new Set(Object.values(scene.pathAttachments ?? {}).map(row => row.pathId))
  const visibility = createPublicVisibility(scene)
  for (const path of bridges) {
    const bridge = path.assembly!.bridge!
    for (const bridgeEnd of PATH_ENDS) {
      const link = bridge.roadLinks![bridgeEnd]
      if (!link) continue
      const road = scene.paths[link.pathId], key = JSON.stringify([link.pathId, link.end])
      if (occupied.has(key) || doors.has(link.pathId) || !compatible(path, road) || road.centerlineMm.length < 3 || visibility.path(road.id) !== visibility.path(path.id) ||
          distance(link.restMm, pathEndPosition(road, link.end)) > BRIDGE_FOLLOW_DISTANCE_MM ||
          !samePoint(pathEndPosition(road, link.end), approachEndpoint(path, bridgeEnd, road)) ||
          !samePoint(inwardPoint(road, link.end), inwardPoint(withBridgeApproach(path, bridgeEnd, road, link.end, true), link.end)) ||
          !facesRoad(path, bridgeEnd, road, link.end, pathEndPosition(road, link.end), true) || !hasLevelApproach(scene, road, bridge.elevationMm)) {
        issues.push({ code: 'BRIDGE_ROAD_LINK', entityId: path.id, message: `${bridgeEnd === 'start' ? '起点' : '终点'}的桥路接头已失去对应路端、同高承托或方向。请先断开该链接。` })
      }
      occupied.add(key)
    }
  }
  return issues
}
