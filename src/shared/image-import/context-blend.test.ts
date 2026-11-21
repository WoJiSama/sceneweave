import { describe, expect, it } from 'vitest'
import { repairContextBlend } from './context-blend.js'
import { repairContextPatch } from './context-patch.js'
import { extractImageLayer, type ImagePixelMask, type ImagePixels, type PixelBounds } from './pixels.js'
import { replayImageLayers, type ImageReplayLayer } from './layer-replay.js'
import { imageImportLayerSchema } from './recipe.js'
import { encodeSelectionMask } from './selection-mask.js'
import { maskCoverage } from './repair-scope.js'
import { sha256Bytes } from '../validation/hash.js'

const bounds = { x: 72, y: 36, width: 24, height: 24 }
// A single admissible integer translation, aligned with the independent fixture's texture period.
const donor = { x: 8, y: 4, width: 28, height: 28 }
const rectangle = (x: number, y: number, width: number, height: number): ImagePixelMask =>
  ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
const polygon = (b: PixelBounds) => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y },
  { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
const rgba = (image: ImagePixels, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
const copy = (image: ImagePixels): ImagePixels => ({ ...image, data: image.data.slice() })
function irregularMask(): ImagePixelMask {
  const data = new Uint8Array(bounds.width * bounds.height)
  for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) {
    // Concave shoulder plus a genuine non-writable hole, all inside a larger declared box.
    if (x >= 13 && y < 10 || x >= 8 && x <= 10 && y >= 13 && y <= 15) continue
    data[y * bounds.width + x] = 255
  }
  return { width: bounds.width, height: bounds.height, boundsPx: { ...bounds }, data }
}
function fixture(texture: 'flat' | 'checker' | 'wood' = 'wood', constantLighting = false): ImagePixels {
  const width = 128, height = 96, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grain = texture === 'flat' ? 0 : texture === 'checker' ? ((x + y) % 2) * 8
      : y % 6 === 0 ? -25 : (x % 2) * 4
    // The receiving surface's local illumination is harmonic; the donor has none.
    const light = x < 60 ? 0 : constantLighting ? 11 : 12 + x - bounds.x + y - bounds.y
    data.set([90 + grain + light, 80 + grain + light, 70 + grain + light, 255], (y * width + x) * 4)
  }
  return { width, height, data }
}
function recolour(image: ImagePixels, mask: ImagePixelMask, colour: readonly number[]): void {
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x]) {
    image.data.set(colour, ((y + mask.boundsPx.y) * image.width + x + mask.boundsPx.x) * 4)
  }
}
function compareWritten(a: ImagePixels, b: ImagePixels, mask: ImagePixelMask): void {
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x]) {
    expect(rgba(a, x + mask.boundsPx.x, y + mask.boundsPx.y)).toEqual(rgba(b, x + mask.boundsPx.x, y + mask.boundsPx.y))
  }
}
function compareOutside(output: ImagePixels, input: ImagePixels, mask: ImagePixelMask): void {
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    if (!maskCoverage(mask, x, y)) expect(rgba(output, x, y)).toEqual(rgba(input, x, y))
  }
}
function replayLayer(): ImageReplayLayer {
  return { id: 'current', polygon: polygon({ x: 75, y: 47, width: 4, height: 3 }), donor,
    repair: 'context-blend', removalMask: encodeSelectionMask(irregularMask()), renderLayer: 'object' }
}

describe('complete translated patch with actual-boundary colour correction', () => {
  it.each(['flat', 'checker', 'wood'] as const)('recovers withheld %s truth inside a concave mask with a hole, independently of hidden RGBA', texture => {
    const truth = fixture(texture), mask = irregularMask(), a = copy(truth), b = copy(truth)
    recolour(a, mask, [255, 0, 255, 17]); recolour(b, mask, [0, 255, 0, 255])
    const before = a.data.slice(), left = repairContextBlend(a, mask, donor), right = repairContextBlend(b, mask, donor)
    compareWritten(left, truth, mask); compareWritten(left, right, mask)
    compareOutside(left, a, mask); compareOutside(right, b, mask)
    expect(a.data).toEqual(before)
  })

  it('recovers a 545 × 255 plank patch where the original solver exhausts the budget', () => {
    const width = 1160, height = 288, data = new Uint8ClampedArray(width * height * 4)
    const mask = rectangle(600, 26, 545, 255), sample = { x: 4, y: 24, width: 549, height: 259 }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const grain = (y % 65 < 3 ? -38 : 0) + x % 3 * 2
      const light = x >= 576 ? 23 : 0
      data.set([149 + grain + light, 119 + grain + light, 83 + grain + light, 255], (y * width + x) * 4)
    }
    const truth = { width, height, data }, damaged = copy(truth)
    recolour(damaged, mask, [243, 0, 255, 255])
    expect(() => repairContextBlend(damaged, mask, sample)).toThrow(/未收敛/)
    const output = repairContextBlend(damaged, mask, sample, undefined, {}, 2)
    expect(sha256Bytes(new Uint8Array(output.data))).toBe(sha256Bytes(new Uint8Array(truth.data)))
  }, 10000)

  it.each([1, 2] as const)('excludes protected, prior-inference and future-object boundary colours in solver %s', version => {
    const mask = irregularMask(), a = fixture(), b = fixture()
    const protection = rectangle(73, 39, 1, 15), prior = rectangle(75, 37, 9, 1), future = rectangle(76, 58, 13, 1)
    const priorInference = new Uint8Array(a.width * a.height)
    for (let x = 75; x < 84; x++) priorInference[37 * a.width + x] = 2
    for (const excluded of [protection, prior, future, mask]) {
      recolour(a, excluded, [255, 0, 255, 17]); recolour(b, excluded, [0, 255, 0, 255])
    }
    const evidence = { priorInference, objectEvidence: [future] }
    const left = repairContextBlend(a, mask, donor, protection, evidence, version), right = repairContextBlend(b, mask, donor, protection, evidence, version)
    compareWritten(left, right, mask)
    compareOutside(left, a, mask); compareOutside(right, b, mask)
  })

  it.each(['protection', 'prior-inference', 'future-object', 'transparency'] as const)('rejects a complete donor containing %s evidence', kind => {
    const source = fixture(), mask = irregularMask(), forbidden = rectangle(10, 6, 1, 1)
    const priorInference = new Uint8Array(source.width * source.height)
    if (kind === 'prior-inference') priorInference[6 * source.width + 10] = 1
    if (kind === 'transparency') source.data[(6 * source.width + 10) * 4 + 3] = 254
    const before = source.data.slice()
    expect(() => repairContextBlend(source, mask, donor, kind === 'protection' ? forbidden : undefined,
      { priorInference, objectEvidence: kind === 'future-object' ? [forbidden] : [] })).toThrow(/可信不透明原图/)
    expect(source.data).toEqual(before)
  })

  it('rejects a disconnected writable island surrounded entirely by protected pixels', () => {
    const source = fixture(), data = new Uint8Array(bounds.width * bounds.height)
    for (let y = 2; y < 9; y++) for (let x = 2; x < 9; x++) data[y * bounds.width + x] = 255
    for (let y = 17; y < 20; y++) for (let x = 17; x < 20; x++) data[y * bounds.width + x] = 255
    const mask = { width: bounds.width, height: bounds.height, boundsPx: bounds, data }
    const ring = rectangle(bounds.x + 16, bounds.y + 16, 5, 5)
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) ring.data[y * ring.width + x] = 0
    const before = source.data.slice()
    expect(() => repairContextBlend(source, mask, donor, ring)).toThrow(/独立部分/)
    expect(source.data).toEqual(before)
  })

  it('rejects oversized, nonbinary and insufficient-context requests without modifying input', () => {
    const source = fixture(), mask = irregularMask(), before = source.data.slice()
    const nonbinary = { ...mask, data: mask.data.slice() }; nonbinary.data[2 * bounds.width + 2] = 128
    expect(() => repairContextBlend(source, nonbinary, donor)).toThrow(/二值/)
    expect(() => repairContextBlend(source, { width: 501, height: 500, boundsPx: { x: 0, y: 0, width: 501, height: 500 }, data: new Uint8Array(250_500) }, donor)).toThrow(/25万/)
    expect(() => repairContextBlend(source, mask, { ...donor, width: 27 })).toThrow(/各多4像素/)
    expect(() => repairContextBlend(source, mask, donor, rectangle(70, 34, 28, 28))).toThrow(/可信边界/)
    expect(source.data).toEqual(before)
  })

  it('propagates cancellation before returning any usable image', () => {
    const source = fixture(), before = source.data.slice(), cancellation = new Error('cancelled-context-blend')
    const signal = { aborted: true, throwIfAborted() { throw cancellation } }
    expect(() => repairContextBlend(source, irregularMask(), donor, undefined, { signal })).toThrow(cancellation)
    expect(source.data).toEqual(before)
  })

  it('preserves the legacy context patch phase and constant-lighting result', () => {
    const truth = fixture('wood', true), mask = irregularMask(), damaged = copy(truth)
    recolour(damaged, mask, [255, 0, 255, 255])
    const legacy = repairContextPatch(damaged, mask, donor)
    compareWritten(legacy, truth, mask); compareOutside(legacy, damaged, mask)
    const layer = replayLayer()
    const extracted = extractImageLayer(damaged, layer.polygon, donor, { repair: 'context', removalMask: layer.removalMask })
    expect(extracted.remaining).toEqual(legacy)
  })

  it('exposes the mode through strict schema and extraction while preserving selection and appearance', () => {
    const source = fixture(), layer = replayLayer()
    const parsed = imageImportLayerSchema.parse({ ...layer, name: '可独立移动方凳', blocksMovement: false,
      footprintPx: { x: 75, y: 47, width: 4, height: 3 } })
    expect(parsed.repair).toBe('context-blend')
    expect(parsed.footprintPx).toEqual({ x: 75, y: 47, width: 4, height: 3 })
    const blend = extractImageLayer(source, layer.polygon, donor, { repair: 'context-blend', removalMask: layer.removalMask })
    const old = extractImageLayer(source, layer.polygon, donor, { repair: 'context', removalMask: layer.removalMask })
    expect(blend.layer).toEqual(old.layer); expect(blend.mask).toEqual(old.mask); expect(blend.repairMask).toEqual(old.repairMask)
    compareWritten(blend.remaining, source, irregularMask())
  })

  it.each(['context-blend', 'context-blend-v2'] as const)('passes repair evidence exclusions through shared replay for %s', repair => {
    const source = fixture(), current = { ...replayLayer(), repair }, future: ImageReplayLayer = {
      id: 'future', polygon: polygon({ x: 10, y: 6, width: 2, height: 2 }), donor: { x: 42, y: 6, width: 2, height: 2 }, renderLayer: 'object',
    }
    const before = source.data.slice()
    expect(() => replayImageLayers(source, [current], [], { evidenceLayers: [current, future] })).toThrow(/未移走的物件/)
    expect(() => replayImageLayers(source, [{ ...future, id: 'previous' }, current])).toThrow(/前序推断/)
    expect(source.data).toEqual(before)
  })
})
