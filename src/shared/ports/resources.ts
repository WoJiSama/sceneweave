import type { AssetRecord } from '../model/project.js'
import type { NormalizedStaticSvg } from '../ai/svg.js'

/** Structural cancellation port; AbortSignal may implement it on a platform. */
export interface CancellationSignal { readonly aborted: boolean }
export interface ResourceOptions { signal?: CancellationSignal }
export interface RasterImage { width: number; height: number; rgba: Uint8ClampedArray }
export interface BitmapParameters { tint: string | null; brightness: number }
/** Trusted application adapter, never selected by task JSON or a validated flag. */
export interface ImageProcessingPort {
  decode(bytes: Uint8Array, record: AssetRecord, options?: ResourceOptions): Promise<RasterImage>
  transform(image: RasterImage, parameters: BitmapParameters, options?: ResourceOptions): Promise<RasterImage>
  encodePng(image: RasterImage, options?: ResourceOptions): Promise<Uint8Array>
}
/** Trusted platform rasterizer; project/task data cannot supply this capability. */
export interface SvgProcessingPort {
  rasterize(source: NormalizedStaticSvg, dimensions: { width: number; height: number }, options?: ResourceOptions): Promise<RasterImage>
}
export interface CompleteValidationOptions extends ResourceOptions { images: ImageProcessingPort; svg?: SvgProcessingPort }
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
