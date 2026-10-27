import { expect, test, type Page } from '@playwright/test'
import type { Workspace } from '../src/application/workspace/workspace.js'

type Dev = { workspace: Workspace }

async function installRectangleFixture(page: Page) {
  return page.evaluate(async () => {
    const runtimePath = '/src/platform/browser/runtime.ts', blankPath = '/src/platform/browser/content/refined-blank.ts'
    const terrainPath = '/src/application/workspace/terrain.ts', projectPath = '/src/application/workspace/project.ts'
    const integrityPath = '/src/shared/terrain-generation/integrity.ts', visualPath = '/src/shared/visual/base.ts', graphPath = '/src/shared/appearance/graph.ts'
    const { runtime, validation, projectRepository } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { createRefinedBlankProject } = await import(blankPath) as typeof import('../src/platform/browser/content/refined-blank')
    const { prepareTerrainProject } = await import(terrainPath) as typeof import('../src/application/workspace/terrain')
    const { toBundle, captureEditableDraft, validateEditableProject } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { detachChangedOutputs } = await import(integrityPath) as typeof import('../src/shared/terrain-generation/integrity')
    const { visualBase } = await import(visualPath) as typeof import('../src/shared/visual/base')
    const { createCompositionContent } = await import(graphPath) as typeof import('../src/shared/appearance/graph')
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace
    const sceneId = runtime.ids.nextId(), blank = await createRefinedBlankProject('island', { sceneId, title: '拓扑矩形夹具', widthMm: 24_000, heightMm: 18_000, preset: 'narrative' })
    const generated = await prepareTerrainProject(blank, { sceneId, kind: 'island', seed: 'terrain-v1-0' }, { runtime, validation })
    const source = generated.project, next = captureEditableDraft(source), low = next.document.terrainAreas['terrain-low']
    const rectangle = [{ x: 1_000, y: 1_000 }, { x: 23_000, y: 1_000 }, { x: 23_000, y: 17_000 }, { x: 1_000, y: 17_000 }]
    low.boundaryMm = rectangle.map((positionMm, index) => ({ id: `fixture-low-p-${index}`, segmentId: `fixture-low-s-${index}`, positionMm }))
    const visual = visualBase(next.document)!
    delete visual.boundaries['terrain-coast-curve']
    for (const id of Object.keys(visual.edgeLooks)) if (visual.edgeLooks[id].boundaryId === 'terrain-coast-curve') delete visual.edgeLooks[id]
    if (next.document.visual?.version === 2) for (const id of Object.keys(next.document.visual.materializedEdges)) if (next.document.visual.materializedEdges[id].boundaryId === 'terrain-coast-curve') delete next.document.visual.materializedEdges[id]
    for (const [id, edge] of Object.entries(next.document.terrainEdges)) if (edge.source.areaId === low.id || edge.neighborAreaId === low.id) delete next.document.terrainEdges[id]
    detachChangedOutputs(source.document, next.document)
    const fixture = await validateEditableProject({ ...next, ...createCompositionContent(next.document, runtime) }, validation)
    await projectRepository.save(toBundle(fixture), null)
    await workspace.openPersisted(fixture)
    await workspace.flush()
    const clip = [{ x: 10_500, y: 11_000 }, { x: 12_500, y: 11_000 }, { x: 12_500, y: 12_000 }, { x: 10_500, y: 12_000 }]
    return { sceneId: fixture.document.sceneId, bounds: fixture.document.exportBoundsMm, clip, terrainAreas: fixture.document.terrainAreas, revision: fixture.document.revision }
  })
}

async function readState(page: Page) {
  return page.evaluate(async () => {
    const runtimePath = '/src/platform/browser/runtime.ts', projectPath = '/src/application/workspace/project.ts', validatePath = '/src/shared/project/validate.ts'
    const { projectRepository } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { toBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { projectContentHash } = await import(validatePath) as typeof import('../src/shared/project/validate')
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace, project = workspace.getState().project!
    const cold = await projectRepository.load(project.document.sceneId)
    return { hash: projectContentHash(toBundle(project).project), document: project.document, cold: cold?.project ?? null, snapshots: await projectRepository.listSnapshots(project.document.sceneId) }
  })
}

test('complex topology UI rejects frozen escape, requires explicit rebindings, adopts with cold read and undo', async ({ page }) => {
  test.setTimeout(600_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#workspace'); await page.waitForFunction(() => Boolean(Reflect.get(window, '__sceneweaveOutdoorDev')))
  const fixture = await installRectangleFixture(page), before = await readState(page)
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await page.getByRole('button', { name: '复杂地形拓扑', exact: false }).click()
  await page.getByLabel('复杂拓扑操作', { exact: true }).selectOption('difference')
  await page.getByLabel('拓扑 clip 多边形', { exact: true }).fill(fixture.clip.map(point => `${point.x},${point.y}`).join('\n'))
  const rebindingSelects = page.locator('select[aria-label^="拓扑重绑"]')
  await expect(rebindingSelects.first()).toBeVisible({ timeout: 90_000 })
  const count = await rebindingSelects.count(); expect(count).toBeGreaterThan(0)
  const preview = page.getByRole('button', { name: '预览局部地形修改', exact: true })
  for (let index = 0; index < count; index++) await expect(rebindingSelects.nth(index)).toHaveValue('')
  await expect(preview).toBeDisabled()
  for (let index = 0; index < count; index++) await rebindingSelects.nth(index).selectOption('0')
  await expect(preview).toBeEnabled()
  const width = page.getByLabel('地形编辑范围宽 mm', { exact: true })
  await width.fill('100')
  await page.getByRole('button', { name: '预览局部地形修改', exact: true }).click()
  await expect(page.locator('[role="alert"]')).toContainText(/范围|冻结/, { timeout: 90_000 })
  expect((await readState(page)).hash).toBe(before.hash)
  await page.getByLabel('地形编辑范围 X mm', { exact: true }).fill(String(fixture.bounds.x))
  await page.getByLabel('地形编辑范围 Y mm', { exact: true }).fill(String(fixture.bounds.y))
  await width.fill(String(fixture.bounds.width))
  await page.getByLabel('地形编辑范围高 mm', { exact: true }).fill(String(fixture.bounds.height))
  await page.getByRole('button', { name: '预览局部地形修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toBeVisible({ timeout: 90_000 })
  expect((await readState(page)).hash).toBe(before.hash)
  await page.getByLabel('确认本次地形影响范围', { exact: true }).check()
  await page.getByRole('button', { name: '保护并采用地形修改', exact: true }).click()
  await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toHaveCount(0, { timeout: 90_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  const adopted = await readState(page)
  expect(adopted.document.generation?.version).toBe(4)
  const current = adopted.document.generation?.version === 4 ? Object.values(adopted.document.generation.topology).find(row => row.state === 'current') : undefined
  expect(current).toBeDefined(); expect(current?.request.operation).toBe('difference')
  expect(current?.outputAreaIds.length).toBeGreaterThanOrEqual(2)
  expect(adopted.cold?.document.generation?.version).toBe(4)
  expect(adopted.cold?.document.terrainAreas).toEqual(adopted.document.terrainAreas)
  expect(adopted.snapshots.filter(row => row.kind === 'protection')).toHaveLength(before.snapshots.filter(row => row.kind === 'protection').length + 1)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  const undone = await readState(page)
  expect(undone.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(undone.document.generation?.version).toBe(before.document.generation?.version)
  expect(errors).toEqual([])
})
