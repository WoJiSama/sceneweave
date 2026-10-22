import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { PrivacyCaseB4 } from './b4-privacy-fixtures'

const fixturePath = '/tests/b4-privacy-fixtures.ts'
const renderPath = '/src/render/v3/renderer.ts'
const projectionPath = '/src/render/v3/projection.ts'
const migrationPath = '/src/core/v3/migration.ts'

async function attachJson(testInfo: TestInfo, name: string, report: unknown) {
  await testInfo.attach(name, { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
}

test('C1c native Canvas default-layer migration preserves every pixel of both samples and audiences', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/#assets')
  const report = await page.evaluate(async () => {
    const studyPath = '/src/editor/v2/study-sample.ts', islandPath = '/src/editor/v2/island-sample.ts', v2Path = '/src/render/v2/renderer.ts', v3Path = '/src/render/v3/renderer.ts', migratePath = '/src/io/v3/migration.ts'
    const { createStudyProject } = await import(studyPath), { createIslandProject } = await import(islandPath), { renderProjectV2 } = await import(v2Path), { renderProjectV3 } = await import(v3Path), { createLayerProject } = await import(migratePath)
    const results: any[] = [], images: Record<string, string> = {}
    const hash = async (data: Uint8ClampedArray<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('')
    for (const [name, make] of [['study', createStudyProject], ['island', createIslandProject]] as const) {
      const original = await make(), before = JSON.stringify(original.document), migrated = await createLayerProject(original, { sceneId: `c1c-${name}`, now: '2026-10-21T00:00:00.000Z' })
      for (const audience of ['gm', 'player'] as const) {
        const v2 = await renderProjectV2(original, { audience, longEdgePx: 4096 }), v3 = await renderProjectV3(migrated, { audience, longEdgePx: 4096 })
        const a = v2.getContext('2d')!.getImageData(0, 0, v2.width, v2.height).data, b = v3.getContext('2d')!.getImageData(0, 0, v3.width, v3.height).data
        let differingChannels = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differingChannels++
        results.push({ name, audience, width: v3.width, height: v3.height, differingChannels, v2Hash: await hash(a), v3Hash: await hash(b), originalUnchanged: before === JSON.stringify(original.document), sourceSchema: original.document.schemaVersion, migratedSchema: migrated.document.schemaVersion, independentSceneId: migrated.document.sceneId !== original.document.sceneId })
        images[`${name}-${audience}`] = v3.toDataURL('image/png').split(',')[1]; v2.width = v2.height = v3.width = v3.height = 0
      }
    }
    return { results, images }
  })
  for (const result of report.results) {
    expect(result.differingChannels).toBe(0); expect(result.v3Hash).toBe(result.v2Hash); expect(result.originalUnchanged).toBe(true); expect(result.independentSceneId).toBe(true)
    expect(result.sourceSchema).toBe(2); expect(result.migratedSchema).toBe(3); expect(result.width).toBe(4096)
  }
  for (const [name, base64] of Object.entries(report.images)) await testInfo.attach(`c1c-default-${name}-4096.png`, { body: Buffer.from(base64, 'base64'), contentType: 'image/png' })
  await attachJson(testInfo, 'c1c-default-pixel-parity.json', report.results)
})

test('C1c native pixels follow layer order inside a system band and preserve ground/object/canopy separation', async ({ page }, testInfo) => {
  await page.goto('/#assets')
  const report = await page.evaluate(async ({ renderPath, migrationPath }) => {
    const blankPath = '/src/editor/v2/blank-project.ts', { createBlankProjectV2 } = await import(blankPath), { migrateSceneV2 } = await import(migrationPath), { renderProjectV3 } = await import(renderPath)
    const original = await createBlankProjectV2({ title: 'C1c render order', widthMm: 10000, heightMm: 8000, preset: 'investigation', gridVisible: false }), scene = migrateSceneV2(original.document, { sceneId: 'c1c-order' })
    const base = Object.keys(scene.userLayers)[0], extra = 'layer-upper', floorId = Object.keys(scene.floors)[0]
    scene.userLayers[extra] = { id: extra, floorId, name: '上层', order: 1, editLocked: false }
    const prop = (id: string, symbol: 'chair' | 'rug', renderOrder: number) => ({ id, floorId, editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol, tint: null, opacity: 1 },
      positionMm: { x: 5000, y: 4000 }, rotationDeg: 0, visualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 }, footprintMm: { width: 500, height: 500 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false,
      visibility: 'public', supportRef: { kind: 'floor', id: floorId }, renderLayer: 'object', renderOrder, shadowClass: 'none', shadowOverride: null })
    scene.props.first = prop('first', 'chair', 99); scene.props.second = prop('second', 'rug', -99); scene.entityLayers.first = base; scene.entityLayers.second = extra
    const result: any[] = [], project = { ...original, document: scene }
    const pixel = async (label: string) => {
      const canvas = await renderProjectV3(project, { audience: 'gm', longEdgePx: 1000 }), rgba = [...canvas.getContext('2d')!.getImageData(500, 400, 1, 1).data]; canvas.width = canvas.height = 0
      result.push({ label, rgba, bands: [scene.props.first.renderLayer, scene.props.second.renderLayer], layers: [scene.userLayers[base].order, scene.userLayers[extra].order] })
    }
    await pixel('later-layer-overrides-local-order')
    scene.userLayers[extra].order = 0; scene.userLayers[base].order = 1; await pixel('reverse-layers')
    scene.props.second.renderLayer = 'ground'; scene.userLayers[extra].order = 1; scene.userLayers[base].order = 0; await pixel('ground-cannot-cover-object')
    scene.props.second.renderLayer = 'canopy'; scene.userLayers[extra].order = 0; scene.userLayers[base].order = 1; await pixel('canopy-stays-above-object')
    return result
  }, { renderPath, migrationPath })
  expect(report.map((item: any) => item.rgba)).toEqual([[148, 103, 85, 255], [113, 134, 90, 255], [113, 134, 90, 255], [148, 103, 85, 255]])
  await attachJson(testInfo, 'c1c-band-order-pixels.json', report)
})

test('C1c hidden opening retains its hole, hidden wall suppresses its symbols and labels, supported furniture remains visible', async ({ page }, testInfo) => {
  await page.goto('/#assets')
  const report = await page.evaluate(async ({ renderPath, migrationPath }) => {
    const blankPath = '/src/editor/v2/blank-project.ts', { createBlankProjectV2 } = await import(blankPath), { migrateSceneV2 } = await import(migrationPath), { renderEditorProjectV3, renderProjectV3, exportPngV3 } = await import(renderPath)
    const original = await createBlankProjectV2({ title: 'C1c hidden dependencies', widthMm: 10000, heightMm: 8000, preset: 'investigation', gridVisible: false }), input = original.document, floorId = Object.keys(input.floors)[0]
    input.vertices.a = { id: 'a', floorId, editLocked: false, xMm: 1000, yMm: 2000 }; input.vertices.b = { id: 'b', floorId, editLocked: false, xMm: 9000, yMm: 2000 }
    input.walls.wall = { id: 'wall', floorId, editLocked: false, startVertexId: 'a', endVertexId: 'b', thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    input.openings.door = { id: 'door', floorId, editLocked: false, wallId: 'wall', offsetReferenceVertexId: 'a', offsetMm: 3500, widthMm: 1000, kind: 'door', state: 'closed', locked: false, secret: false, revealed: false }
    input.notes.label = { id: 'label', floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'wall', entityId: 'wall' }, kind: 'label', text: 'ANCHOR LABEL', visibility: 'public' }
    input.notes.nested = { id: 'nested', floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'note', entityId: 'label' }, kind: 'label', text: 'NESTED LABEL', visibility: 'public' }
    input.terrainAreas.support = { id: 'support', floorId, editLocked: false, visibility: 'public', groundElevationMm: 0, coveragePriority: 0, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1,
      boundaryMm: [{ x: 2000, y: 4000 }, { x: 8000, y: 4000 }, { x: 8000, y: 7000 }, { x: 2000, y: 7000 }].map((positionMm, i) => ({ id: `support-v${i}`, segmentId: `support-s${i}`, positionMm })) }
    input.props.chair = { id: 'chair', floorId, editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'chair', tint: null, opacity: 1 }, positionMm: { x: 5000, y: 5500 }, rotationDeg: 0,
      visualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 }, footprintMm: { width: 500, height: 500 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: 'support' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
    const scene = migrateSceneV2(input, { sceneId: 'c1c-hiding' }), base = Object.keys(scene.userLayers)[0]
    for (const [index, id] of ['wall-layer', 'opening-layer', 'support-layer'].entries()) scene.userLayers[id] = { id, floorId, name: id, order: index + 1, editLocked: false }
    scene.entityLayers.wall = 'wall-layer'; scene.entityLayers.door = 'opening-layer'; scene.entityLayers.support = 'support-layer'
    const project = { ...original, document: scene }, before = JSON.stringify(scene), pixel = (canvas: HTMLCanvasElement, x: number, y: number) => [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data]
    const hiddenOpening = await renderEditorProjectV3(project, { audience: 'gm', longEdgePx: 1000, screenScalePxPerMm: 1, hiddenLayerIds: new Set(['opening-layer', base]) })
    const openingHole = pixel(hiddenOpening, 500, 200), wallBody = pixel(hiddenOpening, 200, 200); hiddenOpening.width = hiddenOpening.height = 0
    const hiddenWall = await renderEditorProjectV3(project, { audience: 'gm', longEdgePx: 1000, screenScalePxPerMm: 1, hiddenLayerIds: new Set(['wall-layer']) })
    const wallAndLabelsAbsent = pixel(hiddenWall, 500, 200), wallBodyAbsent = pixel(hiddenWall, 200, 200); hiddenWall.width = hiddenWall.height = 0
    const hiddenSupport = await renderEditorProjectV3(project, { audience: 'gm', longEdgePx: 1000, screenScalePxPerMm: 1, hiddenLayerIds: new Set(['support-layer']) })
    const supportedChair = pixel(hiddenSupport, 500, 550), bareSupport = pixel(hiddenSupport, 300, 500); hiddenSupport.width = hiddenSupport.height = 0
    const hash = async (canvas: HTMLCanvasElement) => { const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); canvas.width = canvas.height = 0; return digest }
    const hashPng = async (blob: Blob) => { const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close(); return hash(canvas) }
    const formal: any[] = [], hiddenLayerIds = new Set(Object.keys(scene.userLayers))
    for (const audience of ['gm', 'player'] as const) {
      const baseline = await hash(await renderProjectV3(project, { audience, longEdgePx: 1000 })), ignored = await hash(await renderProjectV3(project, { audience, longEdgePx: 1000, hiddenLayerIds })), png = await hashPng(await exportPngV3(project, { audience, longEdgePx: 1000, hiddenLayerIds }))
      formal.push({ audience, baseline, ignored, png })
    }
    const playerEditor = await hash(await renderEditorProjectV3(project, { audience: 'player', longEdgePx: 1000, screenScalePxPerMm: 1, hiddenLayerIds }))
    return { openingHole, wallBody, wallAndLabelsAbsent, wallBodyAbsent, supportedChair, bareSupport, formal, playerEditor, sourceUnchanged: before === JSON.stringify(scene) }
  }, { renderPath, migrationPath })
  expect(report.openingHole).toEqual([216, 213, 197, 255]); expect(report.wallBody).not.toEqual(report.openingHole)
  expect(report.wallAndLabelsAbsent).toEqual(report.openingHole); expect(report.wallBodyAbsent).toEqual(report.openingHole)
  expect(report.supportedChair).toEqual([113, 134, 90, 255]); expect(report.bareSupport).toEqual(report.openingHole)
  expect(report.sourceUnchanged).toBe(true)
  for (const item of report.formal) { expect(item.ignored).toBe(item.baseline); expect(item.png).toBe(item.baseline) }
  expect(report.playerEditor).toBe(report.formal.find((item: any) => item.audience === 'player')!.baseline)
  await attachJson(testInfo, 'c1c-hidden-dependency-pixels.json', report)
})

async function setupPrivacyPage(page: Page, name: PrivacyCaseB4) {
  const session = await page.context().newCDPSession(page); await session.send('Network.enable'); await session.send('Network.setCacheDisabled', { cacheDisabled: true })
  await page.goto('/#assets')
  return page.evaluate(async ({ name, fixturePath, migrationPath, projectionPath }) => {
    const { createPrivacyPairB4 } = await import(fixturePath), { migrateSceneV2 } = await import(migrationPath), { projectSceneV3 } = await import(projectionPath), pair = await createPrivacyPairB4(name)
    for (const variant of ['a', 'b'] as const) {
      const source = pair[variant], scene = migrateSceneV2(source.document, { sceneId: `c1c-${name}`, now: '2026-10-21T00:00:00.000Z' }), base = Object.keys(scene.userLayers)[0], publicId = `PRIVATE-BASE-LAYER-${variant}`, privateId = `PRIVATE-SECRET-LAYER-${variant}`
      scene.userLayers[publicId] = { ...scene.userLayers[base], id: publicId, name: `PRIVATE-BASE-NAME-${variant}`, order: variant === 'a' ? 0 : 1 }; delete scene.userLayers[base]
      scene.userLayers[privateId] = { id: privateId, floorId: Object.keys(scene.floors)[0], name: `PRIVATE-SECRET-NAME-${variant}`, order: variant === 'a' ? 1 : 0, editLocked: variant === 'b' }
      for (const id of Object.keys(scene.entityLayers)) scene.entityLayers[id] = id.startsWith('b4-') ? privateId : publicId
      pair[variant] = { ...source, document: scene }
    }
    ;(window as any).__c1cPrivacyPair = pair
    const a = projectSceneV3(pair.a.document, 'player'), b = projectSceneV3(pair.b.document, 'player')
    return { name, equalPlayerProjection: JSON.stringify(a) === JSON.stringify(b), retainedOriginalProps: ['a', 'b'].map(variant => pair.originalPropIds.filter((id: string) => pair[variant].document.props[id]).length), originalPropCount: pair.originalPropIds.length,
      layerMetadataAbsent: !JSON.stringify(a).includes('PRIVATE-') && !JSON.stringify(b).includes('PRIVATE-'), publicRelocations: pair.publicRelocations }
  }, { name, fixturePath, migrationPath, projectionPath })
}

async function observePrivacy(page: Page, variant: 'a' | 'b', audience: 'gm' | 'player', mode: 'preview' | 'png', label: string) {
  return page.evaluate(async ({ variant, audience, mode, label, renderPath, projectionPath }) => {
    const { renderProjectV3, renderEditorProjectV3, exportPngV3 } = await import(renderPath), { projectSceneV3 } = await import(projectionPath), pair = (window as any).__c1cPrivacyPair, project = pair[variant], before = JSON.stringify(project.document), projection = projectSceneV3(project.document, audience)
    const hash = async (bytes: ArrayBuffer | Uint8ClampedArray<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
    const expectedDecodeHashes = [...new Set(projection.assetIds.map((id: string) => project.document.assets[id].sha256))].sort(), actualDecodeHashes: string[] = [], native = window.createImageBitmap.bind(window), hiddenLayerIds = new Set<string>(Object.keys(project.document.userLayers)); let closed = 0
    let output: HTMLCanvasElement | undefined, png: Blob | undefined
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      if (!(source instanceof Blob)) throw new Error('Expected Blob resource')
      actualDecodeHashes.push(await hash(await source.arrayBuffer()))
      const bitmap = await native(source, options), close = bitmap.close.bind(bitmap); bitmap.close = () => { closed++; close() }; return bitmap
    }) as typeof createImageBitmap
    try {
      if (mode === 'png') png = await exportPngV3(project, { audience, longEdgePx: 4096, hiddenLayerIds })
      else output = await (audience === 'player' ? renderEditorProjectV3 : renderProjectV3)(project, { audience, longEdgePx: 1024, hiddenLayerIds })
    } finally { window.createImageBitmap = native }
    if (png) { const bitmap = await native(png); output = document.createElement('canvas'); output.width = bitmap.width; output.height = bitmap.height; output.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close() }
    if (!output) throw new Error('No output')
    const width = output.width, height = output.height, pixels = output.getContext('2d')!.getImageData(0, 0, width, height).data, rgbaHash = await hash(pixels)
    let opaquePixels = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 255) opaquePixels++
    output.width = output.height = 0
    const chunks: string[] = [], sentinels: string[] = []
    if (png) { const bytes = new Uint8Array(await png.arrayBuffer()); let offset = 8; while (offset < bytes.length) { const length = new DataView(bytes.buffer, offset, 4).getUint32(0); chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset += length + 12 }; const raw = new TextDecoder().decode(bytes); sentinels.push(...[...pair.sentinelStrings, 'PRIVATE-BASE-LAYER-', 'PRIVATE-SECRET-LAYER-', 'PRIVATE-BASE-NAME-', 'PRIVATE-SECRET-NAME-'].filter(s => raw.includes(s))) }
    return { label, variant, audience, mode, width, height, rgbaHash, opaquePixels, pixels: width * height, expectedDecodeHashes, actualDecodeHashes, closed, privateAssetsRequested: pair.secretAssetIds.filter((id: string) => projection.assetIds.includes(id)), sourceUnchanged: before === JSON.stringify(project.document), metadataChunks: chunks.filter(c => ['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(c)), sentinels }
  }, { variant, audience, mode, label, renderPath, projectionPath })
}

for (const name of ['VIS-01-S01', 'VIS-02-S01', 'VIS-02-S02'] as const) test(`C1c ${name}: A/B private layers preserve the 16-cell native preview/PNG privacy matrix`, async ({ browser }, testInfo) => {
  test.setTimeout(300_000)
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ viewport: { width: 1512, height: 982 } })))
  try {
    const pages: Page[] = []; for (const context of contexts) pages.push(await context.newPage())
    const fixtures = []; for (const page of pages) fixtures.push(await setupPrivacyPage(page, name))
    const observations = []
    for (const [index, [variant, audience]] of ([['a', 'player'], ['b', 'player'], ['a', 'gm'], ['b', 'gm']] as const).entries()) for (const mode of ['preview', 'png'] as const) observations.push(await observePrivacy(pages[index], variant, audience, mode, `${name}-fresh-${variant}-${audience}-${mode}`))
    for (const [variant, audience] of [['a', 'gm'], ['b', 'player'], ['b', 'gm'], ['a', 'player']] as const) for (const mode of ['png', 'preview'] as const) observations.push(await observePrivacy(pages[0], variant, audience, mode, `${name}-repeated-${variant}-${audience}-${mode}`))
    for (const fixture of fixtures) { expect(fixture.equalPlayerProjection).toBe(true); expect(fixture.layerMetadataAbsent).toBe(true); expect(fixture.retainedOriginalProps).toEqual([fixture.originalPropCount, fixture.originalPropCount]) }
    for (const mode of ['preview', 'png'] as const) {
      const player = observations.filter(item => item.audience === 'player' && item.mode === mode)
      expect(new Set(player.map(item => item.rgbaHash)).size).toBe(1)
      const gmA = observations.filter(item => item.audience === 'gm' && item.mode === mode && item.variant === 'a'), gmB = observations.filter(item => item.audience === 'gm' && item.mode === mode && item.variant === 'b')
      expect(gmA).toHaveLength(2); expect(gmB).toHaveLength(2); expect(gmA[0].rgbaHash).toBe(gmA[1].rgbaHash); expect(gmB[0].rgbaHash).toBe(gmB[1].rgbaHash); expect(gmA[0].rgbaHash).not.toBe(gmB[0].rgbaHash)
    }
    for (const item of observations) {
      expect(item.sourceUnchanged).toBe(true); expect(item.opaquePixels).toBe(item.pixels); expect(item.actualDecodeHashes.slice().sort()).toEqual(item.expectedDecodeHashes); expect(item.closed).toBe(item.actualDecodeHashes.length)
      expect(item.metadataChunks).toEqual([]); expect(item.sentinels).toEqual([])
      if (item.audience === 'player') expect(item.privateAssetsRequested).toEqual([])
      else expect(item.privateAssetsRequested).toEqual(['b4-private-object-image', 'b4-private-texture-image'])
      if (item.mode === 'png') { expect(item.width).toBe(4096); expect(item.height).toBe(name === 'VIS-01-S01' ? 2926 : 3686) }
    }
    await attachJson(testInfo, `c1c-${name}-privacy-matrix.json`, { case: name, matrix: '2 variants x 2 audiences x 2 outputs x 2 states = 16 observations; fresh uses four independent contexts with HTTP cache disabled, repeated reuses modules and Blob bytes. Every render decodes a fresh set. Player editor preview and both formal PNG audiences receive hidden-all options; these must not publish editor isolation.', fixtures, observations })
  } finally { for (const context of contexts) await context.close() }
})

test('C1c hidden/offscreen damaged bytes reject and late GM cancellation closes native bitmaps before player output', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await setupPrivacyPage(page, 'VIS-01-S01')
  const report = await page.evaluate(async ({ renderPath, projectionPath }) => {
    const { renderEditorProjectV3, renderProjectV3 } = await import(renderPath), { projectSceneV3 } = await import(projectionPath), project = (window as any).__c1cPrivacyPair.a, id = 'b4-private-object-image', resourceHash = project.document.assets[id].sha256
    const attempts: any[] = [], originalResource = project.assets[resourceHash]
    for (const damage of ['missing', 'corrupt']) for (const mode of ['hidden', 'offscreen', 'tiny']) {
      const copy = { ...project, assets: { ...project.assets } }
      if (damage === 'missing') delete copy.assets[resourceHash]
      else { const bytes = new Uint8Array(await originalResource.blob.arrayBuffer()); bytes[20] ^= 1; copy.assets[resourceHash] = { ...originalResource, blob: new Blob([bytes.buffer], { type: 'image/png' }) } }
      let error = ''
      try {
        const output = await renderEditorProjectV3(copy, { audience: 'gm', longEdgePx: 256,
          ...(mode === 'hidden' ? { hiddenLayerIds: new Set(Object.keys(project.document.userLayers)) } : mode === 'offscreen' ? { viewBoundsMm: { x: 0, y: 0, width: 500, height: 500 }, screenScalePxPerMm: 1 } : { screenScalePxPerMm: .0001 }) })
        output.width = output.height = 0
      } catch (failure) { error = String(failure) }
      const player = await renderProjectV3(copy, { audience: 'player', longEdgePx: 256 }); player.width = player.height = 0
      attempts.push({ damage, mode, error, playerSucceeded: true })
    }
    const native = window.createImageBitmap.bind(window), controller = new AbortController(), actual: { hash: string; closed: boolean; phase: string }[] = []
    let release!: () => void, prepared!: () => void, phase = 'gm', first = true
    const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { prepared = resolve })
    const hash = async (bytes: ArrayBuffer | Uint8ClampedArray<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      if (!(source instanceof Blob)) throw new Error('Expected Blob resource')
      const record = { hash: await hash(await source.arrayBuffer()), closed: false, phase }, bitmap = await native(source, options), close = bitmap.close.bind(bitmap); actual.push(record); bitmap.close = () => { record.closed = true; close() }
      if (first) { first = false; prepared(); await gate }
      return bitmap
    }) as typeof createImageBitmap
    let gmError = '', playerHash = ''
    try {
      const gm = renderEditorProjectV3(project, { audience: 'gm', longEdgePx: 256, signal: controller.signal, hiddenLayerIds: new Set(Object.keys(project.document.userLayers)) }).catch((failure: unknown) => { gmError = failure instanceof DOMException ? failure.name : String(failure) })
      await ready; controller.abort(); phase = 'player'
      const playerTask = renderProjectV3(project, { audience: 'player', longEdgePx: 256 }); release(); await gm
      const player = await playerTask; playerHash = await hash(player.getContext('2d')!.getImageData(0, 0, player.width, player.height).data); player.width = player.height = 0
    } finally { release(); window.createImageBitmap = native }
    const expectedPlayer = [...new Set(projectSceneV3(project.document, 'player').assetIds.map((assetId: string) => project.document.assets[assetId].sha256))].sort()
    return { attempts, gmError, actual, expectedPlayer, actualPlayer: actual.filter(item => item.phase === 'player').map(item => item.hash).sort(), playerHash }
  }, { renderPath, projectionPath })
  for (const item of report.attempts) { expect(item.error).toMatch(item.damage === 'missing' ? /缺失/ : /CRC|hash|格式|尺寸/); expect(item.playerSucceeded).toBe(true) }
  expect(report.gmError).toBe('AbortError'); expect(report.actual.filter(item => item.phase === 'gm')).toHaveLength(1); expect(report.actual.every(item => item.closed)).toBe(true); expect(report.actualPlayer).toEqual(report.expectedPlayer); expect(report.playerHash).toHaveLength(64)
  await attachJson(testInfo, 'c1c-required-bytes-late-cancel.json', report)
})
