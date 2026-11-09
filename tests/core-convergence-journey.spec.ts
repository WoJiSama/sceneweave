import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, placeKeyboardLamp } from './keyboard-ux-helpers'
import { openGenerationTask, openTerrainTask } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 })
  await keyboardWorkspaceSaved(page)
}

async function coldOpen(page: Page, sceneId: string) {
  await page.goto('./#home'); await page.reload()
  const row = page.getByTestId('workspace-home').locator(`[data-project-key="native:${sceneId}"]`)
  await expect(row).toBeVisible({ timeout: 30000 })
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await saved(page)
}

for (const domain of ['forest', 'mixed'] as const) test(`production ${domain} generation, protected local edit, undo and cold delivery share the core lifecycle`, async ({ page }, info) => {
  test.setTimeout(300000)
  const errors: string[] = [], workers: string[] = [], generationRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('worker', worker => workers.push(worker.url()))
  page.on('request', request => { if (/\/v1\/(?:generation|tasks)(?:[/?]|$)/.test(request.url())) generationRequests.push(request.url()) })
  const response = await page.goto('./#home')
  expect(response?.ok()).toBe(true)
  expect(await response!.text()).not.toContain('/@vite/client')
  await createKeyboardProject(page, `核心原工程 ${domain}`)
  await placeKeyboardLamp(page)
  const original = await keyboardProjectBackup(page, info.outputPath('original.sceneweave'))

  await openGenerationTask(page, domain === 'forest' ? '森林与营地' : '混合场景')
  const panel = page.getByRole('region', { name: domain === 'forest' ? '森林与营地生成' : '混合场景生成', exact: true })
  const title = `核心交付 ${domain}`
  await panel.getByLabel(domain === 'forest' ? '森林工程名称' : '混合工程名称', { exact: true }).fill(title)
  // Keep the protected local edit within the ordinary 256-operation ceiling.
  if (domain === 'forest') await panel.getByLabel('森林树木覆盖百分比', { exact: true }).fill('2')
  if (domain === 'mixed') await panel.getByLabel('混合建筑房间数量', { exact: true }).fill('2')
  await panel.getByRole('button', { name: domain === 'forest' ? '预览森林与营地' : '预览混合场景', exact: true }).click()
  const inspector = page.getByTestId('workspace-inspector')
  await expect(inspector.getByLabel(domain === 'forest' ? '森林与营地候选摘要' : '混合候选摘要', { exact: true })).toBeVisible({ timeout: 90000 })
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  await inspector.getByRole('button', { name: domain === 'forest' ? '保存为新工程' : '保存混合场景为新工程', exact: true }).click()
  await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible({ timeout: 90000 })
  await saved(page)
  const generated = await keyboardProjectBackup(page, info.outputPath('generated.sceneweave'))
  expect(generated.document.sceneId).not.toBe(original.document.sceneId)
  expect(Object.keys(generated.document.terrainAreas).length).toBeGreaterThan(0)
  expect(Object.keys(generated.document.paths).length).toBeGreaterThan(0)
  if (domain === 'mixed') expect(Object.keys(generated.document.rooms)).toHaveLength(2)

  await openTerrainTask(page, '局部重生成')
  const local = page.getByRole('region', { name: '受限局部重生成', exact: true })
  const forestRecipe = await local.getByLabel('局部生成配方', { exact: true }).locator('option').filter({ hasText: /^森林/ }).getAttribute('value')
  expect(forestRecipe).toBeTruthy()
  await local.getByLabel('局部生成配方', { exact: true }).selectOption(forestRecipe!)
  await local.getByLabel('局部植被覆盖百分比', { exact: true }).fill(domain === 'forest' ? '3' : '4')
  await local.getByRole('button', { name: '预览局部重生成', exact: true }).click()
  await expect(inspector.getByLabel('局部重生成候选摘要', { exact: true })).toBeVisible({ timeout: 90000 })
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(generated.document.revision))
  await inspector.getByRole('button', { name: '保护并采用局部修改', exact: true }).click()
  await saved(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('edited.sceneweave'))
  expect(edited.document.sceneId).toBe(generated.document.sceneId)
  expect(edited.document.revision).toBe(generated.document.revision + 1)
  expect(edited.document.props).not.toEqual(generated.document.props)
  expect(edited.document.rooms).toEqual(generated.document.rooms)
  expect(edited.document.paths).toEqual(generated.document.paths)
  expect(keyboardResourceHashes(edited.hashes)).toEqual(keyboardResourceHashes(generated.hashes))
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('undo.sceneweave'))).document.props).toEqual(generated.document.props)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('redo.sceneweave'))
  expect(redone.document.props).toEqual(edited.document.props)
  expect(redone.document.revision).toBe(edited.document.revision + 2)
  await coldOpen(page, redone.document.sceneId)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.document).toEqual(redone.document)
  expect(cold.identity).toEqual(redone.identity)
  expect(cold.appearance).toEqual(redone.appearance)
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(redone.hashes))

  const download = page.waitForEvent('download')
  await (await mapExportButton(page, 'player')).click()
  const path = info.outputPath('player.png'); await (await download).saveAs(path)
  const png = await readFile(path)
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(Math.max(png.readUInt32BE(16), png.readUInt32BE(20))).toBe(4096)
  await page.locator('.workspace-export-menu > summary').click()
  await coldOpen(page, original.document.sceneId)
  const preserved = await keyboardProjectBackup(page, info.outputPath('original-cold.sceneweave'))
  expect(preserved.document).toEqual(original.document)
  expect(preserved.hashes).toEqual(original.hashes)
  expect(workers.some(url => /\/worker-[^/]+\.js(?:\?|$)/.test(url))).toBe(true)
  expect(generationRequests).toEqual([])
  expect(errors).toEqual([])
  await writeFile(info.outputPath('core-journey-facts.json'), JSON.stringify({ domain, original: original.document.sceneId,
    generated: cold.document.sceneId, revision: cold.document.revision, props: Object.keys(cold.document.props).length,
    rooms: Object.keys(cold.document.rooms).length, workers, generationRequests, errors,
    coldContentAndResourcesEqual: true, originalPreserved: true, playerPng: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } }, null, 2))
})
