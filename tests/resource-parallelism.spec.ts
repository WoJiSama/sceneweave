import { expect, test } from '@playwright/test'

test('native pixel checks overlap within two slots, retain strict output and drain cancellation', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const factories = '/src/platform/browser/content/factories.ts', projects = '/src/application/workspace/project.ts'
    const resources = '/src/shared/project/resources.ts', imageAdapter = '/src/platform/browser/images/adapter.ts', svgAdapter = '/src/platform/browser/ai/svg-port.ts'
    const svgFixture = '/tests/helpers/m24-svg-fixtures.ts'
    const { createSampleProject } = await import(factories), { toBundle } = await import(projects)
    const { validateProjectBundle, validateProjectBundles } = await import(resources)
    const { createBrowserImagePort } = await import(imageAdapter), { createBrowserSvgPort } = await import(svgAdapter)
    const { svgProjectFixture } = await import(svgFixture)
    const input = toBundle(await createSampleProject('study')), images = createBrowserImagePort(), svg = createBrowserSvgPort()
    const svgInput = svgProjectFixture().bundle, inputs = [input, svgInput, input]
    const serial = await validateProjectBundles(inputs, { images: { ...images, validationConcurrency: 1 }, svg: { ...svg, validationConcurrency: 1 } })
    const nativeDecode = globalThis.createImageBitmap, bitmaps = new Set<ImageBitmap>()
    const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL, liveUrls = new Set<string>()
    URL.createObjectURL = blob => { const url = createUrl.call(URL, blob); liveUrls.add(url); return url }
    URL.revokeObjectURL = url => { liveUrls.delete(url); revokeUrl.call(URL, url) }
    let active = 0, peak = 0, calls = 0, cancel: AbortController | undefined
    globalThis.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      active++; calls++; peak = Math.max(peak, active)
      if (cancel && active === 2) cancel.abort()
      try {
        const bitmap = await Reflect.apply(nativeDecode, globalThis, args)
        bitmaps.add(bitmap); return bitmap
      } finally { active-- }
    }) as typeof createImageBitmap
    try {
      const parallel = await validateProjectBundles(inputs, { images, svg })
      const projectsEqual = parallel.every((bundle: typeof input, index: number) => JSON.stringify(bundle.project) === JSON.stringify(serial[index].project))
      let bytesEqual = true
      for (let index = 0; index < inputs.length; index++) for (const hash of Object.keys(serial[index].project.assets)) {
        const expected = await serial[index].resources.read(hash), actual = await parallel[index].resources.read(hash)
        if (expected.length !== actual.length || !expected.every((byte: number, index: number) => byte === actual[index])) bytesEqual = false
      }
      const successful = { peak, calls, active, closed: [...bitmaps].every(bitmap => bitmap.width === 0 && bitmap.height === 0), svgUrlsClosed: liveUrls.size === 0, projectsEqual, bytesEqual }
      active = 0; peak = 0; calls = 0; bitmaps.clear(); cancel = new AbortController()
      let cancellation = ''
      try { await validateProjectBundles(inputs, { images, svg, signal: cancel.signal }) }
      catch (error) { cancellation = (error as Error).name }
      const cancelled = { name: cancellation, active, peak, calls, closed: [...bitmaps].every(bitmap => bitmap.width === 0 && bitmap.height === 0) }
      cancel = undefined
      const fresh = await validateProjectBundle(input, { images, svg })
      return { successful, cancelled, reusableAfterCancellation: JSON.stringify(fresh.project) === JSON.stringify(serial[0].project),
        svgSources: Object.keys(svgInput.project.authoringSources).length, variants: Object.keys(input.project.appearance.variants).length }
    } finally { globalThis.createImageBitmap = nativeDecode; URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl }
  })
  expect(report.svgSources).toBeGreaterThan(0)
  expect(report.successful).toMatchObject({ peak: 2, active: 0, closed: true, svgUrlsClosed: true, projectsEqual: true, bytesEqual: true })
  expect(report.cancelled).toMatchObject({ name: 'AbortError', active: 0, peak: 2, closed: true })
  expect(report.reusableAfterCancellation).toBe(true)
  await info.attach('bounded-pixel-validation.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
})
