import { describe, expect, it } from 'vitest'
import { createCompositionContent } from '../../../appearance/graph.js'
import { applyCompositionCommands } from '../../../appearance/commands.js'
import { applyCommands, type SceneCommand } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { selectManualTransactionBudget } from '../../../budget/command-budget.js'
import { propFootprint, supportedPolygon } from '../../../geometry/geometry.js'
import { toCurrentSceneDocument } from '../../../model/current-scene.js'
import type { PropDefinition, SceneDocument } from '../../../model/scene.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { generationRecipeSchema } from '../../../terrain-generation/contracts.js'
import { regenerateRoomFurniture } from '../../local-interior.js'
import { interiorEntityId, normalizeSupportedInteriorInput, rectanglePoints, runInteriorGeneration, runSupportedInteriorGeneration, type InteriorGenerationInput, type SupportedInteriorGenerationInput } from './index.js'

const stamp = '2026-11-05T00:00:00.000Z', profile = taskBudgetProfile('standard'), options = { profile, nowMilliseconds: () => 0 }
function runtime() { let sequence = 0; return { ids: { nextId: () => `supported-runtime-${sequence++}` }, clock: { now: () => stamp } } }
function blank() {
  const bounds = { x: 0, y: 0, width: 24000, height: 24000 }, origin = { kind: 'original' as const, attribution: 'supported interior fixture', canEmbed: true }
  const definitions: Record<string, PropDefinition> = Object.fromEntries((['table', 'seat', 'storage'] as const).map(role => [role, {
    id: role, catalogId: `supported-test-${role}`, version: 1, licenseRef: 'MIT', origin, name: role, tags: [],
    defaultAppearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -300, y: -300, width: 600, height: 600 },
    defaultFootprintMm: { width: 600, height: 600 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: true, defaultBlocksSight: false,
    defaultRenderLayer: 'object', defaultShadowClass: 'furniture',
  } satisfies PropDefinition]))
  return toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'supported-interior-fixture', revision: 0, title: 'Supported interior', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: definitions, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } })
}
function request(): SupportedInteriorGenerationInput {
  return { version: 1, algorithmVersion: 1, seed: 'supported-building', parameters: {
    floorId: 'floor', layerId: 'layer', supportRef: { kind: 'terrainArea', id: 'support' }, boundsMm: { x: 3000, y: 3000, width: 12000, height: 10000 }, wallThicknessMm: 200,
    rooms: ['first', 'second'].map(id => ({ id, purpose: '公共室', minAreaMm2: 4_000_000, maxAreaMm2: 200_000_000, minClearSideMm: 2000 })), relations: [],
    corridor: { axis: 'none', clearWidthMm: 1200 }, materials: { floor: null, wall: null }, arrangement: { doors: true, entrance: true, furniture: true, doorWidthMm: 1400, clearWidthMm: 1000,
      palette: (['table', 'seat', 'storage'] as const).map(role => ({ role, ref: { id: role, version: 1 } })) },
  } }
}
function terrain(existing = false) {
  let document = applyCommands(blank(), [{ type: 'createTerrainArea', id: 'support', floorId: 'floor', layerId: 'layer', boundaryMm: rectanglePoints({ x: 0, y: 0, width: 24000, height: 24000 }), groundElevationMm: 3000 }], runtime())
  if (existing) document = applyCommands(document, [
    { type: 'createRoom', id: 'existing-room', floorId: 'floor', layerId: 'layer', boundaryMm: rectanglePoints({ x: 18000, y: 16000, width: 4000, height: 4000 }), thicknessMm: 500, supportRef: { kind: 'terrainArea', id: 'support' } },
    { type: 'addOpening', id: 'existing-door', wallId: 'existing-room:wall:0', offsetReferenceVertexId: 'existing-room:vertex:0', offsetMm: 1000, widthMm: 1200, kind: 'door', state: 'open', locked: false, secret: false, revealed: false, layerId: 'layer' },
    { type: 'addProp', id: 'existing-prop', floorId: 'floor', layerId: 'layer', definitionRef: { id: 'table', version: 1 }, positionMm: { x: 19000, y: 4000 }, supportRef: { kind: 'terrainArea', id: 'support' } },
  ], runtime())
  return document
}

describe('supported-interior@1 composition adapter', () => {
  it('freezes the furnished floor-only and supported replay results before the next algorithm', () => {
    const input = request(), { supportRef: _supportRef, ...parameters } = input.parameters
    const results = {
      interior2: runInteriorGeneration(blank(), { version: 1, algorithmVersion: 2, seed: input.seed, parameters }, options).resultHash,
      interior3: runInteriorGeneration(blank(), { version: 1, algorithmVersion: 3, seed: input.seed, parameters }, options).resultHash,
      supported1: runSupportedInteriorGeneration(terrain(), { ...input, algorithmVersion: 1 }, options).resultHash,
      supported2: runSupportedInteriorGeneration(terrain(), { ...input, algorithmVersion: 2 }, options).resultHash,
    }
    expect(results).toMatchInlineSnapshot(`
      {
        "interior2": "4ae61d9e1fc7d4890ff204389411b9131115fb747cafa2f16ccfcd93353b4b4e",
        "interior3": "921a322bd36516aefc883878cc780b877cac30caf031fbe2c2fd9bd26382691f",
        "supported1": "4fcc56a450e467bac1b4371571ec7edbacc113836e6d3d0a184c1fc5a859a666",
        "supported2": "d3462de17cbf9118947af24cf2fd9f8982f185f1cf25e2d05d3358859232c988",
      }
    `)
  }, 30000)

  it('materializes elevated furnished rooms without changing or claiming existing entities', () => {
    const base = terrain(true), before = canonicalJson(base), input = request(), generated = runSupportedInteriorGeneration(base, input, options), result = cloneJson(generated.candidate.document) as SceneDocument
    expect(runSupportedInteriorGeneration(base, input, options)).toEqual(generated)
    expect(canonicalJson(base)).toBe(before)
    expect(validateSceneDocument(result).ok).toBe(true)
    for (const collection of ['rooms', 'vertices', 'walls', 'openings', 'props', 'terrainAreas'] as const) for (const [id, row] of Object.entries(base[collection])) expect(result[collection][id]).toEqual(row)
    for (const row of generated.layout.rooms) {
      expect(result.rooms[row.roomId].supportRef).toEqual(input.parameters.supportRef)
      expect(result.rooms[row.roomId].groundElevationMm).toBe(3000)
    }
    expect(generated.report.furnishing.propIds.length).toBeGreaterThan(0)
    expect(generated.report.connectivity.routes.length).toBeGreaterThan(1)
    expect(generated.report.connectivity.routes.every(route => route.status === 'clear')).toBe(true)
    for (const id of generated.report.furnishing.propIds) expect(supportedPolygon(result, propFootprint(result.props[id]), result.props[id].supportRef, 'floor')).toBe(true)
    const generation = getLegacyGeneration(result)!, recipe = generation.recipes[interiorEntityId(base.sceneId, input.seed, 'recipe')]
    expect(recipe).toMatchObject({ domain: 'interior', recipeVersion: 1, algorithmId: 'supported-interior', algorithmVersion: 1, parameters: { supportRef: input.parameters.supportRef } })
    expect(Object.values(generation.rules).some(rule => rule.inputs.some(ref => ref.kind === 'terrainArea' && ref.entityId === 'support'))).toBe(true)
    expect(Object.values(generation.ownership).some(owner => ['support', 'existing-room', 'existing-door', 'existing-prop', ...Object.keys(base.walls), ...Object.keys(base.vertices)].includes(owner.target.entityId))).toBe(false)
    expect(generated.candidate.stages.map(stage => stage.operator.id)).toEqual(['supported-interior', 'supported-interior-connections', 'supported-interior-furnishing'])
  })

  it('keeps existing outdoor connections outside the building bounds unchanged', () => {
    const base = applyCommands(terrain(), [
      { type: 'createTerrainArea', id: 'upper-ground', floorId: 'floor', layerId: 'layer', boundaryMm: rectanglePoints({ x: 18000, y: 1000, width: 5000, height: 7000 }), groundElevationMm: 4000, coveragePriority: 2 },
      { type: 'createTerrainConnection', id: 'existing-stairs', floorId: 'floor', layerId: 'layer', kind: 'stairs', widthMm: 1000,
        from: { surfaceRef: { kind: 'terrainArea', id: 'support' }, positionMm: { x: 16000, y: 4000 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'upper-ground' }, positionMm: { x: 20000, y: 4000 } } },
    ], runtime())
    const before = canonicalJson(base), input = request(); input.parameters.arrangement.furniture = false
    const generated = runSupportedInteriorGeneration(base, input, options), result = cloneJson(generated.candidate.document) as SceneDocument
    expect(validateSceneDocument(result).ok).toBe(true)
    expect(result.terrainConnections).toEqual(base.terrainConnections)
    expect(result.terrainAreas).toEqual(base.terrainAreas)
    expect(generated.layout.rooms).toHaveLength(2)
    expect(canonicalJson(base)).toBe(before)
  })

  it('strictly normalizes the new contract and rejects conflicting support or real reserved geometry', () => {
    const input = request(), reordered = cloneJson(input); reordered.parameters.rooms.reverse(); reordered.parameters.arrangement.palette.reverse()
    expect(normalizeSupportedInteriorInput(reordered)).toEqual(normalizeSupportedInteriorInput(input))
    expect(() => normalizeSupportedInteriorInput({ ...input, algorithmVersion: 99 })).toThrow(/输入无效/)
    expect(() => normalizeSupportedInteriorInput({ ...input, parameters: { ...input.parameters, hiddenExtra: true } })).toThrow(/输入无效/)
    const base = terrain(), missing = request(); missing.parameters.supportRef.id = 'missing'
    expect(() => runSupportedInteriorGeneration(base, missing, options)).toThrow(/真实/)
    for (const command of [
      { type: 'setEditLock', kind: 'terrainArea', id: 'support', locked: true },
      { type: 'updateTerrainArea', id: 'support', changes: { blocksMovement: true } },
      { type: 'createTerrainArea', id: 'overlay', floorId: 'floor', layerId: 'layer', boundaryMm: rectanglePoints({ x: 4000, y: 4000, width: 2000, height: 2000 }), groundElevationMm: 4000, coveragePriority: 2 },
      { type: 'createPath', id: 'existing-path', floorId: 'floor', layerId: 'layer', centerlineMm: [{ x: 1000, y: 6000 }, { x: 20000, y: 6000 }], widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: 'support' }] },
      { type: 'createRoom', id: 'occupied-room', floorId: 'floor', layerId: 'layer', boundaryMm: rectanglePoints({ x: 5000, y: 5000, width: 3000, height: 3000 }), thicknessMm: 200, supportRef: { kind: 'terrainArea', id: 'support' } },
      { type: 'createRegion', id: 'hazard', floorId: 'floor', layerId: 'layer', kind: 'hazard', blocksMovement: false, boundaryMm: rectanglePoints({ x: 5000, y: 5000, width: 3000, height: 3000 }) },
    ] satisfies SceneCommand[]) {
      const conflicting = applyCommands(base, [command], runtime()), before = canonicalJson(conflicting)
      expect(() => runSupportedInteriorGeneration(conflicting, input, options)).toThrow(/锁定|支撑|冲突/)
      expect(canonicalJson(conflicting)).toBe(before)
    }
    expect(() => runSupportedInteriorGeneration(base, input, { ...options, signal: { aborted: true } })).toThrow(/取消/)
  })

  it('keeps generated ownership independent across two supported building instances', () => {
    const first = runSupportedInteriorGeneration(terrain(), request(), options), input = request()
    input.seed = 'second-supported-building'; input.parameters.boundsMm = { x: 17000, y: 15000, width: 6000, height: 7000 }; input.parameters.rooms = input.parameters.rooms.slice(0, 1)
    const firstDocument = cloneJson(first.candidate.document) as SceneDocument
    const second = runSupportedInteriorGeneration(firstDocument, input, options), old = getLegacyGeneration(firstDocument)!, generation = getLegacyGeneration(cloneJson(second.candidate.document) as SceneDocument)!
    for (const collection of ['recipes', 'rules', 'ownership'] as const) for (const [id, row] of Object.entries(old[collection])) expect(generation[collection][id]).toEqual(row)
    expect(Object.keys(generation.recipes)).toHaveLength(2)
    expect(validateSceneDocument(second.candidate.document).ok).toBe(true)
  })

  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const) it(`reuses D6 furniture on elevated support at version ${version} and preserves manual or deleted slots`, () => {
    const original = request()
    const input: SupportedInteriorGenerationInput = version === 10 || version === 11 || version === 12 || version === 13 || version === 14 || version === 15 || version === 16 || version === 17 || version === 18 || version === 19 ? { ...original, algorithmVersion: version, parameters: { ...original.parameters, entranceApproach: { fromMm: { x: 1000, y: 8000 }, viaMm: [], widthMm: 1000 } } } : { ...original, algorithmVersion: version }
    const generated = runSupportedInteriorGeneration(terrain(), input, options), context = runtime()
    const content = createCompositionContent(cloneJson(generated.candidate.document) as SceneDocument, context), roomId = generated.layout.rooms[0].roomId
    const props = Object.values(content.document.props).filter(prop => prop.roomId === roomId)
    expect(props.length).toBeGreaterThanOrEqual(2)
    // New suggestions use the editor's normal compact manual policy, which
    // counts real targets and separately bounds all changed metadata. Keep the
    // legacy no-policy replay fixture unchanged for supported versions 1/2.
    const accounting = version >= 3 ? { budget: selectManualTransactionBudget(content.document) } : undefined
    if (accounting) expect(accounting.budget.semanticTargets).toBe(256)
    const edited = applyCompositionCommands(content, [{ type: 'deleteProp', id: props[0].id }, { type: 'updateProp', id: props[1].id, changes: { positionMm: { x: props[1].positionMm.x + 10, y: props[1].positionMm.y } } }], context, accounting)
    const requestLocal = { recipeId: interiorEntityId(content.document.sceneId, input.seed, 'recipe'), roomId, variation: 'supported-local' }
    const result = regenerateRoomFurniture(edited, requestLocal, context, { profile, checkCancelled() {} })
    expect(result.writes.length).toBeGreaterThan(0)
    expect(result.document.props[props[0].id]).toBeUndefined()
    expect(result.document.props[props[1].id]).toEqual(edited.document.props[props[1].id])
    expect(result.document.rooms).toEqual(edited.document.rooms)
    expect(result.document.openings).toEqual(edited.document.openings)
    expect(result.document.terrainAreas).toEqual(edited.document.terrainAreas)
    for (const [id, prop] of Object.entries(edited.document.props)) if (result.document.props[id]) expect({ ...result.document.props[id], positionMm: prop.positionMm }).toEqual(prop)
    expect(result.readIds).toContain('support')
    expect(validateSceneDocument(result.document).ok).toBe(true)
    const locked = applyCompositionCommands(edited, [{ type: 'setEditLock', kind: 'terrainArea', id: 'support', locked: true }], context, accounting)
    expect(() => regenerateRoomFurniture(locked, requestLocal, context, { profile, checkCancelled() {} })).toThrow(/支撑.*锁定/)
  }, version >= 3 ? 30_000 : 5000)

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9] as const)('persists the exact supported version %s and rejects mixed recipe selectors', algorithmVersion => {
    const input = request(); input.algorithmVersion = algorithmVersion
    input.parameters.arrangement.furniture = false
    const generated = runSupportedInteriorGeneration(terrain(), input, options)
    const recipe = Object.values(getLegacyGeneration(cloneJson(generated.candidate.document) as SceneDocument)!.recipes)[0]
    expect(generated.input.algorithmVersion).toBe(algorithmVersion)
    expect(generated.candidate.stages.every(stage => stage.operator.version === algorithmVersion)).toBe(true)
    expect(recipe).toMatchObject({ recipeVersion: algorithmVersion, algorithmId: 'supported-interior', algorithmVersion })
    expect(generationRecipeSchema.safeParse(recipe).success).toBe(true)
    expect(generationRecipeSchema.safeParse({ ...recipe, recipeVersion: algorithmVersion === 3 ? 2 : 3 }).success).toBe(false)
  })

  it('retains the original interior-layout@2 replay identity', () => {
    const input = request(), { supportRef: _supportRef, ...parameters } = input.parameters
    const original: InteriorGenerationInput = { version: 1, algorithmVersion: 2, seed: input.seed, parameters }
    const generated = runInteriorGeneration(blank(), original, options)
    // Captured from the committed pre-adapter runner after a full result equality
    // comparison, including request/document/output/stage/report hashes.
    expect(generated.resultHash).toBe('4ae61d9e1fc7d4890ff204389411b9131115fb747cafa2f16ccfcd93353b4b4e')
    expect(generated.candidate.stages.map(stage => stage.operator)).toEqual([{ id: 'interior-layout', version: 2 }, { id: 'interior-connections', version: 2 }, { id: 'interior-furnishing', version: 2 }])
    expect(Object.values(getLegacyGeneration(cloneJson(generated.candidate.document) as SceneDocument)!.recipes)[0]).toMatchObject({ algorithmId: 'interior-layout', algorithmVersion: 2, recipeVersion: 2 })
  })
})
