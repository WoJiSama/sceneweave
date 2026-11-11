import { test, expect } from '@playwright/test'
import type { Projection } from '../src/shared/projection/types.js'

test('identical adjoining room floors have the same pixels in either identity order', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/platform/browser/render/canvas-renderer.ts'
    const { renderRasterProjection } = await import(rendererPath) as typeof import('../src/platform/browser/render/canvas-renderer')
    const rectangle = (x: number, y: number, right: number, bottom: number) => [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
    const projection: Projection = { audience: 'player', sourceRevision: 0, bounds: { x: 0, y: 0, width: 40000, height: 32000 }, gridSizeMm: null,
      rooms: [
        { id: 'left', points: rectangle(24100, 5860, 29000, 13660), style: null, elevationMm: 0, priority: 0 },
        { id: 'right', points: rectangle(29000, 5860, 33900, 13660), style: null, elevationMm: 0, priority: 0 },
      ], terrain: [{ id: 'ground', points: rectangle(0, 0, 40000, 32000), style: null, elevationMm: 0, priority: 0 }],
      walls: [], props: [], edges: [], paths: [], connections: [], notes: [], regions: [], masks: [], theme: null, materials: {}, assetIds: [], limitations: [], diagnostics: [] }
    const sources = { assetRefs: {}, assets: {}, resources: { read: async () => { throw Error('No bitmap resources expected') } } }
    const render = async (source: Projection, longEdgePx: number) => {
      const canvas = await renderRasterProjection(sources, source, { audience: 'player', longEdgePx })
      try { return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data }
      finally { canvas.width = canvas.height = 0 }
    }
    const comparisons = []
    for (const size of [2048, 4096]) {
      const a = await render(projection, size), b = await render({ ...projection, rooms: [...projection.rooms].reverse() }, size)
      let differentChannels = 0
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differentChannels++
      comparisons.push({ size, differentChannels })
    }
    return comparisons
  })
  expect(result).toEqual([{ size: 2048, differentChannels: 0 }, { size: 4096, differentChannels: 0 }])
})

test('different floor paints and object filters retain their overlap order', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/platform/browser/render/canvas-renderer.ts', visualPath = '/src/shared/visual/types.ts'
    const { renderRasterProjection } = await import(rendererPath) as typeof import('../src/platform/browser/render/canvas-renderer')
    const { emptyVisualSystem } = await import(visualPath) as typeof import('../src/shared/visual/types')
    const texture = document.createElement('canvas'); texture.width = texture.height = 1
    const context = texture.getContext('2d')!; context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, 1, 1)
    const blob = await new Promise<Blob>(resolve => texture.toBlob(value => resolve(value!))), bytes = new Uint8Array(await blob.arrayBuffer())
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const ref = { id: 'white', sha256, mimeType: 'image/png' as const, pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 1, height: 1 }, licenseRef: 'test', origin: { kind: 'original' as const, attribution: 'Test generated pixel', canEmbed: true } }
    const sources = { assetRefs: { white: ref }, assets: { [sha256]: { sha256, mimeType: ref.mimeType, pixelWidth: 1, pixelHeight: 1, sizeBytes: bytes.length } }, resources: { read: async () => bytes } }
    const rectangle = (x: number, right: number) => [{ x, y: 100 }, { x: right, y: 100 }, { x: right, y: 900 }, { x, y: 900 }]
    const style = (tint: string) => ({ base: { materialRef: { id: 'paint', version: 1 }, tileSizeMm: { width: 100, height: 100 }, originMm: { x: 0, y: 0 }, rotationDeg: 0, alignment: 'world' as const, tint, opacity: 1 }, overlays: [] })
    const projection: Projection = { audience: 'player', sourceRevision: 0, bounds: { x: 0, y: 0, width: 1000, height: 1000 }, gridSizeMm: null,
      rooms: [{ id: 'left', points: rectangle(100, 700), style: style('#AA0000'), elevationMm: 0, priority: 0 }, { id: 'right', points: rectangle(300, 900), style: style('#0000AA'), elevationMm: 0, priority: 0 }],
      terrain: [], walls: [], props: [], edges: [], paths: [], connections: [], notes: [], regions: [], masks: [], theme: null,
      materials: { paint: { id: 'paint', version: 1, textureAssetId: 'white' } }, assetIds: ['white'], limitations: [], diagnostics: [] }
    const render = async (source: Projection) => {
      const canvas = await renderRasterProjection(sources, source, { audience: 'player', longEdgePx: 256 })
      try { return [...canvas.getContext('2d')!.getImageData(128, 128, 1, 1).data] }
      finally { canvas.width = canvas.height = 0 }
    }
    const painted = [await render(projection), await render({ ...projection, rooms: [...projection.rooms].reverse() })]
    const environment = { ...emptyVisualSystem().environment, ambientOpacity: 0, exposure: 1, contactShadowOpacity: 0 }
    projection.rooms.forEach(room => { room.style = null })
    projection.visual = { environment, boundsMm: projection.bounds, boundaries: [], edgeLooks: [], lights: [], fogs: [], suppressedTerrainEdgeIds: [], occluderRings: [], contactRings: [], filters: [
      { id: 'darken-left', enabled: true, preset: 'neutral', exposure: .5, saturation: 1, contrast: 1, vignette: 0, grain: 0, seed: 'fixed', sourceEntityIds: ['left'], targetRings: null, targetBoundsMm: projection.bounds },
    ] }
    const filtered = [await render(projection), await render({ ...projection, rooms: [...projection.rooms].reverse() })]
    return { painted, filtered }
  })
  expect(result.painted).toEqual([[0, 0, 170, 255], [170, 0, 0, 255]])
  expect(result.filtered[0]).toEqual([185, 170, 136, 255])
  expect(result.filtered[1]).toEqual([93, 85, 68, 255])
})
