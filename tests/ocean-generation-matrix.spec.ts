import { test, expect } from '@playwright/test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openGenerationTask } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

for (const [kind, name] of [['coast', '海岸'], ['island', '岩岛']] as const) for (const size of ['36000x20000', '48000x36000']) for (const seed of ['ocean-final-0', 'ocean-final-1', 'ocean-final-2']) {
  test(`ocean generation matrix ${kind} ${size} ${seed}`, async ({ page }, info) => {
    await createKeyboardProject(page, `海洋生成组合-${kind}`)
    await openGenerationTask(page, '自然地形')
    await page.getByRole('button', { name: `选择${name}地形`, exact: true }).click()
    await page.getByLabel('地形画布尺寸', { exact: true }).selectOption(size)
    await page.getByLabel('地形方案种子', { exact: true }).fill(seed)
    await page.getByLabel('生成海洋水面与布景', { exact: true }).check()
    await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
    await expect(page.getByLabel('当前地形候选', { exact: true })).toBeVisible({ timeout: 150000 })
    const report = await page.getByText(/海洋步骤：/).locator('..').innerText()
    await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
    await expect(page.getByLabel('当前地形候选', { exact: true })).toHaveCount(0, { timeout: 90000 }); await keyboardWorkspaceSaved(page)
    const stem = `${kind}-${size}-${seed}`, file = info.outputPath(`${stem}.sceneweave`)
    const project = await keyboardProjectBackup(page, file)
    expect(Object.values(project.document.terrainAreas).some(a => a.waterSurface)).toBe(true)
    const props = Object.values(project.document.props).filter(p => p.waterAppearance)
    expect(props.length).toBeGreaterThan(0)
    for (const prop of props) expect(prop.visualBoundsMm).toEqual(project.document.propDefinitions[prop.definitionRef!.id].defaultVisualBoundsMm)
    const dir = join(process.env.SCENEWEAVE_OCEAN_DELIVERY_DIR ?? 'work/ocean-finalization-20261117/delivery', 'matrix')
    await mkdir(dir, { recursive: true }); await writeFile(join(dir, `${stem}.sceneweave`), await readFile(file))
    for (const audience of ['gm', 'player'] as const) {
      const downloading = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
      await (await downloading).saveAs(join(dir, `${stem}-${audience}.png`)); await keyboardWorkspaceSaved(page)
      await page.locator('.workspace-export-menu > summary').click()
    }
    await writeFile(info.outputPath('facts.json'), JSON.stringify({ kind, size, seed, report, props: props.map(p => ({ id: p.id, size: p.visualBoundsMm })) }, null, 2))
  })
}
