import { describe, expect, it } from 'vitest'
import { STATIC_SVG_LIMITS, normalizeStaticSvg, verifyNormalizedStaticSvg } from './svg.js'

const ns = 'http://www.w3.org/2000/svg'
const svg = (body: string, attrs = '') => `<svg xmlns="${ns}" viewBox="0, 0, 64, 32" ${attrs}>${body}</svg>`

describe('constrained static SVG', () => {
  it('normalizes attribute order, numeric spelling and local gradients deterministically', () => {
    const input = svg('<defs><linearGradient id="shade"><stop offset="0%" stop-color="#FFF"/><stop offset="1" stop-color="#102030"/></linearGradient></defs><path fill="url(#shade)" d="M0,0 L64,0 64,32 Z"/>', 'height="32" width="64"')
    const normalized = normalizeStaticSvg(input)
    expect(normalized.normalizedSource).toBe(`<svg viewBox="0 0 64 32" xmlns="${ns}"><defs><linearGradient id="shade"><stop offset="0%" stop-color="#fff"/><stop offset="1" stop-color="#102030"/></linearGradient></defs><path d="M 0 0 L 64 0 64 32 Z" fill="url(#shade)"/></svg>`)
    expect(normalized.sourceSizeBytes).toBe(new TextEncoder().encode(input).length)
    expect(normalized.normalizedSizeBytes).toBe(new TextEncoder().encode(normalized.normalizedSource).length)
    expect(verifyNormalizedStaticSvg(normalized)).toMatchObject({ sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256 })
    expect(normalizeStaticSvg(input).normalizedSha256).toBe(normalized.normalizedSha256)
  })

  it('rejects active XML, external references, styles, animation and unsupported filters', () => {
    const bad = [
      `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${svg('<rect x="0" y="0" width="1" height="1"/>')}`,
      svg('<script/>'), svg('<foreignObject/>'), svg('<animate/>'), svg('<style>.x{fill:red}</style>'),
      svg('<rect onclick="alert(1)" x="0" y="0" width="1" height="1"/>'),
      svg('<filter><feGaussianBlur/></filter>'),
      svg('<rect fill="url(https://example.test/a.svg#paint)" x="0" y="0" width="1" height="1"/>'),
      svg('<rect style="fill:red" x="0" y="0" width="1" height="1"/>'),
      svg('<rect x="0" y="0" width="1" height="1"><path d="M 0 0"/></rect>'),
    ]
    for (const input of bad) expect(() => normalizeStaticSvg(input), input.slice(0, 60)).toThrow()
  })

  it('rejects malformed geometry, unknown references, overlarge coordinates and path commands', () => {
    expect(() => normalizeStaticSvg(svg('<path d="M 0 0 L 1"/>'))).toThrow(/path命令参数/)
    expect(() => normalizeStaticSvg(svg('<path d="M 0 0 a 1 1 0 2 0 4 4"/>'))).toThrow(/弧线标志/)
    expect(() => normalizeStaticSvg(svg('<path d="M 0 0 l 8192 0 1 0"/>'))).toThrow(/累计超限/)
    expect(() => normalizeStaticSvg(svg('<rect fill="url(#missing)" x="0" y="0" width="1" height="1"/>'))).toThrow(/引用缺失/)
    expect(() => normalizeStaticSvg(svg('<rect x="8000" y="0" width="1000" height="1"/>'))).toThrow(/边界坐标/)
    expect(() => normalizeStaticSvg(svg('<path d="M 0,,0"/>'))).toThrow()
    expect(() => normalizeStaticSvg(svg('<path d="M 0 0"/>', '').replace('64, 32', '8193 32'))).toThrow(/viewBox/)
    const repeated = Array.from({ length: STATIC_SVG_LIMITS.pathCommands + 1 }, () => 'L 0 0').join(' ')
    expect(() => normalizeStaticSvg(svg(`<path d="M 0 0 ${repeated}"/>`))).toThrow(/复杂度|命令/)
  })

  it('enforces the source byte limit and strict normalized-proof fields', () => {
    expect(() => normalizeStaticSvg(svg(' '.repeat(STATIC_SVG_LIMITS.sourceBytes)))).toThrow(/保护值/)
    const normalized = normalizeStaticSvg(svg('<circle cx="8" cy="8" r="4" fill="#abcdef"/>'))
    expect(() => verifyNormalizedStaticSvg({ ...normalized, normalizedSha256: '0'.repeat(64) })).toThrow(/摘要/)
    expect(() => verifyNormalizedStaticSvg({ ...normalized, sourceSvg: svg('<script/>') })).toThrow()
    expect(() => verifyNormalizedStaticSvg({ ...normalized, sourceSha256: '0'.repeat(64) })).toThrow(/摘要/)
    const accessored = { ...normalized }
    Object.defineProperty(accessored, 'normalizedSource', { enumerable: true, get: () => normalized.normalizedSource })
    expect(() => verifyNormalizedStaticSvg(accessored)).toThrow(/访问器/)
  })
})
