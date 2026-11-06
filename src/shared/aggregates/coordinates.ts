import type { AggregateFrame } from '../model/aggregate.js'
import type { BoundsMm, PointMm } from '../model/scene.js'

type QuarterTurns = AggregateFrame['quarterTurns']
type ExactPoint = { x: bigint; y: bigint }
const MAX_SAFE_MM = BigInt(Number.MAX_SAFE_INTEGER)

/** Capture only own, enumerable data fields; never evaluate caller accessors. */
function fields(input: unknown, names: readonly string[], label: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label}须为普通对象。`)
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label}须为普通对象。`)
  const keys = Reflect.ownKeys(input)
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) throw new Error(`${label}包含未知或缺失字段。`)
  const captured: Record<string, unknown> = {}
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error(`${label}不接受访问器或隐藏字段。`)
    captured[name] = descriptor.value
  }
  return captured
}

function integer(input: unknown, label: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) throw new Error(`${label}须为安全整数毫米。`)
  return input === 0 ? 0 : input
}

function point(input: unknown): PointMm {
  const value = fields(input, ['x', 'y'], '坐标')
  return Object.freeze({ x: integer(value.x, 'x'), y: integer(value.y, 'y') })
}

function bounds(input: unknown): BoundsMm {
  const value = fields(input, ['x', 'y', 'width', 'height'], '边界')
  const result = {
    x: integer(value.x, 'x'), y: integer(value.y, 'y'),
    width: integer(value.width, 'width'), height: integer(value.height, 'height'),
  }
  if (result.width <= 0 || result.height <= 0) throw new Error('边界尺寸须为正整数毫米。')
  return Object.freeze(result)
}

function safe(value: bigint): number {
  if (value < -MAX_SAFE_MM || value > MAX_SAFE_MM) throw new Error('变换结果超出安全整数毫米范围。')
  return Number(value)
}

function exact(value: PointMm): ExactPoint { return { x: BigInt(value.x), y: BigInt(value.y) } }
function resultPoint(value: ExactPoint): PointMm { return Object.freeze({ x: safe(value.x), y: safe(value.y) }) }
function inverseTurns(turns: QuarterTurns): QuarterTurns { return ((4 - turns) % 4) as QuarterTurns }
function rotate(value: ExactPoint, turns: QuarterTurns): ExactPoint {
  switch (turns) {
    case 0: return { x: value.x, y: value.y }
    case 1: return { x: -value.y, y: value.x }
    case 2: return { x: -value.x, y: -value.y }
    case 3: return { x: value.y, y: -value.x }
  }
}
function transform(frame: AggregateFrame, value: ExactPoint, inverse = false): ExactPoint {
  const translation = exact(frame.translationMm)
  if (inverse) return rotate({ x: value.x - translation.x, y: value.y - translation.y }, inverseTurns(frame.quarterTurns))
  const rotated = rotate(value, frame.quarterTurns)
  return { x: rotated.x + translation.x, y: rotated.y + translation.y }
}
function resultFrame(translation: ExactPoint, quarterTurns: QuarterTurns): AggregateFrame {
  return Object.freeze({ translationMm: resultPoint(translation), quarterTurns })
}

/** Exact rigid frame: p_parent = R(quarterTurns) * p_local + translationMm.
 * Positive turns use (x,y) -> (-y,x), matching existing scene transforms.
 * Parsing captures a detached frozen value; it grants no scene-edit proof. */
export function parseAggregateFrame(input: unknown): AggregateFrame {
  const value = fields(input, ['translationMm', 'quarterTurns'], '聚合坐标系')
  if (value.quarterTurns !== 0 && value.quarterTurns !== 1 && value.quarterTurns !== 2 && value.quarterTurns !== 3) throw new Error('聚合旋转只接受0至3个四分之一圈。')
  return Object.freeze({ translationMm: point(value.translationMm), quarterTurns: value.quarterTurns === 0 ? 0 : value.quarterTurns })
}

/** Parent after child: the returned frame maps child-local directly to world. */
export function composeAggregateFrames(parent: AggregateFrame, child: AggregateFrame): AggregateFrame {
  const parentFrame = parseAggregateFrame(parent), childFrame = parseAggregateFrame(child)
  return resultFrame(transform(parentFrame, exact(childFrame.translationMm)), ((parentFrame.quarterTurns + childFrame.quarterTurns) % 4) as QuarterTurns)
}

export function invertAggregateFrame(frame: AggregateFrame): AggregateFrame {
  const owned = parseAggregateFrame(frame), translation = exact(owned.translationMm), turns = inverseTurns(owned.quarterTurns)
  return resultFrame(rotate({ x: -translation.x, y: -translation.y }, turns), turns)
}

export function localToWorldPoint(frame: AggregateFrame, input: PointMm): PointMm {
  const owned = parseAggregateFrame(frame)
  return resultPoint(transform(owned, exact(point(input))))
}

export function worldToLocalPoint(frame: AggregateFrame, input: PointMm): PointMm {
  const owned = parseAggregateFrame(frame)
  return resultPoint(transform(owned, exact(point(input)), true))
}

/** Preserve the existing world frame while expressing it under a new parent. */
export function reparentAggregateFrame(worldFrame: AggregateFrame, newParentWorldFrame: AggregateFrame): AggregateFrame {
  const world = parseAggregateFrame(worldFrame), parent = parseAggregateFrame(newParentWorldFrame)
  return resultFrame(transform(parent, exact(world.translationMm), true), ((world.quarterTurns - parent.quarterTurns + 4) % 4) as QuarterTurns)
}

/** Vectors rotate without translation; local prop offsets use this operation. */
export function localToWorldVector(frame: AggregateFrame, input: PointMm): PointMm {
  const owned = parseAggregateFrame(frame)
  return resultPoint(rotate(exact(point(input)), owned.quarterTurns))
}

export function worldToLocalVector(frame: AggregateFrame, input: PointMm): PointMm {
  const owned = parseAggregateFrame(frame)
  return resultPoint(rotate(exact(point(input)), inverseTurns(owned.quarterTurns)))
}

function transformBounds(frame: AggregateFrame, input: BoundsMm, inverse: boolean): BoundsMm {
  const owned = parseAggregateFrame(frame), value = bounds(input)
  // Keep corners exact even when x+width or y+height exceeds Number's range.
  const x = BigInt(value.x), y = BigInt(value.y), right = x + BigInt(value.width), bottom = y + BigInt(value.height)
  const corners = [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }].map(corner => transform(owned, corner, inverse))
  const minX = corners.reduce((a, b) => a < b.x ? a : b.x, corners[0].x), minY = corners.reduce((a, b) => a < b.y ? a : b.y, corners[0].y)
  const maxX = corners.reduce((a, b) => a > b.x ? a : b.x, corners[0].x), maxY = corners.reduce((a, b) => a > b.y ? a : b.y, corners[0].y)
  // Validate the full extent, not only the lower corner and dimensions.
  safe(maxX); safe(maxY)
  return Object.freeze({ x: safe(minX), y: safe(minY), width: safe(maxX - minX), height: safe(maxY - minY) })
}

export function localToWorldBounds(frame: AggregateFrame, input: BoundsMm): BoundsMm { return transformBounds(frame, input, false) }
export function worldToLocalBounds(frame: AggregateFrame, input: BoundsMm): BoundsMm { return transformBounds(frame, input, true) }
