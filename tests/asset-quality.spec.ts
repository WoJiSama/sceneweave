import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { acknowledgeAssetQuality } from './asset-quality-helpers'

const credit = 'Sceneweave original quality fixtures'
const license = 'Original test artwork. Permission is granted to use, copy, modify, distribute and embed this artwork under the MIT License.'
const square = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="0" y="0" width="64" height="64" fill="#897355"/></svg>'
const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="5" fill="#897355"/><path d="M16 20L48 20M16 32L48 32M16 44L48 44" stroke="#3f372b" stroke-width="2"/></svg>'
const empty = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" fill="#897355" opacity="0"/></svg>'

async function openForm(page: import('@playwright/test').Page) {
  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByRole('button', { name: '导入/管理', exact: true }).click()
  const form = library.locator('details.composition-import:not(.asset-batch-import)')
  await form.locator(':scope > summary').click()
  return form
}

test('quality screening rejects transparent SVG, requires exact warning review and preserves cancellation and names', async ({ page }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '素材质量初筛')
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const form = await openForm(page)
  const file = form.getByLabel('素材图片', { exact: true })
  await file.setInputFiles({ name: '透明空图.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(empty) })
  await form.getByLabel('素材署名与来源', { exact: true }).fill(credit)
  await form.getByLabel('素材完整许可', { exact: true }).fill(license)
  await form.getByLabel('确认素材可嵌入工程', { exact: true }).check()
  await form.getByRole('button', { name: '预览素材导入', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '图片完全透明' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toHaveCount(0)
  const rejected = await keyboardProjectBackup(page, info.outputPath('rejected.sceneweave'))
  expect(rejected.hashes).toEqual(before.hashes)
  await file.setInputFiles({ name: '  照片_01.final.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(square) })
  await form.getByLabel('素材名称', { exact: true }).fill('  照片_01.final 🌿  ')
  await form.getByRole('button', { name: '预览素材导入', exact: true }).click()
  const adopt = page.getByRole('button', { name: '采用组件修改', exact: true })
  await expect(adopt).toBeVisible({ timeout: 30_000 }); await expect(adopt).toBeDisabled()
  const review = page.getByRole('region', { name: '素材质量初筛', exact: true })
  await expect(review).toContainText('矩形背景')
  await acknowledgeAssetQuality(page); await expect(adopt).toBeEnabled()
  await page.getByRole('button', { name: '取消组件预览', exact: true }).click()
  await form.getByRole('button', { name: '预览素材导入', exact: true }).click()
  await expect(adopt).toBeDisabled({ timeout: 30_000 })
  await page.setViewportSize({ width: 390, height: 844 })
  await openKeyboardPanel(page, 'inspector')
  await expect(review).toBeVisible()
  await acknowledgeAssetQuality(page)
  await expect.poll(() => review.locator('img').evaluateAll(images => images.length === 1 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await review.screenshot({ path: info.outputPath('quality-review-390.png') })
  await adopt.click(); await keyboardWorkspaceSaved(page)
  const saved = await keyboardProjectBackup(page, info.outputPath('adopted.sceneweave'))
  expect(Object.values(saved.document.propDefinitions).some(item => item.name === '  照片_01.final 🌿  ')).toBe(true)
  expect(saved.document.revision).toBe(before.document.revision + 1)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.propDefinitions).toEqual(before.document.propDefinitions)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ transparentRejected: true, cancellationResetsReview: true, exactName: '  照片_01.final 🌿  ', revision: saved.document.revision, errors }, null, 2))
})

test('actual PNG input is screened and clean SVG proceeds without warning acknowledgment', async ({ page }, info) => {
  test.setTimeout(90_000)
  await createKeyboardProject(page, '真实像素初筛')
  const form = await openForm(page), file = form.getByLabel('素材图片', { exact: true })
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16
    const c = canvas.getContext('2d')!; c.fillStyle = '#557755'; c.fillRect(0, 0, 16, 16)
    return Array.from(new Uint8Array(await (await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))).arrayBuffer()))
  })
  await file.setInputFiles({ name: 'low-resolution.png', mimeType: 'image/png', buffer: Buffer.from(png) })
  await form.getByLabel('素材署名与来源', { exact: true }).fill(credit)
  await form.getByLabel('素材完整许可', { exact: true }).fill(license)
  await form.getByLabel('确认素材可嵌入工程', { exact: true }).check()
  await form.getByRole('button', { name: '预览素材导入', exact: true }).click()
  const review = page.getByRole('region', { name: '素材质量初筛', exact: true })
  await expect(review).toContainText('像素/米', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '取消组件预览', exact: true }).click()
  await file.setInputFiles({ name: 'clear-subject.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(good) })
  await form.getByRole('button', { name: '预览素材导入', exact: true }).click()
  await expect(review).toContainText('未发现本轮规则覆盖的明显像素问题', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('clean-candidate.png') })
})
