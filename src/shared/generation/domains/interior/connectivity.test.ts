import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../../commands/commands.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { taskBudgetProfile, withExecutionWorkObserver } from '../../../budget/task-budget.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import type { InteriorGenerationInput, InteriorLayout } from './contracts.js'
import { arrangeInteriorConnections, checkInteriorCirculation, interiorDoorReservations } from './connectivity.js'

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
