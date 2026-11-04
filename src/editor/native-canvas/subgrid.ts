import type { PointMm } from '../../shared/model/scene.js'

export type SubgridSnap = {
  divisions: 1 | 2 | 4 | 8
  anchor: 'intersection' | 'center'
}

function roundRatio(numerator: bigint, denominator: bigint, tieDirection: -1 | 1 = 1): bigint {
  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  const whole = magnitude / denominator, remainder = magnitude % denominator
  if (remainder * 2n < denominator) return negative ? -whole : whole
  if (remainder * 2n > denominator) return negative ? -(whole + 1n) : whole + 1n
  if (tieDirection > 0) return negative ? -whole : whole + 1n
  return negative ? -(whole + 1n) : whole
}

function safeNumber(value: bigint, label: string): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label}超出安全整数毫米范围。`)
  return Number(value)
}

function snapAxis(value: number, gridSizeMm: number, settings: SubgridSnap): number {
  const grid = BigInt(gridSizeMm), divisions = BigInt(settings.divisions), coordinate = BigInt(value)
  let anchorNumerator: bigint, anchorDenominator: bigint
  if (settings.anchor === 'intersection') {
    const index = roundRatio(coordinate * divisions, grid, value < 0 ? -1 : 1)
    anchorNumerator = index * grid
    anchorDenominator = divisions
  } else {
    // Cell centers form a half-step-offset lattice: (index + 1/2) * grid/divisions.
    const indexNumerator = coordinate * 2n * divisions - grid
    const indexDenominator = 2n * grid
    const tieDirection = value < 0 ? -1 : 1
    const index = roundRatio(indexNumerator, indexDenominator, tieDirection)
    anchorNumerator = (2n * index + 1n) * grid
    anchorDenominator = 2n * divisions
  }
  return safeNumber(roundRatio(anchorNumerator, anchorDenominator, value < 0 ? -1 : 1), '吸附锚点')
}

/** Snap to a rational subdivision lattice, quantizing the selected anchor to integer millimetres once. */
export function snapSubgridPoint(point: PointMm, gridSizeMm: number, settings: SubgridSnap): PointMm {
  if (!Number.isSafeInteger(point?.x) || !Number.isSafeInteger(point?.y)) throw new Error('坐标须为安全整数毫米。')
  if (!Number.isSafeInteger(gridSizeMm) || gridSizeMm < 1) throw new Error('原格距须为正整数毫米。')
  if (![1, 2, 4, 8].includes(settings?.divisions) || !['intersection', 'center'].includes(settings?.anchor)) throw new Error('子格吸附设置无效。')
  if (gridSizeMm < settings.divisions) throw new Error('子格间距小于 1 毫米，会产生重复锚点。')
  return { x: snapAxis(point.x, gridSizeMm, settings), y: snapAxis(point.y, gridSizeMm, settings) }
}
