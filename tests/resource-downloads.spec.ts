import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openOutdoorTask } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

const fixedImage = /\/assets\/sceneweave-handdrawn[^/]*\/[^/]+\.png$/
const fixed = JSON.parse(await readFile(new URL('../src/platform/browser/content/builtin-data.json', import.meta.url), 'utf8')) as typeof import('../src/platform/browser/content/builtin-data.json')
const scenes = JSON.parse(await readFile(new URL('../src/platform/browser/content/scenes-data.json', import.meta.url), 'utf8')) as typeof import('../src/platform/browser/content/scenes-data.json')
const paths = { ...scenes.paths, ...fixed.paths } as Record<string, string>
const catalog = fixed.project.document
const imageHash = (id: string) => (catalog.assets as Record<string, { sha256: string }>)[id].sha256
const grass = imageHash(catalog.materials['b3-m-01'].textureAssetId)
const desk = imageHash(catalog.propDefinitions['b2-p-01'].defaultAppearance.assetId)

function watchImages(page: Page) {
  const requests: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (fixedImage.test(path)) requests.push(path.slice(path.indexOf('assets/')))
  })
  return requests
}
async function openDownloads(page: Page) {
  await page.getByRole('button', { name: '自选下载', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '自选下载' })
  await expect(dialog.getByText(/^(未下载 \d+ 项|本目录的素材图片已全部下载)/)).toBeVisible()
  return dialog
}

test('a narrow picker lists missing resources without fetching pictures and resumes a shared prefab download', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  const requests = watchImages(page)
  await page.goto('./#home')
  await expect(page.getByRole('button', { name: '自选下载', exact: true })).toBeVisible()
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/ResourceDownloadPanel')))).toBe(false)
  let dialog = await openDownloads(page)
  expect(requests).toEqual([])
  await expect(dialog.getByRole('button', { name: '下载所选' })).toBeDisabled()
  const withinScreen = () => dialog.evaluate(element => {
    const { left, right, top, bottom } = element.getBoundingClientRect()
    return left >= 0 && right <= innerWidth && top >= 0 && bottom <= innerHeight && element.scrollWidth <= element.clientWidth
  })
  expect(await withinScreen()).toBe(true)
  await dialog.getByRole('checkbox', { name: '深橡木书桌', exact: true }).check()
  await dialog.getByRole('button', { name: '下载所选' }).click()
  await expect(dialog.getByRole('checkbox', { name: '深橡木书桌', exact: true })).toHaveCount(0)
  expect(requests).toEqual([paths[desk]])

  const search = dialog.getByRole('searchbox')
  await search.fill('书桌六件组')
  await dialog.getByRole('checkbox', { name: '书桌六件组', exact: true }).check()
  const members = catalog.prefabDefinitions['b2-pf-01'].members
  const expected = new Set(members.map(({ propTemplate }) => paths[imageHash(propTemplate.appearance.assetId)]))
  expect(expected.has(paths[desk])).toBe(true)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route(fixedImage, async route => { await pending; await route.continue() })
  try {
    await dialog.getByRole('button', { name: '下载所选' }).click()
    await expect(dialog.getByRole('progressbar')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: '自选下载' })).toBeFocused()
    dialog = await openDownloads(page)
    await expect(dialog.getByRole('progressbar')).toBeVisible()
  } finally { release() }
  await expect(dialog.getByRole('checkbox', { name: '书桌六件组', exact: true })).toHaveCount(0)
  expect(requests.sort()).toEqual([...expected].sort())
  await dialog.getByRole('button', { name: '关闭自选下载' }).click()
  await page.reload()
  dialog = await openDownloads(page)
  await expect(dialog.getByRole('checkbox', { name: '书桌六件组', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('checkbox', { name: '深橡木书桌', exact: true })).toHaveCount(0)
  expect(requests).toHaveLength(expected.size)
  await dialog.getByRole('button', { name: '关闭自选下载' }).click()
  await expect(page.getByText('此浏览器还没有工程', { exact: true })).toBeVisible()
})

test('download all covers the full unfiltered image set, keeps successes and retries just the failed file', async ({ page }) => {
  const requests = watchImages(page)
  let failing = true
  await page.route('**/' + paths[grass], route => failing ? route.fulfill({ status: 503 }) : route.continue())
  await page.goto('./#tutorial')
  let dialog = await openDownloads(page)
  await dialog.getByRole('searchbox').fill('簇生草地')
  expect(requests).toEqual([])
  await dialog.getByRole('button', { name: '全部下载' }).click()
  const retry = dialog.getByRole('button', { name: '重试失败项' })
  await expect(retry).toBeVisible({ timeout: 30000 })
  expect([...requests].sort()).toEqual([...new Set(Object.values(paths))].sort())
  await expect(dialog.getByRole('checkbox', { name: '簇生草地', exact: true })).toBeVisible()
  await expect(dialog.getByText('1 张图片下载失败。已完成的图片已保存。')).toBeVisible()
  failing = false
  await retry.click()
  await expect(dialog.getByText('本目录的素材图片已全部下载')).toBeVisible()
  expect(requests.at(-1)).toBe(paths[grass])
  expect(requests.length).toBe(Object.keys(paths).length + 1)
  await page.reload()
  dialog = await openDownloads(page)
  await expect(dialog.getByText('本目录的素材图片已全部下载')).toBeVisible()
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '全部下载' })).toBeDisabled()
  await dialog.getByRole('button', { name: '关闭自选下载' }).click()
  // Clearing the actual cached response must bring just this material back.
  await page.evaluate(async hash => {
    const cache = await caches.open((await caches.keys()).find(name => name.startsWith('sceneweave-fixed-images-'))!)
    const key = (await cache.keys()).find(request => request.url.endsWith('/' + hash))!
    await cache.delete(key)
  }, grass)
  dialog = await openDownloads(page)
  await expect(dialog.getByRole('checkbox')).toHaveCount(1)
  await expect(dialog.getByRole('checkbox', { name: '簇生草地', exact: true })).toBeVisible()
  expect(requests.length).toBe(Object.keys(paths).length + 1)
})

test('the workspace uses its saved starter images and a prefetched material survives a cold editing session', async ({ page }, info) => {
  test.setTimeout(90000)
  const title = '复用自选下载的材质'
  await createKeyboardProject(page, title)
  const requests = watchImages(page), shell = page.getByTestId('outdoor-workbench')
  const dialog = await openDownloads(page)
  for (const name of ['院落土砾', '磨损木板']) await expect(dialog.getByRole('checkbox', { name, exact: true })).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: '簇生草地', exact: true }).check()
  await dialog.getByRole('button', { name: '下载所选' }).click()
  await expect(dialog.getByRole('checkbox', { name: '簇生草地', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '关闭自选下载' }).click()
  await expect(shell).toHaveAttribute('data-revision', '0')
  expect(requests).toEqual([paths[grass]])
  const initial = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  expect(Object.keys(initial.document.assets)).toHaveLength(2)

  const cold = await page.context().newPage(), coldRequests = watchImages(cold)
  await cold.route(fixedImage, route => route.abort('internetdisconnected'))
  await cold.goto('./#home')
  await cold.locator('.home-project-row').filter({ hasText: title }).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(cold)
  const terrain = await openOutdoorTask(cold)
  await openDetailsBySummary(terrain, /^精确坐标 · 区域轮廓$/)
  await terrain.getByLabel('室外坐标', { exact: true }).fill('1000,1000\n5000,1000\n5000,5000\n1000,5000')
  await terrain.getByLabel('地形材质', { exact: true }).selectOption({ label: '簇生草地' })
  await terrain.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await cold.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await cold.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(cold)
  const saved = await keyboardProjectBackup(cold, info.outputPath('after.sceneweave'))
  expect(saved.hashes['assets/' + grass + '.png']).toBe(grass)
  expect(coldRequests).toEqual([])
})
