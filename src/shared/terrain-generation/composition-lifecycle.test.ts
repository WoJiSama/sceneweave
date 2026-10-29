import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../model/scene.js'
import type { CompositionContent } from '../model/appearance.js'
import { createAppearanceGraph } from '../appearance/graph.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { advanceHistoryIdentity, createHistoryIdentity } from '../history/identity.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateCompositionContent } from '../validation/content.js'
import { sha256Text } from '../geometry/scatter.js'
import { emptyVisualSystem } from '../visual/types.js'
import { createMemoryResources } from '../project/resources.js'
import { fromBundle } from '../../application/workspace/project.js'
import { materializeProject } from '../../application/workspace/prepare.js'
import { validation } from '../../application/workspace/test-fixtures.js'
import { symbolPropV3 } from '../../core/v3/test-fixtures.js'
import { createEmptyGeneration5, type GenerationSystem5, type VisualSystem3 } from './composition-contracts.js'
import type { TerrainCompositionReference } from './composition-integrity.js'
import { compositionInputHash, compositionOutputHash, dependencyInputHash, resolveCompositionTarget, terrainRequirementInputHash, thresholdInputHash } from './composition-integrity.js'
import { pauseChangedCompositionAppearance, pauseChangedCompositions } from './composition-lifecycle.js'
import { planTerrainComposition } from './composition-field.js'
import { evaluateTerrainRequirement } from './composition-requirements.js'

const stamp = '2026-10-29T00:00:00.000Z', blankHash = '0'.repeat(64)
let sequence = 0
const context = { ids: { nextId: () => `lifecycle-${++sequence}` }, clock: { now: () => stamp } }
type Scene4 = SceneDocument & { schemaVersion: 4; generation: GenerationSystem5; visual: VisualSystem3 }
function fixture(options: { hard?: boolean; propOutput?: boolean; threshold?: boolean } = {}): CompositionContent & { document: Scene4 } {
  const bounds = { x: 0, y: 0, width: 12000, height: 12000 }
  const scene: Scene4 = { format: 'sceneweave-scene', schemaVersion: 4, sceneId: 'lifecycle-scene', revision: 0, title: 'Composition lifecycle', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {},
    terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    presetSnapshot: { presetId: 'fixture', presetVersion: 1, distanceMode: 'metric', source: 'Original test fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] },
    mapMode: 'scene', regional: null, generation: createEmptyGeneration5(), visual: { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} } }
  const generation = scene.generation, precision = { sampleSpacingMm: 2000, toleranceMm: 100, noiseCellMm: 2000 }
  generation.features.feature = { id: 'feature', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false, kind: 'landmass', shape: { kind: 'ellipse', centerMm: { x: 6000, y: 6000 }, radiusXMm: 4000, radiusYMm: 3000, rotationMilliDeg: 0 }, elevationMm: 500, roughnessPpm: 0, seedKey: 'stable-feature' }
  generation.legacy.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'terrain-compose', algorithmVersion: 1, mapMode: 'scene', seed: 'strict', parameters: { terrainKind: 'mixed', seaElevationMm: 0, landElevationMm: 500, plateauElevationMm: 1000, roughness: 0, densityFactor: 0, baySide: 'west' }, materials: [], props: [], precision }
  scene.terrainAreas.land = { id: 'land', floorId: 'floor', editLocked: false, visibility: 'public', boundaryMm: [{ x: 2000, y: 2000 }, { x: 10000, y: 2000 }, { x: 10000, y: 10000 }, { x: 2000, y: 10000 }].map((positionMm, i) => ({ id: `land-p${i}`, segmentId: `land-s${i}`, positionMm })), groundElevationMm: 500, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.entityLayers.land = 'layer'
  scene.props.item = { ...symbolPropV3('item', 1000, 1000), floorId: 'floor', supportRef: { kind: 'floor', id: 'floor' } }; scene.entityLayers.item = 'layer'
  const outputRefs: TerrainCompositionReference[] = [{ kind: 'terrainArea', entityId: 'land', parentId: null, fieldGroup: 'geometry' }]
  if (options.propOutput) outputRefs.push({ kind: 'prop', entityId: 'item', parentId: null, fieldGroup: 'appearance' })
  const row = generation.compositions.composition = { id: 'composition', floorId: 'floor', layerId: 'layer', visibility: 'public' as const, editLocked: false, recipeRef: { id: 'recipe', version: 1 }, seed: 'strict', boundsMm: cloneJson(bounds), algorithmId: 'terrain-compose' as const, algorithmVersion: 1 as const, precision, baseElevationMm: 500, members: [{ featureId: 'feature', field: 'land' as const, operation: 'add' as const, weightPpm: 1000000 }], thresholdIds: [] as string[], requirementIds: [] as string[], outputRefs, state: 'active' as 'active' | 'paused' | 'detached', inputHash: blankHash, outputHash: blankHash }
  if (options.hard !== false) {
    row.requirementIds.push('requirement')
    const requirement = generation.requirements.requirement = { id: 'requirement', compositionId: row.id, kind: 'componentCount', surface: 'land', excludeBoundaryTouching: false, expected: 1, strength: 'hard' }
    generation.checks.check = { id: 'check', requirementId: requirement.id, algorithmId: 'terrain-requirement', algorithmVersion: 1, ...evaluateTerrainRequirement(scene, requirement), inputHash: terrainRequirementInputHash(scene, requirement) }
  }
  if (options.threshold) {
    const plan = planTerrainComposition({ seed: row.seed, precision, boundsMm: bounds, baseElevationMm: 500, members: row.members, features: generation.features, landCoveragePpm: 400000, elevationCoveragePpm: 0 })
    generation.thresholds.threshold = { id: 'threshold', compositionId: row.id, ...plan.thresholds.land!, inputHash: blankHash }
    row.thresholdIds.push('threshold'); generation.thresholds.threshold.inputHash = thresholdInputHash(generation.thresholds.threshold)
  }
  generation.dependencies.dependency = { id: 'dependency', compositionId: row.id, featureIds: ['feature'], thresholdIds: [...row.thresholdIds], reads: [], writes: cloneJson(row.outputRefs), transitionIds: [], scopeMm: cloneJson(bounds), haloMm: 2000, algorithmId: 'terrain-dependencies', algorithmVersion: 1, inputHash: blankHash }
  refresh(scene)
  const historyIdentity = createHistoryIdentity(scene, context)
  row.outputHash = compositionOutputHash(scene, row, historyIdentity)
  return validateCompositionContent({ document: scene, historyIdentity, appearance: createAppearanceGraph(scene) }) as CompositionContent & { document: Scene4 }
}
function refresh(scene: Scene4): void {
  for (const row of Object.values(scene.generation.dependencies)) row.inputHash = dependencyInputHash(scene, row)
  for (const row of Object.values(scene.generation.compositions)) row.inputHash = compositionInputHash(scene, row)
}
function frozenReceipts(content: CompositionContent): unknown {
  const generation = (content.document as Scene4).generation, row = generation.compositions.composition
  return { members: row.members, thresholds: generation.thresholds, inputHash: row.inputHash, outputHash: row.outputHash, dependencies: generation.dependencies, checkInputHash: generation.checks.check?.inputHash }
}

describe('composition manual-edit lifecycle', () => {
  it('binds dependency receipts to complete transition rows, not only their IDs', () => {
    const content = fixture({ hard: false }), scene = content.document, dependency = scene.generation.dependencies.dependency
    if (scene.visual?.version !== 3) throw new Error('fixture')
    const transition = { id: 'transition', floorId: 'floor', layerId: 'layer', visibility: 'public' as const, editLocked: false, enabled: true,
      boundaryId: 'missing-boundary', kind: 'shore' as const, side: 'left' as const, leftSurface: 'sand' as const, rightSurface: 'water' as const,
      leftElevationMm: 500, rightElevationMm: 0, widthMm: 400, distanceSource: { algorithmId: 'terrain-distance' as const, algorithmVersion: 1 as const, metric: 'euclidean-mm' as const,
        boundaryHash: 'a'.repeat(64), clipMm: { x: 0, y: 0, width: 1000, height: 1000 }, reachMm: 400, sampleSpacingMm: 100, inputHash: 'b'.repeat(64) }, polygons: [{ id: 'polygon', pointsMm: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], fillColor: '#AABBCC', opacity: .5, materialRef: null }], strokes: [], inputHash: 'c'.repeat(64), outputHash: 'd'.repeat(64) }
    scene.visual.transitions.transition = transition
    dependency.transitionIds = ['transition']
    const before = dependencyInputHash(scene, dependency)
    scene.visual.transitions.transition.polygons[0].fillColor = '#CCDDEE'
    expect(dependencyInputHash(scene, dependency)).not.toBe(before)
  })
  it('pauses real managed edits and keeps every frozen source and receipt', () => {
    const before = fixture({ threshold: true }), next = cloneJson(before), receipts = canonicalJson(frozenReceipts(before))
    next.document.terrainAreas.land.groundElevationMm += 100
    expect(pauseChangedCompositions(before.document, next.document)).toBe(2)
    expect(next.document.generation.compositions.composition.state).toBe('paused')
    expect(next.document.generation.checks.check.state).toBe('unchecked')
    expect(canonicalJson(frozenReceipts(next))).toBe(receipts)
    expect(before.document.generation.compositions.composition.state).toBe('active')
    expect(pauseChangedCompositions(before.document, next.document)).toBe(0)
  })
  it('pauses properties and source changes even when only geometry is a declared output', () => {
    const before = fixture({ hard: false })
    for (const mutate of [(scene: Scene4) => { scene.terrainAreas.land.blocksSight = true }, (scene: Scene4) => { scene.terrainAreas.land.visibility = 'gm' }]) {
      const next = cloneJson(before); mutate(next.document)
      expect(pauseChangedCompositions(before.document, next.document)).toBe(1)
    }
  })
  it('pauses deleted outputs and does not invent a replacement or a new receipt', () => {
    const before = fixture(), next = cloneJson(before)
    delete next.document.terrainAreas.land; delete next.document.entityLayers.land
    pauseChangedCompositions(before.document, next.document)
    expect(next.document.generation.compositions.composition.outputRefs).toEqual(before.document.generation.compositions.composition.outputRefs)
    expect(next.document.generation.compositions.composition.state).toBe('paused')
    expect(() => validateCompositionContent({ ...next, historyIdentity: advanceHistoryIdentity(before.historyIdentity, before.document, next.document, context) })).not.toThrow()
  })
  it('compares actual preserve inputs while leaving adopted baseline snapshots frozen', () => {
    const before = fixture({ hard: false }), dependency = before.document.generation.dependencies.dependency
    const target: TerrainCompositionReference = { kind: 'prop', entityId: 'item', parentId: null, fieldGroup: 'geometry' }, snapshot = resolveCompositionTarget(before.document, target)!
    dependency.reads.push({ target, role: 'preserve', snapshot: cloneJson(snapshot), contentHash: sha256Text(canonicalJson(snapshot)) }); refresh(before.document)
    const next = cloneJson(before); next.document.props.item.positionMm.x += 100
    pauseChangedCompositions(before.document, next.document)
    expect(next.document.generation.compositions.composition.state).toBe('paused')
    expect(next.document.generation.dependencies).toEqual(before.document.generation.dependencies)
    const unrelated = fixture({ hard: false }), other = cloneJson(unrelated); other.document.props.item.positionMm.x += 100
    expect(pauseChangedCompositions(unrelated.document, other.document)).toBe(0)
  })
  it('invalidates broad hard-requirement receipts on their real shared inputs', () => {
    const before = fixture(), next = cloneJson(before); next.document.props.item.positionMm.x += 100
    pauseChangedCompositions(before.document, next.document)
    expect(next.document.generation.compositions.composition.state).toBe('paused')
    expect(next.document.generation.checks.check.state).toBe('unchecked')
  })
  it('does not compare adopted baseline snapshots to their later materialized outputs', () => {
    const before = fixture({ hard: false }), dependency = before.document.generation.dependencies.dependency, target = before.document.generation.compositions.composition.outputRefs[0]
    const snapshot = { ...cloneJson(resolveCompositionTarget(before.document, target)!), groundElevationMm: 300 }
    dependency.reads.push({ target, role: 'baseline', snapshot, contentHash: sha256Text(canonicalJson(snapshot)) }); refresh(before.document)
    const next = cloneJson(before)
    expect(pauseChangedCompositions(before.document, next.document)).toBe(0)
    expect(next.document.generation.dependencies.dependency.reads[0].snapshot).toEqual(snapshot)
    expect(next.document.generation.compositions.composition.state).toBe('active')
  })
  it('checks the implicit composition and layer locks before writing any metadata', () => {
    for (const layerLock of [false, true]) {
      const before = fixture()
      if (layerLock) before.document.userLayers.layer.editLocked = true
      else before.document.generation.compositions.composition.editLocked = true
      const next = cloneJson(before), metadata = canonicalJson(next.document.generation)
      next.document.terrainAreas.land.groundElevationMm += 100
      expect(() => pauseChangedCompositions(before.document, next.document)).toThrow(/锁定/)
      expect(canonicalJson(next.document.generation)).toBe(metadata)
    }
  })
  it('reconciles v4 scene commands and preserves the legacy wrapper', () => {
    const before = fixture(), next = applyCommands(before.document, [{ type: 'setTerrainElevation', id: 'land', groundElevationMm: 600 }], context) as Scene4
    expect(next.generation.version).toBe(5); expect(next.visual.version).toBe(3)
    expect(next.generation.legacy).toEqual(before.document.generation.legacy)
    expect(next.generation.compositions.composition.state).toBe('paused')
    expect(next.generation.compositions.composition.outputHash).toBe(before.document.generation.compositions.composition.outputHash)
  })
  it('charges changed-back edits and no-ops cumulatively without mutating its input', () => {
    const before = fixture(), original = canonicalJson(before)
    const commands: SceneCommand[] = Array.from({ length: 256 }, (_, i) => ({ type: 'setTerrainElevation', id: 'land', groundElevationMm: i === 0 ? 600 : 500 }))
    expect(() => applyCommands(before.document, commands, context)).toThrow(/256/)
    expect(() => applyCompositionDraftCommands(before, commands, context)).toThrow(/256/)
    expect(canonicalJson(before)).toBe(original)
    expect(applyCommands(before.document, Array.from({ length: 256 }, () => ({ type: 'setTerrainElevation', id: 'land', groundElevationMm: 500 })), context).generation?.version).toBe(5)
    const next = applyCompositionDraftCommands(before, [{ type: 'setTerrainElevation', id: 'land', groundElevationMm: 600 }], context)
    expect((next.document as Scene4).generation.compositions.composition.state).toBe('paused')
  })
  it('pauses effective graph changes before materializing their actual prop appearance', () => {
    const before = fixture({ propOutput: true }), original = canonicalJson(frozenReceipts(before))
    const next = applyCompositionDraftCommands(before, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'opacity', kind: 'opacity', enabled: true, value: .5 } }], context)
    expect((next.document as Scene4).generation.compositions.composition.state).toBe('paused')
    expect(canonicalJson(frozenReceipts(next))).toBe(original)
    expect(next.document.props.item.appearance.opacity).toBe(1)
    expect(() => applyCompositionDraftCommands(before, Array.from({ length: 256 }, () => ({ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'opacity', kind: 'opacity', enabled: true, value: .5 } })), context)).toThrow(/256/)
    expect(before.document.generation.compositions.composition.state).toBe('active')
  })
  it('detects a fixed appearance source replacement independently of effective adjustments', () => {
    const before = fixture({ propOutput: true }), next = cloneJson(before), oldId = next.appearance.propSources.item
    next.appearance.sources.alternate = { ...cloneJson(next.appearance.sources[oldId]), id: 'alternate', parentSourceId: oldId }
    next.appearance.propSources.item = 'alternate'
    expect(pauseChangedCompositionAppearance(before, next)).toBe(2)
    expect(next.document.generation.compositions.composition.state).toBe('paused')
  })
  it('materializes a raw v4 appearance draft only after pausing its stale active receipts', async () => {
    const content = fixture({ propOutput: true }), resources = createMemoryResources(new Map())
    const baseline = await fromBundle({ project: { format: 'sceneweave-complete-project', schemaVersion: 4, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources }, validation)
    const appearance = cloneJson(baseline.appearance)
    appearance.instanceAdjustments.item = [{ id: 'opacity', kind: 'opacity', enabled: true, value: .5 }]
    const next = await materializeProject({ ...baseline, appearance }, { validation, runtime: context, baseline })
    expect((next.document as Scene4).generation.compositions.composition.state).toBe('paused')
    expect(next.document.props.item.appearance.opacity).toBe(.5)
    expect(canonicalJson(frozenReceipts(next))).toBe(canonicalJson(frozenReceipts(baseline)))
    expect(baseline.document.props.item.appearance.opacity).toBe(1)
  })
  it('enforces the full v4 materialization budget on the derivation path', async () => {
    const content = fixture(), resources = createMemoryResources(new Map())
    const baseline = await fromBundle({ project: { format: 'sceneweave-complete-project', schemaVersion: 4, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources }, validation)
    const document = cloneJson(baseline.document)
    for (let i = 0; i < 140; i++) {
      const id = `additional-${i}`
      document.props[id] = { ...symbolPropV3(id, 1000, 1000), floorId: 'floor', supportRef: { kind: 'floor', id: 'floor' } }; document.entityLayers[id] = 'layer'
    }
    pauseChangedCompositions(baseline.document, document)
    const appearance = createAppearanceGraph(document)
    const historyIdentity = advanceHistoryIdentity(baseline.historyIdentity, baseline.document, document, context)
    await expect(materializeProject({ ...baseline, document, historyIdentity, appearance }, { validation, runtime: context, baseline })).rejects.toThrow(/256/)
    expect(Object.keys(baseline.document.props)).toEqual(['item'])
  })
})
