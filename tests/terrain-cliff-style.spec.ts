import { expect, test, type Page } from '@playwright/test'

const current = (page: Page) => page.evaluate(async () => {
  const workspacePath = '/src/editor/main/Workbench.tsx'
  const { nativeWorkspace } = await import(workspacePath)
  const state = nativeWorkspace.getState()
  return { document: structuredClone(state.project!.document), canUndo: state.canUndo, canRedo: state.canRedo }
})
const saved = async (page: Page) => {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 120000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 })
}
async function selectTerrain(page: Page, id: string) {
  await page.getByRole('button', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '全部', exact: true }).click()
  await page.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
  await expect(page.getByRole('region', { name: '地形崖壁样式', exact: true })).toBeVisible()
}

for (const existing of [false, true]) test(`terrain selection ${existing ? 'switches an existing bound cliff' : 'creates a cliff without drawing'}, preserves physical geometry and supports preview, cancel, undo, redo and cold open`, async ({ page, context }, info) => {
  test.setTimeout(240000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const archive = await page.evaluate(async existing => {
    const fixturePath = '/tools/testing/terrain-cliff-fixtures.ts', artPath = '/src/platform/browser/content/visual-art-project.ts',
      samplesPath = '/src/shared/visual/sample-art.ts', filePath = '/src/shared/project/file.ts', validationPath = '/src/platform/browser/project-validation.ts',
      bundlePath = '/src/application/workspace/project.ts', basePath = '/src/shared/visual/base.ts'
    const { terrainCliffFixture } = await import(fixturePath), { materializeVisualArt } = await import(artPath),
      { VISUAL_SAMPLE_ART, VISUAL_SAMPLE_LICENSE } = await import(samplesPath), { exportProject } = await import(filePath),
      { browserProjectValidation } = await import(validationPath), { toBundle } = await import(bundlePath), { visualBase } = await import(basePath)
    const scene = terrainCliffFixture(0, 'sculpted', 'headland'), visual = visualBase(scene)!
    if (!existing) { delete visual.edgeLooks['independent-upper-coast-look']; delete visual.boundaries['independent-upper-coast'] }
    scene.title = '独立检查 · 选择地形生成崖壁样式'
    const first = await materializeVisualArt(scene, VISUAL_SAMPLE_ART, VISUAL_SAMPLE_LICENSE, (key: string) => `visual-art-${key}`)
    const bytes = await exportProject(toBundle(first), browserProjectValidation)
    let encoded = ''; for (let i = 0; i < bytes.length; i += 32768) encoded += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return btoa(encoded)
  }, existing)
  await page.getByRole('button', { name: '打开工程文件', exact: true }).click()
  const archiveBytes = Buffer.from(archive, 'base64')
  expect([...archiveBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  await page.getByTestId('native-project-file').setInputFiles({ name: '独立崖壁样式.sceneweave', mimeType: 'application/octet-stream', buffer: archiveBytes })
  await expect(page.getByTestId('outdoor-workbench')).toBeVisible({ timeout: 120000 }); await saved(page)
  const before = await current(page)
  await selectTerrain(page, 'independent-upper')
  const panel = page.getByRole('region', { name: '地形崖壁样式', exact: true })
  if (existing) await panel.getByLabel('地形崖壁作用范围', { exact: true }).selectOption('independent-upper-coast')
  await panel.getByLabel('地形崖面画法', { exact: true }).selectOption('rockRelief7')
  await panel.getByRole('button', { name: '预览崖壁样式', exact: true }).click()
  const review = page.locator('.asset-structure-preview').first()
  await expect(review.getByRole('button', { name: '采用视觉修改', exact: true })).toBeDisabled()
  expect(await current(page)).toEqual(before)
  await review.getByRole('button', { name: '取消视觉预览', exact: true }).click()
  expect(await current(page)).toEqual(before)
  await selectTerrain(page, 'independent-upper')
  if (existing) await panel.getByLabel('地形崖壁作用范围', { exact: true }).selectOption('independent-upper-coast')
  await panel.getByLabel('地形崖面画法', { exact: true }).selectOption('rockRelief7')
  await panel.getByRole('button', { name: '预览崖壁样式', exact: true }).click()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用视觉修改', exact: true }).click(); await saved(page)
  const adopted = await current(page)
  expect(adopted.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(adopted.document.terrainConnections).toEqual(before.document.terrainConnections)
  expect(adopted.document.materials).toEqual(before.document.materials); expect(adopted.document.assets).toEqual(before.document.assets)
  const newLooks = Object.values(adopted.document.visual.base.base.edgeLooks).filter((look: any) => !before.document.visual.base.base.edgeLooks[look.id]) as any[]
  const normalize = (value: any) => { const copy = structuredClone(value); delete copy.revision; delete copy.updatedAt; return copy }
  if (existing) {
    expect(newLooks).toHaveLength(0)
    const expected = structuredClone(before.document)
    expected.visual.base.base.edgeLooks['independent-upper-coast-look'].renderProfile = 'rockRelief7'
    expect(normalize(adopted.document)).toEqual(normalize(expected))
  } else {
    expect(newLooks).toHaveLength(1); expect(newLooks[0].renderProfile).toBe('rockRelief7')
    expect(Object.keys(adopted.document.visual.base.base.boundaries).length).toBe(Object.keys(before.document.visual.base.base.boundaries).length + 1)
  }
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const undone = await current(page)
  expect(normalize(undone.document)).toEqual(normalize(before.document))
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  const redone = await current(page); expect(normalize(redone.document)).toEqual(normalize(adopted.document))
  await selectTerrain(page, 'independent-upper')
  await info.attach('terrain-style-workspace.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await page.close()
  const cold = await context.newPage(); cold.on('pageerror', error => errors.push(error.message)); await cold.goto('/#home')
  await expect(cold.getByTestId('workspace-home')).toBeVisible({ timeout: 120000 })
  const resume = cold.getByRole('button', { name: '继续编辑', exact: true })
  if (await resume.count()) await resume.first().click()
  else await cold.locator('.home-project-row').filter({ hasText: '独立检查 · 选择地形生成崖壁样式' }).getByRole('button', { name: '打开', exact: true }).click()
  await saved(cold); const reopened = await current(cold)
  expect(reopened.document).toEqual(redone.document); expect(reopened.canUndo).toBe(false)
  const report = { initialRevision: before.document.revision, adoptedRevision: adopted.document.revision, undoRevision: undone.document.revision,
    redoRevision: redone.document.revision, reopenedRevision: reopened.document.revision, changedLooks: newLooks.map(look => look.id),
    existing, originalTerrainPreserved: true, materialResourcesPreserved: true, previewCancelPreservedBaseline: true, errors }
  await info.attach('terrain-style-ui-checks.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  expect(errors).toEqual([])
})
