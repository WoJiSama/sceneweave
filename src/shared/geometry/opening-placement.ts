import type { PointMm, SceneDocument, Wall } from '../model/scene.js'

/** Resolve a requested centre to one actual wall segment and its saved
 * start-relative measurement. Native opening validation checks the result. */
export function wallOpeningAtPoint(scene: SceneDocument, point: PointMm, widthMm: number, allows: (wall: Wall) => boolean) {
  const hits = Object.values(scene.walls).flatMap(wall => {
    if (!allows(wall)) return []
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    const dx = b.xMm - a.xMm, dy = b.yMm - a.yMm, length = Math.hypot(dx, dy)
    if (!length) return []
    const t = ((point.x - a.xMm) * dx + (point.y - a.yMm) * dy) / (length * length)
    if (t < 0 || t > 1) return []
    const distance = Math.hypot(point.x - a.xMm - t * dx, point.y - a.yMm - t * dy)
    return distance <= Math.max(250, wall.thicknessMm / 2 + 100) ? [{ wall, distance, length, offsetMm: Math.round(t * length - widthMm / 2) }] : []
  }).sort((a, b) => a.distance - b.distance)
  if (!hits.length) throw new Error('请点击要开门窗的墙面，或把开口中心放在目标墙上。')
  if (hits[1] && Math.abs(hits[0].distance - hits[1].distance) < 1) throw new Error('这里有多面墙，请沿目标墙向内移开墙角。')
  const { wall, offsetMm, length } = hits[0], clearance = scene.constraints.wallEndClearanceMm
  if (offsetMm < clearance || offsetMm + widthMm + clearance > length) throw new Error('门窗距墙角太近，放不下当前宽度。请向墙中间移动，或减小净宽。')
  return { wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm, widthMm }
}
