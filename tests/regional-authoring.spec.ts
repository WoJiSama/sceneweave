import { expect, test, type Page } from '@playwright/test'
import type { Workspace } from '../src/application/workspace/workspace.js'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts.js'

type Dev = { workspace: Workspace }

async function state(page: Page) {
  return page.evaluate(async () => {
    const runtimePath = '/src/platform/browser/runtime.ts', projectPath = '/src/application/workspace/project.ts', validatePath = '/src/shared/project/validate.ts'
    const { projectRepository } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { toBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { projectContentHash } = await import(validatePath) as typeof import('../src/shared/project/validate')
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace, project = workspace.getState().project!
    const cold = await projectRepository.load(project.document.sceneId)
    return { hash: projectContentHash(toBundle(project).project), coldHash: cold ? projectContentHash(cold.project) : null, document: project.document, cold: cold?.project ?? null, snapshots: await projectRepository.listSnapshots(project.document.sceneId) }
  })
}

async function settled(page: Page) {
  await expect(page.getByRole('article', { name: '区域候选', exact: true })).toHaveCount(0, { timeout: 120_000 })
  await expect(page.getByRole('button', { name: '完整工程', exact: true })).toBeEnabled({ timeout: 120_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 120_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 })
}

test('regional authoring UI previews all recipes, protects an edit, drills down, compares source and imports an offline package', async ({ page, browser, context, browserName }, info) => {
  test.setTimeout(900_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#workspace'); await page.waitForFunction(() => Boolean(Reflect.get(window, '__sceneweaveOutdoorDev')))
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  const recipeNames = ['河谷古道', '林间湖区', '群山隘口'] as const
  for (const [index, name] of recipeNames.entries()) {
    await page.getByLabel('区域配方', { exact: true }).selectOption(['riverlands', 'lakewood', 'highlands'][index])
    await page.getByLabel('区域种子', { exact: true }).fill(`regional-ui-${index + 1}`)
    await page.getByRole('button', { name: '预览独立区域地图', exact: true }).click()
    await expect(page.getByRole('article', { name: '区域候选', exact: true })).toBeVisible({ timeout: 120_000 })
    await expect(page.getByRole('article', { name: '区域候选', exact: true })).toContainText(name)
    if (index < recipeNames.length - 1) {
      await page.getByRole('button', { name: '取消区域候选', exact: true }).click()
      await expect(page.getByRole('article', { name: '区域候选', exact: true })).toHaveCount(0)
    }
  }
  await page.getByLabel('确认区域候选范围', { exact: true }).check()
  await page.getByRole('button', { name: '保存并打开独立区域候选', exact: true }).click()
  await settled(page)
  const parent = await state(page)
  expect(parent.document.mapMode).toBe('regional'); expect(parent.document.regional).toBeTruthy()
  const parentSceneId = parent.document.sceneId

  await page.getByRole('group', { name: '新增区域实体', exact: true }).getByRole('button', { name: '新增区域面', exact: true }).click()
  await page.getByRole('button', { name: '预览区域实体修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '区域候选', exact: true })).toBeVisible({ timeout: 120_000 })
  await page.getByLabel('确认区域候选范围', { exact: true }).check()
  await page.getByRole('button', { name: '保护并采用区域修改', exact: true }).click()
  await settled(page)
  const edited = await state(page)
  expect(edited.document.sceneId).toBe(parentSceneId)
  expect(edited.document.revision).toBe(parent.document.revision + 1)
  expect(Object.keys(edited.document.regional!.areas).length).toBeGreaterThan(Object.keys(parent.document.regional!.areas).length)
  expect(edited.snapshots.filter(row => row.kind === 'protection')).toHaveLength(parent.snapshots.filter(row => row.kind === 'protection').length + 1)

  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click()
  await settled(page)
  const undone = await state(page)
  expect(undone.document.sceneId).toBe(parentSceneId)
  expect(undone.document.regional!.areas).toEqual(parent.document.regional!.areas)
  expect(undone.document.revision).toBe(edited.document.revision + 1)
  await expect(page.getByRole('button', { name: '重做素材编辑', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click()
  await settled(page)
  const redone = await state(page)
  expect(redone.document.regional!.areas).toEqual(edited.document.regional!.areas)
  expect(redone.document.revision).toBe(undone.document.revision + 1)

  await page.getByRole('button', { name: '预览独立下钻场景', exact: true }).click()
  await expect(page.getByRole('article', { name: '区域候选', exact: true })).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('article', { name: '区域候选', exact: true })).toContainText('来源快照')
  await page.getByLabel('确认区域候选范围', { exact: true }).check()
  await page.getByRole('button', { name: '保存并打开独立区域候选', exact: true }).click()
  await settled(page)
  await expect(page.locator('.regional-source')).toBeVisible()
  await page.getByRole('button', { name: '核对父图来源', exact: true }).click()
  await expect(page.locator('.regional-source [role="status"]')).toContainText('一致', { timeout: 120_000 })
  const child = await state(page)
  expect(child.document.sceneId).not.toBe(parentSceneId)
  expect(Object.keys(getLegacyGeneration(child.document)?.sourceLinks ?? {})).toHaveLength(1)
  expect(child.cold?.document.sceneId).toBe(child.document.sceneId)
  expect(child.coldHash).toBe(child.hash)

  const offlineStage = await page.evaluate(async () => {
    const runtimePath = '/src/platform/browser/runtime.ts', projectPath = '/src/application/workspace/project.ts', filePath = '/src/shared/project/file.ts', validatePath = '/src/shared/project/validate.ts'
    const rendererPath = '/src/platform/browser/render/renderer.ts', pngPath = '/tests/helpers/m2-joint-browser.ts'
    const { validation } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { toBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { exportProject } = await import(filePath) as typeof import('../src/shared/project/file')
    const { projectContentHash } = await import(validatePath) as typeof import('../src/shared/project/validate')
    const { exportPng } = await import(rendererPath) as typeof import('../src/platform/browser/render/renderer')
    const { readActualPng } = await import(pngPath) as typeof import('./helpers/m2-joint-browser')
    const project = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!
    const bundle = toBundle(project), bytes = await exportProject(bundle, validation)
    const png = async (audience: 'gm' | 'player') => {
      const value = await readActualPng(await exportPng(bundle, { audience, longEdgePx: 4096 }))
      return { width: value.width, height: value.height, rgbaHash: value.rgbaHash, chunks: value.chunks, containsMetadata: /sceneweave-complete-project|generationMetadata|SECRET/.test(value.rawText) }
    }
    const stage = { bytes: Array.from(bytes), sceneId: project.document.sceneId, contentHash: projectContentHash(bundle.project), gm: await png('gm'), player: await png('player') }
    Reflect.set(window, '__regionalOfflineRoundTrip', async () => {
      const { importProject } = await import(filePath) as typeof import('../src/shared/project/file')
      const { projectContentHash } = await import(validatePath) as typeof import('../src/shared/project/validate')
      const imported = await importProject(Uint8Array.from(stage.bytes), validation)
      const nextBundle = imported
      const result: Record<string, unknown> = { sceneId: nextBundle.project.document.sceneId, contentHash: projectContentHash(nextBundle.project) }
      for (const audience of ['gm', 'player'] as const) {
        const value = await readActualPng(await exportPng(nextBundle, { audience, longEdgePx: 4096 }))
        result[audience] = { width: value.width, height: value.height, rgbaHash: value.rgbaHash, chunks: value.chunks, containsMetadata: /sceneweave-complete-project|generationMetadata|SECRET/.test(value.rawText) }
      }
      return result
    })
    return stage
  })
  expect(offlineStage.sceneId).toBe(child.document.sceneId)
  expect(offlineStage.gm.width).toBeGreaterThan(0)
  expect(offlineStage.player.width).toBe(offlineStage.gm.width)
  for (const image of [offlineStage.gm, offlineStage.player]) {
    expect(image.containsMetadata).toBe(false)
    expect([...new Set(image.chunks)]).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
    expect(image.rgbaHash).toMatch(/^[a-f0-9]{64}$/)
  }
  let requestsAfterOffline = 0
  const countNetwork = (request: import('@playwright/test').Request) => { if (/^https?:/.test(request.url())) requestsAfterOffline++ }
  page.on('request', countNetwork)
  const denyNetwork = (route: import('@playwright/test').Route) => route.abort('internetdisconnected')
  if (browserName === 'webkit') await context.route(/^https?:/, denyNetwork); else await page.context().setOffline(true)
  let offlineResult: { sceneId: string; contentHash: string; gm: typeof offlineStage.gm; player: typeof offlineStage.player }
  try {
    offlineResult = await page.evaluate(async () => {
      const run = Reflect.get(window, '__regionalOfflineRoundTrip') as () => Promise<{ sceneId: string; contentHash: string; gm: typeof offlineStage.gm; player: typeof offlineStage.player }>
      return run()
    })
  } finally { if (browserName === 'webkit') await context.unroute(/^https?:/, denyNetwork); else await page.context().setOffline(false); page.off('request', countNetwork) }
  expect(requestsAfterOffline).toBe(0)
  expect(offlineResult.sceneId).toBe(child.document.sceneId)
  expect(offlineResult.contentHash).toBe(offlineStage.contentHash)
  expect(offlineResult.gm.rgbaHash).toBe(offlineStage.gm.rgbaHash)
  expect(offlineResult.player.rgbaHash).toBe(offlineStage.player.rgbaHash)

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const download = await downloadEvent, packagePath = info.outputPath('regional-child.sceneweave'); await download.saveAs(packagePath)
  const coldContext = await browser.newContext(), coldPage = await coldContext.newPage()
  try {
    await coldPage.goto('/#workspace')
    await coldPage.getByLabel('选择完整工程', { exact: true }).setInputFiles(packagePath)
    await expect.poll(async () => { try { return (await state(coldPage)).document.schemaVersion } catch { return null } }, { timeout: 120_000 }).toBe(3)
    const imported = await state(coldPage)
    expect(imported.document.sceneId).not.toBe(child.document.sceneId)
    expect(imported.coldHash).toBe(imported.hash)
    expect(getLegacyGeneration(imported.document)?.sourceLinks).toEqual(getLegacyGeneration(child.document)?.sourceLinks)
    expect(imported.document.regional).toEqual(child.document.regional)
  } finally { await coldContext.close() }
  await info.attach('regional-authoring-facts.json', { body: JSON.stringify({ recipes: recipeNames, parentSceneId, childSceneId: child.document.sceneId, childRevision: child.document.revision, sourceLinks: Object.keys(getLegacyGeneration(child.document)?.sourceLinks ?? {}).length, coldHash: child.coldHash, packageBytes: offlineStage.bytes.length, offline: { requestsAfterOffline, gm: offlineStage.gm, player: offlineStage.player } }), contentType: 'application/json' })
  expect(errors).toEqual([])
})
