import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('shared inward feather is invariant between full and cropped terrain views', async ({ page }, info) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const modulePath = '/src/platform/browser/render/surface-mask.ts'
    const { drawSurfaceRuleMask } = await import(/* @vite-ignore */ modulePath)
    const regions = [{ outerMm: [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 700 }, { x: 100, y: 700 }], holesMm: [] }]
    const paint = (bounds: { x: number; y: number; width: number; height: number }) => {
      const canvas = document.createElement('canvas'); canvas.width = bounds.width; canvas.height = bounds.height
      drawSurfaceRuleMask(canvas.getContext('2d')!, bounds, canvas.width, canvas.height, regions, 40, true)
      return canvas
    }
    const full = paint({ x: 0, y: 0, width: 1000, height: 800 }), crop = paint({ x: 200, y: 200, width: 400, height: 300 })
    const a = full.getContext('2d')!.getImageData(200, 200, 400, 300).data, b = crop.getContext('2d')!.getImageData(0, 0, 400, 300).data
    let changed = 0, maxDelta = 0
    for (let i = 3; i < a.length; i += 4) { const delta = Math.abs(a[i] - b[i]); if (delta) changed++; maxDelta = Math.max(maxDelta, delta) }
    return { changed, maxDelta, cornerFull: a[3], cornerCrop: b[3] }
  })
  await writeFile(info.outputPath('mask-crop.json'), JSON.stringify(result, null, 2))
  expect(result.maxDelta).toBeLessThanOrEqual(1)
})
