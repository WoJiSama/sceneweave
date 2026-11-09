import type { RasterImage, ResourceOptions } from '../ports/resources.js'
import { checkCancelled } from '../ports/resources.js'
import { PACKAGE_LIMITS } from '../project/limits.js'
import { freezeJson } from '../validation/json.js'

/** Screening thresholds are explicit, independent of project/recipe versions.
 * They flag review risks, not artistic merit or permission to skip validation. */
export const ASSET_QUALITY_POLICY = freezeJson({
  id: 'asset-quality-v1' as const,
  // 128 px/m is a review prompt for typical map output, not a minimum art style.
  recommendedPixelsPerMeter: 128,
  // A tiny subject may be intentional pixel art; it must never be a hard error.
  smallSubjectSidePx: 24,
  // A small bounding box wastes most of the declared image size/world extent.
  paddedBoundsFraction: 0.15,
  // A partly transparent image with substantial opaque edge contact may be cut.
  clippedPerimeterFraction: 0.35,
  // Exclude ordinary antialiasing from the material transparency warning.
  materialHoleAlpha: 250,
  materialHoleFraction: 0.005,
  // Opposite borders must disagree visibly AND more than neighbouring texture.
  seamDifference: 0.08,
  seamToLocalDifferenceRatio: 2,
  // A uniformly faint decal is legal, but deserves an explicit review prompt.
  faintMaximumAlpha: 32,
})

export interface AssetQualityContext { kind: 'prop' | 'material'; widthMm: number; heightMm: number }
export type AssetQualityIssueCode = 'fully-transparent' | 'low-resolution' | 'small-visible-subject'
  | 'large-transparent-padding' | 'opaque-prop-background' | 'possible-edge-clipping'
  | 'faint-content' | 'material-transparency' | 'possible-material-seam'
export interface AssetQualityIssue { code: AssetQualityIssueCode; severity: 'error' | 'warning'; message: string }
export interface AssetQualityBounds { x: number; y: number; width: number; height: number }
export interface AssetQualityMetrics {
  totalPixels: number
  visiblePixels: number
  transparentPixels: number
  alphaCoverage: number
  maximumAlpha: number
  contentBounds: AssetQualityBounds | null
  contentBoundsFraction: number
  pixelsPerMeter: { x: number; y: number; minimum: number }
  opaquePerimeterFraction: number
  materialHoleFraction: number
  materialSeam: null | {
    horizontal: number; vertical: number
    horizontalLocalDifference: number; verticalLocalDifference: number
  }
}
export interface AssetQualityReport {
  format: 'sceneweave-asset-quality'
  version: 1
  policyId: typeof ASSET_QUALITY_POLICY.id
  context: AssetQualityContext
  pixelWidth: number
  pixelHeight: number
  status: 'blocked' | 'review' | 'pass'
  metrics: AssetQualityMetrics
  issues: AssetQualityIssue[]
}

function checkInput(image: RasterImage, context: AssetQualityContext): void {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width > PACKAGE_LIMITS.imageSide || image.height > PACKAGE_LIMITS.imageSide
    || image.width * image.height > PACKAGE_LIMITS.imagePixels
    || !(image.rgba instanceof Uint8ClampedArray) || image.rgba.length !== image.width * image.height * 4) {
    throw new Error('素材初筛需要保护范围内的真实完整RGBA像素。')
  }
  if (!context || !['prop', 'material'].includes(context.kind)
    || ![context.widthMm, context.heightMm].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1_000_000)) {
    throw new Error('素材初筛需要明确用途与有界整数毫米尺寸。')
  }
}

/** Normalised premultiplied RGBA distance. Hidden RGB does not create a seam. */
function pixelDifference(rgba: Uint8ClampedArray, first: number, second: number): number {
  const a = rgba[first + 3], b = rgba[second + 3]
  return (Math.abs(rgba[first] * a - rgba[second] * b) / 255
    + Math.abs(rgba[first + 1] * a - rgba[second + 1] * b) / 255
    + Math.abs(rgba[first + 2] * a - rgba[second + 2] * b) / 255 + Math.abs(a - b)) / 1020
}

/**
 * Deterministic, read-only screening of actual decoded pixels. No DOM, network,
 * decoded-image cache, aesthetic score or trust certificate is involved. Only a
 * fully transparent image is unambiguously unusable; every heuristic is a
 * warning for explicit review. Existing content is never rewritten or removed.
 */
export function assessAssetQuality(image: RasterImage, context: AssetQualityContext, options: ResourceOptions = {}): AssetQualityReport {
  checkCancelled(options.signal)
  checkInput(image, context)
  const { width, height, rgba } = image, totalPixels = width * height
  let visiblePixels = 0, transparentPixels = 0, alphaSum = 0, maximumAlpha = 0, holes = 0
  let left = width, top = height, right = -1, bottom = -1, perimeter = 0, opaquePerimeter = 0
  // All alpha values are visited: sparse one-pixel content cannot be missed by
  // a downsample grid. Memory use is constant and does not duplicate the raster.
  for (let y = 0; y < height; y++) {
    if ((y & 31) === 0) checkCancelled(options.signal)
    for (let x = 0; x < width; x++) {
      const alpha = rgba[(y * width + x) * 4 + 3]
      alphaSum += alpha; maximumAlpha = Math.max(maximumAlpha, alpha)
      if (alpha > 0) {
        visiblePixels++
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
      } else transparentPixels++
      if (alpha < ASSET_QUALITY_POLICY.materialHoleAlpha) holes++
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        perimeter++
        if (alpha >= 128) opaquePerimeter++
      }
    }
  }
  checkCancelled(options.signal)
  const contentBounds = visiblePixels ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null
  const pixelsPerMeter = { x: width * 1000 / context.widthMm, y: height * 1000 / context.heightMm,
    minimum: Math.min(width * 1000 / context.widthMm, height * 1000 / context.heightMm) }
  const metrics: AssetQualityMetrics = { totalPixels, visiblePixels, transparentPixels, alphaCoverage: alphaSum / (totalPixels * 255), maximumAlpha,
    contentBounds, contentBoundsFraction: contentBounds ? contentBounds.width * contentBounds.height / totalPixels : 0,
    pixelsPerMeter, opaquePerimeterFraction: opaquePerimeter / perimeter, materialHoleFraction: holes / totalPixels, materialSeam: null }
  if (context.kind === 'material' && width > 1 && height > 1) {
    let horizontal = 0, vertical = 0, horizontalLocal = 0, verticalLocal = 0
    for (let y = 0; y < height; y++) {
      if ((y & 255) === 0) checkCancelled(options.signal)
      const first = y * width * 4, last = first + (width - 1) * 4
      horizontal += pixelDifference(rgba, first, last)
      horizontalLocal += (pixelDifference(rgba, first, first + 4) + pixelDifference(rgba, last, last - 4)) / 2
    }
    for (let x = 0; x < width; x++) {
      if ((x & 255) === 0) checkCancelled(options.signal)
      const first = x * 4, last = ((height - 1) * width + x) * 4
      vertical += pixelDifference(rgba, first, last)
      verticalLocal += (pixelDifference(rgba, first, first + width * 4) + pixelDifference(rgba, last, last - width * 4)) / 2
    }
    metrics.materialSeam = { horizontal: horizontal / height, vertical: vertical / width,
      horizontalLocalDifference: horizontalLocal / height, verticalLocalDifference: verticalLocal / width }
  }
  const issues: AssetQualityIssue[] = []
  const warn = (code: AssetQualityIssueCode, message: string) => issues.push({ code, severity: 'warning', message })
  if (!visiblePixels) {
    issues.push({ code: 'fully-transparent', severity: 'error', message: '图片完全透明，没有可见素材；请更换图片或重新生成。' })
  } else {
    if (pixelsPerMeter.minimum < ASSET_QUALITY_POLICY.recommendedPixelsPerMeter) warn('low-resolution',
      `当前标定约${Math.round(pixelsPerMeter.minimum)}像素/米，低于初筛参考128像素/米；请核对世界尺寸及近景清晰度，像素画可人工保留。`)
    if (contentBounds && Math.min(contentBounds.width, contentBounds.height) < ASSET_QUALITY_POLICY.smallSubjectSidePx) warn('small-visible-subject',
      '可见内容最短边不足24像素；请检查细节是否足够，细线或像素画可人工保留。')
    if (maximumAlpha < ASSET_QUALITY_POLICY.faintMaximumAlpha) warn('faint-content',
      '整张图片的最大不透明度低于约13%；请检查是否过淡，半透明效果素材可人工保留。')
    if (context.kind === 'prop') {
      if (metrics.contentBoundsFraction < ASSET_QUALITY_POLICY.paddedBoundsFraction) warn('large-transparent-padding',
        '可见内容的外接框不足整图15%；请核对透明留白、图像尺寸与根锚，不会自动裁边。')
      if (!transparentPixels) warn('opaque-prop-background',
        '物件图片没有完全透明像素，可能带有矩形背景；请核对抠图，完整平面图或照片可人工保留。')
      else if (metrics.opaquePerimeterFraction >= ASSET_QUALITY_POLICY.clippedPerimeterFraction) warn('possible-edge-clipping',
        '物件在图像边界有较多可见内容，可能被裁切；请检查轮廓和外沿，贴边图案可人工保留。')
    } else {
      if (metrics.materialHoleFraction > ASSET_QUALITY_POLICY.materialHoleFraction) warn('material-transparency',
        '材质含较多透明或半透明像素，平铺时可能露底；请检查2×2或3×3铺装，覆盖型材质可人工保留。')
      const seam = metrics.materialSeam
      if (seam && (seam.horizontal > ASSET_QUALITY_POLICY.seamDifference && seam.horizontal > seam.horizontalLocalDifference * ASSET_QUALITY_POLICY.seamToLocalDifferenceRatio
        || seam.vertical > ASSET_QUALITY_POLICY.seamDifference && seam.vertical > seam.verticalLocalDifference * ASSET_QUALITY_POLICY.seamToLocalDifferenceRatio)) warn('possible-material-seam',
        '材质相对边缘的色差明显大于附近纹理变化，平铺可能有接缝；请检查2×2或3×3铺装，不会自动修图。')
    }
  }
  checkCancelled(options.signal)
  return freezeJson({ format: 'sceneweave-asset-quality', version: 1, policyId: ASSET_QUALITY_POLICY.id,
    context: { kind: context.kind, widthMm: context.widthMm, heightMm: context.heightMm }, pixelWidth: width, pixelHeight: height,
    status: issues.some(issue => issue.severity === 'error') ? 'blocked' : issues.length ? 'review' : 'pass', metrics, issues })
}
