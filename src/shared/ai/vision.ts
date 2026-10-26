import { z } from 'zod'
import { inspectImageBytes } from '../project/image-bytes.js'
import { sha256Bytes } from '../validation/hash.js'
import { captureJson } from '../validation/json.js'

export const VISION_LIMITS = Object.freeze({ imageBytes: 512 * 1024, side: 1024, pixels: 786432, imagesPerTask: 4,
  requestBytes: 6 * 1024 * 1024 })
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
export const VisionInputSchema = z.object({ schemaVersion: z.literal(1), disclosure: z.literal('public-png-to-provider'),
  sceneId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/), revision: integer.nonnegative(),
  boundsMm: z.object({ x: integer, y: integer, width: integer.positive(), height: integer.positive() }).strict(),
  width: z.number().int().min(1).max(VISION_LIMITS.side), height: z.number().int().min(1).max(VISION_LIMITS.side),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pngBase64: z.string().min(4).max(Math.ceil(VISION_LIMITS.imageBytes / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  draft: z.object({ draftRevision: z.number().int().nonnegative().max(256), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
}).strict().refine(value => value.width * value.height <= VISION_LIMITS.pixels, '截图像素超过上限。')
export type VisionInput = z.infer<typeof VisionInputSchema>
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function visionBase64(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > VISION_LIMITS.imageBytes) throw new Error('截图字节超出上限。')
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const value = bytes[i] * 65536 + (bytes[i + 1] ?? 0) * 256 + (bytes[i + 2] ?? 0)
    parts.push(alphabet[value >>> 18], alphabet[value >>> 12 & 63], i + 1 < bytes.length ? alphabet[value >>> 6 & 63] : '=', i + 2 < bytes.length ? alphabet[value & 63] : '=')
  }
  return parts.join('')
}
export function verifyVisionInput(input: unknown): { input: VisionInput; bytes: Uint8Array } {
  const value = VisionInputSchema.parse(captureJson(input))
  if (![value.boundsMm.x + value.boundsMm.width, value.boundsMm.y + value.boundsMm.height].every(Number.isSafeInteger)) throw new Error('截图范围超出安全整数。')
  const encoded = value.pngBase64, bytes = new Uint8Array(encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0))
  if (!bytes.length || bytes.length > VISION_LIMITS.imageBytes) throw new Error('截图字节超出上限。')
  let offset = 0
  for (let i = 0; i < encoded.length; i += 4) {
    const bits = alphabet.indexOf(encoded[i]) * 262144 + alphabet.indexOf(encoded[i + 1]) * 4096
      + (encoded[i + 2] === '=' ? 0 : alphabet.indexOf(encoded[i + 2])) * 64 + (encoded[i + 3] === '=' ? 0 : alphabet.indexOf(encoded[i + 3]))
    if (offset < bytes.length) bytes[offset++] = bits >>> 16
    if (offset < bytes.length) bytes[offset++] = bits >>> 8 & 255
    if (offset < bytes.length) bytes[offset++] = bits & 255
  }
  if (visionBase64(bytes) !== encoded || sha256Bytes(bytes) !== value.sha256) throw new Error('截图编码或hash不匹配。')
  const header = inspectImageBytes(bytes, true)
  if (header.mimeType !== 'image/png' || header.width !== value.width || header.height !== value.height) throw new Error('截图实际格式或尺寸不匹配。')
  // A screenshot is a normalized, non-interlaced 8-bit RGB/RGBA Canvas product.
  if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[28] !== 0) throw new Error('截图必须为8位RGB/RGBA静态PNG。')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 8; offset < bytes.length;) {
    if (!['IHDR', 'sRGB', 'IDAT', 'IEND'].includes(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)))) throw new Error('截图不能含调色板、额外透明键或元数据。')
    offset += view.getUint32(offset) + 12
  }
  return { input: value, bytes }
}

/** Only call with a freshly rendered player projection, after explicit screenshot disclosure. */
export function createPublicVisionInput(bytes: Uint8Array, details: Omit<VisionInput, 'schemaVersion' | 'disclosure' | 'pngBase64' | 'sha256' | 'width' | 'height'>): VisionInput {
  const captured = new Uint8Array(bytes), header = inspectImageBytes(captured, true)
  return verifyVisionInput({ ...details, schemaVersion: 1, disclosure: 'public-png-to-provider', width: header.width, height: header.height,
    sha256: sha256Bytes(captured), pngBase64: visionBase64(captured) }).input
}
