export type LengthDisplayUnit = 'mm' | 'cm' | 'm' | 'ft'

const millimetresPerUnit: Record<LengthDisplayUnit, readonly [bigint, bigint]> = {
  mm: [1n, 1n], cm: [10n, 1n], m: [1000n, 1n], ft: [1524n, 5n],
}

function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < 0n ? -numerator : numerator
  const rounded = (magnitude * 2n + denominator) / (denominator * 2n)
  return numerator < 0n ? -rounded : rounded
}

/** UI-only conversion. Persisted values and command arguments remain integer millimetres. */
export function parseLengthInput(text: string, unit: LengthDisplayUnit): number {
  const trimmed = text.trim()
  if (trimmed.length > 64 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) throw new Error('请输入有效的尺寸数字。')
  const negative = trimmed.startsWith('-')
  const [whole, fraction = ''] = trimmed.replace(/^[+-]/, '').split('.')
  const decimal = BigInt(`${whole || '0'}${fraction}`) * (negative ? -1n : 1n)
  const [numerator, denominator] = millimetresPerUnit[unit]
  const result = roundedQuotient(decimal * numerator, 10n ** BigInt(fraction.length) * denominator)
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('尺寸超出可处理范围。')
  return Number(result)
}

/** Three decimal places in feet differ by at most 0.153 mm, preserving integer-mm round trips. */
export function formatLengthInput(valueMm: number, unit: LengthDisplayUnit): string {
  if (!Number.isSafeInteger(valueMm)) throw new Error('尺寸须为整数毫米。')
  const places = { mm: 0, cm: 1, m: 3, ft: 3 }[unit]
  const scale = 10n ** BigInt(places)
  const [numerator, denominator] = millimetresPerUnit[unit]
  const rounded = roundedQuotient(BigInt(valueMm) * denominator * scale, numerator)
  const magnitude = rounded < 0n ? -rounded : rounded
  const whole = magnitude / scale
  const fraction = (magnitude % scale).toString().padStart(places, '0').replace(/0+$/, '')
  return `${rounded < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}
