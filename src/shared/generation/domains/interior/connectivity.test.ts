import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../../commands/commands.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { taskBudgetProfile, withExecutionWorkObserver } from '../../../budget/task-budget.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import type { SceneDocument } from '../../../model/scene.js'
import type { InteriorGenerationInput, InteriorLayout } from './contracts.js'
import { arrangeInteriorConnections, checkInteriorCirculation, replanInteriorCirculation, inspectInteriorConnections, interiorDoorReservations } from './connectivity.js'

const options = { profile: taskBudgetProfile('small'), checkCancelled() {} }
function fixture() {
  const base = createShoreBlankDocument('island', { sceneId: 'interior-connectivity', title: '门路建议', now: '2026-11-05T00:00:00.000Z', widthMm: 20000, heightMm: 16000, preset: 'narrative' })
  let id = 0
  const runtime = { ids: { nextId: () => `wall-native-${id++}` }, clock: { now: () => base.updatedAt } }
  const rectangle = (x: number) => [{ x, y: 2000 }, { x: x + 5000, y: 2000 }, { x: x + 5000, y: 12000 }, { x, y: 12000 }]
  const document = applyCommands(base, ['a', 'b'].map((room, index) => ({ type: 'createRoom' as const, id: room, floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(2000 + index * 5000), thicknessMm: 200, supportRef: { kind: 'floor' as const, id: 'visual-floor' } })), runtime)
  const input: InteriorGenerationInput = { version: 1, algorithmVersion: 2, seed: 'doors-fixed', parameters: { floorId: 'visual-floor', layerId: 'visual-layer-ground', boundsMm: { x: 1900, y: 1900, width: 10200, height: 10200 }, wallThicknessMm: 200,
    rooms: ['a', 'b'].map(room => ({ id: room, purpose: room, minAreaMm2: 4_000_000, maxAreaMm2: 80_000_000, minClearSideMm: 1000 })), relations: [], corridor: { axis: 'none', clearWidthMm: 1500 }, materials: { floor: null, wall: null },
    arrangement: { doors: true, entrance: true, furniture: false, doorWidthMm: 1200, clearWidthMm: 1000, palette: [] } } }
  const layout: InteriorLayout = { rooms: ['a', 'b'].map((room, index) => ({ requirementId: room, roomId: room, boundsMm: { x: 2000 + index * 5000, y: 2000, width: 5000, height: 10000 }, clearAreaMm2: 4800 * 9800 })), corridors: [] }
  return { document, input, layout, runtime }
}

describe('initial interior doors and circulation suggestions', () => {
  function blocker(document: SceneDocument, positionMm = { x: 5500, y: 7000 }, height = 1200) {
    const next = cloneJson(document)
    next.props.blocker = { id: 'blocker', floorId: 'visual-floor', editLocked: true, definitionRef: null,
      appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
      visualBoundsMm: { x: -250, y: -height / 2, width: 500, height }, positionMm, rotationDeg: 0,
      footprintMm: { width: 500, height }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: true, blocksSight: false,
      visibility: 'public', roomId: 'a', supportRef: { kind: 'room', id: 'a' }, renderLayer: 'object', renderOrder: 0,
      shadowClass: 'none', shadowOverride: null }
    next.entityLayers.blocker = 'visual-layer-ground'
    return next
  }

  it('replans an obstructed route through the same door at the exact original endpoints and width', () => {
    const { document, input, layout } = fixture()
    input.algorithmVersion = 17
    const connected = arrangeInteriorConnections(document, input, layout, options), blocked = blocker(connected.document)
    const original = connected.report.routes.find(route => route.fromRoomId !== null)!
    expect(checkInteriorCirculation(blocked, input, layout, connected.report).routes.find(r => r.id === original.id)!.status).toBe('unavailable')
    const before = canonicalJson(blocked), reportBefore = canonicalJson(connected.report)
    let nodes = 0, pairs = 0
    const replanned = withExecutionWorkObserver(delta => { nodes += delta.gridNodes ?? 0; pairs += delta.intersectionPairs ?? 0 },
      () => replanInteriorCirculation(blocked, input, layout, connected.report, options))
    const actual = replanned.routes.find(route => route.id === original.id)!
    expect(actual).toMatchObject({ id: original.id, fromRoomId: original.fromRoomId, toRoomId: original.toRoomId,
      openingId: original.openingId, from: original.from, to: original.to, widthMm: original.widthMm, status: 'clear' })
    expect(actual.pointsMm).not.toEqual(original.pointsMm)
    expect(checkTerrainRoute(blocked, { floorId: input.parameters.floorId, pointsMm: actual.pointsMm, widthMm: actual.widthMm }).ok).toBe(true)
    expect(checkInteriorCirculation(blocked, input, layout, replanned).routes.every(r => r.status === 'clear')).toBe(true)
    expect(inspectInteriorConnections(blocked, input, layout, options).routes.every(r => r.status === 'clear')).toBe(true)
    expect(nodes).toBeGreaterThan(0); expect(pairs).toBeGreaterThan(0)
    expect(replanInteriorCirculation(blocked, input, layout, connected.report, options)).toEqual(replanned)
    expect(canonicalJson(blocked)).toBe(before); expect(canonicalJson(connected.report)).toBe(reportBefore)
  })

  it('retains unavailable status for a blocked endpoint, a full split and doors without usable width or state', () => {
    const { document, input, layout, runtime } = fixture()
    input.algorithmVersion = 17
    const connected = arrangeInteriorConnections(document, input, layout, options)
    const original = connected.report.routes.find(route => route.fromRoomId !== null)!
    const endpoint = original.fromRoomId === 'a' ? original.from : original.to
    const cases = [blocker(connected.document, endpoint), blocker(connected.document, { x: 5500, y: 7000 }, 9600),
      applyCommands(connected.document, [{ type: 'updateOpening', id: original.openingId, changes: { state: 'closed' } }], runtime),
      applyCommands(connected.document, [{ type: 'updateOpening', id: original.openingId, changes: { locked: true } }], runtime),
      applyCommands(connected.document, [{ type: 'deleteOpening', id: original.openingId }], runtime)]
    for (const candidate of cases) {
      const before = canonicalJson(candidate)
      const actual = replanInteriorCirculation(candidate, input, layout, connected.report, options).routes.find(r => r.id === original.id)!
      expect(actual.status).toBe('unavailable'); expect(actual.openingId).toBe(original.openingId)
      expect(actual.from).toEqual(original.from); expect(actual.to).toEqual(original.to); expect(actual.widthMm).toBe(1000)
      expect(canonicalJson(candidate)).toBe(before)
    }
    const swapped = cloneJson(connected.report)
    swapped.routes.find(r => r.id === original.id)!.openingId = connected.report.entranceOpeningId!
    expect(replanInteriorCirculation(connected.document, input, layout, swapped, options).routes.find(r => r.id === original.id)!.status).toBe('unavailable')
    const wider = cloneJson(connected.report)
    wider.routes.find(r => r.id === original.id)!.widthMm = 1300
    expect(replanInteriorCirculation(connected.document, input, layout, wider, options).routes.find(r => r.id === original.id)!).toMatchObject({ status: 'unavailable', widthMm: 1300 })
  })

  it('rederives physical passage from current content even when an image overhang prevents a preferred painted-body route', () => {
    const { document, input, layout } = fixture()
    input.algorithmVersion = 17
    const connected = arrangeInteriorConnections(document, input, layout, options), blocked = blocker(connected.document)
    blocked.props.blocker.visualBoundsMm = { x: -250, y: -4900, width: 500, height: 9800 }
    const original = connected.report.routes.find(route => route.fromRoomId !== null)!, before = canonicalJson(blocked)
    expect(replanInteriorCirculation(blocked, input, layout, connected.report, options).routes.find(r => r.id === original.id)!.status).toBe('unavailable')
    const inspected = inspectInteriorConnections(blocked, input, layout, options)
    expect(inspected.routes.every(route => route.status === 'clear')).toBe(true)
    for (const route of inspected.routes) expect(checkTerrainRoute(blocked, { floorId: input.parameters.floorId, pointsMm: route.pointsMm, widthMm: route.widthMm }).ok).toBe(true)
    expect(canonicalJson(blocked)).toBe(before)
  })

  it('propagates cancellation and execution accounting failures without changing the document or route evidence', () => {
    const { document, input, layout } = fixture()
    input.algorithmVersion = 17
    const connected = arrangeInteriorConnections(document, input, layout, options), blocked = blocker(connected.document)
    const before = canonicalJson({ blocked, report: connected.report })
    let checks = 0
    expect(() => replanInteriorCirculation(blocked, input, layout, connected.report, { ...options,
      checkCancelled() { if (++checks > 20) throw Error('cancelled graph') } })).toThrow('cancelled graph')
    let nodes = 0
    expect(() => withExecutionWorkObserver(delta => { nodes += delta.gridNodes ?? 0; if (nodes > 3) throw Error('execution node budget') },
      () => replanInteriorCirculation(blocked, input, layout, connected.report, options))).toThrow('execution node budget')
    expect(canonicalJson({ blocked, report: connected.report })).toBe(before)
  })

  it('creates native shared/exterior doors with real full-width routes and no ongoing requirements', () => {
    const { document, input, layout } = fixture(), before = canonicalJson(document)
    let observed = 0
    const result = withExecutionWorkObserver(delta => { observed += delta.fieldEvaluations ?? 0 }, () => arrangeInteriorConnections(document, input, layout, options))
    expect(observed).toBeGreaterThan(0)
    expect(result.report.openingIds).toHaveLength(2)
    expect(result.report.entranceOpeningId).not.toBeNull()
    expect(result.report.routes.filter(route => route.status !== 'clear')).toEqual([])
    expect(result.report.routes.some(route => route.fromRoomId === null)).toBe(true)
    expect(interiorDoorReservations(result.document, result.report, 1000)).toHaveLength(2)
    expect(result.document.constraints.entranceOpeningIds).toEqual([])
    expect(result.document.constraints.pathChecks).toEqual([])
    expect(Object.values(result.document.rooms).every(room => room.accessExpectation === 'unspecified')).toBe(true)
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(arrangeInteriorConnections(document, input, layout, options)).toEqual(result)
    expect(canonicalJson(document)).toBe(before)
  })

  it('reports a closed door or actual rotated furniture blocker without enforcing or repairing them', () => {
    const { document, input, layout, runtime } = fixture(), result = arrangeInteriorConnections(document, input, layout, options)
    const interior = result.report.routes.find(route => route.fromRoomId !== null)!
    const closed = applyCommands(result.document, [{ type: 'updateOpening', id: interior.openingId, changes: { state: 'closed' } }], runtime)
    expect(checkInteriorCirculation(closed, input, layout, result.report).routes.find(route => route.id === interior.id)).toMatchObject({ status: 'unavailable', notes: [expect.stringContaining('关闭')] })
    const swapped = cloneJson(result.report)
    swapped.routes.find(route => route.id === interior.id)!.openingId = result.report.entranceOpeningId!
    expect(checkInteriorCirculation(result.document, input, layout, swapped).routes.find(route => route.id === interior.id)!.status).toBe('unavailable')
    const outside = cloneJson(result.report), forged = outside.routes.find(route => route.id === interior.id)!
    forged.pointsMm = [forged.from, { x: 1000, y: 14000 }, { x: 15000, y: 14000 }, forged.to]
    expect(checkInteriorCirculation(result.document, input, layout, outside).routes.find(route => route.id === forged.id)!.status).toBe('unavailable')
    const deleted = applyCommands(closed, [{ type: 'deleteOpening', id: interior.openingId }], runtime)
    expect(deleted.openings[interior.openingId]).toBeUndefined()
    expect(validateSceneDocument(deleted).ok).toBe(true)
    const blocked = cloneJson(result.document), roomId = interior.fromRoomId!
    blocked.props.blocker = { id: 'blocker', floorId: input.parameters.floorId, editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
      visualBoundsMm: { x: -400, y: -400, width: 800, height: 800 }, positionMm: { ...interior.from }, rotationDeg: 30,
      footprintMm: { width: 800, height: 800 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: true, blocksSight: false, visibility: 'public', roomId, supportRef: { kind: 'room', id: roomId }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
    blocked.entityLayers.blocker = input.parameters.layerId
    expect(validateSceneDocument(blocked).ok).toBe(true)
    const checked = checkInteriorCirculation(blocked, input, layout, result.report)
    expect(checked.routes.find(route => route.id === interior.id)).toMatchObject({ status: 'unavailable' })
    expect(checked.routes.find(route => route.id === interior.id)!.notes.join('')).toMatch(/真实旋转占地/)
  })

  it('keeps a legitimate layout with unmet width or forbidden connection suggestions', () => {
    const { document, input, layout } = fixture()
    input.parameters.arrangement.clearWidthMm = 2000
    const tooWide = arrangeInteriorConnections(document, input, layout, options)
    expect(tooWide.report.openingIds).toHaveLength(2)
    expect(tooWide.report.routes.every(route => route.status === 'unavailable')).toBe(true)
    expect(tooWide.report.notes.join('')).toMatch(/实际门净宽/)
    input.parameters.relations = [{ a: 'a', b: 'b', kind: 'no-direct-connection', minimumSharedWallMm: 0 }]
    input.parameters.arrangement.entrance = false
    const separate = arrangeInteriorConnections(document, input, layout, options)
    expect(separate.report.openingIds).toEqual([])
    expect(Object.keys(separate.document.rooms)).toHaveLength(2)
    expect(validateSceneDocument(separate.document).ok).toBe(true)
    expect(() => arrangeInteriorConnections(document, input, layout, { ...options, checkCancelled() { throw new Error('取消') } })).toThrow(/取消/)
  })
})
