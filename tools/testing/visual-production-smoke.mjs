import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { chromium, expect } from '@playwright/test'
import { preview } from 'vite'

// Run only after a normal `npm run build`. All application writes use actual UI
// controls in a new, non-persistent browser context; no DEV imports, storage
// injection, application hooks, provider requests or user's browser profile.
const root = process.cwd(), work = path.resolve(root, 'work')
const output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? path.join(work, 'visual-production-smoke'))
assert(output.startsWith(`${work}${path.sep}`), 'Raw smoke output must stay under ignored work/.')
const port = Number(process.env.SCENEWEAVE_VISUAL_SMOKE_PORT ?? 5193)
assert(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid preview port.')
const base = process.env.SCENEWEAVE_BASE_PATH ?? '/sceneweave/'
assert(/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base), 'Base must be a local absolute path with trailing slash.')
const origin = `http://127.0.0.1:${port}`, url = `${origin}${base}#workspace`
const buildHtml = await readFile(path.join(root, 'dist/index.html'), 'utf8')
assert(!/@vite\/client|@react-refresh|\/src\/|performance\/b5/.test(buildHtml), 'Expected a normal production build.')
assert(buildHtml.includes(`src="${base}assets/`), `Production assets must use ${base}assets/.`)
await mkdir(output, { recursive: true })

const started = Date.now(), errors = [], consoleErrors = [], httpErrors = [], blockedRequests = [], checks = []
const result = { status: 'running', method: 'Normal Vite preview under the production base path; real UI sample review/save/reload, full-project downloads, light preview/confirmation/adoption, player PNG and original visual blank. This bounded smoke is not a full regression, model journey, performance result or P3 art acceptance.',
  url, output, checks, errors, consoleErrors, httpErrors, blockedRequests }
let server, browser, page
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))

async function step(name, run) {
  const start = Date.now(), observation = await run()
  checks.push({ name, elapsedMs: Date.now() - start, ...observation })
  console.log(`PASS ${name}`)
  await writeFile(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  return observation
}

async function settled(title) {
  if (title) await expect(page.locator('.workspace-project-title h1')).toHaveText(title)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  const canvas = page.locator('canvas[aria-label="材质场景主持人预览"], canvas[aria-label="材质场景玩家预览"]')
  await expect(canvas).toBeVisible({ timeout: 90_000 })
  await expect.poll(() => canvas.evaluate(value => value.width > 0 && value.height > 0), { timeout: 90_000 }).toBe(true)
}

async function productionGuards() {
  const observation = await page.evaluate(() => ({ userAgent: navigator.userAgent,
    hooks: Object.getOwnPropertyNames(window).filter(key => /^__sceneweave(?:.*Dev|Performance)$/i.test(key)),
    scripts: [...document.scripts].map(script => script.src).filter(Boolean) }))
  assert.deepEqual(observation.hooks, [], 'Normal production must not expose DEV/performance hooks.')
  assert(observation.scripts.length > 0 && observation.scripts.every(src => new URL(src).pathname.startsWith(`${base}assets/`)))
  assert.deepEqual(errors, [], 'Browser page errors occurred.')
  assert.deepEqual(consoleErrors, [], 'Browser console errors occurred.')
  assert.deepEqual(httpErrors, [], 'Production resource requests failed.')
  assert.deepEqual(blockedRequests, [], 'The smoke attempted a non-preview network request.')
  return observation
}

async function download(button, filename, expectedName) {
  const pending = page.waitForEvent('download', { timeout: 120_000 })
  await button.click()
  const downloaded = await pending
  assert.equal(downloaded.suggestedFilename(), expectedName)
  const file = path.join(output, filename)
  await downloaded.saveAs(file)
  assert.equal(await downloaded.failure(), null)
  await settled()
  return { bytes: await readFile(file), file }
}

async function fullProject(filename, expected = { assets: 24, materials: 7, props: 17, bindings: 49, license: 'Sceneweave Visual Authoring Samples, version 1' }) {
  const downloaded = await download(page.getByRole('button', { name: '完整工程', exact: true }), filename, 'sceneweave-complete.sceneweave')
  const files = unzipSync(downloaded.bytes), manifest = json(files['manifest.json']), scene = json(files['scene.json']), sources = json(files['sources.json'])
  assert.equal(manifest.format, 'sceneweave-complete-project'); assert.equal(manifest.schemaVersion, 2)
  assert.equal(scene.format, 'sceneweave-scene'); assert.equal(scene.schemaVersion, 2); assert.equal(scene.visual.version, 1)
  assert.equal(manifest.sceneId, scene.sceneId); assert.equal(manifest.revision, scene.revision)
  assert.equal(Object.keys(files).length, manifest.entries.length + 1)
  for (const entry of manifest.entries) {
    assert(files[entry.path], `Missing package entry ${entry.path}`)
    assert.equal(files[entry.path].length, entry.sizeBytes, entry.path)
    assert.equal(sha256(files[entry.path]), entry.sha256, entry.path)
  }
  assert.equal(Object.keys(scene.assets).length, expected.assets)
  assert.equal(Object.keys(scene.materials).length, expected.materials)
  assert.equal(Object.keys(scene.propDefinitions).length, expected.props)
  assert.equal(Object.keys(sources).length, expected.sources ?? expected.assets)
  for (const source of Object.values(sources)) {
    assert(files[`sources/${source.sourceSha256}.svg`]); assert(files[`sources/${source.normalizedSha256}.svg`])
    assert(manifest.assetRecords[source.rasterSha256])
  }
  const licenses = manifest.entries.filter(entry => entry.role === 'license')
  assert(licenses.some(entry => new TextDecoder().decode(files[entry.path]).includes(expected.license)))
  assert(manifest.licenseBindings.length >= expected.bindings && manifest.licenseBindings.every(binding => binding.embedding === 'allowed'))
  return { scene, manifest, hash: sha256(downloaded.bytes), bytes: downloaded.bytes.length, file: downloaded.file }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1
  return value >>> 0
})
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8
  return (value ^ 0xffffffff) >>> 0
}
function inspectPlayerPng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const chunks = [], idat = []
  let cursor = 8, width, height, colorType, bitDepth
  while (cursor < bytes.length) {
    assert(cursor + 12 <= bytes.length, 'Truncated PNG chunk.')
    const length = bytes.readUInt32BE(cursor), type = bytes.toString('ascii', cursor + 4, cursor + 8), end = cursor + length + 12
    assert(end <= bytes.length, 'PNG chunk exceeds the file.')
    assert.equal(crc32(bytes.subarray(cursor + 4, end - 4)), bytes.readUInt32BE(end - 4), `PNG CRC ${type}`)
    assert(['IHDR', 'sRGB', 'IDAT', 'IEND'].includes(type), `Unexpected PNG metadata/chunk: ${type}`)
    if (type === 'IHDR') {
      assert.equal(chunks.length, 0); assert.equal(length, 13)
      width = bytes.readUInt32BE(cursor + 8); height = bytes.readUInt32BE(cursor + 12)
      bitDepth = bytes[cursor + 16]; colorType = bytes[cursor + 17]
      assert.deepEqual([...bytes.subarray(cursor + 18, cursor + 21)], [0, 0, 0])
    } else if (type === 'IDAT') idat.push(bytes.subarray(cursor + 8, end - 4))
    else if (type === 'IEND') { assert.equal(length, 0); assert.equal(end, bytes.length) }
    chunks.push(type); cursor = end
  }
  assert.deepEqual([width, height], [4096, 3072]); assert.equal(bitDepth, 8)
  assert([2, 6].includes(colorType), 'Expected a true-color Canvas PNG.')
  assert.equal(chunks.filter(type => type === 'IHDR').length, 1); assert.equal(chunks.at(-1), 'IEND')
  assert.equal(chunks.filter(type => type === 'sRGB').length, 1); assert(idat.length > 0)
  const expectedBytes = height * (1 + width * (colorType === 6 ? 4 : 3)), decoded = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedBytes + 1 })
  assert.equal(decoded.length, expectedBytes, 'PNG must contain the actual full-resolution raster.')
  return { width, height, bitDepth, colorType, chunks, sizeBytes: bytes.length, sha256: sha256(bytes), scanlineBytes: decoded.length, metadata: 'Only IHDR/sRGB/IDAT/IEND; no text, EXIF, project or source metadata.' }
}

try {
  server = await preview({ mode: 'production', base, preview: { host: '127.0.0.1', port, strictPort: true } })
  browser = await chromium.launch({ channel: process.env.SCENEWEAVE_BROWSER_CHANNEL ?? 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, acceptDownloads: true })
  await context.route('**/*', async route => {
    const target = new URL(route.request().url())
    if (['data:', 'blob:'].includes(target.protocol) || target.origin === origin) await route.continue()
    else { blockedRequests.push(`${route.request().method()} ${target.origin}${target.pathname}`); await route.abort('blockedbyclient') }
  })
  page = await context.newPage(); page.setDefaultTimeout(45_000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('response', response => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }) })
  await page.goto(url, { waitUntil: 'networkidle' })
  await expect(page.getByRole('tab', { name: '工程', exact: true })).toBeVisible()
  await step('normal-production-entry', productionGuards)

  let inn
  for (const sample of [
    { key: 'beach', name: '潮声浅湾 · 连续海岸', title: '潮声浅湾' },
    { key: 'island', name: '苔冠岩岛 · 高差与草沿', title: '苔冠岩岛' },
    { key: 'interior', name: '灯下旅舍 · 材质与灯光', title: '灯下旅舍' },
  ]) await step(`${sample.key}-ui-save-reload`, async () => {
    await page.getByRole('tab', { name: '工程', exact: true }).click()
    await page.getByRole('button', { name: sample.name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
    await expect(dialog).toBeVisible({ timeout: 90_000 })
    await expect(dialog.locator('.asset-candidate strong')).toHaveText(sample.title)
    await expect(dialog).toContainText('24 张位图')
    await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 90_000 }); await settled(sample.title)
    const before = await fullProject(`${sample.key}-saved.sceneweave`)
    await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(sample.title)
    const after = await fullProject(`${sample.key}-reloaded.sceneweave`)
    assert.equal(after.hash, before.hash, 'Saved/reloaded full package must be byte-identical.')
    assert.equal(after.scene.title, sample.title); assert.equal(after.scene.revision, 0)
    if (sample.key === 'interior') inn = after
    await page.screenshot({ path: path.join(output, `${sample.key}-production.png`) })
    return { title: sample.title, sceneId: after.scene.sceneId, revision: after.scene.revision, packageSha256: after.hash, packageBytes: after.bytes, assets: 24, sourceRecords: 24 }
  })

  await step('inn-point-light-preview-confirm-adopt-reload', async () => {
    const lightId = 'inn-light-common', intensity = 0.35
    assert(inn.scene.visual.lights[lightId]); assert.notEqual(inn.scene.visual.lights[lightId].intensity, intensity)
    await page.getByRole('tab', { name: '视觉', exact: true }).click()
    const panel = page.getByRole('region', { name: '视觉场景创作', exact: true })
    await panel.getByRole('button', { name: '灯光', exact: true }).click()
    await panel.getByRole('combobox', { name: /^灯光/ }).selectOption(lightId)
    await panel.getByLabel('视觉灯光强度', { exact: true }).fill(String(intensity))
    await panel.getByRole('button', { name: '预览灯光', exact: true }).click()
    const candidate = page.locator('.asset-structure-preview')
    await expect(candidate).toContainText('尚未写入工程')
    await expect(candidate.getByLabel('待采用视觉操作 ID', { exact: true })).toHaveValue(new RegExp(lightId))
    await expect(page.locator('.asset-facts dd').first()).toHaveText(`r${inn.scene.revision}`)
    const adopt = candidate.getByRole('button', { name: '采用视觉修改', exact: true })
    await expect(adopt).toBeDisabled()
    await candidate.getByLabel('确认完整影响范围', { exact: true }).check()
    await expect(adopt).toBeEnabled(); await adopt.click()
    await expect(candidate).toHaveCount(0); await settled('灯下旅舍')
    await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled('灯下旅舍')
    const after = await fullProject('interior-light-adopted-reloaded.sceneweave')
    assert.equal(after.scene.revision, inn.scene.revision + 1)
    assert.deepEqual(after.scene.visual.lights[lightId], { ...inn.scene.visual.lights[lightId], intensity })
    const excludeSelectedLight = scene => {
      const { revision: _revision, updatedAt: _updatedAt, visual, ...rest } = scene
      const { [lightId]: _light, ...lights } = visual.lights
      return { ...rest, visual: { ...visual, lights } }
    }
    assert.deepEqual(excludeSelectedLight(after.scene), excludeSelectedLight(inn.scene), 'Only the selected visual parameter may change.')
    await page.screenshot({ path: path.join(output, 'interior-light-adopted.png') })
    return { lightId, beforeIntensity: inn.scene.visual.lights[lightId].intensity, afterIntensity: intensity, revision: after.scene.revision, packageSha256: after.hash, physicalAndOtherVisualFieldsUnchanged: true }
  })

  await step('player-4k-png-actual-raster-and-metadata', async () => {
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '玩家', exact: true }).click()
    await settled('灯下旅舍')
    await expect(page.locator('canvas[aria-label="材质场景玩家预览"]')).toBeVisible()
    const image = await download(page.getByRole('button', { name: '4K PNG', exact: true }), 'interior-player-4096.png', 'sceneweave-player-map.png')
    const inspection = inspectPlayerPng(image.bytes)
    const decoded = await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      try { return { width: bitmap.width, height: bitmap.height } } finally { bitmap.close() }
    }, image.bytes.toString('base64'))
    assert.deepEqual(decoded, { width: inspection.width, height: inspection.height })
    await page.screenshot({ path: path.join(output, 'interior-player-preview.png') })
    return { ...inspection, nativeBitmapDecoded: decoded }
  })

  await step('original-visual-blank-form-empty-entities-and-canvas', async () => {
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click()
    await settled('灯下旅舍')
    await page.getByRole('tab', { name: '工程', exact: true }).click()
    const create = page.getByRole('button', { name: '新建视觉空白 · 原创素材', exact: true })
    await create.click()
    const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
    await expect(dialog.getByLabel('原创素材组', { exact: true })).toHaveValue('original')
    await expect(dialog.getByLabel('原创素材组', { exact: true })).toContainText('通用视觉 · 24项')
    await expect(dialog.getByLabel('画布宽度', { exact: true })).toHaveValue('24000')
    await expect(dialog.getByLabel('画布高度', { exact: true })).toHaveValue('18000')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0); await settled('灯下旅舍')
    await create.click()
    const title = '生产检查 · 原创视觉空白'
    await dialog.getByLabel('场景名称', { exact: true }).fill(title)
    await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 90_000 }); await settled(title)
    await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(title)
    const saved = await fullProject('original-visual-blank.sceneweave'), scene = saved.scene
    assert.notEqual(scene.sceneId, inn.scene.sceneId); assert.equal(scene.revision, 0)
    assert.deepEqual(scene.exportBoundsMm, { x: 0, y: 0, width: 24000, height: 18000 })
    const physicalCollections = ['vertices', 'walls', 'openings', 'rooms', 'props', 'regions', 'notes', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups', 'entityLayers']
    for (const key of physicalCollections) assert.deepEqual(scene[key], {}, `Blank must not contain ${key}.`)
    for (const key of ['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters']) assert.deepEqual(scene.visual[key], {}, key)
    assert.deepEqual(scene.visual.environment, { ambientColor: '#FFFFFF', ambientOpacity: 0, exposure: 1, lightDirectionDeg: 135, contactShadowMm: 0, contactShadowOpacity: 0 })
    assert.equal(Object.keys(scene.userLayers).length, 4)
    await page.getByRole('tab', { name: '对象', exact: true }).click()
    await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
    await expect(page.locator('.asset-object-list-tools')).toContainText('0 件物件')
    await expect(page.locator('.asset-library [data-entity-id]')).toHaveCount(0)
    const canvas = await page.locator('canvas[aria-label="材质场景主持人预览"]').evaluate(element => {
      const context = element.getContext('2d'), { width, height } = element
      if (!context) throw new Error('Missing native Canvas2D preview.')
      const center = [...context.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data]
      return { width, height, center }
    })
    assert(canvas.width > 0 && canvas.height > 0 && canvas.center[3] > 0, 'Blank must have a rendered, opaque native preview.')
    await page.screenshot({ path: path.join(output, 'original-visual-blank.png') })
    return { title, sceneId: scene.sceneId, packageSha256: saved.hash, assets: 24, materials: 7, props: 17, userLayers: 4, emptyPhysicalCollections: physicalCollections, emptyVisualCollections: true, canvas }
  })

  for (const sample of [
    { key: 'island', title: '岬湾苔岛 · 精修版', counts: { assets: 14, sources: 13, materials: 4, props: 10, bindings: 29, license: 'Sceneweave Refined Island Artwork, version 1' }, members: 48, rooms: 0 },
    { key: 'coast', title: '潮痕浅湾 · 精修版', counts: { assets: 15, materials: 4, props: 11, bindings: 31, license: 'Sceneweave Refined Coast Artwork, version 1' }, members: 56, rooms: 0 },
    { key: 'interior', title: '灯下旅舍 · 精修版', counts: { assets: 23, materials: 4, props: 19, bindings: 52, license: 'Sceneweave Refined Interior Artwork, version 1' }, members: 45, rooms: 5 },
  ]) await step(`refined-${sample.key}-review-save-reload-complete-package`, async () => {
    await page.getByRole('tab', { name: '工程', exact: true }).click()
    await page.getByRole('button', { name: sample.title, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
    await expect(dialog).toBeVisible({ timeout: 90000 })
    await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 90000 }); await settled(sample.title)
    await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(sample.title)
    const saved = await fullProject(`refined-${sample.key}.sceneweave`, sample.counts)
    assert.equal(Object.keys(saved.scene.props).length, sample.members)
    assert.equal(Object.keys(saved.scene.rooms).length, sample.rooms)
    await page.screenshot({ path: path.join(output, `refined-${sample.key}.png`) })
    return { title: sample.title, sceneId: saved.scene.sceneId, packageSha256: saved.hash, sourceCount: sample.counts.sources ?? sample.counts.assets, editableMembers: sample.members, rooms: sample.rooms }
  })
  await step('final-normal-production-guards', productionGuards)
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'; result.failure = error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    await writeFile(path.join(output, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => {})
  }
  console.error(result.failure); process.exitCode = 1
} finally {
  result.elapsedMs = Date.now() - started
  await writeFile(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  await browser?.close()
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
