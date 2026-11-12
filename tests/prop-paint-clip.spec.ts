import { expect, test } from '@playwright/test'
import type { Prop } from '../src/shared/model/scene.js'
import type { Projection } from '../src/shared/projection/types.js'

test('formal sprite clips preserve complete native pixels for transparent rotated images and directional shadows', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const rendererPath = '/src/platform/browser/render/canvas-renderer.ts'
    const { renderRasterProjection } = await import(rendererPath) as typeof import('../src/platform/browser/render/canvas-renderer.js')
    const source = document.createElement('canvas'); source.width = 73; source.height = 51
    const paint = source.getContext('2d', { colorSpace: 'srgb' })!
    paint.fillStyle = '#9e25db80'; paint.fillRect(0, 0, 73, 51)
    paint.fillStyle = '#28d6a6'; paint.beginPath(); paint.ellipse(34, 24, 32, 17, .37, 0, Math.PI * 2); paint.fill()
    paint.clearRect(7, 8, 13, 11)
    const blob = await new Promise<Blob>(resolve => source.toBlob(value => resolve(value!), 'image/png'))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const hash = async (value: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(v => v.toString(16).padStart(2, '0')).join('')
    const sha256 = await hash(bytes.buffer), origin = { kind: 'original' as const, attribution: 'test only', canEmbed: true }
    const sources = { assetRefs: { image: { id: 'image', sha256, mimeType: 'image/png' as const, pixelWidth: 73, pixelHeight: 51,
      logicalSizeMm: { width: 730, height: 510 }, licenseRef: 'test', origin } },
      assets: { [sha256]: { sha256, mimeType: 'image/png' as const, pixelWidth: 73, pixelHeight: 51, sizeBytes: bytes.length } },
      resources: { async read() { return bytes.slice() } } }
    const props: Prop[] = Array.from({ length: 12 }, (_, index) => ({ id: `prop-${index}`, floorId: 'floor', editLocked: false,
      definitionRef: null, appearance: { kind: 'image', assetId: 'image', tint: null, opacity: index % 2 ? .51 : 1 },
      visualBoundsMm: { x: -365, y: -255, width: 730, height: 510 }, positionMm: { x: -987 + index % 6 * 1701, y: -1703 + Math.floor(index / 6) * 2301 },
      rotationDeg: index * 31, footprintMm: { width: 180, height: 140 }, footprintOffsetMm: { x: 0, y: 0 },
      blocksMovement: false, blocksSight: false, visibility: 'public', supportRef: { kind: 'floor', id: 'floor' },
      renderLayer: 'object', renderOrder: index, shadowClass: 'furniture',
      shadowOverride: { directionDeg: index * 37, offsetMm: 137, blurMm: index % 3 ? 79 : 0, opacity: .71, color: '#36164f' } }))
    const rows = []
    for (const nearSide of [false, true]) for (const transparent of [false, true]) {
      const projection: Projection = { audience: 'gm', sourceRevision: 0, bounds: { x: -1000, y: -2000, width: 10000, height: 5000 },
        outputBackground: transparent ? { mode: 'transparent' } : { mode: 'solid', color: '#c7b9a2' }, gridSizeMm: null,
        rooms: [], terrain: [], walls: [], props, edges: [], paths: [], connections: [], notes: [], regions: [], masks: [],
        theme: null, materials: {}, assetIds: ['image'], limitations: [], diagnostics: [],
        ...(nearSide ? { propPresentations: Object.fromEntries(props.map(prop => [prop.id, { mode: 'nearSide' as const,
          rootAnchorMm: { x: 34, y: 71 }, groundShadowMm: [{ x: -80, y: -70 }, { x: 700, y: -90 }, { x: 820, y: 140 }, { x: -80, y: 70 }] }])) } : {}) }
      const results = []
      for (const clipped of [false, true]) {
        // This projection has no other clipping operations. Suppress only the
        // added per-sprite rectangles to obtain an independent native reference.
        const native = CanvasRenderingContext2D.prototype.clip
        let clipCalls = 0
        CanvasRenderingContext2D.prototype.clip = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof native>) { clipCalls++; if (clipped) native.apply(this, args) } as typeof native
        let output: HTMLCanvasElement
        try { output = await renderRasterProjection(sources, projection, { audience: 'gm', longEdgePx: 4096 }) }
        finally { CanvasRenderingContext2D.prototype.clip = native }
        try {
          const pixels = output.getContext('2d')!.getImageData(0, 0, output.width, output.height)
          results.push({ width: output.width, height: output.height, hash: await hash(pixels.data.buffer as ArrayBuffer), clipCalls })
        } finally { output.width = output.height = 0 }
      }
      rows.push({ nearSide, transparent, reference: results[0], actual: results[1] })
    }
    source.width = source.height = 0
    return rows
  })
  await info.attach('sprite-native-pixel-pairs.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  for (const row of report) {
    expect(row.actual).toEqual(row.reference)
    expect(row.actual.clipCalls).toBe(12)
    expect([row.actual.width, row.actual.height]).toEqual([4096, 2048])
  }
})
