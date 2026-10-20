import type { AssetBlobRecord } from './types'
import { checkCancelled, crc32, failV2, hasExactKeys, isSha256, PROJECT_LIMITS_V2 } from './limits'
import { projectErrorV2 } from './diagnostics'

export { PROJECT_LIMITS_V2 } from './limits'
type ImageMime = AssetBlobRecord['mimeType']
interface ImageHeader { mimeType: ImageMime; width: number; height: number }
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
const ascii = (bytes: Uint8Array, offset: number, size: number) => String.fromCharCode(...bytes.subarray(offset, offset + size))

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > PROJECT_LIMITS_V2.imageSide || height > PROJECT_LIMITS_V2.imageSide
    || !Number.isSafeInteger(width * height) || width * height > PROJECT_LIMITS_V2.imagePixels) {
    failV2('位图尺寸或像素超过候选保护值。')
  }
}

interface PngChunk { type: string; start: number; end: number; data: Uint8Array }
function pngChunks(bytes: Uint8Array): PngChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks: PngChunk[] = []
  let cursor = 8
  while (cursor < bytes.length) {
    if (cursor + 12 > bytes.length) failV2('PNG 块截断。')
    const length = view.getUint32(cursor)
    if (cursor + 12 + length > bytes.length) failV2('PNG 块长度越界。')
    const type = ascii(bytes, cursor + 4, 4)
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) failV2('PNG 块类型无效。')
    if (crc32(bytes.subarray(cursor + 4, cursor + 8 + length)) !== view.getUint32(cursor + 8 + length)) failV2('PNG CRC 校验失败。')
    chunks.push({ type, start: cursor, end: cursor + 12 + length, data: bytes.subarray(cursor + 8, cursor + 8 + length) })
    cursor += 12 + length
    if (chunks.length > 100_000) failV2('PNG 块数量超过保护值。')
  }
  if (chunks[0]?.type !== 'IHDR' || chunks[0].data.length !== 13 || chunks.at(-1)?.type !== 'IEND' || chunks.at(-1)!.data.length) failV2('PNG 缺少规范的 IHDR/IEND。')
  if (chunks.filter(chunk => chunk.type === 'IHDR').length !== 1 || chunks.filter(chunk => chunk.type === 'IEND').length !== 1
    || !chunks.some(chunk => chunk.type === 'IDAT')) failV2('PNG 关键块缺失或重复。')
  const firstData = chunks.findIndex(chunk => chunk.type === 'IDAT')
  const lastData = chunks.findLastIndex(chunk => chunk.type === 'IDAT')
  if (chunks.slice(firstData, lastData + 1).some(chunk => chunk.type !== 'IDAT')) failV2('PNG IDAT 必须连续。')
  const allowedCritical = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])
  for (const chunk of chunks) {
    if (['acTL', 'fcTL', 'fdAT'].includes(chunk.type)) failV2('不支持 APNG 动画。')
    if (chunk.type[0] === chunk.type[0].toUpperCase() && !allowedCritical.has(chunk.type)) failV2('不支持的 PNG 关键块。')
  }
  const header = chunks[0].data
  const colorType = header[9], bitDepth = header[8]
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
  if (!depths[colorType]?.includes(bitDepth)) failV2('PNG 色彩种类或位深无效。')
  const palette = chunks.filter(chunk => chunk.type === 'PLTE'), transparency = chunks.filter(chunk => chunk.type === 'tRNS')
  if (palette.length > 1 || palette.some(chunk => chunk.data.length < 3 || chunk.data.length > 768 || chunk.data.length % 3 || chunks.indexOf(chunk) > firstData)
    || (colorType === 3 && (palette.length !== 1 || palette[0].data.length / 3 > 2 ** bitDepth)) || ([0, 4].includes(colorType) && palette.length)) failV2('PNG 调色板无效。')
  if (transparency.length > 1 || transparency.some(chunk => chunks.indexOf(chunk) > firstData || [4, 6].includes(colorType)
    || (colorType === 0 && chunk.data.length !== 2) || (colorType === 2 && chunk.data.length !== 6)
    || (colorType === 3 && (!palette.length || !chunk.data.length || chunk.data.length > palette[0].data.length / 3 || chunks.indexOf(chunk) < chunks.indexOf(palette[0]))))) failV2('PNG 透明通道无效。')
  return chunks
}

function readPng(bytes: Uint8Array, normalized: boolean): ImageHeader {
  const chunks = pngChunks(bytes)
  if (normalized) {
    const allowed = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB'])
    if (chunks.some(chunk => !allowed.has(chunk.type))) failV2('PNG 含未规范化的元数据或色彩块；请重新导入素材。')
    const srgb = chunks.filter(chunk => chunk.type === 'sRGB')
    const paletteIndex = chunks.findIndex(chunk => chunk.type === 'PLTE'), dataIndex = chunks.findIndex(chunk => chunk.type === 'IDAT')
    if (srgb.length > 1 || srgb.some(chunk => chunk.data.length !== 1 || chunk.data[0] > 3 || chunks.indexOf(chunk) > dataIndex
      || (paletteIndex >= 0 && chunks.indexOf(chunk) > paletteIndex))) failV2('PNG sRGB 标记无效。')
  }
  const header = chunks[0].data
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const width = view.getUint32(0), height = view.getUint32(4)
  if (header[10] !== 0 || header[11] !== 0 || header[12] > 1) failV2('PNG 编码不受支持。')
  dimensions(width, height)
  return { mimeType: 'image/png', width, height }
}

function readJpeg(bytes: Uint8Array, normalized: boolean): ImageHeader {
  let cursor = 2
  let header: ImageHeader | undefined
  let scans = 0
  let ended = false
  while (cursor < bytes.length) {
    if (bytes[cursor++] !== 0xff) failV2('JPEG 标记无效。')
    while (bytes[cursor] === 0xff) cursor++
    const marker = bytes[cursor++]
    if (marker === 0xd9) { ended = true; break }
    if (marker === 0xd8 || marker === 0 || marker === undefined || (marker >= 0xd0 && marker <= 0xd7)) failV2('JPEG 标记顺序无效。')
    if (cursor + 2 > bytes.length) failV2('JPEG 块截断。')
    const size = bytes[cursor] * 256 + bytes[cursor + 1]
    if (size < 2 || cursor + size > bytes.length) failV2('JPEG 块长度越界。')
    const data = bytes.subarray(cursor + 2, cursor + size)
    if (marker === 0xe2 && ascii(data, 0, 4) === 'MPF\0') failV2('不支持多帧 MPO/JPEG。')
    if (normalized && ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) failV2('JPEG 含 EXIF/XMP/ICC/注释等元数据；请重新导入素材。')
    if (marker === 0xe0 && normalized && (ascii(data, 0, 5) !== 'JFIF\0' || data.length !== 14 || data[12] !== 0 || data[13] !== 0)) failV2('JPEG JFIF 含不支持的附加元数据。')
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (header || data.length < 6 || data[0] !== 8 || data.length !== 6 + data[5] * 3
        || (normalized && ![1, 3].includes(data[5]))) failV2('JPEG 必须为单帧 8 位灰阶或 sRGB 静态图片。')
      const height = data[1] * 256 + data[2], width = data[3] * 256 + data[4]
      dimensions(width, height)
      header = { mimeType: 'image/jpeg', width, height }
    } else if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) failV2('JPEG 帧编码不受支持。')
    cursor += size
    if (marker === 0xda) {
      if (!header || ++scans > 10_000) failV2('JPEG 扫描顺序或数量无效。')
      while (cursor < bytes.length) {
        if (bytes[cursor] !== 0xff) { cursor++; continue }
        const next = bytes[cursor + 1]
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { cursor += 2; continue }
        if (next === 0xff) { cursor++; continue }
        break
      }
    }
  }
  if (!ended || cursor !== bytes.length || !header || !scans) failV2('JPEG 截断、多帧或尾部含额外内容。')
  return header
}

function readWebp(bytes: Uint8Array, normalized: boolean): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) failV2('WebP RIFF 长度无效。')
  let cursor = 12
  let header: ImageHeader | undefined
  let extended: { width: number; height: number } | undefined
  const seen = new Set<string>()
  const u24 = (data: Uint8Array, offset: number) => data[offset] + data[offset + 1] * 256 + data[offset + 2] * 65536
  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) failV2('WebP 块截断。')
    const type = ascii(bytes, cursor, 4), size = view.getUint32(cursor + 4, true)
    const end = cursor + 8 + size
    if (end + (size % 2) > bytes.length || seen.has(type)) failV2('WebP 块越界或重复。')
    seen.add(type)
    const data = bytes.subarray(cursor + 8, end)
    if (['ANIM', 'ANMF'].includes(type)) failV2('不支持动画 WebP。')
    if (normalized && ['ICCP', 'EXIF', 'XMP '].includes(type)) failV2('WebP 含未规范化的色彩或私有元数据。')
    if (!['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP', 'EXIF', 'XMP '].includes(type)) failV2('WebP 含不支持的块。')
    if (type === 'VP8X') {
      if (cursor !== 12 || size !== 10 || (data[0] & 0xc3) || data[1] || data[2] || data[3]) failV2('WebP 扩展头无效或为动画。')
      if (normalized && (data[0] & 0x2c)) failV2('WebP 色彩或元数据尚未规范化。')
      extended = { width: u24(data, 4) + 1, height: u24(data, 7) + 1 }
      dimensions(extended.width, extended.height)
    }
    if (type === 'VP8 ' || type === 'VP8L') {
      if (header) failV2('WebP 必须为单帧。')
      let width: number, height: number
      if (type === 'VP8 ') {
        if (data.length < 10 || (data[0] & 1) || data[3] !== 0x9d || data[4] !== 1 || data[5] !== 0x2a) failV2('WebP VP8 帧头无效。')
        width = (data[6] + data[7] * 256) & 0x3fff; height = (data[8] + data[9] * 256) & 0x3fff
      } else {
        if (data.length < 5 || data[0] !== 0x2f || (data[4] >> 5)) failV2('WebP VP8L 帧头无效。')
        const bits = (data[1] | data[2] << 8 | data[3] << 16 | data[4] << 24) >>> 0
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1
      }
      dimensions(width, height)
      header = { mimeType: 'image/webp', width, height }
    }
    if (size % 2 && bytes[end] !== 0) failV2('WebP 填充字节无效。')
    cursor = end + (size % 2)
  }
  if (!header || (extended && (extended.width !== header.width || extended.height !== header.height))) failV2('WebP 缺帧或尺寸不一致。')
  return header
}

/** Inspect container/static format before invoking a browser decoder. */
export function inspectImageBytes(bytes: Uint8Array, normalized = true): ImageHeader {
  if (!bytes.length || bytes.length > PROJECT_LIMITS_V2.imageBytes) failV2('单位图编码超过 20 MiB 或为空。')
  if (pngSignature.every((value, index) => bytes[index] === value)) return readPng(bytes, normalized)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes, normalized)
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return readWebp(bytes, normalized)
  return failV2('仅支持静态 PNG、JPEG 或 WebP；实际格式不符。')
}

// One decoder across import, export, save and normalization, not one per caller.
let decoderQueue: Promise<void> = Promise.resolve()
async function withDecodedImage<T>(blob: Blob, signal: AbortSignal | undefined, action: (bitmap: ImageBitmap) => Promise<T>): Promise<T> {
  checkCancelled(signal)
  const previous = decoderQueue
  let release!: () => void
  decoderQueue = new Promise<void>(resolve => { release = resolve })
  await previous
  let bitmap: ImageBitmap | undefined
  try {
    checkCancelled(signal)
    if (typeof createImageBitmap !== 'function') failV2('当前环境缺少真实位图解码能力。')
    try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' }) }
    catch { checkCancelled(signal); return failV2('位图实际解码失败。') }
    checkCancelled(signal)
    dimensions(bitmap.width, bitmap.height)
    return await action(bitmap)
  } finally {
    bitmap?.close()
    release()
  }
}

/** Full byte/header/hash/decode check; never substitutes a failed image. */
async function validateImageAsset(record: AssetBlobRecord, options: { signal?: AbortSignal } = {}): Promise<void> {
  checkCancelled(options.signal)
  if (!hasExactKeys(record, ['sha256', 'blob', 'mimeType', 'sizeBytes', 'pixelWidth', 'pixelHeight'])
    || !isSha256(record.sha256) || !(record.blob instanceof Blob)
    || record.blob.size !== record.sizeBytes || !record.sizeBytes || record.sizeBytes > PROJECT_LIMITS_V2.imageBytes) failV2('资产字节记录无效。')
  const bytes = new Uint8Array(await record.blob.arrayBuffer())
  checkCancelled(options.signal)
  const header = inspectImageBytes(bytes)
  if (header.mimeType !== record.mimeType || (record.blob.type && record.blob.type !== header.mimeType)
    || header.width !== record.pixelWidth || header.height !== record.pixelHeight) failV2(`资产 ${record.sha256} 的 MIME 或头部尺寸不匹配。`)
  if (await sha256Bytes(bytes) !== record.sha256) failV2(`资产 ${record.sha256} 的 SHA-256 不匹配。`)
  await withDecodedImage(record.blob, options.signal, async bitmap => {
    if (bitmap.width !== header.width || bitmap.height !== header.height) failV2(`资产 ${record.sha256} 的实际解码尺寸不匹配。`)
  })
  checkCancelled(options.signal)
}

export async function validateImageAssetRecord(record: AssetBlobRecord, options: { signal?: AbortSignal } = {}): Promise<void> {
  try { await validateImageAsset(record, options) } catch (error) {
    projectErrorV2(error, { code: 'IMAGE_INVALID', ...(record && isSha256(record.sha256) ? { sha256: record.sha256 } : {}) })
  }
}

function normalizePngChunks(bytes: Uint8Array): Uint8Array {
  const chunks = pngChunks(bytes)
  const keep = chunks.filter(chunk => ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(chunk.type))
  // Canvas is explicitly sRGB. Record that fact without retaining source metadata.
  const srgb = new Uint8Array(13)
  const view = new DataView(srgb.buffer)
  view.setUint32(0, 1); srgb.set([115, 82, 71, 66, 0], 4); view.setUint32(9, crc32(srgb.subarray(4, 9)))
  const result = new Uint8Array(8 + srgb.length + keep.reduce((sum, chunk) => sum + chunk.end - chunk.start, 0))
  result.set(pngSignature)
  let offset = 8
  for (const chunk of keep) {
    result.set(bytes.subarray(chunk.start, chunk.end), offset); offset += chunk.end - chunk.start
    if (chunk.type === 'IHDR') { result.set(srgb, offset); offset += srgb.length }
  }
  return result
}

/** Adopt external static images as newly hashed, metadata-free sRGB PNG bytes. */
export async function normalizeImageAsset(file: Blob, options: { signal?: AbortSignal } = {}): Promise<AssetBlobRecord> {
  checkCancelled(options.signal)
  if (!(file instanceof Blob) || !file.size || file.size > PROJECT_LIMITS_V2.imageBytes) failV2('单位图编码超过 20 MiB 或为空。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const header = inspectImageBytes(bytes, false)
  if (file.type && file.type !== 'application/octet-stream' && file.type !== header.mimeType) failV2('图片声明 MIME 与实际格式不一致。')
  return withDecodedImage(file, options.signal, async bitmap => {
    // EXIF orientation is applied by the real decoder before drawing.
    if (!((bitmap.width === header.width && bitmap.height === header.height)
      || (bitmap.width === header.height && bitmap.height === header.width))) failV2('来源图片解码尺寸与方向不一致。')
    if (typeof document === 'undefined') failV2('当前环境缺少 sRGB Canvas 规范化能力。')
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    try {
      const context = canvas.getContext('2d', { colorSpace: 'srgb' })
      if (!context) failV2('无法分配 sRGB Canvas。')
      context.drawImage(bitmap, 0, 0)
      checkCancelled(options.signal)
      const encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片规范化编码失败。')), 'image/png'))
      checkCancelled(options.signal)
      if (encoded.size > PROJECT_LIMITS_V2.imageBytes) failV2('规范化 PNG 超过 20 MiB。')
      const adoptedBytes = normalizePngChunks(new Uint8Array(await encoded.arrayBuffer()))
      const checked = inspectImageBytes(adoptedBytes)
      const sha256 = await sha256Bytes(adoptedBytes)
      checkCancelled(options.signal)
      return { sha256, blob: new Blob([adoptedBytes.slice().buffer], { type: 'image/png' }), mimeType: 'image/png', sizeBytes: adoptedBytes.length, pixelWidth: checked.width, pixelHeight: checked.height }
    } finally {
      canvas.width = 0; canvas.height = 0
    }
  })
}
