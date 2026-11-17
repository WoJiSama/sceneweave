import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openGenerationTask, openSamples, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'

const delivery = process.env.SCENEWEAVE_OCEAN_DELIVERY_DIR ? join(process.env.SCENEWEAVE_OCEAN_DELIVERY_DIR, 'continuation') : join(process.cwd(), 'work', 'ocean-continuation', 'delivery')
async function png(page: Page, audience: 'gm' | 'player', path: string) {
  const download = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
  await (await download).saveAs(path); await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
async function adopt(page: Page) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const checkbox = review.getByLabel('确认完整影响范围', { exact: true }); if (await checkbox.count()) await checkbox.check()
  await review.getByRole('button', { name: /^采用/ }).click(); await expect(review).toHaveCount(0); await keyboardWorkspaceSaved(page)
}
async function cold(page: Page, sceneId: string) {
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

for (const [kind, name, ocean] of [['coast', '海岸', true], ['island', '岩岛', true], ['river', '河谷', false], ['lake', '内湖', false], ['forest', '森林', false]] as const) {
  test(`ordinary ${kind} generation, shared terrain rendering and complete cold delivery`, async ({ page, browser }, info) => {
    test.setTimeout(test.info().project.name === 'chrome' ? 300000 : 900000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await createKeyboardProject(page, `海洋接续前-${kind}`)
    const preserved = kind === 'coast' ? await keyboardProjectBackup(page, info.outputPath('preserved.sceneweave')) : null
    await openGenerationTask(page, '自然地形')
    await page.getByRole('button', { name: `选择${name}地形`, exact: true }).click()
    await page.getByLabel('地形画布尺寸', { exact: true }).selectOption('36000x20000')
    if (ocean) await page.getByLabel('生成海洋水面与布景', { exact: true }).check()
    await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
    const candidate = page.getByLabel('当前地形候选', { exact: true })
    await Promise.race([
      candidate.waitFor({ state: 'visible', timeout: 150000 }),
      page.locator('.terrain-generation-error:visible').first().waitFor({ state: 'visible', timeout: 150000 }).then(async () => { throw new Error(await page.locator('.terrain-generation-error:visible').first().innerText()) }),
    ])
    if (preserved) {
      await page.getByRole('button', { name: '取消当前地形候选', exact: true }).click(); await keyboardWorkspaceSaved(page)
      expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).hashes).toEqual(preserved.hashes)
      await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
      await expect(candidate).toBeVisible({ timeout: 150000 })
    }
    if (ocean) {
      await expect(page.getByText(/海洋步骤：/)).toBeVisible()
      await writeFile(info.outputPath('ocean-report.txt'), await page.getByText(/海洋步骤：/).locator('..').innerText())
    }
    await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
    await expect(candidate).toHaveCount(0, { timeout: 90000 }); await keyboardWorkspaceSaved(page)
    const file = info.outputPath(`${kind}.sceneweave`), initial = await keyboardProjectBackup(page, file)
    const water = Object.values(initial.document.terrainAreas).filter(area => area.waterSurface)
    const marine = Object.values(initial.document.props).filter(prop => prop.waterAppearance)
    if (ocean) { expect(water.length).toBeGreaterThan(0); expect(marine.length).toBeGreaterThan(0) }
    else expect(water).toEqual([])
    const gm = info.outputPath(`${kind}-gm.png`), player = info.outputPath(`${kind}-player.png`)
    await png(page, 'gm', gm); const playerHash = await png(page, 'player', player)
    if (ocean) {
      const prop = marine[0]; await selectKeyboardProp(page, prop.id)
      const rotation = page.getByTestId('workspace-inspector').getByLabel('物件旋转', { exact: true })
      await rotation.fill(String((prop.rotationDeg + 90) % 360)); await rotation.press('Tab'); await keyboardWorkspaceSaved(page)
      const edited = await keyboardProjectBackup(page, info.outputPath('ocean-edited.sceneweave'))
      expect(edited.document.props[prop.id].waterAppearance).toEqual(prop.waterAppearance)
      expect(edited.document.props[prop.id].rotationDeg).not.toBe(prop.rotationDeg)
      await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
      expect((await keyboardProjectBackup(page, info.outputPath('ocean-undo.sceneweave'))).document.props).toEqual(initial.document.props)
    }
    await cold(page, initial.document.sceneId)
    const reloaded = await keyboardProjectBackup(page, info.outputPath(`${kind}-cold.sceneweave`))
    expect({ ...reloaded.document, revision: initial.document.revision, updatedAt: initial.document.updatedAt }).toEqual(initial.document)
    expect(await png(page, 'player', info.outputPath(`${kind}-cold.png`))).toBe(playerHash)
    if (ocean) {
      const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), imported = await fresh.newPage()
      try {
        await imported.goto('./#home'); await imported.getByTestId('native-project-file').setInputFiles(file); await keyboardWorkspaceSaved(imported)
        const parsed = await keyboardProjectBackup(imported, info.outputPath(`${kind}-imported.sceneweave`))
        expect({ ...parsed.document, sceneId: initial.document.sceneId, createdAt: initial.document.createdAt, updatedAt: initial.document.updatedAt }).toEqual(initial.document)
        expect(await png(imported, 'player', info.outputPath(`${kind}-imported-player.png`))).toBe(playerHash)
      } finally { await fresh.close() }
    }
    await mkdir(delivery, { recursive: true })
    for (const [source, target] of [[file, `${name}${ocean ? '-海洋生成' : '-共用地形'}.sceneweave`], [gm, `${name}-主持人.png`], [player, `${name}-玩家.png`]]) await writeFile(join(delivery, target), await readFile(source))
    await page.screenshot({ path: info.outputPath(`${kind}-page.png`), fullPage: true })
    expect(errors).toEqual([])
  })
}

test('ordinary Floor entrances navigate both ways, edit, undo and cold load without painting navigation metadata', async ({ page, browser }, info) => {
  test.setTimeout(test.info().project.name === 'chrome' ? 300000 : 900000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '多层入口前工程'); await openSamples(page)
  await page.getByRole('button', { name: '逐潮号 · 三层船图', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '确认打开工程', exact: true }); await expect(confirmation).toBeVisible({ timeout: 90000 })
  await confirmation.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const file = info.outputPath('ship-links.sceneweave'), initial = await keyboardProjectBackup(page, file)
  await openWorkspaceModule(page, '场景')
  let panel = page.getByLabel('楼层入口关联', { exact: true }); await openDetailsBySummary(panel, /^楼层入口与定位$/)
  await panel.getByRole('button', { name: '前往 船舱 · A梯口', exact: true }).click()
  await expect(page.getByLabel('当前楼层', { exact: true })).toHaveValue('ship-cabin')
  await expect(page.getByTestId('floor-entrance-marker')).toBeVisible()
  panel = page.getByLabel('楼层入口关联', { exact: true }); await openDetailsBySummary(panel, /^楼层入口与定位$/)
  await panel.getByRole('button', { name: '前往 甲板 · A梯口', exact: true }).click()
  await expect(page.getByLabel('当前楼层', { exact: true })).toHaveValue('collection-floor')
  panel = page.getByLabel('楼层入口关联', { exact: true }); await openDetailsBySummary(panel, /^楼层入口与定位$/)
  await panel.getByLabel('入口名称', { exact: true }).fill('新检修口')
  await panel.getByLabel('入口目标楼层', { exact: true }).selectOption('ship-hold')
  await panel.getByRole('button', { name: '预览关联楼层入口', exact: true }).click(); await adopt(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('ship-links-edited.sceneweave'))
  expect(edited.document.floors['collection-floor'].links).toHaveLength(2)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('ship-links-undo.sceneweave'))).document.floors['collection-floor'].links).toEqual(initial.document.floors['collection-floor'].links)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await cold(page, initial.document.sceneId)
  expect((await keyboardProjectBackup(page, info.outputPath('ship-links-cold.sceneweave'))).document.floors['collection-floor'].links).toEqual(edited.document.floors['collection-floor'].links)
  await mkdir(delivery, { recursive: true }); await writeFile(join(delivery, '逐潮号-楼层入口.sceneweave'), await readFile(info.outputPath('ship-links-cold.sceneweave')))
  for (const [floorId, name] of [['collection-floor', '甲板'], ['ship-cabin', '船舱'], ['ship-hold', '底舱']]) {
    await page.getByLabel('当前楼层', { exact: true }).selectOption(floorId); await keyboardWorkspaceSaved(page)
    await png(page, 'gm', join(delivery, `逐潮号-${name}-主持人.png`)); await png(page, 'player', join(delivery, `逐潮号-${name}-玩家.png`))
  }
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), imported = await fresh.newPage()
  try {
    await imported.goto('./#home'); await imported.getByTestId('native-project-file').setInputFiles(info.outputPath('ship-links-cold.sceneweave')); await keyboardWorkspaceSaved(imported)
    const parsed = await keyboardProjectBackup(imported, info.outputPath('ship-links-imported.sceneweave'))
    expect(parsed.document.floors).toEqual(edited.document.floors)
    await openWorkspaceModule(imported, '场景')
    const importedLinks = imported.getByLabel('楼层入口关联', { exact: true }); await openDetailsBySummary(importedLinks, /^楼层入口与定位$/)
    await importedLinks.getByRole('button', { name: '前往 船舱 · A梯口', exact: true }).click()
    await expect(imported.getByTestId('floor-entrance-marker')).toBeVisible()
  } finally { await fresh.close() }
  expect(errors).toEqual([])
})
