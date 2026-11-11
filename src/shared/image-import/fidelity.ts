import type { ImagePixels } from './pixels.js'

export const IMAGE_IMPORT_FIDELITY_RULES = Object.freeze([
  Object.freeze({ code: 'palette-loss', message: '不得用有限分色描摹改变原图颜色、细线和手绘笔触。' }),
  Object.freeze({ code: 'material-replacement', message: '不得用程序木板、织物或其他模板替换原来可见的纹理。' }),
  Object.freeze({ code: 'theme-override', message: '原生几何不能用默认墙色、描边、阴影或滤镜覆盖原画。' }),
  Object.freeze({ code: 'visible-pixels-changed', message: '同坐标原图可见区域必须保留；遮挡与边缘推断范围单独列出。' }),
  Object.freeze({ code: 'outside-scope-changed', message: '选定范围之外的源像素不能被修补、调色或删除。' }),
  Object.freeze({ code: 'roundtrip-not-fidelity', message: '保存重开一致只证明存取，不证明与原图一致。' }),
  Object.freeze({ code: 'inference-unverified', message: '遮挡推断不构成恢复真实原细节的证明，不得把整幅图豁免比较。' }),
  Object.freeze({ code: 'sampling-not-restoration', message: '提高像素尺寸不等于还原源图没有的细节，不能借高清化改变风格。' }),
] as const)

export class ImageFidelityError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ImageFidelityError' }
}
export interface ImageFidelityOptions {
  scopeMask?: Uint8Array
  allowedInferenceMask?: Uint8Array
  comparisonKind?: 'source' | 'roundtrip'
}
export interface ImageFidelityReport {
  verified: boolean
  passed: boolean
  status: 'passed' | 'failed' | 'unverified'
  comparisonKind: 'source' | 'roundtrip'
  verificationScope: 'source-visible' | 'source-outside-inference' | 'unverified'
  comparedPixels: number
  changedPixels: number
  inferredPixels: number
  inferenceChangedPixels: number
  maxChannelError: number
  meanChannelError: number
  outsideScopeChangedPixels: number
  alphaChangedPixels: number
  missingCoveragePixels: number
  addedCoveragePixels: number
  issues: Array<{ code: string; message: string }>
}
function checkImage(image: ImagePixels): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
    || image.width > 8192 || image.height > 8192 || image.width * image.height > 32_000_000
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new ImageFidelityError('invalid-image', '原图保真比较需要完整且受预算约束的RGBA。')
}

/** Exact, same-grid comparison; never aligns, recolours, resizes, or trusts a saved "passed" flag. */
export function compareImageFidelity(source: ImagePixels, candidate: ImagePixels, options: ImageFidelityOptions = {}): ImageFidelityReport {
  checkImage(source); checkImage(candidate)
  if (source.width !== candidate.width || source.height !== candidate.height) throw new ImageFidelityError('unaligned-images', '原图保真比较必须使用相同尺寸与坐标，不能自动缩放或对齐。')
  const pixels = source.width * source.height, kind = options.comparisonKind ?? 'source'
  if (kind !== 'source' && kind !== 'roundtrip') throw new ImageFidelityError('invalid-comparison', '必须明确区分原图比较和存取比较。')
  for (const mask of [options.scopeMask, options.allowedInferenceMask]) if (mask !== undefined && (!(mask instanceof Uint8Array) || mask.length !== pixels)) throw new ImageFidelityError('invalid-mask', '比较范围和推断遮罩必须与原图逐像素对应。')
  const report: ImageFidelityReport = { verified: false, passed: false, status: 'unverified', comparisonKind: kind, verificationScope: 'unverified',
    comparedPixels: 0, changedPixels: 0, inferredPixels: 0, inferenceChangedPixels: 0, maxChannelError: 0, meanChannelError: 0,
    outsideScopeChangedPixels: 0, alphaChangedPixels: 0, missingCoveragePixels: 0, addedCoveragePixels: 0, issues: [] }
  let errorSum = 0
  for (let index = 0; index < pixels; index++) {
    const offset = index * 4, errors = [0, 1, 2, 3].map(channel => Math.abs(source.data[offset + channel] - candidate.data[offset + channel])), changed = errors.some(Boolean)
    if (options.scopeMask && !options.scopeMask[index]) { if (changed) report.outsideScopeChangedPixels++; continue }
    if (!source.data[offset + 3] && !candidate.data[offset + 3] && !changed) continue
    if (options.allowedInferenceMask?.[index]) { report.inferredPixels++; if (changed) report.inferenceChangedPixels++; continue }
    report.comparedPixels++
    if (changed) report.changedPixels++
    if (errors[3]) report.alphaChangedPixels++
    if (source.data[offset + 3] > candidate.data[offset + 3]) report.missingCoveragePixels++
    if (source.data[offset + 3] < candidate.data[offset + 3]) report.addedCoveragePixels++
    report.maxChannelError = Math.max(report.maxChannelError, ...errors)
    errorSum += errors.reduce((sum, error) => sum + error, 0)
  }
  report.meanChannelError = report.comparedPixels ? errorSum / (report.comparedPixels * 4) : 0
  if (report.changedPixels) report.issues.push({ code: 'visible-pixels-changed', message: `${report.changedPixels}个原图可见像素发生变化。` })
  if (report.outsideScopeChangedPixels) report.issues.push({ code: 'outside-scope-changed', message: `${report.outsideScopeChangedPixels}个范围外像素发生变化。` })
  if (report.inferredPixels) report.issues.push({ code: 'inference-unverified', message: `${report.inferredPixels}个推断像素单独列出，未证明真实原细节。` })
  if (kind === 'roundtrip') report.issues.push({ code: 'roundtrip-not-fidelity', message: '本次只比较了存取结果，不能签为原图保真。' })
  if (!report.comparedPixels) report.issues.push({ code: 'insufficient-reference', message: '没有可比较的原图像素；空范围或整图推断不能通过。' })
  report.verified = kind === 'source' && report.comparedPixels > 0
  report.passed = report.verified && report.changedPixels === 0 && report.outsideScopeChangedPixels === 0
  report.status = report.passed ? 'passed' : report.verified ? 'failed' : 'unverified'
  report.verificationScope = report.verified ? report.inferredPixels ? 'source-outside-inference' : 'source-visible' : 'unverified'
  return report
}

/** Current lossy trace/template methods are not permitted in the source-preserving import path. */
export function assertSourcePreservingRecipe(recipe: { floorVector?: { kind: string }; layers: readonly { vector?: { kind: string } }[] }): void {
  for (const vector of [recipe.floorVector, ...recipe.layers.map(layer => layer.vector)]) {
    if (!vector) continue
    if (vector.kind === 'wood' || vector.kind === 'rug') throw new ImageFidelityError('material-replacement', '原图保真禁止用程序木板或织物模板替换原画，请恢复原图外观。')
    throw new ImageFidelityError('palette-loss', '当前矢量描摹会减色并改变笔触，未通过原图保真，不能采用。请恢复原图外观。')
  }
}
