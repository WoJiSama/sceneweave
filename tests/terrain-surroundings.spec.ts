import { expect, test, type Page } from '@playwright/test'
import type { Workspace } from '../src/application/workspace/workspace.js'

type Dev = { workspace: Workspace }

async function readState(page: Page) {
  return page.evaluate(async () => {
    const runtimePath = '/src/platform/browser/runtime.ts', validatePath = '/src/shared/project/validate.ts', projectPath = '/src/application/workspace/project.ts'
    const runtime = await import(runtimePath) as any
    const validate = await import(validatePath) as any
    const projectModule = await import(projectPath) as any
    const project = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project
    if (!project) throw new Error('缺少当前地形工程。')
    return { hash: validate.projectContentHash(projectModule.toBundle(project).project), document: project.document, cold: await runtime.projectRepository.load(project.document.sceneId) }
  })
}

test('T-S06 UI previews, cancels, adopts and cold-validates surroundings regeneration', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#workspace')
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90_000 })
  await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  await page.evaluate(async () => {
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace
    const scene = workspace.getDocument()!, low = scene.terrainAreas['terrain-low']
    const points = low.boundaryMm.map(row => row.positionMm), cx = Math.round(points.reduce((sum, p) => sum + p.x, 0) / points.length), cy = Math.round(points.reduce((sum, p) => sum + p.y, 0) / points.length)
    await workspace.execute([
      { type: 'createRoom', id: 'existing-west', floorId: low.floorId, boundaryMm: [{ x: cx - 700, y: cy - 700 }, { x: cx, y: cy - 700 }, { x: cx, y: cy + 700 }], thicknessMm: 240, purpose: '既有值守房', supportRef: { kind: 'terrainArea', id: low.id } },
      { type: 'createRoom', id: 'existing-east', floorId: low.floorId, boundaryMm: [{ x: cx, y: cy - 700 }, { x: cx + 700, y: cy - 700 }, { x: cx, y: cy + 700 }], thicknessMm: 240, purpose: '既有储藏房', supportRef: { kind: 'terrainArea', id: low.id } },
    ])
    const built = workspace.getDocument()!, shared = Object.values(built.walls).find(wall => built.vertices[wall.startVertexId].xMm === cx && built.vertices[wall.endVertexId].xMm === cx)!
    await workspace.execute([
      { type: 'addOpening', id: 'existing-door', wallId: shared.id, offsetReferenceVertexId: shared.startVertexId, offsetMm: 100, widthMm: 1000, kind: 'door', state: 'open', locked: false },
      { type: 'createPath', id: 'existing-yard', floorId: low.floorId, layerId: scene.entityLayers[low.id], centerlineMm: [{ x: cx - 500, y: cy }, { x: cx + 500, y: cy }], widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: low.id }] },
    ])
    await workspace.flush()
  })
  const before = await readState(page)
  expect(Object.keys(before.document.rooms)).toHaveLength(2)
  expect(before.document.openings['existing-door'].state).toBe('open')
  await page.getByRole('button', { name: '既有建筑周边重生成', exact: true }).click()
  await expect(page.getByLabel('周边生成种子', { exact: true })).toHaveValue('courtyard-surroundings-1')
  const boundaryTwo = page.getByRole('checkbox', { name: '周边轮廓 2', exact: true })
  if (await boundaryTwo.count()) {
    await page.getByRole('checkbox', { name: '周边轮廓 1', exact: true }).uncheck()
    await boundaryTwo.check()
  }
  await expect(page.getByRole('checkbox', { name: '重做周边自动布景', exact: true })).toBeChecked()
  await page.getByRole('button', { name: '预览局部地形修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90_000 })
  expect((await readState(page)).hash).toBe(before.hash)
  await page.getByRole('button', { name: '取消本次地形修改', exact: true }).click()
  expect((await readState(page)).hash).toBe(before.hash)
  await page.getByRole('button', { name: '既有建筑周边重生成', exact: true }).click()
  if (await boundaryTwo.count()) {
    await page.getByRole('checkbox', { name: '周边轮廓 1', exact: true }).uncheck()
    await boundaryTwo.check()
  }
  await page.getByRole('button', { name: '预览局部地形修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90_000 })
  await page.getByLabel('确认本次地形影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '保护并采用地形修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeHidden({ timeout: 90_000 })
  await expect.poll(async () => (await readState(page)).document.revision, { timeout: 90_000 }).toBe(before.document.revision + 1)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  const after = await readState(page)
  expect(after.document.generation?.version).toBe(3)
  const generation = after.document.generation as any
  const current = Object.values(generation?.surroundings ?? {}).find((row: any) => row.state === 'current') as any
  expect(current).toBeDefined()
  expect(current?.algorithmId).toBe('terrain-surroundings')
  expect(after.cold?.project.document.generation?.version).toBe(3)
  expect(Object.values((after.cold?.project.document.generation as any)?.surroundings ?? {}).some((row: any) => row.state === 'current')).toBe(true)
  for (const collection of ['vertices', 'rooms', 'walls', 'openings', 'paths'] as const) {
    expect(after.document[collection]).toEqual(before.document[collection])
    expect(after.cold?.project.document[collection]).toEqual(before.document[collection])
  }
  expect(current.preserved.some((row: any) => row.collection === 'rooms' && row.entityId === 'existing-west')).toBe(true)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click()
  await expect.poll(async () => (await readState(page)).document.revision).toBe(after.document.revision + 1)
  const undone = await readState(page)
  expect(undone.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(undone.document.rooms).toEqual(before.document.rooms)
  expect(errors).toEqual([])
})
