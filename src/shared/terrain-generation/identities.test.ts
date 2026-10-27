import { describe, expect, it } from 'vitest'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { advanceHistoryIdentity, createHistoryIdentity, createHistoryIdentityTrace, mergeIdentityRecords,
  validateHistoryIdentity, validateHistoryIdentityShape } from '../history/identity.js'
import type { HistoryIdentity } from '../model/history.js'
import type { MaterialPaint, SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { cloneJson } from '../validation/json.js'
import { emptyVisualSystem, type VisualSystem } from '../visual/types.js'
import { createEmptyGeneration, createEmptyRegional, type ExtendedIdentityToken, type GenerationSystem1,
  type RegionalModel1, type VisualSystem2 } from './contracts.js'
import { extendedIdentityDescriptors } from './identities.js'
import { generationInputHash, managedOutputHash, materializedBoundaryHash } from './integrity.js'

const stamp = '2026-10-26T00:00:00.000Z', hash = 'a'.repeat(64)
const p = (x: number, y: number) => ({ x, y })
const common = { floorId: 'floor', layerId: 'layer', visibility: 'public' as const, editLocked: false }
const square = () => [p(4000, 4000), p(7000, 4000), p(7000, 7000), p(4000, 7000)]
let sequence = 0
const context = (): PreparationContext => ({ ids: { nextId: () => `identity-test-${++sequence}` }, clock: { now: () => stamp } })
type TerrainScene = SceneDocument & { schemaVersion: 3; generation: GenerationSystem1; visual: VisualSystem2<VisualSystem> }

function blank(): TerrainScene {
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  return { format: 'sceneweave-scene', schemaVersion: 3, sceneId: 'identity-scene', revision: 0, title: 'Identity fixture',
    createdAt: stamp, updatedAt: stamp, units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false },
    exportBoundsMm: bounds, floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } },
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {},
    terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {},
    styleThemes: {}, activeStyleThemeRef: null, userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] }, mapMode: 'scene', generation: createEmptyGeneration(),
    regional: null, visual: { version: 2, base: emptyVisualSystem(), materializedEdges: {} } }
}
function addLand(scene: TerrainScene) {
  scene.terrainAreas.land = { id: 'land', floorId: 'floor', visibility: 'public', editLocked: false,
    boundaryMm: [p(2000, 2000), p(22000, 2000), p(22000, 16000), p(2000, 16000)]
      .map((positionMm, i) => ({ id: `land-point-${i}`, segmentId: `land-segment-${i}`, positionMm })),
    groundElevationMm: 300, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.entityLayers.land = 'layer'
}
function refresh(scene: TerrainScene) {
  for (const rule of Object.values(scene.generation.rules)) {
    rule.inputHash = generationInputHash(scene, rule); rule.managedOutputHash = managedOutputHash(scene, rule)
  }
}
function generated(): TerrainScene {
  const scene = blank(); addLand(scene)
  const g = scene.generation
  g.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'island', algorithmVersion: 1, mapMode: 'scene', seed: 'identity',
    parameters: { terrainKind: 'island', seaElevationMm: 0, landElevationMm: 300, plateauElevationMm: 1800, roughness: .2, densityFactor: .2, baySide: 'south' },
    materials: [], props: [], precision: { sampleSpacingMm: 2000, toleranceMm: 50, noiseCellMm: 4000 } }
  g.intents.intent = { id: 'intent', floorId: 'floor', visibility: 'public', boundsMm: scene.exportBoundsMm,
    skeleton: [{ id: 'skeleton', kind: 'landmass', positionMm: p(12000, 9000), radiusMm: 6000, directionDeg: 0 }], constraintIds: ['port'], preserveIds: [] }
  const target = { kind: 'terrainArea' as const, entityId: 'land', parentId: null, fieldGroup: 'geometry' as const }
  g.rules.rule = { ...common, id: 'rule', kind: 'terrain', recipeRef: { id: 'recipe', version: 1 }, inputs: [], outputs: [target],
    parameters: { widthMm: 100, minWidthMm: 100, maxWidthMm: 300, roughness: .2, densityFactor: .2 }, state: 'active', inputHash: hash, managedOutputHash: hash }
  g.ownership.owner = { id: 'owner', outputKey: 'generated/land', ruleId: 'rule', target, managedFields: ['geometry'], manualFields: [], state: 'managed', birthToken: 'land-output-birth' }
  g.exclusions.exclusion = { id: 'exclusion', key: 'exclude-1', floorId: 'floor', visibility: 'public', boundaryMm: square(), reason: 'manual', candidateKey: null, birthToken: null }
  g.constraints.port = { id: 'port', floorId: 'floor', visibility: 'public', strength: 'hard', kind: 'port', positionMm: p(2000, 6000), directionDeg: 0, widthMm: 1500 }
  g.checks.check = { id: 'check', constraintId: 'port', state: 'unchecked', algorithmId: 'port-check', algorithmVersion: 1, inputHash: hash, issues: [] }
  g.sourceLinks.source = { id: 'source', sourceSceneId: 'parent', sourceRevision: 2, sourceContentHash: hash, selectionMm: scene.exportBoundsMm,
    translationMm: p(0, 0), publicInputHash: hash, recipeRefs: [{ id: 'recipe', version: 1 }],
    inherited: [{ id: 'source-feature', kind: 'line', sourceEntityId: 'parent-river', visibility: 'public', pointsMm: [p(0, 5000), p(24000, 5000)],
      terrainKind: 'river', widthMm: 1000, elevationMm: null, precisionMm: 1000, estimated: true }] }
  refresh(scene)
  return scene
}
function addAsset(scene: SceneDocument) {
  scene.assets.texture = { id: 'texture', sha256: hash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1,
    logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'original', origin: { kind: 'original', attribution: 'identity test', canEmbed: true } }
}
function presentation(): TerrainScene {
  const scene = blank(); addLand(scene); addAsset(scene)
  scene.materials.material = { id: 'material', catalogId: 'materials', version: 1, name: 'Ground', tags: [], licenseRef: 'original',
    origin: { kind: 'original', attribution: 'identity test', canEmbed: true }, textureAssetId: 'texture', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain', 'room'] }
  const paint: MaterialPaint = { materialRef: { id: 'material', version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }
  scene.terrainAreas.land.surfaceStyle = { base: paint, overlays: [{ id: 'overlay', boundaryMm: square(), paint: cloneJson(paint), blendWidthMm: 100, renderOrder: 0 }] }
  const boundary = { ...common, id: 'boundary', closed: false,
    segments: [{ id: 'curve-segment', start: p(2000, 2000), control1: p(7000, 2000), control2: p(17000, 2000), end: p(22000, 2000) }],
    sampleSpacingMm: 2000, toleranceMm: 50, binding: { kind: 'decoration' as const } }
  scene.visual.base.boundaries.boundary = boundary
  scene.visual.materializedEdges.edge = { ...common, id: 'edge', boundaryId: 'boundary', inputHash: materializedBoundaryHash(boundary), kind: 'shore',
    polygons: [square()], strokes: [{ id: 'stroke', pointsMm: [p(3000, 3000), p(7000, 3000)], widthMm: 100, color: '#DDCCAA', opacity: 1 }],
    materialRef: null, fillColor: '#DDCCAA', opacity: 1 }
  return scene
}
function regional(): TerrainScene & { regional: RegionalModel1 } {
  const scene = { ...blank(), mapMode: 'regional' as const, regional: createEmptyRegional() }; addAsset(scene)
  const r = scene.regional, style = { fill: '#88AA88', stroke: '#224422', strokeWidthMm: 100, opacity: 1 }
  r.areas.area = { ...common, id: 'area', boundaryMm: square(), kind: 'forest', style, relativeElevationMm: null }
  r.lines.line = { ...common, id: 'line', pointsMm: [p(1000, 1000), p(5000, 2000), p(9000, 3000)].map((positionMm, i) => ({ id: `regional-point-${i}`, positionMm })),
    kind: 'river', displayWidthMm: 500, actualWidthMm: 300, portIds: [], connectedLineIds: [], flow: 'forward', style: cloneJson(style) }
  r.symbolDefinitions.definition = { id: 'definition', catalogId: 'symbols', version: 1, name: 'Map symbol', assetId: 'texture', licenseRef: 'original',
    origin: { kind: 'original', attribution: 'identity test', canEmbed: true }, visualBoundsMm: { x: -500, y: -1000, width: 1000, height: 1000 }, rootAnchorMm: p(0, 0), orientation: 'upright' }
  r.landmarks.landmark = { ...common, id: 'landmark', positionMm: p(5000, 5000), purpose: 'natural', name: 'Landmark', description: '', definitionRef: { id: 'definition', version: 1 }, areaId: 'area' }
  r.symbols.symbol = { ...common, id: 'symbol', definitionRef: { id: 'definition', version: 1 }, positionMm: p(5000, 5000), visualBoundsMm: { x: -500, y: -1000, width: 1000, height: 1000 },
    orientation: 'upright', renderOrder: 0, managementKey: null, sourceRef: { kind: 'landmark', id: 'landmark' } }
  return scene
}
const token = (kind: ExtendedIdentityToken['kind'], key: string): ExtendedIdentityToken => ({ kind, token: `${key}-birth`, topologyToken: `${key}-topology`, topologyHash: hash })

describe('terrain identity2 births and topology continuity', () => {
  it('allocates every generated record, skeleton and inherited feature with its correct kind', () => {
    const scene = generated(), identity = createHistoryIdentity(scene, context())
    expect(identity.version).toBe(2)
    expect(Object.fromEntries(Object.entries(identity.generationTokens!).map(([id, value]) => [id, value.kind]))).toEqual({
      recipe: 'generationRecipe', intent: 'generationIntent', skeleton: 'generationSkeleton', rule: 'generationRule', owner: 'outputOwnership',
      exclusion: 'generationExclusion', port: 'terrainConstraint', check: 'constraintCheck', source: 'sourceRegionLink', 'source-feature': 'sourceRegionFeature' })
    for (const id of ['skeleton', 'source-feature']) {
      const missing = cloneJson(identity); delete missing.generationTokens![id]
      expect(() => validateHistoryIdentity(missing, scene)).toThrow(/缺少出生/)
    }
  })

  it('allocates regional control points and materialized strokes rather than treating them as anonymous geometry', () => {
    const region = regional(), regionIdentity = createHistoryIdentity(region, context())
    expect(Object.keys(regionIdentity.regionalTokens!).sort()).toEqual(['area', 'landmark', 'line', 'regional-point-0', 'regional-point-1', 'regional-point-2', 'symbol'])
    expect(regionIdentity.regionalTokens!['regional-point-1'].kind).toBe('regionalPoint')
    const scene = presentation(), identity = createHistoryIdentity(scene, context())
    expect(identity.presentationTokens).toMatchObject({ overlay: { kind: 'surfaceOverlay' }, edge: { kind: 'materializedEdge' }, stroke: { kind: 'materializedStroke' } })
    delete identity.presentationTokens!.stroke
    expect(() => validateHistoryIdentity(identity, scene)).toThrow(/stroke/)
  })

  it('retains continuity for coordinates, style, density and check status rather than mistaking them for topology', () => {
    const before = generated(), after = cloneJson(before), identity = createHistoryIdentity(before, context())
    after.generation.intents.intent.skeleton[0].positionMm.x += 100
    after.generation.recipes.recipe.parameters.densityFactor = .4
    after.generation.rules.rule.parameters.widthMm += 50
    after.generation.constraints.port = { ...after.generation.constraints.port, visibility: 'gm' }
    refresh(after)
    expect(advanceHistoryIdentity(identity, before, after, context()).generationTokens).toEqual(identity.generationTokens)
    const source = presentation(), moved = cloneJson(source), sourceIdentity = createHistoryIdentity(source, context())
    moved.terrainAreas.land.surfaceStyle!.overlays[0].boundaryMm[0].x += 100
    moved.visual.materializedEdges.edge.strokes[0].widthMm = 200
    moved.visual.materializedEdges.edge.fillColor = '#AABBCC'
    expect(advanceHistoryIdentity(sourceIdentity, source, moved, context()).presentationTokens).toEqual(sourceIdentity.presentationTokens)
  })

  it.each(['recipe', 'inputs', 'outputs'] as const)('rotates rule continuity when its %s relation changes', change => {
    const before = generated(), after = cloneJson(before), identity = createHistoryIdentity(before, context()), rule = after.generation.rules.rule
    if (change === 'recipe') {
      after.generation.recipes.alternate = { ...cloneJson(after.generation.recipes.recipe), id: 'alternate' }
      rule.recipeRef = { id: 'alternate', version: 1 }
    } else if (change === 'inputs') rule.inputs = [{ kind: 'terrainArea', entityId: 'land', parentId: null, fieldGroup: 'properties' }]
    else {
      rule.outputs[0].fieldGroup = 'surface'; after.generation.ownership.owner.target.fieldGroup = 'surface'
      after.generation.ownership.owner.managedFields = ['surface']
    }
    refresh(after)
    const next = advanceHistoryIdentity(identity, before, after, context()).generationTokens!.rule
    expect(next.token).toBe(identity.generationTokens!.rule.token)
    expect(next.topologyHash).not.toBe(identity.generationTokens!.rule.topologyHash)
    expect(next.topologyToken).not.toBe(identity.generationTokens!.rule.topologyToken)
  })

  it('captures descriptors before a caller mutates the same draft and does not restore a token after change-back', () => {
    const scene = generated(), identity = createHistoryIdentity(scene, context()), original = cloneJson(scene.generation.rules.rule.inputs)
    const trace = createHistoryIdentityTrace(identity, scene, context())
    scene.generation.rules.rule.inputs = [{ kind: 'terrainArea', entityId: 'land', parentId: null, fieldGroup: 'properties' }]
    refresh(scene); trace.observe(scene)
    scene.generation.rules.rule.inputs = original; refresh(scene)
    const next = trace.finish(scene).generationTokens!.rule
    expect(next.topologyHash).toBe(identity.generationTokens!.rule.topologyHash)
    expect(next.topologyToken).not.toBe(identity.generationTokens!.rule.topologyToken)
    expect(next.token).toBe(identity.generationTokens!.rule.token)
    scene.sceneId = 'different-scene'
    expect(() => trace.observe(scene)).toThrow(/同一场景/)
  })

  it('treats unordered rule inputs consistently while keeping point order significant', () => {
    const a = generated(), b = cloneJson(a)
    const inputs = [{ kind: 'terrainArea' as const, entityId: 'land', parentId: null, fieldGroup: 'properties' as const },
      { kind: 'terrainArea' as const, entityId: 'land', parentId: null, fieldGroup: 'appearance' as const }]
    a.generation.rules.rule.inputs = inputs; b.generation.rules.rule.inputs = [...inputs].reverse()
    expect(extendedIdentityDescriptors(a).rule).toEqual(extendedIdentityDescriptors(b).rule)
    const source = regional(), changed = cloneJson(source), identity = createHistoryIdentity(source, context())
    changed.regional.lines.line.pointsMm.reverse()
    const next = advanceHistoryIdentity(identity, source, changed, context())
    expect(next.regionalTokens!.line.topologyToken).not.toBe(identity.regionalTokens!.line.topologyToken)
    expect(next.regionalTokens!['regional-point-0'].topologyToken).not.toBe(identity.regionalTokens!['regional-point-0'].topologyToken)
  })

  it('retains nested tombstones and requires explicit historical resurrection with fresh topology', () => {
    const before = regional(), after = cloneJson(before), identity = createHistoryIdentity(before, context())
    after.regional.lines.line.pointsMm.splice(1, 1)
    const deleted = advanceHistoryIdentity(identity, before, after, context())
    expect(deleted.regionalTokens!['regional-point-1']).toEqual(identity.regionalTokens!['regional-point-1'])
    expect(() => advanceHistoryIdentity(deleted, after, before, context())).toThrow(/不能复用/)
    const restored = advanceHistoryIdentity(deleted, after, before, context(), { allowResurrection: true })
    expect(restored.regionalTokens!['regional-point-1'].token).toBe(identity.regionalTokens!['regional-point-1'].token)
    expect(restored.regionalTokens!['regional-point-1'].topologyToken).not.toBe(identity.regionalTokens!['regional-point-1'].topologyToken)
  })

  it('rotates nested overlay and stroke topology on change-back through one trace', () => {
    const before = presentation(), changed = cloneJson(before), identity = createHistoryIdentity(before, context())
    changed.terrainAreas.land.surfaceStyle!.overlays[0].boundaryMm.splice(1, 0, p(5500, 4000))
    changed.visual.materializedEdges.edge.strokes[0].pointsMm.splice(1, 0, p(5000, 3000))
    const trace = createHistoryIdentityTrace(identity, before, context()); trace.observe(changed)
    const next = trace.finish(before)
    for (const id of ['overlay', 'edge', 'stroke']) {
      expect(next.presentationTokens![id].topologyHash).toBe(identity.presentationTokens![id].topologyHash)
      expect(next.presentationTokens![id].topologyToken).not.toBe(identity.presentationTokens![id].topologyToken)
    }
  })

  it('observes base setOverlayBoundary commands that previously bypassed the outdoor-only observer', () => {
    const source = createCompositionContent(presentation(), context()), ring = source.document.terrainAreas.land.surfaceStyle!.overlays[0].boundaryMm
    const changed = cloneJson(ring); changed.splice(1, 0, p(5500, 4000))
    const result = applyCompositionCommands(source, [
      { type: 'setOverlayBoundary', kind: 'terrainArea', id: 'land', overlayId: 'overlay', boundaryMm: changed },
      { type: 'setOverlayBoundary', kind: 'terrainArea', id: 'land', overlayId: 'overlay', boundaryMm: ring },
    ], context())
    expect(result.document.terrainAreas.land.surfaceStyle!.overlays[0].boundaryMm).toEqual(ring)
    expect(result.historyIdentity.presentationTokens!.overlay.topologyHash).toBe(source.historyIdentity.presentationTokens!.overlay.topologyHash)
    expect(result.historyIdentity.presentationTokens!.overlay.topologyToken).not.toBe(source.historyIdentity.presentationTokens!.overlay.topologyToken)
  })

  it('rejects changing the kind of an allocated ID even with resurrection enabled', () => {
    const before = generated(), after = cloneJson(before), identity = createHistoryIdentity(before, context())
    delete after.generation.exclusions.exclusion
    after.generation.constraints.exclusion = { ...cloneJson(after.generation.constraints.port), id: 'exclusion' }
    expect(() => advanceHistoryIdentity(identity, before, after, context(), { allowResurrection: true })).toThrow(/不能复用/)
  })

  it('checks tombstone collisions in both directions across the old and new identity pools', () => {
    const before = blank(), identity = createHistoryIdentity(before, context())
    identity.propTokens.recipe = 'old-prop-birth'
    expect(() => advanceHistoryIdentity(identity, before, generated(), context())).toThrow(/已分配身份冲突/)
    const old = createHistoryIdentity(before, context()); old.generationTokens!.land = token('generationRule', 'old-rule')
    const after = blank(); addLand(after)
    expect(() => advanceHistoryIdentity(old, before, after, context())).toThrow(/已分配身份冲突/)
    old.generationTokens!.layer = token('generationRule', 'old-layer-rule')
    expect(() => validateHistoryIdentity(old, before)).toThrow(/地形ID与其他身份冲突/)
  })

  it('counts legacy, nested and deleted identities under the same global 65536 ceiling', () => {
    const identity = createHistoryIdentity(blank(), context())
    identity.propTokens = Object.fromEntries(Array.from({ length: 65535 }, (_, i) => [`deleted-${i}`, `deleted-birth-${i}`]))
    identity.regionalTokens!['deleted-point'] = token('regionalPoint', 'point')
    expect(() => validateHistoryIdentityShape(identity)).not.toThrow()
    identity.presentationTokens!['deleted-stroke'] = token('materializedStroke', 'stroke')
    expect(() => validateHistoryIdentityShape(identity)).toThrow(/65536/)
  }, 10000)

  it('rejects cross-pool token reuse, duplicate IDs and a record in the wrong identity pool', () => {
    const identity = createHistoryIdentity(blank(), context())
    identity.propTokens.old = 'same-birth'
    identity.presentationTokens!.stroke = { ...token('materializedStroke', 'stroke'), token: 'same-birth' }
    expect(() => validateHistoryIdentityShape(identity)).toThrow(/全局唯一/)
    identity.presentationTokens!.stroke = token('materializedStroke', 'stroke')
    identity.generationTokens!.stroke = token('generationRule', 'rule')
    expect(() => validateHistoryIdentityShape(identity)).toThrow(/ID重复/)
    delete identity.generationTokens!.stroke
    identity.generationTokens!.wrong = token('regionalPoint', 'wrong')
    expect(() => validateHistoryIdentityShape(identity)).toThrow(/字段/)
  })

  it('merges tombstones while retaining current topology and rejects birth kind or hash substitution', () => {
    const current = createHistoryIdentity(generated(), context()), historic = cloneJson(current)
    historic.generationTokens!.rule.topologyToken = 'historic-rule-topology'
    historic.presentationTokens!.deleted = token('materializedStroke', 'deleted')
    const merged = mergeIdentityRecords(current, [historic])
    expect(merged.generationTokens!.rule).toEqual(current.generationTokens!.rule)
    expect(merged.presentationTokens!.deleted).toEqual(historic.presentationTokens!.deleted)
    expect(current.presentationTokens!.deleted).toBeUndefined()
    const wrongKind = cloneJson(current); wrongKind.generationTokens!.rule.kind = 'generationIntent'
    expect(() => mergeIdentityRecords(current, [wrongKind])).toThrow(/新地形身份冲突/)
    const wrongHash = cloneJson(current); wrongHash.generationTokens!.rule.topologyHash = 'b'.repeat(64)
    expect(() => mergeIdentityRecords(current, [wrongHash])).toThrow(/新地形身份冲突/)
  })

  it('uses own-record lookup for prototype-like IDs', () => {
    const scene = blank()
    scene.generation.constraints['constructor' as string] = { id: 'constructor', floorId: 'floor', visibility: 'public', strength: 'hard', kind: 'port', positionMm: p(0, 0), directionDeg: 0, widthMm: 1000 }
    const identity: HistoryIdentity = createHistoryIdentity(scene, context())
    expect(Object.hasOwn(identity.generationTokens!, 'constructor')).toBe(true)
    expect(identity.generationTokens!['constructor' as string].kind).toBe('terrainConstraint')
    expect(() => validateHistoryIdentity(identity, scene)).not.toThrow()
  })
})
