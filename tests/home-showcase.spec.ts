import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
const showcaseManifest = JSON.parse(await readFile(new URL('../src/editor/main-shell/showcase-manifest.json', import.meta.url), 'utf8')) as {
  entries: Record<string, { file: string; width: number; height: number; sourceSceneSha256: string; pngSha256: string; boundsMm: { width: number; height: number }; props: number }>
}
const fixed = JSON.parse(await readFile(new URL('../src/platform/browser/content/scenes-data.json', import.meta.url), 'utf8')) as { scenes: Record<string, object> }

type SampleId = keyof typeof showcaseManifest.entries
const names: Record<SampleId, string> = {
  study: '书房与露台',
  island: '双层岩岛',
  outpost: '海岸哨所',
  graveyard: '苔石墓园',
  volcano: '灰烬熔脉',
  calibration: '原创材质校样',
}
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

test('home showcase serves the six native scene images without creating projects and opens a real sample copy', async ({ page }) => {
  test.setTimeout(120_000)
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
  expect(Object.keys(showcaseManifest.entries).sort()).toEqual(Object.keys(names).sort())

  for (const id of Object.keys(showcaseManifest.entries) as SampleId[]) {
    const entry = showcaseManifest.entries[id]
    expect(createHash('sha256').update(JSON.stringify(fixed.scenes[id])).digest('hex')).toBe(entry.sourceSceneSha256)
    const file = await readFile(new URL('../public/assets/home-scenes/' + entry.file, import.meta.url))
    expect(createHash('sha256').update(file).digest('hex')).toBe(entry.pngSha256)

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
    const details = page.getByRole('dialog', { name: names[id] + ' · 场景详情', exact: true })
    await expect(details).toBeVisible()
    const fullImage = details.locator('figure img')
    await waitForImage(fullImage, entry.width, entry.height)
    expect(new URL(await fullImage.getAttribute('src') ?? '', page.url()).pathname.endsWith('/assets/home-scenes/' + entry.file)).toBe(true)
    await expect(details).toContainText(entry.props + ' 件物件')
    if (id === 'study') {
      await page.keyboard.press('Escape')
    } else if (id === 'island') {
      const back = details.getByRole('button', { name: '返回首页', exact: true })
      await back.focus()
      await back.press('Enter')
    } else {
      await details.getByRole('button', { name: '关闭场景详情', exact: true }).click()
    }
    await expect(details).toHaveCount(0)
    if (id === 'study' || id === 'island') await expect(opener).toBeFocused()
    expect(await storedProjects(page)).toEqual(initialProjects)
  }

  const volcanoCard = home(page).locator('article[data-sample="volcano"]')
  await volcanoCard.locator('.home-showcase-image').click()
  const volcanoDetails = page.getByRole('dialog', { name: '灰烬熔脉 · 场景详情', exact: true })
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
  expect(opened.project?.document.title).toContain('灰烬熔脉')
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
  const details = page.getByRole('dialog', { name: '灰烬熔脉 · 场景详情', exact: true })
  await expect(details).toBeVisible()
  expect(await details.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  expect(await overflow()).toBeLessThanOrEqual(1)
  await details.getByRole('button', { name: '返回首页', exact: true }).click()
  await expect(details).toHaveCount(0)
  expect(await storedProjects(page)).toEqual([])
})
