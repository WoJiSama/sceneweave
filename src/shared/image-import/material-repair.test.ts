import { describe, expect, it } from 'vitest'
import { repairMaterialSurface } from './material-repair.js'
import type { ImagePixelMask, ImagePixels } from './pixels.js'

const box = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
const source = (): ImagePixels => {
  const data = new Uint8ClampedArray(96 * 80 * 4)
  for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) data.set([95 + x / 12 + y / 18, 123 + x / 12 + y / 18, 131 + x / 12 + y / 18, 255], (y * 96 + x) * 4)
  return { width: 96, height: 80, data }
}
const rgba = (image: ImagePixels, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
const mask = box(28, 23, 27, 34), donor = { x: 64, y: 5, width: 22, height: 60 }

describe('declared single material repair', () => {
  it('recovers low-frequency material without reading hidden or excluded colours and preserves every pixel outside write permission', () => {
    const a = source(), b = source(), truth = source(), excluded = box(14, 26, 10, 23), protectedMask = box(50, 23, 5, 34)
    for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) {
      if (x >= 28 && x < 55 && y >= 23 && y < 57 || x >= 14 && x < 24 && y >= 26 && y < 49) {
        a.data.set([255, 0, 255, 25], (y * 96 + x) * 4); b.data.set([0, 255, 0, 255], (y * 96 + x) * 4)
      }
    }
    const options = { kind: 'soft' as const, surfaceMask: box(5, 4, 84, 68), protectionMask: protectedMask, excludedEvidenceMask: excluded }
    const initial = a.data.slice(), left = repairMaterialSurface(a, mask, donor, options), right = repairMaterialSurface(b, mask, donor, options)
    let error = 0, count = 0
    for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) {
      if (x >= 28 && x < 50 && y >= 23 && y < 57) {
        expect(rgba(left, x, y)).toEqual(rgba(right, x, y))
        error += Math.abs(rgba(left, x, y)[0] - rgba(truth, x, y)[0]); count++
      } else expect(rgba(left, x, y)).toEqual(rgba(a, x, y))
    }
    expect(error / count).toBeLessThan(2)
    expect(a.data).toEqual(initial)
    expect(repairMaterialSurface(a, mask, donor, options)).toEqual(left)
  })
  it('restricts writes to the declared material and keeps protected/excluded evidence out of plank inference', () => {
    const a = source(), b = source(), surfaceMask = box(10, 10, 75, 60), excludedEvidenceMask = box(10, 20, 10, 40)
    for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) if (x < 10 || y < 10 || x >= 85 || y >= 70 || x >= 10 && x < 20 && y >= 20 && y < 60) {
      a.data.set([255, 0, 255, 255], (y * 96 + x) * 4); b.data.set([0, 255, 0, 255], (y * 96 + x) * 4)
    }
    const hole = box(4, 24, 35, 25), sample = { x: 62, y: 12, width: 18, height: 50 }
    const options = { kind: 'planks' as const, surfaceMask, excludedEvidenceMask }
    const left = repairMaterialSurface(a, hole, sample, options), right = repairMaterialSurface(b, hole, sample, options)
    for (let y = 24; y < 49; y++) for (let x = 4; x < 39; x++) {
      if (x >= 10) expect(rgba(left, x, y)).toEqual(rgba(right, x, y))
      else expect(rgba(left, x, y)).toEqual(rgba(a, x, y))
    }
  })
  it('rejects forbidden, translucent, unbounded and unsupported evidence before producing output', () => {
    const input = source(), initial = input.data.slice()
    expect(() => repairMaterialSurface(input, mask, { ...donor, x: 30 }, { kind: 'soft' })).toThrow('可信')
    expect(() => repairMaterialSurface(input, mask, donor, { kind: 'soft', excludedEvidenceMask: box(65, 6, 2, 2) })).toThrow('可信')
    input.data[(5 * 96 + 64) * 4 + 3] = 2
    expect(() => repairMaterialSurface(input, mask, donor, { kind: 'soft' })).toThrow('不透明')
    expect(() => repairMaterialSurface(source(), { ...mask, data: new Uint8Array(3) }, donor, { kind: 'soft' })).toThrow('二值')
    expect(() => repairMaterialSurface(source(), mask, donor, { kind: 'unsupported' as 'soft' })).toThrow('种类')
    expect(initial.length).toBe(input.data.length)
  })
})
