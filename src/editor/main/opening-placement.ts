import type { PointMm, SceneDocument } from '../../shared/model/scene'

/** Resolve only a wall the user actually clicked. Domain preview remains authoritative. */
export function openingAtPoint(scene: SceneDocument, point: PointMm, widthMm: number, hiddenIds: ReadonlySet<string> = new Set()) {
  if (!Number.isSafeInteger(widthMm) || widthMm < 400) throw new Error('门窗净宽至少为 0.4 米。')
  const hits = Object.values(scene.walls).flatMap(wall => {
    if (hiddenIds.has(wall.id)) return []
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    const dx = b.xMm - a.xMm, dy = b.yMm - a.yMm, length = Math.hypot(dx, dy)
    if (!length) return []
    const t = ((point.x - a.xMm) * dx + (point.y - a.yMm) * dy) / (length * length)
    if (t < 0 || t > 1) return []
    const distance = Math.hypot(point.x - a.xMm - t * dx, point.y - a.yMm - t * dy)
    return distance <= Math.max(250, wall.thicknessMm / 2 + 100) ? [{ wall, distance, length, offsetMm: Math.round(t * length - widthMm / 2) }] : []
  }).sort((a, b) => a.distance - b.distance)
  if (!hits.length) throw new Error('请点击要开门窗的墙面。可以先放大地图，再选择准确位置。')
  if (hits[1] && Math.abs(hits[0].distance - hits[1].distance) < 1) throw new Error('这里有多面墙，请沿目标墙稍微移开墙角后再点击。')
  const { wall, offsetMm, length } = hits[0]
  if (wall.editLocked || scene.userLayers[scene.entityLayers[wall.id]]?.editLocked) throw new Error('这面墙或所在图层已锁定。请先在属性或图层中解除编辑锁。')
  if (offsetMm < 0 || offsetMm + widthMm > length) throw new Error('门窗距墙角太近，放不下当前宽度。请向墙中间移动，或减小净宽。')
  return { wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm, widthMm }
}
