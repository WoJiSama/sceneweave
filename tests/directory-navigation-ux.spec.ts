import { expect, test, type Page } from '@playwright/test'
import type { ProjectDirectoryPage } from '../src/application/ports/project-directory'
import { openWorkspaceModule } from './workspace-navigation-helpers'

// Development UI regression: controlled delays use Vite's source-module entry.

const home = (page: Page) => page.getByTestId('workspace-home')
const history = (page: Page) => page.getByRole('region', { name: '命名历史', exact: true })
const directoryPage = (title: string, next = false): ProjectDirectoryPage => ({
  entries: [{ sceneId: title, summary: { sceneId: title, title, revision: 0, savedAt: '2026-11-08T12:00:00.000Z', conversionJobId: null }, issue: null, contentStatus: 'not-checked' }],
  next: next ? { sceneId: title, savedAt: '2026-11-08T12:00:00.000Z' } : null, total: next ? 2 : 1,
})
async function createBlank(page: Page, title: string) {
  await home(page).getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.asset-header-title').getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-busy')).toHaveCount(0)
}
async function openHistory(page: Page) {
  await openWorkspaceModule(page, '历史')
  await expect(history(page).getByLabel('完整保存版本', { exact: true })).toBeEnabled()
}

test('home search failures discard old cursors and late pages cannot replace a newer search', async ({ page }) => {
  await page.goto('./#home')
  await expect(home(page).getByRole('button', { name: '刷新工程列表', exact: true })).toBeEnabled()
  await page.evaluate(async () => {
    const path = '/src/platform/browser/runtime.ts', { projectRepository } = await import(path) as typeof import('../src/platform/browser/runtime')
    type Query = Parameters<typeof projectRepository.projectDirectory>[0]
    type Result = Awaited<ReturnType<typeof projectRepository.projectDirectory>>
    const requests: { query: Query; resolve: (value: Result) => void; reject: (error: Error) => void }[] = []
    Reflect.set(window, '__directoryUiRequests', requests)
    projectRepository.projectDirectory = query => new Promise((resolve, reject) => requests.push({ query, resolve, reject }))
  })
  const count = () => page.evaluate(() => Reflect.get(window, '__directoryUiRequests').length as number)
  const resolve = (index: number, value: ProjectDirectoryPage) => page.evaluate(({ index, value }) => Reflect.get(window, '__directoryUiRequests')[index].resolve(value), { index, value })
  await home(page).getByRole('button', { name: '刷新工程列表', exact: true }).click()
  await expect.poll(count).toBe(1); await resolve(0, directoryPage('Alpha', true))
  await expect(home(page).getByRole('button', { name: '加载更多工程', exact: true })).toBeEnabled()
  await home(page).getByLabel('搜索最近工程', { exact: true }).fill('Beta')
  await expect.poll(count).toBe(2)
  await page.evaluate(() => Reflect.get(window, '__directoryUiRequests')[1].reject(new Error('Controlled directory failure')))
  await expect(home(page).getByRole('alert')).toContainText('Controlled directory failure')
  await expect(home(page).getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible()
  await expect(home(page).getByRole('button', { name: '加载更多工程', exact: true })).toHaveCount(0)
  await home(page).getByRole('button', { name: '刷新工程列表', exact: true }).click()
  await expect.poll(count).toBe(3)
  expect(await page.evaluate(() => Reflect.get(window, '__directoryUiRequests')[2].query)).toEqual({ query: 'Beta', limit: 50 })
  await resolve(2, directoryPage('Beta', true))
  await home(page).getByRole('button', { name: '加载更多工程', exact: true }).click()
  await expect.poll(count).toBe(4)
  await home(page).getByLabel('搜索最近工程', { exact: true }).fill('Gamma')
  await expect.poll(count).toBe(5); await resolve(4, directoryPage('Gamma'))
  await resolve(3, directoryPage('Late Beta'))
  await expect(home(page).locator('.home-project-row')).toHaveCount(1)
  await expect(home(page).getByRole('heading', { name: 'Gamma', exact: true })).toBeVisible()
  await expect(home(page).getByText('打开工程时会检查完整内容', { exact: false })).toBeVisible()
})

test('history storage checks recover after refresh failure and ignore results from the previous project', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('./#home')
  await createBlank(page, '目录检查源工程')
  await page.evaluate(async () => {
    const path = '/src/editor/main/repository.ts', { WorkspaceRepository } = await import(path) as typeof import('../src/editor/main/repository')
    const directory = WorkspaceRepository.prototype.historyDirectory, usage = WorkspaceRepository.prototype.usage
    type Usage = Awaited<ReturnType<typeof usage>>
    const control = { failDirectory: false, holdUsage: true, directoryReads: 0, usageReads: 0, pending: [] as { resolve: (value: Usage) => void; value: Usage }[] }
    Reflect.set(window, '__historyDirectoryUi', control)
    WorkspaceRepository.prototype.historyDirectory = function (sceneId: string) {
      control.directoryReads++
      return control.failDirectory ? Promise.reject(new Error('Controlled history directory failure')) : directory.call(this, sceneId)
    }
    WorkspaceRepository.prototype.usage = async function (sceneId: string) {
      control.usageReads++
      const value = await usage.call(this, sceneId)
      return control.holdUsage ? new Promise<Usage>(resolve => control.pending.push({ resolve, value })) : value
    }
  })
  await openHistory(page)
  expect(await page.evaluate(() => Reflect.get(window, '__historyDirectoryUi').usageReads)).toBe(0)
  await history(page).getByRole('button', { name: '检查容量与迁移原件', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__historyDirectoryUi').pending.length)).toBe(1)
  await page.evaluate(() => { Reflect.get(window, '__historyDirectoryUi').failDirectory = true })
  await history(page).getByRole('button', { name: '刷新历史', exact: true }).click()
  await expect(history(page).getByRole('alert')).toContainText('Controlled history directory failure')
  await expect(history(page).getByRole('button', { name: '检查容量与迁移原件', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const control = Reflect.get(window, '__historyDirectoryUi'), pending = control.pending.shift()
    pending.resolve(pending.value); control.failDirectory = false; control.holdUsage = false
  })
  await expect(history(page).locator('.history-usage')).toHaveCount(0)
  await history(page).getByRole('button', { name: '重试读取历史', exact: true }).click()
  await expect(history(page).getByLabel('完整保存版本', { exact: true })).toBeEnabled()
  await history(page).getByRole('button', { name: '检查容量与迁移原件', exact: true }).click()
  await expect(history(page).locator('.history-usage')).toBeVisible()
  await page.evaluate(() => { Reflect.get(window, '__historyDirectoryUi').holdUsage = true })
  await history(page).getByRole('button', { name: '检查容量与迁移原件', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__historyDirectoryUi').pending.length)).toBe(1)
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(home(page)).toBeVisible()
  await createBlank(page, '目录检查目标工程'); await openHistory(page)
  await page.evaluate(() => {
    const pending = Reflect.get(window, '__historyDirectoryUi').pending.shift()
    pending.resolve({ ...pending.value, resourceBytes: 99 * 1024 * 1024 })
  })
  await expect(history(page).locator('.history-usage')).toHaveCount(0)
  await expect(history(page).getByRole('button', { name: '检查容量与迁移原件', exact: true })).toBeEnabled()
  await expect(history(page).getByText('这里只展示历史目录。查看、恢复或导出时会检查对应完整内容。', { exact: true })).toBeVisible()
})
