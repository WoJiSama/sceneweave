import { expect, test, type TestInfo } from '@playwright/test'

async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}

test('C5 owned resource reuse skips only internal unchanged bytes while public and replaced inputs decode again', async ({ page }, info) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/src/io/v6/test-fixtures.ts', ioPath = '/src/io/v6/project-file.ts'
    const { imageProject } = await import(fixturePath) as typeof import('../src/io/v6/test-fixtures')
    const { captureValidatedProjectV6, validateCompleteProjectV6 } = await import(ioPath) as typeof import('../src/io/v6/project-file')
    const input = await imageProject(), native = window.createImageBitmap
    let decoded = 0, closed = 0
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      const bitmap = await native(source, options), close = bitmap.close.bind(bitmap)
      decoded++; bitmap.close = () => { closed++; close() }; return bitmap
    }) as typeof createImageBitmap
    try {
      const owned = await captureValidatedProjectV6(input), initialDecodes = decoded
      const again = await captureValidatedProjectV6(owned), reusedDecodes = decoded - initialDecodes
      let cursor = decoded
      await validateCompleteProjectV6(owned)
      const publicDecodes = decoded - cursor; cursor = decoded
      const external = structuredClone(owned); Object.freeze(external.assets); Object.freeze(external.licenses); Object.freeze(external.licenseBindings)
      await captureValidatedProjectV6(external)
      const cloneDecodes = decoded - cursor; cursor = decoded
      const hash = Object.keys(owned.assets)[0], replacement = { ...owned, assets: { ...owned.assets, [hash]: { ...owned.assets[hash] } } }
      const recaptured = await captureValidatedProjectV6(replacement)
      const replacedRecordDecodes = decoded - cursor
      const mixedBindings = { ...owned, licenseBindings: [...owned.licenseBindings] }
      cursor = decoded; await captureValidatedProjectV6(mixedBindings)
      const mixedDecodes = decoded - cursor
      const invalid = structuredClone(owned)
      const bytes = new Uint8Array(await invalid.assets[hash].blob.arrayBuffer()); bytes[bytes.length - 1] ^= 1
      invalid.assets[hash].blob = new Blob([bytes.buffer], { type: 'image/png' })
      let invalidError = ''
      try { await captureValidatedProjectV6(invalid) } catch (error) { invalidError = String(error) }
      const originalBlob = owned.assets[hash].blob
      const frozen = [owned.assets, owned.assets[hash], originalBlob, owned.licenses, Object.values(owned.licenses)[0], owned.licenseBindings, owned.licenseBindings[0]].every(Object.isFrozen)
      const methodOverrideAllowed = Reflect.defineProperty(originalBlob, 'arrayBuffer', { value: async () => new ArrayBuffer(0) })
      const sizeOverrideAllowed = Reflect.defineProperty(originalBlob, 'size', { value: 0 })
      return { initialDecodes, reusedDecodes, publicDecodes, cloneDecodes, replacedRecordDecodes, mixedDecodes, invalidError, decoded, closed, frozen, methodOverrideAllowed, sizeOverrideAllowed,
        capturedDetached: owned.assets !== input.assets && originalBlob !== input.assets[hash].blob,
        exactClosureReused: again.assets === owned.assets && again.licenses === owned.licenses && again.licenseBindings === owned.licenseBindings,
        changedClosureDetached: recaptured.assets !== replacement.assets && recaptured.licenses !== owned.licenses && recaptured.licenseBindings !== owned.licenseBindings }
    } finally { window.createImageBitmap = native }
  })
  expect(report.initialDecodes).toBe(1); expect(report.reusedDecodes).toBe(0)
  expect(report.publicDecodes).toBe(1); expect(report.cloneDecodes).toBe(1); expect(report.replacedRecordDecodes).toBe(1); expect(report.mixedDecodes).toBe(1)
  expect(report.invalidError).not.toBe(''); expect(report.decoded).toBe(report.closed)
  expect(report.frozen).toBe(true); expect(report.methodOverrideAllowed).toBe(false); expect(report.sizeOverrideAllowed).toBe(false)
  expect(report.capturedDetached).toBe(true); expect(report.exactClosureReused).toBe(true); expect(report.changedClosureDetached).toBe(true)
  await evidence(info, 'c5-resource-closure-decode-boundaries.json', { method: 'Native Chromium createImageBitmap/close counted around real PNG validation. Only exact private validator-owned resource closure reuses byte proof; no decoder stub.', ...report })
})

test('C5 reused resource proof still verifies actual source and derived pixels on every internal candidate', async ({ page }, info) => {
  test.setTimeout(120_000); await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c3-fixtures.ts', graphPath = '/src/core/v6/graph.ts', preparePath = '/src/io/v6/prepare.ts', ioPath = '/src/io/v6/project-file.ts', resourcesPath = '/src/io/v6/resources.ts'
    const { createC3ProjectV5 } = await import(fixturePath) as typeof import('./c3-fixtures')
    const { createCompositionContentV6 } = await import(graphPath) as typeof import('../src/core/v6/graph')
    const { prepareCompositionCommandsV6 } = await import(preparePath) as typeof import('../src/io/v6/prepare')
    const { captureValidatedProjectV6 } = await import(ioPath) as typeof import('../src/io/v6/project-file')
    const { normalizeImageAsset, sha256Bytes, readBitmapPixelsV6 } = await import(resourcesPath) as typeof import('../src/io/v6/resources')
    const v5 = await createC3ProjectV5(), input = { ...createCompositionContentV6(v5.document), assets: v5.assets, licenses: v5.licenses, licenseBindings: v5.licenseBindings }
    const derived = await prepareCompositionCommandsV6(input, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustment: { id: 'c5-brightness', kind: 'brightness', value: .5, enabled: true } }])
    const variant = Object.values(derived.appearance.variants)[0], native = window.createImageBitmap
    let decoded = 0, closed = 0
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      const bitmap = await native(source, options), close = bitmap.close.bind(bitmap)
      decoded++; bitmap.close = () => { closed++; close() }; return bitmap
    }) as typeof createImageBitmap
    let firstDecodes = 0, secondDecodes = 0, sameResources = false, swappedError = '', parameterError = '', maliciousError = '', maliciousHashValid = false
    try {
      const first = await captureValidatedProjectV6(derived); firstDecodes = decoded
      const second = await captureValidatedProjectV6(first); secondDecodes = decoded - firstDecodes
      sameResources = first.assets === derived.assets && second.assets === derived.assets && second.licenses === derived.licenses && second.licenseBindings === derived.licenseBindings

      // Both byte records retain their real hashes and the exact certified resource
      // closure. Swapping document references must still fail the pixel relation.
      const swapped = { ...derived, document: structuredClone(derived.document) }
      const sourceRef = swapped.document.assets[variant.sourceAssetId], outputRef = swapped.document.assets[variant.outputAssetId]
      const sourceHash = sourceRef.sha256; sourceRef.sha256 = outputRef.sha256; outputRef.sha256 = sourceHash
      try { await captureValidatedProjectV6(swapped) } catch (error) { swappedError = String(error) }

      const changedParameter = { ...derived, appearance: structuredClone(derived.appearance) }
      changedParameter.appearance.variants[variant.id].brightness = .75
      try { await captureValidatedProjectV6(changedParameter) } catch (error) { parameterError = String(error) }

      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
      const context = canvas.getContext('2d')!; context.fillStyle = '#EE00FF'; context.fillRect(0, 0, 8, 8)
      const file = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Fixture encode failed'))))
      canvas.width = canvas.height = 0
      const malicious = await normalizeImageAsset(file), replaced = structuredClone(derived), output = replaced.document.assets[variant.outputAssetId], priorHash = output.sha256
      output.sha256 = malicious.sha256; replaced.assets[malicious.sha256] = malicious; delete replaced.assets[priorHash]
      maliciousHashValid = await sha256Bytes(new Uint8Array(await malicious.blob.arrayBuffer())) === malicious.sha256
      try { await captureValidatedProjectV6(replaced) } catch (error) { maliciousError = String(error) }
    } finally { window.createImageBitmap = native }
    const source = await readBitmapPixelsV6(derived.assets[derived.document.assets[variant.sourceAssetId].sha256])
    const output = await readBitmapPixelsV6(derived.assets[derived.document.assets[variant.outputAssetId].sha256])
    return { firstDecodes, secondDecodes, sameResources, decoded, closed, swappedError, parameterError, maliciousError, maliciousHashValid,
      sourcePixel: Array.from(source.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)), derivedPixel: Array.from(output.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)) }
  })
  expect(report.firstDecodes).toBe(2); expect(report.secondDecodes).toBe(2); expect(report.sameResources).toBe(true)
  expect(report.sourcePixel).toEqual([200, 100, 50, 255]); expect(report.derivedPixel).toEqual([100, 50, 25, 255])
  expect(report.swappedError).toContain('真实像素'); expect(report.parameterError).toContain('固定派生位图参数')
  expect(report.maliciousHashValid).toBe(true); expect(report.maliciousError).toContain('真实像素'); expect(report.decoded).toBe(report.closed)
  await evidence(info, 'c5-resource-reuse-variant-pixels.json', { method: 'Real Canvas source and brightness output. Repeated internal validation decodes source/output each time; exact certified resources cannot legitimize a swapped pixel relation or a new valid hash with incorrect output pixels.', ...report })
})

test('C5 real workspace preserves owned closure and original bytes through preview edit undo redo save and reopen', async ({ page }, info) => {
  test.setTimeout(120_000); await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c3-fixtures.ts', migrationPath = '/src/io/v6/migration.ts', v5ioPath = '/src/io/v5/project-file.ts', ioPath = '/src/io/v6/project-file.ts', storagePath = '/src/io/v6/storage.ts', workspacePath = '/src/editor/v6/workspace.ts'
    const { createC3ProjectV5 } = await import(fixturePath) as typeof import('./c3-fixtures')
    const { migrateProjectV5ToV6 } = await import(migrationPath) as typeof import('../src/io/v6/migration')
    const { exportProjectV5 } = await import(v5ioPath) as typeof import('../src/io/v5/project-file')
    const { hashValidatedProjectV6 } = await import(ioPath) as typeof import('../src/io/v6/project-file')
    const { SceneRepositoryV6 } = await import(storagePath) as typeof import('../src/io/v6/storage')
    const { WorkspaceV6 } = await import(workspacePath) as typeof import('../src/editor/v6/workspace')
    const v5 = await createC3ProjectV5(), original = await exportProjectV5(v5)
    const source = await migrateProjectV5ToV6(v5, { original }), dbName = `c5-owned-resource-workspace-${crypto.randomUUID()}`
    let repository = new SceneRepositoryV6(dbName)
    const workspace = new WorkspaceV6(repository)
    try {
      await workspace.adoptNew(source)
      const installed = workspace.getState().project!, start = installed.document.props['c3-left'].positionMm, revisions = [installed.document.revision]
      const preview = await workspace.preview([{ type: 'updateProp', id: 'c3-left', changes: { positionMm: { x: start.x + 100, y: start.y } } }])
      const beforeAdoptUnchanged = workspace.getState().project === installed
      const previewClosureShared = preview.project.assets === installed.assets && preview.project.licenses === installed.licenses && preview.project.licenseBindings === installed.licenseBindings && preview.project.migrationSource === installed.migrationSource
      const blob = Object.values(preview.project.assets)[0].blob
      const previewBlobOverrideAllowed = Reflect.defineProperty(blob, 'arrayBuffer', { value: async () => new ArrayBuffer(0) })
      const originalOverrideAllowed = Reflect.defineProperty(preview.project.migrationSource!.original, 'arrayBuffer', { value: async () => new ArrayBuffer(0) })
      await workspace.adoptPreview(preview); const adopted = workspace.getState().project!; revisions.push(adopted.document.revision)
      await workspace.updateProp('c3-left', { positionMm: { x: start.x + 200, y: start.y } }); const edited = workspace.getState().project!; revisions.push(edited.document.revision)
      workspace.undo(); const undone = workspace.getState().project!; revisions.push(undone.document.revision)
      workspace.redo(); const redone = workspace.getState().project!; revisions.push(redone.document.revision)
      await workspace.flush()
      const ownedClosureShared = [adopted, edited, undone, redone].every(project => project.assets === installed.assets && project.licenses === installed.licenses && project.licenseBindings === installed.licenseBindings && project.migrationSource === installed.migrationSource)
      const inMemoryOriginal = new Uint8Array(await redone.migrationSource!.original.arrayBuffer()), originalBytes = new Uint8Array(await original.arrayBuffer())
      repository.close(); repository = new SceneRepositoryV6(dbName)
      const persisted = (await repository.load(source.document.sceneId))!, reopened = new WorkspaceV6(repository)
      await reopened.openPersisted(persisted)
      const loaded = reopened.getState().project!, persistedOriginal = new Uint8Array(await loaded.migrationSource!.original.arrayBuffer())
      return { revisions, beforeAdoptUnchanged, previewClosureShared, ownedClosureShared, previewBlobOverrideAllowed, originalOverrideAllowed,
        positions: [adopted, edited, undone, redone, loaded].map(project => project.document.props['c3-left'].positionMm.x - start.x),
        reopenedRevision: loaded.document.revision, saved: workspace.getState().status,
        originalBytesMatch: originalBytes.length === inMemoryOriginal.length && originalBytes.every((value, index) => value === inMemoryOriginal[index]),
        reopenedOriginalBytesMatch: originalBytes.length === persistedOriginal.length && originalBytes.every((value, index) => value === persistedOriginal[index]),
        contentHashMatch: await hashValidatedProjectV6(redone) === await hashValidatedProjectV6(loaded),
        reopenedResourcesDetached: loaded.assets !== redone.assets && loaded.licenses !== redone.licenses && loaded.licenseBindings !== redone.licenseBindings }
    } finally {
      await workspace.flush().catch(() => {})
      repository.close()
      await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(dbName); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Test database remained open')) })
    }
  })
  expect(report.revisions).toEqual([0, 1, 2, 3, 4]); expect(report.reopenedRevision).toBe(4); expect(report.saved).toBe('saved')
  expect(report.positions).toEqual([100, 200, 100, 200, 200]); expect(report.beforeAdoptUnchanged).toBe(true)
  expect(report.previewClosureShared).toBe(true); expect(report.ownedClosureShared).toBe(true)
  expect(report.previewBlobOverrideAllowed).toBe(false); expect(report.originalOverrideAllowed).toBe(false)
  expect(report.originalBytesMatch).toBe(true); expect(report.reopenedOriginalBytesMatch).toBe(true)
  expect(report.contentHashMatch).toBe(true); expect(report.reopenedResourcesDetached).toBe(true)
  await evidence(info, 'c5-owned-workspace-persistence.json', { method: 'Actual V6 Workspace, strict V5 original, real Chromium image decode and native IndexedDB. Ordinary edit candidates share the owned closure, while repository reopen returns detached resources with identical full content and original bytes.', ...report })
})
