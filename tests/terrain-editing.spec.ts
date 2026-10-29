import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Workspace } from '../src/application/workspace/workspace.js'
import type { PointMm } from '../src/shared/model/scene.js'
import { visualBase } from '../src/shared/visual/base.js'

type Dev = { workspace: Workspace }
async function rendered(page: Page) {
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 })
  await expect(page.locator('canvas[aria-label="材质场景主持人预览"]')).toBeVisible({ timeout: 90_000 })
}
async function generateIsland(page: Page) {
  await page.goto('/#workspace')
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90_000 })
  await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  await rendered(page)
  await expect(page.getByRole('heading', { name: '局部地形编辑', exact: true })).toBeVisible()
}
async function contentState(page: Page) {
  return page.evaluate(async () => {
    const projectPath = '/src/application/workspace/project.ts', validationPath = '/src/shared/project/validate.ts'
    const contractsPath = '/src/shared/terrain-generation/composition-contracts.ts'
    const { toBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { projectContentHash } = await import(validationPath) as typeof import('../src/shared/project/validate')
    const { getLegacyGeneration } = await import(contractsPath) as typeof import('../src/shared/terrain-generation/composition-contracts')
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace, project = workspace.getState().project!
    return { hash: projectContentHash(toBundle(project).project), revision: project.document.revision, sceneId: project.document.sceneId,
      generationVersion: project.document.generation!.version, generation: getLegacyGeneration(project.document), props: project.document.props,
      document: project.document, resources: { assets: project.assets, licenses: project.licenses,
        licenseBindings: project.licenseBindings, authoringSources: project.authoringSources }, canUndo: workspace.getState().canUndo }
  })
}
async function projectTab(page: Page) { await page.getByRole('tab', { name: '工程', exact: true }).click() }
async function chooseEntity(page: Page, id: string, kind: '物件' | '结构' = '物件') {
  await page.getByRole('tab', { name: '对象', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: kind, exact: true }).click()
  if (kind === '物件') await page.getByLabel('搜索场景物件', { exact: true }).fill(id)
  await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
}
async function saved(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90_000 }); await rendered(page)
}
async function contourPoint(page: Page) {
  const state = await contentState(page), base = visualBase(state.document)
  if (!base) throw new Error('Expected a generated visual scene')
  return base.boundaries['terrain-coast-curve'].segments[0].control1
}
async function strokeSetup(page: Page, mode: '添陆' | '挖水' | '铺草' | '清出空地', radius: number, target = 'terrain-low') {
  await projectTab(page)
  await page.getByRole('button', { name: mode, exact: true }).click()
  await page.getByLabel('地形编辑作用地形', { exact: true }).selectOption(target)
  await page.getByLabel('地形编辑笔刷半径 mm', { exact: true }).fill(String(radius))
}
async function cancelDraft(page: Page) {
  const button = page.getByRole('button', { name: /取消(?:本次地形修改|局部地形预览)/ }).first()
  await expect(button).toBeVisible({ timeout: 90_000 })
  await expect(button).toBeEnabled({ timeout: 90_000 })
  await button.click()
}
async function uiPng(page: Page, path: string, audience: '主持人' | '玩家') {
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: audience, exact: true }).click()
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '4K PNG', exact: true }).click()
  await (await event).saveAs(path)
  const bytes = await readFile(path)
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return page.evaluate(async base64 => {
    const binary = atob(base64), data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const digest = await crypto.subtle.digest('SHA-256', pixels)
    return { width: canvas.width, height: canvas.height, rgbaHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') }
  }, bytes.toString('base64'))
}
async function numericStroke(page: Page, point: PointMm) {
  const details = page.locator('.terrain-editing-panel details').filter({ has: page.getByText('键盘落笔', { exact: true }) })
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator('summary').click()
  await page.getByLabel('地形编辑落笔 X mm', { exact: true }).fill(String(point.x))
  await page.getByLabel('地形编辑落笔 Y mm', { exact: true }).fill(String(point.y))
  await page.getByRole('button', { name: '添加落笔并预览', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('.terrain-editing-panel fieldset')).toBeEnabled({ timeout: 90_000 })
}
async function pointerStroke(page: Page, points: PointMm[]) {
  await rendered(page)
  const canvas = page.locator('canvas[aria-label="材质场景主持人预览"]'), box = (await canvas.boundingBox())!
  const bounds = await page.evaluate(() => (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getDocument()!.exportBoundsMm)
  const screen = (point: PointMm) => ({ x: box.x + (point.x - bounds.x) / bounds.width * box.width,
    y: box.y + (point.y - bounds.y) / bounds.height * box.height })
  const first = screen(points[0]); await page.mouse.move(first.x, first.y); await page.mouse.down()
  for (const point of points.slice(1)) { const next = screen(point); await page.mouse.move(next.x, next.y, { steps: 5 }) }
  await page.mouse.up()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('.terrain-editing-panel fieldset')).toBeEnabled({ timeout: 90_000 })
}
async function adopt(page: Page) {
  await page.getByLabel('确认本次地形影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '保护并采用地形修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toHaveCount(0, { timeout: 90_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 }); await rendered(page)
}

test('T2 real pointer and keyboard multi-stroke drafts cancel safely and adopt as one protected undo unit', async ({ page, browser }, info) => {
  test.setTimeout(360_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await generateIsland(page)
  const original = await contentState(page)
  await page.getByRole('button', { name: '清出空地', exact: true }).click()
  await page.getByLabel('地形编辑笔刷半径 mm', { exact: true }).fill('300')
  await pointerStroke(page, [{ x: 2000, y: 2000 }, { x: 2400, y: 2000 }])
  expect((await contentState(page)).hash).toBe(original.hash)
  await page.getByRole('group', { name: '地图视口', exact: true }).focus(); await page.keyboard.press('Escape')
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toHaveCount(0)
  expect((await contentState(page)).hash).toBe(original.hash)

  await page.getByRole('button', { name: '清出空地', exact: true }).click()
  await page.getByLabel('地形编辑笔刷半径 mm', { exact: true }).fill('300')
  await numericStroke(page, { x: 2000, y: 2000 })
  await numericStroke(page, { x: 2400, y: 2000 })
  await expect(page.locator('.terrain-editing-panel')).toContainText('2 / 32 笔')
  expect((await contentState(page)).hash).toBe(original.hash)
  await adopt(page)
  const changed = await contentState(page)
  expect(changed.sceneId).toBe(original.sceneId); expect(changed.revision).toBe(original.revision + 1)
  expect(changed.generationVersion).toBe(2); expect(changed.hash).not.toBe(original.hash)
  if (changed.generation?.version !== 2) throw new Error('Expected strict generation2 after terrain editing')
  expect(Object.keys(changed.generation.strokes)).toHaveLength(2)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  const undone = await contentState(page)
  expect(undone.generationVersion).toBe(original.generationVersion); expect(undone.props).toEqual(original.props)
  expect(undone.revision).toBe(changed.revision + 1)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  const redone = await contentState(page)
  expect(redone.generation).toEqual(changed.generation); expect(redone.revision).toBe(undone.revision + 1)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const download = await downloadEvent, path = info.outputPath('terrain-editing-multi.sceneweave'); await download.saveAs(path)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 }); await rendered(page)
  expect((await contentState(page)).hash).toBe(redone.hash)
  const coldContext = await browser.newContext(), coldPage = await coldContext.newPage()
  try {
    await coldPage.goto('/#workspace')
    await coldPage.getByLabel('选择完整工程', { exact: true }).setInputFiles(path)
    await expect.poll(async () => { try { return (await contentState(coldPage)).generationVersion } catch { return null } }, { timeout: 90_000 }).toBe(2)
    await rendered(coldPage)
    const imported = await contentState(coldPage)
    expect(imported.sceneId).not.toBe(redone.sceneId); expect(imported.revision).toBe(0)
    const { sceneId: _sourceId, revision: _sourceRevision, createdAt: _sourceCreated, updatedAt: _sourceUpdated, ...sourceContent } = redone.document
    const { sceneId: _targetId, revision: _targetRevision, createdAt: _targetCreated, updatedAt: _targetUpdated, ...importedContent } = imported.document
    expect(importedContent).toEqual(sourceContent); expect(imported.resources).toEqual(redone.resources)
  } finally { await coldContext.close() }
  await info.attach('multi-stroke-facts.json', { body: JSON.stringify({ original: { hash: original.hash, revision: original.revision }, changed: { hash: changed.hash, revision: changed.revision }, redone: { hash: redone.hash, revision: redone.revision } }), contentType: 'application/json' })
  expect(errors).toEqual([])
})

test('T2 all four brushes use current geometry, keep unrelated terrain and resources and produce real dual 4K PNGs', async ({ page }, info) => {
  test.setTimeout(420_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await generateIsland(page)
  const original = await contentState(page), facts: unknown[] = []
  for (const mode of ['添陆', '挖水'] as const) {
    const before = await contentState(page), point = await contourPoint(page)
    await strokeSetup(page, mode, 700); await numericStroke(page, point)
    expect((await contentState(page)).hash).toBe(before.hash)
    await adopt(page)
    const after = await contentState(page)
    expect(after.document.terrainAreas['terrain-low'].boundaryMm).not.toEqual(before.document.terrainAreas['terrain-low'].boundaryMm)
    expect(after.document.terrainAreas['terrain-high']).toEqual(before.document.terrainAreas['terrain-high'])
    expect(after.resources).toEqual(original.resources)
    facts.push({ mode, point, beforeRevision: before.revision, afterRevision: after.revision })
  }
  const beforePaint = await contentState(page), activity = Object.values(beforePaint.generation!.constraints).find(row => row.kind === 'activityArea')!
  if (activity.kind !== 'activityArea') throw new Error('Expected fixed activity area')
  const point = { x: Math.round(activity.boundaryMm.reduce((sum, p) => sum + p.x, 0) / activity.boundaryMm.length),
    y: Math.round(activity.boundaryMm.reduce((sum, p) => sum + p.y, 0) / activity.boundaryMm.length) }
  await strokeSetup(page, '铺草', 300, 'terrain-high')
  await page.getByLabel('地形编辑地面材质', { exact: true }).selectOption(beforePaint.document.terrainAreas['terrain-high'].surfaceStyle!.base.materialRef.id)
  await numericStroke(page, point)
  await page.getByLabel('确认本次地形影响范围', { exact: true }).check()
  await page.getByLabel('地形编辑联动内容', { exact: true }).selectOption('transitions')
  await expect(page.getByRole('button', { name: '保护并采用地形修改', exact: true })).toBeDisabled()
  expect((await contentState(page)).hash).toBe(beforePaint.hash)
  await page.getByRole('button', { name: '预览局部地形修改', exact: true }).click()
  await expect(page.getByLabel('确认本次地形影响范围', { exact: true })).toBeEnabled({ timeout: 90_000 })
  await adopt(page)
  const painted = await contentState(page)
  expect(painted.document.terrainAreas['terrain-high'].surfaceStyle!.overlays).toHaveLength(beforePaint.document.terrainAreas['terrain-high'].surfaceStyle!.overlays.length + 1)
  expect(painted.document.terrainAreas['terrain-high'].boundaryMm).toEqual(beforePaint.document.terrainAreas['terrain-high'].boundaryMm)
  expect(painted.props).toEqual(beforePaint.props); expect(painted.resources).toEqual(original.resources)
  await strokeSetup(page, '清出空地', 300); await numericStroke(page, { x: 2000, y: 2000 }); await adopt(page)
  const complete = await contentState(page)
  if (complete.generation?.version !== 2) throw new Error('Expected persisted brushes')
  expect(new Set(Object.values(complete.generation.strokes).map(stroke => stroke.brush))).toEqual(new Set(['addLand', 'digWater', 'paintGrass', 'clearArea']))
  const gm = await uiPng(page, info.outputPath('terrain-t2-gm-4096.png'), '主持人')
  const player = await uiPng(page, info.outputPath('terrain-t2-player-4096.png'), '玩家')
  expect(Math.max(gm.width, gm.height)).toBe(4096); expect(player).toEqual(gm)
  await info.attach('four-brush-and-png.json', { body: JSON.stringify({ facts, gm, player, contentHash: complete.hash }), contentType: 'application/json' })
  expect(errors).toEqual([])
})

test('T2 UI moves and deletes trees then drags the coast while preserving manual and locked content; conflicts never write', async ({ page }, info) => {
  test.setTimeout(420_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await generateIsland(page)
  const original = await contentState(page), trees = Object.values(original.props).filter(prop => prop.definitionRef?.id.includes('tree-'))
  expect(trees.length).toBeGreaterThanOrEqual(3)
  const [moved, deleted, locked] = trees
  await chooseEntity(page, moved.id)
  const x = page.getByRole('spinbutton', { name: '物件 X', exact: true }); await x.fill(String(moved.positionMm.x + 10)); await x.press('Tab'); await saved(page)
  expect((await contentState(page)).props[moved.id].positionMm.x).toBe(moved.positionMm.x + 10)
  await chooseEntity(page, deleted.id); await page.getByRole('button', { name: '删除物件', exact: true }).click(); await saved(page)
  expect((await contentState(page)).props[deleted.id]).toBeUndefined()
  await chooseEntity(page, locked.id); await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '锁定所选', exact: true }).click(); await saved(page)
  const manual = await contentState(page)
  expect(manual.props[locked.id].editLocked).toBe(true)
  const deletedOwner = Object.values(manual.generation!.ownership).find(owner => owner.target.entityId === deleted.id)!
  expect(deletedOwner.state).toBe('deleted')
  expect(Object.values(manual.generation!.exclusions).some(row => row.candidateKey === deletedOwner.outputKey)).toBe(true)
  await strokeSetup(page, '清出空地', 400); await numericStroke(page, manual.props[moved.id].positionMm); await adopt(page)
  expect((await contentState(page)).props[moved.id]).toEqual(manual.props[moved.id])
  await strokeSetup(page, '清出空地', 400); await numericStroke(page, manual.props[locked.id].positionMm); await adopt(page)
  expect((await contentState(page)).props[locked.id]).toEqual(manual.props[locked.id])

  await projectTab(page)
  const beforeContour = await contentState(page)
  await page.getByLabel('地形编辑轮廓', { exact: true }).selectOption('terrain-coast-curve')
  const handle = page.getByTestId('curve-handle-0-control1'); await handle.scrollIntoViewIfNeeded()
  const box = (await handle.boundingBox())!, canvas = (await page.locator('canvas[aria-label="材质场景主持人预览"]').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 50 / beforeContour.document.exportBoundsMm.width * canvas.width, box.y + box.height / 2, { steps: 1 }); await page.mouse.up()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90_000 })
  expect((await contentState(page)).hash).toBe(beforeContour.hash)
  await adopt(page)
  const coastal = await contentState(page)
  expect(coastal.props[moved.id]).toEqual(manual.props[moved.id]); expect(coastal.props[locked.id]).toEqual(manual.props[locked.id])
  expect(coastal.props[deleted.id]).toBeUndefined(); expect(coastal.resources).toEqual(original.resources)
  expect(coastal.document.terrainAreas['terrain-low'].boundaryMm).not.toEqual(beforeContour.document.terrainAreas['terrain-low'].boundaryMm)

  await strokeSetup(page, '清出空地', 300)
  await page.getByLabel('地形编辑范围宽 mm', { exact: true }).fill('100')
  await page.getByLabel('地形编辑范围高 mm', { exact: true }).fill('100')
  const details = page.locator('.terrain-editing-panel details').filter({ has: page.getByText('键盘落笔', { exact: true }) })
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator('summary').click()
  await page.getByLabel('地形编辑落笔 X mm', { exact: true }).fill('2000'); await page.getByLabel('地形编辑落笔 Y mm', { exact: true }).fill('2000')
  await page.getByRole('button', { name: '添加落笔并预览', exact: true }).click()
  await expect(page.locator('.terrain-editing-panel [role="alert"]')).toContainText('范围', { timeout: 90_000 })
  expect((await contentState(page)).hash).toBe(coastal.hash); await cancelDraft(page)
  await chooseEntity(page, 'terrain-low', '结构')
  await page.getByRole('button', { name: '锁定对象编辑', exact: true }).click()
  await page.getByLabel('确认完整影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const lockedTerrain = await contentState(page)
  await strokeSetup(page, '添陆', 700)
  const p = await contourPoint(page), keyboard = page.locator('.terrain-editing-panel details').filter({ has: page.getByText('键盘落笔', { exact: true }) })
  if (!await keyboard.evaluate(element => (element as HTMLDetailsElement).open)) await keyboard.locator('summary').click()
  await page.getByLabel('地形编辑落笔 X mm', { exact: true }).fill(String(p.x)); await page.getByLabel('地形编辑落笔 Y mm', { exact: true }).fill(String(p.y))
  await page.getByRole('button', { name: '添加落笔并预览', exact: true }).click()
  await expect(page.locator('.terrain-editing-panel [role="alert"]')).toContainText('锁', { timeout: 90_000 })
  expect((await contentState(page)).hash).toBe(lockedTerrain.hash); await cancelDraft(page)
  await info.attach('manual-and-rejections.json', { body: JSON.stringify({ moved: moved.id, deleted: deleted.id, locked: locked.id,
    before: original.hash, afterCoast: coastal.hash, afterTerrainLock: lockedTerrain.hash, deletedOwner }), contentType: 'application/json' })
  expect(errors).toEqual([])
})
