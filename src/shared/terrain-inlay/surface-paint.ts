import type { PointMm } from '../model/scene.js'
import type { ProjectedTerrainInlay } from '../projection/types.js'
import { connectionArcFrame } from '../geometry/connection-route.js'

/** Disposable lighting of the actual whole slope. Shared XYZ nodes use one
 * normal across walk/apron: the clearance boundary is never a shading seam.
 * Return boundaries meet a flat source, so their top shading tends to flat. */
export function terrainSlopeShades(inlay: ProjectedTerrainInlay, lightDirectionDeg: number) {
  const angle = lightDirectionDeg * Math.PI / 180, light = [Math.cos(angle) / Math.SQRT2, Math.sin(angle) / Math.SQRT2, 1 / Math.SQRT2]
  const key = (p: PointMm, z: number) => `${p.x},${p.y},${z}`
  const normals = new Map<string, number[]>(), boundary = new Set(inlay.footprintMm.map(p => `${p.x},${p.y}`))
  for (const patch of inlay.patches) {
    const [a, b, c] = patch.pointsMm.map((p, i) => ({ ...p, z: patch.elevationsMm[i] }))
    const n = [(b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
      (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)]
    for (let i = 0; i < 3; i++) {
      const id = key(patch.pointsMm[i], patch.elevationsMm[i]), old = normals.get(id) ?? [0, 0, 0]
      normals.set(id, old.map((v, j) => v + n[j]))
    }
  }
  return inlay.patches.map(patch => ({ pointsMm: patch.pointsMm, opacity: patch.pointsMm.map((p, i) => {
    if (boundary.has(`${p.x},${p.y}`)) return 0
    const n = normals.get(key(p, patch.elevationsMm[i]))!, length = Math.hypot(...n)
    const lit = Math.max(0, n.reduce((sum, v, i) => sum + v / length * light[i], 0))
    return Math.max(0, Math.min(.48, (1 - (.48 + .52 * lit) / (.48 + .52 * light[2])) * .78))
  }) }))
}

/** World-arc-length finish on the actual saved walk. Rendering clips every
 * mark to its complete footprint; this creates neither support nor a step mesh. */
export function terrainSlopeTreads(inlay: ProjectedTerrainInlay): { pointsMm: PointMm[]; dropMm: number }[] {
  if (inlay.finish?.kind !== 'steps') return []
  const route = inlay.finishRoute
  if (!route) throw Error('坡面踏步缺少已过滤的实际路线。')
  const frame = connectionArcFrame(route.centerlineMm), depth = inlay.finish.treadDepthMm
  if (Math.ceil(frame.length / depth) > 512) throw Error('坡面踏步超过512级绘制预算。')
  const elevation = (distance: number) => {
    const p = frame.station(distance).positionMm
    for (const patch of inlay.patches) {
      if (patch.kind !== 'walk') continue
      const [a, b, c] = patch.pointsMm, cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      const area = cross(a, b, c), weights = [cross(p, b, c) / area, cross(a, p, c) / area, cross(a, b, p) / area]
      if (weights.every(w => w >= -1e-7)) return weights.reduce((sum, w, i) => sum + w * patch.elevationsMm[i], 0)
    }
    throw Error('坡面踏步路线离开实际完整通行面。')
  }
  const result: { pointsMm: PointMm[]; dropMm: number }[] = []
  for (let station = depth; station < frame.length; station += depth) {
    const { positionMm: p, tangent: t, normal: n } = frame.station(station), width = route.widthMm
    const dropMm = Math.abs(elevation(Math.min(frame.length, station + depth / 2)) - elevation(Math.max(0, station - depth / 2)))
    if (dropMm < .5) continue
    result.push({ pointsMm: [-.5, -.22, .08, .31, .5].map((u, i) => {
      const shift = Math.sin(station / 137 + i * 2.3) * Math.min(24, depth * .07)
      return { x: p.x + n.x * width * u + t.x * shift, y: p.y + n.y * width * u + t.y * shift }
    }), dropMm })
  }
  return result
}
