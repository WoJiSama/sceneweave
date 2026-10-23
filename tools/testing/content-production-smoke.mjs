import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { preview } from 'vite'
import { chromium } from '@playwright/test'

// One bounded normal-production feature check. No DEV mutation hooks, regression
// matrix, 4K export or performance measurement.
const output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? 'work/content-production-smoke')
await mkdir(output, { recursive: true })
const server = await preview({ preview: { host: '127.0.0.1', port: 5188, strictPort: true } })
let browser
const started = Date.now(), errors = []
try {
  browser = await chromium.launch({ channel: process.env.SCENEWEAVE_BROWSER_CHANNEL ?? 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } })
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5188/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '苔石墓园', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开室外工程', exact: true })
  await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await page.locator('.asset-map-wrap[aria-busy="false"]').waitFor()
  await page.locator('.asset-save').filter({ hasText: '本地已保存' }).waitFor()
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByRole('button', { name: '内置素材', exact: true }).click()
  await library.getByLabel('搜索组件素材', { exact: true }).fill('阔叶树冠·精修')
  await library.getByRole('button', { name: '查看素材 阔叶树冠·精修', exact: true }).click()
  const comparison = library.getByRole('group', { name: '精修素材与旧版对照', exact: true })
  await comparison.scrollIntoViewIfNeeded()
  await comparison.locator('img').nth(1).waitFor()
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('[aria-label="精修素材与旧版对照"] img')]
    return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0)
  })
  const observation = await page.evaluate(() => ({ userAgent: navigator.userAgent,
    devHookPresent: Reflect.has(window, '__sceneweaveOutdoorDev'),
    performanceHookPresent: Reflect.has(window, '__sceneweavePerformance'),
    comparisonImages: [...document.querySelectorAll('[aria-label="精修素材与旧版对照"] img')].map(image => ({ width: image.naturalWidth, height: image.naturalHeight })) }))
  if (observation.devHookPresent || observation.performanceHookPresent || errors.length) throw new Error(JSON.stringify({ observation, errors }))
  await page.screenshot({ path: path.join(output, 'production-comparison.png') })
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', method: 'Normal vite preview, actual Home sample review/native save, real fixed old/refined images; no DEV writes. A simple feature smoke, not a regression or performance result.', elapsedMs: Date.now() - started, observation, errors }, null, 2) + '\n')
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
