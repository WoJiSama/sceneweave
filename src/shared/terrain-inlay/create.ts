import type { PointMm, SceneDocument } from '../model/scene.js'
import { connectionArcFrame, connectionCenterline } from '../geometry/connection-route.js'
import { planTerrainInlay } from './geometry.js'
import { terrainInlayHash, terrainInlaySource } from './scene.js'
import type { TerrainInlayPoint, TerrainInlayRequest } from './contracts.js'
import type { TerrainInlayCommand } from '../commands/terrain-inlay.js'

export interface TerrainInlayOpeningIntent {
  side: 'left' | 'right'; startStation: number; endStation: number
  sourceAreaId: string; sourcePointIds: string[]
  /** Explicit authored boundary connectors, never labelled original cliff. */
  connectorsMm: PointMm[]
}
const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const length = (a: PointMm, b: PointMm) => Math.hypot(a.x - b.x, a.y - b.y)
const assert = (ok: unknown, message: string) => { if (!ok) throw Error(message) }
function triangulate(raw: string[], vertices: Record<string, TerrainInlayPoint>): [string, string, string][] {
  const ring = [...raw], points = ring.map(id => vertices[id])
  const area = points.reduce((sum, a, i) => sum + cross(points[0], a, points[(i + 1) % points.length]), 0)
  if (area < 0) ring.reverse()
  const result: [string, string, string][] = []
  while (ring.length > 3) {
    let ear = -1
    for (let i = 0; i < ring.length; i++) {
      const ids = [ring[(i + ring.length - 1) % ring.length], ring[i], ring[(i + 1) % ring.length]] as [string, string, string]
      const [a, b, c] = ids.map(id => vertices[id])
      if (cross(a, b, c) <= 1e-7) continue
      if (ring.some(id => !ids.includes(id) && cross(a, b, vertices[id]) >= -1e-7 && cross(b, c, vertices[id]) >= -1e-7 && cross(c, a, vertices[id]) >= -1e-7)) continue
      result.push(ids); ear = i; break
    }
    assert(ear >= 0, '外侧开口不能稳定分面，请调整交叉、重合或过短边。')
    ring.splice(ear, 1)
  }
  assert(ring.length === 3 && cross(...ring.map(id => vertices[id]) as [TerrainInlayPoint, TerrainInlayPoint, TerrainInlayPoint]) > 1e-7, '外侧开口末片退化。')
  result.push(ring as [string, string, string])
  // Improve only internal apron diagonals. Source/shoulder boundaries and all
  // walk faces remain exact. Ear clipping alone can fan the whole curved
  // shoulder into one remote boundary vertex and create artificial steep fins.
  let checks = 0, flips = 0
  for (;;) {
    const edges = new Map<string, { a: string; b: string; c: string; index: number }>()
    let changed = false
    scan: for (const [index, ids] of result.entries()) for (let i = 0; i < 3; i++) {
      assert(++checks <= 2_000_000, '外侧开口分面超过有限翻边工作预算。')
      const a = ids[i], b = ids[(i + 1) % 3], c = ids[(i + 2) % 3], key = [a, b].sort().join('|'), other = edges.get(key)
      if (!other) { edges.set(key, { a, b, c, index }); continue }
      const d = other.c, [pa, pb, pc, pd] = [a, b, c, d].map(id => vertices[id])
      // The replacement diagonal must lie in a strictly convex quadrilateral.
      if (cross(pc, pd, pa) * cross(pc, pd, pb) >= -1e-7) continue
      const scale = Math.max(length(pa, pd), length(pb, pd), length(pc, pd))
      const [x, y, u, v, s, t] = [(pa.x - pd.x) / scale, (pa.y - pd.y) / scale,
        (pb.x - pd.x) / scale, (pb.y - pd.y) / scale, (pc.x - pd.x) / scale, (pc.y - pd.y) / scale]
      const determinant = (x * x + y * y) * (u * t - v * s) - (u * u + v * v) * (x * t - y * s) + (s * s + t * t) * (x * v - y * u)
      // Keep cocircular/numerically uncertain diagonals stable. Strict local
      // improvement and a fresh adjacency map after EACH flip prevent cycles.
      if (determinant <= 1e-10) continue
      assert(++flips <= result.length * result.length * 4, '外侧开口分面未能在有限预算内稳定。')
      const oriented = (ids: [string, string, string]): [string, string, string] => cross(...ids.map(id => vertices[id]) as [TerrainInlayPoint, TerrainInlayPoint, TerrainInlayPoint]) > 0 ? ids : [ids[0], ids[2], ids[1]]
      result[index] = oriented([c, d, a]); result[other.index] = oriented([d, c, b])
      changed = true; break scan
    }
    if (!changed) return result
  }
}

/** Finite smooth-rise proposal from the full original XY route. This creates
 * candidate geometry only; the complete owner issues IDs/proofs on adoption. */
export function createTerrainInlayCommand(scene: SceneDocument, connectionId: string, opening?: TerrainInlayOpeningIntent): Extract<TerrainInlayCommand, { type: 'adoptTerrainInlay' }> {
  const connection = scene.terrainConnections[connectionId]
  assert(connection && !connection.carvedStrip && !connection.terrainInlay, '请先选择尚未填切的原地形连接。')
  assert(connection.from.surfaceRef.kind === 'terrainArea' && connection.to.surfaceRef.kind === 'terrainArea', '连续填切需要两端均为明确地形。')
  const sourceAreas = [connection.from, connection.to].map(end => scene.terrainAreas[end.surfaceRef.id])
  assert(sourceAreas.every(Boolean) && sourceAreas[0].id !== sourceAreas[1].id, '请选择两个不同的现存源地形。')
  const points = connectionCenterline(connection)
  assert(points.length >= 2 && points.length <= 64, '连续填切首片支持完整2–64点路线，不能抽稀绕过。')
  const frame = connectionArcFrame(points), directions = points.slice(1).map((p, i) => ({ x: (p.x - points[i].x) / length(p, points[i]), y: (p.y - points[i].y) / length(p, points[i]) }))
  const geometry: TerrainInlayRequest = { sources: sourceAreas.map(terrainInlaySource), verticesMm: {}, faces: {}, footprintVertexIds: [], walkBoundaryVertexIds: [] }
  const centerlineVertexIds: string[] = [], shoulders: { left: string; right: string; center: string }[] = []
  const radius = Math.ceil(connection.widthMm / 2) + 2
  for (let i = 0; i < points.length; i++) {
    const a = directions[Math.max(0, i - 1)], b = directions[Math.min(i, directions.length - 1)], denominator = 1 + a.x * b.x + a.y * b.y
    assert(denominator >= .5, '连续填切转角超过miter2范围，不能折返。')
    const offset = { x: Math.round((-a.y - b.y) * radius / denominator), y: Math.round((a.x + b.x) * radius / denominator) }
    const z = Math.round(sourceAreas[0].groundElevationMm + (sourceAreas[1].groundElevationMm - sourceAreas[0].groundElevationMm) * frame.distances[i] / frame.length)
    const center = `center-${i}`, left = `left-${i}`, right = `right-${i}`
    geometry.verticesMm[center] = { ...points[i], z }
    geometry.verticesMm[left] = { x: points[i].x + offset.x, y: points[i].y + offset.y, z }
    geometry.verticesMm[right] = { x: points[i].x - offset.x, y: points[i].y - offset.y, z }
    centerlineVertexIds.push(center); shoulders.push({ left, right, center })
  }
  const addFace = (raw: [string, string, string], kind: 'walk' | 'apron') => {
    const vertexIds: [string, string, string] = cross(...raw.map(id => geometry.verticesMm[id]) as [TerrainInlayPoint, TerrainInlayPoint, TerrainInlayPoint]) < 0 ? [raw[0], raw[2], raw[1]] : raw
    const id = `${kind}-${Object.keys(geometry.faces).length}`; geometry.faces[id] = { id, kind, vertexIds }
  }
  for (let i = 1; i < shoulders.length; i++) {
    const a = shoulders[i - 1], b = shoulders[i], span = length(points[i - 1], points[i])
    for (const row of [a, b]) assert(cross(points[i - 1], points[i], geometry.verticesMm[row.left]) / span >= connection.widthMm / 2
      && -cross(points[i - 1], points[i], geometry.verticesMm[row.right]) / span >= connection.widthMm / 2, '整数路肩不足完整请求净宽。')
  }
  // A short, level integer collar straddles each original transverse cap. It
  // covers lateral rounding slivers without placing a sloped triangle inside
  // the level approach. Original centre nodes and all interior stations remain.
  const collar = (row: typeof shoulders[number], tangent: PointMm, sign: number, label: string) => {
    const shift = { x: Math.round(tangent.x * sign * 3), y: Math.round(tangent.y * sign * 3) }
    const result = { left: `${label}-left`, right: `${label}-right`, center: `${label}-center` }
    for (const key of ['left', 'right', 'center'] as const) { const point = geometry.verticesMm[row[key]]; geometry.verticesMm[result[key]] = { x: point.x + shift.x, y: point.y + shift.y, z: point.z } }
    return result
  }
  assert(length(points[0], points[1]) > 16 && length(points.at(-2)!, points.at(-1)!) > 16, '两端完整路线段须长于16毫米，以容纳整数等高接入。')
  const firstOuter = collar(shoulders[0], directions[0], -1, 'from-outer'), firstInner = collar(shoulders[0], directions[0], 1, 'from-inner')
  const lastInner = collar(shoulders.at(-1)!, directions.at(-1)!, -1, 'to-inner'), lastOuter = collar(shoulders.at(-1)!, directions.at(-1)!, 1, 'to-outer')
  const walkStations = [firstOuter, shoulders[0], firstInner, ...shoulders.slice(1, -1), lastInner, shoulders.at(-1)!, lastOuter]
  for (let i = 1; i < walkStations.length; i++) {
    const a = walkStations[i - 1], b = walkStations[i]
    for (const ids of [[a.left, a.center, b.center], [a.left, b.center, b.left], [a.center, a.right, b.right], [a.center, b.right, b.center]]) addFace(ids as [string, string, string], 'walk')
  }
  if (opening) {
    assert(Number.isSafeInteger(opening.startStation) && Number.isSafeInteger(opening.endStation) && opening.startStation >= 0
      && opening.endStation < shoulders.length && opening.startStation < opening.endStation, '外侧开口需选择按路线顺序的两个不同站点。')
    const source = sourceAreas.find(area => area.id === opening.sourceAreaId)
    assert(source && opening.sourcePointIds.length >= 2 && opening.sourcePointIds.length <= 64 && new Set(opening.sourcePointIds).size === opening.sourcePointIds.length, '外侧开口须明确选择同一源面的2–64个连续原边点。')
    const indices = opening.sourcePointIds.map(id => source!.boundaryMm.findIndex(point => point.id === id))
    assert(indices.every((index, i) => index >= 0 && (!i || index === (indices[i - 1] + 1) % source!.boundaryMm.length)), '外侧开口源点必须按原环正向连续，不能暗中重映射。')
    const chosen = indices.map(index => source!.boundaryMm[index].positionMm)
    const shoulder = (i: number) => shoulders[i][opening.side], start = shoulder(opening.startStation), end = shoulder(opening.endStation)
    // This is an explicit new-candidate construction rule, not a resampling of
    // a saved result: continue the selected route's longitudinal rise toward
    // the chosen source chain. Source arc length is unrelated to route station
    // and can otherwise force a short cliff chain to climb the whole route.
    const openingHeight = (point: PointMm) => {
      const candidates = points.slice(opening.startStation + 1, opening.endStation + 1).map((b, index) => {
        const i = opening.startStation + index, a = points[i], dx = b.x - a.x, dy = b.y - a.y
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)))
        const za = geometry.verticesMm[shoulders[i].center].z, zb = geometry.verticesMm[shoulders[i + 1].center].z
        return { distance: Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy), z: Math.round(za + (zb - za) * t) }
      })
      const distance = Math.min(...candidates.map(row => row.distance)), nearest = candidates.filter(row => row.distance <= distance + 1e-6)
      assert(nearest.every(row => row.z === nearest[0].z), '外侧开口点等距对应不同高度的路线分支，请缩小开口范围或调整边点。')
      return nearest[0].z
    }
    const ring = [start]
    for (const [i, point] of chosen.entries()) {
      const id = `opening-source-${i}`; geometry.verticesMm[id] = { ...point, z: openingHeight(point) }; ring.push(id)
    }
    assert(opening.connectorsMm.length <= 8 && opening.connectorsMm.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)), '外侧开口最多8个明确整数连接点。')
    for (const [i, point] of opening.connectorsMm.entries()) { const id = `opening-connector-${i}`; geometry.verticesMm[id] = { ...point, z: openingHeight(point) }; ring.push(id) }
    const expandedShoulder = walkStations.map(row => row[opening.side]), startIndex = expandedShoulder.indexOf(start), endIndex = expandedShoulder.indexOf(end)
    ring.push(end, ...expandedShoulder.slice(startIndex + 1, endIndex).reverse())
    for (const face of triangulate(ring, geometry.verticesMm)) addFace(face, 'apron')
  }
  const entries = new Map<string, { a: string; b: string; kind: string }[]>()
  for (const face of Object.values(geometry.faces)) for (let i = 0; i < 3; i++) {
    const a = face.vertexIds[i], b = face.vertexIds[(i + 1) % 3], key = [a, b].sort().join('|'), row = entries.get(key) ?? []
    row.push({ a, b, kind: face.kind }); entries.set(key, row)
  }
  const boundary = (walkOnly: boolean) => {
    const rows = [...entries.values()].map(rows => walkOnly ? rows.filter(row => row.kind === 'walk') : rows).filter(rows => rows.length === 1).map(rows => rows[0])
    const next = new Map(rows.map(row => [row.a, row.b])), ring: string[] = [], start = rows[0]?.a
    assert(start && next.size === rows.length, '实际边界存在分叉。')
    let id = start
    do { assert(id && !ring.includes(id), '实际边界不连续。'); ring.push(id); id = next.get(id)! } while (id !== start)
    assert(ring.length === rows.length, '实际面存在多重外环。'); return ring
  }
  geometry.footprintVertexIds = boundary(false); geometry.walkBoundaryVertexIds = boundary(true)
  planTerrainInlay(geometry)
  return { type: 'adoptTerrainInlay', id: connectionId, geometry, centerlineVertexIds, expectedConnectionHash: terrainInlayHash(connection) }
}
