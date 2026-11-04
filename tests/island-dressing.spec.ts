import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import type { EditableProject } from '../src/application/workspace/project'
import type { Workspace } from '../src/application/workspace/workspace'
import { terrainPoints } from '../src/shared/geometry/geometry'
import { buildDecorationRegeneration } from '../src/shared/decorations/generate'
import { canopyRegionsFromStroke } from '../src/editor/main/canopy-brush'
import type { AppearanceGraph } from '../src/shared/model/appearance'
import type { DecorationCluster, PointMm } from '../src/shared/model/scene'
import type { PreparationContext } from '../src/shared/ports/runtime'

const root = process.env.SCENEWEAVE_ISLAND_DRESSING_OUTPUT ?? 'work/island-dressing-canopy-20261102'
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
      let regionsMm: PointMm[][]
      try {
        regionsMm = canopyRegionsFromStroke([target.point], radiusMm, terrainPoints(area))
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        continue
      }
      const points = regionsMm.flat(), xs = points.map(point => point.x), ys = points.map(point => point.y)
      const boundsMm = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
      for (let seedIndex = 0; seedIndex < 16; seedIndex++) {
        const seed = `island-canopy-preflight-${targetIndex}-${seedIndex}`
        const cluster: DecorationCluster = { id: `canopy-preflight-rule-${targetIndex}`, floorId: area.floorId, editLocked: false, visibility: 'public',
          supportRef: { kind: 'terrainArea', id: area.id }, boundsMm, seed, algorithmVersion: 'cluster-v1',
          palette: [{ key: 'tree', definitionRef: { id: options.definitionId, version: document.propDefinitions[options.definitionId].version }, kind: 'prop', weight: 1 }],
          maxInstances: 64, spacingMm: 650, clusterRadiusMm: 2400, clearanceMm: 600, members: {},
          canopyRule: { regionsMm, channel: 'trees', paintOrder: 1, mode: 'plant', canopyCoveragePpm: options.coveragePpm } }
        try {
          const generated = buildDecorationRegeneration(document, cluster, context, appearance)
          const managedCount = Object.values(generated.cluster.members).filter(member => member.entityId && member.state === 'managed').length
          if (managedCount > 0) return { target, radiusMm, seed, regionsMm, managedCount }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
  throw new Error(`Could not find a canopy brush target that generates a managed member after checking support, visual footprint, obstacles, spacing, clearance and seed. ${lastError}`)
}

test('Worker island keeps its base through v8 surface-rule dressing, complete IO and an exact current-AI baseline', async ({ page }, info) => {
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
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await page.getByLabel('程序底图预算选择', { exact: true }).selectOption('standard')
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  const generationCandidate = page.getByRole('article', { name: '当前地形候选', exact: true })
  await expect(generationCandidate).toBeVisible({ timeout: 90000 })
  await generationCandidate.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
  await expect(generationCandidate).toBeHidden({ timeout: 90000 }); await saved(page)
  await expect(page.getByText('正在解码素材并绘制场景…', { exact: true })).toBeHidden({ timeout: 90000 })
  const base = await state(page)
  expect(base.document.schemaVersion).toBe(3)
  const panel = page.getByRole('region', { name: '岩岛生成后布景', exact: true })
  await panel.getByRole('button', { name: '准备布景工作副本', exact: true }).click()
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@6', { timeout: 360000 }); await saved(page)
  const before = await state(page)
  expect(before.document.sceneId).not.toBe(base.document.sceneId)
  expect(before.document.terrainAreas).toEqual(base.document.terrainAreas)
  expect(before.document.props).toEqual(base.document.props)
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
  await panel.getByRole('button', { name: '预览岩岛自动布景', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  const review = page.locator('.asset-structure-preview')
  await expect(review).toContainText(/展开 \d+\/256/)
  await expect(review).toContainText(/高台固定植被：\d+件/)
  await expect(review).toContainText(/terrain-low：\d+\/20件/)
  const dressingReview = await review.innerText()
  expect((await state(page)).hash).toBe(sourced.hash)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  expect((await state(page)).hash).toBe(sourced.hash)
  await panel.getByRole('button', { name: '预览岩岛自动布景', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const dressed = await state(page)
  expect(dressed.document.revision).toBe(sourced.document.revision + 1)
  expect(Object.keys(dressed.document.decorationClusters!)).toHaveLength(1)
  expect(Object.keys(dressed.document.props).length - Object.keys(before.document.props).length).toBeGreaterThanOrEqual(6)
  expect(Object.keys(dressed.document.propDefinitions).length).toBe(Object.keys(before.document.propDefinitions).length + 12)
  expect(dressed.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(dressed.document.paths).toEqual(before.document.paths)
  expect(dressed.document.terrainConnections['terrain-stairs'].route?.stairStyle).toBe('naturalRock')
  expect(dressed.document.terrainConnections['terrain-stairs'].widthMm).toBe(before.document.terrainConnections['terrain-stairs'].widthMm)
  for (const [id, prop] of Object.entries(before.document.props)) expect(dressed.document.props[id]).toEqual(prop)
  await expect(panel).toContainText('成图细化已采用')
  expect((await state(page)).hash).toBe(dressed.hash)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await saved(page)
  const undone = await state(page)
  expect(undone.document.decorationClusters).toEqual(before.document.decorationClusters)
  expect(undone.document.propDefinitions).toEqual(sourced.document.propDefinitions)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await saved(page)
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
  await expect(panel).toContainText('高台崖面细节已采用')
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.visual).toEqual(beforeCliff.document.visual)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await saved(page)
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
    const target = Object.values(current.document.props).find(row => !row.editLocked)
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

  await page.getByRole('tab', { name: '室外', exact: true }).click()
  const decorations = page.getByRole('region', { name: '簇状布景', exact: true })
  const v6 = await state(page)
  expect(v6.hash).toBe(proof.hash)
  await decorations.getByRole('button', { name: '保存树冠规则副本 · v7', exact: true }).click()
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@7', { timeout: 300_000 })
  await saved(page)
  const v7 = await state(page)
  expect(v7.document.schemaVersion).toBe(7)
  expect(v7.document.sceneId).not.toBe(v6.document.sceneId)
  expect(v7.document.terrainAreas).toEqual(v6.document.terrainAreas)
  expect(v7.document.props).toEqual(v6.document.props)
  const sourceHash = await page.evaluate(async ({ sceneId }) => {
    const paths = { runtime: '/src/platform/browser/runtime.ts', project: '/src/shared/project/validate.ts' }
    const { projectRepository } = await import(paths.runtime), { projectContentHash } = await import(paths.project)
    const source = await projectRepository.load(sceneId)
    return source ? projectContentHash(source.project) : null
  }, { sceneId: v6.document.sceneId })
  expect(sourceHash).toBe(v6.hash)

  await decorations.locator('details.decoration-canopy-rules summary').click()
  const canopyDefinitionId = 'terrain-variants-v1-prop-tree-wind-oak'
  const radiusMm = 6000
  await decorations.getByLabel('树冠区域树木素材', { exact: true }).selectOption(canopyDefinitionId)
  await decorations.getByLabel('树冠区域画笔半径', { exact: true }).fill(String(radiusMm))
  const coverage = decorations.getByLabel('树冠覆盖目标百分比', { exact: true })
  await expect(coverage).toHaveValue('180000')
  await expect(coverage).toHaveAttribute('max', '600000')
  const coverageBox = await coverage.boundingBox()
  if (!coverageBox) throw new Error('Expected the canopy coverage slider.')
  await page.mouse.click(coverageBox.x + coverageBox.width * .42, coverageBox.y + coverageBox.height / 2)
  const initialCoverage = Number(await coverage.inputValue())
  expect(initialCoverage).toBeGreaterThan(100_000)
  expect(initialCoverage).toBeLessThan(400_000)
  await expect(decorations.getByText(`${Math.round(initialCoverage / 10_000)}%`, { exact: true })).toBeVisible()
  const target = preflightCanopy(v7.document, v7.appearance, { definitionId: canopyDefinitionId, coveragePpm: initialCoverage, radiusMm, targets: canopyTargets(v7.document) })
  await decorations.getByLabel('树冠区域支撑地形面', { exact: true }).selectOption(target.target.areaId)
  await decorations.getByLabel('树冠区域画笔半径', { exact: true }).fill(String(target.radiusMm))
  await decorations.getByLabel('树冠规则种子', { exact: true }).fill(target.seed)
  await decorations.getByRole('button', { name: '绘制树冠覆盖区域', exact: true }).click()
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true }), box = await canvas.boundingBox()
  if (!box) throw new Error('Expected the real scene canvas for canopy drawing.')
  const bounds = v7.document.exportBoundsMm
  await page.mouse.click(box.x + box.width * (target.target.point.x - bounds.x) / bounds.width, box.y + box.height * (target.target.point.y - bounds.y) / bounds.height)
  const confirmation = page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })
  await expect(confirmation).toBeVisible({ timeout: 90_000 })
  const canopyReview = await page.locator('.asset-structure-preview').innerText()
  expect(canopyReview).toMatch(/树冠估算 \d+ 棵，候选 \d+ 棵/)
  expect((await state(page)).hash).toBe(v7.hash)
  await writeFile(`${root}/canopy-candidate.txt`, canopyReview)
  await info.attach('canopy-candidate.png', { body: await page.screenshot(), contentType: 'image/png' })
  await confirmation.check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const planted = await state(page)
  expect(planted.document.revision).toBe(v7.document.revision + 1)
  const canopy = Object.values(planted.document.decorationClusters!).find(cluster => cluster.canopyRule)
  expect(canopy?.canopyRule).toMatchObject({ mode: 'plant', canopyCoveragePpm: initialCoverage, regionsMm: target.regionsMm })
  if (!canopy) throw new Error('Expected the adopted tree canopy rule.')
  expect(Object.values(canopy.members).some(member => member.entityId && member.state === 'managed')).toBe(true)
  expect(Object.values(canopy.members).filter(member => member.entityId && member.state === 'managed')).toHaveLength(target.managedCount)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await saved(page)
  const canopyUndone = await state(page)
  expect(canopyUndone.document.decorationClusters).toEqual(v7.document.decorationClusters)
  expect(canopyUndone.document.props).toEqual(v7.document.props)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.decorationClusters).toEqual(planted.document.decorationClusters)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await saved(page)
  expect((await state(page)).document.decorationClusters).toEqual(planted.document.decorationClusters)

  await decorations.locator(`button[title="${canopy.id}"]`).click()
  const inspector = page.getByRole('region', { name: '轻量装饰属性', exact: true })
  const ruleCoverage = inspector.getByLabel('树冠规则覆盖目标百分比', { exact: true })
  await expect(ruleCoverage).toHaveValue(String(initialCoverage))
  await expect(ruleCoverage).toHaveAttribute('max', '600000')
  await ruleCoverage.focus()
  await ruleCoverage.press('ArrowRight')
  const adjustedCoverage = Number(await ruleCoverage.inputValue())
  expect(adjustedCoverage).not.toBe(initialCoverage)
  await expect(inspector.getByText(`${Math.round(adjustedCoverage / 10_000)}%`, { exact: true })).toBeVisible()
  const beforeCoverageEdit = await state(page), priorCanopy = beforeCoverageEdit.document.decorationClusters![canopy.id]
  await inspector.getByRole('button', { name: '预览树冠覆盖调整', exact: true }).click()
  await expect(confirmation).toBeVisible({ timeout: 90_000 })
  expect((await state(page)).hash).toBe(beforeCoverageEdit.hash)
  await confirmation.check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const adjusted = await state(page), adjustedCanopy = adjusted.document.decorationClusters![canopy.id]
  expect(adjustedCanopy.canopyRule?.canopyCoveragePpm).toBe(adjustedCoverage)
  expect(adjusted.document.revision).toBe(beforeCoverageEdit.document.revision + 1)
  for (const [slot, member] of Object.entries(priorCanopy.members)) if (member.entityId && member.state === 'managed') {
    expect(adjustedCanopy.members[slot]).toMatchObject({ entityId: member.entityId, state: 'managed' })
    expect(adjusted.document.props[member.entityId]).toEqual(beforeCoverageEdit.document.props[member.entityId])
  }
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.decorationClusters).toEqual(beforeCoverageEdit.document.decorationClusters)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.decorationClusters).toEqual(adjusted.document.decorationClusters)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await saved(page)
  const cold = await state(page)
  expect(cold.document.decorationClusters).toEqual(adjusted.document.decorationClusters)
  const canopyIo = await page.evaluate(async () => {
    const paths = { project: '/src/application/workspace/project.ts', runtime: '/src/platform/browser/runtime.ts', file: '/src/shared/project/file.ts', hash: '/src/shared/project/validate.ts', renderer: '/src/platform/browser/render/renderer.ts', pixels: '/src/shared/validation/hash.ts', visual: '/src/shared/visual/base.ts', types: '/src/shared/visual/types.ts' }
    const { toBundle, captureEditableDraft } = await import(paths.project), { validation } = await import(paths.runtime), { exportProject, importProject } = await import(paths.file), { projectContentHash } = await import(paths.hash), { renderProject, exportPublicViewportPng } = await import(paths.renderer), { sha256Bytes } = await import(paths.pixels), { visualBase } = await import(paths.visual), { emptyVisualSystem } = await import(paths.types)
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: { getState(): { project: EditableProject | null } } }).workspace
    const current = workspace.getState().project as EditableProject, bundle = toBundle(current)
    const bytes = await exportProject(bundle, validation), round = await importProject(bytes, validation)
    if (round.project.schemaVersion !== 7 || projectContentHash(round.project) !== projectContentHash(bundle.project)) throw new Error('The complete v7 canopy package lost content.')
    const b64 = (value: Uint8Array) => { let result = ''; for (let i = 0; i < value.length; i += 32768) result += String.fromCharCode(...value.subarray(i, i + 32768)); return btoa(result) }
    const neutral = captureEditableDraft(current)
    Object.assign(visualBase(neutral.document)!.environment, emptyVisualSystem().environment)
    const outputs = []
    for (const [name, project, audience] of [['gm', current, 'gm'], ['player', current, 'player'], ['neutral', neutral, 'gm']] as const) {
      const canvas = await renderProject(toBundle(project), { audience, longEdgePx: 4096 }), data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      outputs.push({ name, audience, width: canvas.width, height: canvas.height, hash: sha256Bytes(new Uint8Array(data.buffer)), png: canvas.toDataURL('image/png').split(',')[1] })
    }
    const crops = []
    for (const [name, boundsMm] of [
      ['cliff', { x: 14000, y: 1600, width: 4500, height: 4500 }],
      ['stairs', { x: 3500, y: 3000, width: 4000, height: 4000 }],
      ['vegetation', { x: 12000, y: 1800, width: 6500, height: 6500 }],
    ] as const) {
      const blob = await exportPublicViewportPng(toBundle(neutral), boundsMm, 1600)
      const png = new Uint8Array(await blob.arrayBuffer())
      crops.push({ name, png: b64(png) })
    }
    return { hash: projectContentHash(round.project), package: b64(bytes), outputs, crops }
  })
  expect(canopyIo.hash).toBe(cold.hash)
  expect(canopyIo.outputs[0].hash).toBe(canopyIo.outputs[1].hash)
  await writeFile(`${root}/island-canopy.sceneweave`, Buffer.from(canopyIo.package, 'base64'))
  for (const row of canopyIo.outputs) await writeFile(`${root}/canopy-${row.audience}-4k.png`, Buffer.from(row.png, 'base64'))
  await writeFile(`${root}/canopy-ui.png`, await page.screenshot())
  await writeFile(`${root}/canopy-proof.json`, JSON.stringify({ sourceV6: { sceneId: v6.document.sceneId, hash: v6.hash, coldSourceHash: sourceHash }, targetV7: { sceneId: v7.document.sceneId, hash: v7.hash }, target, canopyReview,
    planted: { revision: planted.document.revision, clusterId: canopy.id, rule: canopy.canopyRule, memberCount: Object.keys(canopy.members).length },
    adjusted: { revision: adjusted.document.revision, coveragePpm: adjustedCanopy.canopyRule?.canopyCoveragePpm,
      stableManagedMembers: Object.entries(priorCanopy.members).filter(([, member]) => member.entityId && member.state === 'managed').length }, coldHash: cold.hash, packageHash: canopyIo.hash, outputs: canopyIo.outputs.map(({ png: _png, ...row }) => row), errors, external }, null, 2))

  const beforeV8 = await state(page)
  await decorations.getByRole('button', { name: '保存连续地表规则副本 · v8', exact: true }).click()
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@8', { timeout: 300_000 })
  await saved(page)
  const v8 = await state(page)
  expect(v8.document.schemaVersion).toBe(8)
  expect(v8.document.sceneId).not.toBe(v7.document.sceneId)
  expect(v8.document.terrainAreas).toEqual(v7.document.terrainAreas)
  for (const [id, prop] of Object.entries(beforeV8.document.props)) expect(v8.document.props[id]).toEqual(prop)
  expect(Object.keys(v8.document.props).filter(id => !(id in beforeV8.document.props))).toEqual([])
  const v7SourceHash = await page.evaluate(async (sceneId: string) => {
    const paths = { runtime: '/src/platform/browser/runtime.ts', project: '/src/shared/project/validate.ts' }
    const { projectRepository } = await import(paths.runtime), { projectContentHash } = await import(paths.project)
    const source = await projectRepository.load(sceneId)
    return source ? projectContentHash(source.project) : null
  }, v7.document.sceneId)
  expect(v7SourceHash).toBe(beforeV8.hash)

  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await panel.getByRole('button', { name: '预览规则驱动岩岛布景', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90_000 })
  const surfaceReview = await page.locator('.asset-structure-preview').innerText()
  expect(surfaceReview).toMatch(/区域植被预计\d+件，候选\d+件/)
  expect((await state(page)).hash).toBe(v8.hash)
  await writeFile(`${root}/surface-rule-candidate.txt`, surfaceReview)
  await info.attach('surface-rule-candidate.png', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  expect((await state(page)).hash).toBe(v8.hash)
  await panel.getByRole('button', { name: '预览规则驱动岩岛布景', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  await page.getByRole('tab', { name: '室外', exact: true }).click()
  const surfaceDressed = await state(page)
  expect(surfaceDressed.document.revision).toBe(v8.document.revision + 1)
  expect(surfaceDressed.document.terrainAreas).toEqual(v8.document.terrainAreas)
  expect(surfaceDressed.document.paths).toEqual(v8.document.paths)
  for (const [id, prop] of Object.entries(v8.document.props)) expect(surfaceDressed.document.props[id]).toEqual(prop)
  const surfaceFields = Object.values(surfaceDressed.document.surfaceRules!).map(rule => rule.field)
  expect(surfaceFields).toContain('material')
  expect(surfaceFields).toContain('trees')
  expect(surfaceFields).toContain('shrubs')
  expect(surfaceFields).toContain('grass')
  expect(Object.values(surfaceDressed.document.decorationClusters!).some(cluster => cluster.seed.startsWith('island-surface-dressing@1/'))).toBe(true)

  const v8Decorations = page.getByRole('region', { name: '簇状布景', exact: true })
  const crownRule = Object.values(surfaceDressed.document.surfaceRules!).find(rule => rule.field === 'trees')!
  const support = surfaceDressed.document.terrainAreas[crownRule.supportRef.id]
  await v8Decorations.getByRole('group', { name: '地表规则通道', exact: true }).getByRole('button', { name: '草簇', exact: true }).click()
  const brushTarget = canopyTargets(surfaceDressed.document).find(row => row.areaId === support.id)
  if (!brushTarget) throw new Error(`Expected a clear interior point on ${support.id} for the grass-rule brush.`)
  await v8Decorations.getByLabel('地表规则支撑地形面', { exact: true }).selectOption(brushTarget.areaId)
  const brushRadiusMm = Math.max(100, Math.floor(Math.min(2500, brushTarget.clearance * .7) / 100) * 100)
  await v8Decorations.getByLabel('地表规则画笔半径', { exact: true }).fill(String(brushRadiusMm))
  await v8Decorations.getByRole('button', { name: '开始地表涂绘', exact: true }).click()
  const v8Canvas = page.getByLabel('材质场景主持人预览', { exact: true }), v8CanvasBox = await v8Canvas.boundingBox()
  if (!v8CanvasBox) throw new Error('Expected the real scene canvas for v8 surface-rule drawing.')
  const v8Bounds = surfaceDressed.document.exportBoundsMm
  await page.mouse.click(v8CanvasBox.x + v8CanvasBox.width * (brushTarget.point.x - v8Bounds.x) / v8Bounds.width,
    v8CanvasBox.y + v8CanvasBox.height * (brushTarget.point.y - v8Bounds.y) / v8Bounds.height)
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90_000 })
  const paintedReview = await page.locator('.asset-structure-preview').innerText()
  expect(paintedReview).toMatch(/区域植被预计\d+件，候选\d+件/)
  expect((await state(page)).hash).toBe(surfaceDressed.hash)
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
  const painted = await state(page)
  expect(Object.keys(painted.document.surfaceRules!).length).toBe(Object.keys(surfaceDressed.document.surfaceRules!).length + 1)
  expect(Object.values(painted.document.surfaceRules!).filter(rule => rule.field === 'grass')).toHaveLength(2)
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.surfaceRules).toEqual(surfaceDressed.document.surfaceRules)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.surfaceRules).toEqual(painted.document.surfaceRules)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await saved(page)
  const surfaceCold = await state(page)
  expect(surfaceCold.document.surfaceRules).toEqual(painted.document.surfaceRules)
  const surfaceIo = await page.evaluate(async () => {
    const paths = { project: '/src/application/workspace/project.ts', runtime: '/src/platform/browser/runtime.ts', file: '/src/shared/project/file.ts', hash: '/src/shared/project/validate.ts', renderer: '/src/platform/browser/render/renderer.ts', pixels: '/src/shared/validation/hash.ts', visual: '/src/shared/visual/base.ts', types: '/src/shared/visual/types.ts' }
    const { toBundle, captureEditableDraft } = await import(paths.project), { validation } = await import(paths.runtime), { exportProject, importProject } = await import(paths.file), { projectContentHash } = await import(paths.hash), { renderProject } = await import(paths.renderer), { sha256Bytes } = await import(paths.pixels), { visualBase } = await import(paths.visual), { emptyVisualSystem } = await import(paths.types)
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: { getState(): { project: EditableProject | null } } }).workspace
    const current = workspace.getState().project as EditableProject, bundle = toBundle(current)
    const bytes = await exportProject(bundle, validation), round = await importProject(bytes, validation)
    if (round.project.schemaVersion !== 8 || projectContentHash(round.project) !== projectContentHash(bundle.project)) throw new Error('The complete v8 surface-rule package lost content.')
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
  await writeFile(`${root}/surface-rule-proof.json`, JSON.stringify({ sourceV7: { sceneId: v7.document.sceneId, hash: v7.hash, coldSourceHash: v7SourceHash }, targetV8: { sceneId: v8.document.sceneId, hash: v8.hash }, surfaceReview, paintedReview,
    automatic: { revision: surfaceDressed.document.revision, rules: surfaceFields, clusters: Object.values(surfaceDressed.document.decorationClusters!).filter(cluster => cluster.seed.startsWith('island-surface-dressing@1/')).map(cluster => ({ id: cluster.id, members: Object.values(cluster.members).filter(member => member.entityId && member.state === 'managed').length })) },
    manual: { revision: painted.document.revision, ruleCount: Object.keys(painted.document.surfaceRules!).length }, coldHash: surfaceCold.hash, packageHash: surfaceIo.hash,
    outputs: surfaceIo.outputs.map(({ png: _png, ...row }) => row), crops: surfaceIo.crops.map(({ png, name }) => ({ name, bytes: Buffer.from(png, 'base64').byteLength })), errors, external }, null, 2))
  expect(errors).toEqual([]); expect(external).toEqual([])
})
