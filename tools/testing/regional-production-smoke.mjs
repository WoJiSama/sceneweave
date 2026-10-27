import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { chromium, expect } from '@playwright/test'
import { preview } from 'vite'

// Run after a normal `npm run build`, serially with other browser work. This
// script uses only the production UI and browser downloads; it never imports
// application modules, touches IndexedDB, or exposes a DEV hook.
const root = process.cwd(), work = path.join(root, 'work'), dist = path.join(root, 'dist')
const output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? path.join(work, 'terrain-followup-20261027/regional-production'))
assert(output.startsWith(`${work}${path.sep}`), 'Smoke output must stay under ignored work/.')
const port = Number(process.env.SCENEWEAVE_REGIONAL_SMOKE_PORT ?? 5197)
assert(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid preview port.')
const base = process.env.SCENEWEAVE_BASE_PATH ?? '/sceneweave/'
assert(/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base), 'Base must be a local absolute path with trailing slash.')
const origin = `http://127.0.0.1:${port}`, url = `${origin}${base}#workspace`
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const parse = bytes => JSON.parse(decode(bytes))
await mkdir(output, { recursive: true })

const started = Date.now(), result = { status: 'running', method: 'Normal production Vite preview; actual UI regional creation, cancellation, adoption, source comparison, independent 500m drill-down, complete package closure, cold reload and dual-audience 4096 PNG decode. No DEV hooks, application imports, injected state, model calls or external network.', url, output, checks: [], errors: [], consoleErrors: [], httpErrors: [], requestFailures: [], blockedRequests: [] }
let server, browser, context, page
const saveResult = () => writeFile(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
async function step(name, run) {
  const start = Date.now(), observation = await run()
  result.checks.push({ name, elapsedMs: Date.now() - start, ...observation })
  console.log(`PASS ${name}`); await saveResult(); return observation
}

function inspectPng(bytes, bounds) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const chunks = [], idat = []; let cursor = 8, width, height, bitDepth, colorType
  const crcTable = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0 })
  const crc32 = value => { let crc = 0xffffffff; for (const byte of value) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0 }
  while (cursor < bytes.length) {
    assert(cursor + 12 <= bytes.length, 'Truncated PNG chunk.')
    const length = bytes.readUInt32BE(cursor), type = bytes.toString('ascii', cursor + 4, cursor + 8), end = cursor + length + 12
    assert(end <= bytes.length, 'PNG chunk exceeds file.'); assert.equal(crc32(bytes.subarray(cursor + 4, end - 4)), bytes.readUInt32BE(end - 4), `PNG CRC ${type}`)
    assert(['IHDR', 'sRGB', 'IDAT', 'IEND'].includes(type), `Unexpected PNG metadata/chunk: ${type}`)
    if (type === 'IHDR') { assert.equal(chunks.length, 0); width = bytes.readUInt32BE(cursor + 8); height = bytes.readUInt32BE(cursor + 12); bitDepth = bytes[cursor + 16]; colorType = bytes[cursor + 17]; assert.deepEqual([...bytes.subarray(cursor + 18, cursor + 21)], [0, 0, 0]) }
    if (type === 'IDAT') idat.push(bytes.subarray(cursor + 8, end - 4))
    if (type === 'IEND') { assert.equal(length, 0); assert.equal(end, bytes.length) }
    chunks.push(type); cursor = end
  }
  const scale = 4096 / Math.max(bounds.width, bounds.height)
  assert.deepEqual([width, height], [Math.round(bounds.width * scale), Math.round(bounds.height * scale)])
  assert.equal(bitDepth, 8); assert([2, 6].includes(colorType), 'Expected true-color PNG.')
  assert.equal(chunks.filter(value => value === 'IHDR').length, 1); assert.equal(chunks.at(-1), 'IEND'); assert.equal(chunks.filter(value => value === 'sRGB').length, 1)
  const expectedBytes = height * (1 + width * (colorType === 6 ? 4 : 3)), decoded = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedBytes + 1 })
  assert.equal(decoded.length, expectedBytes, 'PNG must contain the complete raster.')
  return { width, height, bitDepth, colorType, chunks, sizeBytes: bytes.length, sha256: sha256(bytes), scanlineBytes: decoded.length, metadata: 'Only IHDR/sRGB/IDAT/IEND; no project/source metadata.' }
}

function inspectPackage(bytes, expectedMode) {
  const files = unzipSync(bytes), manifest = parse(files['manifest.json']), scene = parse(files['scene.json']), identity = parse(files['identity.json']), appearance = parse(files['appearance.json'])
  assert.equal(manifest.format, 'sceneweave-complete-project'); assert.equal(manifest.schemaVersion, 3); assert.equal(manifest.packageMode, 'complete')
  assert.equal(scene.schemaVersion, 3); assert.equal(scene.mapMode, expectedMode); assert.equal(identity.version, 2); assert.equal(appearance.version, 2)
  assert.equal(manifest.sceneId, scene.sceneId); assert.equal(manifest.revision, scene.revision); assert.equal(Object.keys(files).length, manifest.entries.length + 1)
  const entryPaths = new Set(manifest.entries.map(entry => entry.path)); assert.equal(entryPaths.size, manifest.entries.length); assert.deepEqual(Object.keys(files).sort(), ['manifest.json', ...entryPaths].sort())
  for (const entry of manifest.entries) { assert(files[entry.path], `Missing package entry ${entry.path}.`); assert.equal(files[entry.path].length, entry.sizeBytes, entry.path); assert.equal(sha256(files[entry.path]), entry.sha256, entry.path) }
  assert(manifest.entries.some(entry => entry.role === 'license')); assert(manifest.entries.some(entry => entry.role === 'asset'))
  return { files, manifest, scene, identity, appearance, hash: sha256(bytes), bytes: bytes.length }
}

async function download(button, filename, expectedName) {
  const pending = page.waitForEvent('download', { timeout: 120_000 }); await button.click(); const item = await pending
  assert.equal(item.suggestedFilename(), expectedName); const file = path.join(output, filename); await item.saveAs(file); assert.equal(await item.failure(), null)
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 }); return { bytes: await readFile(file), file }
}
async function rendered(title) {
  await expect(page.locator('.workspace-project-title h1')).toHaveText(title, { timeout: 120_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 120_000 }); await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 })
  await expect(page.getByRole('article', { name: '区域候选', exact: true })).toHaveCount(0, { timeout: 120_000 }); await expect(page.getByRole('button', { name: '完整工程', exact: true })).toBeEnabled({ timeout: 120_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 })
  await expect(page.locator('canvas[aria-label="材质场景主持人预览"], canvas[aria-label="材质场景玩家预览"]').first()).toBeVisible({ timeout: 120_000 })
}
async function guards() {
  const hooks = await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => /^__sceneweave/i.test(key)))
  assert.deepEqual(hooks, [], 'Production UI must not expose DEV hooks.'); assert.deepEqual(result.errors, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.httpErrors, []); assert.deepEqual(result.requestFailures, []); assert.deepEqual(result.blockedRequests, [])
  return { hooks }
}

try {
  const html = await readFile(path.join(dist, 'index.html'), 'utf8'); assert(!/@vite\/client|@react-refresh|\/src\//.test(html)); assert(html.includes(`src="${base}assets/`))
  server = await preview({ mode: 'production', base, preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' })
  browser = await chromium.launch({ headless: true, ...(process.env.SCENEWEAVE_BROWSER_CHANNEL ? { channel: process.env.SCENEWEAVE_BROWSER_CHANNEL } : {}) })
  context = await browser.newContext({ viewport: { width: 1512, height: 982 }, acceptDownloads: true, serviceWorkers: 'block' })
  await context.route('**/*', async route => { const target = new URL(route.request().url()); if (['data:', 'blob:'].includes(target.protocol) || target.origin === origin) return route.continue(); result.blockedRequests.push(`${route.request().method()} ${target.origin}${target.pathname}`); return route.abort('blockedbyclient') })
  context.on('response', response => { if (response.status() >= 400) result.httpErrors.push({ status: response.status(), url: response.url() }) }); context.on('requestfailed', request => {
    const failure = request.failure()?.errorText, url = request.url()
    // Chromium reports the browser revoking a consumed download Blob URL as
    // ERR_ABORTED after the bytes have already been checked by the smoke.
    if (!(url.startsWith('blob:') && failure === 'net::ERR_ABORTED')) result.requestFailures.push({ url, error: failure })
  })
  page = await context.newPage(); page.setDefaultTimeout(60_000); page.on('pageerror', error => result.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()) })
  await page.goto(url, { waitUntil: 'networkidle' }); await expect(page.getByRole('tab', { name: '工程', exact: true })).toBeVisible({ timeout: 120_000 }); await step('production-entry-no-hooks', guards)
  await page.getByRole('tab', { name: '工程', exact: true }).click()

  await step('regional-create-cancel-preserves-empty-workspace', async () => {
    const originalTitle = await page.locator('.workspace-project-title h1').innerText()
    await page.getByRole('button', { name: '预览独立区域地图', exact: true }).click(); await expect(page.getByRole('article', { name: '区域候选', exact: true })).toBeVisible({ timeout: 120_000 })
    await page.getByRole('button', { name: '取消区域候选', exact: true }).click(); await expect(page.getByRole('article', { name: '区域候选', exact: true })).toHaveCount(0); await expect(page.locator('.workspace-project-title h1')).toHaveText(originalTitle); await expect(page.getByRole('button', { name: '完整工程', exact: true })).toBeDisabled(); return { cancelled: true, mainTitle: originalTitle }
  })
  await page.getByRole('button', { name: '预览独立区域地图', exact: true }).click(); await expect(page.getByRole('article', { name: '区域候选', exact: true })).toBeVisible({ timeout: 120_000 })
  await page.getByLabel('确认区域候选范围', { exact: true }).check(); await page.getByRole('button', { name: '保存并打开独立区域候选', exact: true }).click(); await rendered('河谷古道')

  let parentPackage
  await step('regional-parent-complete3-package-and-three-symbol-definitions', async () => {
    parentPackage = inspectPackage((await download(page.getByRole('button', { name: '完整工程', exact: true }), 'regional-parent.sceneweave', 'sceneweave-complete.sceneweave')).bytes, 'regional')
    assert.equal(Object.keys(parentPackage.scene.regional.symbolDefinitions).length, 3); assert.equal(Object.keys(parentPackage.scene.regional.symbols).length, 2); assert.equal(Object.keys(parentPackage.scene.regional.landmarks).length, 1)
    return { packageSha256: parentPackage.hash, packageBytes: parentPackage.bytes, entries: parentPackage.manifest.entries.length, sceneId: parentPackage.scene.sceneId, schemaVersion: parentPackage.manifest.schemaVersion, symbolDefinitions: Object.keys(parentPackage.scene.regional.symbolDefinitions).length }
  })

  await page.getByRole('button', { name: '预览独立下钻场景', exact: true }).click(); await expect(page.getByRole('article', { name: '区域候选', exact: true })).toBeVisible({ timeout: 120_000 }); await expect(page.getByRole('article', { name: '区域候选', exact: true })).toContainText('来源快照')
  await expect(page.getByRole('article', { name: '区域候选', exact: true })).toContainText('已物化')
  await step('regional-drilldown-default-500m-review', async () => { const values = await Promise.all(['下钻 X mm', '下钻 Y mm', '下钻宽 mm', '下钻高 mm'].map(label => page.getByLabel(label, { exact: true }).inputValue())); assert.deepEqual(values, ['0', '0', '500000', '500000']); return { selectionMm: { x: 0, y: 0, width: 500000, height: 500000 } } })
  await page.getByLabel('确认区域候选范围', { exact: true }).check(); await page.getByRole('button', { name: '保存并打开独立区域候选', exact: true }).click(); await rendered('河谷古道 · 下钻')

  await step('regional-child-source-comparison', async () => { await page.getByRole('button', { name: '核对父图来源', exact: true }).click(); const status = page.locator('.regional-source').getByRole('status'); await expect(status).toContainText('一致', { timeout: 120_000 }); return { sourceComparison: (await status.innerText()).trim() } })
  let childPackage
  await step('regional-child-source-snapshot-and-package', async () => {
    const downloaded = await download(page.getByRole('button', { name: '完整工程', exact: true }), 'regional-child.sceneweave', 'sceneweave-complete.sceneweave'); childPackage = inspectPackage(downloaded.bytes, 'scene')
    const links = Object.values(childPackage.scene.generation.sourceLinks); assert.equal(links.length, 1); assert(links[0].sourceSceneId === parentPackage.scene.sceneId); assert(links[0].inherited.length > 0); assert.equal(childPackage.scene.regional, null)
    return { packageSha256: childPackage.hash, packageBytes: childPackage.bytes, sceneId: childPackage.scene.sceneId, sourceLinks: links.length, inherited: links[0].inherited.length, sourceSceneId: links[0].sourceSceneId }
  })
  await step('regional-child-cold-reload-byte-identical', async () => {
    const oldCanvas = await page.locator('canvas[aria-label="材质场景主持人预览"]').elementHandle()
    await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click()
    // A successful cold open advances the UI session and remounts its canvas.
    // Waiting for that DOM replacement avoids reading the pre-click save label.
    await expect.poll(() => oldCanvas.evaluate(element => !element.isConnected), { timeout: 120_000 }).toBe(true)
    await rendered('河谷古道 · 下钻'); const cold = inspectPackage((await download(page.getByRole('button', { name: '完整工程', exact: true }), 'regional-child-cold.sceneweave', 'sceneweave-complete.sceneweave')).bytes, 'scene'); assert.equal(cold.hash, childPackage.hash); return { packageSha256: cold.hash, byteIdentical: true }
  })

  const images = {}
  for (const audience of ['gm', 'player']) await step(`regional-child-${audience}-4096-png`, async () => {
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: audience === 'gm' ? '主持人' : '玩家', exact: true }).click(); await rendered('河谷古道 · 下钻')
    const image = await download(page.getByRole('button', { name: '4K PNG', exact: true }), `regional-child-${audience}-4096.png`, 'sceneweave-' + audience + '-map.png'), inspection = inspectPng(image.bytes, childPackage.scene.exportBoundsMm)
    const bitmap = await page.evaluate(async encoded => { const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0)); const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); try { return { width: image.width, height: image.height } } finally { image.close() } }, image.bytes.toString('base64'))
    assert.deepEqual(bitmap, { width: inspection.width, height: inspection.height }); assert.equal(inspection.width, 4096); assert.equal(inspection.height, 4096); images[audience] = { ...inspection, nativeBitmapDecoded: bitmap }; return images[audience]
  })
  await step('final-production-guards', guards); result.images = images; result.status = 'passed'
} catch (error) {
  result.status = 'failed'; result.failure = error instanceof Error ? { message: error.message, stack: error.stack } : String(error); console.error(result.failure); process.exitCode = 1
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await writeFile(path.join(output, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => {}) }
} finally {
  result.elapsedMs = Date.now() - started
  result.cleanup = { stage: 'context' }; await saveResult()
  await context?.close()
  result.cleanup.stage = 'browser'; await saveResult()
  await browser?.close()
  result.cleanup.stage = 'server'; await saveResult()
  await server?.close()
  result.cleanup.stage = 'complete'; await saveResult()
}
