import { test, expect } from '@playwright/test'
import type { Projection } from '../src/shared/projection/types.js'

test('regional grades feather inward at adjacent boundaries and retain identical world crop pixels', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/platform/browser/render/visual-renderer.ts', visualPath = '/src/shared/visual/types.ts'
    const { applyVisualFilters } = await import(rendererPath) as typeof import('../src/platform/browser/render/visual-renderer')
    const { emptyVisualSystem } = await import(visualPath) as typeof import('../src/shared/visual/types')
    const rectangle = (x: number, y: number, right: number, bottom: number) => [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
    const projection: Projection = { audience: 'player', sourceRevision: 0, bounds: { x: 0, y: 0, width: 4000, height: 3000 }, gridSizeMm: null, rooms: [], terrain: [], walls: [], props: [], edges: [], paths: [], connections: [], notes: [], regions: [], masks: [], theme: null, materials: {}, assetIds: [], limitations: [], diagnostics: [],
      visual: { environment: emptyVisualSystem().environment, boundsMm: { x: 0, y: 0, width: 4000, height: 3000 }, boundaries: [], edgeLooks: [], lights: [], fogs: [], filters: [], suppressedTerrainEdgeIds: [], occluderRings: [], contactRings: [] } }
    for (const [index, exposure] of [.5, 1.5].entries()) projection.visual!.filters.push({ id: `filter-${index}`, enabled: true, preset: 'neutral', exposure, saturation: .8, contrast: 1, vignette: .1, grain: .08, seed: `region-${index}`, targetRings: [rectangle(500 + index * 1500, 500, 2000 + index * 1500, 2500)], targetBoundsMm: { x: 500 + index * 1500, y: 500, width: 1500, height: 2000 }, regionFeatherMm: 240 })
    const make = (width: number, height: number) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.fillStyle = 'rgb(100,120,140)'; ctx.fillRect(0, 0, width, height); return { canvas, ctx } }
    const full = make(800, 600); applyVisualFilters(full.ctx, projection)
    const crop = make(440, 400), cropProjection = { ...projection, bounds: { x: 900, y: 500, width: 2200, height: 2000 } }
    applyVisualFilters(crop.ctx, cropProjection)
    const a = full.ctx.getImageData(0, 0, 800, 600).data, b = crop.ctx.getImageData(0, 0, 440, 400).data
    let exteriorChanges = 0, changed = 0, cropDifferences = 0
    for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) {
      const i = (y * 800 + x) * 4, outside = x < 100 || x >= 700 || y < 100 || y >= 500
      const different = a[i] !== 100 || a[i + 1] !== 120 || a[i + 2] !== 140 || a[i + 3] !== 255
      if (different) { changed++; if (outside) exteriorChanges++ }
    }
    for (let y = 0; y < 400; y++) for (let x = 0; x < 440; x++) for (let channel = 0; channel < 4; channel++) if (a[((y + 100) * 800 + x + 180) * 4 + channel] !== b[(y * 440 + x) * 4 + channel]) cropDifferences++
    const pixel = (x: number, y: number) => [...a.slice((y * 800 + x) * 4, (y * 800 + x) * 4 + 4)]
    return { exteriorChanges, changed, cropDifferences, left: pixel(250, 300), right: pixel(550, 300), seamLeft: pixel(399, 300), seamRight: pixel(400, 300) }
  })
  expect(result.exteriorChanges).toBe(0)
  expect(result.changed).toBeGreaterThan(10000)
  expect(result.cropDifferences).toBe(0)
  expect(result.left[0]).toBeLessThan(80)
  expect(result.right[0]).toBeGreaterThan(120)
  expect(result.seamLeft).toEqual([100, 120, 140, 255])
  expect(result.seamRight).toEqual([100, 120, 140, 255])
})

test('transparent visual source corners never cast rectangular contact shadows', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/platform/browser/render/visual-renderer.ts', visualPath = '/src/shared/visual/types.ts'
    const { drawVisualContacts } = await import(rendererPath) as typeof import('../src/platform/browser/render/visual-renderer')
    const { emptyVisualSystem } = await import(visualPath) as typeof import('../src/shared/visual/types')
    const visual = emptyVisualSystem(); visual.environment.contactShadowMm = 3; visual.environment.contactShadowOpacity = .5
    const projection: Projection = { audience: 'player', sourceRevision: 0, bounds: { x: 0, y: 0, width: 200, height: 200 }, gridSizeMm: null, rooms: [], terrain: [], walls: [], props: [], edges: [], paths: [], connections: [], notes: [], regions: [], masks: [], theme: null, materials: {}, assetIds: [], limitations: [], diagnostics: [],
      visual: { environment: visual.environment, boundsMm: { x: 0, y: 0, width: 200, height: 200 }, boundaries: [], edgeLooks: [], lights: [], fogs: [], filters: [], suppressedTerrainEdgeIds: [], occluderRings: [], contactRings: [[{ x: 40, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 160 }, { x: 40, y: 160 }]] } }
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 200; const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 200, 200)
    drawVisualContacts(ctx, projection, [], true, target => { target.fillStyle = '#75955F'; target.beginPath(); target.arc(100, 100, 38, 0, Math.PI * 2); target.fill() })
    return { corner: [...ctx.getImageData(45, 45, 1, 1).data], center: [...ctx.getImageData(100, 100, 1, 1).data] }
  })
  expect(result.corner).toEqual([255, 255, 255, 255])
  expect(result.center[0]).toBeLessThan(200)
  expect(result.center[3]).toBe(255)
})
