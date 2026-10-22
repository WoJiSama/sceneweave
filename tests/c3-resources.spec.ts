import { expect, test, type TestInfo } from '@playwright/test'

async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}

test('C3 real PNG JPEG WebP imports strip source metadata and preserve decoded color and alpha', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c3-fixtures.ts', preparePath = '/src/io/v5/prepare.ts', resourcesPath = '/src/io/v5/resources.ts', limitsPath = '/src/io/v2/limits.ts'
    const { createC3ProjectV5, c3ImageBlob } = await import(fixturePath) as typeof import('./c3-fixtures')
    const { prepareAssetImportV5 } = await import(preparePath) as typeof import('../src/io/v5/prepare')
    const { readBitmapPixelsV5, sha256Bytes, inspectImageBytes } = await import(resourcesPath) as typeof import('../src/io/v5/resources')
    const { crc32 } = await import(limitsPath) as typeof import('../src/io/v2/limits')
    const marker = 'C3_SOURCE_PRIVATE_METADATA_8921', encode = (text: string) => new TextEncoder().encode(text)
    const join = (...parts: Uint8Array[]) => { const result = new Uint8Array(parts.reduce((sum, value) => sum + value.length, 0)); let cursor = 0; for (const part of parts) { result.set(part, cursor); cursor += part.length }; return result }
    const pngChunk = (name: string, data: Uint8Array) => { const output = new Uint8Array(data.length + 12), view = new DataView(output.buffer); view.setUint32(0, data.length); output.set(encode(name), 4); output.set(data, 8); view.setUint32(output.length - 4, crc32(output.subarray(4, output.length - 4))); return output }
    const webpChunk = (name: string, data: Uint8Array) => { const output = new Uint8Array(8 + data.length + data.length % 2); output.set(encode(name)); new DataView(output.buffer).setUint32(4, data.length, true); output.set(data, 8); return output }
    const metadataFile = async (type: string) => {
      const original = new Uint8Array(await (await c3ImageBlob(type)).arrayBuffer()); let bytes: Uint8Array
      if (type === 'image/png') bytes = join(original.subarray(0, 33), pngChunk('tEXt', encode(`Comment\0${marker}`)), original.subarray(33))
      else if (type === 'image/jpeg') { const data = encode(marker), comment = new Uint8Array(data.length + 4); comment.set([255, 254]); new DataView(comment.buffer).setUint16(2, data.length + 2); comment.set(data, 4); bytes = join(original.subarray(0, 2), comment, original.subarray(2)) }
      else {
        let body = original.subarray(12).slice()
        if (new TextDecoder().decode(body.subarray(0, 4)) === 'VP8X') body[8] |= 4
        else { const extended = new Uint8Array(10); extended[0] = 0x14; extended[4] = 7; extended[7] = 7; body = join(webpChunk('VP8X', extended), body) }
        bytes = join(original.subarray(0, 12), body, webpChunk('XMP ', encode(`<x:xmpmeta>${marker}</x:xmpmeta>`)))
        new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true)
      }
      return new Blob([bytes.slice().buffer], { type })
    }
    const pixels = async (file: Blob) => { const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' }); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!; try { context.drawImage(bitmap, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height).data.slice() } finally { bitmap.close(); canvas.width = canvas.height = 0 } }
    const base = await createC3ProjectV5(), results = []
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const file = await metadataFile(type), originalPixels = await pixels(file), before = Object.keys(base.document.propDefinitions)
      const imported = await prepareAssetImportV5(base, { file, kind: 'prop', name: `Original ${type}`, widthMm: 1300, heightMm: 900, footprintWidthMm: 700, footprintHeightMm: 500,
        licenseText: 'CC0-1.0. Sceneweave original C3 metadata fixture.', attribution: 'Sceneweave browser fixture', canEmbed: true, tags: ['metadata'] })
      const definition = Object.values(imported.document.propDefinitions).find(value => !before.includes(value.id))!
      if (definition.defaultAppearance.kind !== 'image') throw new Error('Imported definition must use an image')
      const asset = imported.document.assets[definition.defaultAppearance.assetId], adopted = imported.assets[asset.sha256]
      const bytes = new Uint8Array(await adopted.blob.arrayBuffer()), actual = await readBitmapPixelsV5(adopted), chunks: string[] = []
      for (let cursor = 8; cursor < bytes.length;) { const length = new DataView(bytes.buffer).getUint32(cursor); chunks.push(new TextDecoder().decode(bytes.subarray(cursor + 4, cursor + 8))); cursor += length + 12 }
      results.push({ inputType: type, inputContainsMarker: new TextDecoder('latin1').decode(await file.arrayBuffer()).includes(marker), sourceHeader: inspectImageBytes(new Uint8Array(await file.arrayBuffer()), false), outputHeader: inspectImageBytes(bytes), chunks,
        outputContainsMarker: new TextDecoder('latin1').decode(bytes).includes(marker), hashMatches: await sha256Bytes(bytes) === adopted.sha256,
        equalDecodedPixels: originalPixels.every((value, index) => value === actual[index]), alphas: [...new Set(Array.from(actual).filter((_value, index) => index % 4 === 3))].sort((a, b) => a - b),
        logicalSize: asset.logicalSizeMm, footprint: definition.defaultFootprintMm, originalPropCount: Object.keys(base.document.props).length, importedPropCount: Object.keys(imported.document.props).length,
        license: Object.values(imported.licenses).find(value => value.text.includes('metadata fixture'))?.text, hasFixedSource: Object.values(imported.appearance.sources).some(value => value.kind === 'prop' && value.snapshot.definitionRef?.id === definition.id) })
    }
    return results
  })
  for (const result of report) {
    expect(result.inputContainsMarker).toBe(true); expect(result.outputContainsMarker).toBe(false)
    expect(result.sourceHeader.mimeType).toBe(result.inputType); expect(result.outputHeader).toEqual({ mimeType: 'image/png', width: 8, height: 8 })
    expect(result.chunks.every(value => ['IHDR', 'sRGB', 'IDAT', 'IEND'].includes(value))).toBe(true)
    expect(result.hashMatches).toBe(true); expect(result.equalDecodedPixels).toBe(true)
    expect(result.logicalSize).toEqual({ width: 1300, height: 900 }); expect(result.footprint).toEqual({ width: 700, height: 500 })
    expect(result.originalPropCount).toBe(result.importedPropCount); expect(result.license).toContain('CC0'); expect(result.hasFixedSource).toBe(true)
    if (result.inputType !== 'image/jpeg') { expect(result.alphas).toContain(0); expect(result.alphas).toContain(128); expect(result.alphas).toContain(255) }
    else expect(result.alphas).toEqual([255])
  }
  await evidence(info, 'c3-image-normalization.json', { method: 'Actual Chromium decode, sRGB Canvas normalization and independent before/after pixel comparison; original PNG tEXt, JPEG COM and WebP XMP payloads injected before import.', report })
})

test('C3 real parameter pixels match fixed source and preserve alpha while instance values override layer values', async ({ page }, info) => {
  test.setTimeout(120_000); await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c3-fixtures.ts', preparePath = '/src/io/v5/prepare.ts', resourcesPath = '/src/io/v5/resources.ts', ioPath = '/src/io/v5/project-file.ts'
    const { createC3ProjectV5, C3_LAYER } = await import(fixturePath) as typeof import('./c3-fixtures'), { prepareCompositionCommandsV5 } = await import(preparePath) as typeof import('../src/io/v5/prepare')
    const { readBitmapPixelsV5 } = await import(resourcesPath) as typeof import('../src/io/v5/resources'), { validateCompleteProjectV5 } = await import(ioPath) as typeof import('../src/io/v5/project-file')
    const source = await createC3ProjectV5(), originalSource = source.appearance.propSources['c3-left']
    const next = await prepareCompositionCommandsV5(source, [
      { type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId: C3_LAYER }, adjustment: { id: 'layer-brightness', kind: 'brightness', value: .5, enabled: true } },
      { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustment: { id: 'instance-brightness', kind: 'brightness', value: 1.5, enabled: true } },
      { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustment: { id: 'instance-tint', kind: 'tint', value: '#80FF00', enabled: true } },
    ])
    const pixelRecord = async (project: typeof source, id: string) => { const appearance = project.document.props[id].appearance; if (appearance.kind !== 'image') throw new Error('Fixture prop must use image'); const asset = project.document.assets[appearance.assetId], data = await readBitmapPixelsV5(project.assets[asset.sha256]); return { opaque: Array.from(data.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)), alphas: Array.from(data).filter((_value, i) => i % 4 === 3), sha256: asset.sha256, appearance } }
    const sourcePixels = await pixelRecord(source, 'c3-left'), left = await pixelRecord(next, 'c3-left'), right = await pixelRecord(next, 'c3-right')
    const disabled = await prepareCompositionCommandsV5(next, [{ type: 'toggleAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustmentId: 'instance-brightness', enabled: false }])
    await validateCompleteProjectV5(next); await validateCompleteProjectV5(disabled)
    return { source: sourcePixels, left, right, disabled: await pixelRecord(disabled, 'c3-left'), unchangedSource: next.appearance.propSources['c3-left'] === originalSource,
      originalBytesRetained: !!next.assets[sourcePixels.sha256], variants: Object.keys(next.appearance.variants).length,
      physicalUnchanged: ['positionMm', 'rotationDeg', 'footprintMm', 'footprintOffsetMm', 'supportRef', 'blocksMovement', 'blocksSight', 'visibility', 'editLocked'].every(key => JSON.stringify(Reflect.get(source.document.props['c3-left'], key)) === JSON.stringify(Reflect.get(next.document.props['c3-left'], key))), revision: [source.document.revision, next.document.revision] }
  })
  expect(report.source.opaque).toEqual([200, 100, 50, 255]); expect(report.left.opaque).toEqual([151, 150, 0, 255])
  expect(report.right.opaque).toEqual([100, 50, 25, 255]); expect(report.disabled.opaque).toEqual([50, 50, 0, 255])
  expect(report.left.alphas).toEqual(report.source.alphas); expect(report.right.alphas).toEqual(report.source.alphas)
  expect(report.left.appearance.tint).toBeNull(); expect(report.unchangedSource).toBe(true); expect(report.originalBytesRetained).toBe(true)
  expect(report.physicalUnchanged).toBe(true); expect(report.variants).toBe(2); expect(report.revision[1]).toBe(report.revision[0])
  await evidence(info, 'c3-real-parameter-pixels.json', report)
})

test('C3 valid image hash with wrong derived pixels is rejected before any complete package can be saved', async ({ page }, info) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c3-fixtures.ts', preparePath = '/src/io/v5/prepare.ts', resourcesPath = '/src/io/v5/resources.ts', ioPath = '/src/io/v5/project-file.ts'
    const { createC3ProjectV5 } = await import(fixturePath) as typeof import('./c3-fixtures'), { prepareCompositionCommandsV5 } = await import(preparePath) as typeof import('../src/io/v5/prepare')
    const { normalizeImageAsset, sha256Bytes } = await import(resourcesPath) as typeof import('../src/io/v5/resources'), { validateCompleteProjectV5, exportProjectV5 } = await import(ioPath) as typeof import('../src/io/v5/project-file')
    const project = await prepareCompositionCommandsV5(await createC3ProjectV5(), [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustment: { id: 'tint', kind: 'tint', value: '#80FF00', enabled: true } }])
    const variant = Object.values(project.appearance.variants)[0], output = project.document.assets[variant.outputAssetId]
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8; canvas.getContext('2d')!.fillStyle = '#EE00FF'; canvas.getContext('2d')!.fillRect(0, 0, 8, 8)
    const file = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('encode failed')))); canvas.width = canvas.height = 0
    const malicious = await normalizeImageAsset(file), priorHash = output.sha256
    output.sha256 = malicious.sha256; project.assets[malicious.sha256] = malicious; delete project.assets[priorHash]
    let validationError = '', exportError = ''
    try { await validateCompleteProjectV5(project) } catch (error) { validationError = String(error) }
    try { await exportProjectV5(project) } catch (error) { exportError = String(error) }
    return { validationError, exportError, validTamperedHash: malicious.sha256 === await sha256Bytes(new Uint8Array(await malicious.blob.arrayBuffer())), declaredOutput: output.sha256, actualTamperedHash: malicious.sha256 }
  })
  expect(report.validTamperedHash).toBe(true); expect(report.declaredOutput).toBe(report.actualTamperedHash)
  expect(report.validationError).toContain('真实像素'); expect(report.exportError).toContain('真实像素')
  await evidence(info, 'c3-wrong-pixel-rejection.json', report)
})

test('C3 disabled and removed color overrides retain fixed source and derived bytes through package and repository reopen', async ({ page }, info) => {
  test.setTimeout(120_000); await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c3-fixtures.ts', preparePath = '/src/io/v5/prepare.ts', ioPath = '/src/io/v5/project-file.ts', storagePath = '/src/io/v5/storage.ts', resourcesPath = '/src/io/v5/resources.ts'
    const { createC3ProjectV5 } = await import(fixturePath) as typeof import('./c3-fixtures'), { prepareCompositionCommandsV5 } = await import(preparePath) as typeof import('../src/io/v5/prepare')
    const io = await import(ioPath) as typeof import('../src/io/v5/project-file'), { SceneRepositoryV5 } = await import(storagePath) as typeof import('../src/io/v5/storage')
    const { readBitmapPixelsV5 } = await import(resourcesPath) as typeof import('../src/io/v5/resources')
    const source = await createC3ProjectV5(), tinted = await prepareCompositionCommandsV5(source, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustment: { id: 'retained-tint', kind: 'tint', value: '#80FF00', enabled: true } }])
    const disabled = await prepareCompositionCommandsV5(tinted, [{ type: 'toggleAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustmentId: 'retained-tint', enabled: false }])
    const removed = await prepareCompositionCommandsV5(disabled, [{ type: 'removeAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustmentId: 'retained-tint' }])
    await io.validateCompleteProjectV5(disabled); await io.validateCompleteProjectV5(removed)
    const reopenedPackage = await io.importProjectV5(await io.exportProjectV5(removed)), dbName = `c3-retained-variants-${crypto.randomUUID()}`
    let repository = new SceneRepositoryV5(dbName)
    try {
      await repository.save(reopenedPackage, null); repository.close(); repository = new SceneRepositoryV5(dbName)
      const persisted = (await repository.load(reopenedPackage.document.sceneId))!
      const pixels = async (project: typeof source) => { const appearance = project.document.props['c3-left'].appearance; if (appearance.kind !== 'image') throw new Error('Expected image'); return Array.from(await readBitmapPixelsV5(project.assets[project.document.assets[appearance.assetId].sha256])) }
      const retainedAssets = Object.keys(tinted.assets).sort(), retainedVariants = Object.keys(tinted.appearance.variants).sort()
      return { retainedAssets, retainedVariants, disabledAssets: Object.keys(disabled.assets).sort(), removedAssets: Object.keys(removed.assets).sort(), reopenedAssets: Object.keys(persisted.assets).sort(),
        disabledVariants: Object.keys(disabled.appearance.variants).sort(), removedVariants: Object.keys(removed.appearance.variants).sort(), reopenedVariants: Object.keys(persisted.appearance.variants).sort(),
        enabled: disabled.appearance.instanceAdjustments['c3-left'][0].enabled, removedRecords: removed.appearance.instanceAdjustments['c3-left'] ?? [],
        unchangedFixedSource: [tinted, disabled, removed, persisted].every(project => project.appearance.propSources['c3-left'] === source.appearance.propSources['c3-left']),
        originalAppearance: source.document.props['c3-left'].appearance, revertedAppearance: persisted.document.props['c3-left'].appearance,
        originalPixels: await pixels(source), revertedPixels: await pixels(persisted), packageHash: await io.projectContentHashV5(reopenedPackage), persistedHash: await io.projectContentHashV5(persisted) }
    } finally {
      repository.close()
      await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(dbName); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Test database remained open')) })
    }
  })
  expect(report.retainedVariants).toHaveLength(1)
  for (const values of [report.disabledAssets, report.removedAssets, report.reopenedAssets]) expect(values).toEqual(report.retainedAssets)
  for (const values of [report.disabledVariants, report.removedVariants, report.reopenedVariants]) expect(values).toEqual(report.retainedVariants)
  expect(report.enabled).toBe(false); expect(report.removedRecords).toEqual([]); expect(report.unchangedFixedSource).toBe(true)
  expect(report.revertedAppearance).toEqual(report.originalAppearance); expect(report.revertedPixels).toEqual(report.originalPixels); expect(report.persistedHash).toBe(report.packageHash)
  const { originalPixels: _source, revertedPixels: _restored, ...summary } = report
  await evidence(info, 'c3-retained-variant-closure.json', { method: 'Actual image source and derived PNG bytes retained after disabling then removing a color record; complete package import and a new IndexedDB repository connection both validate the whole graph and actual pixels.', ...summary })
})

test('C3 selected-history archive reopens completely offline with fixed source derived bytes and exact audience pixels', async ({ page, browser }, info) => {
  test.setTimeout(180_000); await page.goto('/')
  const packed = await page.evaluate(async () => {
    const fixturePath = '/tests/c3-fixtures.ts', preparePath = '/src/io/v5/prepare.ts', ioPath = '/src/io/v5/project-file.ts', renderPath = '/src/render/v3/renderer.ts'
    const { createC3ProjectV5 } = await import(fixturePath) as typeof import('./c3-fixtures'), { prepareCompositionCommandsV5 } = await import(preparePath) as typeof import('../src/io/v5/prepare')
    const io = await import(ioPath) as typeof import('../src/io/v5/project-file'), render = await import(renderPath) as typeof import('../src/render/v3/renderer')
    const source = await createC3ProjectV5(), current = await prepareCompositionCommandsV5(source, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustment: { id: 'tint', kind: 'tint', value: '#80FF00', enabled: true } }]); current.document.revision = 1
    const snapshot = { id: 'selected-source', sceneId: source.document.sceneId, lineageId: source.historyIdentity.lineageId, sourceRevision: source.document.revision, name: 'Before color', kind: 'named' as const, createdAt: new Date().toISOString(), contentHash: await io.projectContentHashV5(source), project: source }
    const archive = await io.exportHistoryArchiveV5({ project: current, snapshots: [snapshot] }), bytes = new Uint8Array(await archive.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))].map(n => n.toString(16).padStart(2, '0')).join(''), pixels: Record<string, string> = {}
    for (const audience of ['gm', 'player'] as const) { const canvas = await render.renderProjectV3(io.toCompleteProjectV3(current), { audience, longEdgePx: 800 }); pixels[audience] = await hash(new Uint8Array(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)); canvas.width = canvas.height = 0 }
    return { data: btoa(binary), document: current.document, identity: current.historyIdentity, appearance: current.appearance, hash: await io.projectContentHashV5(current), snapshotHash: snapshot.contentHash, assetHashes: Object.keys(current.assets).sort(), licenseHashes: Object.keys(current.licenses).sort(), bindings: current.licenseBindings, pixels, bytes: bytes.length }
  })
  const context = await browser.newContext()
  try {
    const fresh = await context.newPage(); await fresh.goto('/')
    await fresh.evaluate(async () => { const ioPath = '/src/io/v5/project-file.ts', renderPath = '/src/render/v3/renderer.ts'; Reflect.set(window, '__c3Offline', { io: await import(ioPath), render: await import(renderPath) }) })
    await context.setOffline(true)
    const reopened = await fresh.evaluate(async packed => {
      const { io, render } = Reflect.get(window, '__c3Offline') as { io: typeof import('../src/io/v5/project-file'); render: typeof import('../src/render/v3/renderer') }
      const archive = await io.importHistoryArchiveV5(new Blob([Uint8Array.from(atob(packed.data), value => value.charCodeAt(0))])), project = archive.project, pixels: Record<string, string> = {}
      for (const audience of ['gm', 'player'] as const) { const canvas = await render.renderProjectV3(io.toCompleteProjectV3(project), { audience, longEdgePx: 800 }); pixels[audience] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.buffer))].map(n => n.toString(16).padStart(2, '0')).join(''); canvas.width = canvas.height = 0 }
      return { document: project.document, identity: project.historyIdentity, appearance: project.appearance, hash: await io.projectContentHashV5(project), snapshotHash: archive.snapshots[0].contentHash, snapshotCount: archive.snapshots.length, assetHashes: Object.keys(project.assets).sort(), licenseHashes: Object.keys(project.licenses).sort(), bindings: project.licenseBindings, pixels, localOriginalAbsent: !project.migrationSource }
    }, packed)
    for (const key of ['document', 'identity', 'appearance', 'hash', 'snapshotHash', 'assetHashes', 'licenseHashes', 'bindings', 'pixels'] as const) expect(reopened[key]).toEqual(packed[key])
    expect(reopened.snapshotCount).toBe(1); expect(reopened.localOriginalAbsent).toBe(true); expect(reopened.pixels.gm).not.toBe(reopened.pixels.player)
    const { data: _data, document: _document, identity: _identity, appearance: _appearance, ...summary } = packed
    await evidence(info, 'c3-offline-selected-history.json', { method: 'Fresh browser context; code loaded before network is disabled; all source and derived bitmaps and license bytes come from the selected-history package.', ...summary, snapshotCount: reopened.snapshotCount })
  } finally { await context.close() }
})

test('C3 resource failure and cancellation during actual native decode leave the source candidate unchanged', async ({ page }, info) => {
  test.setTimeout(120_000); await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c3-fixtures.ts', preparePath = '/src/io/v5/prepare.ts', ioPath = '/src/io/v5/project-file.ts'
    const { createC3ProjectV5 } = await import(fixturePath) as typeof import('./c3-fixtures'), { prepareCompositionCommandsV5 } = await import(preparePath) as typeof import('../src/io/v5/prepare')
    const { projectContentHashV5 } = await import(ioPath) as typeof import('../src/io/v5/project-file')
    const source = await createC3ProjectV5(), before = await projectContentHashV5(source), broken = structuredClone(source)
    delete broken.assets[Object.keys(broken.assets)[0]]
    const commands = [{ type: 'setAppearanceAdjustment' as const, scope: { kind: 'targets' as const, ids: ['c3-left'] }, adjustment: { id: 'brightness', kind: 'brightness' as const, value: .5, enabled: true } }]
    let failure = '', cancellation = '', closed = 0, release!: () => void, entered!: () => void
    try { await prepareCompositionCommandsV5(broken, commands) } catch (error) { failure = String(error) }
    const controller = new AbortController(), nativeDecode = window.createImageBitmap.bind(window), started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const bitmap = await Reflect.apply(nativeDecode, window, args) as ImageBitmap, close = bitmap.close.bind(bitmap)
      bitmap.close = () => { closed++; close() }; entered(); await gate; return bitmap
    }) as typeof createImageBitmap
    try {
      const pending = prepareCompositionCommandsV5(source, commands, { signal: controller.signal }).catch(error => { cancellation = error instanceof DOMException ? error.name : String(error) })
      await started; controller.abort(); release(); await pending
    } finally { release(); window.createImageBitmap = nativeDecode }
    return { failure, cancellation, nativeBitmapsClosed: closed, unchanged: before === await projectContentHashV5(source), unchangedRevision: source.document.revision, variants: Object.keys(source.appearance.variants).length }
  })
  expect(report.failure).toContain('依赖缺失'); expect(report.cancellation).toBe('AbortError'); expect(report.nativeBitmapsClosed).toBeGreaterThan(0)
  expect(report.unchanged).toBe(true); expect(report.variants).toBe(0)
  await evidence(info, 'c3-resource-failure-cancel.json', { method: 'Native createImageBitmap completes, then its completion is held to cancel an actual asynchronous preparation; the real bitmap is still released.', ...report })
})
