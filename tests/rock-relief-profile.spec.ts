import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { visualBase } from '../src/shared/visual/base'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSceneObjects, openVisualTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

let downloadedCandidate: string

function candidatePath(): string {
  if (!downloadedCandidate) throw new Error('普通页面尚未下载 profile4 模板工程。')
  return downloadedCandidate
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({ baseURL: info.project.use.baseURL })
  try {
    const page = await context.newPage()
    await createKeyboardProject(page, '岩面画法普通模板下载')
    await openWorkspaceModule(page, '素材与布景')
    const panel = page.getByRole('region', { name: '主题素材包', exact: true })
    await panel.locator(':scope > details > summary').click()
    await panel.getByText('火山 · 灰岩、冷壳与熔岩', { exact: true }).click()
    const pending = page.waitForEvent('download', { timeout: 120_000 })
    await panel.getByRole('button', { name: '下载场景 · 自然火口与熔岩池', exact: true }).click()
    const downloaded = await pending
    expect(downloaded.suggestedFilename()).toBe('natural-volcano.sceneweave')
    downloadedCandidate = info.outputPath('natural-volcano-profile4.sceneweave')
    await downloaded.saveAs(downloadedCandidate)
    await keyboardWorkspaceSaved(page)
  } finally { await context.close() }
})

async function importCandidate(page: Page): Promise<void> {
  await page.goto('./#home')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles(candidatePath())
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  await keyboardWorkspaceSaved(page)
}

function withoutDocumentMetadata<T extends { revision: number; updatedAt: string }>(document: T) {
  const { revision: _revision, updatedAt: _updatedAt, ...rest } = document
  return rest
}

function withoutVisual<T extends { revision: number; updatedAt: string; visual?: unknown }>(document: T) {
  const { revision: _revision, updatedAt: _updatedAt, visual: _visual, ...rest } = document
  return rest
}

test('ordinary profile4 stairs changes to profile2 with safe cancel, undo-redo and cold archive', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await importCandidate(page)

  const backup = (name: string) => keyboardProjectBackup(page, info.outputPath(`${name}.sceneweave`))
  const before = await backup('profile4-before')
  const stairs = Object.values(before.document.terrainConnections).find(connection => connection.route?.renderProfile === 'naturalRockSteps4')
  expect(stairs, 'profile4 stairs candidate').toBeDefined()
  const stairsId = stairs!.id
  const profile4Route = structuredClone(stairs!.route!)
  expect(profile4Route?.stairStyle).toBe('naturalRock')

  const objects = await openSceneObjects(page, '结构')
  await objects.locator(`[data-entity-id="${stairsId}"]`).click()
  const inspector = page.getByRole('region', { name: '室外对象属性', exact: true })
  await openDetailsBySummary(inspector, /^路线形态与踏面$/)
  await inspector.getByLabel('岩阶色调', { exact: true }).selectOption('naturalRockSteps2')
  await inspector.getByRole('button', { name: '预览对象修改', exact: true }).click()

  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  const scope = await review.getByLabel('待采用室外操作 ID', { exact: true }).inputValue()
  expect(scope.split('\n')).toContain(stairsId)
  await expect(review.getByRole('button', { name: '采用室外修改', exact: true })).toBeDisabled()
  await review.getByRole('button', { name: '取消室外预览', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cancelled = await backup('profile4-cancelled')
  expect(cancelled.hashes).toEqual(before.hashes)

  await inspector.getByLabel('岩阶色调', { exact: true }).selectOption('naturalRockSteps2')
  await inspector.getByRole('button', { name: '预览对象修改', exact: true }).click()
  const adoptedReview = page.getByRole('region', { name: '候选审阅', exact: true })
  await adoptedReview.getByLabel('确认完整影响范围', { exact: true }).check()
  await adoptedReview.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const adopted = await backup('profile2-adopted')
  expect(adopted.document.terrainConnections[stairsId].route).toEqual({ ...profile4Route, renderProfile: 'naturalRockSteps2' })
  const expectedDocument = structuredClone(before.document)
  expectedDocument.terrainConnections[stairsId].route = { ...profile4Route, renderProfile: 'naturalRockSteps2' }
  expect(withoutDocumentMetadata(adopted.document)).toEqual(withoutDocumentMetadata(expectedDocument))
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  expect(adopted.identity).toEqual(before.identity)
  expect(adopted.appearance).toEqual(before.appearance)
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await backup('profile4-undone')
  expect(undone.document.terrainConnections[stairsId].route).toEqual(profile4Route)
  expect(withoutDocumentMetadata(undone.document)).toEqual(withoutDocumentMetadata(before.document))
  expect(undone.identity).toEqual(before.identity)
  expect(undone.appearance).toEqual(before.appearance)
  expect(undone.document.revision).toBe(adopted.document.revision + 1)
  expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const redone = await backup('profile2-redone')
  expect(redone.document.terrainConnections[stairsId].route).toEqual({ ...profile4Route, renderProfile: 'naturalRockSteps2' })
  expect(withoutDocumentMetadata(redone.document)).toEqual(withoutDocumentMetadata(adopted.document))
  expect(redone.identity).toEqual(before.identity)
  expect(redone.appearance).toEqual(before.appearance)
  expect(redone.document.revision).toBe(undone.document.revision + 1)
  expect(keyboardResourceHashes(redone.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await backup('profile2-cold')
  expect(cold.hashes).toEqual(redone.hashes)
  await page.screenshot({ path: info.outputPath('profile2-cold.png') })
  expect(errors).toEqual([])
  await writeFile(info.outputPath('result.json'), JSON.stringify({
    ordinaryUI: true, formalAcceptance: false, source: candidatePath(),
    changedProfile: ['naturalRockSteps4', 'naturalRockSteps2'], scope: scope.split('\n'),
    cancelledArchiveUnchanged: true, profileOnlyChange: true, identityAndAppearancePreserved: true,
    undoRedoOnce: true, coldExactArchiveEntries: true, errors,
  }, null, 2))
})

test('ordinary VisualPanel changes an existing rockRelief4 cliff to rockRelief3 without physical edits', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await importCandidate(page)
  const backup = (name: string) => keyboardProjectBackup(page, info.outputPath(`${name}.sceneweave`))
  const before = await backup('cliff-relief4-before')
  const base = visualBase(before.document)
  expect(base).toBeDefined()
  const cliff = Object.values(base!.edgeLooks).find(edge => edge.kind === 'cliff' && edge.renderProfile === 'rockRelief4')
  expect(cliff, 'profile4 cliff candidate').toBeDefined()
  const cliffLook = structuredClone(cliff!)

  const tools = await openVisualTask(page, '边界')
  await tools.getByLabel('视觉已有曲线', { exact: true }).selectOption(cliffLook.boundaryId)
  await tools.getByLabel('崖面层次画法', { exact: true }).selectOption('rockRelief3')
  await tools.getByRole('button', { name: '预览曲线与边带', exact: true }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  const scope = await review.getByLabel('待采用视觉操作 ID', { exact: true }).inputValue()
  expect(scope.split('\n')).toEqual(expect.arrayContaining([cliffLook.id, cliffLook.boundaryId]))
  const binding = base!.boundaries[cliffLook.boundaryId].binding
  if (binding.kind === 'terrain') expect(scope.split('\n')).toEqual(expect.arrayContaining(binding.sides.map(side => side.areaId)))
  await expect(review.getByRole('button', { name: '采用视觉修改', exact: true })).toBeDisabled()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用视觉修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)

  const after = await backup('cliff-relief3-adopted')
  const afterBase = visualBase(after.document)
  expect(afterBase).toBeDefined()
  expect(afterBase!.edgeLooks[cliffLook.id]).toEqual({ ...cliffLook, renderProfile: 'rockRelief3' })
  expect(afterBase!.boundaries).toEqual(base!.boundaries)
  expect(afterBase!.edgeLooks).toEqual({ ...base!.edgeLooks, [cliffLook.id]: { ...cliffLook, renderProfile: 'rockRelief3' } })
  expect(withoutVisual(after.document)).toEqual(withoutVisual(before.document))
  const expectedDocument = structuredClone(before.document)
  visualBase(expectedDocument)!.edgeLooks[cliffLook.id].renderProfile = 'rockRelief3'
  expect(withoutDocumentMetadata(after.document)).toEqual(withoutDocumentMetadata(expectedDocument))
  expect(after.identity).toEqual(before.identity)
  expect(after.appearance).toEqual(before.appearance)
  expect(keyboardResourceHashes(after.hashes)).toEqual(keyboardResourceHashes(before.hashes))
  await page.screenshot({ path: info.outputPath('cliff-relief3-adopted.png') })
  expect(errors).toEqual([])
  await writeFile(info.outputPath('result.json'), JSON.stringify({
    ordinaryUI: true, formalAcceptance: false, source: candidatePath(),
    changedProfile: ['rockRelief4', 'rockRelief3'], scope: scope.split('\n'),
    profileOnlyChange: true, physicalDocumentPreserved: true, identityAndAppearancePreserved: true, errors,
  }, null, 2))
})
