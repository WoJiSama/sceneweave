import { expect, test } from 'vitest'
import { captureBitmapLineArt } from './bitmap-line-art.js'

function raster(width: number, height: number, pixel: (x: number, y: number) => readonly number[]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  const context = {
    canvas: { width, height },
    getImageData: (_x: number, top: number, columns: number, rows: number) => {
      expect(columns).toBe(width)
      return { data: data.slice(top * width * 4, (top + rows) * width * 4) }
    },
  } as unknown as CanvasRenderingContext2D
  return { context, data }
}

test('keeps a color boundary through stripe joins and suppresses repeating fine detail', () => {
  const width = 92, height = 208
  const image = raster(width, height, (x, y) => {
    const texture = (x + y) % 2 ? 8 : -8
    return x < 46 ? [177, 92, 86, 255] : [42 + texture, 155 + texture, 114 + texture, 255]
  })
  const unchanged = image.data.slice()
  const edges = captureBitmapLineArt(image.context)
  for (let y = 4; y < height - 4; y++) {
    const row = y * width
    expect(Math.max(...edges.subarray(row + 42, row + 50))).toBeGreaterThan(22)
    expect(edges.subarray(row + 58, row + 88).every(value => value === 0)).toBe(true)
  }
  expect(edges.slice(96 * width, 97 * width)).toEqual(edges.slice(95 * width, 96 * width))
  expect(image.data).toEqual(unchanged)
})

test('keeps existing ink on a pale sheet without extracting a second line beside it', () => {
  const width = 64, image = raster(width, 48, x => x === 31 ? [29, 28, 27, 255] : [247, 246, 243, 255])
  const row = captureBitmapLineArt(image.context).subarray(width * 24, width * 25)
  expect(row[31]).toBe(128)
  expect([...row].filter(value => value > 0 && value < 128)).toHaveLength(0)
})

test('retains both faint road edges through a stripe join and drops isolated flecks', () => {
  const width = 168, height = 211
  const shades = (n: number) => [n, n - 5, n - 12, 255]
  const image = raster(width, height, (x, y) => {
    const left = Math.round(44 + 6 * Math.sin(y / 36)), right = left + 28
    if (x === left || x === right) return shades(184)
    if (x > left && x < right) return shades(194)
    if (x > 103 && x < 155 && x % 8 < 2 && y % 7 < 2) return shades(175)
    return shades(194)
  })
  const original = image.data.slice()
  const old = captureBitmapLineArt(image.context)
  const current = captureBitmapLineArt(image.context, { preserveContours: true })
  const edge = (pixels: Uint8Array, row: number, x: number) => Math.max(...pixels.slice(row * width + x - 2, row * width + x + 3))
  let recovered = 0
  for (let y = 24; y < height - 24; y++) {
    const left = Math.round(44 + 6 * Math.sin(y / 36))
    if (edge(current, y, left) >= 14 && edge(current, y, left + 28) >= 14) recovered++
    expect(current.subarray(y * width + 105, y * width + 154).every(value => value === 0)).toBe(true)
  }
  expect(edge(old, 96, 47)).toBe(0)
  expect(edge(current, 95, 47)).toBeGreaterThanOrEqual(14)
  expect(edge(current, 96, 47)).toBeGreaterThanOrEqual(14)
  expect(recovered).toBeGreaterThanOrEqual(153)
  expect(image.data).toEqual(original)
})

test('leaves an actual blank break between two aligned strokes', () => {
  const width = 64, height = 120
  const image = raster(width, height, (x, y) => x === 30 && (y < 44 || y >= 71)
    ? [181, 176, 170, 255] : [192, 187, 181, 255])
  const edges = captureBitmapLineArt(image.context, { preserveContours: true })
  expect(edges[25 * width + 30]).toBeGreaterThan(16)
  expect(edges[90 * width + 30]).toBeGreaterThan(16)
  expect(edges.subarray(49 * width, 66 * width).every(value => value === 0)).toBe(true)
})

test('never samples even partially covered player pixels during smoothing and linking', () => {
  const width = 64, height = 218
  const mask = raster(width, height, (x, y) => [0, 0, 0, x > 22 && x < 43 && y > 50 && y < 186 ? 1 : 0]).context
  const image = (hidden: number) => raster(width, height, (x, y) => {
    if (x > 22 && x < 43 && y > 50 && y < 186) return [hidden, hidden, hidden, 255]
    return x < 14 ? [191, 163, 96, 255] : [35, 115, 146, 255]
  }).context
  const a = captureBitmapLineArt(image(0), { mask })
  const b = captureBitmapLineArt(image(255), { mask })
  expect(a).toEqual(b)
  expect(Math.max(...a.subarray(142 * width + 10, 142 * width + 17))).toBeGreaterThan(22)
  expect(captureBitmapLineArt(image(0), { mask, preserveContours: true })).toEqual(captureBitmapLineArt(image(255), { mask, preserveContours: true }))
  const controller = new AbortController()
  controller.abort()
  expect(() => captureBitmapLineArt(image(0), { signal: controller.signal, mask, preserveContours: true })).toThrow(/已取消/)
})
