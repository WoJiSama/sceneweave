import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { TERRAIN_FIXED_SEEDS } from '../src/shared/terrain-generation/generate'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts'
import { validateSceneDocument } from '../src/shared/validation/scene'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openGenerationTask, openTerrainTask } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const kinds = { island: '岩岛', coast: '海岸', river: '河谷', lake: '内湖', forest: '森林', hill: '丘陵', mixed: '混合' } as const

// Explicit forest8 production journey: five released seeds, an independent
// seed at two sizes and controls through the ordinary natural-terrain entry.
const cases = [...TERRAIN_FIXED_SEEDS.map(seed => ({kind:'forest' as const,seed,widthMm:24000,heightMm:18000})),
  ...[[36000,20000],[120000,90000]].map(([widthMm,heightMm]) => ({kind:'forest' as const,seed:'forest-independent-20261114',widthMm,heightMm})),
  ...(['island','mixed'] as const).map(kind => ({kind,seed:TERRAIN_FIXED_SEEDS[0],widthMm:24000,heightMm:18000}))]
for (const {kind,seed,widthMm,heightMm} of cases) {
  const label=kinds[kind]
  test(`${kind} ${seed} ${widthMm}x${heightMm}: normal generation, complete save and cold audience output`, async ({ page, browser }, info) => {
    test.setTimeout(240000)
    if (!process.env.SCENEWEAVE_FOREST_LAYOUT_MATRIX) throw Error('Use the frozen production matrix configuration')
    const errors: string[] = [], workers: string[] = []
    page.on('pageerror', error => errors.push(error.message)); page.on('worker', worker => workers.push(worker.url()))
    await createKeyboardProject(page, `地形固定种子 · ${kind} · ${seed}`)
    const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
    await openGenerationTask(page, '自然地形')
    await page.getByRole('button', { name: `选择${label}地形`, exact: true }).click()
    await page.getByLabel('地形画布尺寸', { exact: true }).selectOption(`${widthMm}x${heightMm}`)
    await page.getByLabel('地形方案种子', { exact: true }).fill(seed)
    await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
    const candidate = page.getByRole('article', { name: '当前地形候选', exact: true })
    await expect(candidate).toBeVisible({ timeout: 90000 })
    await expect(candidate).toContainText(seed)
    await expect(candidate.locator('[data-status="failed"], [data-status="unchecked"]')).toHaveCount(0)
    const count = async (name: string) => Number(await candidate.locator('.terrain-generation-facts > div').filter({ has: page.locator('dt', { hasText: name }) }).locator('dd').textContent())
    const expectedCounts = { terrainAreas: await count('地形分区'), props: await count('树石物件'), terrainConnections: await count('高差连接') }
    await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled()
    await page.screenshot({ path: info.outputPath('candidate.png') })
    await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
    await expect(candidate).toHaveCount(0, { timeout: 90000 }); await keyboardWorkspaceSaved(page)
    const warm = await keyboardProjectBackup(page, info.outputPath('warm.sceneweave'))
    expect(warm.document.sceneId).not.toBe(before.document.sceneId)
    expect(validateSceneDocument(warm.document).ok).toBe(true)
    expect(warm.document.exportBoundsMm).toEqual({ x: 0, y: 0, width: widthMm, height: heightMm })
    for (const [collection, expected] of Object.entries(expectedCounts)) {
      const key = collection as keyof typeof expectedCounts
      expect(Object.keys(warm.document[key])).toHaveLength(expected)
    }
    const generation = getLegacyGeneration(warm.document)
    expect(generation).toBeDefined()
    const algorithmVersion = kind === 'forest' ? 8 : kind === 'island' ? 10 : 5
    expect(Object.values(generation!.recipes).some(recipe => recipe.seed === seed && recipe.algorithmVersion === algorithmVersion)).toBe(true)
    for (const audience of ['gm', 'player'] as const) {
      const pending = page.waitForEvent('download', { timeout: 60000 })
      await (await mapExportButton(page, audience)).click(); await (await pending).saveAs(info.outputPath(`warm-${audience}.png`))
      await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
    }
    await page.getByRole('button', { name: '回到首页', exact: true }).click(); await page.reload()
    await page.locator(`[data-project-key="native:${warm.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
    expect(cold.hashes).toEqual(warm.hashes)
    for (const audience of ['gm', 'player'] as const) {
      const pending = page.waitForEvent('download', { timeout: 60000 })
      await (await mapExportButton(page, audience)).click(); await (await pending).saveAs(info.outputPath(`cold-${audience}.png`))
      await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
    }
    expect(errors).toEqual([])
    await writeFile(info.outputPath('facts.json'), JSON.stringify({ kind, seed, sizeMm: [widthMm, heightMm], expectedCounts,
      sceneId: warm.document.sceneId, preservedSceneId: before.document.sceneId, generation,
      errors, workers, browserVersion: browser.version() }, null, 2))
  })
}

test('forest8 local brush preserves its recipe through cancel, adopt, undo, redo and cold open', async ({ page }, info) => {
  test.skip(!process.env.SCENEWEAVE_FOREST_EDIT_INPUT, 'Requires an independently generated full forest8 project')
  test.setTimeout(240000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByTestId('native-project-file').setInputFiles(process.env.SCENEWEAVE_FOREST_EDIT_INPUT!)
  await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const recipe = Object.values(getLegacyGeneration(before.document)!.recipes).find(recipe => recipe.algorithmVersion === 8)!
  expect(recipe).toBeDefined()
  const prop = Object.values(before.document.props)[0]
  expect(prop.supportRef.kind).toBe('terrainArea')
  await openTerrainTask(page, '修改地形')
  const panel = page.getByRole('region', { name: '局部地形编辑', exact: true })
  const impact = page.getByTestId('workspace-inspector').getByRole('article', { name: '本次地形影响', exact: true })
  const preview = async () => {
    await panel.getByRole('button', { name: '清出空地', exact: true }).click()
    await panel.getByLabel('地形编辑作用地形', { exact: true }).selectOption(prop.supportRef.id)
    await panel.getByLabel('地形编辑笔刷半径', { exact: true }).fill('0.3')
    await panel.getByLabel('地形编辑笔刷半径', { exact: true }).press('Tab')
    await panel.getByText('键盘落笔', { exact: true }).click()
    await panel.getByLabel('地形编辑落笔 X mm', { exact: true }).fill(String(prop.positionMm.x))
    await panel.getByLabel('地形编辑落笔 Y mm', { exact: true }).fill(String(prop.positionMm.y))
    await panel.getByRole('button', { name: '添加落笔并预览', exact: true }).click()
    await expect(impact).toBeVisible({ timeout: 90000 })
    await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision))
  }
  await preview()
  await impact.getByRole('button', { name: '取消本次地形修改', exact: true }).click()
  expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).hashes).toEqual(before.hashes)
  await preview()
  await impact.getByLabel('确认本次地形影响范围', { exact: true }).check()
  await impact.getByRole('button', { name: '保护并采用地形修改', exact: true }).click()
  await expect(impact).toHaveCount(0, { timeout: 90000 })
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('adopted.sceneweave'))
  expect(adopted.document.props[prop.id]).toBeUndefined()
  expect(getLegacyGeneration(adopted.document)!.recipes[recipe.id]).toEqual(recipe)
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document).toEqual({ ...before.document, revision: before.document.revision + 2, updatedAt: undone.document.updatedAt })
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('redone.sceneweave'))
  expect(redone.document).toEqual({ ...adopted.document, revision: before.document.revision + 3, updatedAt: redone.document.updatedAt })
  for (const audience of ['gm', 'player'] as const) {
    const pending = page.waitForEvent('download', { timeout: 60000 })
    await (await mapExportButton(page, audience)).click(); await (await pending).saveAs(info.outputPath(`warm-${audience}.png`))
    await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
  }
  await page.getByRole('button', { name: '回到首页', exact: true }).click(); await page.reload()
  await page.locator(`[data-project-key="native:${before.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(redone.hashes)
  for (const audience of ['gm', 'player'] as const) {
    const pending = page.waitForEvent('download', { timeout: 60000 })
    await (await mapExportButton(page, audience)).click(); await (await pending).saveAs(info.outputPath(`cold-${audience}.png`))
    await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
  }
  expect(errors).toEqual([])
  await writeFile(info.outputPath('edit-facts.json'), JSON.stringify({ recipe, propId: prop.id, errors, sceneId: before.document.sceneId,
    revisions: [before, adopted, undone, redone, cold].map(stage => stage.document.revision), unchangedSourceInput: process.env.SCENEWEAVE_FOREST_EDIT_INPUT }, null, 2))
})
