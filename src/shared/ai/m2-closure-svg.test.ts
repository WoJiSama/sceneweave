import { describe, expect, it } from 'vitest'
import { normalizeStaticSvg, verifyNormalizedStaticSvg } from './svg.js'

const svg = (path: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8192 8192"><path d="${path}"/></svg>`

describe('M2 SVG boundary and proof closure', () => {
  it.each([
    'M 0 5000 h 1',
    'M 5000 0 v 1',
    'M 0 -5000 h -1 -2 3',
    'M -5000 0 v -1 -2 3',
    'M 8192 8192 h -1 v -1 h 1 v 1',
    'M 0 8192 h 10 v -1 Z h 1',
    'M 8192 0 v 10 h -1 Z v 1',
  ])('accepts an unchanged axis at the coordinate boundary: %s', path => {
    const proof = normalizeStaticSvg(svg(path))
    expect(proof.normalizedSource).toContain(`d="${path}"`)
    expect(verifyNormalizedStaticSvg(proof)).toEqual(proof)
  })

  it.each([
    'M 8192 0 h 1',
    'M 0 8192 v 1',
    'M -8192 0 h -1',
    'M 0 -8192 v -1',
    'M 8191 0 h 1 1',
    'M 0 8191 v 1 1',
    'M 8192 0 h -1 Z h 1',
    'M 0 8192 v -1 Z v 1',
    'M 8192 0 c 1 0 0 1 0 1',
  ])('rejects actual cumulative coordinate overflow: %s', path => {
    expect(() => normalizeStaticSvg(svg(path))).toThrow(/累计超限/)
  })

  it('rejects non-string hash claims without executing their conversion hooks', () => {
    const normalized = normalizeStaticSvg(svg('M 0 0 h 1 v 1 Z'))
    let calls = 0
    const hash = { toString() { calls++; return normalized.sourceSha256 } }
    expect(() => verifyNormalizedStaticSvg({ ...normalized, sourceSha256: hash })).toThrow(/凭证值/)
    expect(calls).toBe(0)
  })
})
