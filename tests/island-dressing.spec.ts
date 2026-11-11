import { openGenerationTask, openGenerationSettings, openTerrainTask } from './workspace-navigation-helpers'
import { reloadSaved } from './workspace-ux-helpers'
import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import type { EditableProject } from '../src/application/workspace/project'
import type { Workspace } from '../src/application/workspace/workspace'
import { terrainPoints } from '../src/shared/geometry/geometry'
import { applySurfaceRuleCommand } from '../src/shared/surface-rules/commands'
import { surfaceRegionsFromStroke } from '../src/editor/main/canopy-brush'
import type { AppearanceGraph } from '../src/shared/model/appearance'
import type { PointMm, SurfaceRuleRegion } from '../src/shared/model/scene'
import type { PreparationContext } from '../src/shared/ports/runtime'
import { manualChangedTargets, manualTransactionBudget } from '../src/shared/budget/command-budget'

const root = process.env.SCENEWEAVE_ISLAND_DRESSING_OUTPUT ?? 'work/old-test-cleanup-20261111/generation/island-dressing'
async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/application/workspace/project.ts', h = '/src/shared/project/validate.ts'
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Pick<Workspace, 'getState' | 'authorizeCurrentAtomic' | 'prepareAtomicCandidate'> }).workspace
    const { toBundle } = await import(p), { projectContentHash } = await import(h)
    const state = workspace.getState(), project = state.project
    if (!project) throw new Error(`Expected an active project after save; status=${state.status}; error=${state.error ?? 'none'}`)
    return { document: structuredClone(project.document), appearance: structuredClone(project.appearance), hash: projectContentHash(toBundle(project).project) }
  })
}

function expectDocumentContent(actual: EditableProject['document'], expected: EditableProject['document']) {
  expect({ ...actual, revision: expected.revision, updatedAt: expected.updatedAt }).toEqual(expected)
}

function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function pointToSegmentDistance(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

function canopyTargets(document: EditableProject['document'], limit = 12) {
  const areas = Object.values(document.terrainAreas).filter(area => area.visibility === 'public' && !area.editLocked && !area.blocksMovement && area.groundElevationMm > 0
    && !document.userLayers[document.entityLayers[area.id]]?.editLocked)
  const candidates: { areaId: string; point: PointMm; clearance: number }[] = []
  for (const area of areas) {
    const polygon = area.boundaryMm.map(point => point.positionMm)
    const minX = Math.min(...polygon.map(point => point.x)), maxX = Math.max(...polygon.map(point => point.x))
    const minY = Math.min(...polygon.map(point => point.y)), maxY = Math.max(...polygon.map(point => point.y))
    const higher = areas.filter(other => other.coveragePriority > area.coveragePriority)
      .map(other => other.boundaryMm.map(point => point.positionMm))
    for (let y = minY + 500; y < maxY; y += 1000) for (let x = minX + 500; x < maxX; x += 1000) {
      const point = { x, y }
      if (!pointInPolygon(point, polygon) || higher.some(shape => pointInPolygon(point, shape))) continue
      const clearance = Math.min(...[polygon, ...higher].flatMap(shape => shape.map((a, index) => pointToSegmentDistance(point, a, shape[(index + 1) % shape.length]))))
      candidates.push({ areaId: area.id, point, clearance })
    }
  }
  candidates.sort((a, b) => b.clearance - a.clearance || a.areaId.localeCompare(b.areaId) || a.point.y - b.point.y || a.point.x - b.point.x)
  const selected: typeof candidates = []
  for (const candidate of candidates) {
    if (selected.every(row => row.areaId !== candidate.areaId || Math.hypot(row.point.x - candidate.point.x, row.point.y - candidate.point.y) >= 6000)) selected.push(candidate)
    if (selected.length >= limit) break
  }
  if (!selected.length) throw new Error('Expected an unlocked public terrain surface with a drawable interior point.')
  return selected
}

function preflightCanopy(document: EditableProject['document'], appearance: AppearanceGraph, options: {
  definitionId: string; coveragePpm: number; radiusMm: number; targets: ReturnType<typeof canopyTargets>
}) {
  let serial = 0
  const context: PreparationContext = { ids: { nextId: () => `canopy-preflight-member-${++serial}` }, clock: { now: () => document.updatedAt } }
  let lastError = 'No candidate generated a managed tree member.'
  for (const [targetIndex, target] of options.targets.entries()) {
    const area = document.terrainAreas[target.areaId]
    // First use the requested region, clipped by the same brush as the UI.
    // A fully inset fallback can become too small to contain an upright crown.
    for (const radiusMm of [...new Set([options.radiusMm, ...[.95, .7].map(inset => Math.floor(Math.min(options.radiusMm, target.clearance * inset) / 100) * 100)])]) {
      if (radiusMm < 100) continue
      let regionsMm: SurfaceRuleRegion[]
      try {
        regionsMm = surfaceRegionsFromStroke([target.point], radiusMm, terrainPoints(area))
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        continue
      }
      for (let seedIndex = 0; seedIndex < 16; seedIndex++) {
        const seed = `island-canopy-preflight-${targetIndex}-${seedIndex}`
        try {
          const draft = structuredClone(document), clusterId = `surface-preflight-cluster-${targetIndex}`
          applySurfaceRuleCommand(draft, { type: 'paintSurfaceVegetation', id: `surface-preflight-rule-${targetIndex}`, clusterId,
            floorId: area.floorId, layerId: document.entityLayers[area.id], visibility: 'public', supportRef: { kind: 'terrainArea', id: area.id },
            field: 'trees', regionsMm, seed, coveragePpm: options.coveragePpm,
            palette: [{ key: `tree-${options.definitionId}`, definitionRef: { id: options.definitionId, version: document.propDefinitions[options.definitionId].version }, kind: 'prop', weight: 1 }],
            spacingMm: 900, clusterRadiusMm: 2200, clearanceMm: 300 }, context, appearance)
          const cluster = draft.decorationClusters[clusterId]
          const managedCount = Object.values(cluster.members).filter(member => member.entityId && member.state === 'managed').length
          if (managedCount > 0) return { target, radiusMm, seed, regionsMm, managedCount }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
  throw new Error(`Could not find a canopy brush target that generates a managed member after checking support, visual footprint, obstacles, spacing, clearance and seed. ${lastError}`)
}

test('Worker island keeps its base through current v1 surface-rule dressing, complete IO and an exact current-AI baseline', async ({ page }, info) => {
  test.setTimeout(1200000)
  await mkdir(root, { recursive: true })
  const errors: string[] = [], external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const url = new URL(request.url()), hostname = url.protocol === 'blob:' ? new URL(url.pathname).hostname : url.hostname
    if (hostname && !/^(127\.0\.0\.1|localhost)$/.test(hostname)) external.push(request.url())
  })
  await page.goto('/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('自动布景岩岛开发样图')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await saved(page)
  await openGenerationTask(page, '自然地形')
  await openGenerationSettings(page)
  await page.getByLabel('程序底图预算选择', { exact: true }).selectOption('standard')
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  const generationCandidate = page.getByRole('article', { name: '当前地形候选', exact: true })
  await expect(generationCandidate).toBeVisible({ timeout: 90000 })
  await generationCandidate.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
  await expect(generationCandidate).toBeHidden({ timeout: 90000 }); await saved(page)
  await expect(page.getByText('正在解码素材并绘制场景…', { exact: true })).toBeHidden({ timeout: 90000 })
  const base = await state(page)
  expect(base.document.schemaVersion).toBe(1)
  const panel = page.getByRole('region', { name: '岩岛生成后布景', exact: true })
  // Use the current independent-copy API for fixture isolation; retired format upgrades are not product entry points.
  await page.evaluate(async () => {
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }).workspace
    await workspace.saveAsCopy(); await workspace.flush()
  })
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@1'); await saved(page)
  const before = await state(page)
  expect(before.document.sceneId).not.toBe(base.document.sceneId)
  expect(before.document.terrainAreas).toEqual(base.document.terrainAreas)
  expect(before.document.props).toEqual(base.document.props)
  // Installing the independent copy resets the current detail tool; reopen dressing for that project.
  await openTerrainTask(page, '布置植被')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '预览岩岛布景素材', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  const sourceReview = await page.locator('.asset-structure-preview').innerText()
  expect((await state(page)).hash).toBe(before.hash)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  await panel.getByRole('button', { name: '预览岩岛布景素材', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const sourced = await state(page)
  expect(Object.keys(sourced.document.propDefinitions).length).toBe(Object.keys(before.document.propDefinitions).length + 12)
  await panel.getByRole('button', { name: '预览规则驱动岩岛布景', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  const review = page.locator('.asset-structure-preview')
  await expect(review).toContainText(/固定素材与场景编辑 · \d+\/1024 个编辑对象/)
  await expect(review).toContainText(/区域植被预计\d+件，候选\d+件/)
  await expect(review).toContainText(/terrain-low：\d+\/20件/)
  const dressingReview = await review.innerText()
  const dressingBudget = dressingReview.match(/固定素材与场景编辑 · (\d+)\/(\d+) 个编辑对象/)!
  const dressingCost = Number(dressingBudget[1]), dressingLimit = Number(dressingBudget[2])
  expect(dressingLimit).toBe(manualTransactionBudget('expanded').semanticTargets)
  expect(dressingCost).toBeGreaterThan(0)
  expect(dressingCost).toBeLessThanOrEqual(dressingLimit)
  expect((await state(page)).hash).toBe(sourced.hash)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  expect((await state(page)).hash).toBe(sourced.hash)
  await panel.getByRole('button', { name: '预览规则驱动岩岛布景', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const dressed = await state(page)
  // Adoption stamps updatedAt after preparation; compare the edit itself.
  expect(dressingCost).toBe(manualChangedTargets(sourced.document, { ...dressed.document, updatedAt: sourced.document.updatedAt },
    { before: { appearance: sourced.appearance }, after: { appearance: dressed.appearance } }).length)
  expect(dressed.document.revision).toBe(sourced.document.revision + 1)
  expect(Object.values(dressed.document.surfaceRules).map(rule => rule.field).sort()).toEqual(['grass', 'material', 'shrubs', 'trees'])
  expect(Object.keys(dressed.document.decorationClusters)).toHaveLength(4)
  expect(Object.keys(dressed.document.props).length).toBeGreaterThan(Object.keys(before.document.props).length)
  expect(Object.keys(dressed.document.propDefinitions).length).toBe(Object.keys(before.document.propDefinitions).length + 12)
  expect(dressed.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(dressed.document.paths).toEqual(before.document.paths)
  expect(dressed.document.terrainConnections['terrain-stairs'].route?.stairStyle).toBe('naturalRock')
  expect(dressed.document.terrainConnections['terrain-stairs'].widthMm).toBe(before.document.terrainConnections['terrain-stairs'].widthMm)
  for (const [id, prop] of Object.entries(before.document.props)) expect(dressed.document.props[id]).toEqual(prop)
  await expect(panel).toContainText('区域规则布景已采用')
  expect((await state(page)).hash).toBe(dressed.hash)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const undone = await state(page)
  expect(undone.document.decorationClusters).toEqual(before.document.decorationClusters)
  expect(undone.document.propDefinitions).toEqual(sourced.document.propDefinitions)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.decorationClusters).toEqual(dressed.document.decorationClusters)

  const beforeCliff = await state(page)
  await panel.getByRole('button', { name: '预览高台崖面细节', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  const cliffReview = await review.innerText()
  expect(cliffReview).toMatch(/实际操作范围 · \d+ 项/)
  expect((await state(page)).hash).toBe(beforeCliff.hash)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  expect((await state(page)).hash).toBe(beforeCliff.hash)
  await panel.getByRole('button', { name: '预览高台崖面细节', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const cliff = await state(page)
  expect(cliff.document.revision).toBe(beforeCliff.document.revision + 1)
  expect(cliff.document.props).toEqual(beforeCliff.document.props)
  expect(cliff.document.terrainAreas).toEqual(beforeCliff.document.terrainAreas)
  expect(cliff.document.terrainConnections).toEqual(beforeCliff.document.terrainConnections)
  await expect(panel.getByRole('button', { name: '预览高台崖面细节', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.visual).toEqual(beforeCliff.document.visual)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.visual).toEqual(cliff.document.visual)

  const proof = await page.evaluate(async ({ baseSceneId, baseHash }) => {
    const paths = { project: '/src/application/workspace/project.ts', runtime: '/src/platform/browser/runtime.ts', file: '/src/shared/project/file.ts', hash: '/src/shared/project/validate.ts', renderer: '/src/platform/browser/render/renderer.ts', graph: '/src/shared/appearance/presentation.ts', catalog: '/src/platform/browser/content/terrain-variant-catalog.ts', visual: '/src/shared/visual/base.ts', types: '/src/shared/visual/types.ts', authoring: '/src/shared/ai/authoring.ts', pixels: '/src/shared/validation/hash.ts' }
    const { toBundle, captureEditableDraft, fromBundle } = await import(paths.project), { projectRepository, validation } = await import(paths.runtime), { exportProject, importProject } = await import(paths.file), { projectContentHash } = await import(paths.hash), { renderProject } = await import(paths.renderer), { definitionPresentation, topDownPresentation } = await import(paths.graph), { TERRAIN_VARIANT_SPECS } = await import(paths.catalog), { visualBase } = await import(paths.visual), { emptyVisualSystem } = await import(paths.types), { replayAuthoring, applyAuthoringStep } = await import(paths.authoring), { sha256Bytes } = await import(paths.pixels)
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Pick<Workspace, 'getState' | 'authorizeCurrentAtomic' | 'prepareAtomicCandidate'> }).workspace
    const current = workspace.getState().project as EditableProject, bundle = toBundle(current)
    const source = await projectRepository.load(baseSceneId)
    if (!source || projectContentHash(source.project) !== baseHash) throw new Error('The original generated map was not preserved.')
    const roots = TERRAIN_VARIANT_SPECS.map((spec: { definitionId: string; presentation: unknown }) => ({ id: spec.definitionId, actual: definitionPresentation(current.appearance, { id: spec.definitionId, version: 1 }) ?? topDownPresentation(), expected: spec.presentation }))
    for (const root of roots) if (JSON.stringify(root.actual) !== JSON.stringify(root.expected)) throw new Error(`Fixed root lost: ${root.id}`)
    const bytes = await exportProject(bundle, validation), round = await importProject(bytes, validation), cold = await projectRepository.load(current.document.sceneId)
    if (projectContentHash(round.project) !== projectContentHash(bundle.project) || projectContentHash(cold!.project) !== projectContentHash(bundle.project)) throw new Error('Dressed island cold/package mismatch.')
    const memberIds = new Set(Object.values(current.document.decorationClusters).flatMap(cluster => Object.values(cluster.members).map(member => member.entityId)))
    const target = Object.values(current.document.props).find(row => !row.editLocked && row.visibility === 'public' && !memberIds.has(row.id))
    if (!target) throw new Error('Dressed island needs an unlocked real prop for a finite current-project AI check.')
    const nextPosition = { ...target.positionMm, x: target.positionMm.x + 1 }
    const authorization = await workspace.authorizeCurrentAtomic({ targetIds: [target.id], operations: ['transform'], placement: null })
    const start = authorization.start
    const state = applyAuthoringStep(start, replayAuthoring(start, []).state, [{ kind: 'transform', id: target.id, positionMm: nextPosition }], 'local-integration-only').state
    const aiCandidate = await workspace.prepareAtomicCandidate(authorization, { schemaVersion: 4, taskId: 'island-local-self-check', generation: 1, start, state })
    if (aiCandidate.project.document.props[target.id].positionMm.x !== nextPosition.x) throw new Error('Current-AI finite edit did not target the exact dressed island.')
    const b64 = (value: Uint8Array) => { let result = ''; for (let i = 0; i < value.length; i += 32768) result += String.fromCharCode(...value.subarray(i, i + 32768)); return btoa(result) }
    const outputs = []
    const neutral = captureEditableDraft(current); Object.assign(visualBase(neutral.document)!.environment, emptyVisualSystem().environment)
    for (const [name, project, audience] of [['base', await fromBundle(source, validation), 'gm'], ['gm', current, 'gm'], ['player', current, 'player'], ['neutral', neutral, 'gm']] as const) {
      const canvas = await renderProject(toBundle(project), { audience, longEdgePx: 4096 }), data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      outputs.push({ name, width: canvas.width, height: canvas.height, hash: sha256Bytes(new Uint8Array(data.buffer)), png: canvas.toDataURL('image/png').split(',')[1] })
    }
    return { hash: projectContentHash(bundle.project), baseHash, roots, clusters: current.document.decorationClusters, aiSource: start.source.version === 4 ? start.source.kind : 'generated-baseline', aiPolicy: start.policy, aiCandidateCost: aiCandidate.operationCost, outputs, package: b64(bytes) }
  }, { baseSceneId: base.document.sceneId, baseHash: base.hash })
  expect(proof.aiSource).toBe('current-baseline')
  expect(proof.aiPolicy.aiTargets).toBe(256)
  expect(proof.aiCandidateCost).toBeGreaterThan(0)
  expect(proof.outputs.find(row => row.name === 'gm')!.hash).toBe(proof.outputs.find(row => row.name === 'player')!.hash)
  for (const row of proof.outputs) await writeFile(`${root}/island-${row.name}-4k.png`, Buffer.from(row.png, 'base64'))
  await writeFile(`${root}/island-dressed.sceneweave`, Buffer.from(proof.package, 'base64'))
  await writeFile(`${root}/proof.json`, JSON.stringify({ ...proof, sourceReview, dressingReview, cliffReview, errors, external, package: undefined, outputs: proof.outputs.map(({ png: _png, ...row }) => row) }, null, 2))
  await info.attach('island-ui.png', { body: await page.screenshot(), contentType: 'image/png' })

  await openTerrainTask(page, '布置植被')
  const decorations = page.getByRole('region', { name: '簇状布景', exact: true })
  const treeBaseline = await state(page)
  expect(treeBaseline.hash).toBe(proof.hash)
  const canopyDefinitionId = 'terrain-variants-v1-prop-tree-wind-oak'
  await expect(decorations.locator('details.decoration-canopy-rules')).toHaveAttribute('open', '')
  await decorations.getByRole('group', { name: '地表规则通道', exact: true }).getByRole('button', { name: '树木', exact: true }).click()
  await decorations.getByLabel('区域树木素材', { exact: true }).selectOption(canopyDefinitionId)
  const coverage = decorations.getByLabel('区域植被目标覆盖率', { exact: true })
  await expect(coverage).toHaveValue('180000')
  await expect(coverage).toHaveAttribute('max', '1000000')
  const coverageBox = await coverage.boundingBox()
  if (!coverageBox) throw new Error('Expected the current vegetation coverage slider.')
  await page.mouse.click(coverageBox.x + coverageBox.width * .25, coverageBox.y + coverageBox.height / 2)
  const initialCoverage = Number(await coverage.inputValue())
  expect(initialCoverage).toBeGreaterThan(100_000)
  expect(initialCoverage).toBeLessThan(400_000)
  await expect(decorations.getByText(`${Math.round(initialCoverage / 10_000)}%`, { exact: true })).toBeVisible()
  const target = preflightCanopy(treeBaseline.document, treeBaseline.appearance, { definitionId: canopyDefinitionId, coveragePpm: initialCoverage, radiusMm: 6000, targets: canopyTargets(treeBaseline.document) })
  await decorations.getByLabel('地表规则支撑地形面', { exact: true }).selectOption(target.target.areaId)
  await decorations.getByLabel('地表规则画笔半径', { exact: true }).fill(String(target.radiusMm))
  await decorations.getByLabel('区域植被种子', { exact: true }).fill(target.seed)
  const drawTree = async () => {
    await decorations.getByRole('button', { name: '开始地表涂绘', exact: true }).click()
    const canvas = page.getByLabel('材质场景主持人预览', { exact: true }), box = await canvas.boundingBox()
    if (!box) throw new Error('Expected the real scene canvas for the tree-rule brush.')
    const bounds = treeBaseline.document.exportBoundsMm
    await page.mouse.click(box.x + box.width * (target.target.point.x - bounds.x) / bounds.width,
      box.y + box.height * (target.target.point.y - bounds.y) / bounds.height)
  }
  const confirmation = page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })
  await drawTree()
  await expect(confirmation).toBeVisible({ timeout: 90_000 })
  const canopyReview = await page.locator('.asset-structure-preview').innerText()
  expect(canopyReview).toMatch(/区域植被预计\d+件，候选\d+件/)
  expect((await state(page)).hash).toBe(treeBaseline.hash)
  await writeFile(`${root}/tree-rule-candidate.txt`, canopyReview)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  expect((await state(page)).hash).toBe(treeBaseline.hash)
  await drawTree()
  await expect(confirmation).toBeVisible({ timeout: 90_000 })
  await confirmation.check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const planted = await state(page)
  expect(planted.document.sceneId).toBe(treeBaseline.document.sceneId)
  expect(planted.document.schemaVersion).toBe(1)
  expect(planted.document.revision).toBe(treeBaseline.document.revision + 1)
  const treeRule = Object.values(planted.document.surfaceRules).find(rule => !(rule.id in treeBaseline.document.surfaceRules))
  if (!treeRule || treeRule.field !== 'trees') throw new Error('Expected the adopted current-v1 tree surface rule.')
  expect(treeRule).toMatchObject({ coveragePpm: initialCoverage, regionsMm: target.regionsMm })
  const treeCluster = planted.document.decorationClusters[treeRule.clusterId]
  expect(Object.values(treeCluster.members).filter(member => member.entityId && member.state === 'managed')).toHaveLength(target.managedCount)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const treeUndone = await state(page)
  expectDocumentContent(treeUndone.document, treeBaseline.document)
  expect(treeUndone.document.revision).toBe(planted.document.revision + 1)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  const treeRedone = await state(page)
  expectDocumentContent(treeRedone.document, planted.document)
  expect(treeRedone.document.revision).toBe(treeUndone.document.revision + 1)
  await reloadSaved(page); await saved(page)
  expect((await state(page)).document).toEqual(treeRedone.document)

  await openTerrainTask(page, '布置植被')
  const beforeCoverageEdit = await state(page), priorTreeCluster = beforeCoverageEdit.document.decorationClusters[treeRule.clusterId]
  const ruleEntry = decorations.getByLabel('已有地表规则', { exact: true }).locator('.asset-entry').last()
  await expect(ruleEntry).toContainText('树木')
  await ruleEntry.getByRole('button', { name: '调整覆盖', exact: true }).click()
  await expect(confirmation).toBeVisible({ timeout: 90_000 })
  expect((await state(page)).hash).toBe(beforeCoverageEdit.hash)
  await confirmation.check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const adjusted = await state(page), adjustedRule = adjusted.document.surfaceRules[treeRule.id]
  expect(adjusted.document.revision).toBe(beforeCoverageEdit.document.revision + 1)
  expect(adjustedRule.field).toBe('trees')
  if (adjustedRule.field === 'material') throw new Error('Expected the current vegetation rule.')
  expect(adjustedRule.coveragePpm).toBe(initialCoverage + 100_000)
  const adjustedTreeCluster = adjusted.document.decorationClusters[treeRule.clusterId]
  for (const [slot, member] of Object.entries(priorTreeCluster.members)) if (member.entityId && member.state === 'managed') {
    expect(adjustedTreeCluster.members[slot]).toMatchObject({ entityId: member.entityId, state: 'managed' })
    expect(adjusted.document.props[member.entityId]).toEqual(beforeCoverageEdit.document.props[member.entityId])
  }
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const coverageUndone = await state(page)
  expectDocumentContent(coverageUndone.document, beforeCoverageEdit.document)
  expect(coverageUndone.document.revision).toBe(adjusted.document.revision + 1)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  const coverageRedone = await state(page)
  expectDocumentContent(coverageRedone.document, adjusted.document)
  expect(coverageRedone.document.revision).toBe(coverageUndone.document.revision + 1)
  await reloadSaved(page); await saved(page)
  expect((await state(page)).document).toEqual(coverageRedone.document)

  await openTerrainTask(page, '布置植被')
  const beforeGrass = await state(page), brushTarget = canopyTargets(beforeGrass.document).find(row => row.areaId === treeRule.supportRef.id)
  if (!brushTarget) throw new Error('Expected a current supported interior point for the grass-rule brush.')
  await decorations.getByRole('group', { name: '地表规则通道', exact: true }).getByRole('button', { name: '草簇', exact: true }).click()
  await decorations.getByLabel('地表规则支撑地形面', { exact: true }).selectOption(brushTarget.areaId)
  const brushRadiusMm = Math.max(100, Math.floor(Math.min(2500, brushTarget.clearance * .7) / 100) * 100)
  await decorations.getByLabel('地表规则画笔半径', { exact: true }).fill(String(brushRadiusMm))
  await decorations.getByRole('button', { name: '开始地表涂绘', exact: true }).click()
  const grassCanvas = page.getByLabel('材质场景主持人预览', { exact: true }), grassBox = await grassCanvas.boundingBox()
  if (!grassBox) throw new Error('Expected the real scene canvas for grass-rule drawing.')
  const grassBounds = beforeGrass.document.exportBoundsMm
  await page.mouse.click(grassBox.x + grassBox.width * (brushTarget.point.x - grassBounds.x) / grassBounds.width,
    grassBox.y + grassBox.height * (brushTarget.point.y - grassBounds.y) / grassBounds.height)
  await expect(confirmation).toBeVisible({ timeout: 90_000 })
  const paintedReview = await page.locator('.asset-structure-preview').innerText()
  expect(paintedReview).toMatch(/区域植被预计\d+件，候选\d+件/)
  expect((await state(page)).hash).toBe(beforeGrass.hash)
  await confirmation.check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const painted = await state(page)
  expect(painted.document.revision).toBe(beforeGrass.document.revision + 1)
  expect(Object.keys(painted.document.surfaceRules)).toHaveLength(Object.keys(beforeGrass.document.surfaceRules).length + 1)
  expect(Object.values(painted.document.surfaceRules).filter(rule => rule.field === 'grass')).toHaveLength(Object.values(beforeGrass.document.surfaceRules).filter(rule => rule.field === 'grass').length + 1)
  expect(painted.document.terrainAreas).toEqual(base.document.terrainAreas)
  expect(painted.document.paths).toEqual(base.document.paths)
  for (const [id, prop] of Object.entries(base.document.props)) expect(painted.document.props[id]).toEqual(prop)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  const grassUndone = await state(page)
  expectDocumentContent(grassUndone.document, beforeGrass.document)
  expect(grassUndone.document.revision).toBe(painted.document.revision + 1)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  const grassRedone = await state(page)
  expectDocumentContent(grassRedone.document, painted.document)
  expect(grassRedone.document.revision).toBe(grassUndone.document.revision + 1)
  await reloadSaved(page); await saved(page)
  const surfaceCold = await state(page)
  expect(surfaceCold.document).toEqual(grassRedone.document)
  const surfaceIo = await page.evaluate(async () => {
    const paths = { project: '/src/application/workspace/project.ts', runtime: '/src/platform/browser/runtime.ts', file: '/src/shared/project/file.ts', hash: '/src/shared/project/validate.ts', renderer: '/src/platform/browser/render/renderer.ts', pixels: '/src/shared/validation/hash.ts', visual: '/src/shared/visual/base.ts', types: '/src/shared/visual/types.ts' }
    const { toBundle, captureEditableDraft } = await import(paths.project), { validation } = await import(paths.runtime), { exportProject, importProject } = await import(paths.file), { projectContentHash } = await import(paths.hash), { renderProject } = await import(paths.renderer), { sha256Bytes } = await import(paths.pixels), { visualBase } = await import(paths.visual), { emptyVisualSystem } = await import(paths.types)
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: { getState(): { project: EditableProject | null } } }).workspace
    const current = workspace.getState().project as EditableProject, bundle = toBundle(current)
    const bytes = await exportProject(bundle, validation), round = await importProject(bytes, validation)
    if (round.project.schemaVersion !== 1 || projectContentHash(round.project) !== projectContentHash(bundle.project)) throw new Error('The complete current-v1 surface-rule package lost content.')
    const b64 = (value: Uint8Array) => { let result = ''; for (let i = 0; i < value.length; i += 32768) result += String.fromCharCode(...value.subarray(i, i + 32768)); return btoa(result) }
    const neutral = captureEditableDraft(current)
    Object.assign(visualBase(neutral.document)!.environment, emptyVisualSystem().environment)
    const outputs = []
    let neutralCanvas: HTMLCanvasElement | undefined
    for (const [name, project, audience] of [['gm', current, 'gm'], ['player', current, 'player'], ['neutral', neutral, 'gm']] as const) {
      const canvas = await renderProject(toBundle(project), { audience, longEdgePx: 4096 }), data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      if (name === 'neutral') neutralCanvas = canvas
      outputs.push({ name, audience, width: canvas.width, height: canvas.height, hash: sha256Bytes(new Uint8Array(data.buffer)), png: canvas.toDataURL('image/png').split(',')[1] })
    }
    if (!neutralCanvas) throw new Error('The neutral whole-map render was not produced.')
    const crops = []
    for (const [name, boundsMm] of [
      ['cliff', { x: 14000, y: 1600, width: 4500, height: 4500 }],
      ['stairs', { x: 3500, y: 3000, width: 4000, height: 4000 }],
      ['vegetation', { x: 12000, y: 1800, width: 6500, height: 6500 }],
    ] as const) {
      const world = neutral.document.exportBoundsMm, pxPerMm = neutralCanvas.width / world.width, scale = 1600 / Math.max(boundsMm.width, boundsMm.height)
      const width = Math.round(boundsMm.width * scale), height = Math.round(boundsMm.height * scale), crop = document.createElement('canvas')
      crop.width = width; crop.height = height
      crop.getContext('2d')!.drawImage(neutralCanvas,
        (boundsMm.x - world.x) * pxPerMm, (boundsMm.y - world.y) * pxPerMm, boundsMm.width * pxPerMm, boundsMm.height * pxPerMm,
        0, 0, width, height)
      crops.push({ name, png: crop.toDataURL('image/png').split(',')[1] })
    }
    return { hash: projectContentHash(round.project), package: b64(bytes), outputs, crops }
  })
  expect(surfaceIo.hash).toBe(surfaceCold.hash)
  expect(surfaceIo.outputs[0].hash).toBe(surfaceIo.outputs[1].hash)
  for (const row of surfaceIo.outputs) await writeFile(`${root}/surface-${row.name}-4k.png`, Buffer.from(row.png, 'base64'))
  for (const row of surfaceIo.crops) await writeFile(`${root}/surface-${row.name}-close.png`, Buffer.from(row.png, 'base64'))
  await writeFile(`${root}/island-surface-rules.sceneweave`, Buffer.from(surfaceIo.package, 'base64'))
  await writeFile(`${root}/surface-rule-proof.json`, JSON.stringify({ sceneId: surfaceCold.document.sceneId,
    tree: { ruleId: treeRule.id, region: target.regionsMm, initialCoverage, adjustedCoverage: adjustedRule.coveragePpm,
      managedMembers: target.managedCount, candidate: canopyReview }, grass: { candidate: paintedReview, revision: painted.document.revision },
    coldHash: surfaceCold.hash, packageHash: surfaceIo.hash,
    outputs: surfaceIo.outputs.map(({ png: _png, ...row }) => row), crops: surfaceIo.crops.map(({ png, name }) => ({ name, bytes: Buffer.from(png, 'base64').byteLength })), errors, external }, null, 2))
  expect(errors).toEqual([]); expect(external).toEqual([])
})
