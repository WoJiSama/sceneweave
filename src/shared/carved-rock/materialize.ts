import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { PointMm } from '../model/scene.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { CARVED_ROCK_LIMITS as LIMITS, carvedStripSchema,
  type CarvedPointMm, type CarvedRockHost, type CarvedRockPatch, type CarvedRockPlan, type CarvedRockWall, type CarvedStrip } from './contracts.js'
import { captureCarvedRockHost, carvedArea, carvedContains, carvedPolygon, carvedRockGeometry as geometry,
  carvedStripCutFootprints, carvedStripPatches, carvedUnion } from './geometry.js'

const EPS = 1e-7
const regionsContain = (regions: MultiPolygon, p: PointMm) => regions.some(polygon => {
  if (!carvedContains(polygon[0].map(([x, y]) => ({ x, y })), p)) return false
  return !polygon.slice(1).some(ring => carvedContains(ring.map(([x, y]) => ({ x, y })), p, false))
})
interface SourceFace { id: string; kind: 'top' | 'walk' | 'apron'; regions: MultiPolygon; plane: (p: PointMm) => number }
interface Line { a: PointMm; b: PointMm; cuts: PointMm[] }
const span = (a: PointMm, b: PointMm) => Math.hypot(b.x - a.x, b.y - a.y)
const distanceTo = (p: PointMm, a: PointMm, b: PointMm) => {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0
  const q = geometry.at(a, b, t)
  return span(p, q)
}
const affine = ([a, b, c]: readonly CarvedPointMm[]) => {
  const d = geometry.cross(a, b, c)
  if (d <= EPS) throw Error('岩体计划不能消费退化或反向实际面。')
  return (p: PointMm) => (geometry.cross(p, b, c) * a.z + geometry.cross(a, p, c) * b.z + geometry.cross(a, b, p) * c.z) / d
}

/** One node/intersection graph owns every exterior and cut wall endpoint.
 * Shared affine patches produce shape; no regular treads or detached side band. */
export function carvedRockFaces(hostInput: CarvedRockHost, stripInputs: readonly CarvedStrip[] = []): CarvedRockPlan {
  const host = captureCarvedRockHost(hostInput)
  if (!Array.isArray(stripInputs) || stripInputs.length > LIMITS.strips) throw Error('同岩体实际切口超过有限预算。')
  const strips = captureJson(stripInputs).map(value => carvedStripSchema.parse(value))
  for (const strip of strips) geometry.routeChecks(strip, host)
  const footprint = host.boundaryMm.map(p => ({ ...p.positionMm })), cuts = strips.flatMap(carvedStripCutFootprints)
  const cutUnions = strips.map(strip => carvedUnion(carvedStripCutFootprints(strip).map(carvedPolygon)))
  for (let i = 0; i < cutUnions.length; i++) for (let j = i + 1; j < cutUnions.length; j++) {
    if (carvedArea(polygonClipping.intersection(cutUnions[i], cutUnions[j])) > EPS) throw Error('首片岩体计划不能合并相互交叠的切削体。')
  }
  const cut = carvedUnion(cutUnions), top = cut.length ? polygonClipping.difference(carvedPolygon(footprint), cut) : carvedPolygon(footprint)
  const patches: CarvedRockPatch[] = strips.flatMap(carvedStripPatches)
  const sources: SourceFace[] = [
    ...patches.filter(p => p.kind === 'walk').map(p => ({ id: p.surfaceId, kind: p.kind, regions: carvedPolygon(p.verticesMm), plane: affine(p.verticesMm) })),
    ...patches.filter(p => p.kind === 'apron').map(p => ({ id: p.surfaceId, kind: p.kind, regions: carvedPolygon(p.verticesMm), plane: affine(p.verticesMm) })),
    { id: host.id, kind: 'top', regions: top, plane: () => host.groundElevationMm },
  ]
  const nodes = new Map<string, PointMm>()
  // Common graph quantization is disposable and much finer than persisted mm.
  // Every edge gets the same captured intersection before segmentation.
  const node = (p: PointMm): PointMm => {
    const key = `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)}`
    const previous = nodes.get(key)
    if (previous) return previous
    const value = { x: p.x, y: p.y }; nodes.set(key, value); return value
  }
  const lines: Line[] = sources.flatMap(source => source.regions.flatMap(polygon => polygon.flatMap(ring => {
    const points = ring.map(([x, y]) => ({ x, y }))
    if (points.length > 1 && span(points[0], points.at(-1)!) <= EPS) points.pop()
    return geometry.edges(points).filter(([a, b]) => span(a, b) > EPS).map(([a, b]) => ({ a: node(a), b: node(b), cuts: [node(a), node(b)] }))
  })))
  if (lines.length > LIMITS.rawSegments || lines.length * (lines.length - 1) / 2 > LIMITS.intersectionPairs) throw Error('共同岩体排列超过线段/交点对预算。')
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i], b = lines[j], dx = a.b.x - a.a.x, dy = a.b.y - a.a.y, ex = b.b.x - b.a.x, ey = b.b.y - b.a.y
    const determinant = dx * ey - dy * ex
    if (Math.abs(determinant) > EPS) {
      const qx = b.a.x - a.a.x, qy = b.a.y - a.a.y, t = (qx * ey - qy * ex) / determinant, u = (qx * dy - qy * dx) / determinant
      if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
        const p = node(geometry.at(a.a, a.b, Math.max(0, Math.min(1, t))))
        a.cuts.push(p); b.cuts.push(p)
      }
    } else {
      for (const p of [a.a, a.b]) if (geometry.onSegment(p, b.a, b.b)) b.cuts.push(p)
      for (const p of [b.a, b.b]) if (geometry.onSegment(p, a.a, a.b)) a.cuts.push(p)
    }
  }
  const atomic = new Map<string, [PointMm, PointMm]>()
  const pointKey = (p: PointMm) => `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)}`
  for (const line of lines) {
    const points = [...new Set(line.cuts)].sort((a, b) => (a.x - b.x) * (line.b.x - line.a.x) + (a.y - b.y) * (line.b.y - line.a.y))
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      if (span(a, b) <= EPS) continue
      const ka = pointKey(a), kb = pointKey(b), key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      if (!atomic.has(key)) atomic.set(key, [a, b])
    }
  }
  const ownerAt = (p: PointMm) => sources.find(source => regionsContain(source.regions, p)) ?? null
  const walls: CarvedRockWall[] = []
  const wall = (a: PointMm, b: PointMm, left: SourceFace | null, right: SourceFace | null) => {
    const middle = geometry.at(a, b, .5), l = left?.plane(middle) ?? host.rockBody.baseElevationMm, r = right?.plane(middle) ?? host.rockBody.baseElevationMm
    if (Math.abs(l - r) <= EPS) return
    const high = l > r ? left : right, low = l > r ? right : left
    if (!high) return
    const highMm: [number, number] = [high.plane(a), high.plane(b)], lowMm: [number, number] = [low?.plane(a) ?? host.rockBody.baseElevationMm, low?.plane(b) ?? host.rockBody.baseElevationMm]
    const deltaA = highMm[0] - lowMm[0], deltaB = highMm[1] - lowMm[1]
    if (deltaA < -EPS || deltaB < -EPS) {
      const t = deltaA / (deltaA - deltaB), crossing = node(geometry.at(a, b, t))
      if (t > EPS && t < 1 - EPS) { wall(a, crossing, left, right); wall(crossing, b, left, right); return }
      throw Error('岩体壁面高低关系不连续。')
    }
    const size = span(a, b), direction = l > r ? 1 : -1
    walls.push({ a: { ...a }, b: { ...b }, normal: { x: (b.y - a.y) / size * direction || 0, y: -(b.x - a.x) / size * direction || 0 },
      kind: left && right ? 'cut' : high.kind === 'top' ? 'cliff' : 'outer', highSurfaceId: high.id, lowSurfaceId: low?.id ?? null, highMm, lowMm,
      verticesMm: [{ ...a, z: highMm[0] }, { ...b, z: highMm[1] }, { ...b, z: lowMm[1] }, { ...a, z: lowMm[0] }] })
  }
  for (const [a, b] of atomic.values()) {
    const middle = geometry.at(a, b, .5), size = span(a, b), normal = { x: -(b.y - a.y) / size, y: (b.x - a.x) / size }
    let offset = Math.min(.01, size / 100)
    for (const edge of lines) {
      const distance = distanceTo(middle, edge.a, edge.b)
      if (distance > EPS) offset = Math.min(offset, distance / 4)
    }
    if (offset <= EPS) throw Error('岩体排列出现无法可靠辨认两侧的微小裂缝。')
    const left = ownerAt({ x: middle.x + normal.x * offset, y: middle.y + normal.y * offset })
    const right = ownerAt({ x: middle.x - normal.x * offset, y: middle.y - normal.y * offset })
    wall(a, b, left, right)
  }
  return freezeJson({ hostAreaId: host.id, baseElevationMm: host.rockBody.baseElevationMm, topElevationMm: host.groundElevationMm,
    topRegionsMm: top, footprintMm: footprint, cutFootprintsMm: cuts, patches, walls })
}

export const materializeCarvedRockPlan = carvedRockFaces
