import { expect, test } from '@playwright/test'
import { createKeyboardProject, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

test('the home tutorial supports chapter and section links, browser history and screenshots', async ({ page }) => {
  await page.goto('./#home')
  await page.getByRole('link', { name: '使用教程', exact: true }).click()
  const article = page.getByRole('main', { name: '从零制作林边驿站', exact: true })
  await expect(article).toBeVisible()
  await article.getByRole('link', { name: '开始制作', exact: true }).click()
  const firstStep = article.getByRole('heading', { name: '新建 18 × 12 米的场景', exact: true })
  await expect(page).toHaveURL(/#tutorial\/first-map\/create$/)
  await expect(firstStep).toBeFocused()

  const chapters = page.getByRole('navigation', { name: '教程章节', exact: true })
  await chapters.getByRole('link', { name: '建筑与通路', exact: true }).click()
  await expect(chapters.getByRole('link', { name: '建筑与通路', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.goBack()
  await expect(firstStep).toBeFocused()
  await page.goForward()
  await expect(chapters.getByRole('link', { name: '建筑与通路', exact: true })).toHaveAttribute('aria-current', 'page')

  const chapterLinks = await chapters.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')!))
  expect(chapterLinks).toHaveLength(10)
  const available = new Set(chapterLinks)
  const linked = new Set<string>()
  for (const hash of chapterLinks) {
    await page.goto(`./${hash}`)
    await expect(chapters.locator('[aria-current="page"]')).toHaveAttribute('href', hash)
    const main = page.getByRole('main')
    await expect(main.locator('a[href$=".sceneweave"]')).toHaveCount(0)
    for (const id of await main.locator('section > h2[id]').evaluateAll(headings => headings.map(heading => heading.id))) available.add(`#${id}`)
    for (const target of await main.locator('a[href^="#tutorial"]').evaluateAll(links => links.map(link => link.getAttribute('href')!))) linked.add(target)
    for (const image of await main.locator('img').all()) {
      await image.scrollIntoViewIfNeeded()
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => (
        img.complete && img.naturalWidth > 0
        && img.naturalWidth === Number(img.getAttribute('width')) && img.naturalHeight === Number(img.getAttribute('height'))
      ))).toBe(true)
    }
  }
  expect([...linked].filter(hash => !available.has(hash))).toEqual([])
})

test('a narrow tutorial deep link positions the heading and offers a collapsible chapter list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#tutorial/building/path')
  const heading = page.getByRole('heading', { name: '用净宽检查外门到储藏室', exact: true })
  await expect(heading).toBeFocused()
  await expect(heading).toBeInViewport()
  const jumpPosition = await heading.evaluate(element => ({
    heading: element.getBoundingClientRect().top,
    header: document.querySelector('.tutorial-header')!.getBoundingClientRect().bottom,
  }))
  expect(jumpPosition.heading).toBeGreaterThanOrEqual(jumpPosition.header)
  await expect(page.getByRole('navigation', { name: '本章内容', exact: true }).getByRole('link', { name: '用净宽检查外门到储藏室', exact: true })).toHaveAttribute('aria-current', 'location')

  const toggle = page.getByRole('button', { name: '章节目录', exact: true })
  const chapters = page.getByRole('navigation', { name: '教程章节', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeInViewport()
  await expect(chapters).toBeHidden()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await chapters.getByRole('link', { name: 'AI 与外部工具', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: '连接 AI、审阅草稿与使用本机工具', exact: true })).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.goto('./#tutorial/atmosphere/line-art')
  const lineArtHeading = page.getByRole('heading', { name: '做线稿并核对道路接合', exact: true })
  await expect(lineArtHeading).toBeFocused()
  await expect(lineArtHeading).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('workspace help opens the tutorial in another tab and keeps the current draft', async ({ page, context }) => {
  await createKeyboardProject(page, '教程入口验证')
  const resources = await openWorkspaceModule(page, '场景')
  await resources.getByRole('button', { name: '场景设置', exact: true }).click()
  const inspector = await openKeyboardPanel(page, 'inspector')
  const draftTitle = inspector.getByLabel('工程名称', { exact: true })
  await draftTitle.fill('暂未保存的名称')
  await page.getByText('操作帮助', { exact: true }).click()
  const [tutorial] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: '阅读完整教程（新标签页）', exact: true }).click(),
  ])
  await expect(tutorial.getByRole('heading', { level: 1, name: '从零制作林边驿站', exact: true })).toBeVisible()
  const [obliqueLesson] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: '斜俯视取景教程（新标签页）', exact: true }).click(),
  ])
  await expect(obliqueLesson).toHaveURL(/#tutorial\/scene\/oblique$/)
  await expect(obliqueLesson.getByRole('heading', { name: '旋转斜俯视并导出图片', exact: true })).toBeFocused()
  const [artStyleLesson] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: '全图画风教程（新标签页）', exact: true }).click(),
  ])
  await expect(artStyleLesson).toHaveURL(/#tutorial\/atmosphere\/art-style$/)
  await expect(artStyleLesson.getByRole('heading', { name: '切换全图画风', exact: true })).toBeFocused()
  await expect(page).toHaveURL(/#workspace$/)
  await expect(page.getByRole('heading', { level: 1, name: '教程入口验证', exact: true })).toBeVisible()
  await expect(draftTitle).toHaveValue('暂未保存的名称')
})
