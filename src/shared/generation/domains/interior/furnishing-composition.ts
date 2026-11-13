import type { PropDefinition } from '../../../model/scene.js'
import type { InteriorRectangle } from './contracts.js'
import { furnitureBoundsPolygon, type FurnitureAnchor, type FurnishingPose, type FurnishingShape } from './furnishing-poses.js'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export const isDiningPurpose = (purpose: string) => /餐厅|餐室|酒馆|食堂|dining|tavern|canteen/i.test(purpose)
export const isSeatedGroupPurpose = (purpose: string) => /书房|办公|研究|study|office|library|接待|会客|reception|lounge|consultation/i.test(purpose)
const envelope = (shape: FurnishingShape, pose: FurnishingPose) => {
  const points = [shape.visualBoundsMm, { x: shape.footprintOffsetMm.x - shape.footprintMm.width / 2,
    y: shape.footprintOffsetMm.y - shape.footprintMm.height / 2, ...shape.footprintMm }].flatMap(box => furnitureBoundsPolygon(box, pose))
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) }
}

/** A proposed single-sided work unit uses this geometric edge for its seats.
 * This is neither an authored usable-side claim nor a permanent relationship.
 * Square and retained arbitrary-angle surfaces keep neutral seat suggestions. */
export function singleSidedSeatRotation(shape: FurnishingShape, pose: FurnishingPose): number | undefined {
  if (!Number.isInteger(pose.rotationDeg / 90)) return undefined
  const box = envelope(shape, pose), width = box.right - box.left, height = box.bottom - box.top
  const positive = ((pose.rotationDeg % 360 + 360) % 360) < 180
  return width > height * 1.15 ? positive ? 180 : 0 : height > width * 1.15 ? positive ? 90 : 270 : undefined
}

/** v14 ranks the complete candidate stream by actual table long axes. Group
 * and independent fallback poses share this preference; none is removed.
 * Different authored table orientations are compared in world space. Square
 * tables and non-cardinal retained anchors do not invent a preferred axis. */
export function preferDiningOrientation(options: { poses: readonly FurnishingPose[]; shape: FurnishingShape;
  anchors: readonly FurnitureAnchor[]; checkCancelled: () => void; charge: () => void }): FurnishingPose[] {
  options.checkCancelled()
  const axis = (shape: FurnishingShape, rotationDeg: number) => {
    const box = envelope(shape, { positionMm: { x: 0, y: 0 }, rotationDeg: 0 })
    const width = box.right - box.left, height = box.bottom - box.top
    return width === height ? undefined : ((rotationDeg + (height > width ? 90 : 0)) % 180 + 180) % 180
  }
  const anchors = options.anchors.flatMap(anchor => {
    options.checkCancelled(); options.charge()
    const orientation = axis(anchor, anchor.rotationDeg)
    return anchor.role === 'table' && Number.isInteger(anchor.rotationDeg / 90) && orientation !== undefined ? [{ anchor, orientation }] : []
  }).sort((a, b) => a.anchor.positionMm.y - b.anchor.positionMm.y || a.anchor.positionMm.x - b.anchor.positionMm.x
    || a.orientation - b.orientation || a.anchor.rotationDeg - b.anchor.rotationDeg)
  const preferred = anchors[0]?.orientation
  if (preferred === undefined) return [...options.poses]
  return options.poses.map((pose, index) => {
    options.checkCancelled(); options.charge()
    return { pose, index, parallel: axis(options.shape, pose.rotationDeg) === preferred ? 0 : 1 }
  }).sort((a, b) => a.parallel - b.parallel || a.index - b.index).map(row => row.pose)
}

/** Finite v12 dining preferences. The envelope includes complete fixed chair
 * depth, the 180mm table gap and 600mm rear use space on the long edges (all
 * edges for square tables). This only proposes aligned groups: real seats,
 * support, painted bodies and full door routes are still checked by the caller.
 * No chair/table dimension is altered and no persistent pairing is inferred. */
export function diningGroupCandidates(options: { bounds: InteriorRectangle; inset: number; shape: FurnishingShape;
  seats: readonly PropDefinition[]; anchors: readonly FurnitureAnchor[]; tableCount: number; rank: (key: string) => string;
  retainedRotation?: number; checkCancelled: () => void; charge: () => void; alignToBounds?: boolean; singleSided?: boolean }): FurnishingPose[] {
  const { bounds, inset } = options, gap = 800, zero = { x: 0, y: 0 }
  let depth = 0
  for (const seat of options.seats) {
    options.checkCancelled(); options.charge()
    depth = Math.max(depth, Math.max(seat.defaultVisualBoundsMm.y + seat.defaultVisualBoundsMm.height,
      seat.defaultFootprintOffsetMm.y + seat.defaultFootprintMm.height / 2) - Math.min(seat.defaultVisualBoundsMm.y,
      seat.defaultFootprintOffsetMm.y - seat.defaultFootprintMm.height / 2))
  }
  if (!depth) return []
  const unit = (shape: FurnishingShape, pose: FurnishingPose) => {
    const box = envelope(shape, pose), w = box.right - box.left, h = box.bottom - box.top, extension = depth + 780
    const x = w < h * 1.15 ? extension : 0, y = h < w * 1.15 ? extension : 0
    // v19 work units can reserve one actual side rather than spending both
    // chair strips. The caller must plan full seats on that proposed side and
    // independently verify their bodies, use space and real door connections.
    const positive = ((pose.rotationDeg % 360 + 360) % 360) < 180
    return { left: box.left - (options.singleSided && positive ? 0 : x), right: box.right + (options.singleSided && !positive ? 0 : x),
      top: box.top - (options.singleSided && positive ? 0 : y), bottom: box.bottom + (options.singleSided && !positive ? 0 : y) }
  }
  const rows: { pose: FurnishingPose; priority: number; score: number; key: string }[] = []
  const add = (pose: FurnishingPose, priority: number, score: number) => {
    options.checkCancelled(); options.charge()
    const box = unit(options.shape, pose)
    if (box.left < bounds.x + inset || box.right > bounds.x + bounds.width - inset
      || box.top < bounds.y + inset || box.bottom > bounds.y + bounds.height - inset) return
    rows.push({ pose, priority, score, key: `${pose.positionMm.x}/${pose.positionMm.y}/${pose.rotationDeg}` })
  }
  const anchors = [...options.anchors].filter(a => a.role === 'table' && Number.isInteger(a.rotationDeg / 90))
    .sort((a, b) => a.positionMm.y - b.positionMm.y || a.positionMm.x - b.positionMm.x || a.rotationDeg - b.rotationDeg).slice(0, 8)
  for (const anchor of anchors) {
    const rotationDeg = options.retainedRotation ?? anchor.rotationDeg
    if (!Number.isInteger(rotationDeg / 90)) continue
    const other = unit(anchor, anchor), own = unit(options.shape, { positionMm: zero, rotationDeg })
    for (const side of [0, 1, 2, 3]) {
      const x = side === 1 ? other.right + gap - own.left : side === 3 ? other.left - gap - own.right : (other.left + other.right - own.left - own.right) / 2
      const y = side === 0 ? other.top - gap - own.bottom : side === 2 ? other.bottom + gap - own.top : (other.top + other.bottom - own.top - own.bottom) / 2
      add({ positionMm: { x: Math.round(x), y: Math.round(y) }, rotationDeg }, 0,
        Math.hypot(x - anchor.positionMm.x, y - anchor.positionMm.y))
    }
  }
  const rotations = options.retainedRotation === undefined ? options.singleSided ? [0, 90, 180, 270] : [0, 90] : [options.retainedRotation]
  for (const rotationDeg of rotations) {
    if (!Number.isInteger(rotationDeg / 90)) continue
    const own = unit(options.shape, { positionMm: zero, rotationDeg }), w = own.right - own.left, h = own.bottom - own.top
    const availableW = bounds.width - 2 * inset, availableH = bounds.height - 2 * inset
    const maxColumns = Math.min(16, Math.max(1, options.tableCount), Math.floor((availableW + gap) / (w + gap)))
    for (let columns = 1; columns <= maxColumns; columns++) {
      options.checkCancelled(); options.charge()
      const count = Math.min(16, Math.max(1, options.tableCount)), lines = Math.ceil(count / columns)
      const bankW = columns * w + (columns - 1) * gap, bankH = lines * h + (lines - 1) * gap
      if (bankH > availableH) continue
      const score = Math.abs(Math.log(bankW / bankH / (availableW / availableH)))
      // Whole banks can use their actual spare margin to clear door approaches;
      // this changes neither member dimensions nor the complete use envelope.
      const offsets = options.alignToBounds ? [.5, 0, 1] : [.5]
      for (const fx of offsets) for (const fy of offsets) for (let row = 0; row < lines; row++) for (let col = 0; col < columns; col++) add({ positionMm: {
        x: Math.round(bounds.x + inset + (availableW - bankW) * fx + col * (w + gap) - own.left),
        y: Math.round(bounds.y + inset + (availableH - bankH) * fy + row * (h + gap) - own.top),
      }, rotationDeg }, 1, score)
    }
  }
  const ordered = rows.sort((a, b) => a.priority - b.priority || a.score - b.score || compare(options.rank(a.key), options.rank(b.key)) || compare(a.key, b.key))
  const unique = new Map<string, FurnishingPose>()
  for (const row of ordered) if (!unique.has(row.key)) unique.set(row.key, row.pose)
  return [...unique.values()].slice(0, 96)
}
