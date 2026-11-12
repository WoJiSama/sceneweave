import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
const showcaseManifest = JSON.parse(await readFile(new URL('../src/platform/browser/content/home-showcase-manifest.json', import.meta.url), 'utf8')) as {
  entries: Record<SampleId, { file: string; fullFile: string; title: string; name: string; audience: string; width: number; height: number;
    fullWidth: number; fullHeight: number; pngSha256: string; fullPngSha256: string; rgbaSha256: string;
    archiveFile: string; archiveSha256: string; archiveBytes: number; projectHash: string;
    boundsMm: { x: number; y: number; width: number; height: number }; rooms: number; terrainAreas: number; props: number; prefabInstances: number }>
}
type SampleId = 'investigation' | 'modern' | 'fantasy' | 'ruins' | 'wilderness' | 'coast' | 'island' | 'volcano'
const sampleIds: SampleId[] = ['investigation', 'modern', 'fantasy', 'ruins', 'wilderness', 'coast', 'island', 'volcano']
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const home = (page: Page) => page.getByTestId('workspace-home')

async function storedProjects(page: Page) {
  return page.evaluate(async () => {
    const runtimePath = '/src/platform/browser/runtime.ts'
    const { projectRepository } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    return projectRepository.list()
  })
}

async function waitForImage(image: ReturnType<Page['locator']>, width: number, height: number) {
  await expect.poll(() => image.evaluate(element => {
    const img = element as HTMLImageElement
    return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
  })).toBe(true)
  await expect(image).toHaveJSProperty('naturalWidth', width)
  await expect(image).toHaveJSProperty('naturalHeight', height)
}

async function settled(page: Page) {
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@1')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}

test('home showcase serves eight delivered archives and native images without writing on browse or cancel, then saves a real copy', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#unknown-route')
  await expect(home(page)).toBeVisible()
  await expect(page).toHaveURL(/#home$/)
  await expect(home(page).getByRole('button', { name: /查找旧工程|保全并转换|导入保全索引|转换旧个人素材库/ })).toHaveCount(0)
  await expect(page.getByTestId('preservation-files')).toHaveCount(0)
  await expect(home(page)).toContainText('当前版本使用完整工程和统一工作区')
  const initialProjects = await storedProjects(page)
  expect(initialProjects).toEqual([])
  expect(Object.keys(showcaseManifest.entries).sort()).toEqual(sampleIds.toSorted())

  for (const id of Object.keys(showcaseManifest.entries) as SampleId[]) {
    const entry = showcaseManifest.entries[id]
    const file = await readFile(new URL('../public/assets/home-scenes/' + entry.file, import.meta.url))
    expect(sha256(file)).toBe(entry.pngSha256)
    expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([entry.width, entry.height])
    const full = await readFile(new URL('../public/assets/home-scenes/' + entry.fullFile, import.meta.url))
    expect(sha256(full)).toBe(entry.fullPngSha256)
    expect([full.readUInt32BE(16), full.readUInt32BE(20)]).toEqual([entry.fullWidth, entry.fullHeight])
    expect(entry.audience).toBe('gm')
    const archive = await readFile(new URL('../public/assets/home-scenes/projects/' + entry.archiveFile, import.meta.url))
    expect(archive.byteLength).toBe(entry.archiveBytes)
    expect(sha256(archive)).toBe(entry.archiveSha256)
    expect(entry.projectHash).toMatch(/^[0-9a-f]{64}$/)

    const card = home(page).locator('article[data-sample="' + id + '"]')
    await card.scrollIntoViewIfNeeded()
    await expect(card).toBeVisible()
    const image = card.locator('.home-showcase-image img')
    await waitForImage(image, entry.width, entry.height)
    expect(new URL(await image.getAttribute('src') ?? '', page.url()).pathname.endsWith('/assets/home-scenes/' + entry.file)).toBe(true)
    await expect(card).toContainText(entry.boundsMm.width / 1000 + ' × ' + entry.boundsMm.height / 1000 + ' m')

    const opener = card.locator('.home-showcase-image')
    await opener.focus()
    await opener.press('Enter')
    const details = page.getByRole('dialog', { name: entry.name + ' · 场景详情', exact: true })
    await expect(details).toBeVisible()
    const fullImage = details.locator('figure img')
    await waitForImage(fullImage, entry.fullWidth, entry.fullHeight)
    expect(new URL(await fullImage.getAttribute('src') ?? '', page.url()).pathname.endsWith('/assets/home-scenes/' + entry.fullFile)).toBe(true)
    await expect(details).toContainText(entry.props + ' 件物件')
    if (id === 'investigation') {
      await page.keyboard.press('Escape')
    } else if (id === 'island') {
      const back = details.getByRole('button', { name: '返回首页', exact: true })
      await back.focus()
      await back.press('Enter')
    } else {
      await details.getByRole('button', { name: '关闭场景详情', exact: true }).click()
    }
    await expect(details).toHaveCount(0)
    if (id === 'investigation' || id === 'island') await expect(opener).toBeFocused()
    expect(await storedProjects(page)).toEqual(initialProjects)
    await card.getByRole('button', { name: entry.name, exact: true }).click()
    const copy = page.getByRole('dialog', { name: '确认打开工程', exact: true })
    await expect(copy).toBeVisible({ timeout: 60_000 })
    await expect(copy).toContainText(entry.title)
    await expect(copy).toContainText(entry.props + ' 件物件')
    expect(await storedProjects(page)).toEqual(initialProjects)
    await copy.getByRole('button', { name: '取消', exact: true }).click()
    await expect(copy).toHaveCount(0)
    await page.getByRole('button', { name: '回到首页', exact: true }).click()
    await expect(home(page)).toBeVisible()
    expect(await storedProjects(page)).toEqual(initialProjects)
  }

  const volcanoCard = home(page).locator('article[data-sample="volcano"]')
  await volcanoCard.locator('.home-showcase-image').click()
  const volcanoDetails = page.getByRole('dialog', { name: showcaseManifest.entries.volcano.name + ' · 场景详情', exact: true })
  await expect(volcanoDetails).toBeVisible()
  await volcanoDetails.getByRole('button', { name: '用此样板创建副本', exact: true }).click()
  const candidate = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(candidate).toBeVisible({ timeout: 30_000 })
  expect(await storedProjects(page)).toEqual(initialProjects)
  await candidate.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  await settled(page)
  await expect(page.getByTestId('workspace-home')).toBeHidden()
  const opened = await page.evaluate(async () => {
    const workbenchPath = '/src/editor/main/Workbench.tsx', runtimePath = '/src/platform/browser/runtime.ts'
    const { nativeWorkspace } = await import(workbenchPath) as typeof import('../src/editor/main/Workbench')
    const { projectRepository } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const project = nativeWorkspace.getState().project
    return { project, saved: project ? await projectRepository.load(project.document.sceneId) : null }
  })
  expect(opened.project?.format).toBe('sceneweave-complete-project')
  expect(opened.project?.document.title).toContain(showcaseManifest.entries.volcano.title)
  expect(opened.saved?.project.document).toEqual(opened.project?.document)
  expect(await storedProjects(page)).toHaveLength(1)
  expect(errors).toEqual([])
})

test('home showcase and scene details fit a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#home')
  await expect(home(page)).toBeVisible()
  for (const id of Object.keys(showcaseManifest.entries)) {
    const card = home(page).locator('article[data-sample="' + id + '"]')
    await card.scrollIntoViewIfNeeded()
    await expect(card).toBeVisible()
    const bounds = await card.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, viewport: window.innerWidth }
    })
    expect(bounds.left).toBeGreaterThanOrEqual(-1)
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1)
  }
  const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth)
  expect(await overflow()).toBeLessThanOrEqual(1)

  await home(page).locator('article[data-sample="volcano"] .home-showcase-image').click()
  const details = page.getByRole('dialog', { name: showcaseManifest.entries.volcano.name + ' · 场景详情', exact: true })
  await expect(details).toBeVisible()
  expect(await details.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  expect(await overflow()).toBeLessThanOrEqual(1)
  await details.getByRole('button', { name: '返回首页', exact: true }).click()
  await expect(details).toHaveCount(0)
  expect(await storedProjects(page)).toEqual([])
})
