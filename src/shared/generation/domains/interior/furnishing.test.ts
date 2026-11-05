import { describe, expect, it } from 'vitest'
import { applyCommands } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { propFootprint, supportedPolygon } from '../../../geometry/geometry.js'
import { toCurrentSceneDocument } from '../../../model/current-scene.js'
import type { PropDefinition, SceneDocument } from '../../../model/scene.js'
import { canonicalJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { furnishInterior } from './furnishing.js'
import { arrangeInteriorConnections, checkInteriorCirculation, type InteriorConnectivityReport } from './connectivity.js'
import type { InteriorGenerationInput, InteriorLayout } from './contracts.js'
import { interiorEntityId } from './layout.js'

const stamp = '2026-11-05T00:00:00.000Z', profile = taskBudgetProfile('small'), options = { profile, checkCancelled: () => {} }
const context = { ids: { nextId: () => { throw new Error('native room IDs must be explicit') } }, clock: { now: () => stamp } }
const emptyConnectivity: InteriorConnectivityReport = { openingIds: [], entranceOpeningId: null, routes: [], notes: [] }
function fixture(widthMm: number, heightMm = widthMm, twoRooms = false): { document: SceneDocument; input: InteriorGenerationInput; layout: InteriorLayout } {
  const origin = { kind: 'original' as const, attribution: 'test fixture', canEmbed: true }, bounds = { x: 0, y: 0, width: 24000, height: 24000 }
  const definitions: Record<string, PropDefinition> = Object.fromEntries((['bed', 'seat', 'table', 'storage', 'work', 'hearth', 'shelf'] as const).map(role => {
    const width = role === 'bed' ? 1800 : role === 'seat' ? 600 : 1000, height = role === 'bed' ? 1000 : role === 'seat' ? 600 : 700
    return [role, { id: role, catalogId: `test-${role}`, version: 1, licenseRef: 'MIT', origin, name: role, tags: [], defaultAppearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -width / 2, y: -height / 2, width, height }, defaultFootprintMm: { width, height }, defaultFootprintOffsetMm: { x: 0, y: 0 },
      defaultBlocksMovement: true, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'furniture' } satisfies PropDefinition]
  }))
  const base = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'furnishing-fixture', revision: 0, title: 'Furniture fixture', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: definitions, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } })
  const roomRows = Array.from({ length: twoRooms ? 2 : 1 }, (_, index) => ({ requirementId: `requirement-${index}`, roomId: `room-${index}`, boundsMm: { x: 3000 + index * widthMm, y: 3000, width: widthMm, height: heightMm }, clearAreaMm2: (widthMm - 200) * (heightMm - 200) }))
  let nextVertex = 0
  const document = applyCommands(base, roomRows.map(row => ({ type: 'createRoom', id: row.roomId, floorId: 'floor', layerId: 'layer', purpose: '公共室', thicknessMm: 200,
    boundaryMm: [{ x: row.boundsMm.x, y: row.boundsMm.y }, { x: row.boundsMm.x + widthMm, y: row.boundsMm.y }, { x: row.boundsMm.x + widthMm, y: row.boundsMm.y + heightMm }, { x: row.boundsMm.x, y: row.boundsMm.y + heightMm }] })),
    { ...context, ids: { nextId: () => `native-${nextVertex++}` } })
  const input: InteriorGenerationInput = { version: 1, algorithmVersion: 2, seed: 'furniture-stable', parameters: { floorId: 'floor', layerId: 'layer', boundsMm: bounds, wallThicknessMm: 200,
    rooms: roomRows.map(row => ({ id: row.requirementId, purpose: '公共室', minAreaMm2: 1, maxAreaMm2: 1_000_000_000, minClearSideMm: 1000 })), relations: [],
    corridor: { axis: 'none', clearWidthMm: 1200 }, materials: { floor: null, wall: null }, arrangement: { doors: twoRooms, entrance: false, furniture: true, doorWidthMm: 1200, clearWidthMm: 1000,
      palette: Object.keys(definitions).map(role => ({ role: role as InteriorGenerationInput['parameters']['arrangement']['palette'][number]['role'], ref: { id: role, version: 1 } })) } } }
  return { document, input, layout: { rooms: roomRows, corridors: [] } }
}

describe('initial interior furniture suggestions', () => {
  it('uses real room area and fixed footprints, is deterministic and leaves later deletion unconstrained', () => {
    const small = fixture(3000), large = fixture(8000), before = canonicalJson(large.document)
    const first = furnishInterior(small.document, small.input, small.layout, emptyConnectivity, options)
    const second = furnishInterior(large.document, large.input, large.layout, emptyConnectivity, options)
    expect(first.report.propIds.length).toBeGreaterThan(0)
    expect(second.report.propIds.length).toBeGreaterThan(first.report.propIds.length)
    expect(furnishInterior(large.document, large.input, large.layout, emptyConnectivity, options)).toEqual(second)
    expect(furnishInterior(large.document, large.input, large.layout, emptyConnectivity, {
      ...options,
      propIdForSlot: slot => interiorEntityId(large.document.sceneId, large.input.seed, `furniture:${slot.requirementId}:${slot.role}:${slot.index}`),
      existingPropForSlot: () => null,
    })).toEqual(second)
    expect(canonicalJson(large.document)).toBe(before)
    expect(second.document.constraints).toEqual(large.document.constraints)
    expect(validateSceneDocument(second.document).ok).toBe(true)
    for (const id of second.report.propIds) {
      const prop = second.document.props[id], definition = second.document.propDefinitions[prop.definitionRef!.id]
      expect(prop.footprintMm).toEqual(definition.defaultFootprintMm)
      expect(prop.rotationDeg).toBe(0)
      expect(supportedPolygon(second.document, propFootprint(prop), prop.supportRef, prop.floorId)).toBe(true)
    }
    const edited = applyCommands(second.document, [{ type: 'deleteProp', id: second.report.propIds[0] }], context)
    expect(Object.keys(edited.props)).toHaveLength(second.report.propIds.length - 1)
    expect(validateSceneDocument(edited).ok).toBe(true)
  })

  it('reports missing palette or oversized suggestions while keeping a valid editable layout', () => {
    const value = fixture(3000)
    value.input.parameters.rooms[0].purpose = '卧室'
    value.input.parameters.arrangement.palette = []
    const absent = furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options)
    expect(absent.report.propIds).toEqual([])
    expect(absent.report.notes.join()).toContain('未提供床')
    value.input.parameters.arrangement.palette = [{ role: 'bed', ref: { id: 'bed', version: 1 } }]
    value.document.propDefinitions.bed.defaultFootprintMm.width = 5000
    value.document.propDefinitions.bed.defaultVisualBoundsMm = { x: -2500, y: -500, width: 5000, height: 1000 }
    const oversized = furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options)
    expect(oversized.report.propIds).toEqual([])
    expect(oversized.report.notes.join()).toContain('未找到')
    expect(validateSceneDocument(oversized.document).ok).toBe(true)
  })

  it('keeps actual door approaches and every initially clear full-width route available', () => {
    const value = fixture(8000, 8000, true)
    const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
    expect(connected.report.openingIds.length).toBeGreaterThan(0)
    expect(connected.report.routes.some(route => route.status === 'clear')).toBe(true)
    const result = furnishInterior(connected.document, value.input, value.layout, connected.report, options)
    expect(result.report.propIds.length).toBeGreaterThan(0)
    const checked = checkInteriorCirculation(result.document, value.input, value.layout, connected.report)
    expect(checked.routes.every((route, at) => connected.report.routes[at].status !== 'clear' || route.status === 'clear')).toBe(true)
    expect(() => furnishInterior(value.document, value.input, value.layout, connected.report, { profile, checkCancelled: () => { throw new Error('cancelled') } })).toThrow('cancelled')
  })
})
