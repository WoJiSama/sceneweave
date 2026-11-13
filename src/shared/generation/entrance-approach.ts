import type { PointMm, BoundsMm } from '../model/scene.js'
import type { BuildingEntrancePort } from './building-port.js'

export const ENTRANCE_APPROACH_LIMITS = Object.freeze({ viaPoints: 16, variants: 7 })
type Input = { port: BuildingEntrancePort; fromMm: PointMm; viaMm: readonly PointMm[]; buildingBoundsMm: BoundsMm; wallThicknessMm: number }
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const integerPoint = (p: PointMm) => p && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y)

/** Version 3's finite suggestions only. The caller must check both the whole
 * physical road band and its continuation through the actual doorway before
 * publishing any suggestion. Explicit waypoints stay in their original order. */
export function planBuildingEntranceApproaches(input: Input): { leadMm: number; leadPointMm: PointMm; variantsMm: PointMm[][] } {
  const { port, fromMm, viaMm, buildingBoundsMm: b, wallThicknessMm } = input
  if (!Array.isArray(viaMm) || viaMm.length > ENTRANCE_APPROACH_LIMITS.viaPoints
    || ![fromMm, ...viaMm, port.positionMm, port.outsideMm, port.insideMm].every(integerPoint)
    || ![b.x, b.y, b.width, b.height, wallThicknessMm, port.widthMm].every(Number.isSafeInteger)
    || b.width <= 0 || b.height <= 0 || wallThicknessMm <= 0 || port.widthMm <= 0 || port.widthMm > 5000) throw new Error('门前法向接入需要有限整数坐标、真实端口及正整数尺寸。')
  // Derive the exact cardinal vector from the certified port's real anchors;
  // trig rounding must not move a persisted integer-millimetre road endpoint.
  const dx = port.outsideMm.x - port.positionMm.x, dy = port.outsideMm.y - port.positionMm.y
  const normal = { x: Math.sign(dx), y: Math.sign(dy) }
  if (Math.abs(normal.x) + Math.abs(normal.y) !== 1
    || port.insideMm.x - port.positionMm.x !== -dx || port.insideMm.y - port.positionMm.y !== -dy
    || port.directionDeg !== (normal.x === 1 ? 0 : normal.x === -1 ? 180 : normal.y === 1 ? 90 : 270)) throw new Error('门前法向接入需要一致的正交室内外端口。')
  const margin = Math.ceil(wallThicknessMm / 2) + Math.ceil(port.widthMm / 2) + 2
  const leadMm = Math.max(port.widthMm, margin)
  const leadPointMm = { x: port.outsideMm.x + normal.x * leadMm, y: port.outsideMm.y + normal.y * leadMm }
  const prefix = [fromMm, ...viaMm], from = prefix[prefix.length - 1], to = leadPointMm
  const extensions: PointMm[][] = [
    [to], [{ x: from.x, y: to.y }, to], [{ x: to.x, y: from.y }, to],
    ...[b.x - margin, b.x + b.width + margin].map(x => [{ x, y: from.y }, { x, y: to.y }, to]),
    ...[b.y - margin, b.y + b.height + margin].map(y => [{ x: from.x, y }, { x: to.x, y }, to]),
  ]
  const variantsMm = extensions.map(extension => [...prefix, ...extension, port.outsideMm]
    .filter((point, index, points) => index === 0 || !same(point, points[index - 1]))
    .map(point => ({ ...point })))
  if (!variantsMm.every(points => points.every(integerPoint))) throw new Error('门前法向接入超出整数毫米范围。')
  return { leadMm, leadPointMm: { ...leadPointMm }, variantsMm: [...new Map(variantsMm.map(points => [JSON.stringify(points), points])).values()] }
}
