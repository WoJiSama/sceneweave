import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../model/scene.js'
import { emptyVisualSystem } from '../visual/types.js'
import { createEmptyGeneration, type GenerationRule } from './contracts.js'
import { constraintInputHash, detachChangedOutputs, generationInputHash, managedOutputHash, materializedBoundaryHash,
  resolveGenerationTarget, validateTerrainContracts, type TerrainContractDocument } from './integrity.js'

const p = (x: number, y: number) => ({ x, y })
const native = (doc: TerrainContractDocument) => doc as unknown as SceneDocument
function fixture(): TerrainContractDocument {
  const doc: TerrainContractDocument = { format: 'sceneweave-scene', schemaVersion: 3, sceneId: 'scene', revision: 0, title: 'Terrain fixture',
    createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z', mapMode: 'scene',
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { x: 0, y: 0, width: 24000, height: 18000 },
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: { x: 0, y: 0, width: 24000, height: 18000 } } },
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {},
    terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original', gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] }, visual: { version: 2, base: emptyVisualSystem(), materializedEdges: {} },
    generation: createEmptyGeneration(), regional: null }
  doc.terrainAreas.land = { id: 'land', floorId: 'floor', visibility: 'public', editLocked: false,
    boundaryMm: [p(2000, 2000), p(22000, 2000), p(22000, 16000), p(2000, 16000)].map((positionMm, i) => ({ id: `point${i}`, segmentId: `segment${i}`, positionMm })),
    groundElevationMm: 300, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  doc.entityLayers.land = 'layer'
  doc.generation.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'island', algorithmVersion: 1, mapMode: 'scene', seed: 'test',
    parameters: { terrainKind: 'island', seaElevationMm: 0, landElevationMm: 300, plateauElevationMm: 1800, roughness: .2, densityFactor: .2, baySide: 'south' },
    materials: [], props: [], precision: { sampleSpacingMm: 2000, toleranceMm: 20, noiseCellMm: 4000 } }
  const target = { kind: 'terrainArea' as const, entityId: 'land', parentId: null, fieldGroup: 'geometry' as const }
  const rule: GenerationRule = { id: 'land-rule', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false, kind: 'terrain',
    recipeRef: { id: 'recipe', version: 1 }, inputs: [], outputs: [target], parameters: { widthMm: 100, minWidthMm: 100, maxWidthMm: 200, roughness: .2, densityFactor: .2 },
    state: 'active', inputHash: '', managedOutputHash: '' }
  doc.generation.rules[rule.id] = rule
  doc.generation.ownership.owner = { id: 'owner', outputKey: 'land-output', ruleId: rule.id, target, managedFields: ['geometry'], manualFields: [], state: 'managed', birthToken: 'owner-birth' }
  rule.inputHash = generationInputHash(native(doc), rule); rule.managedOutputHash = managedOutputHash(native(doc), rule)
  return doc
}

describe('terrain persisted integrity', () => {
  it('resolves only the explicitly managed field group and rejects mismatched persisted hashes', () => {
    const doc = fixture(), rule = doc.generation.rules['land-rule']
    expect(validateTerrainContracts(native(doc))).toEqual([])
    const value = resolveGenerationTarget(native(doc), rule.outputs[0])!
    expect(value).toHaveProperty('boundaryMm'); expect(value).not.toHaveProperty('visibility')
    doc.terrainAreas.land.boundaryMm[0].positionMm.x += 100
    expect(validateTerrainContracts(native(doc)).some(issue => issue.code === 'TERRAIN_OUTPUT_HASH')).toBe(true)
  })
  it('preserves manual geometry, pauses the generator, invalidates evidence and counts actual metadata edits', () => {
    const before = fixture()
    before.generation.constraints.activity = { id: 'activity', floorId: 'floor', visibility: 'public', strength: 'hard', kind: 'activityArea',
      boundaryMm: [p(4000, 4000), p(6000, 4000), p(6000, 6000), p(4000, 6000)], clearanceMm: 500 }
    before.generation.checks.check = { id: 'check', constraintId: 'activity', state: 'passed', algorithmId: 'clearance', algorithmVersion: 1,
      inputHash: constraintInputHash(native(before), 'activity'), issues: [] }
    const after = structuredClone(before); after.terrainAreas.land.boundaryMm[0].positionMm.x += 100
    expect(detachChangedOutputs(native(before), native(after))).toBe(3)
    expect(after.generation.ownership.owner).toMatchObject({ state: 'manual', managedFields: [], manualFields: ['geometry'] })
    expect(after.generation.rules['land-rule'].state).toBe('paused'); expect(after.generation.checks.check.state).toBe('unchecked')
    expect(after.terrainAreas.land.boundaryMm[0].positionMm.x).toBe(2100)
    expect(validateTerrainContracts(native(after))).toEqual([])
  })
  it('keeps deleted ownership tombstones without recreating entities', () => {
    const before = fixture(), after = structuredClone(before)
    delete after.terrainAreas.land; delete after.entityLayers.land
    expect(detachChangedOutputs(native(before), native(after))).toBe(2)
    expect(after.generation.ownership.owner.state).toBe('deleted')
    expect(validateTerrainContracts(native(after))).toEqual([])
  })
  it('rejects unresolved references, duplicate identity, missing fixed versions and invalid polygons', () => {
    const duplicate = fixture(); duplicate.generation.recipes.recipe.id = 'floor'
    expect(validateTerrainContracts(native(duplicate)).some(issue => issue.code === 'TERRAIN_ID_CONFLICT')).toBe(true)
    const definition = fixture(); definition.generation.recipes.recipe.props.push({ role: 'tree', ref: { id: 'missing', version: 1 } })
    expect(validateTerrainContracts(native(definition)).some(issue => issue.code === 'TERRAIN_DEFINITION')).toBe(true)
    const bad = fixture(); bad.generation.exclusions.exclusion = { id: 'exclusion', key: 'exclude', floorId: 'floor', visibility: 'public',
      boundaryMm: [p(0, 0), p(2000, 2000), p(0, 2000), p(2000, 0)], reason: 'manual', candidateKey: null, birthToken: null }
    expect(validateTerrainContracts(native(bad)).some(issue => issue.code === 'TERRAIN_POLYGON')).toBe(true)
  })
  it('never repairs stale materialized geometry while detaching manual managed outputs', () => {
    const before = fixture(), base = before.visual.base
    base.boundaries.boundary = { id: 'boundary', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false, closed: false,
      segments: [{ id: 'curve-segment', start: p(2000, 2000), control1: p(7000, 2000), control2: p(17000, 2000), end: p(22000, 2000) }],
      sampleSpacingMm: 2000, toleranceMm: 50, binding: { kind: 'decoration' } }
    before.visual.materializedEdges.edge = { id: 'edge', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false,
      boundaryId: 'boundary', inputHash: materializedBoundaryHash(base.boundaries.boundary), kind: 'shore', polygons: [[p(2000, 2000), p(22000, 2000), p(22000, 2200), p(2000, 2200)]],
      strokes: [], materialRef: null, fillColor: '#DDCCAA', opacity: 1 }
    expect(validateTerrainContracts(native(before))).toEqual([])
    const after = structuredClone(before); after.visual.base.boundaries.boundary.segments[0].control1.y += 100
    detachChangedOutputs(native(before), native(after))
    expect(after.visual.materializedEdges.edge).toEqual(before.visual.materializedEdges.edge)
    expect(validateTerrainContracts(native(after)).some(issue => issue.code === 'TERRAIN_EDGE_SOURCE')).toBe(true)
  })
})
