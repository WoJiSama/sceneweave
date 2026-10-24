import { expect, test } from '@playwright/test'

test('M2-0c real PNG/JPEG/WebP and licenses survive native complete-v1 roundtrip and continued atomic editing', async ({ page }) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20c-fixtures.ts', ioPath = '/src/shared/project/file.ts', resourcesPath = '/src/shared/project/resources.ts'
    const browserPath = '/src/platform/browser/images/index.ts', sharedPath = '/src/shared/index.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20c-fixtures')
    const io = await import(ioPath) as typeof import('../src/shared/project/file')
    const resources = await import(resourcesPath) as typeof import('../src/shared/project/resources')
    const { createBrowserImagePort } = await import(browserPath) as typeof import('../src/platform/browser/images/index')
    const shared = await import(sharedPath) as typeof import('../src/shared/index')
    const beforeDatabases = await helper.databaseInventory(), images = createBrowserImagePort(), input = await helper.realImageBundle()
    const inputHash = shared.projectContentHash(input.project), packed = await io.exportProject(input, { images }), restored = await io.importProject(packed, { images })
    await resources.validateProjectBundle(restored, { images })
    const byteReports = await Promise.all(Object.entries(input.project.assets).map(async ([hash, record]) => {
      const original = await input.resources.read(hash), actual = await restored.resources.read(hash)
      const pixels = await images.decode(actual, record)
      const actualHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', actual.slice().buffer)), value => value.toString(16).padStart(2, '0')).join('')
      return { mimeType: record.mimeType, exact: actual.length === original.length && actual.every((value, index) => value === original[index]), hashMatches: actualHash === hash, dimensions: [pixels.width, pixels.height] }
    }))
    let id = 0
    const { document, historyIdentity, appearance } = restored.project, start = document.props['c3-left'].positionMm
    const edited = shared.applyCompositionCommands({ document, historyIdentity, appearance }, [{ type: 'updateProp', id: 'c3-left', changes: { positionMm: { x: start.x + 100, y: start.y } } }],
      { ids: { nextId: () => `m20c-edit-${++id}` }, clock: { now: () => '2026-10-24T08:00:00.000Z' } })
    edited.document.revision = document.revision + 1
    const next = { project: { ...restored.project, ...edited }, resources: restored.resources }
    await resources.validateProjectBundle(next, { images })
    const reopened = await io.importProject(await io.exportProject(next, { images }), { images })
    return { byteReports, inputHash, restoredHash: shared.projectContentHash(restored.project),
      projectExact: shared.canonicalJson(input.project) === shared.canonicalJson(restored.project), licensesExact: shared.canonicalJson(restored.project.licenses) === shared.canonicalJson(input.project.licenses),
      inputUnchanged: shared.projectContentHash(input.project) === inputHash, revision: reopened.project.document.revision, priorRevision: input.project.document.revision,
      position: reopened.project.document.props['c3-left'].positionMm, expectedPosition: { x: start.x + 100, y: start.y },
      identityExact: shared.canonicalJson(reopened.project.historyIdentity) === shared.canonicalJson(input.project.historyIdentity),
      secretStillPresent: reopened.project.document.props['c3-secret'].visibility === 'gm', playerIds: shared.projectScene(reopened.project.document, 'player').props.map(prop => prop.id),
      beforeDatabases, afterDatabases: await helper.databaseInventory() }
  })
  expect(report.byteReports.map(item => item.mimeType).sort()).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  for (const item of report.byteReports) { expect(item.exact).toBe(true); expect(item.hashMatches).toBe(true); expect(item.dimensions).toEqual([8, 8]) }
  expect(report.projectExact).toBe(true); expect(report.licensesExact).toBe(true); expect(report.restoredHash).toBe(report.inputHash)
  expect(report.inputUnchanged).toBe(true); expect(report.revision).toBe(report.priorRevision + 1); expect(report.position).toEqual(report.expectedPosition)
  expect(report.identityExact).toBe(true); expect(report.secretStillPresent).toBe(true); expect(report.playerIds).not.toContain('c3-secret')
  expect(report.afterDatabases).toEqual(report.beforeDatabases)
})

test('M2-0c selected native history preserves separate owner and historical scene IDs with actual independent resources', async ({ page }) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20c-fixtures.ts', ioPath = '/src/shared/project/file.ts', browserPath = '/src/platform/browser/images/index.ts', sharedPath = '/src/shared/index.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20c-fixtures')
    const io = await import(ioPath) as typeof import('../src/shared/project/file')
    const { createBrowserImagePort } = await import(browserPath) as typeof import('../src/platform/browser/images/index')
    const shared = await import(sharedPath) as typeof import('../src/shared/index')
    const beforeDatabases = await helper.databaseInventory(), images = createBrowserImagePort(), original = await helper.realImageBundle()
    original.project.document.revision = 7
    const historicalSceneId = original.project.document.sceneId, currentProject = structuredClone(original.project), ownerSceneId = crypto.randomUUID()
    currentProject.document.sceneId = ownerSceneId; currentProject.document.revision = 0; currentProject.document.title = 'Independent current owner'
    // One real image belongs only to history; the portable union must retain it.
    const historyOnlyAsset = Object.values(currentProject.document.assets).find(asset => asset.mimeType === 'image/webp')!
    const historyOnlyDefinition = Object.values(currentProject.document.propDefinitions).find(definition => definition.defaultAppearance.kind === 'image' && definition.defaultAppearance.assetId === historyOnlyAsset.id)!
    delete currentProject.document.assets[historyOnlyAsset.id]; delete currentProject.document.propDefinitions[historyOnlyDefinition.id]; delete currentProject.assets[historyOnlyAsset.sha256]
    currentProject.licenseBindings = currentProject.licenseBindings.filter(binding => binding.subjectId !== historyOnlyAsset.id && binding.subjectId !== historyOnlyDefinition.id)
    const current = { project: currentProject, resources: original.resources }, historicalHash = shared.projectContentHash(original.project)
    const snapshots = (['named', 'protection'] as const).map((kind, index) => ({ id: `m20c-selected-${index}`, ownerSceneId, lineageId: original.project.historyIdentity.lineageId,
      sourceRevision: 7, name: `Selected ${kind}`, kind, createdAt: '2026-10-24T08:00:00.000Z', contentHash: historicalHash, bundle: original }))
    const input = { current, snapshots }, packed = await io.exportHistoryArchive(input, { images }), restored = await io.importHistoryArchive(packed, { images })
    const independentResources = await Promise.all(restored.snapshots.map(async snapshot => {
      const reports = await Promise.all(Object.keys(snapshot.bundle.project.assets).map(async hash => {
        const expected = await original.resources.read(hash), bytes = await snapshot.bundle.resources.read(hash)
        return bytes.length === expected.length && bytes.every((value, index) => value === expected[index])
      }))
      return reports.every(Boolean)
    }))
    return { currentExact: shared.canonicalJson(restored.current.project) === shared.canonicalJson(currentProject), ownerSceneId, historicalSceneId,
      summaries: restored.snapshots.map(({ bundle, ...summary }) => ({ ...summary, sceneId: bundle.project.document.sceneId, revision: bundle.project.document.revision, rootSceneId: bundle.project.historyIdentity.rootSceneId,
        hashMatches: shared.projectContentHash(bundle.project) === summary.contentHash })), independentResources,
      rootSceneId: original.project.historyIdentity.rootSceneId, currentRootSceneId: restored.current.project.historyIdentity.rootSceneId,
      currentAssetCount: Object.keys(restored.current.project.assets).length, historicalAssetCounts: restored.snapshots.map(snapshot => Object.keys(snapshot.bundle.project.assets).length),
      beforeDatabases, afterDatabases: await helper.databaseInventory() }
  })
  expect(report.currentExact).toBe(true); expect(report.ownerSceneId).not.toBe(report.historicalSceneId)
  expect(report.currentRootSceneId).toBe(report.rootSceneId); expect(report.independentResources).toEqual([true, true])
  expect(report.currentAssetCount).toBe(2); expect(report.historicalAssetCounts).toEqual([3, 3])
  expect(report.summaries.map(item => item.kind)).toEqual(['named', 'protection'])
  for (const snapshot of report.summaries) {
    expect(snapshot.ownerSceneId).toBe(report.ownerSceneId); expect(snapshot.sceneId).toBe(report.historicalSceneId); expect(snapshot.rootSceneId).toBe(report.rootSceneId)
    expect(snapshot.revision).toBe(7); expect(snapshot.sourceRevision).toBe(7); expect(snapshot.hashMatches).toBe(true)
  }
  expect(report.afterDatabases).toEqual(report.beforeDatabases)
})

test('M2-0c native parameter validation checks actual opaque and partial-alpha pixels and rejects hash-correct wrong output', async ({ page }) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20c-fixtures.ts', resourcesPath = '/src/shared/project/resources.ts', browserPath = '/src/platform/browser/images/index.ts', sharedPath = '/src/shared/index.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20c-fixtures')
    const resources = await import(resourcesPath) as typeof import('../src/shared/project/resources')
    const { createBrowserImagePort, normalizeBrowserImage } = await import(browserPath) as typeof import('../src/platform/browser/images/index')
    const shared = await import(sharedPath) as typeof import('../src/shared/index')
    const beforeDatabases = await helper.databaseInventory(), input = await helper.realDerivedBundle(), images = createBrowserImagePort()
    await resources.validateProjectBundle(input, { images })
    const variant = Object.values(input.project.appearance.variants)[0], source = input.project.document.assets[variant.sourceAssetId], output = input.project.document.assets[variant.outputAssetId]
    const sourceRecord = input.project.assets[source.sha256], outputRecord = input.project.assets[output.sha256]
    const sourcePixels = await images.decode(await input.resources.read(source.sha256), sourceRecord)
    const outputPixels = await images.decode(await input.resources.read(output.sha256), outputRecord)
    const transformed = await images.transform(sourcePixels, { tint: variant.tint, brightness: variant.brightness })
    const encoded = await images.encodePng(transformed), record = { ...outputRecord, sizeBytes: encoded.length }
    const replayed = await images.decode(encoded, record)
    const nativeVariant = await resources.deriveBitmapVariant(await input.resources.read(source.sha256), sourceRecord, { tint: variant.tint, brightness: variant.brightness }, { images })
    const nativePixels = await images.decode(nativeVariant.bytes, nativeVariant.record)
    const at = (rgba: Uint8ClampedArray, x: number, y: number) => Array.from(rgba.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4))
    const wrong = await normalizeBrowserImage(await helper.fixtureImage('image/png', '#ee00ff'), 'image/png')
    const wrongActualHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', wrong.bytes.slice().buffer)), value => value.toString(16).padStart(2, '0')).join('')
    const maliciousProject = structuredClone(input.project), priorHash = maliciousProject.document.assets[variant.outputAssetId].sha256
    maliciousProject.document.assets[variant.outputAssetId].sha256 = wrong.record.sha256
    delete maliciousProject.assets[priorHash]; maliciousProject.assets[wrong.record.sha256] = wrong.record
    const bytes = await helper.resourceBytes(input); delete bytes[priorHash]; bytes[wrong.record.sha256] = wrong.bytes
    let wrongOutputError = ''
    try { await resources.validateProjectBundle({ project: maliciousProject, resources: resources.createMemoryResources(bytes) }, { images }) }
    catch (error) { wrongOutputError = String(error) }
    const changedParameter = structuredClone(input.project); changedParameter.appearance.variants[variant.id].brightness = .75
    let parameterError = ''
    try { await resources.validateProjectBundle({ project: changedParameter, resources: input.resources }, { images }) }
    catch (error) { parameterError = String(error) }
    return { sourceOpaque: at(sourcePixels.rgba, 4, 4), sourceAlpha: at(sourcePixels.rgba, 7, 4), outputOpaque: at(outputPixels.rgba, 4, 4), outputAlpha: at(outputPixels.rgba, 7, 4),
      allPixelsEqual: replayed.rgba.length === outputPixels.rgba.length && replayed.rgba.every((value, index) => value === outputPixels.rgba[index]),
      nativeVariantPixelsEqual: nativePixels.rgba.length === outputPixels.rgba.length && nativePixels.rgba.every((value, index) => value === outputPixels.rgba[index]), nativeVariantMime: nativeVariant.record.mimeType,
      changedOutputMetadataAccepted: shared.projectContentHash(maliciousProject).length === 64, wrongHashMatches: wrongActualHash === wrong.record.sha256, wrongOutputError, parameterError,
      beforeDatabases, afterDatabases: await helper.databaseInventory() }
  })
  expect(report.sourceOpaque).toEqual([200, 100, 50, 255]); expect(report.outputOpaque).toEqual([100, 50, 25, 255])
  expect(report.sourceAlpha[3]).toBeGreaterThan(0); expect(report.sourceAlpha[3]).toBeLessThan(255); expect(report.outputAlpha[3]).toBe(report.sourceAlpha[3])
  expect(report.allPixelsEqual).toBe(true); expect(report.changedOutputMetadataAccepted).toBe(true); expect(report.wrongHashMatches).toBe(true)
  expect(report.nativeVariantPixelsEqual).toBe(true); expect(report.nativeVariantMime).toBe('image/png')
  expect(report.wrongOutputError).toMatch(/像素/); expect(report.parameterError).not.toBe('')
  expect(report.afterDatabases).toEqual(report.beforeDatabases)
})

test('M2-0c captures resource bytes, rechecks external ports, closes native bitmaps and recovers from cancellation and decoder failure', async ({ page }) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20c-fixtures.ts', resourcesPath = '/src/shared/project/resources.ts', browserPath = '/src/platform/browser/images/index.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20c-fixtures')
    const resources = await import(resourcesPath) as typeof import('../src/shared/project/resources')
    const { createBrowserImagePort } = await import(browserPath) as typeof import('../src/platform/browser/images/index')
    const beforeDatabases = await helper.databaseInventory(), input = await helper.realImageBundle(), bytes = await helper.resourceBytes(input)
    const hash = Object.keys(bytes)[0], original = bytes[hash].slice(), captured = resources.createMemoryResources(bytes), images = createBrowserImagePort()
    bytes[hash][0] ^= 1
    const firstRead = await captured.read(hash), inputDetached = firstRead.every((value, index) => value === original[index])
    firstRead[0] ^= 1
    const secondRead = await captured.read(hash), outputDetached = secondRead.every((value, index) => value === original[index])
    const externalBytes = await helper.resourceBytes(input), external = { project: input.project, resources: { async read(key: string) { return externalBytes[key] } } }
    const native = window.createImageBitmap
    let opened = 0, closed = 0, cancelNext: AbortController | undefined
    const tracked = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      const bitmap = await native(source, options), close = bitmap.close.bind(bitmap)
      opened++; bitmap.close = () => { closed++; close() }
      if (cancelNext) { cancelNext.abort(); cancelNext = undefined }
      return bitmap
    }) as typeof createImageBitmap
    window.createImageBitmap = tracked
    let mutationError = '', cancellationName = '', decoderError = '', recovered = false
    try {
      await resources.validateProjectBundle({ project: input.project, resources: captured }, { images })
      await resources.validateProjectBundle(external, { images })
      externalBytes[hash][externalBytes[hash].length - 1] ^= 1
      try { await resources.validateProjectBundle(external, { images }) } catch (error) { mutationError = String(error) }
      const controller = new AbortController(); cancelNext = controller
      try { await images.decode(original, input.project.assets[hash], { signal: controller.signal }) } catch (error) { cancellationName = error instanceof Error ? error.name : String(error) }
      window.createImageBitmap = (async () => { throw new Error('Injected native decoder failure') }) as typeof createImageBitmap
      try { await resources.validateProjectBundle(input, { images }) } catch (error) { decoderError = String(error) }
      window.createImageBitmap = tracked
      await resources.validateProjectBundle(input, { images }); recovered = true
    } finally { window.createImageBitmap = native }
    return { inputDetached, outputDetached, mutationError, cancellationName, decoderError, recovered, opened, closed,
      beforeDatabases, afterDatabases: await helper.databaseInventory() }
  })
  expect(report.inputDetached).toBe(true); expect(report.outputDetached).toBe(true); expect(report.mutationError).not.toBe('')
  expect(report.cancellationName).toBe('AbortError'); expect(report.decoderError).toMatch(/解码/); expect(report.recovered).toBe(true)
  expect(report.opened).toBeGreaterThan(0); expect(report.closed).toBe(report.opened); expect(report.afterDatabases).toEqual(report.beforeDatabases)
})
