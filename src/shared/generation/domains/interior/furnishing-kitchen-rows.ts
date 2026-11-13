import type { InteriorFurnitureRole, InteriorRectangle } from './contracts.js'
import { furnitureBoundsPolygon, type FurnishingPose, type FurnishingShape } from './furnishing-poses.js'
import type { KitchenFurnitureAnchor } from './furnishing-groups.js'

/** A common back plane for an opposing run must allow the deepest fixed
 * station, rather than changing with each cupboard's or shelf's depth. */
export function kitchenParallelRunCandidates(options: {
  bounds: InteriorRectangle; shape: FurnishingShape; inset: number; role: InteriorFurnitureRole
  anchors: readonly KitchenFurnitureAnchor[]; shapes: readonly FurnishingShape[]
  rank: (key: string) => string; retainedRotation?: number; checkCancelled: () => void; charge: () => void
}): FurnishingPose[] {
  if (!['work', 'hearth', 'storage', 'shelf'].includes(options.role)) return []
  const localBounds = (shape: FurnishingShape) => ({
    left: Math.min(shape.visualBoundsMm.x, shape.footprintOffsetMm.x - shape.footprintMm.width / 2),
    right: Math.max(shape.visualBoundsMm.x + shape.visualBoundsMm.width, shape.footprintOffsetMm.x + shape.footprintMm.width / 2),
    back: Math.min(shape.visualBoundsMm.y, shape.footprintOffsetMm.y - shape.footprintMm.height / 2),
    front: Math.max(shape.visualBoundsMm.y + shape.visualBoundsMm.height, shape.footprintOffsetMm.y + shape.footprintMm.height / 2),
  })
  const rotate = (p: { x: number; y: number }, rotation: number) => rotation === 0 ? p : rotation === 90 ? { x: -p.y, y: p.x }
    : rotation === 180 ? { x: -p.x, y: -p.y } : { x: p.y, y: -p.x }
  let depth = 0
  for (const shape of [options.shape, ...options.shapes]) {
    options.checkCancelled(); options.charge()
    const bounds = localBounds(shape)
    depth = Math.max(depth, bounds.front - bounds.back)
  }
  const runs = new Map<string, { rotation: number; back: number; front: number; left: number; right: number; primary: boolean }>()
  for (const anchor of [...options.anchors].sort((a, b) => a.positionMm.y - b.positionMm.y || a.positionMm.x - b.positionMm.x).slice(0, 16)) {
    options.checkCancelled(); options.charge()
    if (!['work', 'hearth', 'storage', 'shelf'].includes(anchor.role)) continue
    const rotation = ((anchor.rotationDeg % 360) + 360) % 360
    if (!Number.isInteger(rotation / 90)) continue
    const position = rotate(anchor.positionMm, (360 - rotation) % 360), own = localBounds(anchor)
    const back = position.y + own.back, key = `${rotation}/${back}`
    const run = runs.get(key), primary = anchor.role === 'work' || anchor.role === 'hearth'
    if (run) {
      run.left = Math.min(run.left, position.x + own.left); run.right = Math.max(run.right, position.x + own.right)
      run.front = Math.max(run.front, position.y + own.front); run.primary ||= primary
    } else runs.set(key, { rotation, back, front: position.y + own.front, left: position.x + own.left, right: position.x + own.right, primary })
  }
  const own = localBounds(options.shape), rows = new Map<string, FurnishingPose>()
  for (const run of runs.values()) {
    options.checkCancelled(); options.charge()
    const rotationDeg = (run.rotation + 180) % 360
    if (!run.primary || options.retainedRotation !== undefined && options.retainedRotation !== rotationDeg) continue
    // The opposite shape's authored back becomes its positive-Y edge here.
    const y = run.front + 1600 + depth + own.back
    for (const x of [run.left + own.right, run.right + own.left, (run.left + run.right + own.left + own.right) / 2]) {
      options.checkCancelled(); options.charge()
      const position = rotate({ x, y }, run.rotation), pose = { positionMm: { x: Math.round(position.x), y: Math.round(position.y) }, rotationDeg }
      const physical = { x: options.shape.footprintOffsetMm.x - options.shape.footprintMm.width / 2,
        y: options.shape.footprintOffsetMm.y - options.shape.footprintMm.height / 2, ...options.shape.footprintMm }
      const points = [options.shape.visualBoundsMm, physical].flatMap(box => furnitureBoundsPolygon(box, pose))
      const { bounds, inset } = options
      if (points.some(p => p.x < bounds.x + inset || p.x > bounds.x + bounds.width - inset
        || p.y < bounds.y + inset || p.y > bounds.y + bounds.height - inset)) continue
      rows.set(`${pose.positionMm.x}/${pose.positionMm.y}/${rotationDeg}`, pose)
    }
  }
  return [...rows].map(([key, pose]) => ({ key, pose, rank: options.rank(key) }))
    .sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(row => row.pose)
}

/** Start an opposite run against the room boundary before trying a floating
 * island. Its back is shared by later straight continuations, regardless of
 * the different depths of the first run's worktops, cupboards and hearth.
 * These are suggestions only: complete use areas, native support, doors and
 * access routes still decide whether a pose can actually be adopted. */
export function kitchenWallRowCandidates(options: {
  bounds: InteriorRectangle; shape: FurnishingShape; inset: number; role: InteriorFurnitureRole
  anchors: readonly KitchenFurnitureAnchor[]; rank: (key: string) => string; retainedRotation?: number
  checkCancelled: () => void; charge: () => void
}): FurnishingPose[] {
  const { bounds, shape, inset } = options
  if (!['work', 'hearth', 'storage', 'shelf'].includes(options.role)) return []
  const references = [...options.anchors].filter(anchor => anchor.role === 'work' || anchor.role === 'hearth')
    .sort((a, b) => a.positionMm.y - b.positionMm.y || a.positionMm.x - b.positionMm.x || a.rotationDeg - b.rotationDeg).slice(0, 16)
  const physical = { x: shape.footprintOffsetMm.x - shape.footprintMm.width / 2,
    y: shape.footprintOffsetMm.y - shape.footprintMm.height / 2, ...shape.footprintMm }
  const candidates = new Map<string, { pose: FurnishingPose; end: boolean }>()
  for (const anchor of references) {
    options.checkCancelled(); options.charge()
    const rotation = ((anchor.rotationDeg % 360) + 360) % 360, rotationDeg = (rotation + 180) % 360
    if (!Number.isInteger(rotation / 90) || options.retainedRotation !== undefined && options.retainedRotation !== rotationDeg) continue
    const points = [shape.visualBoundsMm, physical].flatMap(box => furnitureBoundsPolygon(box, { positionMm: { x: 0, y: 0 }, rotationDeg }))
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
    const left = Math.ceil(bounds.x + inset - minX), right = Math.floor(bounds.x + bounds.width - inset - maxX)
    const top = Math.ceil(bounds.y + inset - minY), bottom = Math.floor(bounds.y + bounds.height - inset - maxY)
    if (left > right || top > bottom) continue
    const horizontal = rotation === 0 || rotation === 180
    const anchorPhysical = { x: anchor.footprintOffsetMm.x - anchor.footprintMm.width / 2,
      y: anchor.footprintOffsetMm.y - anchor.footprintMm.height / 2, ...anchor.footprintMm }
    const anchorPoints = [anchor.visualBoundsMm, anchorPhysical].flatMap(box => furnitureBoundsPolygon(box, anchor))
    const values = anchorPoints.map(p => horizontal ? p.x : p.y)
    const low = Math.min(...values), high = Math.max(...values)
    const ownLow = horizontal ? minX : minY, ownHigh = horizontal ? maxX : maxY
    const start = horizontal ? left : top, end = horizontal ? right : bottom
    for (const raw of [start, end, low - ownLow, high - ownHigh, (low + high - ownLow - ownHigh) / 2]) {
      options.checkCancelled(); options.charge()
      const along = Math.round(raw)
      if (along < start || along > end) continue
      const positionMm = horizontal ? { x: along, y: rotationDeg === 0 ? top : bottom }
        : { x: rotationDeg === 90 ? right : left, y: along }
      const pose = { positionMm, rotationDeg }, key = `${positionMm.x}/${positionMm.y}/${rotationDeg}`
      if (!candidates.has(key)) candidates.set(key, { pose, end: along === start || along === end })
    }
  }
  const ranked = [...candidates].map(([key, value]) => ({ ...value, key, rank: options.rank(key) }))
  return ranked.sort((a, b) => Number(b.end) - Number(a.end) || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map(row => row.pose)
}
