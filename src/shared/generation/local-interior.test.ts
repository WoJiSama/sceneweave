import { describe, expect, it } from 'vitest'
import { createCompositionContent, syncAppearanceGraph } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { selectManualTransactionBudget } from '../budget/command-budget.js'
import { advanceHistoryIdentity } from '../history/identity.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { PropDefinition } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { interiorEntityId, runInteriorGeneration, type InteriorGenerationInput } from './domains/interior/index.js'
import { regenerateRoomFurniture } from './local-interior.js'

const stamp = '2026-11-05T00:00:00.000Z', profile = taskBudgetProfile('standard'), options = { profile, checkCancelled() {} }
function runtime() { let next = 0; return { ids: { nextId: () => `local-interior-identity-${++next}` }, clock: { now: () => stamp } } }
function fixture(furniture = true, doors = false, algorithmVersion: InteriorGenerationInput['algorithmVersion'] = 2) {
  const bounds = { x: 0, y: 0, width: 24000, height: 16000 }, origin = { kind: 'original' as const, attribution: 'test fixture', canEmbed: true }
  const definitions: Record<string, PropDefinition> = Object.fromEntries((['table', 'seat', 'storage'] as const).map(role => [role, {
    id: role, catalogId: `local-test-${role}`, version: 1, licenseRef: 'MIT', origin, name: role, tags: [],
    defaultAppearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -300, y: -300, width: 600, height: 600 },
    defaultFootprintMm: { width: 600, height: 600 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: true, defaultBlocksSight: false,
    defaultRenderLayer: 'object', defaultShadowClass: 'furniture',
  } satisfies PropDefinition]))
  const base = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'local-interior', revision: 0, title: 'Furniture local fixture', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: definitions, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } })
  const input: InteriorGenerationInput = { version: 1, algorithmVersion, seed: 'local-furniture', parameters: {
    floorId: 'floor', layerId: 'layer', boundsMm: { x: 1000, y: 1000, width: 22000, height: 14000 }, wallThicknessMm: 200,
    rooms: ['selected', 'outside'].map(id => ({ id, purpose: '公共室', minAreaMm2: 4_000_000, maxAreaMm2: 400_000_000, minClearSideMm: 1000 })), relations: [],
    corridor: { axis: 'none', clearWidthMm: 1200 }, materials: { floor: null, wall: null }, arrangement: { doors, entrance: false, furniture, doorWidthMm: 1200, clearWidthMm: 1000,
      palette: Object.keys(definitions).map(role => ({ role: role as 'table' | 'seat' | 'storage', ref: { id: role, version: 1 } })) },
  } }
  const generated = runInteriorGeneration(base, input, { profile, nowMilliseconds: () => 0 }), context = runtime()
  const content = createCompositionContent(cloneJson(generated.candidate.document) as typeof base, context)
  const roomId = generated.layout.rooms.find(row => row.requirementId === 'selected')!.roomId
  const recipeId = interiorEntityId(base.sceneId, input.seed, 'recipe')
  return { content, context, roomId, recipeId, input }
}

describe('selected generated-room furniture regeneration', () => {
  it('lists actual floor-only v8 physical region dependencies without claiming or changing them', () => {
    const f = fixture(false, true, 8)
    const content = applyCompositionCommands(f.content, [{ type: 'createRegion', id: 'read-only-region', floorId: 'floor', layerId: 'layer',
      kind: 'hazard', blocksMovement: true, boundaryMm: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 500 }, { x: 100, y: 500 }] }], f.context,
      { budget: selectManualTransactionBudget(f.content.document) })
    const before = canonicalJson(content)
    const result = regenerateRoomFurniture(content, { recipeId: f.recipeId, roomId: f.roomId, variation: 'physical-read-closure' }, f.context, options)
    expect(result.readIds).toContain('read-only-region')
    expect(result.document.regions).toEqual(content.document.regions)
    expect(result.writes.every(row => row.entityId !== 'read-only-region')).toBe(true)
    expect(canonicalJson(content)).toBe(before)
  })

  it.each(['moved', 'deleted'] as const)('uses expanded v4 slots while preserving a manually %s member', action => {
    const f = fixture(true, false, 4)
    const props = Object.values(f.content.document.props).filter(prop => prop.roomId === f.roomId)
    expect(props.length).toBeGreaterThan(6)
    const target = props.at(-1)!
    const content = applyCompositionCommands(f.content, action === 'moved'
      ? [{ type: 'updateProp', id: target.id, changes: { positionMm: { x: target.positionMm.x + 10, y: target.positionMm.y } } }]
      : [{ type: 'deleteProp', id: target.id }], f.context)
    const before = canonicalJson(content)
    const result = regenerateRoomFurniture(content, { recipeId: f.recipeId, roomId: f.roomId, variation: 'expanded-arrangement' }, f.context, options)
    expect(canonicalJson(content)).toBe(before)
    expect(result.document.props[target.id]).toEqual(content.document.props[target.id])
    expect(result.writes.every(row => row.entityId !== target.id)).toBe(true)
    for (const prop of Object.values(content.document.props).filter(prop => prop.roomId !== f.roomId)) expect(result.document.props[prop.id]).toEqual(prop)
    expect(validateSceneDocument(result.document).ok).toBe(true)
  }, 30_000)

  it('repositions live managed props deterministically and preserves every outside prop', () => {
    const f = fixture(), before = canonicalJson(f.content), request = { recipeId: f.recipeId, roomId: f.roomId, variation: 'arrangement-b' }
    const result = regenerateRoomFurniture(f.content, request, f.context, options)
    expect(regenerateRoomFurniture(f.content, request, runtime(), options)).toEqual(result)
    expect(canonicalJson(f.content)).toBe(before)
    expect(result.writes.length).toBeGreaterThan(0)
    for (const [id, prop] of Object.entries(f.content.document.props)) {
      const next = result.document.props[id]
      expect(next).toBeDefined()
      if (prop.roomId === f.roomId) expect({ ...next, positionMm: prop.positionMm }).toEqual(prop)
      else expect(next).toEqual(prop)
    }
    expect(Object.keys(result.document.props)).toEqual(Object.keys(f.content.document.props))
    expect(getLegacyGeneration(result.document)!.recipes[f.recipeId]).toEqual(getLegacyGeneration(f.content.document)!.recipes[f.recipeId])
    expect(validateSceneDocument(result.document).ok).toBe(true)
    const historyIdentity = advanceHistoryIdentity(f.content.historyIdentity, f.content.document, result.document, f.context)
    const completed = syncAppearanceGraph({ document: result.document, historyIdentity, appearance: f.content.appearance }, f.content.document)
    expect(terrainCommandCost(f.content.document, result.document, { before: f.content, after: completed }).total).toBeLessThanOrEqual(256)
    expect(completed.historyIdentity.propTokens).toEqual(f.content.historyIdentity.propTokens)
    expect(completed.appearance).toEqual(f.content.appearance)
  })

  it.each([2, 6, 7, 8, 9, 10] as const)('preserves moved, deleted, locked and appearance-adjusted furniture slots at version %s', algorithmVersion => {
    const f = fixture(true, false, algorithmVersion), props = Object.values(f.content.document.props).filter(prop => prop.roomId === f.roomId)
    const accounting = algorithmVersion >= 6 ? {budget:selectManualTransactionBudget(f.content.document)} : undefined
    expect(props.length).toBeGreaterThanOrEqual(5)
    let content = applyCompositionCommands(f.content, [
      { type: 'updateProp', id: props[0].id, changes: { positionMm: { x: props[0].positionMm.x + 10, y: props[0].positionMm.y } } },
      { type: 'deleteProp', id: props[1].id },
    ], f.context, accounting)
    content = applyCompositionCommands(content, [{ type: 'setEditLock', kind: 'prop', id: props[2].id, locked: true }], f.context, accounting)
    content = applyCompositionCommands(content, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: [props[3].id] }, adjustment: { id: 'manual-opacity', enabled: true, kind: 'opacity', value: 0.6 } }], f.context, accounting)
    const before = canonicalJson(content), result = regenerateRoomFurniture(content, { recipeId: f.recipeId, roomId: f.roomId, variation: 'arrangement-c' }, f.context, options)
    expect(canonicalJson(content)).toBe(before)
    for (const index of [0, 2, 3]) expect(result.document.props[props[index].id]).toEqual(content.document.props[props[index].id])
    expect(result.document.props[props[1].id]).toBeUndefined()
    expect(result.writes.every(row => !props.slice(0, 4).some(prop => prop.id === row.entityId))).toBe(true)
    expect(validateSceneDocument(result.document).ok).toBe(true)
  })

  it('assigns genuinely fresh identities to unfilled suggestions and preserves stable slot keys', () => {
    const f = fixture(false), request = { recipeId: f.recipeId, roomId: f.roomId, variation: 'arrangement-new' }
    const result = regenerateRoomFurniture(f.content, request, f.context, options), gen = getLegacyGeneration(result.document)!
    expect(result.writes.length).toBeGreaterThan(0)
    for (const write of result.writes) {
      expect(write.entityId).toMatch(/^local-interior-identity-/)
      expect(f.content.historyIdentity.propTokens[write.entityId]).toBeUndefined()
      const owner = Object.values(gen.ownership).find(row => row.target.entityId === write.entityId)!
      expect(owner.outputKey).toMatch(new RegExp(`^${f.recipeId}:furniture:selected:`))
      expect(owner.state).toBe('managed')
      expect(result.document.props[write.entityId].roomId).toBe(f.roomId)
    }
    expect(validateSceneDocument(result.document).ok).toBe(true)
    const historyIdentity = advanceHistoryIdentity(f.content.historyIdentity, f.content.document, result.document, f.context)
    const completed = syncAppearanceGraph({ document: result.document, historyIdentity, appearance: f.content.appearance }, f.content.document)
    expect(terrainCommandCost(f.content.document, result.document, { before: f.content, after: completed }).total).toBeLessThanOrEqual(256)
    for (const write of result.writes) {
      expect(completed.historyIdentity.propTokens[write.entityId]).toBeDefined()
      expect(completed.appearance.propSources[write.entityId]).toBeDefined()
    }
  })

  it.each([2, 6, 7, 8, 9, 10] as const)('keeps closed or deleted doors as user edits and rejects cancellation without mutation at version %s', algorithmVersion => {
    const f = fixture(true, true, algorithmVersion), openingId = Object.keys(f.content.document.openings)[0]
    expect(openingId).toBeDefined()
    const closed = applyCompositionCommands(f.content, [{ type: 'updateOpening', id: openingId, changes: { state: 'closed', locked: true } }], f.context)
    const request = { recipeId: f.recipeId, roomId: f.roomId, variation: 'arrangement-door' }, before = canonicalJson(closed)
    const result = regenerateRoomFurniture(closed, request, f.context, options)
    expect(result.document.openings).toEqual(closed.document.openings)
    expect(canonicalJson(closed)).toBe(before)
    const deleted = applyCompositionCommands(closed, [{ type: 'deleteOpening', id: openingId }], f.context)
    const afterDelete = regenerateRoomFurniture(deleted, request, f.context, options)
    expect(afterDelete.document.openings[openingId]).toBeUndefined()
    expect(() => regenerateRoomFurniture(closed, request, f.context, { profile, checkCancelled() { throw new Error('cancelled') } })).toThrow('cancelled')
    expect(canonicalJson(closed)).toBe(before)
  })
})
