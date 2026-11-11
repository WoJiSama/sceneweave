import { describe, expect, it } from 'vitest'
import polygonClipping from 'polygon-clipping'
import type { MaterialPaint, MaterialRef, PointMm, SurfaceStyle, TerrainArea } from '../model/scene.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { addSurfaceAppearanceSource, createAppearanceGraph, createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { MANUAL_TRANSACTION_BUDGET } from '../budget/command-budget.js'
import { pathPolygon } from '../geometry/geometry.js'
import { validateSceneDocument } from '../validation/scene.js'
import { canonicalJson } from '../validation/json.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash } from '../terrain-generation/integrity.js'
import { buildRoadCampPatchPlan, type RoadCampPatchRequest } from './road-camp-patches.js'

const p = (x: number, y: number): PointMm => ({ x, y })
const rect = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
const style = (material: MaterialRef): SurfaceStyle => ({ base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm },
  rotationDeg: 0, alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] })
let sequence = 0
const runtime = () => ({ ids: { nextId: () => `patch-test-token-${++sequence}` }, clock: { now: () => '2026-11-10T00:00:00.000Z' } })
function fixture() {
  const scene = createRefinedBlankDocument('island', { sceneId: 'ordinary-ground-paint', title: '普通工程', widthMm: 60000, heightMm: 50000, now: '2026-11-10T00:00:00.000Z', preset: 'narrative' })
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0], materials = Object.values(scene.materials).filter(material => material.applicableSurfaces.includes('terrain'))
  const area = (id: string, points: PointMm[], priority = 0): TerrainArea => ({ id, floorId, editLocked: false, visibility: 'public',
    boundaryMm: points.map((positionMm, i) => ({ id: `${id}-point-${i}`, segmentId: `${id}-segment-${i}`, positionMm })),
    groundElevationMm: 0, coveragePriority: priority, surfaceStyle: style(materials[0]), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 })
  scene.terrainAreas.ordinaryGround = area('ordinaryGround', rect(0, 0, 60000, 50000))
  scene.paths.ordinaryRoad = { id: 'ordinaryRoad', floorId, editLocked: false, visibility: 'public', centerlineMm: [p(10000, 25000), p(45000, 25000)], widthMm: 2000,
    supportRefs: [{ kind: 'terrainArea', id: 'ordinaryGround' }], surfaceStyle: style(materials[1]), movementCostMultiplier: 1, renderOrder: 0 }
  scene.entityLayers.ordinaryGround = layerId; scene.entityLayers.ordinaryRoad = layerId
  const project = () => ({ document: scene, appearance: createAppearanceGraph(scene) })
  const paint: MaterialPaint = { ...style(materials[1]).base, tileSizeMm: { width: 1234, height: 2468 }, originMm: p(314, 592), rotationDeg: 27, opacity: .66, tint: null }
  const request = (): RoadCampPatchRequest => ({ operationId: 'ordinary-operation', paint: structuredClone(paint),
    roads: [{ pathId: 'ordinaryRoad', supportAreaIds: ['ordinaryGround'], shoulder: { leftWidthMm: 450, rightWidthMm: 700, variationMm: 0, sampleSpacingMm: 2500, blendWidthMm: 260, seed: 'ordinary-world-shape' } }], patches: [] })
  expect(validateSceneDocument(scene).ok).toBe(true)
  return { scene, project, request, area, floorId, layerId, paint }
}
const onlyPatches = (request: RoadCampPatchRequest, points: PointMm[], targetAreaId = 'ordinaryGround') => ({ ...request, roads: [], patches: [{ targetAreaId, selectionMm: points, blendWidthMm: 240 }] })

describe('ordinary static road and camp surface patch plans', () => {
  it('uses ordinary IDs, preserves complete world paint and appends without changing any physical record', () => {
    const f = fixture(), project = f.project(), request = f.request(), before = canonicalJson(project)
    request.paint.tint = '#A9B6C3'
    const result = buildRoadCampPatchPlan(project, request)
    expect(result.targetIds).toEqual(['ordinaryGround']); expect(result.previewFragments).toHaveLength(1)
    expect(result.previewFragments[0].overlay.paint).toEqual(request.paint)
    expect(result.notes.join('')).toMatch(/静态.*不会自动随动/)
    const command = result.commands[0]
    expect(command.type).toBe('setVisualSurface')
    if (command.type !== 'setVisualSurface') throw new Error('unexpected command')
    expect(command.style!.base).toEqual(f.scene.terrainAreas.ordinaryGround.surfaceStyle!.base)
    expect(result.dependencyIds).toEqual(expect.arrayContaining(['ordinaryRoad', 'ordinaryGround', f.floorId, f.layerId]))
    expect(canonicalJson(project)).toBe(before)
    const band = pathPolygon(f.scene.paths.ordinaryRoad), covers = result.previewFragments.map(row => [row.overlay.boundaryMm.map(point => [point.x, point.y] as [number, number])])
    expect(polygonClipping.difference([band.map(point => [point.x, point.y] as [number, number])], ...covers)).toEqual([])
    result.previewFragments[0].overlay.paint.originMm.x++
    expect(request.paint.originMm).toEqual(p(314, 592)); expect(canonicalJson(project)).toBe(before)
  })

  it('is deterministic in world coordinates and changes shape only from explicit style parameters', () => {
    const f = fixture(), request = f.request(); request.roads[0].shoulder.variationMm = 150
    const first = buildRoadCampPatchPlan(f.project(), request)
    expect(first).toEqual(buildRoadCampPatchPlan(f.project(), request))
    request.roads[0].shoulder.seed = 'another-shape'
    expect(buildRoadCampPatchPlan(f.project(), request).previewFragments).not.toEqual(first.previewFragments)
    expect(first.previewFragments.flatMap(row => row.overlay.boundaryMm).every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
  })

  it.each([
    [p(10000, 10000), p(30000, 10000), p(30000, 35000)],
    [p(10000, 12000), p(34000, 12000), p(27000, 35000)],
  ])('covers the actual wide square-cap and miter/bevel road, including a sharp bend', (...points) => {
    const f = fixture(); f.scene.paths.ordinaryRoad.centerlineMm = points; f.scene.paths.ordinaryRoad.widthMm = 8000
    const request = f.request(); request.roads[0].shoulder.leftWidthMm = 2200; request.roads[0].shoulder.rightWidthMm = 2700
    const plan = buildRoadCampPatchPlan(f.project(), request), band = pathPolygon(f.scene.paths.ordinaryRoad)
    const covers = plan.previewFragments.map(row => [row.overlay.boundaryMm.map(point => [point.x, point.y] as [number, number])])
    expect(polygonClipping.difference([band.map(point => [point.x, point.y] as [number, number])], ...covers)).toEqual([])
  })

  it('clips across all explicit effective supports and preserves every separated component', () => {
    const f = fixture(); f.scene.terrainAreas.clearing = f.area('clearing', rect(25000, 18000, 12000, 14000), 1); f.scene.entityLayers.clearing = f.layerId
    f.scene.paths.ordinaryRoad.supportRefs.push({ kind: 'terrainArea', id: 'clearing' })
    const request = f.request(); request.roads[0].supportAreaIds.push('clearing')
    const plan = buildRoadCampPatchPlan(f.project(), request)
    expect(plan.targetIds).toEqual(['clearing', 'ordinaryGround'])
    expect(plan.previewFragments.filter(row => row.targetAreaId === 'ordinaryGround')).toHaveLength(2)
    expect(plan.previewFragments.filter(row => row.targetAreaId === 'clearing')).toHaveLength(1)
    expect(new Set(plan.createdOverlayIds).size).toBe(3)
    expect(plan.previewFragments.every(row => row.overlay.paint.originMm.x === 314)).toBe(true)
  })

  it('returns all disconnected camp selection fragments, with independent fresh IDs and stable order', () => {
    const f = fixture(); delete f.scene.paths.ordinaryRoad; delete f.scene.entityLayers.ordinaryRoad
    f.scene.terrainAreas.ordinaryGround = f.area('ordinaryGround', [p(10000, 10000), p(40000, 10000), p(40000, 40000), p(30000, 40000), p(30000, 20000), p(20000, 20000), p(20000, 40000), p(10000, 40000)])
    const plan = buildRoadCampPatchPlan(f.project(), onlyPatches(f.request(), rect(5000, 25000, 40000, 5000)))
    expect(plan.previewFragments).toHaveLength(2)
    expect(plan.previewFragments.map(row => row.overlay.renderOrder)).toEqual([0, 1])
    expect(plan.previewFragments.map(row => row.overlay.id)).toEqual(['ordinary-operation-rcp-c0-p0', 'ordinary-operation-rcp-c0-p1'])
  })

  it('retains existing overlay IDs, order, paint and source ancestor through normal composition commands', () => {
    const f = fixture(), oldPaint = structuredClone(f.paint); oldPaint.opacity = .9
    f.scene.terrainAreas.ordinaryGround.surfaceStyle!.overlays.push({ id: 'human-painted-patch', boundaryMm: rect(2000, 2000, 2000, 2000), paint: oldPaint, blendWidthMm: 80, renderOrder: 99 })
    const content = createCompositionContent(f.scene, runtime()), before = canonicalJson(content), sourceId = content.appearance.surfaceSources.ordinaryGround
    const plan = buildRoadCampPatchPlan(content, f.request())
    const result = applyCompositionCommands(content, plan.commands, runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(result.document.terrainAreas.ordinaryGround.surfaceStyle!.overlays[0]).toEqual(f.scene.terrainAreas.ordinaryGround.surfaceStyle!.overlays[0])
    expect(result.document.terrainAreas.ordinaryGround.surfaceStyle!.overlays[1].renderOrder).toBe(100)
    const newSource = result.appearance.sources[result.appearance.surfaceSources.ordinaryGround]
    expect(newSource.parentSourceId).toBe(sourceId); expect(result.appearance.sources[sourceId]).toEqual(content.appearance.sources[sourceId])
    expect(result.historyIdentity.presentationTokens?.[plan.createdOverlayIds[0]]).toBeDefined()
    expect(result.document.paths).toEqual(content.document.paths); expect(result.document.props).toEqual(content.document.props)
    expect(canonicalJson(content)).toBe(before)
  })

  it('appends again on a legal derived fixed source and preserves every ancestor and old overlay identity', () => {
    const f = fixture(), original = createCompositionContent(f.scene, runtime()), request = f.request()
    const firstPlan = buildRoadCampPatchPlan(original, request)
    const first = applyCompositionCommands(original, firstPlan.commands, runtime(), { budget: MANUAL_TRANSACTION_BUDGET }), before = canonicalJson(first)
    request.operationId = 'second-human-operation'
    request.roads = []; request.patches = [{ targetAreaId: 'ordinaryGround', selectionMm: rect(2000, 2000, 2000, 2000), blendWidthMm: 100 }]
    const secondPlan = buildRoadCampPatchPlan(first, request)
    const second = applyCompositionCommands(first, secondPlan.commands, runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    for (const [id, source] of Object.entries(first.appearance.sources)) expect(second.appearance.sources[id]).toEqual(source)
    for (const id of firstPlan.createdOverlayIds) expect(second.historyIdentity.presentationTokens?.[id]).toEqual(first.historyIdentity.presentationTokens?.[id])
    const source = second.appearance.sources[second.appearance.surfaceSources.ordinaryGround]
    expect(source.parentSourceId).toBe(first.appearance.surfaceSources.ordinaryGround)
    expect(second.document.terrainAreas.ordinaryGround.surfaceStyle!.overlays).toHaveLength(2)
    expect(canonicalJson(first)).toBe(before)
    expect(() => buildRoadCampPatchPlan(second, request)).toThrow(/身份/)
  })

  it('refuses another fixed-source descendant beyond the actual16-layer ancestry limit', () => {
    const f = fixture(), source = f.project()
    for (let depth = 1; depth < 16; depth++) {
      const next = structuredClone(source.document.terrainAreas.ordinaryGround.surfaceStyle!)
      next.base.originMm.x = depth
      source.appearance.surfaceSources.ordinaryGround = addSurfaceAppearanceSource(source.appearance, next, source.appearance.surfaceSources.ordinaryGround)
      source.document.terrainAreas.ordinaryGround.surfaceStyle = next
    }
    const before = canonicalJson(source)
    expect(() => buildRoadCampPatchPlan(source, f.request())).toThrow(/16层/)
    expect(canonicalJson(source)).toBe(before)
  })

  it('uses normal generation lifecycle and refuses only the related locked provenance rule', () => {
    const f = fixture(), generation = getLegacyGeneration(f.scene)!, target = { kind: 'terrainArea' as const, entityId: 'ordinaryGround', parentId: null, fieldGroup: 'surface' as const }
    generation.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'ordinary-patch-test', algorithmVersion: 1, mapMode: 'scene', seed: 'saved-generation',
      parameters: { terrainKind: 'island', seaElevationMm: 0, landElevationMm: 800, plateauElevationMm: 2600, roughness: 0, densityFactor: 0, baySide: 'north' },
      materials: [], props: [], precision: { sampleSpacingMm: 1000, toleranceMm: 50, noiseCellMm: 2000 } }
    generation.rules.rule = { id: 'rule', floorId: f.floorId, layerId: f.layerId, visibility: 'public', editLocked: false, kind: 'terrain', recipeRef: { id: 'recipe', version: 1 }, inputs: [], outputs: [target],
      parameters: { widthMm: 200, minWidthMm: 200, maxWidthMm: 200, roughness: 0, densityFactor: 0 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
    generation.ownership.owner = { id: 'owner', outputKey: 'saved-generation/ground', ruleId: 'rule', target, managedFields: ['surface'], manualFields: [], state: 'managed', birthToken: 'saved-ground-birth' }
    generation.rules.rule.inputHash = generationInputHash(f.scene, generation.rules.rule); generation.rules.rule.managedOutputHash = managedOutputHash(f.scene, generation.rules.rule)
    const content = createCompositionContent(f.scene, runtime()), plan = buildRoadCampPatchPlan(content, f.request())
    expect(plan.dependencyIds).toEqual(expect.arrayContaining(['rule', 'recipe', 'owner']))
    const result = applyCompositionCommands(content, plan.commands, runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(getLegacyGeneration(result.document)!.rules.rule.state).toBe('paused')
    expect(getLegacyGeneration(result.document)!.ownership.owner.state).toBe('manual')
    generation.rules.rule.editLocked = true
    expect(() => buildRoadCampPatchPlan(f.project(), f.request())).toThrow(/生成来源规则.*锁定/)
  })

  it('does not derive public fragments from private covers or block on unrelated locks', () => {
    const f = fixture(), first = buildRoadCampPatchPlan(f.project(), f.request())
    f.scene.terrainAreas.secret = { ...f.area('secret', rect(12000, 26300, 2000, 2000), 2), visibility: 'gm', editLocked: true }
    f.scene.entityLayers.secret = f.layerId
    f.scene.terrainAreas.distant = { ...f.area('distant', rect(50000, 1000, 2000, 2000), 1), editLocked: true }
    f.scene.entityLayers.distant = f.layerId
    const second = buildRoadCampPatchPlan(f.project(), f.request())
    expect(second).toEqual(first)
    expect(canonicalJson(second)).not.toMatch(/secret|distant/)
  })

  it.each(['road', 'target', 'layer', 'note'] as const)('rejects a related %s lock atomically', lock => {
    const f = fixture()
    if (lock === 'road') f.scene.paths.ordinaryRoad.editLocked = true
    if (lock === 'target') f.scene.terrainAreas.ordinaryGround.editLocked = true
    if (lock === 'layer') f.scene.userLayers[f.layerId].editLocked = true
    if (lock === 'note') { f.scene.notes.related = { id: 'related', floorId: f.floorId, editLocked: true, kind: 'note', text: '', visibility: 'gm', anchor: { type: 'entity', entityKind: 'terrainArea', entityId: 'ordinaryGround' } }; f.scene.entityLayers.related = f.layerId }
    const source = f.project(), before = canonicalJson(source)
    expect(() => buildRoadCampPatchPlan(source, f.request())).toThrow(/锁定/)
    expect(canonicalJson(source)).toBe(before)
  })

  it('rejects private sources, omitted supports and cross-height requests', () => {
    const f = fixture(), request = f.request()
    f.scene.paths.ordinaryRoad.visibility = 'gm'
    expect(() => buildRoadCampPatchPlan(f.project(), request)).toThrow(/公开/)
    f.scene.paths.ordinaryRoad.visibility = 'public'; request.roads[0].supportAreaIds = ['another-area']
    expect(() => buildRoadCampPatchPlan(f.project(), request)).toThrow(/支撑/)
    request.roads = []; request.patches = [{ targetAreaId: 'ordinaryGround', selectionMm: rect(1000, 1000, 1000, 1000), blendWidthMm: 1 }]
    f.scene.terrainAreas.upper = f.area('upper', rect(50000, 1000, 2000, 2000), 1); f.scene.terrainAreas.upper.groundElevationMm = 800; f.scene.entityLayers.upper = f.layerId
    request.patches.push({ targetAreaId: 'upper', selectionMm: rect(50000, 1000, 2000, 2000), blendWidthMm: 1 })
    expect(() => buildRoadCampPatchPlan(f.project(), request)).toThrow(/同高程/)
  })

  it('rejects noninteger clipping and holes rather than rounding, filling or dropping pieces', () => {
    const f = fixture(); delete f.scene.paths.ordinaryRoad; delete f.scene.entityLayers.ordinaryRoad
    f.scene.terrainAreas.ordinaryGround = f.area('ordinaryGround', [p(10000, 10000), p(10009, 10000), p(10000, 10006)])
    expect(() => buildRoadCampPatchPlan(f.project(), onlyPatches(f.request(), rect(10001, 9999, 3, 10)))).toThrow(/非整数/)
    f.scene.terrainAreas.ordinaryGround = f.area('ordinaryGround', rect(0, 0, 60000, 50000))
    f.scene.terrainAreas.campHole = f.area('campHole', rect(12000, 12000, 2000, 2000), 1); f.scene.entityLayers.campHole = f.layerId
    expect(() => buildRoadCampPatchPlan(f.project(), onlyPatches(f.request(), rect(10000, 10000, 10000, 10000)))).toThrow(/孔洞/)
  })

  it('requires original fixed source styles and refuses enabled instance/layer effects', () => {
    const f = fixture(), source = f.project()
    source.appearance.instanceAdjustments.ordinaryGround = [{ id: 'manual-opacity', kind: 'opacity', value: .8, enabled: true }]
    expect(() => buildRoadCampPatchPlan(source, f.request())).toThrow(/外观调整/)
    source.appearance.instanceAdjustments.ordinaryGround[0].enabled = false
    expect(buildRoadCampPatchPlan(source, f.request()).commands).toHaveLength(1)
    source.appearance.layerAdjustments[f.layerId] = [{ id: 'manual-layer-tint', kind: 'tint', value: '#FFCCAA', enabled: true }]
    expect(() => buildRoadCampPatchPlan(source, f.request())).toThrow(/外观调整/)
    source.appearance.layerAdjustments = {}
    source.document.terrainAreas.ordinaryGround.surfaceStyle!.base.rotationDeg = 15
    expect(() => buildRoadCampPatchPlan(source, f.request())).toThrow(/原源与当前表面不一致/)
  })

  it('rejects missing or forged source closures and incomplete/nonworld paint', () => {
    const f = fixture(), source = f.project(), request = f.request()
    delete source.appearance.surfaceSources.ordinaryGround
    expect(() => buildRoadCampPatchPlan(source, request)).toThrow(/外观源/)
    request.paint.alignment = 'surface'
    expect(() => buildRoadCampPatchPlan(f.project(), request)).toThrow(/world paint/)
    request.paint.alignment = 'world'; delete (request.paint as Partial<MaterialPaint>).originMm
    expect(() => buildRoadCampPatchPlan(f.project(), request)).toThrow(/请求无效/)
  })

  it('enforces actual compact256 fragments and finite geometry work without mutating the baseline', () => {
    const f = fixture(), source = f.project(), before = canonicalJson(source), request = f.request()
    request.patches = Array.from({ length: 255 }, () => ({ targetAreaId: 'ordinaryGround', selectionMm: rect(2000, 2000, 1000, 1000), blendWidthMm: 100 }))
    expect(() => buildRoadCampPatchPlan(source, request)).toThrow(/256/)
    expect(canonicalJson(source)).toBe(before)
    request.patches = []; request.roads[0].shoulder.sampleSpacingMm = 1
    expect(() => buildRoadCampPatchPlan(source, request)).toThrow(/采样/)
    expect(canonicalJson(source)).toBe(before)
  })

  it('keeps the source intact after a late fresh-ID collision or repeat operation', () => {
    const f = fixture(), request = onlyPatches(f.request(), rect(2000, 2000, 2000, 2000))
    f.scene.terrainAreas.ordinaryGround.surfaceStyle!.overlays.push({ id: 'ordinary-operation-rcp-c0-p0', boundaryMm: rect(5000, 5000, 1000, 1000), paint: f.paint, blendWidthMm: 1, renderOrder: 0 })
    const source = f.project(), before = canonicalJson(source)
    expect(() => buildRoadCampPatchPlan(source, request)).toThrow(/身份/)
    expect(canonicalJson(source)).toBe(before)
  })
})
