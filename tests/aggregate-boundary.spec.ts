import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'vite'

async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
}

test('grouped prop and building inspectors preview boundary diagnostics before adoption', async ({ page }, info) => {
  test.setTimeout(90000)
  page.setDefaultTimeout(15000)
  // Fixture assets use Vite's ?raw contract; load them through their owning
  // transform rather than making Playwright parse license text as JavaScript.
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  let bytes: Uint8Array
  try {
    const { fixture, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const source = fixture({ building: true }), scene = source.project.document
    scene.title = '聚合边界预览开发自检'
    scene.aggregateCoordinates = { encoding: 'world', groups: {
      'boundary-root': { id: 'boundary-root', parentId: null, floorId: 'blank-floor', editLocked: false,
        frame: { translationMm: { x: 200, y: -300 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }] },
    } }
    scene.aggregateCoordinates.groups.building = { id: 'building', parentId: null, floorId: 'blank-floor', editLocked: false, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [
      { kind: 'room', id: 'room' }, ...Object.keys(scene.walls).map(id => ({ kind: 'wall', id })), ...Object.keys(scene.vertices).map(id => ({ kind: 'vertex', id })),
    ] }
    bytes = await exportProject(source, validation)
  } finally { await vite.close() }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles({ name: 'aggregate-boundary.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  const workbench = page.getByTestId('outdoor-workbench')
  await expect(workbench).toBeVisible(); await saved(page)
  await page.getByRole('tab', { name: '对象', exact: true }).click()
  await page.locator('[data-entity-id="item"]').click()
  const rotation = page.getByRole('spinbutton', { name: '物件旋转', exact: true })
  await rotation.fill('30'); await rotation.press('Enter')
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  await expect(workbench).toHaveAttribute('data-revision', '0')
  const relations = page.getByLabel('位置关联检查', { exact: true })
  await relations.locator('summary').click()
  await expect(relations).toContainText('附近对象不一定阻挡移动')
  await page.screenshot({ path: info.outputPath('aggregate-boundary-preview.png'), fullPage: true })
  await review.getByRole('button', { name: '取消组件预览', exact: true }).click()
  await expect(review).toHaveCount(0); await expect(workbench).toHaveAttribute('data-revision', '0')
  await rotation.fill('30'); await rotation.press('Enter')
  await review.getByRole('button', { name: '采用组件修改', exact: true }).click(); await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '1')
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '2')
  await expect(rotation).toHaveValue('0')
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  await page.reload()
  await page.goto('./#home')
  await page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: '聚合边界预览开发自检', exact: true }) })
    .getByRole('button', { name: '打开', exact: true }).click()
  await saved(page)
  await page.getByRole('tab', { name: '对象', exact: true }).click()
  await page.locator('[data-entity-id="item"]').click()
  await expect(page.getByRole('spinbutton', { name: '物件旋转', exact: true })).toHaveValue('30')
  await page.screenshot({ path: info.outputPath('aggregate-boundary.png'), fullPage: true })
  // Structural preview uses the same real production entry, including the
  // owning candidate review and its explicit full-scope confirmation.
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  const room = page.locator('[data-building-room-id="room"]')
  if (!await room.evaluate(element => (element as HTMLDetailsElement).open)) await room.locator('summary').click()
  await room.locator('[data-building-wall-id="wall-0"]').click()
  const thickness = page.getByRole('spinbutton', { name: '编辑墙厚', exact: true })
  await thickness.fill('30'); await thickness.press('Tab')
  await page.getByRole('button', { name: '预览墙厚修改', exact: true }).click()
  await expect(review).toBeVisible()
  const structuralRelations = page.getByLabel('位置关联检查', { exact: true })
  await structuralRelations.locator('summary').click()
  await expect(structuralRelations).toContainText('需结合全图检查')
  await expect(workbench).toHaveAttribute('data-revision', '3')
  await page.screenshot({ path: info.outputPath('aggregate-building-preview.png'), fullPage: true })
  await review.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await expect(workbench).toHaveAttribute('data-revision', '3')
  await page.getByRole('button', { name: '预览墙厚修改', exact: true }).click()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click(); await saved(page)
  await expect(workbench).toHaveAttribute('data-revision', '4')
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  await expect(page.getByRole('spinbutton', { name: '编辑墙厚', exact: true })).toHaveValue('20')
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  await page.reload(); await page.goto('./#home')
  await page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: '聚合边界预览开发自检', exact: true }) })
    .getByRole('button', { name: '打开', exact: true }).click()
  await saved(page)
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  const reopenedRoom = page.locator('[data-building-room-id="room"]')
  if (!await reopenedRoom.evaluate(element => (element as HTMLDetailsElement).open)) await reopenedRoom.locator('summary').click()
  await reopenedRoom.locator('[data-building-wall-id="wall-0"]').click()
  await expect(page.getByRole('spinbutton', { name: '编辑墙厚', exact: true })).toHaveValue('30')
  await page.screenshot({ path: info.outputPath('aggregate-building.png'), fullPage: true })
  expect(errors).toEqual([])
})
