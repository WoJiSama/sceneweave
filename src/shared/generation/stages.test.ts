import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import type { SceneDocument } from '../model/scene.js'
import { GenerationRegistry, runGeneration } from './orchestrator.js'
import type { ArtifactInput, GenerationInputBinding, GenerationOperatorDescriptor, GenerationRequest, RecipeStep } from './contracts.js'

const floorId = 'visual-floor', layerId = 'visual-layer-ground'
const rectangle = (x = 2000) => [{ x, y: 2000 }, { x: x + 6000, y: 2000 }, { x: x + 6000, y: 8000 }, { x, y: 8000 }]
const source = () => createShoreBlankDocument('island', { sceneId: 'stages', title: '阶段候选', now: '2026-11-05T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
const plan = (id: string): ArtifactInput => ({ id, kind: 'plan-region', owner: 'structure', payload: { coordinateFrame: 'scene-mm', floorId, visibility: 'public', domain: 'building', purpose: '', boundaryMm: rectangle() } })
const step = (id: string, operator = id): RecipeStep => ({ id, operator: { id: operator, version: 1 }, required: true, parameters: {}, dependsOn: [], inputs: [] })
const operator = (id: string, rest: Partial<GenerationOperatorDescriptor> = {}): GenerationOperatorDescriptor => ({ id, version: 1, phase: 'structure', owner: 'structure', consumes: [], produces: [], requires: [], determinism: { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' }, parseParameters: input => cloneJson(input), run: () => ({ outputs: [] }), ...rest })
function input(registry: GenerationRegistry, steps: RecipeStep[], id = 'staged'): GenerationRequest {
  return { requestVersion: 1, normalizationVersion: 1, target: { kind: 'new-project' }, coordinateFrame: 'scene-mm', intent: { structures: [], purposes: [], tags: [] }, intentSource: { kind: 'manual', contentHash: 'a'.repeat(64) },
    seed: 'same', budgetProfile: taskBudgetProfile('small'), hardConstraints: [], softGoals: [], recipe: registry.registerRecipe({ id, version: 1, steps }) }
}
function native(document: SceneDocument, ...commands: SceneCommand[]) {
  let sequence = 0
  return applyCommands(document, commands, { ids: { nextId: () => `native-${sequence++}` }, clock: { now: () => document.updatedAt } })
}
function roomOperator(): GenerationOperatorDescriptor {
  return operator('rooms', { produces: ['support-surface', 'wall'], publishFacts: ['support-surface', 'wall'],
    parseParameters(input) { if (Object.keys(input).some(key => key !== 'x') || input.x !== undefined && (typeof input.x !== 'number' || !Number.isSafeInteger(input.x))) throw new Error('x必须为整数毫米'); return cloneJson(input) },
    materialize: ({ document, context }) => native(cloneJson(document) as SceneDocument,
      { type: 'createRoom', id: 'room', floorId, layerId, boundaryMm: rectangle(context.step.parameters.x as number | undefined), thicknessMm: 200 }) })
}
function binding(id = 'walls'): GenerationInputBinding { return { id, kind: 'wall', from: { kind: 'step', stepId: 'room-step', operator: { id: 'rooms', version: 1 } }, cardinality: { min: 4, max: 4 }, floorId, coordinateFrame: 'scene-mm' } }

describe('owned materialization and exact step inputs', () => {
  it('materializes native rooms and doors before later steps query real immutable facts', () => {
    const registry = new GenerationRegistry(), original = source(), before = canonicalJson(original)
    registry.register(roomOperator())
    registry.register(operator('doors', { phase: 'connectivity', owner: 'connectivity', consumes: ['wall'], produces: ['opening'], publishFacts: ['opening'],
      run(context) {
        expect(context.inputs.get('walls')).toHaveLength(4)
        expect(context.space.supportsPolygon(rectangle(2000), { kind: 'room', id: 'room' }, floorId)).toBe(true)
        expect(context.artifacts.values().every(fact => fact.kind === 'wall')).toBe(true)
        expect(() => context.inputs.get('not-granted')).toThrow(/未绑定/)
        return { outputs: [] }
      },
      materialize({ document, context }) {
        expect(Object.isFrozen(document.rooms.room)).toBe(true)
        const wall = context.inputs.get('walls')[0]
        if (wall.kind !== 'wall') throw new Error('expected wall')
        const entity = document.walls[wall.payload.entityId]
        return native(cloneJson(document) as SceneDocument, { type: 'addOpening', id: 'door', wallId: entity.id, offsetReferenceVertexId: entity.startVertexId, offsetMm: 2000, widthMm: 1000, kind: 'door', state: 'closed', layerId })
      },
    }))
    registry.register(operator('check-door', { phase: 'content', owner: 'content', consumes: ['opening'], run(context) {
      const [opening] = context.inputs.get('door')
      expect(opening.kind === 'opening' && opening.payload.state).toBe('closed')
      const walls = context.space.artifacts.filter(fact => fact.kind === 'wall')
      expect(walls).toHaveLength(4)
      expect(context.space.artifacts.some(fact => fact.kind === 'support-surface' && fact.payload.sourceRef.id === 'room')).toBe(true)
      return { outputs: [] }
    } }))
    const rooms = step('room-step', 'rooms'), doors = step('door-step', 'doors'), check = step('check', 'check-door')
    doors.dependsOn = ['room-step']; doors.inputs = [binding()]
    check.dependsOn = ['door-step']; check.inputs = [{ id: 'door', kind: 'opening', from: { kind: 'step', stepId: 'door-step', operator: { id: 'doors', version: 1 } }, cardinality: { min: 1, max: 1 }, floorId }]
    const request = input(registry, [check, doors, rooms]), result = runGeneration(request, registry, { source: original, nowMilliseconds: () => 0 })
    expect(result.stages.map(stage => stage.stepId)).toEqual(['room-step', 'door-step', 'check'])
    expect(result.stages[1].beforeHash).toBe(result.stages[0].afterHash)
    expect(result.documentHash).toBe(result.stages.at(-1)!.afterHash)
    expect(result.document.openings.door.state).toBe('closed')
    expect(Object.isFrozen(result.document.openings.door)).toBe(true)
    expect(canonicalJson(original)).toBe(before)
    expect(runGeneration(request, registry, { source: original, nowMilliseconds: () => 0 })).toEqual(result)
  })

  it('selects one explicit instance even when the same operator runs twice', () => {
    const registry = new GenerationRegistry(), seen: string[] = []
    registry.register(operator('plan', { produces: ['plan-region'], run: context => ({ outputs: [plan(context.step.id)] }) }))
    registry.register(operator('consume', { consumes: ['plan-region'], run: context => { seen.push(...context.inputs.get('chosen').map(fact => fact.id)); return { outputs: [] } } }))
    const consume = step('consume'); consume.dependsOn = ['b']; consume.inputs = [{ id: 'chosen', kind: 'plan-region', from: { kind: 'step', stepId: 'b', operator: { id: 'plan', version: 1 } }, cardinality: { min: 1, max: 1 }, artifactIds: ['b'] }]
    runGeneration(input(registry, [consume, step('a', 'plan'), step('b', 'plan')]), registry, { source: source(), nowMilliseconds: () => 0 })
    expect(seen).toEqual(['b'])
  })

  it.each(['version', 'count', 'floor', 'frame', 'missing-id'] as const)('rejects mismatched exact binding: %s', mode => {
    const registry = new GenerationRegistry(); registry.register(roomOperator())
    let ran = false
    registry.register(operator('consume', { consumes: ['wall'], run: () => { ran = true; return { outputs: [] } } }))
    const consume = step('consume'); consume.dependsOn = ['room-step']; const selected = binding()
    if (mode === 'version' && selected.from.kind === 'step') selected.from.operator.version = 2
    if (mode === 'count') selected.cardinality.min = selected.cardinality.max = 5
    if (mode === 'floor') selected.floorId = 'wrong-floor'
    if (mode === 'frame') selected.coordinateFrame = 'region-mm'
    if (mode === 'missing-id') selected.artifactIds = ['absent']
    consume.inputs = [selected]
    expect(() => runGeneration(input(registry, [step('room-step', 'rooms'), consume]), registry, { source: source(), nowMilliseconds: () => 0 })).toThrow(/前序步骤|基数|Floor|坐标/)
    expect(ran).toBe(false)
  })

  it('rejects stale upstream facts before exposing a modified candidate downstream', () => {
    const registry = new GenerationRegistry(); registry.register(roomOperator())
    registry.register(operator('change', { materialize: ({ document }) => { const next = cloneJson(document) as SceneDocument; next.walls[Object.keys(next.walls)[0]].thicknessMm = 250; return next } }))
    let ran = false
    registry.register(operator('later', { phase: 'content', owner: 'content', run: () => { ran = true; return { outputs: [] } } }))
    const change = step('change'), later = step('later'); change.dependsOn = ['room-step']; later.dependsOn = ['change']
    expect(() => runGeneration(input(registry, [step('room-step', 'rooms'), change, later]), registry, { source: source(), nowMilliseconds: () => 0 })).toThrow(/已失效/)
    expect(ran).toBe(false)
  })

  it('keeps the source intact on materializer failure and cancellation', () => {
    for (const cancel of [false, true]) {
      const registry = new GenerationRegistry(), original = source(), before = canonicalJson(original), signal = { aborted: false }
      registry.register(roomOperator())
      registry.register(operator('fail', { phase: 'content', owner: 'content', materialize: ({ document }) => {
        const next = cloneJson(document) as SceneDocument; next.title = 'private partial result'
        if (!cancel) throw new Error('materialization failed')
        signal.aborted = true; return next
      } }))
      const fail = step('fail'); fail.dependsOn = ['rooms']
      expect(() => runGeneration(input(registry, [step('rooms'), fail]), registry, { source: original, signal, nowMilliseconds: () => 0 })).toThrow(/failed|取消/)
      expect(canonicalJson(original)).toBe(before)
    }
  })

  it('recomputes downstream candidate and stage hashes after an upstream parameter change', () => {
    const results = [2000, 9000].map(x => {
      const registry = new GenerationRegistry(); registry.register(roomOperator())
      const rooms = step('rooms'); rooms.parameters = { x }
      const request = input(registry, [rooms])
      return runGeneration(request, registry, { source: source(), nowMilliseconds: () => 0 })
    })
    expect(results[0].stages[0].afterHash).not.toBe(results[1].stages[0].afterHash)
    expect(results[0].outputHash).not.toBe(results[1].outputHash)
  })

  it.each(['connectivity', 'content', 'presentation'] as const)('rejects an unpublished physical room written by %s', phase => {
    const registry = new GenerationRegistry(), original = source(), before = canonicalJson(original)
    registry.register(operator('outside-phase', { phase, owner: phase, materialize: roomOperator().materialize }))
    expect(() => runGeneration(input(registry, [step('outside-phase')]), registry, { source: original, nowMilliseconds: () => 0 })).toThrow(/阶段物化写入范围/)
    expect(canonicalJson(original)).toBe(before)
  })

  it('checks unpublished materialized walls against hard bounds including thickness', () => {
    const registry = new GenerationRegistry(); registry.register(operator('room', { materialize: roomOperator().materialize }))
    const request = input(registry, [step('room')]); request.hardConstraints = [{ id: 'wall-bounds', kind: 'bounds', boundsMm: { x: 2000, y: 2000, width: 6000, height: 6000 } }]
    expect(() => runGeneration(request, registry, { source: source(), nowMilliseconds: () => 0 })).toThrow(/wall-bounds/)
    request.hardConstraints[0] = { id: 'wall-bounds', kind: 'bounds', boundsMm: { x: 1900, y: 1900, width: 6200, height: 6200 } }
    expect(runGeneration(request, registry, { source: source(), nowMilliseconds: () => 0 }).status).toBe('prepared')
  })

  it('checks an opening-only stage against the actual opening band on an existing wall', () => {
    const original = native(source(), { type: 'createRoom', id: 'room', floorId, layerId, boundaryMm: rectangle(), thicknessMm: 200 })
    const registry = new GenerationRegistry()
    registry.register(operator('door', { phase: 'connectivity', owner: 'connectivity', produces: ['opening'], publishFacts: ['opening'], materialize({ document }) {
      const wall = Object.values(document.walls).find(item => document.vertices[item.startVertexId].yMm === 2000 && document.vertices[item.endVertexId].yMm === 2000)!
      return native(cloneJson(document) as SceneDocument, { type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 2000, widthMm: 1000, kind: 'door', layerId })
    } }))
    const request = input(registry, [step('door')]); request.hardConstraints = [{ id: 'opening-bounds', kind: 'bounds', boundsMm: { x: 1900, y: 2000, width: 6200, height: 6100 } }]
    expect(() => runGeneration(request, registry, { source: original, nowMilliseconds: () => 0 })).toThrow(/opening-bounds/)
    request.hardConstraints[0] = { id: 'opening-bounds', kind: 'bounds', boundsMm: { x: 1900, y: 1900, width: 6200, height: 6200 } }
    expect(runGeneration(request, registry, { source: original, nowMilliseconds: () => 0 }).status).toBe('prepared')
  })
})
