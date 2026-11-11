import { openGenerationTask, openTerrainTask } from './workspace-navigation-helpers'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts'
import { visualBase } from '../src/shared/visual/base'
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
  await openGenerationTask(page, '自然地形')
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90_000 })
  await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  await page.evaluate(async () => {
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace
    const scene = workspace.getDocument()!, low = scene.terrainAreas['terrain-low']
    const geometryPath = '/src/shared/geometry/geometry.ts'
    const { supportedPolygon, propFootprint, polygonsOverlap } = await import(geometryPath) as typeof import('../src/shared/geometry/geometry')
    // An irregular polygon's centroid need not lie on the active low surface.
    // Check the entire rooms and thick-wall envelope against actual coverage.
    let center: { x: number; y: number } | undefined
    const bounds = scene.exportBoundsMm
    for (let y = bounds.y + 1500; !center && y < bounds.y + bounds.height - 1500; y += 500) {
      for (let x = bounds.x + 1500; !center && x < bounds.x + bounds.width - 1500; x += 500) {
        const envelope = [{ x: x - 1400, y: y - 1400 }, { x: x + 1400, y: y - 1400 }, { x: x + 1400, y: y + 1400 }, { x: x - 1400, y: y + 1400 }]
        if (supportedPolygon(scene, envelope, { kind: 'terrainArea', id: low.id }, low.floorId)
          && !Object.values(scene.props).some(prop => polygonsOverlap(envelope, propFootprint(prop)))) center = { x, y }
      }
    }
    if (!center) throw new Error('The generated map has no clear low-surface room fixture envelope.')
    const { x: cx, y: cy } = center
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
  await openTerrainTask(page, '修改地形')
  const before = await readState(page)
  expect(Object.keys(before.document.rooms)).toHaveLength(2)
  expect(before.document.openings['existing-door'].state).toBe('open')
  const boundaries = Object.values(visualBase(before.document)!.boundaries).filter(boundary =>
    boundary.floorId === before.document.terrainAreas['terrain-high'].floorId && boundary.binding.kind === 'terrain')
  const highIndex = boundaries.findIndex(boundary => boundary.id === 'terrain-high-curve')
  expect(highIndex).toBeGreaterThanOrEqual(0)
  const selectHighBoundary = async () => {
    // New reef curves precede the original coast/high curves. Select the
    // intended plateau by its real identity, rather than the former ordinal 2.
    const choices = page.getByRole('checkbox', { name: /^周边轮廓 \d+$/ })
    await expect(choices).toHaveCount(boundaries.length)
    for (let index = 0; index < boundaries.length; index++) await choices.nth(index).uncheck()
    await page.getByRole('checkbox', { name: `周边轮廓 ${highIndex + 1}`, exact: true }).check()
  }
  await page.getByRole('button', { name: '既有建筑周边重生成', exact: true }).click()
  await expect(page.getByLabel('周边生成种子', { exact: true })).toHaveValue('courtyard-surroundings-1')
  await selectHighBoundary()
  await expect(page.getByRole('checkbox', { name: '重做周边自动布景', exact: true })).toBeChecked()
  await page.getByRole('button', { name: '预览局部地形修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90_000 })
  expect((await readState(page)).hash).toBe(before.hash)
  await page.getByRole('button', { name: '取消本次地形修改', exact: true }).click()
  expect((await readState(page)).hash).toBe(before.hash)
  await page.getByRole('button', { name: '既有建筑周边重生成', exact: true }).click()
  await selectHighBoundary()
  await page.getByRole('button', { name: '预览局部地形修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90_000 })
  await page.getByLabel('确认本次地形影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '保护并采用地形修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeHidden({ timeout: 90_000 })
  await expect.poll(async () => (await readState(page)).document.revision, { timeout: 90_000 }).toBe(before.document.revision + 1)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  const after = await readState(page)
  const generation = getLegacyGeneration(after.document)
  expect(generation?.version).toBe(3)
  if (generation?.version !== 3) throw new Error('Expected the legacy surroundings record inside the current generation wrapper.')
  const current = Object.values(generation?.surroundings ?? {}).find((row: any) => row.state === 'current') as any
  expect(current).toBeDefined()
  expect(current?.algorithmId).toBe('terrain-surroundings')
  expect(current.boundaryIds).toEqual(['terrain-high-curve'])
  expect(getLegacyGeneration(after.cold!.project.document)?.version).toBe(3)
  expect(Object.values((getLegacyGeneration(after.cold!.project.document) as any)?.surroundings ?? {}).some((row: any) => row.state === 'current')).toBe(true)
  for (const collection of ['vertices', 'rooms', 'walls', 'openings', 'paths'] as const) {
    expect(after.document[collection]).toEqual(before.document[collection])
    expect(after.cold?.project.document[collection]).toEqual(before.document[collection])
  }
  expect(current.preserved.some((row: any) => row.collection === 'rooms' && row.entityId === 'existing-west')).toBe(true)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await expect.poll(async () => (await readState(page)).document.revision).toBe(after.document.revision + 1)
  const undone = await readState(page)
  expect(undone.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(undone.document.rooms).toEqual(before.document.rooms)
  expect(errors).toEqual([])
})
