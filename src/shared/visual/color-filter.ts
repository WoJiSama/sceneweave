import { z } from 'zod'

export const COLOR_CURVE_CHANNELS = ['rgb', 'red', 'green', 'blue'] as const
export const MAX_COLOR_CURVE_POINTS = 12
export type ColorCurveChannel = typeof COLOR_CURVE_CHANNELS[number]
const byte = z.int().min(0).max(255)
const curvePointSchema = z.object({ input: byte, output: byte }).strict()
const curveSchema = z.array(curvePointSchema).min(2).max(MAX_COLOR_CURVE_POINTS).refine(points =>
  points[0]?.input === 0 && points.at(-1)?.input === 255
    && points.every((point, index) => index === 0 || point.input > points[index - 1].input),
  '调色曲线的输入必须按顺序从 0 增至 255。',
)
const adjustment = z.number().min(-100).max(100)
export const colorFilterSchema = z.object({
  enabled: z.boolean(),
  strength: z.int().min(0).max(100),
  exposure: z.number().min(.25).max(2),
  warmth: adjustment,
  saturation: adjustment,
  contrast: adjustment,
  curves: z.object({ rgb: curveSchema, red: curveSchema, green: curveSchema, blue: curveSchema }).strict(),
}).strict()
export type ColorFilter = z.infer<typeof colorFilterSchema>
export type ColorCurvePoint = z.infer<typeof curvePointSchema>

export const identityColorCurve = (): ColorCurvePoint[] => [{ input: 0, output: 0 }, { input: 255, output: 255 }]

export function neutralColorFilter(): ColorFilter {
  return { enabled: true, strength: 100, exposure: 1, warmth: 0, saturation: 0, contrast: 0,
    curves: { rgb: identityColorCurve(), red: identityColorCurve(), green: identityColorCurve(), blue: identityColorCurve() } }
}

export function colorFilterChangesPixels(filter: ColorFilter): boolean {
  return filter.enabled && filter.strength > 0 && (filter.exposure !== 1 || filter.warmth !== 0 || filter.saturation !== 0
    || filter.contrast !== 0 || COLOR_CURVE_CHANNELS.some(channel => filter.curves[channel].some(point => point.input !== point.output)))
}

/** Smooth cubic interpolation with bounded output between each pair of knots. */
export function colorCurveTable(points: readonly ColorCurvePoint[]): Float32Array {
  const slopes = points.slice(1).map(({ input, output }, index) => (output - points[index].output) / (input - points[index].input))
  const tangent = points.map((_, index) => {
    if (index === 0) return slopes[0]
    if (index === points.length - 1) return slopes[index - 1]
    const left = slopes[index - 1], right = slopes[index]
    if (left * right <= 0) return 0
    const leftSpan = points[index].input - points[index - 1].input, rightSpan = points[index + 1].input - points[index].input
    const w1 = 2 * rightSpan + leftSpan, w2 = rightSpan + 2 * leftSpan
    return (w1 + w2) / (w1 / left + w2 / right)
  })
  const values = new Float32Array(256)
  for (let index = 0; index < slopes.length; index++) {
    const first = points[index], last = points[index + 1], span = last.input - first.input
    const min = Math.min(first.output, last.output), max = Math.max(first.output, last.output)
    for (let input = first.input; input <= last.input; input++) {
      const mix = (input - first.input) / span, square = mix * mix, cube = square * mix
      const output = (2 * cube - 3 * square + 1) * first.output + (cube - 2 * square + mix) * span * tangent[index]
        + (-2 * cube + 3 * square) * last.output + (cube - square) * span * tangent[index + 1]
      values[input] = Math.min(max, Math.max(min, output))
    }
  }
  return values
}
