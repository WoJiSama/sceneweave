import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { archiveUrl, featuredSampleIds, showcaseManifest, type MountedWorkspace } from './home-showcase-helpers'

const manifestSampleIds = ['investigation', 'modern', 'fantasy', 'ruins', 'wilderness', 'coast', 'island', 'volcano', 'cyberpunk'] as const
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

test('all delivered sample archives and native images match the manifest', async () => {
  expect(Object.keys(showcaseManifest.entries).sort()).toEqual(manifestSampleIds.toSorted())

  for (const id of manifestSampleIds) {
    const entry = showcaseManifest.entries[id]
    const file = await readFile(new URL('../public/assets/home-scenes/' + entry.file, import.meta.url))
    expect(sha256(file)).toBe(entry.pngSha256)
    expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([entry.width, entry.height])
    const full = await readFile(new URL('../public/assets/home-scenes/' + entry.fullFile, import.meta.url))
    expect(sha256(full)).toBe(entry.fullPngSha256)
    expect([full.readUInt32BE(16), full.readUInt32BE(20)]).toEqual([entry.fullWidth, entry.fullHeight])
    expect(entry.audience).toBe('gm')
    const archive = await readFile(archiveUrl(id))
    expect(archive.byteLength).toBe(entry.archiveBytes)
    expect(sha256(archive)).toBe(entry.archiveSha256)
    expect(entry.projectHash).toMatch(/^[0-9a-f]{64}$/)
    const angle = entry.oblique
    const angleBytes = await readFile(new URL('../public/assets/home-scenes/' + angle.file, import.meta.url))
    const angleFullBytes = await readFile(new URL('../public/assets/home-scenes/' + angle.fullFile, import.meta.url))
    expect(sha256(angleBytes)).toBe(angle.sha256)
    expect(sha256(angleFullBytes)).toBe(angle.fullSha256)
    expect(angleBytes.toString('ascii', 8, 12)).toBe('WEBP')
  }
})

test('unfeatured samples still prepare independent editable copies without saving to the workspace', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/#home')
  const featured = new Set<string>(featuredSampleIds)
  for (const id of manifestSampleIds.filter(id => !featured.has(id))) {
    const source = unzipSync(await readFile(archiveUrl(id)), { filter: file => file.name === 'identity.json' })
    const original = JSON.parse(new TextDecoder().decode(source['identity.json']))
    const copy = await page.evaluate(async sample => {
      const path = '/src/platform/browser/content/home-showcase.ts'
      const { createHomeShowcaseProject } = await import(path) as typeof import('../src/platform/browser/content/home-showcase')
      const { document, historyIdentity } = await createHomeShowcaseProject(sample)
      return { id: document.sceneId, title: document.title, root: historyIdentity.rootSceneId,
        lineage: historyIdentity.lineageId, doorLinkLineages: Object.values(document.pathAttachments ?? {}).map(link => link.proofs.lineageId) }
    }, id)
    expect(copy.title).toBe(showcaseManifest.entries[id].title)
    expect(copy.root).toBe(copy.id)
    expect(copy.root).not.toBe(original.rootSceneId)
    expect(copy.lineage).not.toBe(original.lineageId)
    if (id === 'cyberpunk') expect(copy.doorLinkLineages).toEqual([copy.lineage, copy.lineage])
  }
  expect(await storedProjects(page)).toEqual([])
})

test('home shows the four featured scenes, writes nothing on browse or cancel, and saves a real copy', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#unknown-route')
  await expect(home(page)).toBeVisible()
  await expect(page).toHaveURL(/#home$/)
  await expect(home(page).getByRole('button', { name: /查找旧工程|保全并转换|导入保全索引|转换旧个人素材库/ })).toHaveCount(0)
  await expect(page.getByTestId('preservation-files')).toHaveCount(0)
  await expect(home(page).getByRole('status').filter({ hasText: '共 0 个工程' })).toBeVisible()
  const initialProjects = await storedProjects(page)
  expect(initialProjects).toEqual([])
  await expect(home(page).locator('article[data-sample] h3')).toHaveText(featuredSampleIds.map(id => showcaseManifest.entries[id].name))
  for (const id of featuredSampleIds) {
    const entry = showcaseManifest.entries[id]
    const card = home(page).locator('article[data-sample="' + id + '"]')
    await card.scrollIntoViewIfNeeded()
    await expect(card).toBeVisible()
    const image = card.locator('.home-showcase-image:not(.home-showcase-angle) img')
    await waitForImage(image, entry.width, entry.height)
    expect(new URL(await image.getAttribute('src') ?? '', page.url()).pathname.endsWith('/assets/home-scenes/' + entry.file)).toBe(true)
    await expect(card).toContainText(entry.boundsMm.width / 1000 + ' × ' + entry.boundsMm.height / 1000 + ' m')

    const angle = entry.oblique
    await waitForImage(card.locator('.home-showcase-angle img'), angle.width, angle.height)
    const opener = card.locator('.home-showcase-image:not(.home-showcase-angle)')
    await opener.focus()
    await opener.press('Enter')
    const details = page.getByRole('dialog', { name: entry.name + ' · 场景详情', exact: true })
    await expect(details).toBeVisible()
    const fullImage = details.locator('figure img')
    await waitForImage(fullImage, entry.fullWidth, entry.fullHeight)
    expect(new URL(await fullImage.getAttribute('src') ?? '', page.url()).pathname.endsWith('/assets/home-scenes/' + entry.fullFile)).toBe(true)
    await details.getByRole('button', { name: '3D 斜俯视', exact: true }).click()
    await waitForImage(fullImage, angle.fullWidth, angle.fullHeight)
    expect(new URL(await fullImage.getAttribute('src') ?? '', page.url()).pathname.endsWith('/assets/home-scenes/' + angle.fullFile)).toBe(true)
    await expect(details).toContainText(entry.props + ' 件物件')
    if (id === 'fantasy') await page.keyboard.press('Escape')
    else if (id === 'ruins') await details.getByRole('button', { name: '返回首页', exact: true }).press('Enter')
    else await details.getByRole('button', { name: '关闭场景详情', exact: true }).click()
    await expect(details).toHaveCount(0)
    await expect(opener).toBeFocused()
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
  await volcanoCard.locator('.home-showcase-angle').click()
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
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as MountedWorkspace
    const project = workspace.getState().project!
    const saved = await repository.load(project.document.sceneId)
    return { format: project.format, document: project.document, saved: saved?.document }
  })
  expect(opened.format).toBe('sceneweave-complete-project')
  expect(opened.document.title).toContain(showcaseManifest.entries.volcano.title)
  expect(opened.saved).toEqual(opened.document)
  expect(await storedProjects(page)).toHaveLength(1)
  expect(errors).toEqual([])
})

test('home showcase and scene details fit a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#home')
  await expect(home(page)).toBeVisible()
  await expect(home(page).locator('article[data-sample]')).toHaveCount(featuredSampleIds.length)
  for (const id of featuredSampleIds) {
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

  const entry = showcaseManifest.entries.volcano
  await home(page).locator('article[data-sample="volcano"] .home-showcase-angle').click()
  const details = page.getByRole('dialog', { name: entry.name + ' · 场景详情', exact: true })
  await expect(details).toBeVisible()
  await waitForImage(details.getByRole('img'), entry.oblique.fullWidth, entry.oblique.fullHeight)
  expect(await details.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  expect(await overflow()).toBeLessThanOrEqual(1)
  await details.getByRole('button', { name: '返回首页', exact: true }).click()
  await expect(details).toHaveCount(0)
  expect(await storedProjects(page)).toEqual([])
})
