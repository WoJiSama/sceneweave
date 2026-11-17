import { describe, expect, it } from 'vitest'
import { rasterOriginalSurfaceStroke, type OriginalStrokeReference } from './guided-original-stroke.js'
import { imageSurfaceGuidanceSchema } from './surfaces.js'

const source = (gap = false): OriginalStrokeReference => {
  const ref: OriginalStrokeReference = { axis: 'horizontal', length: 12, cross: 13, centre: 6, ink: new Float32Array(12 * 13 * 3) }
  for (let u = 0; u < ref.length; u++) if (!gap || u !== 6) for (let c = 0; c < 3; c++) ref.ink[(u * 13 + 6) * 3 + c] = 60
  return ref
}
const bounds = { x: 42, y: 35, width: 8, height: 18 }, points = [{ x: 40, y: 43 }, { x: 51, y: 43 }]
const writable = (x: number, y: number) => x >= 42 && x < 50 && y >= 35 && y < 53
const color = (y: number, centre: number, kind = 'line'): [number, number, number] => {
  const d = kind === 'step' ? y >= centre ? 30 : 0 : kind === 'wide' ? Math.max(0, 35 - Math.abs(y - centre) * 4)
    : kind === 'double' ? y === centre - 2 || y === centre + 2 ? 60 : 0 : y === centre ? 60 : 0
  return [180, 160, 140].map(v => v + (y - 43) * 2 - d) as [number, number, number]
}
function solve(observed: (x: number, y: number) => readonly [number, number, number] | undefined, reference = source(), vertical = false) {
  const ink = new Float32Array(8 * 18 * 3), b = vertical ? { x: 35, y: 42, width: 18, height: 8 } : bounds
  const report = rasterOriginalSurfaceStroke(vertical ? { ...reference, axis: 'vertical' } : reference,
    vertical ? points.map(p => ({ x: p.y, y: p.x })) : points, b, vertical ? (x, y) => writable(y, x) : writable,
    () => { throw Error('Complete mode must not read fitted tone residuals') }, ink, () => {}, () => {}, true,
    { mode: 'complete-profile', observedRgb: vertical ? (x, y) => observed(y, x) : observed })
  return { ink, run: report.runs[0] }
}
const peak = (ink: Float32Array, col: number) => {
  const values = Array.from({ length: 18 }, (_, y) => ink[(y * 8 + col) * 3])
  return values.indexOf(Math.max(...values)) + 35
}

describe('explicit complete-profile native seam registration', () => {
  it('uses a complete narrow RGB profile at one side, with independent manual fallback at the other', () => {
    const { ink, run } = solve((x, y) => x >= 50 && x <= 52 ? color(y, 45) : undefined)
    expect(run.sampledCrossPx).toBe(13)
    expect(run.sides.map(s => s.basis)).toEqual(['manual-fallback', 'observed-profile'])
    expect(run.sides.map(s => s.qualifiedColumns)).toEqual([0, 3])
    expect(run.sides[1].appliedShiftPx).toBeCloseTo(-2)
    expect(peak(ink, 0)).toBe(43); expect(peak(ink, 7)).toBe(45)
  })

  it('does not promote sparse paper residuals, repeated channels or rows spread across different columns to a seam', () => {
    const sparse = solve((x, y) => x >= 50 && x <= 52 && [38, 47, 48].includes(y) ? color(y, 47) : undefined)
    expect(sparse.run.sides.every(s => s.basis === 'manual-fallback')).toBe(true)
    expect(sparse.run.sides[1].completeSampledColumns).toBe(0)
    expect(sparse.run.sides[1].warnings).toContain('no-complete-original-column')
    expect(peak(sparse.ink, 7)).toBe(43)
    const spread = solve((x, y) => x >= 50 && x <= 52 && (y - 37) % 3 === x - 50 ? color(y, 45) : undefined)
    expect(spread.run.sides[1].completeSampledColumns).toBe(0)
    expect(spread.ink).toEqual(sparse.ink)
  })

  it.each(['wide', 'step', 'double'])('does not accept a complete %s column as an unambiguous narrow seam', kind => {
    const { run, ink } = solve((x, y) => x >= 50 && x <= 52 ? color(y, 43, kind) : undefined)
    expect(run.sides[1].completeSampledColumns).toBe(3)
    expect(run.sides[1].qualifiedColumns).toBe(0)
    expect(run.sides[1].basis).toBe('manual-fallback')
    expect(peak(ink, 7)).toBe(43)
  })

  it('refuses conflicting complete narrow centres and excessive shifts instead of clipping or averaging them', () => {
    expect(() => solve((x, y) => x >= 50 && x <= 52 ? color(y, x === 50 ? 41 : 45) : undefined)).toThrow('互相冲突')
    // A wider reference permits complete paper on both sides of a line whose
    // centre is outside the maximum registration displacement.
    const ref = source(); ref.cross = 21; ref.centre = 10; ref.ink = new Float32Array(12 * 21 * 3)
    for (let u = 0; u < 12; u++) ref.ink.fill(60, (u * 21 + 10) * 3, (u * 21 + 11) * 3)
    expect(() => solve((x, y) => x >= 50 && x <= 52 ? color(y, 47) : undefined, ref)).toThrow('超过3px')
  })

  it('retains native source gaps and deterministic phase without evidence; is symmetric under axis transpose', () => {
    const reference = source(true), a = solve(() => undefined, reference), b = solve(() => undefined, reference, true)
    expect(a.run.sourceOffsetPx).toBe(2)
    // Native source column 6 appears in destination column 4 as a true gap.
    expect(Array.from({ length: 18 }, (_, y) => a.ink[(y * 8 + 4) * 3]).every(v => v === 0)).toBe(true)
    for (let y = 0; y < 18; y++) for (let x = 0; x < 8; x++) for (let c = 0; c < 3; c++) expect(a.ink[(y * 8 + x) * 3 + c]).toBe(b.ink[(x * 18 + y) * 3 + c])
  })

  it('strictly persists an explicit mode, rejects wrong combinations, and leaves omitted legacy options absent', () => {
    const guide = { axis: 'horizontal', points, reference: { x: 4, y: 6, width: 12, height: 13 }, stroke: 'original-segment', paper: 'two-sided', reason: 'Known short seam and explicit manual inference.' }
    const parse = (extra: object) => imageSurfaceGuidanceSchema.parse({ orientation: 'soft', guides: [{ ...guide, ...extra }] })
    expect(parse({ registration: 'complete-profile' }).guides[0].registration).toBe('complete-profile')
    expect(parse({}).guides[0]).not.toHaveProperty('registration')
    expect(() => parse({ registration: 'complete-profile', paper: undefined })).toThrow()
    expect(() => parse({ registration: 'complete-profile', stroke: undefined })).toThrow()
    expect(() => parse({ registration: 'auto' })).toThrow()
  })
})
