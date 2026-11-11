import { describe, expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { fromBundle } from '../../application/workspace/project.js'
import { prepareCompositionCommands } from '../../application/workspace/prepare.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCommands } from '../commands/commands.js'
import { manualTransactionBudget } from '../budget/command-budget.js'
import type { CompositionContent } from '../model/appearance.js'
import type { MaterialPaint, PointMm, SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { connectionFootprint, corridor, polygonInside, polygonsOverlap, terrainPoints } from '../geometry/geometry.js'
import { visualBase } from '../visual/base.js'
import { edgeLookPaintPadding } from '../visual/paint-envelopes.js'
import { domainExecutionFixture } from '../../../tools/testing/domain-execution-fixtures.js'
import { runMixedGeneration } from '../generation/domains/mixed/index.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { buildNaturalSurfacePatchPlan, type NaturalSurfacePatchRequest } from './natural-patches.js'

const compact = manualTransactionBudget('compact')
const rect = (x: number, y: number, w: number, h: number): PointMm[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const shift = (points: PointMm[], x: number, y: number) => points.map(point => ({ x: point.x + x, y: point.y + y }))
function setup(boundaryMm = rect(-8000, -6000, 16000, 12000)) {
  const bundle = fixture({ image: true }), scene = cloneJson(bundle.project.document)
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0], areaId = 'ordinary-granite-surface'
  scene.floors[floorId].boundsMm = { x: -20000, y: -16000, width: 40000, height: 32000 }
  scene.exportBoundsMm = cloneJson(scene.floors[floorId].boundsMm)
  scene.props.item.positionMm = { x: 14000, y: 12000 }
  scene.props.other.positionMm = { x: 17000, y: 12000 }
  const material = { id: 'ordinary-stone', catalogId: 'test.stone', version: 1, licenseRef: scene.assets.image.licenseRef, origin: cloneJson(scene.assets.image.origin),
    name: '石面', tags: ['rock'], textureAssetId: 'image', defaultTileSizeMm: { width: 1370, height: 2110 }, applicableSurfaces: ['terrain' as const] }
  scene.materials[material.id] = material
  scene.materials['ordinary-moss'] = { ...cloneJson(material), id: 'ordinary-moss', catalogId: 'test.moss', name: '苔草', tags: ['moss'] }
  const paint: MaterialPaint = { materialRef: { id: material.id, version: 1 }, tileSizeMm: { width: 1730, height: 2270 }, rotationDeg: 17,
    alignment: 'world', originMm: { x: -791, y: 317 }, tint: null, opacity: 1 }
  let document = applyCommands(scene, [{ type: 'createTerrainArea', id: areaId, floorId, layerId, boundaryMm, groundElevationMm: 0, coveragePriority: 0 }], runtime)
  const origin = boundaryMm[0], old = { id: 'existing-manual-overlay', boundaryMm: rect(origin.x + 300, origin.y + 300, 700, 600), paint: { ...cloneJson(paint), opacity: .43 }, blendWidthMm: 63, renderOrder: 4 }
  document = applyCommands(document, [{ type: 'setVisualSurface', kind: 'terrainArea', id: areaId, style: { base: paint, overlays: [old] } }], runtime)
  const project = createCompositionContent(document, runtime)
  const request: NaturalSurfacePatchRequest = { operationId: 'operation-any-id-7', areaId, paint: { ...cloneJson(paint), materialRef: { id: 'ordinary-moss', version: 1 }, opacity: .74 },
    regionsMm: [rect(-4000, -3000, 6000, 4000)], profile: 'grassOnRock', seed: 'natural-plain-surface', variationMm: 100, blendWidthMm: 113 }
  const licensePath = bundle.project.licenseBindings[0].licensePath
  const readyBundle = { ...bundle, project: { ...bundle.project, ...project, licenseBindings: [...bundle.project.licenseBindings,
    ...Object.values(document.materials).map(row => ({ subjectKind: 'material' as const, subjectId: row.id, licenseRef: row.licenseRef, licensePath, embedding: 'allowed' as const }))] } }
  return { project, request, areaId, floorId, layerId, readyBundle }
}
const styleCommand = (plan: ReturnType<typeof buildNaturalSurfacePatchPlan>) => {
  const command = plan.commands[0]
  if (command.type !== 'setVisualSurface' || !command.style) throw new Error('Expected a complete surface append command')
  return command
}
const physical = (document: SceneDocument) => ({ ...document, terrainAreas: Object.fromEntries(Object.entries(document.terrainAreas).map(([id, { surfaceStyle: _style, ...area }]) => [id, area])), generation: undefined, visual: undefined })

describe('ordinary static natural surface patch plans', () => {
  it.each(['grassOnRock', 'rockOnGrass'] as const)('plans %s over arbitrary names while retaining base, manual overlays and full world paint', profile => {
    const { project, request } = setup(), before = canonicalJson(project)
    request.paint.tint = '#7A815F'
    const plan = buildNaturalSurfacePatchPlan(project, { ...request, profile, fragments: 2, grassEdges: true })
    expect(canonicalJson(project)).toBe(before)
    expect(plan.targetIds).toEqual([request.areaId]); expect(plan.createdOverlayIds).toHaveLength(plan.counts.overlays)
    expect(plan.counts.fragments).toBe(2); expect(plan.counts.grassEdges).toBeGreaterThan(0)
    expect(plan.counts.grassEdges).toBeLessThanOrEqual(8)
    const style = styleCommand(plan).style!, original = project.document.terrainAreas[request.areaId].surfaceStyle!
    expect(style.base).toEqual(original.base); expect(style.overlays.slice(0, original.overlays.length)).toEqual(original.overlays)
    for (const overlay of style.overlays.slice(original.overlays.length)) {
      expect(overlay.paint).toEqual(request.paint); expect(overlay.blendWidthMm).toBe(113)
      expect(polygonInside(overlay.boundaryMm, terrainPoints(project.document.terrainAreas[request.areaId]))).toBe(true)
    }
    const next = applyCommands(project.document, plan.commands, runtime, { budget: compact })
    expect(physical(next)).toEqual(physical(project.document)); expect(validateSceneDocument(next).ok).toBe(true)
    const visual = visualBase(next)!, area = next.terrainAreas[request.areaId]
    for (const boundary of Object.values(visual.boundaries)) if (plan.commands.some(command => command.type === 'upsertVisualBoundary' && command.boundary.id === boundary.id)) {
      expect(boundary.closed).toBe(false); expect(boundary.binding).toEqual({ kind: 'decoration' }); expect(boundary.layerId).toBe(project.document.entityLayers[area.id])
      const look = Object.values(visual.edgeLooks).find(look => look.boundaryId === boundary.id)!
      expect(look.side).toBe(profile === 'grassOnRock' ? 'left' : 'right')
      const segment = boundary.segments[0], envelope = corridor(segment.start, segment.end, Math.ceil(edgeLookPaintPadding(look)) * 2, true)
      expect(polygonInside(envelope, terrainPoints(area))).toBe(true)
    }
    expect(plan.counts.usage.semanticTargets).toBeLessThanOrEqual(256)
    expect(plan.counts.usage.metadataBytes).toBeGreaterThan(0); expect(plan.counts.usage.geometryPoints).toBeGreaterThan(0)
    expect(buildNaturalSurfacePatchPlan(project, { ...request, profile, fragments: 2, grassEdges: true })).toEqual(plan)
  })

  it('retains immutable source ancestry and licenses through ordinary complete composition preparation', async () => {
    const { readyBundle, request, areaId } = setup(), original = await fromBundle(readyBundle, validation)
    const plan = buildNaturalSurfacePatchPlan(original, { ...request, grassEdges: true }), before = canonicalJson(original.document)
    const parentId = original.appearance.surfaceSources[areaId], parent = cloneJson(original.appearance.sources[parentId])
    const prepared = await prepareCompositionCommands(original, plan.commands, { validation, runtime, budget: compact })
    const childId = prepared.appearance.surfaceSources[areaId]
    expect(childId).not.toBe(parentId); expect(prepared.appearance.sources[parentId]).toEqual(parent)
    expect(prepared.appearance.sources[childId]).toMatchObject({ kind: 'surface', parentSourceId: parentId, snapshot: styleCommand(plan).style })
    expect(prepared.licenseBindings).toEqual(original.licenseBindings); expect(prepared.document.materials).toEqual(original.document.materials)
    for (const hash of Object.keys(original.assets)) expect(await prepared.resources.read(hash)).toEqual(await original.resources.read(hash))
    expect(canonicalJson(original.document)).toBe(before)
    const originalTokens = original.historyIdentity.presentationTokens!, preparedTokens = prepared.historyIdentity.presentationTokens!
    expect(preparedTokens['existing-manual-overlay']).toEqual(originalTokens['existing-manual-overlay'])
    for (const id of plan.createdOverlayIds) {
      expect(preparedTokens[id]).toMatchObject({ kind: 'surfaceOverlay' })
      expect(Object.hasOwn(originalTokens, id)).toBe(false)
    }
    const nextPlan = buildNaturalSurfacePatchPlan(prepared, { ...request, operationId: 'another-operation', regionsMm: [rect(2500, 1500, 1800, 1900)] })
    const again = await prepareCompositionCommands(prepared, nextPlan.commands, { validation, runtime, budget: compact })
    expect(again.appearance.sources[again.appearance.surfaceSources[areaId]]).toMatchObject({ kind: 'surface', parentSourceId: childId })
    for (const id of [parentId, childId]) expect(again.appearance.sources[id]).toEqual(prepared.appearance.sources[id])
    for (const id of ['existing-manual-overlay', ...plan.createdOverlayIds]) expect(again.historyIdentity.presentationTokens![id]).toEqual(preparedTokens[id])
  })

  it('clips concave negative-coordinate supports into exact independent components and translates without resetting paint phase', () => {
    const u = [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 8000 }, { x: 5500, y: 8000 }, { x: 5500, y: 2500 }, { x: 2500, y: 2500 }, { x: 2500, y: 8000 }, { x: 0, y: 8000 }]
    const a = setup(shift(u, -8000, -4000)), b = setup(shift(u, -3000, -1000)), delta = { x: 5000, y: 3000 }
    const first = buildNaturalSurfacePatchPlan(a.project, { ...a.request, regionsMm: [rect(-7000, 0, 6000, 2000)], variationMm: 0 })
    const second = buildNaturalSurfacePatchPlan(b.project, { ...b.request, regionsMm: [rect(-2000, 3000, 6000, 2000)], variationMm: 0 })
    expect(first.counts.overlays).toBe(2); expect(second.counts.overlays).toBe(2)
    const firstOverlays = styleCommand(first).style!.overlays.slice(1), secondOverlays = styleCommand(second).style!.overlays.slice(1)
    expect(secondOverlays.map(overlay => overlay.boundaryMm)).toEqual(firstOverlays.map(overlay => shift(overlay.boundaryMm, delta.x, delta.y)))
    expect(secondOverlays.map(overlay => overlay.paint)).toEqual(firstOverlays.map(overlay => overlay.paint))
    expect(secondOverlays.flatMap(overlay => overlay.boundaryMm).every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
  })

  it('rejects effective adjustments and absent/mismatched/broken fixed sources while preserving all input branches', () => {
    const { project, request, areaId, layerId } = setup()
    const changes = [
      (content: CompositionContent) => { content.appearance.layerAdjustments[layerId] = [{ id: 'layer-tint', kind: 'tint', value: '#667755', enabled: true }] },
      (content: CompositionContent) => { content.appearance.instanceAdjustments[areaId] = [{ id: 'instance-opacity', kind: 'opacity', value: .7, enabled: true }] },
      (content: CompositionContent) => { delete content.appearance.surfaceSources[areaId] },
      (content: CompositionContent) => { const source = content.appearance.sources[content.appearance.surfaceSources[areaId]]; if (source.kind === 'surface') source.snapshot.base.originMm.x++ },
      (content: CompositionContent) => { content.appearance.sources[content.appearance.surfaceSources[areaId]].parentSourceId = 'unsupported-parent' },
    ]
    for (const change of changes) { const content = cloneJson(project); change(content); const before = canonicalJson(content); expect(() => buildNaturalSurfacePatchPlan(content, request)).toThrow(/外观调整|固定表面源|来源链/); expect(canonicalJson(content)).toBe(before) }
    const disabled = cloneJson(project); disabled.appearance.layerAdjustments[layerId] = [{ id: 'disabled-tint', kind: 'tint', value: '#667755', enabled: false }]
    expect(buildNaturalSurfacePatchPlan(disabled, request).commands.length).toBeGreaterThan(0)
  })

  it('honors target and layer locks while allowing unrelated locked content, and refuses identity reuse', () => {
    const { project, request, areaId, layerId } = setup()
    for (const kind of ['target', 'layer'] as const) {
      const locked = cloneJson(project); if (kind === 'target') locked.document.terrainAreas[areaId].editLocked = true; else locked.document.userLayers[layerId].editLocked = true
      const before = canonicalJson(locked); expect(() => buildNaturalSurfacePatchPlan(locked, request)).toThrow(/锁定/); expect(canonicalJson(locked)).toBe(before)
    }
    const unrelated = cloneJson(project); unrelated.document.props.other.editLocked = true
    expect(buildNaturalSurfacePatchPlan(unrelated, request).commands.length).toBeGreaterThan(0)
    expect(() => buildNaturalSurfacePatchPlan(project, { ...request, operationId: areaId })).toThrow(/身份/)
    const plan = buildNaturalSurfacePatchPlan(project, request), occupied = cloneJson(project)
    occupied.document.terrainAreas[areaId].surfaceStyle!.overlays[0].id = plan.createdOverlayIds[0]
    const withSource = createCompositionContent(occupied.document, runtime), before = canonicalJson(withSource)
    expect(() => buildNaturalSurfacePatchPlan(withSource, request)).toThrow(/新身份/)
    expect(canonicalJson(withSource)).toBe(before)
  })

  it('uses existing generated-output protection and retains its explicit manual state instead of bypassing a locked rule', () => {
    const fixture = domainExecutionFixture('mixed')
    fixture.input.parameters.building.arrangement.furniture = false
    const generated = runMixedGeneration(fixture.base, fixture.input, { profile: fixture.profile, nowMilliseconds: () => 0 })
    const project = createCompositionContent(cloneJson(generated.candidate.document) as SceneDocument, runtime), areaId = generated.report.supportAreaId
    const paint = cloneJson(project.document.terrainAreas[areaId].surfaceStyle!.base)
    const request: NaturalSurfacePatchRequest = { operationId: 'managed-surface-append', areaId, paint, regionsMm: [rect(1000, 1000, 2000, 2000)], profile: 'rockOnGrass', seed: 'managed-paint', variationMm: 0 }
    const generation = getLegacyGeneration(project.document)!, owner = Object.values(generation.ownership).find(row => row.target.entityId === areaId && row.managedFields.includes('surface'))!
    expect(owner).toBeDefined()
    const locked = cloneJson(project), before = canonicalJson(locked)
    getLegacyGeneration(locked.document)!.rules[owner.ruleId].editLocked = true
    const lockedBefore = canonicalJson(locked)
    expect(() => buildNaturalSurfacePatchPlan(locked, request)).toThrow(/生成规则|锁定/)
    expect(canonicalJson(locked)).toBe(lockedBefore)
    const plan = buildNaturalSurfacePatchPlan(project, request), next = applyCommands(project.document, plan.commands, runtime, { budget: compact, appearance: project.appearance })
    const manual = getLegacyGeneration(next)!.ownership[owner.id]
    expect(manual.state).toBe('manual'); expect(manual.manualFields).toContain('surface')
    expect(manual.manualFields).toEqual(expect.arrayContaining(owner.manualFields))
    expect(canonicalJson(project)).toBe(before)
  }, 30000)

  it('rejects incomplete paint, surface alignment, malformed accessors and cyclic/overlong source chains without touching input', () => {
    const { project, request, areaId } = setup(), before = canonicalJson(project)
    expect(() => buildNaturalSurfacePatchPlan(project, { ...request, paint: { ...request.paint, alignment: 'surface' } })).toThrow(/世界坐标/)
    expect(() => buildNaturalSurfacePatchPlan(project, { ...request, paint: { ...request.paint, materialRef: { id: 'missing', version: 1 } } })).toThrow(/确切版本/)
    let reads = 0
    const hostile = cloneJson(request)
    Object.defineProperty(hostile.paint, 'tint', { enumerable: true, get() { reads++; return null } })
    expect(() => buildNaturalSurfacePatchPlan(project, hostile)).toThrow(/访问器/); expect(reads).toBe(0)
    const cyclic = cloneJson(project), sourceId = cyclic.appearance.surfaceSources[areaId]
    cyclic.appearance.sources[sourceId].parentSourceId = sourceId
    expect(() => buildNaturalSurfacePatchPlan(cyclic, request)).toThrow(/循环/)
    const deep = cloneJson(project), root = cloneJson(deep.appearance.sources[sourceId])
    for (let index = 0; index < 15; index++) {
      const id = `retained-surface-source-${index}`
      deep.appearance.sources[id] = { ...cloneJson(root), id, parentSourceId: index ? `retained-surface-source-${index - 1}` : sourceId }
    }
    deep.appearance.surfaceSources[areaId] = 'retained-surface-source-14'
    expect(() => buildNaturalSurfacePatchPlan(deep, request)).toThrow(/16层/)
    expect(canonicalJson(project)).toBe(before)
  })

  it('rejects holes and fractional clipping intersections instead of rounding, flattening or partially appending', () => {
    const { project, request } = setup(), before = canonicalJson(project)
    const frame = [rect(-4000, -3000, 6000, 1000), rect(-4000, 2000, 6000, 1000), rect(-4000, -2000, 1000, 4000), rect(1000, -2000, 1000, 4000)]
    expect(() => buildNaturalSurfacePatchPlan(project, { ...request, regionsMm: frame, variationMm: 0 })).toThrow(/孔洞/)
    expect(canonicalJson(project)).toBe(before)
    const triangular = setup([{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 0, y: 6000 }]), triangleBefore = canonicalJson(triangular.project)
    expect(() => buildNaturalSurfacePatchPlan(triangular.project, { ...triangular.request, regionsMm: [rect(1000, 1000, 4001, 3000)], variationMm: 0 })).toThrow(/非整数/)
    expect(canonicalJson(triangular.project)).toBe(triangleBefore)
  })

  it('keeps compact budgets and cancellation fail-closed, including work already spent in planning', () => {
    const { project, request } = setup(), before = canonicalJson(project)
    const ring = Array.from({ length: 128 }, (_, index) => ({ x: Math.round(Math.cos(index * Math.PI / 64) * 2000), y: Math.round(Math.sin(index * Math.PI / 64) * 2000) }))
    expect(() => buildNaturalSurfacePatchPlan(project, { ...request, regionsMm: Array.from({ length: 16 }, () => cloneJson(ring)) })).toThrow(/预算超限/)
    expect(() => buildNaturalSurfacePatchPlan(project, request, { signal: { aborted: true } })).toThrow(/取消/)
    let calls = 0
    expect(() => buildNaturalSurfacePatchPlan(project, request, { executionMeter: { charge: () => { if (++calls === 2) throw new Error('observed budget stop') }, snapshot: () => { throw new Error('unused') } } })).toThrow(/observed budget stop/)
    expect(calls).toBe(2); expect(canonicalJson(project)).toBe(before)
  })

  it('filters private geometry before public patch planning and clips visible higher terrain and full connection bands', () => {
    const { project, request, areaId, floorId, layerId } = setup()
    const withArea = (visibility: 'public' | 'gm', x: number) => createCompositionContent(applyCommands(project.document, [{ type: 'createTerrainArea', id: 'neighbor', floorId, layerId,
      boundaryMm: rect(x, -4000, 2000, 6000), groundElevationMm: 0, coveragePriority: 2, visibility }], runtime), runtime)
    const first = buildNaturalSurfacePatchPlan(withArea('gm', -5000), { ...request, variationMm: 0 }), second = buildNaturalSurfacePatchPlan(withArea('gm', 2000), { ...request, variationMm: 0 })
    expect(first.commands).toEqual(second.commands); expect(first.dependencyIds).not.toContain('neighbor')
    const publicPlan = buildNaturalSurfacePatchPlan(withArea('public', -5000), { ...request, variationMm: 0 })
    expect(publicPlan.dependencyIds).toContain('neighbor')
    expect(styleCommand(publicPlan).style!.overlays.slice(1).every(overlay => overlay.boundaryMm.every(point => point.x >= -3000))).toBe(true)
    const privateTarget = cloneJson(project); privateTarget.document.terrainAreas[areaId].visibility = 'gm'
    expect(() => buildNaturalSurfacePatchPlan(privateTarget, request)).toThrow(/公开/)
    const document = applyCommands(project.document, [
      { type: 'createTerrainArea', id: 'upper', floorId, layerId, boundaryMm: rect(0, -2000, 6000, 4000), groundElevationMm: 1000, coveragePriority: 2 },
      { type: 'createTerrainConnection', id: 'real-stair', floorId, layerId, kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: areaId }, positionMm: { x: -3000, y: 0 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'upper' }, positionMm: { x: 2000, y: 0 } }, widthMm: 1000, movementCostMultiplier: 1, blocksMovement: false, visibility: 'public', openingId: null },
    ], runtime)
    const connected = createCompositionContent(document, runtime), connectionPlan = buildNaturalSurfacePatchPlan(connected, { ...request, regionsMm: [rect(-5000, -1000, 4000, 2000)], variationMm: 0 })
    expect(connectionPlan.dependencyIds).toContain('real-stair')
    expect(styleCommand(connectionPlan).style!.overlays.slice(1).every(overlay => !polygonsOverlap(overlay.boundaryMm, connectionFootprint(document.terrainConnections['real-stair'])))).toBe(true)
  })
})
