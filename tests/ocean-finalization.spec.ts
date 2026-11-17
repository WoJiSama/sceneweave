import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openSamples, openWorkspaceModule, closeWorkspaceDrawers } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

async function open(page: Page, name: string) {
  await createKeyboardProject(page, '海洋最终候选前工程')
  await openSamples(page); await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(dialog).toBeVisible({ timeout: 90000 }); await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function png(page: Page, audience: 'gm' | 'player', file: string) {
  await closeWorkspaceDrawers(page)
  const pending = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click(); await (await pending).saveAs(file)
  await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
  return createHash('sha256').update(await readFile(file)).digest('hex')
}
const samples = [
  { name: '碎潮礁湾 · 近岸海战', stem: '碎潮礁湾-自然岸线', target: 'ocean-kraken', floors: [['collection-floor', '海面']] },
  { name: '远洋遭遇 · 巨怪', stem: '远洋遭遇-巨怪', target: 'ocean-kraken', floors: [['collection-floor', '海面']] },
  { name: '逐潮号 · 三层船图', stem: '逐潮号-完整三层', target: 'ship-deck-chest', floors: [['collection-floor', '甲板'], ['ship-cabin', '船舱'], ['ship-hold', '底舱']] },
] as const
for (const sample of samples) test(`final marine delivery ${sample.stem}: edit, cold open, fresh import and every Floor PNG`, async ({ page, browser }, info) => {
  test.setTimeout(info.project.name === 'chrome' ? 300000 : 900000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await open(page, sample.name)
  const file = info.outputPath('final.sceneweave'), initial = await keyboardProjectBackup(page, file)
  const files: [string, string][] = [[file, sample.stem + '.sceneweave']], hashes: Record<string, string> = {}
  for (const [id, floor] of sample.floors) {
    await page.getByLabel('当前楼层', { exact: true }).selectOption(id); await keyboardWorkspaceSaved(page)
    for (const [audience, label] of [['gm', '主持人'], ['player', '玩家']] as const) {
      const path = info.outputPath(`${floor}-${audience}.png`); hashes[`${id}:${audience}`] = await png(page, audience, path)
      files.push([path, `${sample.stem}-${floor}-${label}.png`])
    }
  }
  await page.getByLabel('当前楼层', { exact: true }).selectOption('collection-floor'); await keyboardWorkspaceSaved(page)
  await selectKeyboardProp(page, sample.target)
  const turn = page.getByLabel('物件旋转', { exact: true }); await turn.fill(String((initial.document.props[sample.target].rotationDeg + 180) % 360)); await turn.press('Tab'); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('edited.sceneweave'))).document.props[sample.target].rotationDeg).not.toBe(initial.document.props[sample.target].rotationDeg)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${initial.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.document.props).toEqual(initial.document.props); expect(cold.document.floors).toEqual(initial.document.floors)
  for (const [id, floor] of sample.floors) {
    await page.getByLabel('当前楼层', { exact: true }).selectOption(id); await keyboardWorkspaceSaved(page)
    for (const audience of ['gm', 'player'] as const) expect(await png(page, audience, info.outputPath(`cold-${floor}-${audience}.png`))).toBe(hashes[`${id}:${audience}`])
  }
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  try {
    const imported = await context.newPage(); imported.on('pageerror', error => errors.push(error.message))
    await imported.goto('./#home'); await imported.getByTestId('native-project-file').setInputFiles(file); await keyboardWorkspaceSaved(imported)
    const back = await keyboardProjectBackup(imported, info.outputPath('imported.sceneweave'))
    expect({ ...back.document, sceneId: initial.document.sceneId, createdAt: initial.document.createdAt, updatedAt: initial.document.updatedAt }).toEqual(initial.document)
    for (const [id, floor] of sample.floors) {
      await imported.getByLabel('当前楼层', { exact: true }).selectOption(id); await keyboardWorkspaceSaved(imported)
      for (const audience of ['gm', 'player'] as const) expect(await png(imported, audience, info.outputPath(`imported-${floor}-${audience}.png`))).toBe(hashes[`${id}:${audience}`])
    }
  } finally { await context.close() }
  const directory = join(process.env.SCENEWEAVE_OCEAN_DELIVERY_DIR ?? 'work/ocean-finalization-20261117/delivery', info.project.name)
  await mkdir(directory, { recursive: true }); for (const [source, name] of files) await writeFile(join(directory, name), await readFile(source))
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ sample: sample.name, props: Object.keys(initial.document.props).length, floors: sample.floors.length, hashes, errors }, null, 2))
  expect(errors).toEqual([])
})

test('water layer visibility and solo are transient while locks persist and block marine editing', async ({ page }, info) => {
  await open(page, '远洋遭遇 · 巨怪')
  const initial = await keyboardProjectBackup(page, info.outputPath('layers-before.sceneweave'))
  await openWorkspaceModule(page, '场景')
  await page.getByRole('button', { name: '隐藏图层 海水与浪纹', exact: true }).click()
  expect((await keyboardProjectBackup(page, info.outputPath('hidden.sceneweave'))).hashes).toEqual(initial.hashes)
  await page.getByRole('button', { name: '显示图层 海水与浪纹', exact: true }).click()
  await page.getByRole('button', { name: '独显图层 舟船与海洋生物', exact: true }).click()
  expect((await keyboardProjectBackup(page, info.outputPath('solo.sceneweave'))).hashes).toEqual(initial.hashes)
  await page.getByRole('button', { name: '退出独显 舟船与海洋生物', exact: true }).click()
  await page.getByRole('button', { name: '锁定图层 海水与浪纹', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const locked = await keyboardProjectBackup(page, info.outputPath('locked.sceneweave'))
  expect(locked.document.userLayers['collection-structure'].editLocked).toBe(true)
  await page.getByRole('button', { name: '锁定图层 舟船与海洋生物', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await selectKeyboardProp(page, 'ocean-kraken')
  await expect(page.getByLabel('物件旋转', { exact: true })).toBeDisabled()
  expect((await keyboardProjectBackup(page, info.outputPath('rejected.sceneweave'))).document.props).toEqual(initial.document.props)
  await openWorkspaceModule(page, '场景'); await page.getByRole('button', { name: '解锁图层 舟船与海洋生物', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await selectKeyboardProp(page, 'ocean-kraken'); await expect(page.getByLabel('物件旋转', { exact: true })).toBeEnabled()
})
