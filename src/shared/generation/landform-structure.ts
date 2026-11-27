import { distanceToSegment, pointInPolygon, polygonInside, polygonsOverlap, polygonValid, segmentCuts } from '../geometry/geometry.js'
import type { PointMm } from '../model/scene.js'
import { assertSimpleVisualPolyline } from '../visual/geometry.js'
import type { MapLandformStructure } from './map-authoring.js'

export function mapLandformStructure(structure: MapLandformStructure, point: (p: PointMm) => PointMm): MapLandformStructure {
  const breakline = structure.breakline ? { breakline: structure.breakline.map(point) } : {}
  return structure.kind === 'area' ? { kind: 'area', boundary: structure.boundary.map(point), ...breakline }
    : { kind: 'ridge', centerline: structure.centerline.map(point), ...breakline }
}

export function landformStructureIssue(structure: MapLandformStructure, at: PointMm, radius: PointMm, land: PointMm[], lakes: PointMm[][]) {
  const edges = (ring: PointMm[]): [PointMm, PointMm][] => ring.map((a, i) => [a, ring[(i + 1) % ring.length]])
  const ground = (point: PointMm) => pointInPolygon(point, land) && lakes.every(lake => !pointInPolygon(point, lake, false))
  const validLine = (line: PointMm[]) => {
    try { assertSimpleVisualPolyline(line, false) } catch { return false }
    const boundaries = [...edges(land), ...lakes.flatMap(edges)]
    return line.every(ground) && line.slice(1).every((b, index) => {
      const a = line[index], cuts = segmentCuts(a, b, boundaries)
      return cuts.slice(1).every((t, i) => {
        const fraction = (t + cuts[i]) / 2
        return ground({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction })
      })
    })
  }
  if (structure.kind === 'area') {
    const { boundary } = structure
    if (!polygonValid(boundary, false) || !pointInPolygon(at, boundary, false)
      || !polygonInside(boundary, land) || lakes.some(lake => polygonsOverlap(boundary, lake))) {
      return '地貌范围须是包含标记点的有效轮廓，并留在同一块陆地上。'
    }
  } else {
    const { centerline } = structure
    if (!validLine(centerline) || !centerline.slice(1).some((p, i) =>
      distanceToSegment(at, centerline[i], p) <= Math.max(1, Math.min(radius.x, radius.y) * .18))) {
      return '山脊线须留在同一块陆地上，并经过地貌标记附近。'
    }
  }
  if (structure.breakline && !validLine(structure.breakline)) return '坡折线须留在同一块陆地上，且不能交叉或折返。'
}
