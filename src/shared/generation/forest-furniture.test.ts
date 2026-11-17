import { describe, expect, it } from 'vitest'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { selectManualTransactionBudget } from '../budget/command-budget.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { PropDefinition } from '../model/scene.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { interiorEntityId, runInteriorGeneration, type InteriorGenerationInput } from './domains/interior/index.js'
import { diagnoseForestFurniture, forestFurnitureNotes, ForestFurnitureDiagnosticsSchema } from './forest-furniture.js'
import { regenerateRoomFurniture } from './local-interior.js'

const stamp = '2026-11-17T00:00:00.000Z', profile = taskBudgetProfile('standard'), options = { profile, checkCancelled() {} }
function fixture(furniture = true) {
  let n = 0
  const runtime = { ids: { nextId: () => `repair-identity-${++n}` }, clock: { now: () => stamp } }
  const origin = { kind: 'original' as const, attribution: 'test fixture', canEmbed: true }
  const definitions: Record<string, PropDefinition> = Object.fromEntries((['table', 'seat', 'storage'] as const).map(role => [role, {
    id: role, catalogId: `repair-test-${role}`, version: 1, licenseRef: 'MIT', origin, name: role, tags: [],
    defaultAppearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 },
    defaultVisualBoundsMm: role === 'table' ? { x: -750, y: -750, width: 1500, height: 1500 }
      : role === 'seat' ? { x: -410, y: -450, width: 820, height: 900 } : { x: -925, y: -500, width: 1850, height: 1000 },
    defaultFootprintMm: role === 'table' ? { width: 1340, height: 1340 } : role === 'seat' ? { width: 620, height: 710 } : { width: 1650, height: 850 },
    defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: true, defaultBlocksSight: false,
    defaultRenderLayer: 'object', defaultShadowClass: 'furniture',
  } satisfies PropDefinition]))
  const bounds = { x: 0, y: 0, width: 14000, height: 12000 }
  const base = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'forest-repair', revision: 0, title: 'Repair fixture', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: definitions, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } })
  const input: InteriorGenerationInput = { version: 1, algorithmVersion: 19, seed: 'forest-repair', parameters: {
    floorId: 'floor', layerId: 'layer', boundsMm: { x: 1000, y: 1000, width: 7800, height: 6200 }, wallThicknessMm: 200,
    rooms: [{ id: 'room-1', purpose: '哨站休息室', minAreaMm2: 4_000_000, maxAreaMm2: 100_000_000, minClearSideMm: 1000 }], relations: [],
    corridor: { axis: 'none', clearWidthMm: 1200 }, materials: { floor: null, wall: null }, arrangement: { doors: false, entrance: false, furniture, doorWidthMm: 1200, clearWidthMm: 1000,
      palette: Object.keys(definitions).map(role => ({ role: role as 'table' | 'seat' | 'storage', ref: { id: role, version: 1 } })) },
  } }
  const generated = runInteriorGeneration(base, input, { profile, nowMilliseconds: () => 0 })
  const content = createCompositionContent(cloneJson(generated.candidate.document) as typeof base, runtime)
  return { content, runtime, recipeId: interiorEntityId(base.sceneId, input.seed, 'recipe'), roomId: Object.keys(content.document.rooms)[0] }
}

describe('forest room diagnostics and opt-in seating repair', () => {
  it('reports real expected/actual deficits and actual finite rejection counters without mutating the document', () => {
    const f = fixture(), before = canonicalJson(f.content)
    const diagnostics = diagnoseForestFurniture(f.content.document, options), room = diagnostics.rooms[0], seat = room.roles.find(row => row.role === 'seat')!
    expect(seat.expected).toBe(5)
    expect(seat.actual).toBe(Object.values(f.content.document.props).filter(prop => prop.definitionRef?.id === 'seat').length)
    expect(seat.deficit).toBe(5 - seat.actual)
    if (seat.deficit) expect(seat.rejections.some(row => row.count > 0)).toBe(true)
    expect(canonicalJson(f.content)).toBe(before)
    expect(diagnoseForestFurniture(f.content.document, options)).toEqual(diagnostics)
    expect(forestFurnitureNotes(diagnostics, ['旧：座椅在有限摆位中未找到位置。', '植被真实缺项'])).toContain('植被真实缺项')
    expect(forestFurnitureNotes(diagnostics, ['旧：座椅在有限摆位中未找到位置。'])).not.toContain('旧：座椅在有限摆位中未找到位置。')
    const staleCount = '哨站休息室：座椅目标5件，实际0件，缺5件。可尝试受保护家具修正。'
    const refreshed = forestFurnitureNotes(diagnostics, [staleCount, '植被真实缺项'])
    expect(refreshed).not.toContain(staleCount)
    expect(refreshed).toContain('植被真实缺项')
    expect(forestFurnitureNotes(diagnostics, refreshed)).toEqual(refreshed)
    expect(ForestFurnitureDiagnosticsSchema.safeParse({ ...diagnostics, deficit: diagnostics.deficit + 1 }).success).toBe(false)
  }, 25000)

  it('keeps furniture disabled as no requested furniture and honors cancellation', () => {
    const f = fixture(false), diagnostics = diagnoseForestFurniture(f.content.document, options)
    expect(diagnostics.deficit).toBe(0)
    expect(diagnostics.rooms[0].roles).toEqual([])
    expect(diagnostics.rooms[0].repairable).toBe(false)
    expect(() => diagnoseForestFurniture(f.content.document, { ...options, checkCancelled() { throw new Error('cancelled') } })).toThrow('cancelled')
  })

  it('repairs only still-managed seated geometry, retaining cupboards, identities, manual edits, deleted slots and building bytes', () => {
    const f = fixture(), before = canonicalJson(f.content)
    const request = { recipeId: f.recipeId, roomId: f.roomId, variation: 'forest-repair-seating-v1', strategy: 'seating-v1' as const }
    const result = regenerateRoomFurniture(f.content, request, f.runtime, options)
    expect(canonicalJson(f.content)).toBe(before)
    for (const field of ['rooms', 'walls', 'vertices', 'openings', 'terrainAreas', 'paths'] as const) expect(result.document[field]).toEqual(f.content.document[field])
    for (const prop of Object.values(f.content.document.props)) {
      expect(result.document.props[prop.id]).toBeDefined()
      const { positionMm: _p, rotationDeg: _r, ...business } = prop
      const { positionMm: _nextP, rotationDeg: _nextR, ...afterBusiness } = result.document.props[prop.id]
      expect(afterBusiness).toEqual(business)
      if (prop.definitionRef?.id === 'storage') expect(result.document.props[prop.id]).toEqual(prop)
    }
    expect(validateSceneDocument(result.document).ok).toBe(true)
    const props = Object.values(f.content.document.props).filter(prop => prop.definitionRef?.id === 'seat')
    const locked = applyCompositionCommands(f.content, [{ type: 'setEditLock', kind: 'prop', id: props[0].id, locked: true }], f.runtime,
      { budget: selectManualTransactionBudget(f.content.document) })
    const edited = applyCompositionCommands(locked, [{ type: 'deleteProp', id: props[1].id }], f.runtime,
      { budget: selectManualTransactionBudget(f.content.document) })
    const protectedResult = regenerateRoomFurniture(edited, request, f.runtime, options)
    expect(protectedResult.document.props[props[0].id]).toEqual(edited.document.props[props[0].id])
    expect(protectedResult.document.props[props[1].id]).toBeUndefined()
    const deletedOwner = Object.values(getLegacyGeneration(protectedResult.document)!.ownership).find(row => row.target.entityId === props[1].id)!
    expect(deletedOwner.state).toBe('deleted')
    expect(validateSceneDocument(protectedResult.document).ok).toBe(true)
  }, 25000)
})
