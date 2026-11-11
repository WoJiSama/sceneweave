import { describe, expect, it } from 'vitest'
import { applyCommands } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { polygonDistance, polygonInside, propFootprint, roomPoints, supportedPolygon } from '../../../geometry/geometry.js'
import { toCurrentSceneDocument } from '../../../model/current-scene.js'
import type { PropDefinition, SceneDocument } from '../../../model/scene.js'
import { canonicalJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { furnishInterior } from './furnishing.js'
import { arrangeInteriorConnections, checkInteriorCirculation, type InteriorConnectivityReport } from './connectivity.js'
import type { InteriorGenerationInput, InteriorLayout } from './contracts.js'
import { interiorEntityId } from './layout.js'
import { furnitureBoundsPolygon, furniturePoseCandidates, type FurnitureAnchor } from './furnishing-poses.js'

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
