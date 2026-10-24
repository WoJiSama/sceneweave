import { expect, test } from '@playwright/test'

test('M2-4 actual Chromium normalizes bounded SVG and rasterizes it to a verified local PNG', async ({ page }) => {
  await page.goto('/#home')
  const result = await page.evaluate(async () => {
    const svgPath = '/src/shared/ai/svg.ts', rasterPath = '/src/platform/browser/ai/svg-raster.ts'
    const [{ normalizeStaticSvg }, { rasterizeNormalizedSvg }] = await Promise.all([
      import(svgPath) as Promise<typeof import('../src/shared/ai/svg')>, import(rasterPath) as Promise<typeof import('../src/platform/browser/ai/svg-raster')>,
    ])
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><rect x="0" y="0" width="64" height="32" fill="#13579b"/></svg>'
    const normalized = normalizeStaticSvg(source)
    const raster = await rasterizeNormalizedSvg(normalized, { longEdgePx: 64 })
    return { mimeType: raster.mimeType, width: raster.pixelWidth, height: raster.pixelHeight, bytes: raster.pngBytes.byteLength,
      sha256: raster.sha256, normalizedSha256: raster.normalizedSha256, processorId: raster.processorId, processorVersion: raster.processorVersion }
  })
  expect(result).toMatchObject({ mimeType: 'image/png', width: 64, height: 32, processorId: 'sceneweave-static-svg', processorVersion: 1 })
  expect(result.bytes).toBeGreaterThan(40)
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(result.normalizedSha256).toMatch(/^[a-f0-9]{64}$/)
})

test('M2-4 actual SVG pixels, source bytes, cold storage, selected history and map PNG survive local roundtrip', async ({ page }) => {
  await page.goto('/#home')
  const result = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m24-svg-fixtures.ts', resourcePath = '/src/shared/project/resources.ts', ioPath = '/src/shared/project/file.ts'
    const imagePath = '/src/platform/browser/images/index.ts', svgPath = '/src/platform/browser/ai/svg-port.ts', storagePath = '/src/platform/browser/storage/repository.ts'
    const binaryPath = '/src/shared/project/binary.ts', renderPath = '/src/platform/browser/render/renderer.ts'
    const { svgProjectFixture, SVG_FIXTURE_SOURCE } = await import(helperPath) as typeof import('./helpers/m24-svg-fixtures')
    const { validateProjectBundle } = await import(resourcePath) as typeof import('../src/shared/project/resources')
    const io = await import(ioPath) as typeof import('../src/shared/project/file')
    const { createBrowserImagePort } = await import(imagePath) as typeof import('../src/platform/browser/images/index')
    const { createBrowserSvgPort } = await import(svgPath) as typeof import('../src/platform/browser/ai/svg-port')
    const { ProjectRepository } = await import(storagePath) as typeof import('../src/platform/browser/storage/repository')
    const { decodeUtf8 } = await import(binaryPath) as typeof import('../src/shared/project/binary')
    const { exportPng } = await import(renderPath) as typeof import('../src/platform/browser/render/renderer')
    const options = { images: createBrowserImagePort(), svg: createBrowserSvgPort() }, input = svgProjectFixture(), owner = input.bundle.project.document.sceneId
    let ids = 0
    const config = { name: `m24-browser-${crypto.randomUUID()}`, validation: options,
      runtime: { ids: { nextId: () => `svg-real-${++ids}` }, clock: { now: () => '2026-10-24T00:00:00.000Z' } } }
    const repo = new ProjectRepository(config), reopen = new ProjectRepository(config)
    let pixelMismatchRejected = false
    try { await validateProjectBundle(svgProjectFixture(SVG_FIXTURE_SOURCE, [0, 0, 255, 255]).bundle, options) }
    catch (error) { pixelMismatchRejected = String(error).includes('实际栅格像素') }
    try {
      const verified = await validateProjectBundle(input.bundle, options)
      await repo.save(verified, null)
      const snapshot = await repo.createSnapshot(verified, 'SVG source', { expectedRevision: 0, expectedMetadataVersion: 0 })
      repo.close()
      const loaded = (await reopen.load(owner))!, historical = (await reopen.loadSnapshot(owner, snapshot.id))!
      const exported = await io.exportProject(loaded, options), restored = await io.importProject(exported, options)
      const current = { project: structuredClone(loaded.project), resources: loaded.resources }; current.project.document.revision = 1; current.project.authoringSources = {}
      const history = await io.importHistoryArchive(await io.exportHistoryArchive({ current, snapshots: [historical] }, options), options)
      const original = decodeUtf8(await restored.resources.read(input.normalized.sourceSha256))
      const normalized = decodeUtf8(await history.snapshots[0].bundle.resources.read(input.normalized.normalizedSha256))
      let scopeRejected = false
      try { await history.current.resources.read(input.normalized.sourceSha256) } catch { scopeRejected = true }
      const png = await exportPng(restored, { audience: 'gm', longEdgePx: 256 })
      return { originalExact: original === SVG_FIXTURE_SOURCE, normalizedExact: normalized === input.normalized.normalizedSource,
        coldSources: Object.keys(loaded.project.authoringSources).length, sourceBytes: [...input.bytes.keys()].length,
        historySources: Object.keys(history.snapshots[0].bundle.project.authoringSources).length, scopeRejected, pixelMismatchRejected,
        pngType: png.type, pngBytes: png.size }
    } finally { repo.close(); reopen.close(); await reopen.database.delete() }
  })
  expect(result).toMatchObject({ originalExact: true, normalizedExact: true, coldSources: 1, sourceBytes: 3,
    historySources: 1, scopeRejected: true, pixelMismatchRejected: true, pngType: 'image/png' })
  expect(result.pngBytes).toBeGreaterThan(100)
})
