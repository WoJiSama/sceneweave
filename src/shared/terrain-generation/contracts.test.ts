import { describe, expect, it } from 'vitest'
import { createEmptyGeneration, createEmptyRegional, createVisual2Schema, generationSchema, regionalSchema,
  generationRecipeSchema, materializedEdgeSchema, presentationSchema, sourceRegionLinkSchema, type GenerationRecipe,
  type GenerationRule, type GenerationReference } from './contracts.js'
import { emptyVisualSystem } from '../visual/types.js'
import { visualSystemSchema } from '../visual/schema.js'

const hash = 'a'.repeat(64)
const p = (x: number, y: number) => ({ x, y })
const common = { floorId: 'floor', layerId: 'layer', visibility: 'public' as const, editLocked: false }
const ref = (entityId: string): GenerationReference => ({ kind: 'terrainArea', entityId, parentId: null, fieldGroup: 'geometry' })
function recipe(): GenerationRecipe {
  return { id: 'recipe', recipeVersion: 1, algorithmId: 'terrain-island', algorithmVersion: 1, mapMode: 'scene', seed: 'island-1',
    parameters: { terrainKind: 'island', seaElevationMm: 0, landElevationMm: 300, plateauElevationMm: 1800, roughness: .3,
      densityFactor: .2, baySide: 'south' }, materials: [], props: [], precision: { sampleSpacingMm: 2000, toleranceMm: 50, noiseCellMm: 4000 } }
}
function rule(id: string, inputs: GenerationReference[], outputs: GenerationReference[]): GenerationRule {
  return { ...common, id, kind: 'terrain', recipeRef: { id: 'recipe', version: 1 }, inputs, outputs,
    parameters: { widthMm: 100, minWidthMm: 100, maxWidthMm: 200, roughness: .2, densityFactor: .2 },
    state: 'active', inputHash: hash, managedOutputHash: hash }
}
function generated() {
  const value = createEmptyGeneration()
  value.recipes.recipe = recipe()
  value.rules.landRule = rule('landRule', [], [ref('land')])
  return value
}

describe('strict terrain persisted contracts', () => {
  it('has explicit independent empty structures and rejects unknown fields/versions', () => {
    const first = createEmptyGeneration(), second = createEmptyGeneration()
    expect(generationSchema.parse(first)).toEqual(first)
    first.recipes.recipe = recipe()
    expect(second.recipes).toEqual({})
    expect(generationSchema.safeParse({ ...second, version: 2 }).success).toBe(false)
    expect(generationSchema.safeParse({ ...second, runtime: {} }).success).toBe(false)
    expect(regionalSchema.safeParse({ ...createEmptyRegional(), mode: 'scene' }).success).toBe(false)
  })
  it('rejects record key mismatches, unsafe coordinates and unknown recipe parameter expansion', () => {
    const value = generated(); value.recipes.other = value.recipes.recipe
    expect(generationSchema.safeParse(value).success).toBe(false)
    expect(generationRecipeSchema.safeParse({ ...recipe(), precision: { sampleSpacingMm: 1.5, toleranceMm: 1, noiseCellMm: 2 } }).success).toBe(false)
    expect(generationRecipeSchema.safeParse({ ...recipe(), parameters: { ...recipe().parameters, script: 'draw()' } }).success).toBe(false)
    expect(generationRecipeSchema.safeParse({ ...recipe(), seed: '' }).success).toBe(false)
  })
  it('rejects a missing recipe, version drift, duplicate field writers and circular rules', () => {
    const missing = generated(); delete missing.recipes.recipe
    expect(generationSchema.safeParse(missing).success).toBe(false)
    const drift = generated(); drift.rules.landRule.recipeRef.version = 2
    expect(generationSchema.safeParse(drift).success).toBe(false)
    const duplicate = generated(); duplicate.rules.other = rule('other', [], [ref('land')])
    expect(generationSchema.safeParse(duplicate).success).toBe(false)
    const cycle = generated(); cycle.rules.landRule.inputs = [ref('plateau')]
    cycle.rules.plateauRule = rule('plateauRule', [ref('land')], [ref('plateau')])
    expect(generationSchema.safeParse(cycle).success).toBe(false)
    const valid = generated(); valid.rules.plateauRule = rule('plateauRule', [ref('land')], [ref('plateau')])
    expect(generationSchema.safeParse(valid).success).toBe(true)
  })
  it('keeps manual ownership disjoint and requires declared rules and constraints', () => {
    const value = generated()
    value.ownership.owner = { id: 'owner', outputKey: 'land', ruleId: 'landRule', target: ref('land'), managedFields: ['geometry'],
      manualFields: ['geometry'], state: 'manual', birthToken: 'birth' }
    expect(generationSchema.safeParse(value).success).toBe(false)
    value.ownership.owner.manualFields = ['appearance']
    expect(generationSchema.safeParse(value).success).toBe(true)
    value.ownership.owner.ruleId = 'absent'
    expect(generationSchema.safeParse(value).success).toBe(false)
    const missingCheck = generated()
    missingCheck.checks.check = { id: 'check', constraintId: 'absent', state: 'unchecked', algorithmId: 'clearance', algorithmVersion: 1,
      inputHash: hash, issues: [] }
    expect(generationSchema.safeParse(missingCheck).success).toBe(false)
  })
  it('keeps source snapshots self-contained and rejects arbitrary inherited payloads', () => {
    const source = { id: 'source', sourceSceneId: 'parent', sourceRevision: 3, sourceContentHash: hash,
      selectionMm: { x: 0, y: 0, width: 24000, height: 18000 }, translationMm: p(0, 0), publicInputHash: hash,
      inherited: [{ id: 'feature', kind: 'line', sourceEntityId: 'river', visibility: 'public', pointsMm: [p(0, 0), p(1000, 1000)],
        terrainKind: 'river', widthMm: 1000, elevationMm: null, precisionMm: 100000, estimated: true }], recipeRefs: [] }
    expect(sourceRegionLinkSchema.safeParse(source).success).toBe(true)
    expect(sourceRegionLinkSchema.safeParse({ ...source, inherited: [{ ...source.inherited[0], privatePrompt: 'hidden' }] }).success).toBe(false)
  })
  it('requires explicit regional semantics and does not smuggle symbol data into Props', () => {
    const value = createEmptyRegional()
    expect(regionalSchema.parse(value)).toEqual(value)
    value.symbols.tree = { ...common, id: 'tree', definitionRef: { id: 'tree-definition', version: 1 }, positionMm: p(1000, 1000),
      visualBoundsMm: { x: -1000, y: -2000, width: 2000, height: 2000 }, orientation: 'upright', renderOrder: 0,
      managementKey: null, sourceRef: null }
    expect(regionalSchema.safeParse(value).success).toBe(true)
    expect(regionalSchema.safeParse({ ...value, symbols: { tree: { ...value.symbols.tree, blocksMovement: true } } }).success).toBe(false)
  })
  it('requires visual2 to retain strict visual1 base and explicit finite edge geometry', () => {
    const schema = createVisual2Schema(visualSystemSchema), edge = { ...common, id: 'shore', boundaryId: 'boundary', inputHash: hash,
      kind: 'shore' as const, polygons: [[p(0, 0), p(1000, 0), p(1000, 1000)]], strokes: [], materialRef: null, fillColor: '#D8D0B0', opacity: 1 }
    expect(schema.safeParse({ version: 2, base: emptyVisualSystem(), materializedEdges: { shore: edge } }).success).toBe(true)
    expect(schema.safeParse({ version: 2, base: { ...emptyVisualSystem(), script: '' }, materializedEdges: {} }).success).toBe(false)
    expect(materializedEdgeSchema.safeParse({ ...edge, polygons: [], strokes: [] }).success).toBe(false)
    expect(materializedEdgeSchema.safeParse({ ...edge, polygons: [[p(0, 0), p(1.5, 0), p(0, 2)]] }).success).toBe(false)
  })
  it('freezes near-side orientation and physical axes in fixed source metadata', () => {
    const side = { mode: 'nearSide', rootAnchorMm: p(0, 0), orientation: 'fixedUpright', fixedRotationDeg: 0,
      footprintAxes: 'world', groundShadowMm: null }
    expect(presentationSchema.safeParse(side).success).toBe(true)
    expect(presentationSchema.safeParse({ ...side, fixedRotationDeg: 90 }).success).toBe(false)
    expect(presentationSchema.safeParse({ ...side, footprintAxes: 'image' }).success).toBe(false)
    expect(presentationSchema.safeParse({ mode: 'topDown', rootAnchorMm: p(0, 0), orientation: 'rotateWithGround', groundShadowMm: null }).success).toBe(true)
  })
})
