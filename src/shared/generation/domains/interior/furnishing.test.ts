import { describe, expect, it } from 'vitest'
import { applyCommands } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { polygonDistance, polygonInside, polygonsOverlap, propFootprint, roomPoints, supportedPolygon } from '../../../geometry/geometry.js'
import { toCurrentSceneDocument } from '../../../model/current-scene.js'
import type { PropDefinition, SceneDocument } from '../../../model/scene.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { furnishInterior } from './furnishing.js'
import { furnitureAccessBand, roomDoorPorts } from './furnishing-circulation.js'
import { arrangeInteriorConnections, checkInteriorCirculation, type InteriorConnectivityReport } from './connectivity.js'
import type { InteriorGenerationInput, InteriorLayout } from './contracts.js'
import { interiorEntityId } from './layout.js'
import { furnitureBoundsPolygon, furniturePoseCandidates, type FurnitureAnchor } from './furnishing-poses.js'
import { furnitureUseSpacePolygon, furnitureWorkingSpacePolygon } from './furnishing-use-space.js'
import { bedroomStorageCandidates, planBedroomAccess } from './furnishing-bedroom.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { hashGenerationValue } from '../../contracts.js'

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
  it.each(['客房', '餐厅', '厨房'])('keeps exact established %s furniture and reports when the new algorithm prunes distant room geometry', purpose => {
    const value = fixture(6500, 7500, true)
    value.input.algorithmVersion = 9
    value.input.parameters.rooms.forEach(room => { room.purpose = purpose })
    const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
    const before = furnishInterior(connected.document, value.input, value.layout, connected.report, options)
    const after = furnishInterior(connected.document, { ...value.input, algorithmVersion: 10 }, value.layout, connected.report, options)
    expect(after).toEqual(before)
  })

  it('keeps established algorithm 8 bedroom, dining and kitchen doorway replay fingerprints', () => {
    const fingerprints = ['客房', '餐厅', '厨房'].map(purpose => {
      const value = fixture(6500, 7500)
      value.input.algorithmVersion = 8; value.input.parameters.rooms[0].purpose = purpose
      value.input.parameters.arrangement.entrance = true
      const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
      return hashGenerationValue(furnishInterior(connected.document, value.input, value.layout, connected.report, options))
    })
    expect(fingerprints).toMatchSnapshot()
  })

  it('keeps established algorithm 7 bedroom, dining and kitchen replay fingerprints', () => {
    const fingerprints = ['客房', '餐厅', '厨房'].map(purpose => {
      const value = fixture(6500, 7500)
      value.input.algorithmVersion = 7; value.input.parameters.rooms[0].purpose = purpose
      return hashGenerationValue(furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options))
    })
    expect(fingerprints).toMatchSnapshot()
  })

  it('keeps the established algorithm 6 bedroom, dining and kitchen results', () => {
    const fingerprints = ['客房', '餐厅', '厨房'].map(purpose => {
      const value = fixture(6500, 7500)
      value.input.algorithmVersion = 6; value.input.parameters.rooms[0].purpose = purpose
      return hashGenerationValue(furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options))
    })
    expect(fingerprints).toMatchSnapshot()
  })

  it.each([2, 3, 4, 5] as const)('keeps frozen replay fingerprints for algorithm %s across dining and kitchen inputs', algorithmVersion => {
    const fingerprints = ['餐厅', '厨房'].map(purpose => {
      const value = fixture(6500, 7500)
      value.input.algorithmVersion = algorithmVersion; value.input.parameters.rooms[0].purpose = purpose
      return hashGenerationValue(furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options))
    })
    expect(fingerprints).toMatchSnapshot()
  })

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

describe('current furniture units with real doorway access', () => {
  it.each(([8, 9] as const).flatMap(version => ['客房', '餐厅', '厨房', '库房'].map(purpose => [version, purpose] as const)))('connects version %s %s use areas to an actual door and protects complete bands', (algorithmVersion, purpose) => {
    const value = fixture(8000, 9000)
    value.input.algorithmVersion = algorithmVersion; value.input.parameters.rooms[0].purpose = purpose
    value.input.parameters.arrangement.entrance = true
    const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
    const before = canonicalJson(connected.document)
    const result = furnishInterior(connected.document, value.input, value.layout, connected.report, options)
    const access = result.report.rooms[0].circulation!
    expect(result.report.propIds.length).toBeGreaterThan(2)
    expect(access.length).toBeGreaterThan(1)
    expect(access.every(route => route.status === 'clear')).toBe(true)
    for (const route of access) {
      expect(connected.document.openings[route.openingId!].kind).toBe('door')
      expect(checkTerrainRoute(result.document, { floorId: 'floor', pointsMm: route.pointsMm, widthMm: route.widthMm }).ok).toBe(true)
      const band = furnitureAccessBand(route.pointsMm, route.widthMm)
      expect(polygonInside(band, roomPoints(result.document, result.document.rooms['room-0']))).toBe(true)
      for (const prop of Object.values(result.document.props)) {
        expect(polygonsOverlap(band, propFootprint(prop))).toBe(false)
        expect(polygonsOverlap(band, furnitureBoundsPolygon(prop.visualBoundsMm, prop))).toBe(false)
      }
    }
    expect(canonicalJson(connected.document)).toBe(before)
    expect(furnishInterior(connected.document, value.input, value.layout, connected.report, options)).toEqual(result)
  })

  it.each(['餐厅', '厨房', '库房'])('keeps complete %s use areas and routes on a separate long-room input', purpose => {
    const value = fixture(9600, 6200)
    value.input.algorithmVersion = 9; value.input.seed = 'functional-heldout'; value.input.parameters.rooms[0].purpose = purpose
    value.input.parameters.arrangement.entrance = true
    const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
    const result = furnishInterior(connected.document, value.input, value.layout, connected.report, options)
    const room = result.report.rooms[0]
    expect(room.placed.length).toBeGreaterThan(2)
    expect(room.circulation!.every(route => route.status === 'clear')).toBe(true)
    for (const route of room.circulation!) {
      const prop = result.document.props[route.propId]
      const use = route.role === 'seat' ? furnitureUseSpacePolygon(prop, prop) : furnitureWorkingSpacePolygon(prop, prop)
      expect(polygonInside(use, roomPoints(result.document, result.document.rooms[room.roomId]))).toBe(true)
      expect(checkTerrainRoute(result.document, { floorId: prop.floorId, pointsMm: route.pointsMm, widthMm: 600 }).ok).toBe(true)
      for (const other of Object.values(result.document.props).filter(p => p.id !== prop.id)) {
        expect(polygonsOverlap(use, propFootprint(other))).toBe(false)
        expect(polygonsOverlap(use, furnitureBoundsPolygon(other.visualBoundsMm, other))).toBe(false)
      }
    }
    expect(checkInteriorCirculation(result.document, value.input, value.layout, connected.report).routes.every((r, i) => connected.report.routes[i].status !== 'clear' || r.status === 'clear')).toBe(true)
  })

  it.each([[6200, 7800], [9400, 6200]])('forms a full bed/cabinet unit in an independent %s by %s room', (width, height) => {
    const value = fixture(width, height)
    value.input.algorithmVersion = 9; value.input.seed = 'bed-unit-heldout'; value.input.parameters.rooms[0].purpose = '客房'
    value.input.parameters.arrangement.entrance = true
    const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
    const result = furnishInterior(connected.document, value.input, value.layout, connected.report, options)
    const rows = result.report.rooms[0].placed, beds = rows.filter(p => p.role === 'bed').map(p => result.document.props[p.propId])
    const storage = rows.filter(p => p.role === 'storage').map(p => result.document.props[p.propId])
    expect(beds.length).toBeGreaterThan(0)
    expect(storage.length).toBeGreaterThan(0)
    expect(storage.some(prop => bedroomStorageCandidates(value.layout.rooms[0].boundsMm, prop, 200, beds, key => key)
      .some(pose => canonicalJson(pose) === canonicalJson({ positionMm: prop.positionMm, rotationDeg: prop.rotationDeg })))).toBe(true)
    expect(result.report.rooms[0].circulation!.every(route => route.status === 'clear')).toBe(true)
  })

  it('does not promote a closed/locked/narrow door into an available port', () => {
    const value = fixture(8000)
    value.input.algorithmVersion = 8; value.input.parameters.arrangement.entrance = true
    const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
    const id = connected.report.entranceOpeningId!
    expect(roomDoorPorts(connected.document, 'room-0', 600, () => {}, () => {})).toHaveLength(1)
    const closed = applyCommands(connected.document, [{ type: 'updateOpening', id, changes: { state: 'closed', locked: true } }], context)
    expect(roomDoorPorts(closed, 'room-0', 600, () => {}, () => {})).toHaveLength(0)
    const result = furnishInterior(closed, value.input, value.layout, checkInteriorCirculation(closed, value.input, value.layout, connected.report), options)
    expect(result.document.openings[id]).toEqual(closed.openings[id])
    expect(result.report.rooms[0].circulation!.every(route => route.status === 'unavailable')).toBe(true)
    const narrow = cloneJson(connected.document); narrow.openings[id].widthMm = 599
    expect(roomDoorPorts(narrow, 'room-0', 600, () => {}, () => {})).toHaveLength(0)
  })

  it('keeps inaccessible locked furniture unchanged, reports the gap and preserves cancelled input', () => {
    const value = fixture(6500, 7500)
    value.input.algorithmVersion = 8; value.input.parameters.rooms[0].purpose = '客房'
    value.input.parameters.arrangement.entrance = true
    const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
    const created = applyCommands(connected.document, [{ type: 'addProp', id: 'protected-bed', floorId: 'floor', layerId: 'layer',
      definitionRef: { id: 'bed', version: 1 }, positionMm: { x: 6250, y: 6750 }, rotationDeg: 37, supportRef: { kind: 'room', id: 'room-0' } }], context)
    const document = applyCommands(created, [{ type: 'setEditLock', kind: 'prop', id: 'protected-bed', locked: true }], context)
    const before = canonicalJson(document), protectedOptions = { ...options, propIdForSlot: () => null }
    const result = furnishInterior(document, value.input, value.layout, connected.report, protectedOptions)
    expect(canonicalJson(result.document)).toBe(before)
    expect(result.report.rooms[0].circulation).toEqual([expect.objectContaining({ propId: 'protected-bed', status: 'unavailable' })])
    let checks = 0
    expect(() => furnishInterior(document, value.input, value.layout, connected.report, { ...protectedOptions,
      checkCancelled() { if (++checks > 10) throw new Error('cancelled') } })).toThrow('cancelled')
    expect(canonicalJson(document)).toBe(before)
  })
})

describe('interior-layout@7 bedroom use and storage', () => {
  it('reports an unfilled bed when its artwork fits but no full bedside strip fits', () => {
    const value = fixture(2100, 3000), bed = value.document.propDefinitions.bed
    bed.defaultVisualBoundsMm = { x: -750, y: -1250, width: 1500, height: 2500 }; bed.defaultFootprintMm = { width: 1100, height: 2100 }
    value.input.parameters.rooms[0].purpose = '卧室'
    const old = furnishInterior(value.document, { ...value.input, algorithmVersion: 6 }, value.layout, emptyConnectivity, options)
    expect(old.report.rooms[0].placed.filter(entry => entry.role === 'bed')).toHaveLength(1)
    const before = canonicalJson(value.document)
    const current = furnishInterior(value.document, { ...value.input, algorithmVersion: 7 }, value.layout, emptyConnectivity, options)
    expect(current.report.rooms[0].placed).toEqual([])
    expect(current.report.notes.some(note => note.includes('床侧使用'))).toBe(true)
    expect(canonicalJson(value.document)).toBe(before)
  })

  it('retains an inaccessible protected non-cardinal bed as a draft and observes cancellation during its read-only check', () => {
    const value = fixture(6500, 7500)
    value.input.algorithmVersion = 7; value.input.parameters.rooms[0].purpose = '客房'
    const created = applyCommands(value.document, [{ type: 'addProp', id: 'protected-bed', floorId: 'floor', layerId: 'layer',
      definitionRef: { id: 'bed', version: 1 }, positionMm: { x: 6250, y: 6750 }, rotationDeg: 37, supportRef: { kind: 'room', id: 'room-0' } }], context)
    const document = applyCommands(created, [{ type: 'setEditLock', kind: 'prop', id: 'protected-bed', locked: true }], context)
    const before = canonicalJson(document), protectedOptions = { ...options, propIdForSlot: () => null }
    const result = furnishInterior(document, value.input, value.layout, emptyConnectivity, protectedOptions)
    expect(canonicalJson(result.document)).toBe(before)
    expect(result.report.notes.some(note => note.includes('保留床当前未找到'))).toBe(true)
    let checks = 0
    expect(() => furnishInterior(document, value.input, value.layout, emptyConnectivity, { ...protectedOptions,
      checkCancelled() { if (++checks > 2) throw new Error('cancelled during protected bed check') } })).toThrow('cancelled during protected bed check')
    expect(canonicalJson(document)).toBe(before)
  })

  it.each([[6500, 7500, 'guest-a'], [5500, 6200, 'guest-independent-b']] as const)('keeps usable beds, retrieval space and real door routes at %s by %s', (width, height, seed) => {
    const value = fixture(width, height, true), bed = value.document.propDefinitions.bed
    bed.defaultVisualBoundsMm = { x: -750, y: -1250, width: 1500, height: 2500 }; bed.defaultFootprintMm = { width: 1100, height: 2100 }
    value.input.algorithmVersion = 7; value.input.seed = seed
    value.input.parameters.rooms.forEach(room => { room.purpose = '客房' })
    const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
    const result = furnishInterior(connected.document, value.input, value.layout, connected.report, options)
    for (const row of result.report.rooms) {
      const room = result.document.rooms[row.roomId], layout = value.layout.rooms.find(room => room.roomId === row.roomId)!
      const beds = row.placed.filter(entry => entry.role === 'bed')
      expect(beds.length).toBeGreaterThan(0)
      for (const entry of beds) {
        const prop = result.document.props[entry.propId]
        const blockers = Object.values(result.document.props).filter(p => p.floorId === prop.floorId)
          .flatMap(p => [propFootprint(p), furnitureBoundsPolygon(p.visualBoundsMm, p)])
        const access = planBedroomAccess({ shape: prop, pose: prop, roomPolygon: roomPoints(result.document, room),
          centerMm: { x: layout.boundsMm.x + width / 2, y: layout.boundsMm.y + height / 2 }, blockers, rank: key => key,
          checkCancelled() {}, chargeCandidate() {}, chargePair() {} })
        expect(access).toBeDefined()
        expect(checkTerrainRoute(result.document, { floorId: prop.floorId, pointsMm: access!.pointsMm, widthMm: 600 }).ok).toBe(true)
      }
      for (const entry of row.placed.filter(entry => entry.role === 'storage')) {
        const prop = result.document.props[entry.propId], use = furnitureWorkingSpacePolygon(prop, prop)
        expect(polygonInside(use, roomPoints(result.document, room))).toBe(true)
        for (const other of Object.values(result.document.props).filter(p => p.id !== prop.id)) expect(polygonsOverlap(use, propFootprint(other))).toBe(false)
      }
    }
    expect(checkInteriorCirculation(result.document, value.input, value.layout, connected.report).routes.every((route, i) => connected.report.routes[i].status !== 'clear' || route.status === 'clear')).toBe(true)
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(furnishInterior(connected.document, value.input, value.layout, connected.report, options)).toEqual(result)
  })
})

describe('interior-layout@6 functional groups', () => {
  it.each([[6500, 7500, 'kitchen-group-a'], [8500, 6000, 'kitchen-independent-b']] as const)('joins an actual kitchen work group at %s by %s while retaining operating clearance', (width, height, seed) => {
    const value = fixture(width, height, true)
    value.input.algorithmVersion = 6; value.input.seed = seed
    value.input.parameters.rooms.forEach(room => { room.purpose = '厨房' })
    const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
    const before = canonicalJson(connected.document), result = furnishInterior(connected.document, value.input, value.layout, connected.report, options)
    for (const row of result.report.rooms) {
      const furniture = row.placed.filter(p => ['work', 'hearth', 'storage', 'shelf'].includes(p.role)).map(p => result.document.props[p.propId])
      expect(furniture.length).toBeGreaterThanOrEqual(5)
      let adjacentPairs = 0
      for (const [at, a] of furniture.entries()) for (const b of furniture.slice(at + 1)) {
        if (a.rotationDeg !== b.rotationDeg) continue
        const angle = a.rotationDeg * Math.PI / 180
        const local = (prop: typeof a) => [...propFootprint(prop), ...furnitureBoundsPolygon(prop.visualBoundsMm, prop)].map(p => ({
          x: Math.round(p.x * Math.cos(angle) + p.y * Math.sin(angle)), y: Math.round(-p.x * Math.sin(angle) + p.y * Math.cos(angle)),
        }))
        const ac = local(a), bc = local(b), backA = Math.min(...ac.map(p => p.y)), backB = Math.min(...bc.map(p => p.y))
        const gap = Math.max(Math.min(...ac.map(p => p.x)) - Math.max(...bc.map(p => p.x)), Math.min(...bc.map(p => p.x)) - Math.max(...ac.map(p => p.x)))
        if (backA === backB && gap === 100) adjacentPairs++
      }
      expect(adjacentPairs).toBeGreaterThanOrEqual(3)
      for (const entry of row.placed.filter(p => p.role === 'work' || p.role === 'hearth')) {
        const prop = result.document.props[entry.propId], working = furnitureWorkingSpacePolygon(prop, prop)
        expect(polygonInside(working, roomPoints(result.document, result.document.rooms[row.roomId]))).toBe(true)
        for (const other of furniture.filter(p => p.id !== prop.id)) expect(polygonsOverlap(working, propFootprint(other))).toBe(false)
      }
    }
    expect(checkInteriorCirculation(result.document, value.input, value.layout, connected.report).routes.every((route, index) => connected.report.routes[index].status !== 'clear' || route.status === 'clear')).toBe(true)
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(canonicalJson(connected.document)).toBe(before)
    expect(furnishInterior(connected.document, value.input, value.layout, connected.report, options)).toEqual(result)
  })

  it('fulfils complete reserved seat definitions before alternatives and leaves no extra seat obligation', () => {
    const value = fixture(6500, 7500)
    value.input.algorithmVersion = 6; value.input.parameters.rooms[0].purpose = '餐厅'
    const alternate = cloneJson(value.document.propDefinitions.seat)
    alternate.id = 'seat-alternate'; alternate.catalogId = 'seat-alternate'
    alternate.defaultFootprintMm = { width: 850, height: 700 }; alternate.defaultVisualBoundsMm = { x: -425, y: -350, width: 850, height: 700 }
    value.document.propDefinitions[alternate.id] = alternate
    value.input.parameters.arrangement.palette.push({ role: 'seat', ref: { id: alternate.id, version: 1 } })
    const result = furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options)
    const row = result.report.rooms[0], seats = row.placed.filter(p => p.role === 'seat')
    expect(seats).toHaveLength(row.recommended.filter(role => role === 'seat').length)
    expect(seats.every(p => p.definitionRef.id === 'seat')).toBe(true)
    for (const entry of seats) {
      const seat = result.document.props[entry.propId], usePolygon = furnitureUseSpacePolygon(seat, seat)
      for (const other of Object.values(result.document.props).filter(p => p.id !== seat.id)) expect(polygonsOverlap(usePolygon, propFootprint(other))).toBe(false)
    }
    const deleted = applyCommands(result.document, [{ type: 'deleteProp', id: seats[0].propId }], context)
    expect(validateSceneDocument(deleted).ok).toBe(true)
    expect(deleted.constraints).toEqual(value.document.constraints)
  })
})

describe('interior-layout@5 functional use-space reservations', () => {
  it('keeps a full standing work strip in a kitchen without inventing seated-work suggestions or persistent rules', () => {
    const value = fixture(6000, 7500)
    value.input.algorithmVersion = 5; value.input.parameters.rooms[0].purpose = '厨房'
    const result = furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options)
    const work = result.report.rooms[0].placed.filter(row => row.role === 'work' || row.role === 'hearth').map(row => result.document.props[row.propId])
    expect(work.length).toBeGreaterThanOrEqual(2)
    expect(result.report.rooms[0].recommended).not.toContain('seat')
    for (const anchor of work) {
      const usePolygon = furnitureWorkingSpacePolygon(anchor, anchor)
      expect(polygonInside(usePolygon, roomPoints(result.document, result.document.rooms[anchor.roomId!]))).toBe(true)
      for (const other of Object.values(result.document.props).filter(prop => prop.id !== anchor.id)) expect(polygonsOverlap(usePolygon, propFootprint(other))).toBe(false)
    }
    expect(result.document.constraints).toEqual(value.document.constraints)
    expect(validateSceneDocument(result.document).ok).toBe(true)
  })

  it('reserves whole chairs and their 600mm rear use space before filling a study with more anchors and storage', () => {
    for (const [width, height, seed] of [[8000, 8000, 'use-space-study'], [6500, 9500, 'independent-use-space']] as const) {
      const value = fixture(width, height, true)
      value.input.algorithmVersion = 5; value.input.seed = seed
      for (const room of value.input.parameters.rooms) room.purpose = '书房与工作室'
      const before = canonicalJson(value.document), connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
      const result = furnishInterior(connected.document, value.input, value.layout, connected.report, options)
      for (const row of result.report.rooms) {
        const work = row.placed.filter(p => p.role === 'work').map(p => result.document.props[p.propId])
        const seats = row.placed.filter(p => p.role === 'seat').map(p => result.document.props[p.propId])
        expect(work.length).toBeGreaterThanOrEqual(2)
        expect(seats.length).toBeGreaterThanOrEqual(work.length)
        for (const anchor of work) expect(Math.min(...seats.map(seat => polygonDistance(propFootprint(seat), propFootprint(anchor))))).toBeLessThanOrEqual(500)
        for (const seat of seats) {
          const usePolygon = furnitureUseSpacePolygon(seat, seat)
          expect(polygonInside(usePolygon, roomPoints(result.document, result.document.rooms[seat.roomId!]))).toBe(true)
          for (const other of Object.values(result.document.props).filter(prop => prop.id !== seat.id)) {
            expect(polygonsOverlap(usePolygon, propFootprint(other))).toBe(false)
            expect(polygonsOverlap(usePolygon, furnitureBoundsPolygon(other.visualBoundsMm, other))).toBe(false)
          }
          expect(seat.footprintMm).toEqual(value.document.propDefinitions.seat.defaultFootprintMm)
        }
      }
      expect(checkInteriorCirculation(result.document, value.input, value.layout, connected.report).routes.every((route, index) => connected.report.routes[index].status !== 'clear' || route.status === 'clear')).toBe(true)
      expect(validateSceneDocument(result.document).ok).toBe(true)
      expect(canonicalJson(value.document)).toBe(before)
      expect(furnishInterior(connected.document, value.input, value.layout, connected.report, options)).toEqual(result)
    }
  }, 30000)

  it('keeps an unseatable work group visibly unfilled rather than pinning the table against a wall', () => {
    const value = fixture(3200, 3200)
    value.input.algorithmVersion = 5; value.input.parameters.rooms[0].purpose = '书房'
    Object.assign(value.document.propDefinitions.work, {
      defaultFootprintMm: { width: 2400, height: 2400 }, defaultVisualBoundsMm: { x: -1200, y: -1200, width: 2400, height: 2400 },
    })
    const legacy = furnishInterior(value.document, { ...value.input, algorithmVersion: 4 }, value.layout, emptyConnectivity, options)
    const current = furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options)
    expect(legacy.report.rooms[0].placed.some(row => row.role === 'work')).toBe(true)
    expect(current.report.rooms[0].placed.some(row => row.role === 'work')).toBe(false)
    expect(current.report.notes.join()).toContain('座位使用空间')
    expect(validateSceneDocument(current.document).ok).toBe(true)
  })
})

describe('interior-layout@4 complete furniture poses', () => {
  it('prefers the longer table edges for chairs and benches across rotations and off-centre bounds, retaining end fallbacks', () => {
    const bounds = { x: 0, y: 0, width: 20000, height: 20000 }
    for (const rotationDeg of [0, 90, 180, 270]) for (const width of [800, 2200]) {
      const anchor: FurnitureAnchor = { role: 'work', positionMm: { x: 10000, y: 10000 }, rotationDeg,
        visualBoundsMm: { x: -1000, y: -500, width: 2400, height: 1000 },
        footprintMm: { width: 2200, height: 800 }, footprintOffsetMm: { x: 200, y: 100 } }
      const shape = { visualBoundsMm: { x: -width / 2, y: -450, width, height: 900 },
        footprintMm: { width: width - 100, height: 800 }, footprintOffsetMm: { x: 50, y: -20 } }
      const local = (point: { x: number; y: number }) => {
        const angle = -rotationDeg * Math.PI / 180, x = point.x - anchor.positionMm.x, y = point.y - anchor.positionMm.y
        return { x: Math.cos(angle) * x - Math.sin(angle) * y, y: Math.sin(angle) * x + Math.cos(angle) * y }
      }
      const isEnd = (point: { x: number; y: number }) => Math.abs(local(point).x - 200) > 1400
      // Force the seed rank to favour short ends; the geometry preference must
      // still win, with the true offset centre and the whole bench preserved.
      const poses = furniturePoseCandidates(bounds, shape, 100, 'seat', [anchor], key => {
        const [x, y] = key.split('/').map(Number); return isEnd({ x, y }) ? '0' : '1'
      })
      expect(poses).toHaveLength(12)
      const firstEnd = poses.findIndex(pose => isEnd(pose.positionMm))
      expect(firstEnd).toBeGreaterThan(0)
      expect(poses.slice(firstEnd).every(pose => isEnd(pose.positionMm))).toBe(true)
      for (const pose of poses) {
        const seat = { ...shape, ...pose }
        expect(polygonDistance(furnitureBoundsPolygon(anchor.visualBoundsMm, anchor), furnitureBoundsPolygon(seat.visualBoundsMm, seat))).toBeCloseTo(180)
      }
    }
  })

  it('keeps a central priority and sliding fallbacks for a single intended chair or a wide bench', () => {
    const anchor: FurnitureAnchor = { role: 'table', positionMm: { x: 8000, y: 8000 }, rotationDeg: 0,
      visualBoundsMm: { x: -1200, y: -500, width: 2400, height: 1000 },
      footprintMm: { width: 2200, height: 800 }, footprintOffsetMm: { x: 0, y: 0 } }
    for (const [width, allowPair] of [[800, false], [2200, true]] as const) {
      const shape = { visualBoundsMm: { x: -width / 2, y: -400, width, height: 800 },
        footprintMm: { width: width - 100, height: 700 }, footprintOffsetMm: { x: 0, y: 0 } }
      const poses = furniturePoseCandidates({ x: 0, y: 0, width: 16000, height: 16000 }, shape, 100, 'seat', [anchor], key => key, undefined, allowPair)
      expect(poses).toHaveLength(12)
      expect(poses.slice(0, 2).every(pose => pose.positionMm.x === 8000)).toBe(true)
      expect(poses.some(pose => pose.positionMm.x !== 8000 && pose.positionMm.y !== 8000)).toBe(true)
    }
  })

  it('serves an empty table before adding to an occupied one and retains arbitrary local seat rotation', () => {
    const bounds = { x: 0, y: 0, width: 30000, height: 18000 }
    const shape = { visualBoundsMm: { x: -400, y: -450, width: 800, height: 900 },
      footprintMm: { width: 700, height: 800 }, footprintOffsetMm: { x: 0, y: 0 } }
    const surface = { visualBoundsMm: { x: -1200, y: -500, width: 2400, height: 1000 },
      footprintMm: { width: 2200, height: 800 }, footprintOffsetMm: { x: 0, y: 0 } }
    const anchors: FurnitureAnchor[] = [
      { ...surface, role: 'table', positionMm: { x: 8000, y: 8000 }, rotationDeg: 0, seatingLoad: 1 },
      { ...surface, role: 'table', positionMm: { x: 22000, y: 8000 }, rotationDeg: 90, seatingLoad: 0 },
    ]
    const poses = furniturePoseCandidates(bounds, shape, 100, 'seat', anchors, key => key, 37)
    const unserved = poses.filter(pose => pose.positionMm.x > 15000)
    expect(poses.slice(0, unserved.length)).toEqual(unserved)
    expect(poses.every(pose => pose.rotationDeg === 37)).toBe(true)
    expect(poses.some(pose => pose.positionMm.x < 15000)).toBe(true)
  })

  it('keeps square and non-cardinal tables neutral instead of guessing a usable edge from their world box', () => {
    const shape = { visualBoundsMm: { x: -300, y: -300, width: 600, height: 600 },
      footprintMm: { width: 600, height: 600 }, footprintOffsetMm: { x: 0, y: 0 } }
    for (const [width, height, rotationDeg] of [[2000, 2000, 0], [2400, 1000, 17]]) {
      const anchor: FurnitureAnchor = { role: 'work', positionMm: { x: 7000, y: 7000 }, rotationDeg,
        visualBoundsMm: { x: -width / 2, y: -height / 2, width, height },
        footprintMm: { width, height }, footprintOffsetMm: { x: 0, y: 0 } }
      const poses = furniturePoseCandidates({ x: 0, y: 0, width: 14000, height: 14000 }, shape, 100, 'seat', [anchor],
        key => key.split('/')[2] === '90' ? '0' : '1')
      expect(poses[0].rotationDeg).toBe(90)
    }
  })

  it('uses a legal short end when both longer edges cannot fit a complete chair', () => {
    const value = fixture(4400, 2400)
    value.input.algorithmVersion = 4
    Object.assign(value.document.propDefinitions.table, {
      defaultFootprintMm: { width: 1800, height: 1500 },
      defaultVisualBoundsMm: { x: -900, y: -750, width: 1800, height: 1500 },
    })
    const document = applyCommands(value.document, [{ type: 'addProp', id: 'retained-table', floorId: 'floor', layerId: 'layer',
      definitionRef: { id: 'table', version: 1 }, positionMm: { x: 5200, y: 4200 }, rotationDeg: 0,
      supportRef: { kind: 'room', id: 'room-0' } }], context)
    const result = furnishInterior(document, value.input, value.layout, emptyConnectivity, {
      ...options, propIdForSlot: slot => slot.role === 'seat' ? 'new-seat' : null,
    })
    expect(result.report.propIds).toEqual(['new-seat'])
    const chair = result.document.props['new-seat']
    expect(Math.abs(chair.positionMm.x - 5200)).toBeGreaterThan(900)
    expect(chair.positionMm.y).toBe(4200)
    expect(result.document.props['retained-table']).toEqual(document.props['retained-table'])
    expect(polygonInside(furnitureBoundsPolygon(chair.visualBoundsMm, chair), roomPoints(document, document.rooms['room-0']))).toBe(true)
    expect(supportedPolygon(result.document, propFootprint(chair), chair.supportRef, chair.floorId)).toBe(true)
    expect(validateSceneDocument(result.document).ok).toBe(true)
  })

  it('fits two complete chairs along the only available long edge instead of consuming it with a central chair', () => {
    const value = fixture(6000)
    value.input.algorithmVersion = 4
    Object.assign(value.document.propDefinitions.table, {
      defaultFootprintMm: { width: 2200, height: 700 },
      defaultVisualBoundsMm: { x: -1200, y: -400, width: 2400, height: 800 },
    })
    Object.assign(value.document.propDefinitions.seat, {
      defaultFootprintMm: { width: 900, height: 800 },
      defaultVisualBoundsMm: { x: -500, y: -450, width: 1000, height: 900 },
    })
    const document = applyCommands(value.document, [{ type: 'addProp', id: 'wall-table', floorId: 'floor', layerId: 'layer',
      definitionRef: { id: 'table', version: 1 }, positionMm: { x: 6000, y: 3600 }, rotationDeg: 0,
      supportRef: { kind: 'room', id: 'room-0' } }], context)
    const result = furnishInterior(document, value.input, value.layout, emptyConnectivity, {
      ...options, propIdForSlot: slot => slot.role === 'seat' && slot.index <= 2 ? `chair-${slot.index}` : null,
    })
    const chairs = result.report.propIds.map(id => result.document.props[id])
    expect(chairs).toHaveLength(2)
    for (const chair of chairs) {
      // The north long edge is outside the room. Both complete chairs must
      // share the south edge, with their whole width beside the desktop.
      expect(chair.positionMm.y).toBeGreaterThan(4000)
      expect(Math.abs(chair.positionMm.x - 6000) + chair.visualBoundsMm.width / 2).toBeLessThanOrEqual(1200)
      expect(polygonInside(furnitureBoundsPolygon(chair.visualBoundsMm, chair), roomPoints(document, document.rooms['room-0']))).toBe(true)
      expect(chair.footprintMm).toEqual(value.document.propDefinitions.seat.defaultFootprintMm)
    }
    expect(polygonDistance(furnitureBoundsPolygon(chairs[0].visualBoundsMm, chairs[0]), furnitureBoundsPolygon(chairs[1].visualBoundsMm, chairs[1]))).toBeGreaterThanOrEqual(100)
    expect(result.document.props['wall-table']).toEqual(document.props['wall-table'])
    expect(validateSceneDocument(result.document).ok).toBe(true)
  })

  it('chooses an authorised study desk or kitchen counter by fixed metadata, retaining legacy palette order', () => {
    const value = fixture(6000)
    const counter = { ...value.document.propDefinitions.work, id: 'a-counter', catalogId: 'test-counter', name: '备餐台', tags: ['kitchen', 'prep'] }
    const desk = { ...value.document.propDefinitions.work, id: 'z-desk', catalogId: 'test-desk', name: '写作书桌', tags: ['study', 'writing'] }
    value.document.propDefinitions[counter.id] = counter; value.document.propDefinitions[desk.id] = desk
    value.input.parameters.arrangement.palette = [desk, counter].map(definition => ({ role: 'work', ref: { id: definition.id, version: 1 } }))
    value.input.parameters.rooms[0].purpose = '调查书房'
    const legacy = furnishInterior(value.document, { ...value.input, algorithmVersion: 3 }, value.layout, emptyConnectivity, options)
    expect(legacy.report.rooms[0].placed.find(row => row.role === 'work')!.definitionRef.id).toBe(counter.id)
    for (const [purpose, expected] of [['调查书房', desk.id], ['厨房', counter.id]]) {
      value.input.parameters.rooms[0].purpose = purpose
      const result = furnishInterior(value.document, { ...value.input, algorithmVersion: 4 }, value.layout, emptyConnectivity, options)
      const placed = result.report.rooms[0].placed.filter(row => row.role === 'work')
      expect(placed.length).toBeGreaterThan(1)
      expect(placed.every(row => row.definitionRef.id === expected)).toBe(true)
      for (const row of placed) expect(result.document.props[row.propId].footprintMm).toEqual(value.document.propDefinitions[expected].defaultFootprintMm)
      expect(validateSceneDocument(result.document).ok).toBe(true)
    }
  })

  it('fits a long bed in a narrow room by turning its actual footprint and image, without changing old replay', () => {
    const value = fixture(3000, 5500)
    value.input.parameters.rooms[0].purpose = '卧室'
    value.input.parameters.arrangement.palette = [{ role: 'bed', ref: { id: 'bed', version: 1 } }]
    Object.assign(value.document.propDefinitions.bed, {
      defaultFootprintMm: { width: 3500, height: 1500 }, defaultFootprintOffsetMm: { x: 150, y: -50 },
      defaultVisualBoundsMm: { x: -1900, y: -800, width: 4000, height: 1700 },
    })
    const before = canonicalJson(value.document)
    for (const version of [2, 3] as const) {
      const old = furnishInterior(value.document, { ...value.input, algorithmVersion: version }, value.layout, emptyConnectivity, options)
      expect(old.report.propIds).toHaveLength(0)
      expect(old.report.notes.join()).toContain('未找到')
    }
    value.input.algorithmVersion = 4
    const result = furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options)
    expect(result.report.propIds).toHaveLength(1)
    const prop = result.document.props[result.report.propIds[0]], definition = value.document.propDefinitions.bed
    expect([90, 270]).toContain(prop.rotationDeg)
    expect(prop.footprintMm).toEqual(definition.defaultFootprintMm)
    expect(prop.footprintOffsetMm).toEqual(definition.defaultFootprintOffsetMm)
    expect(prop.visualBoundsMm).toEqual(definition.defaultVisualBoundsMm)
    expect(polygonInside(furnitureBoundsPolygon(prop.visualBoundsMm, prop), roomPoints(result.document, result.document.rooms['room-0']))).toBe(true)
    expect(supportedPolygon(result.document, propFootprint(prop), prop.supportRef, prop.floorId)).toBe(true)
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(canonicalJson(value.document)).toBe(before)
    expect(furnishInterior(value.document, value.input, value.layout, emptyConnectivity, options)).toEqual(result)
  })

  it('places office seats by a real work surface while preserving clear door routes on independent shapes and seeds', () => {
    for (const [width, height, seed] of [[8000, 8000, 'office-review'], [6500, 9500, 'unseen-study']] as const) {
      const value = fixture(width, height, true)
      value.input.algorithmVersion = 4; value.input.seed = seed
      for (const room of value.input.parameters.rooms) room.purpose = '调查书房与办公'
      const connected = arrangeInteriorConnections(value.document, value.input, value.layout, options)
      const result = furnishInterior(connected.document, value.input, value.layout, connected.report, options)
      for (const row of result.report.rooms) {
        const work = row.placed.filter(p => p.role === 'work').map(p => result.document.props[p.propId])
        const seats = row.placed.filter(p => p.role === 'seat').map(p => result.document.props[p.propId])
        expect(work.length).toBeGreaterThanOrEqual(2)
        expect(seats.length).toBeGreaterThan(0)
        for (const seat of seats) expect(Math.min(...work.map(anchor => polygonDistance(propFootprint(seat), propFootprint(anchor))))).toBeLessThanOrEqual(500)
        for (const anchor of work) expect(Math.min(...seats.map(seat => polygonDistance(propFootprint(seat), propFootprint(anchor))))).toBeLessThanOrEqual(500)
      }
      const after = checkInteriorCirculation(result.document, value.input, value.layout, connected.report)
      expect(after.routes.every((route, i) => connected.report.routes[i].status !== 'clear' || route.status === 'clear')).toBe(true)
    }
  })

  it('retains an existing rotated member and suppresses protected slots during local rearrangement', () => {
    const value = fixture(6000, 7500)
    value.input.algorithmVersion = 4; value.input.parameters.rooms[0].purpose = '卧室'
    value.input.parameters.arrangement.palette = [{ role: 'bed', ref: { id: 'bed', version: 1 } }]
    const document = applyCommands(value.document, [{ type: 'addProp', id: 'retained-bed', floorId: 'floor', layerId: 'layer',
      definitionRef: { id: 'bed', version: 1 }, positionMm: { x: 5000, y: 6000 }, rotationDeg: 37, supportRef: { kind: 'room', id: 'room-0' } }], context)
    const original = document.props['retained-bed']
    const result = furnishInterior(document, value.input, value.layout, emptyConnectivity, { ...options, rankSalt: 'new-arrangement',
      propIdForSlot: slot => slot.role === 'bed' && slot.index === 0 ? original.id : null,
      existingPropForSlot: slot => slot.role === 'bed' && slot.index === 0 ? original.id : null })
    expect(result.report.propIds).toEqual([original.id])
    expect({ ...result.document.props[original.id], positionMm: original.positionMm }).toEqual(original)
    expect(polygonInside(furnitureBoundsPolygon(original.visualBoundsMm, result.document.props[original.id]), roomPoints(document, document.rooms['room-0']))).toBe(true)
    expect(result.report.notes.join()).toContain('人工保留')
    expect(validateSceneDocument(result.document).ok).toBe(true)
  })
})
