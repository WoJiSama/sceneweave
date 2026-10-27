import { visualBase } from '../src/shared/visual/base.js'
import { expect, test, type Page, type Request, type Route } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { CompositionPreview, Workspace } from '../src/application/workspace/workspace'
import type { SceneDocument } from '../src/shared/model/scene'

type Dev = { workspace: Workspace }
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 45_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 45_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 45_000 })
}
async function current(page: Page) {
  return page.evaluate(async () => {
    const path = '/tests/helpers/native-workspace-browser.ts'
    const { readNativeCurrent } = await import(path) as typeof import('./helpers/native-workspace-browser')
    const project = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!
    return { ...await readNativeCurrent(project), sources: structuredClone(project.authoringSources) }
  })
}
const withoutRevision = (document: SceneDocument) => { const { revision: _revision, updatedAt: _updatedAt, ...rest } = document; return rest }

test('SVG authoring preserves exact CPU raster pixels for transparent circle edges', async ({ page }, info) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const sourcePath = '/src/shared/visual/sample-art.ts', svgPath = '/src/shared/ai/svg.ts', rasterPath = '/src/platform/browser/ai/svg-raster.ts'
    const imagePath = '/src/platform/browser/images/adapter.ts', hashPath = '/src/shared/validation/hash.ts', imageBytesPath = '/src/shared/project/image-bytes.ts'
    const { VISUAL_SAMPLE_ART } = await import(sourcePath) as typeof import('../src/shared/visual/sample-art')
    const { normalizeStaticSvg } = await import(svgPath) as typeof import('../src/shared/ai/svg')
    const { rasterizeNormalizedSvg } = await import(rasterPath) as typeof import('../src/platform/browser/ai/svg-raster')
    const { createBrowserImagePort } = await import(imagePath) as typeof import('../src/platform/browser/images/adapter')
    const { sha256Bytes } = await import(hashPath) as typeof import('../src/shared/validation/hash')
    const { normalizePngChunks } = await import(imageBytesPath) as typeof import('../src/shared/project/image-bytes')
    const normalized = normalizeStaticSvg(VISUAL_SAMPLE_ART.find(art => art.key === 'barrel')!.sourceSvg)
    const output = await rasterizeNormalizedSvg(normalized, { longEdgePx: 512 })
    const images = createBrowserImagePort(), actual = await images.decode(output.pngBytes, { sha256: output.sha256, mimeType: 'image/png', sizeBytes: output.pngBytes.length, pixelWidth: 512, pixelHeight: 512 })
    const root = normalized.normalizedSource.replace(/^<svg\s/, '<svg height="512" width="512" ')
    const url = URL.createObjectURL(new Blob([root], { type: 'image/svg+xml;charset=utf-8' })), image = new Image()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
    try {
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Expected isolated static SVG')); image.src = url })
      const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb', willReadFrequently: true })!
      context.drawImage(image, 0, 0, 512, 512)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Expected CPU PNG')), 'image/png'))
      const rawBytes = new Uint8Array(await blob.arrayBuffer())
      // Match the product's sRGB Canvas container normalization before strict decoding.
      // WebKit emits ancillary chunks; stripping those does not relax pixel equality.
      const bytes = normalizePngChunks(rawBytes)
      const expected = await images.decode(bytes, { sha256: sha256Bytes(bytes), mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 512, pixelHeight: 512 })
      return { actualHash: sha256Bytes(new Uint8Array(actual.rgba.buffer)), expectedHash: sha256Bytes(new Uint8Array(expected.rgba.buffer)),
        mismatchedChannels: actual.rgba.reduce((count, value, i) => count + Number(value !== expected.rgba[i]), 0),
        referencePng: { rawBytes: rawBytes.length, normalizedBytes: bytes.length, rawHash: sha256Bytes(rawBytes), normalizedHash: sha256Bytes(bytes) }, userAgent: navigator.userAgent }
    } finally { URL.revokeObjectURL(url); canvas.width = canvas.height = 0 }
  })
  expect(result.actualHash).toBe(result.expectedHash)
  expect(result.mismatchedChannels).toBe(0)
  await info.attach('svg-cpu-pixels.json', { body: JSON.stringify(result), contentType: 'application/json' })
})

test('Q2 refined palette selection creates truly blank complete projects with actual 13/15/23-source closures', async ({ page }, info) => {
  test.setTimeout(150_000)
  await page.goto('/#workspace')
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  const results = []
  for (const palette of [{ value: 'island', sources: 13 }, { value: 'coast', sources: 15 }, { value: 'interior', sources: 23 }]) {
    await page.getByRole('button', { name: '新建视觉空白 · 原创素材', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('原创素材组', { exact: true }).selectOption(palette.value)
    await dialog.getByLabel('场景名称', { exact: true }).fill(`Q2 ${palette.value} 空白素材`)
    await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 45_000 }); await settled(page)
    const result = await page.evaluate(async () => {
      const project = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!
      const path = '/tests/helpers/visual-authoring-browser.ts', { inspectVisualResourceClosure } = await import(path) as typeof import('./helpers/visual-authoring-browser')
      return { schemaVersion: project.schemaVersion, document: structuredClone(project.document), closure: await inspectVisualResourceClosure(project) }
    })
    expect(result.schemaVersion).toBe(2)
    expect(result.document.title).toBe(`Q2 ${palette.value} 空白素材`)
    for (const group of [result.document.props, result.document.rooms, result.document.walls, result.document.terrainAreas, result.document.prefabInstances, result.document.scatterGroups, result.document.notes]) expect(Object.keys(group)).toHaveLength(0)
    expect(Object.keys(visualBase(result.document)!.boundaries)).toHaveLength(0)
    expect(Object.keys(result.closure.sources)).toHaveLength(palette.sources)
    expect(Object.keys(result.closure.assets)).toHaveLength(palette.sources)
    for (const [hash, actual] of Object.entries(result.closure.hashes)) expect(actual).toBe(hash)
    expect(result.closure.licenseBindings.every(binding => binding.embedding === 'allowed')).toBe(true)
    results.push({ palette: palette.value, sources: palette.sources, sceneId: result.document.sceneId, resourceHashes: result.closure.hashes })
  }
  await info.attach('q2-blank-palettes.json', { body: JSON.stringify(results), contentType: 'application/json' })
})

for (const sample of [
  { name: '潮痕浅湾 · 精修版', sources: 15, props: 56, rooms: 0, definitions: 11, width: 4096, height: 3072, propPrefix: 'q2-coast-reef-' },
  { name: '灯下旅舍 · 精修版', sources: 23, props: 45, rooms: 5, definitions: 19, width: 4096, height: 2993, propPrefix: 'q2-' },
]) test(`Q2 ${sample.name} opens as a reviewed copy, preserves cancellation and edits/undo/cold/offline 4K`, async ({ page, context, browserName }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#workspace')
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await page.getByRole('button', { name: '苔冠岩岛 · 高差与草沿', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(dialog).toBeVisible({ timeout: 45_000 })
  await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
  const prior = await current(page), button = page.getByRole('button', { name: sample.name, exact: true })
  await button.click(); await expect(dialog).toBeVisible({ timeout: 45_000 })
  await expect(dialog).toContainText(sample.name)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
  expect((await current(page)).contentHash).toBe(prior.contentHash)
  await button.click(); await expect(dialog).toBeVisible({ timeout: 45_000 })
  await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
  const original = await current(page)
  expect(original.title).toBe(sample.name); expect(original.sceneId).not.toBe(prior.sceneId)
  expect(original.document.schemaVersion).toBe(2)
  expect(Object.keys(original.sources)).toHaveLength(sample.sources)
  expect(Object.keys(original.document.props)).toHaveLength(sample.props)
  expect(Object.keys(original.document.rooms)).toHaveLength(sample.rooms)
  expect(Object.keys(original.document.propDefinitions)).toHaveLength(sample.definitions)
  const edit = await page.evaluate(async prefix => {
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace, project = workspace.getState().project!
    // Select an independent object. Group membership is never silently discarded by the test.
    const members = new Set(Object.values(project.document.prefabInstances).flatMap(group => Object.values(group.members).map(member => member.propId)))
    const prop = Object.values(project.document.props).find(value => value.id.startsWith(prefix) && !members.has(value.id) && value.definitionRef!.id.includes(prefix.includes('reef-') ? 'reef-' : 'papers-books'))!
    if (!prop) throw new Error('Expected an independent editable sample object')
    const rotationDeg = (prop.rotationDeg + 7) % 360
    const preview = await workspace.preview([{ type: 'updateProp', id: prop.id, changes: { rotationDeg } }])
    Reflect.set(window, '__q2SamplePreview', preview)
    return { id: prop.id, rotationDeg }
  }, sample.propPrefix)
  expect((await current(page)).contentHash).toBe(original.contentHash)
  const repeated = await page.evaluate(async () => {
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace, candidate = Reflect.get(window, '__q2SamplePreview') as CompositionPreview
    await workspace.adoptPreview(candidate); await workspace.flush()
    try { await workspace.adoptPreview(candidate); return null } catch (error) { return String(error) }
  })
  expect(repeated).toContain('不可重复采用'); await settled(page)
  const adopted = await current(page)
  expect(adopted.revision).toBe(original.revision + 1)
  expect(adopted.document.props[edit.id]).toEqual({ ...original.document.props[edit.id], rotationDeg: edit.rotationDeg })
  const expected = structuredClone(original.document); expected.props[edit.id].rotationDeg = edit.rotationDeg
  expect(withoutRevision(adopted.document)).toEqual(withoutRevision(expected))
  expect(adopted.sources).toEqual(original.sources)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  expect(withoutRevision((await current(page)).document)).toEqual(withoutRevision(original.document))
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  const redone = await current(page)
  expect(redone.revision).toBe(original.revision + 3)
  expect(withoutRevision(redone.document)).toEqual(withoutRevision(adopted.document))
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(page)
  expect((await current(page)).contentHash).toBe(redone.contentHash)
  const priorHash = await page.evaluate(async sceneId => {
    const path = '/src/platform/browser/runtime.ts', hashPath = '/src/shared/project/validate.ts'
    const { projectRepository } = await import(path) as typeof import('../src/platform/browser/runtime')
    const { projectContentHash } = await import(hashPath) as typeof import('../src/shared/project/validate')
    return projectContentHash((await projectRepository.load(sceneId))!.project)
  }, prior.sceneId)
  expect(priorHash).toBe(prior.contentHash)
  const before = await page.evaluate(async () => {
    const path = '/tests/helpers/visual-authoring-browser.ts'
    const { stageVisualRoundTrip } = await import(path) as typeof import('./helpers/visual-authoring-browser')
    const stage = await stageVisualRoundTrip((Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!)
    Reflect.set(window, '__q2SampleOfflineStage', stage)
    return { ...stage, bytes: stage.bytes.length }
  })
  let networkRequests = 0
  const network = (request: Request) => { if (/^https?:/.test(request.url())) networkRequests++ }
  const deny = (route: Route) => route.abort('internetdisconnected')
  page.on('request', network)
  if (browserName === 'webkit') await context.route(/^https?:/, deny); else await context.setOffline(true)
  let after
  try {
    after = await page.evaluate(async () => {
      const path = '/tests/helpers/visual-authoring-browser.ts'
      const { finishVisualRoundTrip } = await import(path) as typeof import('./helpers/visual-authoring-browser')
      return finishVisualRoundTrip(Reflect.get(window, '__q2SampleOfflineStage'))
    })
  } finally {
    if (browserName === 'webkit') await context.unroute(/^https?:/, deny); else await context.setOffline(false)
    page.off('request', network)
  }
  expect(networkRequests).toBe(0)
  expect(after.contentHash).toBe(before.contentHash); expect(after.contentHash).toBe(redone.contentHash)
  expect(after.hashes).toEqual(before.hashes); expect(after.sources).toBe(before.sources); expect(after.licenses).toBe(before.licenses)
  expect(after.visual).toBe(before.visual); expect(after.authoringSources).toBe(sample.sources)
  for (const audience of ['gm', 'player'] as const) {
    expect([after[audience].width, after[audience].height]).toEqual([sample.width, sample.height])
    expect(after[audience].rgbaHash).toBe(before[audience].rgbaHash)
    expect(after[audience].containsMetadata).toBe(false)
    expect([...new Set(after[audience].chunks)]).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
  }
  expect(errors).toEqual([])
  const output = info.outputPath('q2-sample.json')
  await writeFile(output, JSON.stringify({ sample, sceneId: original.sceneId, editedProp: edit.id, source: before, offline: after, networkRequests, errors }, null, 2))
  await info.attach('q2-sample.json', { path: output, contentType: 'application/json' })
})
