import { describe, expect, it } from 'vitest'
import { createTerrainVariantCatalogDocument, terrainVariantDefinitionId } from '../../platform/browser/content/terrain-variant-catalog.js'
import { createHistoryIdentity, advanceHistoryIdentity, surfaceRuleIdentityDescriptors } from '../history/identity.js'
import type { PreparationContext } from '../ports/runtime.js'
import type { SceneDocument, SceneDocument8 } from '../model/scene.js'
import { createEmptyGeneration } from '../terrain-generation/contracts.js'
import { createEmptyGeneration5 } from '../terrain-generation/composition-contracts.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import { cloneJson } from '../validation/json.js'
import { validateSceneDocument, sceneDocumentSchema } from '../validation/scene.js'
import { polygonBooleanWithHoles } from '../geometry/polygon-boolean.js'
import { emptyVisualSystem } from '../visual/types.js'

const p = (x: number, y: number) => ({ x, y })
const rect = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
let sequence = 0
const context = (): PreparationContext => ({ ids: { nextId: () => `surface-identity-${++sequence}` }, clock: { now: () => '2026-11-02T00:00:00.000Z' } })

function fixture(): SceneDocument8 {
  const source = createTerrainVariantCatalogDocument()
  source.schemaVersion = 1; source.mapMode = 'scene'; source.regional = null; source.generation = createEmptyGeneration5()
  source.visual = { version:3,base:{version:2,base:emptyVisualSystem(),materializedEdges:{}},transitions:{} }
  const scene = emptyCompositionDocument(source)
  scene.schemaVersion = 1
  scene.generation = createEmptyGeneration5()
  scene.visual = { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }
  scene.mapMode = 'scene'; scene.regional = null
  scene.decorations = {}; scene.decorationClusters = {}; scene.surfaceRules = {}
  const floor = Object.values(scene.floors)[0], layer = Object.values(scene.userLayers)[0]
  scene.terrainAreas.ground = { id: 'ground', floorId: floor.id, editLocked: false, visibility: 'public', boundaryMm: rect(1000, 1000, 18000, 16000).map((positionMm, index) => ({ id: `ground-point-${index}`, segmentId: `ground-segment-${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.entityLayers.ground = layer.id
  return scene as SceneDocument8
}

function addGrassRule(scene: SceneDocument8, id = 'grass-rule'): void {
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  const definition = scene.propDefinitions[terrainVariantDefinitionId('grass-sedge-fan')]
  scene.decorationClusters![`${id}-cluster`] = { id: `${id}-cluster`, floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: 'ground' },
    boundsMm: { x: 2000, y: 2000, width: 16000, height: 14000 }, seed: 'fixed-seed', algorithmVersion: 'cluster-v1', palette: [{ key: 'grass', definitionRef: { id: definition.id, version: 1 }, kind: 'decoration', weight: 1 }],
    maxInstances: 8, spacingMm: 200, clusterRadiusMm: 500, clearanceMm: 50, members: {} }
  scene.entityLayers[`${id}-cluster`] = layerId
  const regions = polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: rect(2000, 2000, 4000, 4000), holes: [] }], clip: [] }).polygons.map(row => ({ outerMm: row.outer, holesMm: row.holes }))
  scene.surfaceRules![id] = { id, floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: 'ground' }, field: 'grass', paintOrder: 1,
    regionsMm: regions, clusterId: `${id}-cluster`, coveragePpm: 350_000 }
  scene.entityLayers[id] = layerId
}

describe('strict v8 surface rules and identity5', () => {
  it('requires the complete current schema and rejects old envelopes or missing rules', () => {
    const current = fixture()
    expect(sceneDocumentSchema.safeParse(current).success).toBe(true)
    expect(validateSceneDocument({ ...current, schemaVersion: 7 })).toMatchObject({ok:false})
    const missing = cloneJson(current) as unknown as Record<string,unknown>
    delete missing.surfaceRules
    expect(sceneDocumentSchema.safeParse(missing).success).toBe(false)
    expect(sceneDocumentSchema.safeParse({...current,canopyRule:{}}).success).toBe(false)
  })

  it('validates rules against support, unique cluster ownership and polygon topology', () => {
    const scene = fixture(); addGrassRule(scene)
    expect(validateSceneDocument(scene).ok).toBe(true)
    const duplicate = cloneJson(scene)
    duplicate.surfaceRules!.duplicate = { ...cloneJson(duplicate.surfaceRules!['grass-rule']), id: 'duplicate', paintOrder: 2 }
    duplicate.entityLayers.duplicate = Object.keys(duplicate.userLayers)[0]
    expect(validateSceneDocument(duplicate)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'SURFACE_RULE_CLUSTER_OWNER' })]) })
    const outside = cloneJson(scene); outside.surfaceRules!['grass-rule'].regionsMm[0].outerMm = rect(19_000, 19_000, 2000, 2000)
    expect(validateSceneDocument(outside)).toMatchObject({ ok: false })
    const overlap = cloneJson(scene); overlap.surfaceRules!['grass-rule'].regionsMm.push({ outerMm: rect(3000, 3000, 2000, 2000), holesMm: [] })
    expect(validateSceneDocument(overlap)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'SURFACE_RULE_GEOMETRY' })]) })
  })

  it('allocates identity5 and preserves a rule token when geometry and coverage are edited', () => {
    const before = fixture(), after = cloneJson(before)
    addGrassRule(after)
    const first = advanceHistoryIdentity(createHistoryIdentity(before, context()), before, after, context())
    expect(first.version).toBe(5)
    const birth = first.surfaceRuleTokens!['grass-rule']
    const edited = cloneJson(after)
    const editedRule = edited.surfaceRules!['grass-rule']
    if (editedRule.field !== 'grass') throw new Error('expected grass rule')
    editedRule.coveragePpm = 710_000
    editedRule.regionsMm[0].outerMm[1].x += 300
    const second = advanceHistoryIdentity(first, after, edited, context())
    expect(second.surfaceRuleTokens!['grass-rule']).toEqual(birth)
    const changedTopology = cloneJson(edited)
    const changedRule = changedTopology.surfaceRules!['grass-rule']
    if (changedRule.field !== 'grass') throw new Error('expected grass rule')
    changedRule.clusterId = 'replacement'
    expect(surfaceRuleIdentityDescriptors(changedTopology)['grass-rule'].topologyHash).not.toBe(birth.topologyHash)
  })
})
