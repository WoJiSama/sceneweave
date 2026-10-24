/** Fixed bitmap parameters operate in normalized sRGB bytes; opacity stays on the scene. */
export function transformRgba(input: Uint8ClampedArray, tint: string | null, brightness: number): Uint8ClampedArray {
  if (!(input instanceof Uint8ClampedArray) || input.length % 4
    || tint !== null && !/^#[0-9a-f]{6}$/i.test(tint)
    || !Number.isFinite(brightness) || brightness < .25 || brightness > 2) throw new Error('位图参数或RGBA数据无效。')
  const color = tint === null ? [255, 255, 255] : [1, 3, 5].map(offset => parseInt(tint.slice(offset, offset + 2), 16))
  const result = new Uint8ClampedArray(input.length)
  for (let i = 0; i < input.length; i += 4) {
    result[i + 3] = input[i + 3]
    if (!input[i + 3]) continue
    for (let channel = 0; channel < 3; channel++) result[i + channel] = Math.round(Math.min(255, input[i + channel] * color[channel] / 255 * brightness))
  }
  return result
}
