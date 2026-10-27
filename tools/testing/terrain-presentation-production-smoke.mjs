import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { chromium, expect } from '@playwright/test'
import { preview } from 'vite'

// Run after a normal `npm run build`, serially with other browser work. The
// sample, persistence, package and exports are exercised only through the UI.
const root = process.cwd(), work = path.resolve(root, 'work'), dist = path.join(root, 'dist')
const output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? path.join(work, 'terrain-followup-20261027/t4-production-final'))
assert(output.startsWith(`${work}${path.sep}`), 'Raw smoke output must stay under ignored work/.')
const port = Number(process.env.SCENEWEAVE_TERRAIN_PRESENTATION_PORT ?? 5198)
assert(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid preview port.')
const base = process.env.SCENEWEAVE_BASE_PATH ?? '/sceneweave/'
assert(/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base), 'Base must be a local absolute path with trailing slash.')
const origin = `http://127.0.0.1:${port}`, url = `${origin}${base}#workspace`
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const parse = bytes => JSON.parse(decode(bytes))
await mkdir(output, { recursive: true })

const html = await readFile(path.join(dist, 'index.html'), 'utf8')
assert(!/@vite\/client|@react-refresh|\/src\/|performance\/b5/.test(html), 'Expected a normal production build.')
assert(html.includes(`src="${base}assets/`), `Production assets must use ${base}assets/.`)
const started = Date.now(), result = { status: 'running', method: 'Normal production Vite preview; actual UI opens the T4 near-side island, waits for saved/rendered state, downloads and validates the complete package, performs a saved-version cold reload, and exports actual GM/player 4096 PNGs. No DEV imports/hooks, injected state, model requests or external network.', url, output,
  checks: [], errors: [], consoleErrors: [], httpErrors: [], requestFailures: [], blockedRequests: [] }
let server, browser, context, page
const saveResult = () => writeFile(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)

async function step(name, run) {
  const start = Date.now(), observation = await run()
  result.checks.push({ name, elapsedMs: Date.now() - start, ...observation })
  console.log(`PASS ${name}`)
  await saveResult()
  return observation
}

async function settled(title) {
  await expect(page.locator('.workspace-project-title h1')).toHaveText(title, { timeout: 120_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 120_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 })
  const canvas = page.locator('canvas[aria-label="材质场景主持人预览"], canvas[aria-label="材质场景玩家预览"]').first()
  await expect(canvas).toBeVisible({ timeout: 120_000 })
  await expect.poll(() => canvas.evaluate(value => value.width > 0 && value.height > 0), { timeout: 120_000 }).toBe(true)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
}

async function productionGuards() {
  const observation = await page.evaluate(() => ({ userAgent: navigator.userAgent,
    hooks: Object.getOwnPropertyNames(window).filter(key => /^__sceneweave/i.test(key)),
    scripts: [...document.scripts].map(script => script.src).filter(Boolean) }))
  assert.deepEqual(observation.hooks, [], 'Normal production must not expose application hooks.')
  assert(observation.scripts.length > 0 && observation.scripts.every(src => {
    const target = new URL(src)
    return target.origin === origin && target.pathname.startsWith(`${base}assets/`)
  }), 'Entry scripts must come from local compiled assets.')
  assert.deepEqual(result.errors, [], 'Browser page errors occurred.')
  assert.deepEqual(result.consoleErrors, [], 'Browser console errors occurred.')
  assert.deepEqual(result.httpErrors, [], 'Production resource requests failed.')
  assert.deepEqual(result.requestFailures, [], 'A browser resource request failed.')
  assert.deepEqual(result.blockedRequests, [], 'The smoke attempted a non-preview network request.')
  return observation
}

async function download(button, name, suggestedName) {
  const pending = page.waitForEvent('download', { timeout: 120_000 })
  await button.click()
  const item = await pending
  assert.equal(item.suggestedFilename(), suggestedName)
  const file = path.join(output, name)
  await item.saveAs(file)
  assert.equal(await item.failure(), null)
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 })
  return { bytes: await readFile(file), file }
}

function inspectPackage(bytes) {
  const files = unzipSync(bytes), manifest = parse(files['manifest.json']), scene = parse(files['scene.json'])
  const identity = parse(files['identity.json']), appearance = parse(files['appearance.json']), sources = parse(files['sources.json'])
  assert.equal(manifest.format, 'sceneweave-complete-project')
  assert.equal(manifest.schemaVersion, 3)
  assert.equal(manifest.packageMode, 'complete')
  assert.equal(scene.format, 'sceneweave-scene')
  assert.equal(scene.schemaVersion, 3)
  assert.equal(scene.title, '南望苔岛 · 近侧视')
  assert.equal(scene.visual.version, 2)
  assert.equal(identity.version, 2)
  assert.equal(identity.rootSceneId, scene.sceneId)
  assert.equal(appearance.version, 2)
  assert.equal(manifest.sceneId, scene.sceneId)
  assert.equal(manifest.revision, scene.revision)
  assert.equal(Object.keys(files).length, manifest.entries.length + 1)
  const paths = new Set(manifest.entries.map(entry => entry.path))
  assert.equal(paths.size, manifest.entries.length)
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', ...paths].sort())
  for (const entry of manifest.entries) {
    assert(files[entry.path], `Missing package entry ${entry.path}`)
    assert.equal(files[entry.path].length, entry.sizeBytes, entry.path)
    assert.equal(sha256(files[entry.path]), entry.sha256, entry.path)
  }
  assert.equal(Object.keys(scene.assets).length, 20)
  assert.equal(Object.keys(sources).length, 19)
  const nearProps = Object.values(scene.props).filter(prop => prop.definitionRef?.id.startsWith('near-side-prop-'))
  assert.equal(nearProps.length, 20)
  assert(nearProps.every(prop => prop.rotationDeg === 0 && prop.footprintOffsetMm.x === 0 && prop.footprintOffsetMm.y === 0))
  for (const source of Object.values(sources)) {
    assert.equal(source.kind, 'svg')
    for (const hash of [source.sourceSha256, source.normalizedSha256]) {
      assert.equal(sha256(files[`sources/${hash}.svg`]), hash)
    }
    assert(manifest.assetRecords[source.rasterSha256], 'Each fixed source must retain its PNG record.')
  }
  assert(Object.values(scene.assets).every(asset => manifest.assetRecords[asset.sha256]), 'Complete package must retain actual asset records.')
  assert(manifest.entries.some(entry => entry.role === 'license'))
  assert(manifest.licenseBindings.length > 0 && manifest.licenseBindings.every(binding => binding.embedding === 'allowed' && files[binding.licensePath]))
  return { hash: sha256(bytes), bytes: bytes.length, entries: manifest.entries.length, assets: Object.keys(scene.assets).length,
    sources: Object.keys(sources).length, nearSideInstances: nearProps.length, revision: scene.revision, sceneId: scene.sceneId,
    exportBoundsMm: scene.exportBoundsMm }
}

async function inspectPng(bytes, audience) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  const decoded = await page.evaluate(async encoded => {
    const data = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([data], { type: 'image/png' }))
    try { return { width: image.width, height: image.height } } finally { image.close() }
  }, bytes.toString('base64'))
  assert.deepEqual(decoded, { width, height }, 'The downloaded PNG must decode to its actual dimensions.')
  const bounds = result.project.exportBoundsMm
  const scale = 4096 / Math.max(bounds.width, bounds.height)
  assert.deepEqual([width, height], [Math.round(bounds.width * scale), Math.round(bounds.height * scale)])
  assert.equal(Math.max(width, height), 4096)
  return { audience, width, height, bytes: bytes.length, sha256: sha256(bytes), nativeBitmapDecoded: decoded }
}

try {
  server = await preview({ mode: 'production', base, preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' })
  browser = await chromium.launch({ headless: true, ...(process.env.SCENEWEAVE_BROWSER_CHANNEL ? { channel: process.env.SCENEWEAVE_BROWSER_CHANNEL } : {}) })
  context = await browser.newContext({ viewport: { width: 1512, height: 982 }, acceptDownloads: true, serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const target = new URL(route.request().url())
    if (['data:', 'blob:'].includes(target.protocol) || target.origin === origin) await route.continue()
    else { result.blockedRequests.push(`${route.request().method()} ${target.origin}${target.pathname}`); await route.abort('blockedbyclient') }
  })
  context.on('response', response => { if (response.status() >= 400) result.httpErrors.push({ status: response.status(), url: response.url() }) })
  context.on('requestfailed', request => result.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }))
  page = await context.newPage()
  page.setDefaultTimeout(60_000)
  page.on('pageerror', error => result.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()) })
  await page.goto(url, { waitUntil: 'networkidle' })
  await expect(page.getByRole('tab', { name: '工程', exact: true })).toBeVisible({ timeout: 120_000 })
  await step('normal-production-entry-and-no-hooks', productionGuards)

  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await page.getByRole('button', { name: '新建近侧视苔岛', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(dialog).toBeVisible({ timeout: 120_000 })
  await expect(dialog.locator('.asset-candidate strong')).toHaveText('南望苔岛 · 近侧视', { timeout: 120_000 })
  await step('t4-sample-preparation-review', async () => ({ candidate: await dialog.locator('.asset-candidate').innerText() }))
  await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 120_000 })
  await settled('南望苔岛 · 近侧视')
  await page.screenshot({ path: path.join(output, 'workspace-near-side.png') })

  const firstDownload = await step('t4-complete-package-through-ui', async () => {
    const project = inspectPackage((await download(page.getByRole('button', { name: '完整工程', exact: true }), 'near-side-complete.sceneweave', 'sceneweave-complete.sceneweave')).bytes)
    result.project = { exportBoundsMm: project.exportBoundsMm }
    return { ...project, packageSha256: project.hash }
  })
  await step('t4-saved-version-cold-reload-byte-identical', async () => {
    const oldCanvas = await page.locator('canvas[aria-label="材质场景主持人预览"]').elementHandle()
    await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click()
    await expect.poll(() => oldCanvas.evaluate(element => !element.isConnected), { timeout: 120_000 }).toBe(true)
    await settled('南望苔岛 · 近侧视')
    const cold = inspectPackage((await download(page.getByRole('button', { name: '完整工程', exact: true }), 'near-side-cold.sceneweave', 'sceneweave-complete.sceneweave')).bytes)
    assert.equal(cold.hash, firstDownload.packageSha256)
    await page.screenshot({ path: path.join(output, 'workspace-near-side-cold.png') })
    return { packageSha256: cold.hash, byteIdentical: true, revision: cold.revision }
  })

  for (const audience of ['gm', 'player']) await step(`t4-${audience}-actual-4k-png`, async () => {
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: audience === 'gm' ? '主持人' : '玩家', exact: true }).click()
    await settled('南望苔岛 · 近侧视')
    const image = await download(page.getByRole('button', { name: '4K PNG', exact: true }), `near-side-${audience}-4096.png`, `sceneweave-${audience}-map.png`)
    const inspection = await inspectPng(image.bytes, audience)
    await page.screenshot({ path: path.join(output, `near-side-${audience}-preview.png`) })
    return inspection
  })
  await step('final-production-guards', productionGuards)
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.failure = error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
  console.error(result.failure)
  process.exitCode = 1
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    await writeFile(path.join(output, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => {})
  }
} finally {
  result.elapsedMs = Date.now() - started
  await saveResult()
  await context?.close()
  await browser?.close()
  await server?.close()
}
