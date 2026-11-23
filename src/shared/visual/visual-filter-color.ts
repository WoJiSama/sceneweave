import { neutralColorFilter, type ColorFilter } from './color-filter.js'
import type { VisualFilter } from './types.js'

export const VISUAL_FILTER_TINTS: Record<VisualFilter['preset'], readonly [number, number, number, number]> = {
  neutral: [255, 255, 255, 0], warm: [224, 157, 87, .09], cool: [105, 155, 207, .09],
  aged: [187, 157, 101, .15], moonlight: [71, 101, 155, .19],
}

/** Explicit upgrade/preset load. Legacy projects can continue using their original equations. */
export function visualFilterColor({ preset, exposure, saturation, contrast }: Pick<VisualFilter, 'preset' | 'exposure' | 'saturation' | 'contrast'>): ColorFilter {
  const filter = neutralColorFilter()
  const [r, g, b, mix] = VISUAL_FILTER_TINTS[preset]
  const colors = { red: r, green: g, blue: b }
  for (const channel of ['red', 'green', 'blue'] as const) {
    const tint = colors[channel] * mix
    filter.curves[channel] = [{ input: 0, output: Math.round(tint) }, { input: 255, output: Math.round(255 * (1 - mix) + tint) }]
  }
  return { ...filter, exposure, saturation: Math.round(1000 * (saturation - 1)) / 10,
    contrast: Math.round((contrast - 1) * (contrast < 1 ? 1000 / .75 : 1000)) / 10 }
}
