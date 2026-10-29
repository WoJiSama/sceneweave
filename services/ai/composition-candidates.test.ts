import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { compositionCandidateFixture } from '../../tests/helpers/composition-candidates-fixture.js'
import { applyAuthoringStep, authoringProjectHash, replayAuthoring } from '../../src/shared/ai/authoring.js'
import { CompositionCandidateSchema } from '../../src/shared/ai/composition-candidates.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import type { StoredTask } from './store.js'
import { authoringTools, executeAuthoringTool } from './authoring-tools.js'
import * as authoringCore from '../../src/shared/ai/authoring.js'

function fixture() {
  const start = compositionCandidateFixture(), scene = start.project.document
  const task: StoredTask = { owner: 'test', fingerprint: 'test', messages: [], calls: {}, runtimeMs: 0, runStartedAt: null, outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '',
    authoring: { start, state: replayAuthoring(start, []).state }, snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: { sceneId: scene.sceneId, revision: scene.revision, audience: 'public' },
      status: 'running', generation: 1, lastSequence: 0, text: '', tools: [], usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 1000 } }
  const run = (name: string, args: unknown, id: string = randomUUID()) => executeAuthoringTool(task, { id, name, arguments: JSON.stringify(args) }, args)
  return { task, run }
}
describe('composition tool full native preview and privacy boundary', () => {
  it('exposes all three branches as root object properties while retaining the exact strict union', () => {
    const schema = authoringTools.find(tool => tool.name === 'sceneweave_propose_composition')!.parameters
    const original = z.toJSONSchema(CompositionCandidateSchema, { io: 'input' })
    const branches = CompositionCandidateSchema.options.map(branch => z.toJSONSchema(branch, { io: 'input' }))
    expect(schema).toMatchObject({ type: 'object', required: ['kind'], additionalProperties: false,
      properties: { kind: { type: 'string', enum: ['layout', 'furnishing', 'style'] } } })
    expect(schema.oneOf).toEqual(original.oneOf)
    const properties = schema.properties as Record<string, unknown>
    expect(properties.materialIds).toMatchObject({ properties: {
      base: { description: expect.stringContaining('interior: unused; does not assign wall materials') },
      primary: { description: expect.stringContaining('kitchen floor fallback when secondary is absent') },
      secondary: { description: expect.stringContaining('interior: kitchen floor override only') },
    } })
    expect(Object.keys(properties).sort()).toEqual([...new Set(branches.flatMap(branch => Object.keys(branch.properties!)))].sort())
    for (const branch of branches) {
      expect(branch.type).toBe('object')
      expect(branch.additionalProperties).toBe(false)
      expect(branch.required).toContain('kind')
      for (const [key, value] of Object.entries(branch.properties!)) {
        // All root constraints are already implied by the unchanged union.
        // In particular, the last branch must not narrow kind to only style.
        if (key === 'kind') {
          expect(value && typeof value === 'object').toBe(true)
          if (value && typeof value === 'object') expect((properties.kind as { enum: unknown[] }).enum).toContain(value.const)
        }
        else expect(properties[key]).toEqual(value)
      }
    }
    for (const input of [{ kind: 'layout', recipe: 'island', idPrefix: 'land' },
      { kind: 'furnishing', idPrefix: 'props', supportRef: { kind: 'floor', id: 'floor' }, definitionIds: ['definition'], positionMm: { x: 1000, y: 1000 } },
      { kind: 'style', surfaceIds: ['surface'] }]) expect(CompositionCandidateSchema.parse(input)).toEqual(input)
  })
  it.each([{}, { kind: 'layout', recipe: 'island' },
    { kind: 'layout', recipe: 'island', idPrefix: 'land', propIds: ['definition'] },
    { kind: 'furnishing', idPrefix: 'props', supportRef: { kind: 'floor', id: 'floor' }, definitionIds: ['definition'], positionMm: { x: 1000.5, y: 1000 } },
    { kind: 'style', recipe: 'island' }])('still rejects incomplete or cross-branch arguments without defaults or draft writes: %j', input => {
    const { task, run } = fixture(), before = canonicalJson(task)
    const result = run('sceneweave_propose_composition', input)
    expect(result.success).toBe(false)
    expect(JSON.parse(result.output).error.code).toBe('invalid_arguments')
    expect(canonicalJson(task)).toBe(before)
  })
  it.each(['beach', 'island', 'interior'] as const)('returns exact replayable %s operations and real costs without installing a step', recipe => {
    const { task, run } = fixture(), before = canonicalJson(task), result = run('sceneweave_propose_composition', { kind: 'layout', recipe, idPrefix: recipe, materialIds: { base: 'tile', primary: 'tile', secondary: 'tile' } }, 'preview')
    expect(result.success).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192)
    const receipt = JSON.parse(result.output), authoring = task.authoring!
    expect(receipt.previewValid).toBe(true)
    expect(receipt.appearance).toBe('unconfirmed')
    expect(receipt.atContentHash).toBe(authoring.state.contentHash)
    expect(canonicalJson(task)).toBe(before)
    expect(result.output).not.toContain('PRIVATE_')
    const full = applyAuthoringStep(authoring.start, authoring.state, receipt.candidateOperations, 'adopt')
    expect(receipt.actualOperationCost).toBe(full.state.operationCost)
    expect(receipt.remainingOperationsAfterEdit).toBe(256 - full.state.operationCost)
    expect(run('sceneweave_edit_scene', { operations: receipt.candidateOperations }, 'adopt').success).toBe(true)
    expect(authoring.state.contentHash).toBe(full.state.contentHash)
    expect(authoring.state.operationCost).toBe(receipt.actualOperationCost)
  })
  it.each(['override', 'fallback', 'unfinished'] as const)('explains interior material roles and previews the actual %s floors without assigning walls', mode => {
    const { task, run } = fixture(), authoring = task.authoring!, start = authoring.start
    const material = start.project.document.materials.tile, binding = start.project.licenseBindings.find(value => value.subjectKind === 'material' && value.subjectId === 'tile')!
    const materialIds = ['base-tile', 'floor-tile', 'kitchen-tile']
    for (const id of materialIds) {
      start.project.document.materials[id] = { ...material, id, catalogId: `test.composition.${id}`, name: id }
      start.project.licenseBindings.push({ ...binding, subjectId: id })
    }
    start.scope.scene!.materialIds.push(...materialIds); start.scope.visual!.materialIds.push(...materialIds)
    start.baseContentHash = authoringProjectHash(start.project); authoring.state = replayAuthoring(start, []).state
    const before = canonicalJson(task)
    const result = run('sceneweave_propose_composition', { kind: 'layout', recipe: 'interior', idPrefix: 'roles', materialIds: {
      base: 'base-tile', ...(mode !== 'unfinished' ? { primary: 'floor-tile' } : {}), ...(mode === 'override' ? { secondary: 'kitchen-tile' } : {}),
    } })
    expect(result.success).toBe(true)
    expect(Buffer.byteLength(result.output)).toBeLessThan(8192)
    const receipt = JSON.parse(result.output)
    expect(receipt.details.materialRoles).toMatchObject({ base: 'unused',
      primary: expect.stringContaining('kitchen fallback'), secondary: 'kitchen floor override only', walls: expect.stringContaining('explicit wall material operation') })
    expect(canonicalJson(task)).toBe(before)
    const { project } = applyAuthoringStep(start, authoring.state, receipt.candidateOperations, 'adopt-roles')
    for (const role of ['common', 'kitchen', 'guest', 'study', 'storage']) {
      const expected = mode === 'unfinished' ? null : role === 'kitchen' && mode === 'override' ? 'kitchen-tile' : 'floor-tile'
      expect(project.document.rooms[`roles-${role}`].floorStyle?.base.materialRef.id ?? null).toBe(expected)
    }
    expect(Object.values(project.document.walls).every(wall => wall.topStyle === null)).toBe(true)
  })
  it('previews furnishing, includes actual partial results and never mutates existing/manual members', () => {
    const { task, run } = fixture(), authoring = task.authoring!
    const candidate = run('sceneweave_propose_composition', { kind: 'layout', recipe: 'interior', idPrefix: 'inn' })
    expect(candidate.success).toBe(true)
    expect(run('sceneweave_edit_scene', { operations: JSON.parse(candidate.output).candidateOperations }).success).toBe(true)
    const before = canonicalJson(authoring.state)
    const furnishing = run('sceneweave_propose_composition', { kind: 'furnishing', idPrefix: 'kitchen', supportRef: { kind: 'room', id: 'inn-kitchen' }, definitionIds: ['definition', 'alternate'], positionMm: { x: 19000, y: 5000 }, count: 4 })
    expect(furnishing.success).toBe(true)
    const receipt = JSON.parse(furnishing.output)
    expect(receipt.details.feasibleCount).toBeGreaterThan(0)
    expect(receipt.actualOperationCost).toBe(receipt.details.feasibleCount)
    expect(canonicalJson(authoring.state)).toBe(before)
    expect(run('sceneweave_edit_scene', { operations: receipt.candidateOperations }).success).toBe(true)
  })
  it('reports dynamic four-request/twelve-tool budgets without inventing extra work rounds', () => {
    const { task } = fixture(); task.snapshot.usage.requests = 3; task.toolAttempts = 8
    const call = { id: 'limited', name: 'sceneweave_check_draft', arguments: '{}' }
    const result = executeAuthoringTool(task, call, {}, undefined, { modelRequests: 4, toolCalls: 12, executionRemainingMs: 12345 })
    expect(result.success).toBe(true)
    expect(JSON.parse(result.output)).toMatchObject({ remainingModelRequests: 1, remainingToolCalls: 3, remainingExecutionMs: 12345,
      finishGuidance: expect.stringContaining('final model reply for text with no tools') })
  })
  it('leaves the exact draft unchanged when final-round guidance pushes an edit receipt past 8 KiB', () => {
    const { task } = fixture(), authoring = task.authoring!
    task.snapshot.usage.requests = 15
    const state = authoring.state, before = canonicalJson(task)
    let changedIds: string[] = []
    for (let length = 1; length <= 256; length++) {
      const ids = Array.from({ length: 32 }, (_, i) => `${i}-`.padEnd(length, 'x'))
      const output = { draftRevision: 1, contentHash: state.contentHash, operationCost: 32, affectedIds: ids.sort(), changedCount: 32, remainingOperations: 224 }
      if (Buffer.byteLength(JSON.stringify(output)) >= 7920 && Buffer.byteLength(JSON.stringify(output)) <= 8000) { changedIds = ids; break }
    }
    expect(changedIds).toHaveLength(32)
    // The pure validator has separate full-ledger tests. This isolates the
    // receipt/install boundary using a legal-size set of changed identifiers.
    const apply = vi.spyOn(authoringCore, 'applyAuthoringStep').mockReturnValue({ project: authoring.start.project,
      state: { ...state, draftRevision: 1, operationCost: 32, changedIds }, visualInvalidatedIds: [] })
    try {
      const args = { operations: [{ kind: 'furnish', id: 'new-prop', definitionId: 'definition', supportRef: { kind: 'floor', id: authoring.start.scope.scene!.floorId }, positionMm: { x: 5000, y: 5000 } }] }
      const result = executeAuthoringTool(task, { id: 'large-receipt', name: 'sceneweave_edit_scene', arguments: JSON.stringify(args) }, args, undefined,
        { modelRequests: 16, toolCalls: 64, executionRemainingMs: 12345 })
      expect(result.success).toBe(false)
      expect(JSON.parse(result.output).error.code).toBe('tool_output_limit')
      expect(canonicalJson(task)).toBe(before)
      expect(authoring.state).toBe(state)
    } finally { apply.mockRestore() }
  })
  it('does not install a plan or summary when the complete receipt exceeds 8 KiB', () => {
    const { task } = fixture(), authoring = task.authoring!
    task.snapshot.usage.requests = 15
    authoring.start.brief!.requirements = Array.from({ length: 16 }, (_, i) => `requirement ${i}`)
    const ids = Array.from({ length: 8 }, (_, i) => `evidence-${i}`.padEnd(24, 'x'))
    authoring.start.scope.targetIds.push(...ids)
    let args: { phase: 'review'; requirements: { index: number; state: 'claimed'; evidenceIds: string[]; note: string }[] } | undefined
    for (let length = 0; length <= 300; length++) {
      const candidate = { phase: 'review' as const, requirements: Array.from({ length: 16 }, (_, index) => ({ index, state: 'claimed' as const, evidenceIds: ids, note: 'n'.repeat(length) })) }
      const bytes = Buffer.byteLength(JSON.stringify({ ...candidate, status: 'claims_require_independent_review', remainingOperations: 256 }))
      if (bytes >= 7920 && bytes <= 8000) { args = candidate; break }
    }
    expect(args).toBeDefined()
    const before = canonicalJson(task)
    const result = executeAuthoringTool(task, { id: 'large-plan', name: 'sceneweave_plan_draft', arguments: JSON.stringify(args) }, args, undefined,
      { modelRequests: 16, toolCalls: 64, executionRemainingMs: 12345 })
    expect(result.success).toBe(false)
    expect(JSON.parse(result.output).error.code).toBe('tool_output_limit')
    expect(canonicalJson(task)).toBe(before)
    expect(authoring.plan).toBeUndefined(); expect(task.snapshot.authoring).toBeUndefined()
  })
  it('keeps actual diagnostics usable under the receipt budget instead of repeating a long immutable brief', () => {
    const { task, run } = fixture(), authoring = task.authoring!
    authoring.start.brief = { ...authoring.start.brief!, recipe: 'interior', requirements: Array.from({ length: 16 }, (_, i) => `${i}: ${'required purpose and furniture '.repeat(9)}`),
      checks: ['common', 'kitchen', 'guest', 'study', 'storage'].map((role, i) => ({ kind: 'roomRole' as const, id: `role-${i}`, purposeTerms: [role], definitionIds: ['definition', 'alternate'], minimumProps: 2 })) }
    authoring.state = replayAuthoring(authoring.start, []).state
    const layout = run('sceneweave_propose_composition', { kind: 'layout', recipe: 'interior', idPrefix: 'inn', materialIds: { primary: 'tile', secondary: 'tile' } })
    expect(layout.success).toBe(true)
    expect(run('sceneweave_edit_scene', { operations: JSON.parse(layout.output).candidateOperations }).success).toBe(true)
    const report = run('sceneweave_diagnose_draft', {})
    expect(report.success).toBe(true)
    expect(Buffer.byteLength(report.output)).toBeLessThan(8192)
    expect(JSON.parse(report.output)).toMatchObject({ counts: { rooms: 5 }, completion: 'incomplete', repairs: { appearance: 'unconfirmed' } })
    expect(JSON.parse(report.output).evidence).toHaveLength(5)
    expect(JSON.parse(report.output).requirements).toHaveLength(16)
  })
  it('rejects hidden blockers and ungranted definitions with no identifiers, candidate or partial ledger changes', () => {
    const { task, run } = fixture(), authoring = task.authoring!, start = authoring.start
    const hidden = applyAuthoringStep(start, authoring.state, [{ kind: 'furnish', id: 'PRIVATE_BLOCKER', definitionId: 'definition', supportRef: { kind: 'floor', id: start.scope.scene!.floorId }, positionMm: { x: 5600, y: 7400 } }], 'hidden')
    start.project = hidden.project; start.project.document.props.PRIVATE_BLOCKER.visibility = 'gm'; start.baseContentHash = authoringProjectHash(start.project)
    authoring.state = replayAuthoring(start, []).state
    const before = canonicalJson(task)
    const denied = run('sceneweave_propose_composition', { kind: 'layout', recipe: 'island', idPrefix: 'land' })
    expect(denied.success).toBe(false); expect(denied.output).not.toContain('PRIVATE_BLOCKER'); expect(denied.output).not.toContain('candidateOperations')
    expect(canonicalJson(task)).toBe(before)
    const definition = run('sceneweave_propose_composition', { kind: 'furnishing', idPrefix: 'bad', definitionIds: ['PRIVATE_DEFINITION'], supportRef: { kind: 'floor', id: start.scope.scene!.floorId }, positionMm: { x: 19000, y: 5000 } })
    expect(definition.success).toBe(false); expect(definition.output).not.toContain('PRIVATE_DEFINITION'); expect(canonicalJson(task)).toBe(before)
  })
  it('reports a reserve-breaking candidate without installing it and rejects real cumulative budget exhaustion', () => {
    const { task, run } = fixture()
    const first = run('sceneweave_propose_composition', { kind: 'layout', recipe: 'island', idPrefix: 'first', reserveOperations: 128 })
    expect(first.success).toBe(true)
    const receipt = JSON.parse(first.output)
    expect(run('sceneweave_edit_scene', { operations: receipt.candidateOperations }).success).toBe(true)
    const authoring = task.authoring!, before = canonicalJson(authoring.state)
    // A second large independent island incurs its real generated point/segment
    // cost and cannot treat three terrain recipes as three expanded operations.
    const second = run('sceneweave_propose_composition', { kind: 'layout', recipe: 'island', idPrefix: 'second', reserveOperations: 128 })
    if (second.success) {
      const more = JSON.parse(second.output)
      expect(more.actualOperationCost).toBeGreaterThan(more.candidateOperations.length)
      expect(more.fitsReservedBudget).toBe(false)
    } else expect(JSON.parse(second.output).error.code).toMatch(/operation_budget|outside_scope|invalid_geometry/)
    expect(canonicalJson(authoring.state)).toBe(before)
    const limited = fixture(), source = limited.task.authoring!, start = source.start
    const existing = applyAuthoringStep(start, source.state, [{ kind: 'furnish', id: 'existing', definitionId: 'definition', supportRef: { kind: 'floor', id: start.scope.scene!.floorId }, positionMm: { x: 23000, y: 17000 } }], 'baseline')
    start.project = existing.project; start.scope.targetIds = ['existing']; start.scope.operations = ['opacity']; start.baseContentHash = authoringProjectHash(start.project)
    source.state = replayAuthoring(start, []).state
    for (let index = 0; index < 14; index++) source.state = applyAuthoringStep(start, source.state, Array.from({ length: 16 }, () => ({ kind: 'opacity' as const, id: 'existing', value: 1 })), `repeat-${index}`).state
    expect(source.state.operationCost).toBe(224)
    const frozen = canonicalJson(limited.task), exhausted = limited.run('sceneweave_propose_composition', { kind: 'layout', recipe: 'interior', idPrefix: 'over-budget' })
    expect(exhausted.success).toBe(false)
    expect(JSON.parse(exhausted.output).error.code).toBe('operation_budget')
    expect(canonicalJson(limited.task)).toBe(frozen)
  }, 20000)
})
