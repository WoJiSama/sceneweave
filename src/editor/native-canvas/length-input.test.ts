import { describe, expect, it } from 'vitest'
import { formatLengthInput, parseLengthInput, type LengthDisplayUnit } from './length-input'

describe('length inputs keep integer-millimetre commands', () => {
  it('accepts familiar metric and tactical dimensions', () => {
    expect(parseLengthInput('4.2', 'm')).toBe(4200)
    expect(parseLengthInput('10', 'cm')).toBe(100)
    expect(parseLengthInput('5', 'ft')).toBe(1524)
    expect(parseLengthInput('-0.254', 'm')).toBe(-254)
    expect(parseLengthInput('.5', 'm')).toBe(500)
  })

  it('rounds submillimetre input consistently without binary-float drift', () => {
    expect(parseLengthInput('1', 'ft')).toBe(305)
    expect(parseLengthInput('0.0005', 'm')).toBe(1)
    expect(parseLengthInput('-0.0005', 'm')).toBe(-1)
    expect(parseLengthInput('1.0004999999999999999', 'm')).toBe(1000)
  })

  it('round-trips unchanged values across display units, including fractional feet', () => {
    for (const unit of ['mm', 'cm', 'm', 'ft'] as LengthDisplayUnit[]) {
      for (const value of [0, 1, -1, 100, 254, 900, 1524, 14000, -200000, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
        expect(parseLengthInput(formatLengthInput(value, unit), unit)).toBe(value)
      }
    }
    expect(formatLengthInput(14000, 'm')).toBe('14')
    expect(formatLengthInput(1524, 'ft')).toBe('5')
  })

  it('rejects missing, non-finite, malformed and unsafe values', () => {
    for (const value of ['', ' ', 'NaN', 'Infinity', '1e309', '1,000', '12m', '1.2.3', '9007199254740992']) {
      expect(() => parseLengthInput(value, 'mm')).toThrow()
    }
  })
})
