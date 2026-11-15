import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { generationRecipeSchema } from '../../../terrain-generation/contracts.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { resolveBuildingEntrancePort } from '../../building-port.js'
import { createDomainExecutionRequest, executeDomainExecutionRequest, parseDomainExecutionResponse } from '../../execution.js'
import type { SceneDocument } from '../../../model/scene.js'
import { normalizeInteriorInput, normalizeSupportedInteriorInput, runInteriorGeneration, runSupportedInteriorGeneration,
  checkInteriorLayout, clearArea, rectanglePoints, type InteriorGenerationInput, type InteriorLayout } from './index.js'

const options = { profile: taskBudgetProfile('small'), nowMilliseconds: () => 0 }
const source = (sceneId = 'directed-entry') => createShoreBlankDocument('island', { sceneId, title: '入口房间', now: '2026-11-14T00:00:00.000Z', widthMm: 20000, heightMm: 16000, preset: 'narrative' })
function request(entranceRoomRequirementId?: string): InteriorGenerationInput {
  return { version: 1, algorithmVersion: 20, seed: 'directed-entrance', parameters: {
    floorId: 'visual-floor', layerId: 'visual-layer-ground', boundsMm: { x: 1000, y: 1000, width: 18000, height: 14000 }, wallThicknessMm: 200,
    rooms: ['reception', 'study'].map(id => ({ id, purpose: '同名房间', minAreaMm2: 4_000_000, maxAreaMm2: 240_000_000, minClearSideMm: 1500 })),
    relations: [], corridor: { axis: 'none', clearWidthMm: 1200 }, materials: { floor: null, wall: null },
    arrangement: { doors: true, entrance: true, furniture: false, doorWidthMm: 1400, clearWidthMm: 1000, palette: [], ...(entranceRoomRequirementId ? { entranceRoomRequirementId } : {}) },
  } }
}
function entranceOwner(document: SceneDocument, openingId: string) {
  const opening = document.openings[openingId], wall = document.walls[opening.wallId]
  return Object.values(document.rooms).filter(room => room.boundaryVertexIds.some((id, index, ring) => {
    const next = ring[(index + 1) % ring.length]
    return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId
  })).map(room => room.id)
}

describe('explicit first entrance room at interior algorithm20', () => {
  it.each(['reception', 'study'])('enters stable demand %s even with identical purpose text and retains exact replay', selected => {
    const base = source(), before = canonicalJson(base), input = request(selected), result = runInteriorGeneration(base, input, options)
    const d = cloneJson(result.candidate.document) as SceneDocument, entranceId = result.report.connectivity.entranceOpeningId!
    expect(entranceOwner(d, entranceId)).toEqual([result.layout.rooms.find(room => room.requirementId === selected)!.roomId])
    expect(d.constraints.entranceOpeningIds).toEqual([entranceId])
    expect(d.openings[entranceId]).toMatchObject({ kind: 'door', state: 'open', locked: false, widthMm: 1400 })
    expect(result.report.connectivity.routes.find(route => route.openingId === entranceId), JSON.stringify(result.report.connectivity)).toMatchObject({ fromRoomId: null, status: 'clear' })
    expect(validateSceneDocument(d).ok).toBe(true)
    expect(runInteriorGeneration(base, input, options)).toEqual(result)
    expect(canonicalJson(base)).toBe(before)
    const recipe = Object.values(getLegacyGeneration(d)!.recipes)[0]
    expect(generationRecipeSchema.parse(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe)
    expect(recipe).toMatchObject({ recipeVersion: 20, algorithmVersion: 20, parameters: { arrangement: { entranceRoomRequirementId: selected } } })
    for (const version of [2, 19]) {
      expect(generationRecipeSchema.safeParse({ ...recipe, recipeVersion: version, algorithmVersion: version }).success).toBe(false)
      expect(() => normalizeInteriorInput({ ...input, algorithmVersion: version })).toThrow(/算法20/)
    }
    expect(generationRecipeSchema.safeParse({ ...recipe, recipeVersion: 19 }).success).toBe(false)
    // Closing/locking a saved entry remains a normal edit, not a replay failure.
    const edited = applyCommands(d, [{ type: 'updateOpening', id: entranceId, changes: { state: 'closed', locked: true } }], { ids: { nextId: () => 'unused' }, clock: { now: () => d.updatedAt } })
    expect(validateSceneDocument(edited).ok).toBe(true)
    expect(getLegacyGeneration(edited)!.recipes).toEqual(getLegacyGeneration(d)!.recipes)
  })

  it('leaves unselected20 geometry and first arrangement identical to19', () => {
    const input = request(), base = source(), before = runInteriorGeneration(base, { ...input, algorithmVersion: 19 }, options), after = runInteriorGeneration(base, input, options)
    expect(after.layout).toEqual(before.layout)
    expect(after.report).toEqual(before.report)
    for (const key of ['vertices', 'rooms', 'walls', 'openings', 'props', 'constraints'] as const) expect(after.candidate.document[key]).toEqual(before.candidate.document[key])
    expect(after.resultHash).not.toBe(before.resultHash) // Explicit recipe/operator identity changes.
  })

  it('rejects unknown demands, disabled entrances and legacy own-present fields before generation', () => {
    expect(() => normalizeInteriorInput(request('missing'))).toThrow(/现存需求/)
    const disabled = request('study'); disabled.parameters.arrangement.entrance = false
    expect(() => normalizeInteriorInput(disabled)).toThrow(/启用对外入口/)
    const old = request(); old.algorithmVersion = 19
    old.parameters.arrangement.entranceRoomRequirementId = undefined
    expect(() => normalizeInteriorInput(old)).toThrow()
  })

  it('refuses an interior-only demand in a complete layout instead of choosing another room', () => {
    const input = request('center'), rects = [
      ['top', { x: 1100, y: 1100, width: 9800, height: 2000 }], ['left', { x: 1100, y: 3100, width: 2000, height: 4000 }],
      ['center', { x: 3100, y: 3100, width: 4000, height: 4000 }], ['right', { x: 7100, y: 3100, width: 3800, height: 4000 }],
      ['bottom', { x: 1100, y: 7100, width: 9800, height: 3800 }],
    ] as const
    input.parameters.boundsMm = { x: 1000, y: 1000, width: 10000, height: 10000 }
    input.parameters.rooms = rects.map(([id]) => ({ id, purpose: id, minAreaMm2: 1_000_000, maxAreaMm2: 100_000_000, minClearSideMm: 1000 }))
    const layout: InteriorLayout = { rooms: rects.map(([requirementId, boundsMm]) => ({ requirementId, roomId: requirementId, boundsMm, clearAreaMm2: clearArea(boundsMm, 200) })), corridors: [] }
    expect(checkInteriorLayout(input, layout)).toEqual([expect.stringContaining('指定入口房间')])
    delete input.parameters.arrangement.entranceRoomRequirementId
    expect(checkInteriorLayout(input, layout)).toEqual([])
  })

  it('rejects unusable actual end clearance and oversized doors, cancellation and work limits without source changes', () => {
    const base = source(), input = request('study')
    base.constraints.wallEndClearanceMm = 10000
    const before = canonicalJson(base)
    expect(() => runInteriorGeneration(base, input, options)).toThrow(/指定入口房间/)
    expect(canonicalJson(base)).toBe(before)
    const tiny = request('study'); tiny.parameters.boundsMm = { x: 1000, y: 1000, width: 4000, height: 4000 }; tiny.parameters.arrangement.doorWidthMm = 5000
    tiny.parameters.rooms.forEach(room => { room.minAreaMm2 = 1_000_000; room.minClearSideMm = 1000 })
    expect(() => runInteriorGeneration(source(), tiny, options)).toThrow(/有限|预算/)
    expect(() => runInteriorGeneration(source(), input, { ...options, signal: { aborted: true } })).toThrow(/取消/)
    const profile = cloneJson(options.profile); profile.limits.gridNodes = 1
    expect(() => runInteriorGeneration(source(), input, { ...options, profile })).toThrow(/预算|有限/)
  })

  it('keeps requested demand and real doorway geometry independent of project identity', () => {
    const input = request('study'), first = runInteriorGeneration(source(), input, options), other = runInteriorGeneration(source('other-scene'), input, options)
    expect(other.layout.rooms.map(room => [room.requirementId, room.boundsMm])).toEqual(first.layout.rooms.map(room => [room.requirementId, room.boundsMm]))
    const doorGeometry = (r: typeof first) => {
      const d = r.candidate.document, opening = d.openings[r.report.connectivity.entranceOpeningId!], wall = d.walls[opening.wallId]
      return [d.vertices[wall.startVertexId].xMm, d.vertices[wall.startVertexId].yMm, d.vertices[wall.endVertexId].xMm, d.vertices[wall.endVertexId].yMm, opening.widthMm, opening.offsetMm]
    }
    expect(doorGeometry(other)).toEqual(doorGeometry(first))
  })

  it('roundtrips20 through the public domain request and verified response', () => {
    const prepared = createDomainExecutionRequest({ requestId: 'directed-transport', context: { workspaceId: 'workspace', checkpoint: 0, epoch: 0 }, domain: 'interior', base: source(), input: request('study'), profile: options.profile })
    const response = executeDomainExecutionRequest(JSON.parse(JSON.stringify(prepared)), { nowMilliseconds: () => 0 })
    const checked = parseDomainExecutionResponse(JSON.parse(JSON.stringify(response)), prepared)
    expect(checked.result).toEqual(runInteriorGeneration(source(), request('study'), options))
  })

  it('selects a supported20 doorway and full-width approach while preserving existing explicit entrances', () => {
    let base = source(), sequence = 0
    const runtime = { ids: { nextId: () => `prior-structure-${sequence++}` }, clock: { now: () => base.updatedAt } }
    base = applyCommands(base, [
      { type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectanglePoints({ x: 0, y: 0, width: 20000, height: 16000 }), groundElevationMm: 0 },
      { type: 'createRoom', id: 'prior-room', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectanglePoints({ x: 1000, y: 1000, width: 2000, height: 2000 }), thicknessMm: 200, supportRef: { kind: 'terrainArea', id: 'ground' } },
      { type: 'addOpening', id: 'prior-entry', wallId: 'prior-room:wall:0', offsetReferenceVertexId: 'prior-room:vertex:0', offsetMm: 500, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false, layerId: 'visual-layer-ground' },
      { type: 'setEntranceOpenings', ids: ['prior-entry'] },
    ], runtime)
    const input = request('study'); input.parameters.boundsMm = { x: 6000, y: 4000, width: 8000, height: 8000 }
    const supported = { ...input, algorithmVersion: 20 as const, parameters: { ...input.parameters, supportRef: { kind: 'terrainArea' as const, id: 'ground' }, entranceApproach: { fromMm: { x: 2000, y: 8000 }, viaMm: [], widthMm: 1000 } } }
    const before = canonicalJson(base), result = runSupportedInteriorGeneration(base, supported, options), d = cloneJson(result.candidate.document) as SceneDocument
    const entranceId = result.report.connectivity.entranceOpeningId!, port = resolveBuildingEntrancePort(d, entranceId, 1000)
    expect(port.roomId).toBe(result.layout.rooms.find(room => room.requirementId === 'study')!.roomId)
    expect(d.constraints.entranceOpeningIds).toEqual(['prior-entry', entranceId])
    for (const key of ['rooms', 'walls', 'vertices', 'openings', 'terrainAreas'] as const) for (const [id, row] of Object.entries(base[key])) expect(d[key][id]).toEqual(row)
    expect(result.report.connectivity.routes.every(route => route.status === 'clear')).toBe(true)
    expect(checkTerrainRoute(d, { floorId: port.floorId, pointsMm: [port.outsideMm, port.insideMm], widthMm: 1000 }).ok).toBe(true)
    expect(canonicalJson(base)).toBe(before)
    const recipe = Object.values(getLegacyGeneration(d)!.recipes)[0]
    expect(generationRecipeSchema.parse(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe)
    expect(() => normalizeSupportedInteriorInput({ ...supported, algorithmVersion: 19 })).toThrow()
    expect(generationRecipeSchema.safeParse({ ...recipe, algorithmVersion: 19, recipeVersion: 19 }).success).toBe(false)
  })
})
