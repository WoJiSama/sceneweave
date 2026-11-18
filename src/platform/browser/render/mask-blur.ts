/** White alpha masks only. Three separable box passes approximate the same
 * Gaussian sigma when Canvas2D.filter is absent (including Windows WebKit).
 * No image/resource cache; the two byte buffers belong to this one mask. */
export function blurWhiteMask(image: ImageData, sigma: number): void {
  if (!Number.isFinite(sigma) || sigma < 0) throw new Error('地表遮罩模糊半径无效。')
  const { width, height, data } = image, count = width * height
  if (!sigma || !count) return
  let lower = Math.floor(Math.sqrt(4 * sigma * sigma + 1))
  if (lower % 2 === 0) lower--
  const small = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4))
  let input = new Uint8Array(count), output = new Uint8Array(count)
  for (let i = 0; i < count; i++) input[i] = data[i * 4 + 3]
  const pass = (radius: number, horizontal: boolean) => {
    const length = horizontal ? width : height, lines = horizontal ? height : width
    const step = horizontal ? 1 : width, divisor = radius * 2 + 1
    for (let line = 0; line < lines; line++) {
      const origin = horizontal ? line * width : line
      let sum = 0
      for (let x = 0; x <= Math.min(radius, length - 1); x++) sum += input[origin + x * step]
      for (let x = 0; x < length; x++) {
        output[origin + x * step] = Math.round(sum / divisor)
        if (x - radius >= 0) sum -= input[origin + (x - radius) * step]
        if (x + radius + 1 < length) sum += input[origin + (x + radius + 1) * step]
      }
    }
    ;[input, output] = [output, input]
  }
  for (let i = 0; i < 3; i++) {
    const radius = ((i < small ? lower : lower + 2) - 1) / 2
    pass(radius, true); pass(radius, false)
  }
  for (let i = 0; i < count; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255
    data[i * 4 + 3] = input[i]
  }
}
