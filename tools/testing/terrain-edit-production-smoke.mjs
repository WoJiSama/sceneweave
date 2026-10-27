import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { chromium, expect } from '@playwright/test'
import { preview } from 'vite'

// Normal build only. All application writes use the UI; no DEV hooks or paid calls.
const root = process.cwd(), work = path.join(root, 'work'), output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? path.join(work, 'terrain-t2-20261026/production'))
assert(output.startsWith(work + path.sep))
await mkdir(output, { recursive: true })
const port = Number(process.env.SCENEWEAVE_TERRAIN_SMOKE_PORT ?? 5196), origin = `http://127.0.0.1:${port}`, base = '/sceneweave/'
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), parse = bytes => JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes))
const result = { status: 'running', checks: [], errors: [], workers: [], method: 'Normal Vite production UI, actual bundled edit Worker, keyboard strokes, preview/cancel, protected adoption, single undo/redo, cold reload and complete package hash. No DEV imports, injected app data, network or model requests.' }
const started = Date.now(); let server, browser, context, page
async function record(name, action) { const time = Date.now(), observation = await action(); result.checks.push({ name, elapsedMs: Date.now() - time, ...observation }); console.log(`PASS ${name}`); await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); return observation }
async function rendered() { await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90000 }); await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 }) }
async function saved() { await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 }); await rendered() }
async function download(name) { const event = page.waitForEvent('download', { timeout: 120000 }); await page.getByRole('button', { name: '完整工程', exact: true }).click(); const downloaded = await event, file = path.join(output, name); await downloaded.saveAs(file); return readFile(file) }
function inspect(bytes) { const files = unzipSync(bytes), manifest = parse(files['manifest.json']), scene = parse(files['scene.json']); assert.equal(manifest.schemaVersion, 3); assert.equal(scene.schemaVersion, 3); for (const entry of manifest.entries) { assert.equal(files[entry.path].length, entry.sizeBytes); assert.equal(hash(files[entry.path]), entry.sha256) }; return { scene, hash: hash(bytes), entries: manifest.entries.length } }
async function numeric(mode, x, y) {
  await page.getByRole('button', { name: mode, exact: true }).click()
  await page.getByLabel('地形编辑笔刷半径 mm', { exact: true }).fill('300')
  const detail = page.locator('.terrain-editing-panel details').filter({ has: page.locator('summary', { hasText: '键盘落笔' }) })
  if (!await detail.evaluate(node => node.open)) await detail.locator('summary').click()
  await page.getByLabel('地形编辑落笔 X mm', { exact: true }).fill(String(x)); await page.getByLabel('地形编辑落笔 Y mm', { exact: true }).fill(String(y))
  await page.getByRole('button', { name: '添加落笔并预览', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90000 })
  await expect(page.locator('.terrain-generation-progress')).toHaveCount(0, { timeout: 90000 })
  await rendered()
}
try {
  const index = await readFile(path.join(root, 'dist/index.html'), 'utf8'); assert(index.includes(`src="${base}assets/`)); assert(!/@vite\/client|\/src\//.test(index))
  server = await preview({ root, preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' })
  browser = await chromium.launch({ headless: true }); context = await browser.newContext({ viewport: { width: 1512, height: 982 }, acceptDownloads: true })
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue(); result.errors.push(`External request ${url.origin}`); return route.abort() })
  page = await context.newPage(); page.on('pageerror', error => result.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()) }); page.on('response', response => { if (response.status() >= 400) result.errors.push(`HTTP${response.status()} ${response.url()}`) }); page.on('worker', worker => result.workers.push(worker.url()))
  await page.goto(`${origin}${base}#workspace`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await page.getByRole('button', { name: '选择岩岛地形', exact: true }).click(); await page.getByRole('textbox', { name: '地形方案种子', exact: true }).fill('terrain-v1-0')
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click(); await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90000 }); await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click(); await saved()
  const original = inspect(await download('before.sceneweave'))
  await record('production-entry-and-generation1-baseline', async () => { assert.equal(original.scene.generation.version, 1); const hooks = await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => /^__sceneweave/i.test(key))); assert.deepEqual(hooks, []); return { hash: original.hash, revision: original.scene.revision, hooks } })
  await record('real-edit-worker-preview-cancel-byte-identical', async () => {
    await numeric('清出空地', 2000, 2000); await page.screenshot({ path: path.join(output, 'clear-preview.png') }); await page.getByRole('button', { name: '取消局部地形预览', exact: true }).click(); await saved()
    const unchanged = inspect(await download('cancelled.sceneweave')); assert.equal(unchanged.hash, original.hash)
    return { unchanged: true }
  })
  let adopted
  await record('protected-multi-stroke-adoption-and-complete-closure', async () => {
    await numeric('清出空地', 2000, 2000)
    await page.getByLabel('地形编辑落笔 X mm', { exact: true }).fill('3000'); await page.getByLabel('地形编辑落笔 Y mm', { exact: true }).fill('2000'); await page.getByRole('button', { name: '添加落笔并预览', exact: true }).click()
    await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90000 }); await expect(page.locator('.terrain-generation-progress')).toHaveCount(0, { timeout: 90000 })
    await page.getByLabel('确认本次地形影响范围', { exact: true }).check(); await page.getByRole('button', { name: '保护并采用地形修改', exact: true }).click(); await saved()
    adopted = inspect(await download('adopted.sceneweave')); assert.equal(adopted.scene.generation.version, 2); assert.equal(Object.keys(adopted.scene.generation.strokes).length, 2); assert.equal(adopted.scene.revision, original.scene.revision + 1); assert.deepEqual(adopted.scene.props, original.scene.props); assert.deepEqual(adopted.scene.terrainAreas, original.scene.terrainAreas)
    return { hash: adopted.hash, entries: adopted.entries, revision: adopted.scene.revision, strokes: Object.keys(adopted.scene.generation.strokes).length }
  })
  await record('one-undo-and-redo-restore-full-generation', async () => {
    await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await saved(); const undone = inspect(await download('undo.sceneweave')); assert.deepEqual(undone.scene.generation, original.scene.generation); assert.equal(undone.scene.revision, adopted.scene.revision + 1)
    await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await saved(); const redone = inspect(await download('redo.sceneweave')); assert.deepEqual(redone.scene.generation, adopted.scene.generation); assert.equal(redone.scene.revision, adopted.scene.revision + 2); adopted = redone
    return { undoRevision: undone.scene.revision, redoRevision: redone.scene.revision }
  })
  await record('cold-ui-reload-package-identical', async () => { await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await saved(); const cold = inspect(await download('cold.sceneweave')); assert.equal(cold.hash, adopted.hash); return { hash: cold.hash } })
  await record('compiled-edit-worker-and-production-errors', async () => { const edit = result.workers.filter(url => /edit-worker-.*\.js$/.test(url)); assert(edit.length >= 3); for (const url of edit) { const target = new URL(url); assert.equal(target.origin, origin); const bytes = await readFile(path.join(root, 'dist', target.pathname.slice(base.length))); assert(!/__sceneweave.*Dev|@vite\/client/.test(bytes.toString())); result.checks.push({ workerSha256: hash(bytes), asset: target.pathname }) }; assert.deepEqual(result.errors, []); return { editWorkers: edit.length, errors: 0 } })
  await page.screenshot({ path: path.join(output, 'cold-saved.png') }); result.status = 'passed'
} catch (error) { result.status = 'failed'; result.failure = { message: error.message, stack: error.stack }; console.error(error); process.exitCode = 1; if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); await writeFile(path.join(output, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')) } }
finally { result.elapsedMs = Date.now() - started; await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); await context?.close(); await browser?.close(); if (server) await new Promise(done => server.httpServer.close(done)) }
