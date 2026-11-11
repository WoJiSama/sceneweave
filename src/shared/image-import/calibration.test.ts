import { describe, expect, it } from 'vitest'
import { createImageCalibration, imageDistanceToMm, imagePointToWorldMm } from './calibration.js'

const input = { pixelWidth: 1280, pixelHeight: 840, first: { x: 750, y: 200 }, second: { x: 850, y: 200 },
  distanceMm: 2000, originPx: { x: 738, y: 109 } }

describe('image pixel calibration', () => {
  it('maps source coordinates and distances to integer millimetres independently of the viewport', () => {
    const calibration = createImageCalibration(input)
    expect(calibration.mmPerPixel).toBe(20)
    expect(imagePointToWorldMm(calibration, { x: 780, y: 240 })).toEqual({ x: 840, y: 2620 })
    expect(imagePointToWorldMm(calibration, { x: 780.08, y: 240.01 })).toEqual({ x: 842, y: 2620 })
    expect(imageDistanceToMm(calibration, 4.7)).toBe(94)
    expect(Object.isFrozen(calibration.first)).toBe(true)
    expect(calibration.first).not.toBe(input.first)
  })

  it('rejects coincident, out-of-image or non-finite ruler points, invalid physical distances and overflow', () => {
    for (const change of [{ second: input.first }, { first: { x: -1, y: 5 } }, { second: { x: 1281, y: 5 } },
      { first: { x: Infinity, y: 0 } }, { distanceMm: 0 }, { distanceMm: .5 }, { distanceMm: Number.MAX_SAFE_INTEGER }]) {
      expect(() => createImageCalibration({ ...input, ...change })).toThrow()
    }
    const calibration = createImageCalibration(input)
    expect(() => imagePointToWorldMm(calibration, { x: 0, y: 841 })).toThrow('原图范围')
    expect(() => imageDistanceToMm(calibration, -1)).toThrow()
    expect(() => imageDistanceToMm(calibration, Infinity)).toThrow()
  })
})
