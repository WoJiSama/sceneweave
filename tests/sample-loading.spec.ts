import { expect, test, type Page } from '@playwright/test'

// Targeted loading/cancellation checks; timings here do not certify the deferred performance matrix.
const home = (page: Page) => page.getByTestId('workspace-home')
const library = (page: Page) => page.getByRole('region', { name: '组件素材库', exact: true })
const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []; pageErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]) })

async function current(page: Page) {
  return page.evaluate(async () => {
    const workspacePath = '/src/editor/main/Workbench.tsx', runtimePath = '/src/platform/browser/runtime.ts'
    const { nativeWorkspace } = await import(workspacePath) as typeof import('../src/editor/main/Workbench')
    const { projectRepository } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const state = nativeWorkspace.getState(), project = state.project
    if (!project) throw new Error('Expected the actual native workspace project.')
    return { document: structuredClone(project.document), identity: structuredClone(project.historyIdentity),
      appearance: structuredClone(project.appearance), assetCount: Object.keys(project.assets).length,
      status: state.status, canUndo: state.canUndo, canRedo: state.canRedo, checkpoint: nativeWorkspace.checkpoint(),
      sceneIds: (await projectRepository.list()).map(value => value.sceneId).sort() }
  })
}

async function settled(page: Page) {
  await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}

async function createBlank(page: Page, title: string) {
  await page.goto('/#home')
  await home(page).getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page)
}

async function placeExistingLamp(page: Page) {
  const lib = library(page)
  await lib.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  await lib.getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await settled(page)
  await lib.getByLabel('搜索组件素材', { exact: true }).fill('')
}

test('sample loading shows preparation before blocked image bytes and cancels without changing the current branch', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createBlank(page, '加载取消保护当前工程')
  await placeExistingLamp(page)
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(home(page)).toBeVisible()
  const before = await current(page)
  expect(before.canUndo).toBe(true)

  let heldUrl = '', release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const pattern = '**/assets/sceneweave-handdrawn/*.png'
  await page.route(pattern, async route => {
    if (heldUrl) { await route.continue(); return }
    heldUrl = route.request().url()
    const response = await route.fetch()
    await gate
    // Chromium may already have cancelled this request; a late network completion must not publish a candidate.
    await route.fulfill({ response }).catch(() => {})
  })
  try {
    await home(page).getByRole('button', { name: '书房与露台', exact: true }).click()
    const preparation = page.getByRole('dialog', { name: '准备打开工程', exact: true })
    await expect(preparation).toBeVisible()
    await expect(preparation.getByLabel('工程准备进度', { exact: true })).toBeVisible()
    await expect.poll(() => heldUrl).not.toBe('')
    await expect(page.getByRole('dialog', { name: '确认打开工程', exact: true })).toHaveCount(0)
    expect(await current(page)).toEqual(before)
    await preparation.getByRole('button', { name: '取消准备', exact: true }).click()
    release()
    await expect(preparation).toHaveCount(0, { timeout: 30_000 })
    await settled(page)
    await expect(page.getByRole('dialog', { name: '确认打开工程', exact: true })).toHaveCount(0)
    expect(await current(page)).toEqual(before)
  } finally {
    release()
    await page.unroute(pattern)
  }

  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await home(page).getByRole('button', { name: '书房与露台', exact: true }).click()
  const candidate = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(candidate).toBeVisible({ timeout: 30_000 })
  expect(await current(page)).toEqual(before)
  await candidate.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(candidate).toHaveCount(0); await settled(page)
  const after = await current(page)
  expect(after.document.sceneId).not.toBe(before.document.sceneId)
  expect(after.sceneIds).toHaveLength(before.sceneIds.length + 1)
  const original = await page.evaluate(async sceneId => {
    const path = '/src/platform/browser/runtime.ts'
    const { projectRepository } = await import(path) as typeof import('../src/platform/browser/runtime')
    return (await projectRepository.load(sceneId))?.project.document
  }, before.document.sceneId)
  expect(original).toEqual(before.document)
  await info.attach('sample-cancellation.json', { body: JSON.stringify({ heldUrl, originalSceneId: before.document.sceneId,
    originalRevision: before.document.revision, originalCanUndo: before.canUndo, openedSceneId: after.document.sceneId,
    originalPreserved: true, cancelledPreparationCreatedNoScene: true }), contentType: 'application/json' })
})

test('builtin resources load only on explicit demand, allow a failed read to retry and survive Home continuation', async ({ page }, info) => {
  test.setTimeout(120_000)
  const contentRequests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/assets/sceneweave-handdrawn-content/')) contentRequests.push(request.url()) })
  await createBlank(page, '按需加载完整内置目录')
  expect(contentRequests).toHaveLength(0)
  await placeExistingLamp(page)
  expect(contentRequests).toHaveLength(0)
  const before = await current(page), lib = library(page)

  let failures = 0
  const pattern = '**/assets/sceneweave-handdrawn-content/*.png'
  await page.route(pattern, async route => {
    if (!failures) { failures++; await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Deliberate unavailable builtin resource.' }) }
    else await route.continue()
  })
  await lib.getByRole('button', { name: '内置素材', exact: true }).click()
  const retry = lib.getByRole('button', { name: '重试内置素材', exact: true })
  await expect(retry).toBeVisible({ timeout: 30_000 })
  expect(failures).toBe(1)
  expect(contentRequests.length).toBeGreaterThan(0)
  expect(await current(page)).toEqual(before)
  await retry.click()
  await expect(lib.locator('.asset-section-heading > span')).toHaveText('62', { timeout: 30_000 })
  await expect(lib.locator('.catalog-count')).toContainText('62 项匹配')
  await expect(retry).toHaveCount(0)
  const requestCount = contentRequests.length
  expect(await current(page)).toEqual(before)

  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await home(page).getByRole('button', { name: '继续编辑', exact: true }).first().click(); await settled(page)
  await expect(lib.locator('.asset-section-heading > span')).toHaveText('62')
  expect(contentRequests).toHaveLength(requestCount)
  expect(await current(page)).toEqual(before)
  await page.unroute(pattern)
  await info.attach('builtin-demand.json', { body: JSON.stringify({ additionalContentRequestsBeforeDemand: 0,
    deliberateFailures: failures, additionalContentRequestsAfterRetry: requestCount,
    catalogItems: 62, continuationAddedRequests: contentRequests.length - requestCount,
    sceneRevision: before.document.revision }), contentType: 'application/json' })
})

test('SCN-01 explicitly adopts its seven missing furniture assets without browsing the builtin directory', async ({ page }, info) => {
  test.setTimeout(120_000)
  let contentRequests = 0
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/assets/sceneweave-handdrawn-content/')) contentRequests++ })
  await createBlank(page, '分步制作按需读取缺少素材')
  expect(contentRequests).toBe(0)
  const before = await current(page)
  await page.getByTestId('workspace-resources').getByRole('tab', { name: '工程', exact: true }).click()
  await page.locator('.workspace-authoring-details > summary').click()
  const guide = page.getByRole('region', { name: '场景分步制作', exact: true })
  await guide.getByLabel('制作基线', { exact: true }).selectOption('scn-01')
  await expect(guide).toContainText('基础家具尚缺 7 件固定素材')
  await guide.getByRole('button', { name: '预览采用缺少的室内素材', exact: true }).click()
  const adopt = page.getByRole('button', { name: '采用组件修改', exact: true })
  await expect(adopt).toBeVisible({ timeout: 30_000 })
  expect(contentRequests).toBeGreaterThan(0)
  expect(await current(page)).toEqual(before)
  await adopt.click(); await expect(adopt).toHaveCount(0); await settled(page)
  const after = await current(page)
  expect(after.document.sceneId).toBe(before.document.sceneId)
  expect(after.document.revision).toBe(before.document.revision + 1)
  expect(after.assetCount).toBe(before.assetCount + 7)
  expect(after.assetCount).toBe(41)
  expect(after.document.props).toEqual(before.document.props)
  expect(after.document.rooms).toEqual(before.document.rooms)
  expect(Object.keys(after.document.propDefinitions).filter(id => !before.document.propDefinitions[id])).toHaveLength(7)
  await expect(guide.getByRole('button', { name: '预览采用缺少的室内素材', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await current(page)
  expect(undone.document.props).toEqual(before.document.props)
  expect(undone.document.rooms).toEqual(before.document.rooms)
  expect(undone.assetCount).toBe(before.assetCount)
  await expect(guide.getByRole('button', { name: '预览采用缺少的室内素材', exact: true })).toBeVisible()
  await info.attach('authoring-demand.json', { body: JSON.stringify({ sceneId: before.document.sceneId,
    initialAssets: before.assetCount, adoptedAssets: after.assetCount, undoAssets: undone.assetCount,
    explicitDemandContentRequests: contentRequests, installedFurniture: 7 }), contentType: 'application/json' })
})
