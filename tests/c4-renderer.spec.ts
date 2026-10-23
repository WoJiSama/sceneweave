import { expect, test } from '@playwright/test'

test('C4 real 4K road material and overlay outputs preserve public reference pixels across private path variants', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c4-render-fixtures.ts', rendererPath = '/src/render/v3/renderer.ts', projectionPath = '/src/render/v3/projection.ts'
    const { createC4RenderProject, c4Hash, c4Pixels, c4PngPixels, c4PngMetadata, c4DataUrl } = await import(fixturePath) as typeof import('./c4-render-fixtures')
    const { renderProjectV3, exportPngV3 } = await import(rendererPath) as typeof import('../src/render/v3/renderer')
    const { projectSceneV3 } = await import(projectionPath) as typeof import('../src/render/v3/projection')
    const source = await createC4RenderProject(), reference = await createC4RenderProject({ includePrivate: false }), variant = structuredClone(source)
    variant.document.paths['c4-private-road'].centerlineMm = [{ x: 3500, y: 3700 }, { x: 5400, y: 3700 }, { x: 5400, y: 4300 }]
    variant.document.paths['c4-private-road'].widthMm = 600
    variant.document.paths['c4-private-road'].surfaceStyle!.base.rotationDeg = 87
    variant.document.notes['c4-private-label'].text = 'C4_PRIVATE_OTHER_ROUTE'
    variant.document.notes['c4-private-nested'].text = 'C4_PRIVATE_OTHER_NESTED'
    const observations = []
    for (const [name, project, audience] of [['gm', source, 'gm'], ['player', source, 'player'], ['variantGm', variant, 'gm'],
      ['variantPlayer', variant, 'player'], ['referencePlayer', reference, 'player']] as const) {
      const before = JSON.stringify(project.document), native = window.createImageBitmap.bind(window), actualDecodeHashes: string[] = []
      let closed = 0, output: HTMLCanvasElement
      window.createImageBitmap = (async (input: ImageBitmapSource, options?: ImageBitmapOptions) => {
        if (!(input instanceof Blob)) throw new Error('C4 renderer must decode bundled Blob bytes')
        actualDecodeHashes.push(await c4Hash(await input.arrayBuffer()))
        const bitmap = await native(input, options), close = bitmap.close.bind(bitmap)
        bitmap.close = () => { closed++; close() }; return bitmap
      }) as typeof createImageBitmap
      try { output = await renderProjectV3(project, { audience, longEdgePx: 4096 }) }
      finally { window.createImageBitmap = native }
      const projection = projectSceneV3(project.document, audience)
      observations.push({ name, audience, ...await c4Pixels(output), actualDecodeHashes: actualDecodeHashes.sort(), closed,
        expectedDecodeHashes: [...new Set(projection.assetIds.map(id => project.document.assets[id].sha256))].sort(),
        pathIds: projection.paths.map(path => path.id), noteIds: projection.notes.map(note => note.id), assetIds: projection.assetIds,
        limitations: projection.limitations, sourceUnchanged: before === JSON.stringify(project.document) })
    }
    const playerBlob = await exportPngV3(source, { audience: 'player', longEdgePx: 4096 }), gmBlob = await exportPngV3(source, { audience: 'gm', longEdgePx: 4096 })
    const png = { player: await c4PngPixels(playerBlob), gm: await c4PngPixels(gmBlob), playerMetadata: await c4PngMetadata(playerBlob), gmMetadata: await c4PngMetadata(gmBlob) }
    const noOverlay = structuredClone(reference), shifted = structuredClone(reference), flat = structuredClone(reference)
    noOverlay.document.paths['c4-road'].surfaceStyle!.overlays = []
    shifted.document.paths['c4-road'].surfaceStyle!.base.originMm = { x: 117, y: 274 }
    flat.document.paths['c4-road'].surfaceStyle = null
    const materialVariants: Record<string, { hash: string; width: number; height: number; basePixel: number[]; overlayPixel: number[] }> = {}
    for (const [name, project] of [['textured', reference], ['noOverlay', noOverlay], ['shifted', shifted], ['flat', flat]] as const) {
      const output = await renderProjectV3(project, { audience: 'gm', longEdgePx: 1000 }), ctx = output.getContext('2d')!
      const basePixel = [...ctx.getImageData(250, 200, 1, 1).data], overlayPixel = [...ctx.getImageData(350, 200, 1, 1).data]
      materialVariants[name] = { ...await c4Pixels(output), basePixel, overlayPixel }
    }
    return { observations, png, materialVariants, playerPng: await c4DataUrl(playerBlob), gmPng: await c4DataUrl(gmBlob) }
  })
  const observation = (name: string) => report.observations.find(item => item.name === name)!
  expect(observation('player').hash).toBe(observation('referencePlayer').hash)
  expect(observation('player').hash).toBe(observation('variantPlayer').hash)
  expect(observation('gm').hash).not.toBe(observation('variantGm').hash)
  expect(observation('gm').hash).not.toBe(observation('player').hash)
  for (const output of report.observations) {
    expect([output.width, output.height]).toEqual([4096, 3277]); expect(output.sourceUnchanged).toBe(true)
    expect(output.actualDecodeHashes).toEqual(output.expectedDecodeHashes); expect(output.closed).toBe(output.actualDecodeHashes.length)
    expect(output.limitations).toEqual([])
    if (output.audience === 'player') {
      expect(output.pathIds).toEqual(['c4-road']); expect(output.noteIds).toEqual(['c4-road-label'])
      expect(output.assetIds).toEqual(['c4-base-texture', 'c4-overlay-texture'])
    }
  }
  expect(observation('gm').actualDecodeHashes).toHaveLength(3); expect(observation('player').actualDecodeHashes).toHaveLength(2)
  for (const audience of ['gm', 'player'] as const) expect(report.png[audience]).toEqual({ width: 4096, height: 3277, hash: observation(audience).hash })
  for (const metadata of [report.png.playerMetadata, report.png.gmMetadata]) {
    expect(metadata.privateMarkers).toEqual([])
    expect(metadata.chunks.some(chunk => ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(chunk))).toBe(false)
  }
  expect(new Set(Object.values(report.materialVariants).map(item => item.hash)).size).toBe(4)
  expect(report.materialVariants.textured.overlayPixel).not.toEqual(report.materialVariants.noOverlay.overlayPixel)
  expect(report.materialVariants.textured.basePixel).not.toEqual(report.materialVariants.flat.basePixel)
  await info.attach('c4-road-player-4k.png', { body: Buffer.from(report.playerPng.split(',')[1], 'base64'), contentType: 'image/png' })
  await info.attach('c4-road-gm-4k.png', { body: Buffer.from(report.gmPng.split(',')[1], 'base64'), contentType: 'image/png' })
  const { playerPng: _player, gmPng: _gm, ...summary } = report
  await info.attach('c4-road-material-4k-privacy.json', { body: JSON.stringify({ method: 'Real Chromium sRGB Canvas2D; browser-encoded original opaque texture bytes. Five sequential 4K renders, independent public reference, native image decoding and closure, decoded PNG RGBA hashes, fixed export bounds and masks. Four additional native material/phase variants; no complete outdoor scene, pathfinding or interaction-performance claim.', ...summary }, null, 2), contentType: 'application/json' })
})

test('C4 exact road caps and miters are selectable and concave path labels and hiding follow native drawing dependencies', async ({ page }, info) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c4-render-fixtures.ts', rendererPath = '/src/render/v3/renderer.ts', projectionPath = '/src/render/v3/projection.ts'
    const selectionPath = '/src/editor/v3/selection.ts', geometryPath = '/src/core/v3/geometry-view.ts'
    const { createC4RenderProject, C4_ROAD_LAYER, c4Pixels, c4Hash, c4Rect } = await import(fixturePath) as typeof import('./c4-render-fixtures')
    const { renderProjectV3, renderEditorProjectV3 } = await import(rendererPath) as typeof import('../src/render/v3/renderer')
    const { projectSceneV3, projectEditorSceneV3 } = await import(projectionPath) as typeof import('../src/render/v3/projection')
    const { hitTestLayersV3, selectInBoundsLayersV3, selectionGeometryLayersV3 } = await import(selectionPath) as typeof import('../src/editor/v3/selection')
    const { toGeometryDocumentV2 } = await import(geometryPath) as typeof import('../src/core/v3/geometry-view')
    const project = await createC4RenderProject({ includePrivate: false }), scene = project.document, before = JSON.stringify(scene), domain = toGeometryDocumentV2(scene)
    const hit = hitTestLayersV3(scene), marquee = selectInBoundsLayersV3(scene), projected = projectSceneV3(scene, 'gm')
    const selection = {
      capInside: hit(domain, { x: 1510, y: 1800 }, 0), capOutside: hit(domain, { x: 1490, y: 1800 }, 0),
      miterInside: hit(domain, { x: 7900, y: 1600 }, 0), miterOutside: hit(domain, { x: 8010, y: 1490 }, 0),
      concaveHole: hit(domain, { x: 4500, y: 4000 }, 0),
      capMarquee: marquee(domain, { x: 1500, y: 1500, width: 40, height: 500 }, 'intersect').ids,
      partialContain: marquee(domain, { x: 1500, y: 1500, width: 40, height: 500 }, 'contain').ids,
      wholeContain: marquee(domain, { x: 1500, y: 1500, width: 6500, height: 5000 }, 'contain').ids,
      shapes: selectionGeometryLayersV3(scene)(domain, 'c4-road'), drawingShapes: projected.paths.map(path => path.points),
    }
    const noLabel = structuredClone(project); noLabel.document.notes = {}; delete noLabel.document.entityLayers['c4-road-label']
    const baseline = await renderProjectV3(project, { audience: 'gm', longEdgePx: 1000 }), bareLabel = await renderProjectV3(noLabel, { audience: 'gm', longEdgePx: 1000 })
    const regionHash = async (canvas: HTMLCanvasElement) => c4Hash(canvas.getContext('2d')!.getImageData(700, 380, 100, 40).data.buffer)
    const labelRegion = { withLabel: await regionHash(baseline), withoutLabel: await regionHash(bareLabel) }
    const ctx = baseline.getContext('2d')!, capPixel = [...ctx.getImageData(180, 200, 1, 1).data], outsidePixel = [...ctx.getImageData(100, 200, 1, 1).data]
    bareLabel.width = bareLabel.height = 0
    const baselinePixels = await c4Pixels(baseline)
    const hiddenOptions = { audience: 'gm' as const, longEdgePx: 1000, hiddenLayerIds: new Set([C4_ROAD_LAYER]) }
    const formalIgnoringHidden = await c4Pixels(await renderProjectV3(project, hiddenOptions))
    const hidden = await c4Pixels(await renderEditorProjectV3(project, hiddenOptions)), hiddenProjection = projectEditorSceneV3(scene, hiddenOptions)
    const bare = structuredClone(project); bare.document.paths = {}; bare.document.notes = {}
    delete bare.document.entityLayers['c4-road']; delete bare.document.entityLayers['c4-road-label']
    const barePixels = await c4Pixels(await renderEditorProjectV3(bare, { audience: 'gm', longEdgePx: 1000 }))
    const support = structuredClone(project), supportScene = support.document
    supportScene.userLayers['c4-support-layer'] = { id: 'c4-support-layer', floorId: 'f-a1', name: 'C4 support', order: 2, editLocked: false }
    supportScene.terrainAreas['c4-support'] = { id: 'c4-support', floorId: 'f-a1', editLocked: false, visibility: 'public', groundElevationMm: 0, coveragePriority: 1,
      boundaryMm: c4Rect(1000, 1000, 8000, 6000).map((positionMm, i) => ({ id: `c4-support-v${i}`, segmentId: `c4-support-s${i}`, positionMm })),
      surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    supportScene.entityLayers['c4-support'] = 'c4-support-layer'; supportScene.paths['c4-road'].supportRefs = [{ kind: 'terrainArea', id: 'c4-support' }]
    const supportHidden = await c4Pixels(await renderEditorProjectV3(support, { audience: 'gm', longEdgePx: 1000, hiddenLayerIds: new Set(['c4-support-layer']) }))
    return { selection, labelPosition: projected.notes[0].positionMm, labelRegion, capPixel, outsidePixel,
      baselinePixels, formalIgnoringHidden, hidden, barePixels, supportHidden,
      hiddenPaths: hiddenProjection.paths.map(path => path.id), hiddenNotes: hiddenProjection.notes.map(note => note.id), sourceUnchanged: before === JSON.stringify(scene) }
  })
  for (const ids of [report.selection.capInside, report.selection.miterInside, report.selection.capMarquee, report.selection.wholeContain]) expect(ids).toContain('c4-road')
  for (const ids of [report.selection.capOutside, report.selection.miterOutside, report.selection.concaveHole, report.selection.partialContain]) expect(ids).not.toContain('c4-road')
  expect(report.selection.shapes).toEqual(report.selection.drawingShapes)
  expect(report.labelPosition).toEqual({ x: 7500, y: 4000 }); expect(report.labelRegion.withLabel).not.toBe(report.labelRegion.withoutLabel)
  expect(report.outsidePixel).toEqual([216, 213, 197, 255]); expect(report.capPixel).not.toEqual(report.outsidePixel)
  expect(report.formalIgnoringHidden).toEqual(report.baselinePixels)
  expect(report.hiddenPaths).toEqual([]); expect(report.hiddenNotes).toEqual([])
  expect(report.hidden).toEqual(report.barePixels); expect(report.supportHidden).toEqual(report.barePixels)
  expect(report.sourceUnchanged).toBe(true)
  await info.attach('c4-road-selection-anchor-hiding.json', { body: JSON.stringify({ method: 'Native Canvas2D pixels and exact zero-tolerance point/marquee queries against square caps, miter corners and concave holes. Actual label-region RGBA change at the half-centerline-length anchor. GM session hiding of road or separate declared terrain support removes road and recursive note dependencies; formal output ignores session hiding.', ...report }, null, 2), contentType: 'application/json' })
})

test('C4 path exports reject unsafe band masks and hidden or offscreen missing road resources before rendering', async ({ page }, info) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c4-render-fixtures.ts', rendererPath = '/src/render/v3/renderer.ts'
    const { createC4RenderProject, C4_ROAD_LAYER, C4_PRIVATE_ASSET, c4Rect, c4Pixels } = await import(fixturePath) as typeof import('./c4-render-fixtures')
    const { renderProjectV3, renderEditorProjectV3, exportPngV3 } = await import(rendererPath) as typeof import('../src/render/v3/renderer')
    const source = await createC4RenderProject(), unsafe = structuredClone(source)
    // The exact private square-cap band is covered; its actual edge decoration still is not.
    unsafe.document.regions['c4-private-mask'].boundaryMm = c4Rect(3400, 3400, 2400, 1100)
    let unsafeError = ''
    try { await exportPngV3(unsafe, { audience: 'player', longEdgePx: 1000 }) } catch (error) { unsafeError = String(error) }
    const missing = await createC4RenderProject({ includePrivate: false })
    delete missing.assets[missing.document.assets['c4-base-texture'].sha256]
    const missingErrors: Record<string, string> = {}
    for (const mode of ['hidden', 'offscreen'] as const) {
      try {
        const output = await renderEditorProjectV3(missing, { audience: 'gm', longEdgePx: 512,
          ...(mode === 'hidden' ? { hiddenLayerIds: new Set([C4_ROAD_LAYER]) } : { viewBoundsMm: { x: 9000, y: 7000, width: 1000, height: 1000 } }) })
        output.width = output.height = 0
      } catch (error) { missingErrors[mode] = String(error) }
    }
    const baseline = await c4Pixels(await renderProjectV3(source, { audience: 'player', longEdgePx: 512 })), missingPrivate = structuredClone(source)
    delete missingPrivate.assets[missingPrivate.document.assets[C4_PRIVATE_ASSET].sha256]
    const filtered = await c4Pixels(await renderProjectV3(missingPrivate, { audience: 'player', longEdgePx: 512 }))
    let missingPrivateGmError = ''
    try { const output = await renderProjectV3(missingPrivate, { audience: 'gm', longEdgePx: 512 }); output.width = output.height = 0 }
    catch (error) { missingPrivateGmError = String(error) }
    return { unsafeError, missingErrors, baseline, filtered, missingPrivateGmError }
  })
  expect(report.unsafeError).toMatch(/固定遮罩未覆盖/)
  expect(report.missingErrors.hidden).toMatch(/c4-base-texture.*缺失/); expect(report.missingErrors.offscreen).toMatch(/c4-base-texture.*缺失/)
  expect(report.filtered).toEqual(report.baseline); expect(report.missingPrivateGmError).toMatch(/c4-private-texture.*缺失/)
  await info.attach('c4-road-output-resource-guards.json', { body: JSON.stringify({ method: 'Real browser strict native-v3 render/export calls. Hidden/offscreen public bitmap resources remain mandatory; audience-filtered private bitmap bytes are never required by player output. A mask covering only the exact private band, without its cosmetic edge envelope, rejects player PNG export.', ...report }, null, 2), contentType: 'application/json' })
})
