import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'vite'
import { writeFile } from 'node:fs/promises'
import { keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openSceneObjects } from './workspace-navigation-helpers'

async function select(page: Page, id: string) {
  const list = await openSceneObjects(page)
  await list.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await list.locator(`[data-entity-id="${id}"]`).click()
  await openKeyboardPanel(page, 'inspector')
}

test('associated notes remain read-only under locks, follow anchors, guard drafts and stay GM-only', async ({ page }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(20000)
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  let bytes: Uint8Array
  try {
    const { fixture, validation, runtime } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const bundle = fixture({ building: true }), scene = bundle.project.document
    scene.title = '锁定档案室与递归线索'
    scene.rooms.room.purpose = '档案室'
    scene.rooms.room.editLocked = true
    scene.openings['archive-door'] = { id: 'archive-door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0', offsetMm: 2000, widthMm: 1000, kind: 'door', state: 'closed', locked: true, secret: false, revealed: false }
    const base = { floorId: 'blank-floor', editLocked: false, kind: 'clue', visibility: 'gm' }
    scene.notes = {
      'room-note': { ...base, id: 'room-note', title: '封存登记', text: '登记正文\n下一行仍完整保留。', anchor: { type: 'entity', entityKind: 'room', entityId: 'room' } },
      'room-child': { ...base, id: 'room-child', title: '登记背面的补记', text: '柜后留有另一份名单。', anchor: { type: 'entity', entityKind: 'note', entityId: 'room-note' } },
      'prop-note': { ...base, id: 'prop-note', title: '信封', text: '独立物件上的旧信。', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } },
      'door-note': { ...base, id: 'door-note', title: '旧标题：已锁', text: '钥匙由当值管理员保管。', anchor: { type: 'entity', entityKind: 'opening', entityId: 'archive-door' } },
      'door-child': { ...base, id: 'door-child', title: '门后附记', text: '递归门注记。', anchor: { type: 'entity', entityKind: 'note', entityId: 'door-note' } },
      nearby: { ...base, id: 'nearby', title: '附近的坐标注记', text: '靠近房间并不等于附着房间。', anchor: { type: 'point', positionMm: { x: 6500, y: 6500 } } },
    }
    scene.notes['room-note'].editLocked = true
    for (const id of ['archive-door', ...Object.keys(scene.notes)]) scene.entityLayers[id] = scene.entityLayers.room
    Object.assign(bundle.project, createCompositionContent(scene, runtime))
    bytes = await exportProject(bundle, validation)
  } finally { await vite.close() }
  await writeFile(info.outputPath('input.sceneweave'), bytes!)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('native-project-file').setInputFiles({ name: 'archive.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes!) })
  await keyboardWorkspaceSaved(page)
  const initial = await keyboardProjectBackup(page, info.outputPath('initial.sceneweave'))
  const reader = page.getByRole('region', { name: '关联注记', exact: true })
  await select(page, 'room')
  await expect(reader.locator('[data-associated-note-id]')).toHaveCount(2)
  await expect(reader).toContainText('柜后留有另一份名单。')
  await expect(reader).not.toContainText('靠近房间并不等于附着房间。')
  await expect(page.getByLabel('编辑房间名称', { exact: true })).toBeDisabled()
  const summary = reader.locator('[data-associated-note-id="room-note"] > summary')
  await summary.focus(); await summary.press('Enter'); await summary.press('Enter')
  await expect(reader.locator('[data-associated-note-id="room-note"]')).toHaveAttribute('open', '')
  await reader.getByRole('button', { name: '查看注记：封存登记', exact: true }).click()
  await expect(page.getByLabel('编辑注记内容', { exact: true })).toBeDisabled()
  await expect(reader).toContainText('登记正文\n下一行仍完整保留。')
  await reader.getByRole('button', { name: '附着于：档案室', exact: true }).click()
  await expect(page.getByLabel('编辑房间名称', { exact: true })).toHaveValue('档案室')
  await select(page, 'item')
  await expect(reader.locator('[data-associated-note-id]')).toHaveCount(1)
  await expect(reader).toContainText('独立物件上的旧信。')
  expect((await keyboardProjectBackup(page, info.outputPath('read-only.sceneweave'))).hashes).toEqual(initial.hashes)

  await select(page, 'archive-door')
  const status = reader.getByLabel('当前已采用门状态', { exact: true })
  await expect(status).toHaveText('当前已采用门状态：关闭 · 已锁 · 普通门')
  await page.getByLabel('门窗状态', { exact: true }).selectOption('open')
  await page.getByLabel('门通行锁', { exact: true }).uncheck()
  await expect(status).toHaveText('当前已采用门状态：关闭 · 已锁 · 普通门')
  await reader.getByRole('button', { name: '查看注记：旧标题：已锁', exact: true }).click()
  await expect(page.getByLabel('门窗状态', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消建筑属性草稿', exact: true }).click()
  await expect(page.getByLabel('门窗状态', { exact: true })).toHaveValue('closed')
  expect((await keyboardProjectBackup(page, info.outputPath('draft-cancelled.sceneweave'))).hashes).toEqual(initial.hashes)
  await page.getByLabel('门窗状态', { exact: true }).selectOption('open')
  await page.getByLabel('门通行锁', { exact: true }).uncheck()
  await page.getByRole('button', { name: '预览门窗修改', exact: true }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(page.locator('.asset-notice')).toContainText('已锁定')
  await expect(review).toHaveCount(0)
  await page.getByRole('button', { name: '取消建筑属性草稿', exact: true }).click()
  expect((await keyboardProjectBackup(page, info.outputPath('locked-rejected.sceneweave'))).hashes).toEqual(initial.hashes)
  // Unlock the actual dependencies explicitly before changing the door.
  for (const id of ['room', 'room-note']) {
    await select(page, id)
    await page.getByRole('button', { name: '解除建筑对象编辑锁', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }
  await select(page, 'archive-door')
  await page.getByLabel('门窗状态', { exact: true }).selectOption('open')
  await page.getByLabel('门通行锁', { exact: true }).uncheck()
  await page.getByRole('button', { name: '预览门窗修改', exact: true }).click()
  await expect(review).toBeVisible()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await select(page, 'archive-door')
  await expect(status).toHaveText('当前已采用门状态：开启 · 未锁 · 普通门')
  await expect(reader).toContainText('旧标题：已锁')
  await reader.getByRole('button', { name: '查看注记：门后附记', exact: true }).click()
  await expect(status).toHaveText('当前已采用门状态：开启 · 未锁 · 普通门')
  await reader.getByRole('button', { name: /^查看附着门：/ }).click()
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await expect(status).toHaveText('当前已采用门状态：关闭 · 已锁 · 普通门')
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await expect(status).toHaveText('当前已采用门状态：开启 · 未锁 · 普通门')

  await select(page, 'prop-note')
  const text = '主持人新内容：<script>window.secret = true</script>\n第二段保持纯文本。'
  await page.getByLabel('编辑注记内容', { exact: true }).fill(text)
  await expect(reader.locator('.associated-note-text')).toHaveText('独立物件上的旧信。')
  await page.getByRole('button', { name: '预览注记修改', exact: true }).click()
  await expect(review).toBeVisible()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await select(page, 'item')
  await expect(reader.locator('.associated-note-text')).toHaveText(text)
  expect(await page.evaluate(() => 'secret' in window)).toBe(false)
  const final = await keyboardProjectBackup(page, info.outputPath('final.sceneweave'))
  expect(final.document.notes['prop-note'].text).toBe(text)
  expect(final.document.revision).toBe(initial.document.revision + 6)
  expect(final.document.rooms.room.editLocked).toBe(false)
  expect(final.document.notes['room-note'].editLocked).toBe(false)
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '玩家', exact: true }).click()
  await expect(reader).toHaveCount(0)
  await expect(page.getByText(text, { exact: true })).toHaveCount(0)
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.reload()
  await page.locator(`[data-project-key="native:${final.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))).hashes).toEqual(final.hashes)
  await select(page, 'item')
  await expect(reader.locator('.associated-note-text')).toHaveText(text)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ success: true, readOnlyHashesExact: true, recursiveAnchors: true, lockedReading: true, draftNavigationGuard: true, adoptedDoorState: true, playerReaderAbsent: true, coldHashesExact: true, errors }, null, 2))
})
