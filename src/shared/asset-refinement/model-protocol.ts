import { z } from 'zod'
import { inspectImageBytes } from '../project/image-bytes.js'
import { sha256Bytes, sha256Text } from '../validation/hash.js'
import { encodeUtf8 } from '../validation/json.js'

/** This is a separate, explicitly configured image API; chat capability grants nothing here. */
export const IMAGE_EDIT_LIMITS = Object.freeze({ inputBytes: 4 * 1024 * 1024, outputBytes: 8 * 1024 * 1024,
  inputPixels: 8_000_000, outputPixels: 8_000_000, side: 3840, promptChars: 2000, promptBytes: 8192,
  requestBytes: 6 * 1024 * 1024, responseBytes: 12 * 1024 * 1024, timeoutMs: 180_000, maxConcurrent: 2 })
export const IMAGE_EDIT_SIZE_POLICY = Object.freeze({ alignment: 16, minPixels: 655360, maxPixels: IMAGE_EDIT_LIMITS.outputPixels,
  maxSide: IMAGE_EDIT_LIMITS.side, maxShortSide: 2160, maxAspectRatio: 3, aspectRatioTolerance: .02 })
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/)
const model = z.string().min(1).max(128).regex(/^[^\s\x00-\x1f\x7f]+$/)
const base64 = (bytes: number) => z.string().min(4).max(Math.ceil(bytes / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
const prompt = z.string().trim().min(1).max(IMAGE_EDIT_LIMITS.promptChars)
  .refine(value => encodeUtf8(value).length <= IMAGE_EDIT_LIMITS.promptBytes)
export const ImageEditRequestSchema = z.strictObject({ schemaVersion: z.literal(1), clientRequestId: id,
  sourceSha256: hash, prompt, pngBase64: base64(IMAGE_EDIT_LIMITS.inputBytes) })
export type ImageEditRequest = z.infer<typeof ImageEditRequestSchema>
export const ImageEditSizeSchema = z.strictObject({ width: z.number().int().min(16).max(IMAGE_EDIT_LIMITS.side).multipleOf(16),
  height: z.number().int().min(16).max(IMAGE_EDIT_LIMITS.side).multipleOf(16) })
export const ImageEditResponseSchema = z.strictObject({ schemaVersion: z.literal(1), sourceSha256: hash, inputHash: hash,
  outputHash: hash, model, requestId: id, requestedSize: ImageEditSizeSchema, pngBase64: base64(IMAGE_EDIT_LIMITS.outputBytes) })
export type ImageEditResponse = z.infer<typeof ImageEditResponseSchema>
export const ImageEditCapabilitiesSchema = z.strictObject({ schemaVersion: z.literal(1), available: z.boolean(), model: model.nullable(),
  protocol: z.literal('openai-images-edits'), inlinePngOnly: z.literal(true), candidates: z.literal(1), automaticRetry: z.literal(false),
  requiredBackground: z.literal('transparent'), providerSupport: z.literal('configured-unverified'),
  limits: z.strictObject({ inputBytes: z.literal(IMAGE_EDIT_LIMITS.inputBytes), outputBytes: z.literal(IMAGE_EDIT_LIMITS.outputBytes),
    inputPixels: z.literal(IMAGE_EDIT_LIMITS.inputPixels), outputPixels: z.literal(IMAGE_EDIT_LIMITS.outputPixels), side: z.literal(IMAGE_EDIT_LIMITS.side),
    promptChars: z.literal(IMAGE_EDIT_LIMITS.promptChars), promptBytes: z.literal(IMAGE_EDIT_LIMITS.promptBytes), timeoutMs: z.literal(IMAGE_EDIT_LIMITS.timeoutMs) }),
  sizePolicy: z.strictObject({ alignment: z.literal(16), minPixels: z.literal(655360), maxPixels: z.literal(8_000_000),
    maxSide: z.literal(3840), maxShortSide: z.literal(2160), maxAspectRatio: z.literal(3), aspectRatioTolerance: z.literal(.02) }),
}).refine(value => value.available === (value.model !== null))
export type ImageEditCapabilities = z.infer<typeof ImageEditCapabilitiesSchema>
export const ImageEditErrorSchema = z.strictObject({ schemaVersion: z.literal(1), error: z.strictObject({
  code: z.string().min(1).max(80).regex(/^[a-z_]+$/), requestState: z.enum(['not_sent', 'unknown', 'finished']), retryable: z.literal(false) }) })

export function imageEditCapabilities(configuredModel?: string): ImageEditCapabilities {
  const { inputBytes, outputBytes, inputPixels, outputPixels, side, promptChars, promptBytes, timeoutMs } = IMAGE_EDIT_LIMITS
  return ImageEditCapabilitiesSchema.parse({ schemaVersion: 1, available: !!configuredModel, model: configuredModel ?? null,
    protocol: 'openai-images-edits', inlinePngOnly: true, candidates: 1, automaticRetry: false,
    requiredBackground: 'transparent', providerSupport: 'configured-unverified',
    limits: { inputBytes, outputBytes, inputPixels, outputPixels, side, promptChars, promptBytes, timeoutMs }, sizePolicy: IMAGE_EDIT_SIZE_POLICY })
}
export function encodeImageEditBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const parts: string[] = []; let part = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const value = bytes[i] * 65536 + (bytes[i + 1] ?? 0) * 256 + (bytes[i + 2] ?? 0)
    part += alphabet[value >>> 18] + alphabet[value >>> 12 & 63] + (i + 1 < bytes.length ? alphabet[value >>> 6 & 63] : '=') + (i + 2 < bytes.length ? alphabet[value & 63] : '=')
    if (part.length >= 8192) { parts.push(part); part = '' }
  }
  parts.push(part); return parts.join('')
}
export function decodeImageEditBase64(value: string, maximum: number): Uint8Array {
  if (!base64(maximum).safeParse(value).success) throw new Error('Invalid inline PNG encoding')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes = new Uint8Array(value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0))
  if (!bytes.length || bytes.length > maximum) throw new Error('Image byte limit')
  let offset = 0
  for (let i = 0; i < value.length; i += 4) {
    const bits = alphabet.indexOf(value[i]) * 262144 + alphabet.indexOf(value[i + 1]) * 4096
      + (value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2])) * 64 + (value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]))
    if (offset < bytes.length) bytes[offset++] = bits >>> 16
    if (offset < bytes.length) bytes[offset++] = bits >>> 8 & 255
    if (offset < bytes.length) bytes[offset++] = bits & 255
  }
  if (encodeImageEditBase64(bytes) !== value) throw new Error('Noncanonical image encoding')
  return bytes
}
/** Container/hash validation here precedes the host's actual pixel decoder and license checks. */
export function inspectImageEditPng(bytes: Uint8Array, direction: 'input' | 'output') {
  if (!bytes.length || bytes.length > IMAGE_EDIT_LIMITS[direction === 'input' ? 'inputBytes' : 'outputBytes']) throw new Error('Image byte limit')
  const header = inspectImageBytes(bytes, direction === 'input')
  if (header.mimeType !== 'image/png' || header.width > IMAGE_EDIT_LIMITS.side || header.height > IMAGE_EDIT_LIMITS.side
    || header.width * header.height > IMAGE_EDIT_LIMITS[direction === 'input' ? 'inputPixels' : 'outputPixels']
    || bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[28] !== 0) throw new Error('Expected bounded static 8-bit RGB/RGBA PNG')
  return header
}
/** Search the 16-pixel grid; unsupported aspect ratios fail rather than being cropped or stretched. */
export function chooseImageEditSize(width: number, height: number): { width: number; height: number } {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid image dimensions')
  const ratio = width / height, target = Math.max(IMAGE_EDIT_SIZE_POLICY.minPixels, Math.min(width * height, IMAGE_EDIT_SIZE_POLICY.maxPixels))
  if (ratio < 1 / IMAGE_EDIT_SIZE_POLICY.maxAspectRatio || ratio > IMAGE_EDIT_SIZE_POLICY.maxAspectRatio) throw new Error('Source aspect ratio is outside image editing policy')
  let best: { width: number; height: number; score: number } | undefined
  for (let w = 16; w <= IMAGE_EDIT_SIZE_POLICY.maxSide; w += 16) {
    for (const h of [Math.floor(w / ratio / 16) * 16, Math.ceil(w / ratio / 16) * 16]) {
      const pixels = w * h, error = Math.abs(w / h / ratio - 1)
      if (h < 16 || h > IMAGE_EDIT_SIZE_POLICY.maxSide || Math.min(w, h) > IMAGE_EDIT_SIZE_POLICY.maxShortSide || w / h < 1 / 3 || w / h > 3
        || pixels < IMAGE_EDIT_SIZE_POLICY.minPixels || pixels > IMAGE_EDIT_SIZE_POLICY.maxPixels || error > IMAGE_EDIT_SIZE_POLICY.aspectRatioTolerance) continue
      const score = Math.abs(Math.log(pixels / target)) + error * 4
      if (!best || score < best.score) best = { width: w, height: h, score }
    }
  }
  if (!best) throw new Error('Source aspect ratio cannot fit image editing size policy')
  return { width: best.width, height: best.height }
}
export function imageEditInputHash(request: Pick<ImageEditRequest, 'sourceSha256' | 'prompt'>, selectedModel: string, size: { width: number; height: number }): string {
  return sha256Text(JSON.stringify(['sceneweave-image-edit@1', request.sourceSha256, request.prompt, selectedModel, size.width, size.height]))
}
export { sha256Bytes }
