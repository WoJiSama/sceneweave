import type { AssetRecord } from '../model/project.js'
import type { NormalizedStaticSvg, SvgRasterProcessor } from '../ai/svg.js'

/** Structural cancellation port; AbortSignal may implement it on a platform. */
export interface CancellationSignal {
  readonly aborted: boolean
  /** Optional immediate notification; flag-only signals use async checkpoints. */
  addEventListener?(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener?(type: 'abort', listener: () => void): void
}
export interface ResourceOptions { signal?: CancellationSignal }
export interface RasterImage { width: number; height: number; rgba: Uint8ClampedArray }
export interface BitmapParameters { tint: string | null; brightness: number }
/** Trusted application adapter, never selected by task JSON or a validated flag. */
export interface ImageProcessingPort {
  /** Trusted adapter opt-in. Omitted adapters retain serial validation. */
  readonly validationConcurrency?: 1 | 2
  decode(bytes: Uint8Array, record: AssetRecord, options?: ResourceOptions): Promise<RasterImage>
  transform(image: RasterImage, parameters: BitmapParameters, options?: ResourceOptions): Promise<RasterImage>
  encodePng(image: RasterImage, options?: ResourceOptions): Promise<Uint8Array>
  /**
   * Normalize an external image into metadata-free sRGB PNG bytes. Browser
   * adapters use a real decoder with EXIF orientation; portable fixtures may
   * omit this and use the explicitly bounded PNG fallback in preparation.
   */
  normalizeImport?(bytes: Uint8Array, declaredMime?: string, options?: ResourceOptions): Promise<{ record: AssetRecord; bytes: Uint8Array }>
}
/** Trusted platform rasterizer; project/task data cannot supply this capability. */
export interface SvgProcessingPort {
  readonly processor: SvgRasterProcessor
  readonly validationConcurrency?: 1 | 2
  rasterize(source: NormalizedStaticSvg, dimensions: { width: number; height: number }, options?: ResourceOptions): Promise<RasterImage>
}
export interface CompleteValidationOptions extends ResourceOptions {
  images: ImageProcessingPort
  svg?: SvgProcessingPort
  /** Explicit migration/recovery capability. Ordinary runtime never supplies it. */
  legacySvg?: SvgProcessingPort
}
export class CancelledOperationError extends Error {
  constructor() { super('操作已取消。'); this.name = 'AbortError' }
}
export function checkCancelled(signal?: CancellationSignal): void {
  if (signal?.aborted) throw new CancelledOperationError()
}
export class ImageCapabilityError extends Error {
  readonly code = 'image-capability-unavailable'
  constructor() { super('缺少真实图片解码/像素处理适配器，不能完成完整工程验证。') }
}
export class SvgCapabilityError extends Error {
  readonly code = 'svg-capability-unavailable'
  constructor() { super('缺少受限SVG真实像素处理适配器，不能完成SVG工程验证。') }
}
export class LegacySvgCapabilityError extends Error {
  readonly code = 'legacy-svg-rasterizer-required'
  constructor() { super('工程含旧版SVG固定资源，须在原生成环境完成独立迁入验证；原始SVG和PNG保持不变。') }
}
