import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { chromium, expect } from '@playwright/test'
import { preview } from 'vite'

// Run after a normal build. Only UI writes in an isolated browser context;
// no source imports, storage injection, DEV hooks or user's browser profile.
const root = process.cwd(), work = path.resolve(root, 'work')
const output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? path.join(work, 'current-project-production-smoke'))
assert(output.startsWith(`${work}${path.sep}`), 'Evidence must stay in ignored work/.')
const port = Number(process.env.SCENEWEAVE_CURRENT_SMOKE_PORT ?? 5199)
assert(Number.isInteger(port) && port > 0 && port < 65536)
const base = '/sceneweave/', origin = `http://127.0.0.1:${port}`
const html = await readFile(path.join(root, 'dist/index.html'), 'utf8')
assert(!/@vite\/client|@react-refresh|\/src\/|performance\/b5/.test(html))
assert(html.includes(`src="${base}assets/`))
await mkdir(output, { recursive: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
const result = { status: 'running', method: 'Normal production build, isolated Chrome context, actual UI create/edit/undo/redo/download/cold reload. Bounded development smoke; no model, performance or formal acceptance claim.', checks: [], errors: [] }
let server, browser, page
async function step(name, run) {
  const evidence = await run()
  result.checks.push({ name, ...evidence }); console.log(`PASS ${name}`)
}
async function settled() {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
}
async function fullProject(name) {
  const pending = page.waitForEvent('download', { timeout: 120000 })
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const download = await pending, file = path.join(output, name)
  await download.saveAs(file); assert.equal(await download.failure(), null)
  const bytes = await readFile(file), files = unzipSync(bytes)
  const manifest = parse(files['manifest.json']), scene = parse(files['scene.json'])
  const identity = parse(files['identity.json']), appearance = parse(files['appearance.json'])
  assert.equal(manifest.schemaVersion, 1); assert.equal(scene.schemaVersion, 1)
  assert.equal(identity.version, 5); assert.equal(appearance.version, 2)
  assert.equal(scene.visual.version, 3)
  for (const key of ['mapMode', 'generation', 'regional', 'visual', 'decorations', 'decorationClusters', 'surfaceRules']) assert(Object.hasOwn(scene, key), key)
  assert.equal(Object.keys(files).length, manifest.entries.length + 1)
  for (const entry of manifest.entries) {
    assert(files[entry.path], entry.path)
    assert.equal(files[entry.path].length, entry.sizeBytes, entry.path)
    assert.equal(sha(files[entry.path]), entry.sha256, entry.path)
  }
  return { file, scene, manifest, contentHash: sha(Buffer.concat(Object.keys(files).sort().map(key => Buffer.concat([Buffer.from(key), files[key]])))) }
}

try {
  server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true } })
  browser = await chromium.launch({ channel: process.env.SCENEWEAVE_BROWSER_CHANNEL ?? 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, acceptDownloads: true })
  page = await context.newPage()
  page.on('pageerror', error => result.errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()) })
  page.on('response', response => { if (response.status() >= 400) result.errors.push(`${response.status()} ${response.url()}`) })
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue()
    result.errors.push(`Unexpected external request ${route.request().url()}`); return route.abort()
  })
  await page.goto(`${origin}${base}#home`)
  await step('empty legacy source is only inspected', async () => {
    await page.getByText('一次性迁入旧开发数据', { exact: true }).click()
    await page.getByRole('button', { name: '检查迁入范围' }).click()
    await expect(page.getByText(/没有可迁入的旧开发数据/)).toBeVisible()
    await expect(page.getByRole('button', { name: '迁入并切换到 v1' })).toBeDisabled()
    return {}
  })
  await step('create full current project through homepage', async () => {
    await page.getByRole('button', { name: '新建场景', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建空白场景' })
    await dialog.getByLabel('场景名称', { exact: true }).fill('通用 v1 生产自检')
    await dialog.getByLabel('画布宽度', { exact: true }).fill('18000')
    await dialog.getByLabel('画布高度', { exact: true }).fill('14000')
    await dialog.getByRole('button', { name: '创建空白场景' }).click()
    await settled()
    const initial = await fullProject('blank.sceneweave')
    assert.equal(Object.keys(initial.scene.rooms).length, 0)
    return { schemaVersion: initial.scene.schemaVersion, identity: 5, appearance: 2 }
  })
  await step('structure candidate, one adoption, undo and redo', async () => {
    await page.getByRole('tab', { name: '建筑', exact: true }).click()
    await page.getByLabel('房间名称', { exact: true }).fill('可编辑室内')
    for (const [label, value] of [['房间起点 X', '2000'], ['房间起点 Y', '2000'], ['房间宽度', '5000'], ['房间高度', '4000']]) {
      await page.getByLabel(label, { exact: true }).fill(value); await page.getByLabel(label, { exact: true }).blur()
    }
    await page.getByRole('button', { name: '预览新房间', exact: true }).click()
    await expect(page.getByRole('button', { name: '采用结构修改' })).toBeDisabled()
    await page.getByLabel('确认完整影响范围').check()
    await page.getByRole('button', { name: '采用结构修改' }).click(); await settled()
    const adopted = await fullProject('adopted.sceneweave')
    assert.equal(Object.keys(adopted.scene.rooms).length, 1)
    assert.equal(Object.values(adopted.scene.rooms)[0].purpose, '可编辑室内')
    assert.equal(Object.keys(adopted.scene.walls).length, 4)
    await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled()
    const undone = await fullProject('undone.sceneweave'); assert.equal(Object.keys(undone.scene.rooms).length, 0)
    assert(undone.scene.revision > adopted.scene.revision)
    await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled()
    const redone = await fullProject('redone.sceneweave')
    assert.deepEqual(redone.scene.rooms, adopted.scene.rooms); assert.deepEqual(redone.scene.walls, adopted.scene.walls)
    assert(redone.scene.revision > undone.scene.revision)
    return { rooms: 1, walls: 4, revisions: [adopted.scene.revision, undone.scene.revision, redone.scene.revision] }
  })
  await step('cold page reload preserves complete package entries', async () => {
    const before = await fullProject('before-reload.sceneweave')
    await page.reload()
    await page.goto(`${origin}${base}#home`)
    await expect(page.getByTestId('workspace-home')).toBeVisible()
    const projectRow = page.locator('[data-project-key^="native:"]').filter({ hasText: '通用 v1 生产自检' })
    await projectRow.getByRole('button', { name: '打开', exact: true }).click()
    await settled()
    const after = await fullProject('after-reload.sceneweave')
    assert.equal(after.contentHash, before.contentHash)
    await page.getByRole('button', { name: '重新载入已保存版本' }).click(); await settled()
    const reloaded = await fullProject('reloaded.sceneweave'); assert.equal(reloaded.contentHash, before.contentHash)
    await page.screenshot({ path: path.join(output, 'workspace.png'), fullPage: true })
    return { sceneId: after.scene.sceneId, revision: after.scene.revision, entriesHash: after.contentHash }
  })
  await step('normal production has no development or performance hooks', async () => {
    const hooks = await page.evaluate(() => Object.getOwnPropertyNames(window).filter(key => /^__sceneweave(?:.*Dev|Performance)$/i.test(key)))
    assert.deepEqual(hooks, []); assert.deepEqual(result.errors, [])
    return { hooks }
  })
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'; result.failure = String(error.stack ?? error)
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  await writeFile(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  await browser?.close(); await server?.close()
}
