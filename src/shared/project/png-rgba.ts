import { Unzlib, zlibSync } from 'fflate'
import type { RasterImage } from '../ports/resources.js'
import { STATIC_SVG_LIMITS } from '../ai/svg.js'
import { crc32 } from './binary.js'
import { inspectImageBytes } from './image-bytes.js'
import { PACKAGE_LIMITS } from './limits.js'

/** Processor 2 owns straight RGBA8/sRGB pixels. No native Canvas rounding. */
function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > STATIC_SVG_LIMITS.rasterSide || height > STATIC_SVG_LIMITS.rasterSide
    || width * height > STATIC_SVG_LIMITS.rasterPixels) throw new Error('固定SVG PNG像素超出保护预算。')
}
const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const ascii = (data: Uint8Array, offset: number) => String.fromCharCode(...data.subarray(offset, offset + 4))
function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index++) result[4 + index] = type.charCodeAt(index)
  result.set(data, 8); view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)))
  return result
}
function adler32(data: Uint8Array): number {
  let low = 1, high = 0
  for (let offset = 0; offset < data.length;) {
    const end = Math.min(data.length, offset + 5552)
    while (offset < end) { low += data[offset++]; high += low }
    low %= 65521; high %= 65521
  }
  return ((high << 16) | low) >>> 0
}
function paeth(left: number, above: number, upperLeft: number): number {
  const predictor = left + above - upperLeft
  const a = Math.abs(predictor - left), b = Math.abs(predictor - above), c = Math.abs(predictor - upperLeft)
  return a <= b && a <= c ? left : b <= c ? above : upperLeft
}

/** Strict software decoder for processor-2 outputs, not a JPEG/WebP importer. */
export function decodeCanonicalPng(input: Uint8Array): RasterImage {
  const bytes = input.slice(), header = inspectImageBytes(bytes)
  if (header.mimeType !== 'image/png') throw new Error('固定SVG制品必须是PNG。')
  const { width, height } = header
  dimensions(width, height)
  if (bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) throw new Error('固定SVG PNG须为非交错RGBA8。')
  const data: Uint8Array[] = []
  let size = 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset), type = ascii(bytes, offset + 4)
    if (!['IHDR', 'sRGB', 'IDAT', 'IEND'].includes(type)) throw new Error('固定SVG PNG含不受支持的块。')
    if (type === 'IDAT') { const body = bytes.subarray(offset + 8, offset + 8 + length); data.push(body); size += body.length }
    offset += length + 12
  }
  const compressed = new Uint8Array(size)
  let offset = 0
  for (const body of data) { compressed.set(body, offset); offset += body.length }
  if (size < 6 || (compressed[1] & 32)) throw new Error('固定SVG PNG的zlib流无效。')
  const stride = width * 4, raw = new Uint8Array(height * (stride + 1))
  let written = 0, complete = false
  const inflater = new Unzlib((part, final) => {
    if (written + part.length > raw.length) throw new Error('固定SVG PNG实际解压像素超过尺寸声明。')
    raw.set(part, written); written += part.length; complete = final
  })
  // Each push bounds the inflater's temporary expansion; reject a bomb without
  // allocating its claimed output. The final retained buffer is dimension-bound.
  for (let cursor = 0; cursor < compressed.length; cursor += 1024) {
    const end = Math.min(compressed.length, cursor + 1024)
    inflater.push(compressed.subarray(cursor, end), end === compressed.length)
  }
  if (!complete || written !== raw.length || adler32(raw) !== new DataView(compressed.buffer).getUint32(size - 4)) throw new Error('固定SVG PNG实际解压长度或Adler32不符。')
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter > 4) throw new Error('固定SVG PNG行滤波无效。')
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x, left = x >= 4 ? rgba[index - 4] : 0
      const above = y > 0 ? rgba[index - stride] : 0, upperLeft = y > 0 && x >= 4 ? rgba[index - stride - 4] : 0
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above
        : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, upperLeft)
      rgba[index] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255
    }
  }
  return { width, height, rgba }
}

/** Fixed software encoding; fully transparent RGB is retained and compared. */
export function encodeCanonicalPng(image: RasterImage): Uint8Array {
  dimensions(image.width, image.height)
  return encodeRgbaPng(image)
}

/** Original image-import pixels retain the package image budget, independently of fixed SVGs. */
export function encodeSourcePng(image: RasterImage): Uint8Array {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
    || image.width > PACKAGE_LIMITS.imageSide || image.height > PACKAGE_LIMITS.imageSide
    || image.width * image.height > PACKAGE_LIMITS.imagePixels) throw new Error('原色PNG像素超出图片保护预算。')
  return encodeRgbaPng(image)
}

function encodeRgbaPng(image: RasterImage): Uint8Array {
  if (!(image.rgba instanceof Uint8ClampedArray) || image.rgba.length !== image.width * image.height * 4) throw new Error('固定SVG RGBA像素长度无效。')
  const stride = image.width * 4, raw = new Uint8Array(image.height * (stride + 1))
  for (let y = 0; y < image.height; y++) raw.set(image.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, image.width); view.setUint32(4, image.height); header[8] = 8; header[9] = 6
  const chunks = [signature, chunk('IHDR', header), chunk('sRGB', Uint8Array.of(0)), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array())]
  const size = chunks.reduce((sum, value) => sum + value.length, 0)
  if (size > STATIC_SVG_LIMITS.rasterBytes) throw new Error('固定SVG PNG制品超过20MiB。')
  const result = new Uint8Array(size)
  let offset = 0
  for (const value of chunks) { result.set(value, offset); offset += value.length }
  return result
}
