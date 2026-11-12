import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../../../platform/browser/content/shore-blank.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { createCompositionContent } from '../../../appearance/graph.js'
import { applyCompositionCommands } from '../../../appearance/commands.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { generationRecipeSchema } from '../../../terrain-generation/contracts.js'
import type { SceneDocument } from '../../../model/scene.js'
import { normalizeInteriorInput, runInteriorGeneration, InteriorGenerationError, checkMaterializedInterior, type InteriorGenerationInput } from './index.js'

const source = () => createShoreBlankDocument('island', { sceneId: 'interior-test', title: '室内布局', now: '2026-11-05T00:00:00.000Z', widthMm: 20000, heightMm: 16000, preset: 'narrative' })
function request(count = 2): InteriorGenerationInput {
  return { version: 1, algorithmVersion: 2, seed: 'rooms-stable', parameters: { floorId: 'visual-floor', layerId: 'visual-layer-ground', boundsMm: { x: 1000, y: 1000, width: 18000, height: 14000 }, wallThicknessMm: 200,
    rooms: Array.from({ length: count }, (_, i) => ({ id: `room-${i}`, purpose: ['大厅', '书房', '厨房', '客房'][i % 4], minAreaMm2: 8_000_000, maxAreaMm2: 240_000_000, minClearSideMm: 2000 })),
    relations: count === 2 ? [{ a: 'room-0', b: 'room-1', kind: 'adjacent', minimumSharedWallMm: 2000 }] : [], corridor: { axis: 'none', clearWidthMm: 1500 }, materials: { floor: null, wall: null }, arrangement: { doors: false, entrance: false, furniture: false, doorWidthMm: 1200, clearWidthMm: 1000, palette: [] } } }
}
const options = { profile: taskBudgetProfile('small'), nowMilliseconds: () => 0 }
let sequence = 0
const runtime = { ids: { nextId: () => `interior-token-${sequence++}` }, clock: { now: () => '2026-11-05T00:00:00.000Z' } }

describe('parameterized finite interior generation', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10] as const)('persists and replays version %s without accepting mismatched selectors', algorithmVersion => {
    const input = request(); input.algorithmVersion = algorithmVersion
    const generated = runInteriorGeneration(source(), input, options)
    const recipe = Object.values(getLegacyGeneration(cloneJson(generated.candidate.document) as SceneDocument)!.recipes)[0]
    expect(runInteriorGeneration(source(), input, options)).toEqual(generated)
    expect(generated.candidate.stages.every(stage => stage.operator.version === algorithmVersion)).toBe(true)
    expect(recipe).toMatchObject({ recipeVersion: algorithmVersion, algorithmId: 'interior-layout', algorithmVersion })
    expect(generationRecipeSchema.safeParse(recipe).success).toBe(true)
    expect(generationRecipeSchema.safeParse({ ...recipe, recipeVersion: algorithmVersion === 4 ? 3 : 4 }).success).toBe(false)
  })

  it('creates two distinct actual room counts, unique shared walls and deterministic full results', () => {
    const base = source(), before = canonicalJson(base), input = request(2), first = runInteriorGeneration(base, input, options)
    const other = request(4); other.parameters.corridor = { axis: 'horizontal', clearWidthMm: 1800 }
    const second = runInteriorGeneration(base, other, options)
    expect(first.layout.rooms).toHaveLength(2); expect(Object.keys(first.candidate.document.rooms)).toHaveLength(2)
    expect(Object.keys(first.candidate.document.walls)).toHaveLength(7)
    expect(second.layout.rooms).toHaveLength(4); expect(second.layout.corridors).toHaveLength(1)
    expect(Object.keys(second.candidate.document.rooms)).toHaveLength(5)
    expect(second.resultHash).not.toBe(first.resultHash)
    expect(runInteriorGeneration(base, input, options)).toEqual(first)
    input.parameters.rooms.reverse(); input.parameters.relations[0] = { ...input.parameters.relations[0], a: 'room-1', b: 'room-0' }
    expect(normalizeInteriorInput(input)).toEqual(first.input)
    expect(runInteriorGeneration(base, input, options)).toEqual(first)
    checkMaterializedInterior(cloneJson(second.candidate.document) as SceneDocument, second.input, second.layout)
    const clipped = cloneJson(first.candidate.document) as SceneDocument
    clipped.rooms[first.layout.rooms[0].roomId].boundaryVertexIds.splice(0, 1)
    expect(() => checkMaterializedInterior(clipped, first.input, first.layout)).toThrow(/矩形切分/)
    expect(canonicalJson(base)).toBe(before)
    expect(validateSceneDocument(first.candidate.document).ok).toBe(true)
    expect(first.candidate.usage.gridNodes).toBeGreaterThan(0)
  })

  it('uses actual net area limits to change partition sizes', () => {
    const first = runInteriorGeneration(source(), request(), options), input = request()
    input.parameters.rooms[0].maxAreaMm2 = 60_000_000
    const second = runInteriorGeneration(source(), input, options)
    expect(second.layout.rooms.find(room => room.requirementId === 'room-0')!.clearAreaMm2).toBeLessThanOrEqual(60_000_000)
    expect(second.candidate.documentHash).not.toBe(first.candidate.documentHash)
  })

  it('distinguishes a proven contradiction, invalid input, finite search and cancellation', () => {
    const contradiction = request(); contradiction.parameters.rooms[0].minAreaMm2 = 999_000_000
    const invalid = { ...request(), algorithmVersion: 99 }
    const impossible = request(); impossible.parameters.relations = [{ a: 'room-0', b: 'room-1', kind: 'separate', minimumSharedWallMm: 0 }]
    for (const [input, reason] of [[contradiction, 'contradiction'], [invalid, 'invalid-input'], [impossible, 'search-exhausted']] as const) {
      try { runInteriorGeneration(source(), input, options); throw new Error('expected rejection') } catch (error) { expect(error).toBeInstanceOf(InteriorGenerationError); expect((error as InteriorGenerationError).reason).toBe(reason) }
    }
    expect(() => runInteriorGeneration(source(), request(), { ...options, signal: { aborted: true } })).toThrow(/取消/)
  })

  it('persists existing ownership with genuine generated-building identities and manual invalidation', () => {
    const result = runInteriorGeneration(source(), request(), options), doc = cloneJson(result.candidate.document) as SceneDocument, generation = getLegacyGeneration(doc)!
    const recipe = Object.values(generation.recipes)[0]
    expect('domain' in recipe && recipe.domain).toBe('interior')
    expect(recipe.parameters).toEqual(result.input.parameters)
    expect(Object.values(generation.ownership).filter(row => row.target.kind === 'room')).toHaveLength(2)
    const content = createCompositionContent(doc, runtime), roomId = result.layout.rooms[0].roomId
    const identity = content.historyIdentity.generationTokens![roomId]
    expect(identity.kind).toBe('generatedRoom')
    const edited = applyCompositionCommands(content, [{ type: 'updateRoom', id: roomId, changes: { purpose: '人工用途' } }], runtime)
    const owner = Object.values(getLegacyGeneration(edited.document)!.ownership).find(row => row.target.entityId === roomId)!
    expect(owner.state).toBe('manual'); expect(owner.manualFields).toContain('properties')
    expect(edited.historyIdentity.generationTokens![roomId].token).toBe(identity.token)
    expect(edited.historyIdentity.generationTokens![roomId].topologyToken).toBe(identity.topologyToken)
  })
})
