import { z } from 'zod'
import type { PointMm } from '../model/scene.js'
import { captureJson, freezeJson } from '../validation/json.js'

export interface ImagePoint { readonly x: number; readonly y: number }
export interface ImageDimensions { readonly pixelWidth: number; readonly pixelHeight: number }
export interface ImageCalibrationInput extends ImageDimensions {
  readonly first: ImagePoint
  readonly second: ImagePoint
  readonly distanceMm: number
  readonly originPx?: ImagePoint
}
export interface ImageCalibration extends ImageDimensions {
  readonly first: ImagePoint
  readonly second: ImagePoint
  readonly distanceMm: number
  readonly originPx: ImagePoint
  readonly mmPerPixel: number
}

export const imagePointSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() })
export const imageDimensionsSchema = z.strictObject({
  pixelWidth: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  pixelHeight: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
const calibrationInputSchema = imageDimensionsSchema.extend({
  first: imagePointSchema, second: imagePointSchema,
  distanceMm: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  originPx: imagePointSchema.optional(),
})

export function assertImagePoint(image: ImageDimensions, point: ImagePoint): void {
  imagePointSchema.parse(point)
  if (point.x < 0 || point.y < 0 || point.x > image.pixelWidth || point.y > image.pixelHeight) {
    throw new Error('标注点超出原图范围。')
  }
}

/** Pixel axes stay aligned to the source image; the ruler sets scale, not rotation. */
export function createImageCalibration(input: ImageCalibrationInput): ImageCalibration {
  const value = calibrationInputSchema.parse(captureJson(input))
  const originPx = value.originPx ?? { x: 0, y: 0 }
  for (const point of [value.first, value.second, originPx]) assertImagePoint(value, point)
  const pixels = Math.hypot(value.second.x - value.first.x, value.second.y - value.first.y)
  if (pixels === 0) throw new Error('比例标定需要两个不同的点。')
  const mmPerPixel = value.distanceMm / pixels
  if (!Number.isFinite(mmPerPixel) || !Number.isSafeInteger(Math.round(Math.max(value.pixelWidth, value.pixelHeight) * mmPerPixel))) {
    throw new Error('比例尺超出整数毫米可表示范围。')
  }
  return freezeJson({ ...value, originPx, mmPerPixel })
}

export function imagePointToWorldMm(calibration: ImageCalibration, point: ImagePoint): PointMm {
  assertImagePoint(calibration, point)
  return { x: Math.round((point.x - calibration.originPx.x) * calibration.mmPerPixel),
    y: Math.round((point.y - calibration.originPx.y) * calibration.mmPerPixel) }
}

export function imageDistanceToMm(calibration: ImageCalibration, pixels: number): number {
  const distanceMm = Math.round(pixels * calibration.mmPerPixel)
  if (!Number.isFinite(pixels) || pixels < 0 || !Number.isSafeInteger(distanceMm)) throw new Error('像素距离无效或超出整数毫米范围。')
  return distanceMm
}
