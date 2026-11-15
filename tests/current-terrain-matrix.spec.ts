import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { TERRAIN_FIXED_SEEDS } from '../src/shared/terrain-generation/generate'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts'
import { validateSceneDocument } from '../src/shared/validation/scene'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openGenerationTask } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const kinds = { island: '岩岛', coast: '海岸', river: '河谷', lake: '内湖', forest: '森林', hill: '丘陵', mixed: '混合' } as const

// This is the complete published seven-kind/five-seed matrix at the standard
// review size. The explicit production configuration keeps it out of daily CI.
for (const [kind, label] of Object.entries(kinds)) for (const seed of TERRAIN_FIXED_SEEDS) {
  test(`${kind} ${seed}: normal generation, complete save and cold audience output`, async ({ page, browser }, info) => {
    test.setTimeout(240000)
    if (!process.env.SCENEWEAVE_TERRAIN_MATRIX) throw Error('Use the frozen production matrix configuration')
    const errors: string[] = [], workers: string[] = []
    page.on('pageerror', error => errors.push(error.message)); page.on('worker', worker => workers.push(worker.url()))
    await createKeyboardProject(page, `地形固定种子 · ${kind} · ${seed}`)
    const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
    await openGenerationTask(page, '自然地形')
    await page.getByRole('button', { name: `选择${label}地形`, exact: true }).click()
    await page.getByLabel('地形画布尺寸', { exact: true }).selectOption('24000x18000')
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
    expect(warm.document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 24000, height: 18000 })
    for (const [collection, expected] of Object.entries(expectedCounts)) {
      const key = collection as keyof typeof expectedCounts
      expect(Object.keys(warm.document[key])).toHaveLength(expected)
    }
    const generation = getLegacyGeneration(warm.document)
    expect(generation).toBeDefined()
    expect(Object.values(generation!.recipes).some(recipe => recipe.seed === seed)).toBe(true)
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
    await writeFile(info.outputPath('facts.json'), JSON.stringify({ kind, seed, sizeMm: [24000, 18000], expectedCounts,
      sceneId: warm.document.sceneId, preservedSceneId: before.document.sceneId, generation,
      errors, workers, browserVersion: browser.version() }, null, 2))
  })
}
