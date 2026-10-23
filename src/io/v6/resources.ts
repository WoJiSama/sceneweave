import type { BitmapVariantV6 } from '../../core/v6/types'
import { inspectImageBytes, normalizeImageAsset, sha256Bytes, validateImageAssetRecord, withImageDecoderSlotV2 } from '../v2/resources'
import { checkCancelled, failV6 } from './limits'
import type { AssetBlobRecord, CompleteProjectV6 } from './types'
export { inspectImageBytes, normalizeImageAsset, sha256Bytes }

/** Parameters operate in normalized sRGB byte space. Opacity is a separate scene field. */
export function transformRgbaV6(input: Uint8ClampedArray, tint: string | null, brightness: number): Uint8ClampedArray {
  if (input.length % 4 || tint !== null && !/^#[0-9a-f]{6}$/i.test(tint) || !Number.isFinite(brightness) || brightness < .25 || brightness > 2) failV6('位图参数或RGBA数据无效。')
  const color = tint === null ? [255, 255, 255] : [1, 3, 5].map(offset => parseInt(tint.slice(offset, offset + 2), 16))
  const result = new Uint8ClampedArray(input.length)
  for (let i = 0; i < input.length; i += 4) {
    result[i + 3] = input[i + 3]
    if (!input[i + 3]) continue
    for (let channel = 0; channel < 3; channel++) result[i + channel] = Math.round(Math.min(255, input[i + channel] * color[channel] / 255 * brightness))
  }
  return result
}

function canvasFor(width: number, height: number) {
  if (typeof document === 'undefined') failV6('当前环境缺少真实sRGB Canvas像素处理能力。')
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!context) { canvas.width = 0; canvas.height = 0; failV6('无法分配sRGB位图处理画布。') }
  return { canvas, context }
}

/** Pixels are detached; decoded image and temporary canvas are always released. */
export async function readBitmapPixelsV6(record: AssetBlobRecord, options: { signal?: AbortSignal } = {}): Promise<Uint8ClampedArray> {
  const header = inspectImageBytes(new Uint8Array(await record.blob.arrayBuffer()))
  if (header.width !== record.pixelWidth || header.height !== record.pixelHeight || header.mimeType !== record.mimeType) failV6('像素读取的位图尺寸或类型不匹配。')
  return withImageDecoderSlotV2(options.signal, async () => {
    checkCancelled(options.signal)
    if (typeof createImageBitmap !== 'function') failV6('当前环境缺少真实位图解码能力。')
    const bitmap = await createImageBitmap(record.blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' })
    try {
      checkCancelled(options.signal)
      if (bitmap.width !== record.pixelWidth || bitmap.height !== record.pixelHeight) failV6('实际解码尺寸与位图记录不一致。')
      const { canvas, context } = canvasFor(bitmap.width, bitmap.height)
      try { context.drawImage(bitmap, 0, 0); return context.getImageData(0, 0, bitmap.width, bitmap.height).data.slice() }
      finally { canvas.width = 0; canvas.height = 0 }
    } finally { bitmap.close() }
  })
}

function transformedCanvas(source: AssetBlobRecord, pixels: Uint8ClampedArray, variant: Pick<BitmapVariantV6, 'tint' | 'brightness'>) {
  const { canvas, context } = canvasFor(source.pixelWidth, source.pixelHeight)
  try {
    const data = context.createImageData(source.pixelWidth, source.pixelHeight)
    data.data.set(transformRgbaV6(pixels, variant.tint, variant.brightness))
    context.putImageData(data, 0, 0)
    return { canvas, context }
  } catch (error) { canvas.width = 0; canvas.height = 0; throw error }
}

export async function deriveBitmapVariantV6(source: AssetBlobRecord, variant: Pick<BitmapVariantV6, 'tint' | 'brightness'>, options: { signal?: AbortSignal } = {}): Promise<AssetBlobRecord> {
  checkCancelled(options.signal)
  await validateImageAssetRecord(source, options)
  const pixels = await readBitmapPixelsV6(source, options), { canvas } = transformedCanvas(source, pixels, variant)
  let encoded: Blob
  try {
    checkCancelled(options.signal)
    encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('派生位图编码失败。')), 'image/png'))
  } finally { canvas.width = 0; canvas.height = 0 }
  checkCancelled(options.signal)
  // Reuse the established metadata-stripping/header/hash contract for the adopted bytes.
  return normalizeImageAsset(encoded, options)
}

/** A valid hash only proves bytes are intact; every variant must also prove its actual pixels. */
export async function validateBitmapVariantsV6(project: CompleteProjectV6, options: { signal?: AbortSignal } = {}): Promise<void> {
  for (const variant of Object.values(project.appearance.variants)) {
    checkCancelled(options.signal)
    const sourceAsset = project.document.assets[variant.sourceAssetId], outputAsset = project.document.assets[variant.outputAssetId]
    if (!sourceAsset || !outputAsset) failV6('派生位图的源或输出资源缺失。')
    const source = project.assets[sourceAsset.sha256], output = project.assets[outputAsset.sha256]
    if (!source || !output || source.pixelWidth !== output.pixelWidth || source.pixelHeight !== output.pixelHeight || output.mimeType !== 'image/png') failV6('派生位图必须保留源像素尺寸并采用规范化PNG。')
    if (sourceAsset.licenseRef !== outputAsset.licenseRef || sourceAsset.origin.kind !== outputAsset.origin.kind
      || sourceAsset.origin.attribution !== outputAsset.origin.attribution || sourceAsset.origin.canEmbed !== outputAsset.origin.canEmbed) failV6('派生位图不得改变源许可或来源。')
    const pixels = await readBitmapPixelsV6(source, options), { canvas, context } = transformedCanvas(source, pixels, variant)
    let expected: Uint8ClampedArray
    try { expected = context.getImageData(0, 0, source.pixelWidth, source.pixelHeight).data.slice() }
    finally { canvas.width = 0; canvas.height = 0 }
    const actual = await readBitmapPixelsV6(output, options)
    if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) failV6(`派生位图${variant.id}的真实像素与固定源/参数不一致。`)
  }
  checkCancelled(options.signal)
}
