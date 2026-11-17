import { test, expect } from '@playwright/test'
import { createKeyboardProject, keyboardWorkspaceSaved, keyboardProjectBackup, selectKeyboardProp } from './keyboard-ux-helpers'
import { openGenerationTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { projectBackupButton, reloadSaved } from './workspace-ux-helpers'

test.use({ actionTimeout: 15000 })

async function editAndColdReadProp(page: import('@playwright/test').Page, info: import('@playwright/test').TestInfo) {
  const before = await keyboardProjectBackup(page, info.outputPath('before-edit.sceneweave'))
  const prop = Object.values(before.document.props).find(value => typeof value.roomId === 'string')!
  expect(prop).toBeTruthy()
  const rotation = (prop.rotationDeg + 180) % 360
  await selectKeyboardProp(page, prop.id)
  const input = page.getByTestId('workspace-inspector').getByLabel('物件旋转', { exact: true })
  await input.fill(String(rotation)); await input.press('Tab')
  await keyboardWorkspaceSaved(page)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await expect(input).toHaveValue(String(prop.rotationDeg))
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('edited.sceneweave'))
  expect(edited.document.props[prop.id].rotationDeg).toBe(rotation)
  expect(edited.document.revision).toBeGreaterThan(before.document.revision)
  await reloadSaved(page)
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.document).toEqual(edited.document)
}

test('workflow discovery explains missing chat tools without modifying the scene', async ({ page }, info) => {
  const outbound: string[] = [], errors: string[] = []
  page.on('request', request => { if (/\/v1\//.test(request.url())) outbound.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '共享工作流发现')
  const panel = await openWorkspaceModule(page, 'AI')
  const guide = panel.getByLabel('AI 对话面板', { exact: true }).getByLabel('共享工作流与能力', { exact: true })
  await guide.locator(':scope > summary').click()
  await guide.getByLabel('选择制作工作流', { exact: true }).selectOption('sceneweave-image-items')
  await expect(guide.getByLabel('当前可用能力')).toContainText('尚未接线')
  await guide.getByText('效果依据与已知限制', { exact: true }).click()
  await expect(guide).toContainText('普通应用聊天尚无图片执行工具')
  await guide.getByText('步骤与完成依据', { exact: true }).click()
  await guide.getByRole('button', { name: '读取原图与有效断点', exact: true }).click()
  await expect(guide).toContainText('先读取image_import_workflow')
  await page.screenshot({ path: info.outputPath('workflow-discovery.png'), fullPage: true })
  expect(outbound).toEqual([])
  expect(errors).toEqual([])
  await keyboardWorkspaceSaved(page)
})

test('shared forest workflow reaches actual preview, complete save and cold reopening', async ({ page }, info) => {
  test.setTimeout(240000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '共享工作流原工程')
  await openGenerationTask(page, '混合场景')
  const panel = page.getByTestId('workspace-resources').getByRole('region', { name: '混合场景生成', exact: true })
  const guide = panel.getByLabel('共享工作流与能力', { exact: true })
  await guide.locator(':scope > summary').click()
  await expect(guide).toContainText('本入口可用')
  await guide.getByText('效果依据与已知限制', { exact: true }).click()
  const example = guide.getByRole('img', { name: /^2026-11-17真实CLI样例/ })
  await expect(example).toBeVisible()
  await expect.poll(() => example.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(2048)
  await panel.getByLabel('混合工程名称', { exact: true }).fill('工作流林中建筑')
  await panel.getByLabel('混合建筑房间数量', { exact: true }).fill('2')
  await panel.getByRole('button', { name: '预览混合场景', exact: true }).click()
  const candidate = page.getByTestId('workspace-inspector').getByLabel('混合候选摘要', { exact: true })
  await expect(candidate).toBeVisible({ timeout: 90000 })
  await expect(guide.getByLabel('工作流当前结果')).toContainText('真实候选：2个房间')
  await page.screenshot({ path: info.outputPath('forest-workflow-preview.png'), fullPage: true })
  await candidate.getByRole('button', { name: '保存混合场景为新工程', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '混合场景已完整保存并打开' })).toBeVisible({ timeout: 90000 })
  await keyboardWorkspaceSaved(page)
  const downloaded = page.waitForEvent('download')
  await (await projectBackupButton(page)).click()
  expect(await (await downloaded).failure()).toBeNull()
  await reloadSaved(page)
  await keyboardWorkspaceSaved(page)
  await editAndColdReadProp(page, info)
  expect(errors).toEqual([])
})

test('external CLI delivery imports through the normal page and remains editable after cold read', async ({ page }, info) => {
  test.skip(!process.env.SCENEWEAVE_WORKFLOW_CLI_PROJECT, 'Explicit actual CLI delivery required')
  test.setTimeout(180000)
  await page.goto('./#home')
  await page.getByTestId('native-project-file').setInputFiles(process.env.SCENEWEAVE_WORKFLOW_CLI_PROJECT!)
  await keyboardWorkspaceSaved(page)
  await editAndColdReadProp(page, info)
})
