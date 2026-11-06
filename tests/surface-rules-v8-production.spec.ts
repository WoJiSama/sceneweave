import { openGenerationTask, openGenerationSettings } from './workspace-navigation-helpers'
import { projectBackupButton, reloadSaved } from './workspace-ux-helpers'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { unzipSync } from 'fflate'
import { expect, test, type Page } from '@playwright/test'
import { loadAiConfig } from '../services/ai/config'
import { createAiApp, connectionInfo } from '../services/ai/app'
import { TaskEngine } from '../services/ai/engine'
import { TaskStore } from '../services/ai/store'
import type { ProviderCompletion } from '../services/ai/provider-types'

let backendUrl = '', token = '', directory = '', store: TaskStore, engine: TaskEngine
let server: ReturnType<typeof serve>, providerCalls = 0

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sceneweave-surface-v8-production-'))
  token = randomBytes(24).toString('hex')
  const appOrigin = new URL(process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173').origin
  const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: appOrigin,
    SCENEWEAVE_AI_ACCESS_TOKEN: token, SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1',
    SCENEWEAVE_AI_PROVIDER_API_KEY: 'surface-v8-test-not-a-live-key', SCENEWEAVE_AI_PROVIDER_MODEL: 'surface-v8-fixture' })
  store = new TaskStore(directory)
  engine = new TaskEngine(store, { async complete(): Promise<ProviderCompletion> { providerCalls++; throw new Error('This workflow must not call a model.') } }, connectionInfo(config))
  server = serve({ fetch: createAiApp(config, { store, engine }).fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => { if (server.listening) resolve(); else server.once('listening', resolve) })
  backendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  engine?.close()
  if (server && 'closeAllConnections' in server) server.closeAllConnections()
  await new Promise<void>(resolve => server?.close(() => resolve()))
  store?.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
}

async function exportPackage(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (await projectBackupButton(page)).click(),
  ])
  const path = await download.path()
  if (!path) throw new Error('The complete-project download did not produce a file.')
  return new Uint8Array(readFileSync(path))
}

function packageHash(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex') }
function packageScene(bytes: Uint8Array) {
  const archive = unzipSync(bytes), decode = new TextDecoder()
  const manifest = JSON.parse(decode.decode(archive['manifest.json']))
  const scene = JSON.parse(decode.decode(archive['scene.json']))
  return { manifest, scene }
}

test('normal production UI negotiates the v6 selector and saves a v8 surface-rules project without AI continuation', async ({ page }) => {
  test.setTimeout(360_000)
  const errors: string[] = [], capabilityUrls: string[] = [], generationRequests: any[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin !== backendUrl) return
    if (url.pathname === '/v1/capabilities') capabilityUrls.push(url.toString())
    if (url.pathname === '/v1/terrain/basemap' && request.method() === 'POST') generationRequests.push({ url: url.toString(), body: request.postDataJSON() })
  })

  await page.goto(process.env.SCENEWEAVE_TEST_BASE_URL
    ? new URL('#home', process.env.SCENEWEAVE_TEST_BASE_URL).toString()
    : '/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('连续地表生产旅程')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('24')
  await dialog.getByLabel('画布高度', { exact: true }).fill('18')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await saved(page)
  await openGenerationTask(page, '自然地形')
  await openGenerationSettings(page)
  await page.getByLabel('程序底图生成位置', { exact: true }).selectOption('server')
  await page.getByLabel('程序底图地表外观', { exact: true }).selectOption('surface-rules')
  await page.getByLabel('程序底图后端地址', { exact: true }).fill(backendUrl)
  await page.getByLabel('程序底图应用访问凭据', { exact: true }).fill(token)
  await expect(page.getByText(/当前 AI 接续尚不支持这一工程格式/)).toBeVisible()
  const original = await exportPackage(page)
  const originalHash = packageHash(original)

  const candidate = page.getByRole('article', { name: '当前地形候选', exact: true })
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  await expect(candidate).toBeVisible({ timeout: 240_000 })
  await expect(candidate.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90_000 })
  await expect(page.locator('.asset-structure-preview')).toContainText('此v8候选当前仅可直接采用')
  await expect(page.getByRole('button', { name: '继续用 AI 修改底图', exact: true })).toHaveCount(0)
  await candidate.getByRole('button', { name: '取消当前地形候选', exact: true }).click()
  await expect(candidate).toBeHidden()
  expect(packageHash(await exportPackage(page))).toBe(originalHash)

  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  await expect(candidate).toBeVisible({ timeout: 240_000 })
  await expect(page.locator('.asset-structure-preview')).toContainText('此v8候选当前仅可直接采用')
  await candidate.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
  await expect(candidate).toBeHidden({ timeout: 90_000 })
  await saved(page)

  const adopted = await exportPackage(page), adoptedHash = packageHash(adopted), state = packageScene(adopted)
  expect(state.manifest.schemaVersion).toBe(8)
  expect(state.scene.schemaVersion).toBe(8)
  expect(Object.keys(state.scene.surfaceRules ?? {}).length).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: '继续用 AI 修改底图', exact: true })).toHaveCount(0)

  await reloadSaved(page)
  await saved(page)
  expect(packageHash(await exportPackage(page))).toBe(adoptedHash)
  expect(capabilityUrls).toHaveLength(2)
  expect(capabilityUrls.every(value => value.includes('baseMapSelector=terrain-scene-v6'))).toBe(true)
  expect(generationRequests).toHaveLength(2)
  for (const request of generationRequests) {
    expect(request.url).toContain('?baseMapVersion=3')
    expect(request.body.version).toBe(3)
    expect(request.body.generation).toMatchObject({ kind: 'terrain', input: { algorithmVersion: 6 } })
  }
  expect(providerCalls).toBe(0)
  expect(store.count()).toBe(0)
  expect(errors).toEqual([])
})
