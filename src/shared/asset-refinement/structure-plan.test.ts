import { describe, expect, it } from 'vitest'
import { normalizeStaticSvg } from '../ai/svg.js'
import { compileVectorStructurePlan, parseVectorStructurePlan, vectorStructurePlanSchema, type VectorStructurePlan } from './structure-plan.js'

const source = { sha256: 'a'.repeat(64), width: 100, height: 80 }
function fixture(): VectorStructurePlan {
  return { version: 1, source: { ...source }, summary: 'Observed outer curve and inferred regular line spacing.',
    gradients: [{ id: 'body-tone', x1: 10, y1: 10, x2: 90, y2: 65, stops: [{ offset: 0, color: '#63717b' }, { offset: 1, color: '#2b323c' }] }],
    elements: [
      { kind: 'path', id: 'body', name: 'Body', evidence: 'observed', reason: 'Visible large silhouette and light direction.',
        d: 'M10 10L70 10C92 10 95 34 80 45Q70 53 60 65L10 65Z', fill: { gradient: 'body-tone' }, stroke: '#111820', strokeWidth: 2, linejoin: 'round' },
      { kind: 'repeatRects', id: 'bars', name: 'Regular divisions', evidence: 'inferred', reason: 'The source shows divisions but not their exact spacing.',
        x: 18, y: 18, width: 6, height: 3, stepX: 0, stepY: 6, count: 6, fill: '#e9e6dc', stroke: '#242b31', strokeWidth: .5 },
    ] }
}

describe('source-bound vector structure plan', () => {
  it('compiles observed curves and explicit inferred repetitions to actual normalized editable SVG deterministically', () => {
    const input = fixture(), before = JSON.stringify(input), output = compileVectorStructurePlan(input, source)
    expect(output.stats).toEqual({ pathCount: 7, pathCommandCount: 36, observedElements: 1, inferredElements: 1 })
    expect(output.sourceSvg).toContain('<linearGradient')
    expect(output.sourceSvg).toContain('C 92 10 95 34 80 45')
    expect(output.sourceSvg).toContain('Q 70 53 60 65')
    expect(output.sourceSvg).not.toMatch(/<image\b|\bhref\b|<filter\b|<script\b/)
    expect(normalizeStaticSvg(output.sourceSvg).normalizedSource).toBe(output.sourceSvg)
    expect(compileVectorStructurePlan(input, source)).toEqual(output)
    expect(JSON.stringify(input)).toBe(before)
    input.elements[0].reason = 'caller changed'
    expect(output.plan.elements[0].reason).not.toBe('caller changed')
  })

  it('compiles a plain filled shape without empty definitions and supports transparent holes', () => {
    const input = fixture(); input.gradients = []; input.elements = [{ kind: 'path', id: 'hole', name: 'Frame', evidence: 'observed',
      reason: 'Visible hole.', d: 'M10 10L90 10L90 70L10 70ZM20 20L80 20L80 60L20 60Z', fill: '#405060', fillRule: 'evenodd' }]
    const output = compileVectorStructurePlan(input)
    expect(output.sourceSvg).not.toContain('<defs')
    expect(output.sourceSvg).toContain('fill-rule="evenodd"')
    expect(output.stats).toEqual({ pathCount: 1, pathCommandCount: 10, observedElements: 1, inferredElements: 0 })
  })

  it('binds exact source hash and dimensions and requires evidence with a reason', () => {
    const input = fixture()
    expect(() => compileVectorStructurePlan(input, { ...source, sha256: 'b'.repeat(64) })).toThrow('基线不匹配')
    expect(() => compileVectorStructurePlan(input, { ...source, width: 101 })).toThrow('基线不匹配')
    expect(() => parseVectorStructurePlan({ ...input, elements: [{ ...input.elements[0], reason: '' }] })).toThrow()
    expect(() => parseVectorStructurePlan({ ...input, elements: [{ ...input.elements[0], evidence: 'restored' }] })).toThrow()
  })

  it('rejects unknown fields, accessors, symbols, inherited state and nonfinite JSON without executing code', () => {
    const input = fixture()
    expect(() => parseVectorStructurePlan({ ...input, unknown: 1 })).toThrow()
    expect(() => parseVectorStructurePlan({ ...input, elements: [{ ...input.elements[0], href: 'https://example.test' }] })).toThrow()
    let read = false
    const unsafe = { ...input, get summary() { read = true; return 'unsafe' } }
    expect(() => vectorStructurePlanSchema.parse(unsafe)).toThrow('访问器')
    expect(read).toBe(false)
    expect(() => parseVectorStructurePlan({ ...input, [Symbol('extra')]: true })).toThrow('Symbol')
    expect(() => parseVectorStructurePlan(Object.assign(Object.create({ inherited: true }), input))).toThrow('普通JSON')
    expect(() => parseVectorStructurePlan({ ...input, source: { ...source, width: Infinity } })).toThrow('有限')
  })

  it.each(['m10 10L20 20Z', 'M10 10H20Z', 'M10 10A5 5 0 0 0 20 20Z', 'M10 10L101 20Z', 'M10 10Q-1 2 30 30Z',
    'M10 10C20 20 30 90 40 40Z', 'M10 10L20Z', 'M10 10L20 20ZL30 30', 'M10 10LNaN 20Z', 'M10 10L20 20"/><image href="file"/>'])('rejects unsupported or out-of-frame path %s', d => {
    const input = fixture(); input.elements = [{ ...input.elements[0], kind: 'path', d } as VectorStructurePlan['elements'][number]]
    expect(() => compileVectorStructurePlan(input)).toThrow()
  })

  it('rejects missing/duplicate gradient references, unsafe paints and ambiguous stops', () => {
    const input = fixture()
    expect(() => parseVectorStructurePlan({ ...input, gradients: [] })).toThrow('渐变引用缺失')
    expect(() => parseVectorStructurePlan({ ...input, gradients: [...input.gradients, input.gradients[0]] })).toThrow('ID重复')
    expect(() => parseVectorStructurePlan({ ...input, elements: [{ ...input.elements[0], fill: 'url(https://example.test/a)' }] })).toThrow()
    expect(() => parseVectorStructurePlan({ ...input, gradients: [{ ...input.gradients[0], stops: [{ offset: 0, color: '#fff' }, { offset: 0, color: '#000' }] }] })).toThrow('严格递增')
    expect(() => parseVectorStructurePlan({ ...input, gradients: [{ ...input.gradients[0], x2: 101 }] })).toThrow('源图框')
  })

  it('checks every repeated rectangle including negative steps and exact expansion budgets', () => {
    const input = fixture(), repeated = input.elements[1]
    if (repeated.kind !== 'repeatRects') throw new Error('Invalid fixture')
    input.elements = [{ ...repeated, x: 50, stepX: -7, stepY: 0, count: 6 }]
    expect(compileVectorStructurePlan(input).stats.pathCount).toBe(6)
    expect(() => parseVectorStructurePlan({ ...input, elements: [{ ...input.elements[0], count: 9 }] })).toThrow('源图框')
    expect(() => parseVectorStructurePlan({ ...input, elements: [{ ...repeated, stepX: 0, stepY: 0 }] })).toThrow('非零步距')
    const many = { ...repeated, x: 1, y: 1, width: 1, height: 1, stepX: .1, stepY: 0, count: 256 }
    expect(compileVectorStructurePlan({ ...input, elements: [many] }).stats.pathCount).toBe(256)
    expect(() => parseVectorStructurePlan({ ...input, elements: [many, { ...many, id: 'more', count: 1 }] })).toThrow('256路径')
  })

  it('rejects source/element/command budgets rather than omitting geometry', () => {
    const input = fixture()
    expect(() => parseVectorStructurePlan({ ...input, source: { ...source, width: 2000, height: 2000 } })).toThrow('100万')
    expect(() => parseVectorStructurePlan({ ...input, elements: Array.from({ length: 97 }, (_, i) => ({ ...input.elements[0], id: `item${i}` })) })).toThrow()
    const d = 'M10 10' + 'L20 20'.repeat(16_384)
    expect(() => parseVectorStructurePlan({ ...input, elements: [{ ...input.elements[0], kind: 'path', d }] })).toThrow('指令预算')
  })

  it('rejects clipped stroke envelopes and accepts shapes with sufficient margin', () => {
    const input = fixture(), base = input.elements[0]
    if (base.kind !== 'path') throw new Error('Invalid fixture')
    const path = { ...base, d: 'M1 1L40 1L40 40L1 40Z', stroke: '#111820', strokeWidth: 8, linejoin: 'round' as const }
    expect(() => compileVectorStructurePlan({ ...input, elements: [path] })).toThrow('描边外扩')
    expect(() => compileVectorStructurePlan({ ...input, elements: [{ ...path, d: 'M4 4L40 4L40 40L4 40Z' }] })).not.toThrow()
    // Unspecified width and join use the SVG defaults of 1 and miterlimit 4.
    const defaultStroke = { ...base, d: 'M1 1L40 1L40 40L1 40Z' }
    delete defaultStroke.linejoin; delete defaultStroke.strokeWidth
    expect(() => compileVectorStructurePlan({ ...input, elements: [defaultStroke] })).toThrow('描边外扩')
    expect(() => compileVectorStructurePlan({ ...input, elements: [{ ...defaultStroke, d: 'M2 2L40 2L40 40L2 40Z' }] })).not.toThrow()
    expect(() => compileVectorStructurePlan({ ...input, elements: [{ ...path, d: 'M4 4L40 4', linecap: 'square' }] })).toThrow('描边外扩')
    expect(() => compileVectorStructurePlan({ ...input, elements: [{ ...path, d: 'M6 6L40 6', linecap: 'square' }] })).not.toThrow()
    expect(() => compileVectorStructurePlan({ ...input, elements: [{ ...path, d: 'M10 10C1 15 40 15 50 25', linecap: 'round' }] })).toThrow('描边外扩')
  })

  it('checks the expanded stroke envelope of repeated rectangles including negative steps', () => {
    const input = fixture(), base = input.elements[1]
    if (base.kind !== 'repeatRects') throw new Error('Invalid fixture')
    const repeated = { ...base, x: 20, y: 4, width: 6, height: 5, count: 3, stepX: -8, stepY: 0,
      strokeWidth: 10, linejoin: 'bevel' as const }
    expect(() => compileVectorStructurePlan({ ...input, elements: [repeated] })).toThrow('描边外扩')
    expect(() => compileVectorStructurePlan({ ...input, elements: [{ ...repeated, x: 21, y: 5 }] })).not.toThrow()
    expect(() => compileVectorStructurePlan({ ...input, elements: [{ ...repeated, stroke: 'none' }] })).not.toThrow()
  })
})
