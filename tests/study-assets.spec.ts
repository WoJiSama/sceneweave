import { expect, test } from '@playwright/test'

test('VIS-01 real Chrome PNG decode and complete package open without asset network or old context', async ({ page, browser }) => {
  await page.goto('/')
  const original = await page.evaluate(async () => {
    const samplePath = '/src/editor/v2/study-sample.ts', ioPath = '/src/io/v2/project-file.ts'
    const { createStudyProject, checkStudyDoorwayClearances } = await import(/* @vite-ignore */ samplePath)
    const { exportProjectV2 } = await import(/* @vite-ignore */ ioPath)
    const project = await createStudyProject()
    const dimensions: number[][] = []
    for (const asset of Object.values(project.assets) as { blob: Blob }[]) {
      const bitmap = await createImageBitmap(asset.blob)
      dimensions.push([bitmap.width, bitmap.height]); bitmap.close()
    }
    const bytes = Array.from(new Uint8Array(await (await exportProjectV2(project)).arrayBuffer()))
    return { bytes, scene: project.document, hashes: Object.keys(project.assets).sort(), dimensions, clearances: checkStudyDoorwayClearances(project.document) }
  })
  expect(original.hashes).toHaveLength(15)
  expect(original.dimensions).toContainEqual([768, 576])
  expect(original.dimensions).toContainEqual([256, 640])
  expect(original.clearances.every((check: { ok: boolean }) => check.ok)).toBe(true)
  const freshContext = await browser.newContext()
  try {
    const fresh = await freshContext.newPage()
    await fresh.goto('/')
    await fresh.evaluate(async () => {
      const ioPath = '/src/io/v2/project-file.ts'
      ;(window as unknown as { __studyImport: unknown }).__studyImport = (await import(/* @vite-ignore */ ioPath)).importProjectV2
    })
    await freshContext.setOffline(true)
    const roundtrip = await fresh.evaluate(async bytes => {
      const importProject = (window as unknown as { __studyImport: (blob: Blob) => Promise<any> }).__studyImport
      const project = await importProject(new Blob([Uint8Array.from(bytes)]))
      let decoded = 0
      for (const asset of Object.values(project.assets) as { blob: Blob }[]) { const bitmap = await createImageBitmap(asset.blob); decoded++; bitmap.close() }
      return { scene: project.document, hashes: Object.keys(project.assets).sort(), decoded, licenses: Object.keys(project.licenses).length, bindings: project.licenseBindings.length }
    }, original.bytes)
    expect(roundtrip.scene).toEqual(original.scene)
    expect(roundtrip.hashes).toEqual(original.hashes)
    expect(roundtrip.decoded).toBe(15)
    expect(roundtrip.licenses).toBe(1)
    expect(roundtrip.bindings).toBe(33) // 15 images + 4 materials + 11 props + 2 prefabs + 1 theme.
  } finally { await freshContext.close() }
})

test('VIS-01 missing or modified static source aborts adoption and pre-aborted request reads no images', async ({ page }) => {
  await page.goto('/')
  let fetched = 0
  await page.route('**/assets/sceneweave-handdrawn/*.png', async route => {
    fetched++
    await route.fulfill({ status: 404, body: 'missing original' })
  })
  const aborted = await page.evaluate(async () => {
    const path = '/src/editor/v2/study-sample.ts', { createStudyProject } = await import(/* @vite-ignore */ path)
    const controller = new AbortController(); controller.abort()
    try { await createStudyProject(controller.signal); return 'unexpected success' } catch (error) { return (error as Error).name }
  })
  expect(aborted).toBe('AbortError'); expect(fetched).toBe(0)
  const missing = await page.evaluate(async () => {
    const path = '/src/editor/v2/study-sample.ts', { createStudyProject } = await import(/* @vite-ignore */ path)
    try { await createStudyProject(); return 'unexpected success' } catch (error) { return (error as Error).message }
  })
  expect(missing).toContain('wood-dark.png (404)'); expect(fetched).toBe(1)
  await page.unroute('**/assets/sceneweave-handdrawn/*.png')
  await page.route('**/assets/sceneweave-handdrawn/wood-dark.png', async route => {
    const response = await route.fetch(), bytes = await response.body()
    const modified = Buffer.from(bytes); modified[modified.length - 1] ^= 1
    await route.fulfill({ response, body: modified })
  })
  const corrupt = await page.evaluate(async () => {
    const path = '/src/editor/v2/study-sample.ts', { createStudyProject } = await import(/* @vite-ignore */ path)
    try { await createStudyProject(); return 'unexpected success' } catch (error) { return (error as Error).message }
  })
  expect(corrupt).toContain('CRC')
})
