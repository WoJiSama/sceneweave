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
  result.push(ring as [string, string, string]); return result
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
    if (i === 0 || i === points.length - 1) {
      const tangent = i === 0 ? directions[0] : directions.at(-1)!, sign = i === 0 ? -1 : 1
      // Integer lateral rounding may move a shoulder just inside the original
      // transverse cap. Move only that shoulder outward on the dominant axis,
      // preserving the exact centre node and full requested end cross-section.
      for (const id of [left, right]) {
        const vertex = geometry.verticesMm[id], projection = sign * ((vertex.x - points[i].x) * tangent.x + (vertex.y - points[i].y) * tangent.y)
        if (projection < 0) {
          const axis = Math.abs(tangent.x) >= Math.abs(tangent.y) ? 'x' : 'y'
          vertex[axis] += sign * Math.sign(tangent[axis]) * Math.ceil(-projection / Math.abs(tangent[axis]))
        }
      }
    }
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
    for (const ids of [[a.left, a.center, b.center], [a.left, b.center, b.left], [a.center, a.right, b.right], [a.center, b.right, b.center]]) addFace(ids as [string, string, string], 'walk')
  }
  if (opening) {
    assert(Number.isSafeInteger(opening.startStation) && Number.isSafeInteger(opening.endStation) && opening.startStation >= 0
      && opening.endStation < shoulders.length && opening.startStation < opening.endStation, '外侧开口需选择按路线顺序的两个不同站点。')
    const source = sourceAreas.find(area => area.id === opening.sourceAreaId)
    assert(source && opening.sourcePointIds.length >= 2 && opening.sourcePointIds.length <= 64 && new Set(opening.sourcePointIds).size === opening.sourcePointIds.length, '外侧开口须明确选择同一源面的2–64个连续原边点。')
    const indices = opening.sourcePointIds.map(id => source!.boundaryMm.findIndex(point => point.id === id))
    assert(indices.every((index, i) => index >= 0 && (!i || index === (indices[i - 1] + 1) % source!.boundaryMm.length)), '外侧开口源点必须按原环正向连续，不能暗中重映射。')
    const chosen = indices.map(index => source!.boundaryMm[index].positionMm), distances = [0]
    for (let i = 1; i < chosen.length; i++) distances.push(distances.at(-1)! + length(chosen[i - 1], chosen[i]))
    const shoulder = (i: number) => shoulders[i][opening.side], start = shoulder(opening.startStation), end = shoulder(opening.endStation)
    const z0 = geometry.verticesMm[start].z, z1 = geometry.verticesMm[end].z, ring = [start]
    for (const [i, point] of chosen.entries()) {
      const id = `opening-source-${i}`; geometry.verticesMm[id] = { ...point, z: Math.round(z0 + (z1 - z0) * distances[i] / distances.at(-1)!) }; ring.push(id)
    }
    assert(opening.connectorsMm.length <= 8 && opening.connectorsMm.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)), '外侧开口最多8个明确整数连接点。')
    for (const [i, point] of opening.connectorsMm.entries()) { const id = `opening-connector-${i}`; geometry.verticesMm[id] = { ...point, z: z1 }; ring.push(id) }
    ring.push(end, ...Array.from({ length: opening.endStation - opening.startStation - 1 }, (_, i) => shoulder(opening.endStation - i - 1)))
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
