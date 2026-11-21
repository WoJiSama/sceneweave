import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { decodeCanonicalPng } from '../project/png-rgba.js'
import { guidedImageSelection } from './guided-selection.js'

const sourceUrl = new URL('../../../public/assets/home-scenes/fantasy-stage1-4k.png', import.meta.url)
const stroke = ([x, y]: number[]) => ({ points: [{ x, y }], radiusPx: 2 })

// Both areas are under the 250,000-pixel limit but originally hit the work
// limit in algorithm 2. The native-size crops are from the shipped inn map.
describe('guided selection on reusable inn objects at source resolution', () => {
  let source: ReturnType<typeof decodeCanonicalPng>
  beforeAll(() => { source = decodeCanonicalPng(readFileSync(sourceUrl)) })

  it.each([
    { name: 'dining table', x: 768, y: 2423, width: 536, height: 240,
      foreground: [[71, 48], [19, 121], [169, 134]], background: [[3, 53], [511, 223], [236, 237]] },
    { name: 'copper basin', x: 1672, y: 2815, width: 248, height: 252,
      foreground: [[120, 122], [113, 41], [116, 35]], background: [[4, 120], [216, 214], [190, 16]] },
  ])('completes the existing bounded graph cut for $name', ({ x, y, width, height, foreground, background }) => {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let row = 0; row < height; row++) {
      const start = ((y + row) * source.width + x) * 4
      data.set(source.rgba.subarray(start, start + width * 4), row * width * 4)
    }
    const result = guidedImageSelection({ width, height, data }, {
      algorithmVersion: 2, edgeCoverage: 'boundary', bounds: { x: 0, y: 0, width, height },
      foreground: foreground.map(stroke), background: background.map(stroke),
    })
    expect(result.diagnostics.selectedPixels).toBeGreaterThan(width * height / 4)
    for (const [px, py] of foreground) expect(result.mask.data[py * width + px]).toBe(255)
    for (const [px, py] of background) expect(result.mask.data[py * width + px]).toBe(0)
  })
})
