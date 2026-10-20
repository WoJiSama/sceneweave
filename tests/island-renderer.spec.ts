import { expect, test } from '@playwright/test'

test('B3 actual 4K renderer: island surfaces, private alpha objects and private plateau pairs', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/#assets')
  const result = await page.evaluate(async () => {
    const samplePath = '/src/editor/v2/island-sample.ts', renderPath = '/src/render/v2/renderer.ts', projectionPath = '/src/render/v2/projection.ts'
    const { createIslandProject, ISLAND_IDS } = await import(samplePath), { exportPngV2 } = await import(renderPath), { projectSceneV2 } = await import(projectionPath)
    const project = await createIslandProject(), metrics: { name: string; audience: string; bytes: number; ms: number }[] = [], images: Record<string, string> = {}
    const encode = async (blob: Blob) => { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary) }
    const digest = async (blob: Blob) => { const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close(); const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(n => n.toString(16).padStart(2, '0')).join(''); canvas.width = canvas.height = 0; return hash }
    const render = async (document: typeof project.document, name: string, audience: 'gm' | 'player', attach = false) => {
      const start = performance.now(), blob = await exportPngV2({ ...project, document }, { audience, longEdgePx: 4096 }); metrics.push({ name, audience, bytes: blob.size, ms: performance.now() - start }); if (attach) images[`${name}-${audience}`] = await encode(blob); return blob
    }
    const gm = await render(project.document, 'baseline', 'gm', true), player = await render(project.document, 'baseline', 'player', true), bitmap = await createImageBitmap(gm)
    const size = { width: bitmap.width, height: bitmap.height }, chunks: string[] = [], pngBytes = new Uint8Array(await player.arrayBuffer()); let offset = 8
    while (offset < pngBytes.length) { const length = new DataView(pngBytes.buffer, offset, 4).getUint32(0); chunks.push(new TextDecoder().decode(pngBytes.subarray(offset + 4, offset + 8))); offset += length + 12 }
    const firstTree = Object.values(project.document.props).find((p: any) => p.renderLayer === 'canopy') as any
    const nearViews = [
      { name: 'west-coast', x: 2000, y: 12000 }, { name: 'stairs', x: 12000, y: 9000 },
      { name: 'canopy', x: Math.round(firstTree.positionMm.x - 2000), y: Math.round(firstTree.positionMm.y - 1500) },
    ]
    for (const view of nearViews) { const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 768; canvas.getContext('2d')!.drawImage(bitmap, view.x / 30000 * bitmap.width, view.y / 27000 * bitmap.height, 4000 / 30000 * bitmap.width, 3000 / 27000 * bitmap.height, 0, 0, 1024, 768); const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png')); images[`near-${view.name}-256px-per-m`] = await encode(blob); canvas.width = canvas.height = 0 }
    bitmap.close()
    const mask = [{ x: 19000, y: 7000 }, { x: 24500, y: 7000 }, { x: 24500, y: 12000 }, { x: 19000, y: 12000 }]
    const masked = () => { const scene = structuredClone(project.document); scene.regions['island-private-mask'] = { id: 'island-private-mask', floorId: ISLAND_IDS.floor, editLocked: false, boundaryMm: mask, kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }; return scene }
    const secretCanvas = document.createElement('canvas'); secretCanvas.width = secretCanvas.height = 64; const secretCtx = secretCanvas.getContext('2d')!; secretCtx.fillStyle = '#AD714E'; secretCtx.fillRect(8, 12, 40, 24); secretCtx.fillStyle = '#344A3C'; secretCtx.fillRect(15, 24, 24, 27)
    const secretBlob = await new Promise<Blob>(resolve => secretCanvas.toBlob(value => resolve(value!), 'image/png')); secretCanvas.width = secretCanvas.height = 0
    const secretHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await secretBlob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('')
    project.assets[secretHash] = { sha256: secretHash, blob: secretBlob, mimeType: 'image/png', sizeBytes: secretBlob.size, pixelWidth: 64, pixelHeight: 64 }
    const alphaPair = (variant: 'a' | 'b') => {
      const scene = masked(); scene.assets['private-image'] = { ...(Object.values(scene.assets)[0] as object), id: 'private-image', sha256: secretHash, pixelWidth: 64, pixelHeight: 64, logicalSizeMm: { width: 1200, height: 900 } }
      scene.propDefinitions['private-definition'] = { ...(Object.values(scene.propDefinitions)[0] as object), id: 'private-definition', catalogId: 'test.private-definition', version: 1, defaultAppearance: { kind: 'image', assetId: 'private-image', tint: null, opacity: 1 } }
      scene.props['private-object'] = { id: 'private-object', floorId: ISLAND_IDS.floor, editLocked: false, definitionRef: { id: 'private-definition', version: 1 }, appearance: { kind: 'image', assetId: 'private-image', tint: null, opacity: 1 }, visualBoundsMm: { x: -600, y: -450, width: 1200, height: 900 }, footprintMm: { width: 600, height: 400 }, footprintOffsetMm: { x: 0, y: 0 }, positionMm: variant === 'a' ? { x: 21200, y: 9400 } : { x: 22000, y: 9900 }, rotationDeg: variant === 'a' ? 0 : 145, blocksMovement: false, blocksSight: false, visibility: 'gm', supportRef: { kind: 'terrainArea', id: ISLAND_IDS.high }, renderLayer: 'object', renderOrder: 0, shadowClass: 'furniture', shadowOverride: { directionDeg: 45, offsetMm: variant === 'a' ? 120 : 240, blurMm: 80, opacity: .3, color: '#24313A' } }
      scene.notes['private-note'] = { id: 'private-note', floorId: ISLAND_IDS.floor, editLocked: false, anchor: { type: 'point', positionMm: { x: 21400, y: 8500 } }, kind: 'clue', title: variant === 'a' ? '秘密营地' : '遗失的文书', text: '不进入玩家 PNG 的私密线索', visibility: 'gm' }
      return scene
    }
    const plateauPair = (variant: 'a' | 'b') => {
      const scene = masked(); scene.props = {}; scene.scatterGroups = {} // isolate terrain coverage from independent prop-support editing
      const points = variant === 'a' ? [{ x: 20500, y: 8500 }, { x: 22000, y: 8500 }, { x: 22000, y: 10500 }, { x: 20500, y: 10500 }] : [{ x: 20700, y: 8700 }, { x: 22400, y: 8600 }, { x: 22300, y: 10700 }, { x: 20500, y: 10400 }]
      scene.terrainAreas['private-plateau'] = { ...structuredClone(scene.terrainAreas[ISLAND_IDS.high]), id: 'private-plateau', surfaceStyle: { base: structuredClone(scene.terrainAreas[ISLAND_IDS.high].surfaceStyle.base), overlays: [] }, visibility: 'gm', groundElevationMm: variant === 'a' ? 3500 : 4300, coveragePriority: 20, boundaryMm: points.map((positionMm, i) => ({ id: `private-v${i}`, segmentId: `private-s${i}`, positionMm })) }
      return scene
    }
    const pairs: Record<string, { player: string[]; gm: string[] }> = {}
    for (const [name, factory] of [['VIS-02-S01-alpha-note-shadow', alphaPair], ['VIS-02-S02-private-plateau', plateauPair]] as const) {
      pairs[name] = { player: [], gm: [] }
      for (const variant of ['a', 'b'] as const) for (const audience of ['player', 'gm'] as const) pairs[name][audience].push(await digest(await render(factory(variant), `${name}-${variant}`, audience, variant === 'a')))
    }
    const privateMissing = { ...project, document: alphaPair('a'), assets: { ...project.assets } }; delete privateMissing.assets[secretHash]
    const skipped = await exportPngV2(privateMissing, { audience: 'player', longEdgePx: 512 }); let privateRequiredError = ''
    try { await exportPngV2(privateMissing, { audience: 'gm', longEdgePx: 512 }) } catch (error) { privateRequiredError = String(error) }
    const projection = projectSceneV2(project.document, 'player')
    return { size, chunks, pairs, privateRequiredError, privateBytesSkipped: skipped.size, metrics, nearViews: { worldWidthMm: 4000, worldHeightMm: 3000, widthPx: 1024, heightPx: 768, method: 'resampled fixed world crop from 4096x3686 full PNG', views: nearViews }, projection: { terrain: projection.terrain.length, edges: projection.edges.length, connections: projection.connections.length, props: projection.props.length, assets: projection.assetIds.length, limitations: projection.limitations }, images }
  })
  expect(result.size).toEqual({ width: 4096, height: 3686 }); expect(result.projection.limitations).toEqual([]); expect(result.projection.edges).toBe(12); expect(result.projection.connections).toBe(1)
  expect(result.chunks.filter(c => ['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(c))).toEqual([])
  for (const pair of Object.values(result.pairs)) { expect(pair.player[0]).toBe(pair.player[1]); expect(pair.gm[0]).not.toBe(pair.gm[1]) }
  expect(result.privateBytesSkipped).toBeGreaterThan(10000); expect(result.privateRequiredError).toContain('缺失')
  for (const [name, base64] of Object.entries(result.images)) await testInfo.attach(`b3-${name}${name.startsWith('near-') ? '' : '-4096'}.png`, { body: Buffer.from(base64, 'base64'), contentType: 'image/png' })
  const { images: _images, ...metrics } = result
  await testInfo.attach('b3-real-render-privacy.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' })
})

test('B3 coast and overlay edits preserve world texture phase, update extents and undo actual pixels', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('/#assets')
  const result = await page.evaluate(async () => {
    const samplePath = '/src/editor/v2/island-sample.ts', renderPath = '/src/render/v2/renderer.ts', commandsPath = '/src/core/v2/commands.ts'
    const { createIslandProject, ISLAND_IDS, islandShallowWaterBoundaryMm } = await import(samplePath), { renderProjectV2 } = await import(renderPath), { applyCommandsV2 } = await import(commandsPath)
    const project = await createIslandProject()
    const pixels = async (document: typeof project.document, patch?: { x: number; y: number; width: number; height: number }) => { const canvas = await renderProjectV2({ ...project, document }, { audience: 'gm', longEdgePx: 1500 }), bytes = patch ? canvas.getContext('2d')!.getImageData(patch.x, patch.y, patch.width, patch.height).data : canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); canvas.width = canvas.height = 0; return hash }
    const baseline = await pixels(project.document), patch = { x: 470, y: 450, width: 80, height: 70 }, baselinePatch = await pixels(project.document, patch)
    const vertex = project.document.terrainAreas[ISLAND_IDS.low].boundaryMm[9], preview = structuredClone(project.document); preview.terrainAreas[ISLAND_IDS.low].boundaryMm[9].positionMm.x -= 350
    const moved = applyCommandsV2(project.document, [{ type: 'moveTerrainPoint', areaId: ISLAND_IDS.low, pointId: vertex.id, positionMm: preview.terrainAreas[ISLAND_IDS.low].boundaryMm[9].positionMm }, { type: 'setOverlayBoundary', kind: 'terrainArea', id: ISLAND_IDS.water, overlayId: ISLAND_IDS.waterOverlay, boundaryMm: islandShallowWaterBoundaryMm(preview) }])
    const movedPatch = await pixels(moved, patch), movedAll = await pixels(moved)
    const overlay = structuredClone(moved.terrainAreas[ISLAND_IDS.high].surfaceStyle.overlays.find((o: any) => o.id === ISLAND_IDS.highOverlay).boundaryMm); overlay[6].x -= 400
    const overlayEdit = applyCommandsV2(moved, [{ type: 'setOverlayBoundary', kind: 'terrainArea', id: ISLAND_IDS.high, overlayId: ISLAND_IDS.highOverlay, boundaryMm: overlay }]), overlayAll = await pixels(overlayEdit)
    const higher = applyCommandsV2(project.document, [{ type: 'setTerrainElevation', id: ISLAND_IDS.high, groundElevationMm: 4000 }]), higherAll = await pixels(higher)
    const materialEdit = applyCommandsV2(project.document, [{ type: 'setSurfaceMaterial', kind: 'terrainArea', id: ISLAND_IDS.low, materialRef: { id: ISLAND_IDS.materials.sand, version: 1 } }]), materialAll = await pixels(materialEdit)
    return { baseline, baselinePatch, movedPatch, movedAll, overlayAll, higherAll, materialAll, restored: await pixels(project.document), boundary: moved.terrainAreas[ISLAND_IDS.water].surfaceStyle.overlays[0].boundaryMm }
  })
  expect(result.movedPatch).toBe(result.baselinePatch); expect(result.movedAll).not.toBe(result.baseline); expect(result.overlayAll).not.toBe(result.movedAll); expect(result.higherAll).not.toBe(result.baseline); expect(result.materialAll).not.toBe(result.baseline); expect(result.restored).toBe(result.baseline)
  await testInfo.attach('b3-world-phase-edit-restore.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})

test('B3 required outdoor image failure and cancellation close actual decoded bitmaps', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/#assets')
  const result = await page.evaluate(async () => {
    const samplePath = '/src/editor/v2/island-sample.ts', renderPath = '/src/render/v2/renderer.ts'
    const { createIslandProject, ISLAND_IDS } = await import(samplePath), { renderProjectV2 } = await import(renderPath), project = await createIslandProject()
    const broken = { ...project, assets: { ...project.assets } }, hash = project.document.assets[project.document.materials[ISLAND_IDS.materials.cliffRock].textureAssetId].sha256; delete broken.assets[hash]
    let requiredError = '', cancelName = '', decoded = 0, closed = 0
    try { await renderProjectV2(broken, { audience: 'gm', longEdgePx: 512 }) } catch (error) { requiredError = String(error) }
    const original = window.createImageBitmap.bind(window), controller = new AbortController()
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => { const bitmap = await original(source, options); decoded++; const close = bitmap.close.bind(bitmap); bitmap.close = () => { closed++; close() }; controller.abort(); return bitmap }) as typeof createImageBitmap
    try { await renderProjectV2(project, { audience: 'gm', longEdgePx: 512, signal: controller.signal }) } catch (error) { cancelName = error instanceof DOMException ? error.name : String(error) }
    finally { window.createImageBitmap = original }
    return { requiredError, cancelName, decoded, closed }
  })
  expect(result.requiredError).toContain('缺失'); expect(result.cancelName).toBe('AbortError'); expect(result.decoded).toBe(1); expect(result.closed).toBe(1)
  await testInfo.attach('b3-real-image-failure-cleanup.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})
