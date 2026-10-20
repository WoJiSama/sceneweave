import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

async function attachEvidence(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  const path = testInfo.outputPath(name)
  await writeFile(path, JSON.stringify(value, null, 2))
  await testInfo.attach(name, { path, contentType: 'application/json' })
}

async function deleteDatabase(page: Page, name: string): Promise<void> {
  await page.evaluate(async databaseName => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Resource test database cleanup was blocked.'))
    })
  }, name)
}

test('real browser normalizes static PNG/JPEG/WebP to sRGB PNG and preserves alpha', async ({ page, browser }, testInfo) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const resourcePath = '/src/io/v2/resources.ts', limitsPath = '/src/io/v2/limits.ts'
    const { normalizeImageAsset, validateImageAssetRecord, sha256Bytes, inspectImageBytes } = await import(resourcePath) as typeof import('../src/io/v2/resources')
    const { crc32 } = await import(limitsPath) as typeof import('../src/io/v2/limits')
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 24
    const context = canvas.getContext('2d', { colorSpace: 'srgb' })!
    context.fillStyle = '#c49a6a'; context.fillRect(4, 4, 32, 16)
    context.fillStyle = '#345b73'; context.fillRect(8, 8, 8, 8)
    const encode = async (mime: string) => new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Canvas encoding failed.')), mime, 0.9))
    const results = []
    for (const mimeType of ['image/png', 'image/jpeg', 'image/webp']) {
      const source = await encode(mimeType)
      if (source.type !== mimeType) throw new Error(`Browser failed to encode required format: ${mimeType}`)
      const adopted = await normalizeImageAsset(source)
      await validateImageAssetRecord(adopted)
      const bitmap = await createImageBitmap(adopted.blob)
      const probe = document.createElement('canvas'); probe.width = bitmap.width; probe.height = bitmap.height
      const probeContext = probe.getContext('2d', { willReadFrequently: true })!
      probeContext.drawImage(bitmap, 0, 0)
      const cornerAlpha = probeContext.getImageData(0, 0, 1, 1).data[3]
      const width = bitmap.width, height = bitmap.height
      bitmap.close(); probe.width = 0; probe.height = 0
      const bytes = new Uint8Array(await adopted.blob.arrayBuffer())
      const view = new DataView(bytes.buffer), chunkTypes: string[] = []
      for (let cursor = 8; cursor < bytes.length;) {
        const length = view.getUint32(cursor)
        chunkTypes.push(String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8)))
        cursor += length + 12
      }
      results.push({ sourceMimeType: source.type, sourceBytes: source.size, adoptedMimeType: adopted.mimeType, adoptedBytes: adopted.sizeBytes,
        actualHashMatches: await sha256Bytes(bytes) === adopted.sha256, width, height, cornerAlpha, chunkTypes })
    }
    // Inject a well-formed source metadata block; real normalization must remove it.
    const png = new Uint8Array(await (await encode('image/png')).arrayBuffer())
    const metadata = new TextEncoder().encode('Comment\0resource-normalization-marker')
    const chunk = new Uint8Array(metadata.length + 12), chunkView = new DataView(chunk.buffer)
    chunkView.setUint32(0, metadata.length); chunk.set(new TextEncoder().encode('tEXt'), 4); chunk.set(metadata, 8)
    chunkView.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)))
    const withMetadata = new Uint8Array(png.length + chunk.length)
    withMetadata.set(png.subarray(0, 33)); withMetadata.set(chunk, 33); withMetadata.set(png.subarray(33), 33 + chunk.length)
    let completePackageMetadataError = ''
    try { inspectImageBytes(withMetadata) } catch (error) { completePackageMetadataError = (error as Error).message }
    const clean = await normalizeImageAsset(new Blob([withMetadata], { type: 'image/png' }))
    const adoptedText = new TextDecoder().decode(await clean.blob.arrayBuffer())
    canvas.width = 0; canvas.height = 0
    return { results, completePackageMetadataError, sourceMetadataRemoved: !adoptedText.includes('resource-normalization-marker'), userAgent: navigator.userAgent }
  })
  for (const item of result.results) {
    expect(item.adoptedMimeType).toBe('image/png')
    expect(item.actualHashMatches).toBe(true)
    expect({ width: item.width, height: item.height }).toEqual({ width: 40, height: 24 })
    expect(item.chunkTypes).toContain('sRGB')
    expect(item.chunkTypes.every(type => ['IHDR', 'sRGB', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type))).toBe(true)
    expect(item.cornerAlpha).toBe(item.sourceMimeType === 'image/jpeg' ? 255 : 0)
  }
  expect(result.completePackageMetadataError).toContain('元数据')
  expect(result.sourceMetadataRemoved).toBe(true)
  await attachEvidence(testInfo, 'm1-b1-static-image-normalization.json', { browserVersion: browser.version(), ...result })
})

test('complete v2 resources roundtrip through ZIP and a new IndexedDB after page reload', async ({ page, browser }, testInfo) => {
  const databaseName = `sceneweave-m1-resource-roundtrip-${crypto.randomUUID()}`
  await page.goto('/')
  try {
    const initial = await page.evaluate(async name => {
      const calibrationPath = '/src/editor/v2/calibration.ts', packagePath = '/src/io/v2/project-file.ts', storagePath = '/src/io/v2/storage.ts', workspacePath = '/src/editor/v2/workspace.ts', resourcePath = '/src/io/v2/resources.ts'
      const [{ createCalibrationProject }, { exportProjectV2, importProjectV2 }, { SceneRepositoryV2 }, { forkProjectV2 }, { sha256Bytes }] = await Promise.all([
        import(calibrationPath) as Promise<typeof import('../src/editor/v2/calibration')>, import(packagePath) as Promise<typeof import('../src/io/v2/project-file')>,
        import(storagePath) as Promise<typeof import('../src/io/v2/storage')>, import(workspacePath) as Promise<typeof import('../src/editor/v2/workspace')>, import(resourcePath) as Promise<typeof import('../src/io/v2/resources')>,
      ])
      const project = await createCalibrationProject(); project.document.revision = 9
      project.document.notes['n-resource-private'] = { id: 'n-resource-private', floorId: 'f-a1', editLocked: false, anchor: { type: 'point', positionMm: { x: 5000, y: 3500 } }, kind: 'clue', text: 'B1-private-resource-roundtrip', visibility: 'gm' }
      const encoded = await exportProjectV2(project), imported = await importProjectV2(encoded)
      const sourceIdentityRetained = imported.document.sceneId === project.document.sceneId && imported.document.revision === 9
      const candidate = forkProjectV2(imported)
      const repo = new SceneRepositoryV2(name)
      try {
        const beforeCount = (await repo.list()).length
        await repo.save(candidate, null)
        const hashes = []
        for (const [hash, record] of Object.entries(candidate.assets)) hashes.push({ hash, actualHash: await sha256Bytes(new Uint8Array(await record.blob.arrayBuffer())), width: record.pixelWidth, height: record.pixelHeight, bytes: record.sizeBytes, mimeType: record.mimeType })
        return { sceneId: candidate.document.sceneId, sourceSceneId: project.document.sceneId, sourceIdentityRetained, sourceDocument: project.document, importedDocument: imported.document, beforeCount,
          forked: candidate.document.sceneId !== project.document.sceneId && candidate.document.revision === 0, expectedDocument: candidate.document,
          expectedBindings: candidate.licenseBindings, expectedLicenses: candidate.licenses, hashes, packageBytes: encoded.size, packageMimeType: encoded.type }
      } finally { repo.close() }
    }, databaseName)
    await page.reload()
    const restored = await page.evaluate(async ({ name, sceneId }) => {
      const storagePath = '/src/io/v2/storage.ts', resourcePath = '/src/io/v2/resources.ts'
      const [{ SceneRepositoryV2 }, { sha256Bytes, validateImageAssetRecord }] = await Promise.all([import(storagePath) as Promise<typeof import('../src/io/v2/storage')>, import(resourcePath) as Promise<typeof import('../src/io/v2/resources')>])
      const repo = new SceneRepositoryV2(name)
      try {
        const project = await repo.load(sceneId)
        if (!project) throw new Error('Missing resource project after reload.')
        const hashes = []
        for (const [hash, record] of Object.entries(project.assets)) {
          await validateImageAssetRecord(record)
          hashes.push({ hash, actualHash: await sha256Bytes(new Uint8Array(await record.blob.arrayBuffer())), width: record.pixelWidth, height: record.pixelHeight, bytes: record.sizeBytes, mimeType: record.mimeType })
        }
        return { document: project.document, bindings: project.licenseBindings, licenses: project.licenses, hashes, snapshots: await repo.listSnapshots(sceneId), sceneCount: (await repo.list()).length, userAgent: navigator.userAgent }
      } finally { repo.close() }
    }, { name: databaseName, sceneId: initial.sceneId })
    expect(initial.beforeCount).toBe(0)
    expect(initial.sourceIdentityRetained).toBe(true)
    expect(initial.importedDocument).toEqual(initial.sourceDocument)
    expect(initial.forked).toBe(true)
    expect(restored.document).toEqual(initial.expectedDocument)
    expect(restored.bindings).toEqual(initial.expectedBindings)
    expect(restored.licenses).toEqual(initial.expectedLicenses)
    expect(restored.hashes).toEqual(initial.hashes)
    expect(restored.hashes).toHaveLength(3)
    expect(restored.hashes.every(item => item.hash === item.actualHash)).toBe(true)
    expect(restored.document.notes['n-resource-private'].text).toBe('B1-private-resource-roundtrip')
    expect(restored.sceneCount).toBe(1)
    expect(restored.snapshots.map(item => item.revision)).toEqual([0])
    await attachEvidence(testInfo, 'm1-b1-complete-resource-roundtrip.json', { browserVersion: browser.version(), userAgent: restored.userAgent, newDatabaseInitiallyEmpty: true, sourceIdentityRetainedByParser: true, forkedBeforeSave: true,
      packageBytes: initial.packageBytes, packageMimeType: initial.packageMimeType, resourceCount: restored.hashes.length, resources: restored.hashes, fullDocumentEqual: true, licensesAndBindingsEqual: true,
      privateNotePreserved: true, pageReloaded: true, snapshotRevisions: restored.snapshots.map(item => item.revision) })
  } finally { await deleteDatabase(page, databaseName) }
})

test('resource/hash/license failures and cancellation leave the persisted revision intact', async ({ page, browser }, testInfo) => {
  const databaseName = `sceneweave-m1-resource-faults-${crypto.randomUUID()}`
  await page.goto('/')
  try {
    const result = await page.evaluate(async name => {
      const calibrationPath = '/src/editor/v2/calibration.ts', packagePath = '/src/io/v2/project-file.ts', storagePath = '/src/io/v2/storage.ts', limitsPath = '/src/io/v2/limits.ts'
      const [{ createCalibrationProject }, { exportProjectV2, importProjectV2 }, { SceneRepositoryV2 }, { crc32 }] = await Promise.all([
        import(calibrationPath) as Promise<typeof import('../src/editor/v2/calibration')>, import(packagePath) as Promise<typeof import('../src/io/v2/project-file')>, import(storagePath) as Promise<typeof import('../src/io/v2/storage')>,
        import(limitsPath) as Promise<typeof import('../src/io/v2/limits')>,
      ])
      const project = await createCalibrationProject(), repo = new SceneRepositoryV2(name)
      const originalDocument = JSON.stringify(project.document), originalHashList = Object.keys(project.assets).sort()
      const errors: { case: string; name: string; message: string }[] = []
      const reject = async (label: string, action: () => Promise<unknown>) => {
        try { await action(); throw new Error(`Expected ${label} to reject.`) }
        catch (error) {
          const failure = error as Error
          if (failure.message.startsWith('Expected ')) throw error
          errors.push({ case: label, name: failure.name, message: failure.message })
        }
      }
      try {
        await repo.save(project, null)
        const missing = structuredClone(project); missing.document.revision = 1; delete missing.assets[originalHashList[0]]
        await reject('missing bitmap', () => repo.save(missing, 0))
        const badHash = structuredClone(project); badHash.document.revision = 1
        const hash = originalHashList[0], bytes = new Uint8Array(await badHash.assets[hash].blob.arrayBuffer())
        // Change a legal sRGB rendering intent and recompute its CRC; only the actual SHA differs.
        const imageView = new DataView(bytes.buffer)
        for (let offset = 8; offset < bytes.length;) {
          const length = imageView.getUint32(offset)
          if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'sRGB') {
            bytes[offset + 8] = 1
            imageView.setUint32(offset + 8 + length, crc32(bytes.subarray(offset + 4, offset + 8 + length)))
            break
          }
          offset += length + 12
        }
        badHash.assets[hash].blob = new Blob([bytes], { type: 'image/png' })
        await reject('mismatched bitmap/hash', () => repo.save(badHash, 0))
        const missingLicense = structuredClone(project); missingLicense.document.revision = 1; missingLicense.licenseBindings.pop()
        await reject('missing license binding', () => repo.save(missingLicense, 0))
        const controller = new AbortController(); controller.abort()
        const newer = structuredClone(project); newer.document.revision = 1
        await reject('cancelled save', () => repo.save(newer, 0, { signal: controller.signal }))
        const packageFile = await exportProjectV2(project)
        await reject('cancelled import', () => importProjectV2(packageFile, { signal: controller.signal }))
        // Corrupt a stored ZIP payload; actual CRC/hash verification must reject it.
        const packed = new Uint8Array(await packageFile.arrayBuffer()), view = new DataView(packed.buffer)
        const payload = 30 + view.getUint16(26, true) + view.getUint16(28, true); packed[payload] ^= 255
        await reject('damaged complete package', () => importProjectV2(new Blob([packed])))
        const stored = await repo.load(project.document.sceneId)
        return { errors, memoryDocumentUnchanged: JSON.stringify(project.document) === originalDocument, persistedDocumentUnchanged: JSON.stringify(stored?.document) === originalDocument,
          persistentResourceHashesUnchanged: JSON.stringify(Object.keys(stored?.assets ?? {}).sort()) === JSON.stringify(originalHashList), sceneCount: (await repo.list()).length,
          snapshotRevisions: (await repo.listSnapshots(project.document.sceneId)).map(item => item.revision), originalImageBytesRead: bytes.length, userAgent: navigator.userAgent }
      } finally { repo.close() }
    }, databaseName)
    expect(result.errors).toHaveLength(6)
    expect(result.errors.find(error => error.case === 'mismatched bitmap/hash')?.message).toContain('SHA-256')
    expect(result.errors.find(error => error.case === 'cancelled save')?.name).toBe('AbortError')
    expect(result.errors.find(error => error.case === 'cancelled import')?.name).toBe('AbortError')
    expect(result.memoryDocumentUnchanged).toBe(true)
    expect(result.persistedDocumentUnchanged).toBe(true)
    expect(result.persistentResourceHashesUnchanged).toBe(true)
    expect(result.sceneCount).toBe(1)
    expect(result.snapshotRevisions).toEqual([0])
    await attachEvidence(testInfo, 'm1-b1-resource-failure-preservation.json', { browserVersion: browser.version(), ...result })
  } finally { await deleteDatabase(page, databaseName) }
})
