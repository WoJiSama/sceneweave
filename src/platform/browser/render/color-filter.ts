import { colorCurveTable, colorFilterChangesPixels, type ColorFilter } from '../../../shared/visual/color-filter.js'

function sample(table: Float32Array, value: number): number {
  const input = Math.max(0, Math.min(255, value))
  const left = Math.floor(input)
  return table[left] + (table[Math.min(255, left + 1)] - table[left]) * (input - left)
}

/** Same sRGB transform for the map, a theme, and a scoped adjustment. Alpha is coverage. */
export function prepareColorFilter(filter: ColorFilter) {
  if (!colorFilterChangesPixels(filter)) return undefined
  const { contrast, saturation, exposure, warmth, strength, curves } = filter
  const master = colorCurveTable(curves.rgb)
  const [red, green, blue] = [curves.red, curves.green, curves.blue].map(points => {
    const channel = colorCurveTable(points)
    return master.map(value => sample(channel, value))
  })
  const gain = (1 + contrast * (contrast < 0 ? .0075 : .01)) * exposure
  const offset = (exposure - gain) * 127.5
  const color = 1 + saturation / 100, mix = strength / 100
  return (pixels: Uint8ClampedArray, index: number, coverage = 1) => {
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2]
    const luma = r * .2126 + g * .7152 + b * .0722
    const warm = warmth / 100 * (1 - .67 * (luma / 255) ** 2)
    const base = luma * (1 - color) * gain + offset
    const slope = color * gain, opacity = mix * coverage
    pixels[index] = r + (sample(red, r * slope + base + 31 * warm) - r) * opacity
    pixels[index + 1] = g + (sample(green, g * slope + base + 5 * warm) - g) * opacity
    pixels[index + 2] = b + (sample(blue, b * slope + base - 23 * warm) - b) * opacity
  }
}
