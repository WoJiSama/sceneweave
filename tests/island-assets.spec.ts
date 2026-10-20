import { expect, test } from '@playwright/test'

test('VIS-02 Chrome decodes all original images and opens the full project offline in a fresh context', async ({ page, browser }) => {
  await page.goto('/')
  const original = await page.evaluate(async () => {
    const samplePath = '/src/editor/v2/island-sample.ts', ioPath = '/src/io/v2/project-file.ts'
    const { createIslandProject } = await import(/* @vite-ignore */ samplePath)
    const { exportProjectV2 } = await import(/* @vite-ignore */ ioPath)
    const project = await createIslandProject(), dimensions: number[][] = []
    for (const asset of Object.values(project.assets) as { blob: Blob }[]) {
      const bitmap = await createImageBitmap(asset.blob)
      dimensions.push([bitmap.width, bitmap.height]); bitmap.close()
    }
    const bytes = Array.from(new Uint8Array(await (await exportProjectV2(project)).arrayBuffer()))
    return { bytes, scene: project.document, hashes: Object.keys(project.assets).sort(), dimensions }
  })
  expect(original.hashes).toHaveLength(13)
  expect(original.dimensions.filter(dimensions => dimensions[0] === 1152)).toHaveLength(2)
  expect(original.dimensions.filter(dimensions => dimensions[0] === 1024)).toHaveLength(4)
  expect(Object.keys(original.scene.props)).toHaveLength(39)
  const freshContext = await browser.newContext()
  try {
    const fresh = await freshContext.newPage()
    await fresh.goto('/')
    await fresh.evaluate(async () => {
      const ioPath = '/src/io/v2/project-file.ts'
      ;(window as unknown as { __islandImport: unknown }).__islandImport = (await import(/* @vite-ignore */ ioPath)).importProjectV2
    })
    await freshContext.setOffline(true)
    const roundtrip = await fresh.evaluate(async bytes => {
      const importProject = (window as unknown as { __islandImport: (blob: Blob) => Promise<any> }).__islandImport
      const project = await importProject(new Blob([Uint8Array.from(bytes)]))
      let decoded = 0
      for (const asset of Object.values(project.assets) as { blob: Blob }[]) { const bitmap = await createImageBitmap(asset.blob); decoded++; bitmap.close() }
      return { scene: project.document, hashes: Object.keys(project.assets).sort(), decoded, licenses: Object.keys(project.licenses).length, bindings: project.licenseBindings.length }
    }, original.bytes)
    expect(roundtrip.scene).toEqual(original.scene)
    expect(roundtrip.hashes).toEqual(original.hashes)
    expect(roundtrip.decoded).toBe(13)
    expect(roundtrip.licenses).toBe(1)
    expect(roundtrip.bindings).toBe(27) // 13 images + 6 materials + 7 props + 1 theme.
  } finally { await freshContext.close() }
})

test('VIS-02 missing or modified original aborts adoption and an aborted request reads no assets', async ({ page }) => {
  await page.goto('/')
  let fetched = 0
  await page.route('**/assets/sceneweave-handdrawn-outdoor/*.png', async route => {
    fetched++
    await route.fulfill({ status: 404, body: 'missing original outdoor art' })
  })
  const aborted = await page.evaluate(async () => {
    const path = '/src/editor/v2/island-sample.ts', { createIslandProject } = await import(/* @vite-ignore */ path)
    const controller = new AbortController(); controller.abort()
    try { await createIslandProject(controller.signal); return 'unexpected success' } catch (error) { return (error as Error).name }
  })
  expect(aborted).toBe('AbortError'); expect(fetched).toBe(0)
  const missing = await page.evaluate(async () => {
    const path = '/src/editor/v2/island-sample.ts', { createIslandProject } = await import(/* @vite-ignore */ path)
    try { await createIslandProject(); return 'unexpected success' } catch (error) { return (error as Error).message }
  })
  expect(missing).toContain('grass.png (404)'); expect(fetched).toBe(1)
  await page.unroute('**/assets/sceneweave-handdrawn-outdoor/*.png')
  await page.route('**/assets/sceneweave-handdrawn-outdoor/grass.png', async route => {
    const response = await route.fetch(), modified = Buffer.from(await response.body())
    modified[modified.length - 1] ^= 1
    await route.fulfill({ response, body: modified })
  })
  const corrupt = await page.evaluate(async () => {
    const path = '/src/editor/v2/island-sample.ts', { createIslandProject } = await import(/* @vite-ignore */ path)
    try { await createIslandProject(); return 'unexpected success' } catch (error) { return (error as Error).message }
  })
  expect(corrupt).toContain('CRC')
})
