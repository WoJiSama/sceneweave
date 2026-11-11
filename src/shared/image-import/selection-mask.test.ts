import { describe, expect, it } from 'vitest'
import { assertSelectionMaskBudget, decodeSelectionMask, encodeSelectionMask, IMAGE_SELECTION_LIMITS } from './selection-mask.js'
import { extractImageLayer, type ImagePixelMask } from './pixels.js'

const mask = (): ImagePixelMask => ({ width: 4, height: 3, boundsPx: { x: 2, y: 1, width: 4, height: 3 },
  data: new Uint8Array([255, 255, 0, 255, 255, 0, 0, 128, 255, 255, 0, 255]) })

describe('lossless source-grid selection mask', () => {
  it('round-trips holes, disconnected tips and partial alpha without sharing mutable buffers', () => {
    const original = mask(), encoded = encodeSelectionMask(original), decoded = decodeSelectionMask(encoded, { width: 10, height: 8 })
    expect(decoded).toEqual(original)
    decoded.data[0] = 0
    expect(original.data[0]).toBe(255)
    expect(decodeSelectionMask(encoded, { width: 10, height: 8 }).data[0]).toBe(255)
  })

  it('rejects invalid RLE, empty masks, out-of-image selections and per-mask or aggregate budget overflow', () => {
    const encoded = encodeSelectionMask(mask())
    for (const runs of [[12], [0, 255, 12, 255], [12, 256], [11, 255], [13, 255], [12, 0]]) {
      expect(() => decodeSelectionMask({ ...encoded, runs }, { width: 10, height: 8 })).toThrow()
    }
    expect(() => decodeSelectionMask(encoded, { width: 5, height: 8 })).toThrow('超出原图')
    expect(() => decodeSelectionMask({ ...encoded, width: 1001, height: 1000, runs: [1_000_000, 255, 1000, 255] }, { width: 8192, height: 8192 })).toThrow('100万')
    const million = { x: 0, y: 0, width: 1000, height: 1000, runs: [1_000_000, 255] }
    expect(() => assertSelectionMaskBudget(Array.from({ length: 9 }, () => million))).toThrow('累计')
    expect(() => assertSelectionMaskBudget(Array.from({ length: 5 }, () => ({ ...encoded, runs: Array(IMAGE_SELECTION_LIMITS.runEntries).fill(1) })))).toThrow('累计')
  })

  it('extracts the fine mask beyond the rough polygon and keeps hole pixels and every unselected original byte', () => {
    const image = { width: 10, height: 8, data: new Uint8ClampedArray(10 * 8 * 4) }
    for (let index = 0; index < image.data.length; index += 4) image.data.set([index % 251, 60, 120, 255], index)
    const before = image.data.slice(), selected = mask(), fine = encodeSelectionMask(selected)
    const result = extractImageLayer(image, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
      { x: 0, y: 6, width: 2, height: 2 }, { selectionMask: fine })
    expect(result.layer.boundsPx).toEqual(selected.boundsPx)
    expect(result.layer.data[(1 * 4 + 3) * 4 + 3]).toBe(128)
    expect(result.layer.data[(0 * 4 + 3) * 4 + 3]).toBe(255)
    expect(result.layer.data[(1 * 4 + 1) * 4 + 3]).toBe(0)
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const mx = x - selected.boundsPx.x, my = y - selected.boundsPx.y
      const coverage = mx < 0 || my < 0 || mx >= selected.width || my >= selected.height ? 0 : selected.data[my * selected.width + mx]
      const offset = (y * image.width + x) * 4
      if (!coverage) expect(result.remaining.data.slice(offset, offset + 4)).toEqual(before.slice(offset, offset + 4))
      else if (coverage === 255) expect(result.layer.data.slice((my * selected.width + mx) * 4, (my * selected.width + mx) * 4 + 3)).toEqual(before.slice(offset, offset + 3))
    }
    expect(image.data).toEqual(before)
  })
})
