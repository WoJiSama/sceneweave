import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { svgProjectFixture } from '../../tests/helpers/m24-svg-fixtures.js'
import type { AuthoringOperation, AuthoringStart } from '../../src/shared/ai/authoring-protocol.js'
import type { TerrainBoundaryProposal } from '../../src/shared/ai/visual-protocol.js'
import { applyAuthoringStep, authoringProjectHash, replayAuthoring } from '../../src/shared/ai/authoring.js'
import { ToolResultSchema } from '../../src/shared/ai/protocol.js'
import { canonicalJson, cloneJson } from '../../src/shared/validation/json.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import { emptyVisualSystem } from '../../src/shared/visual/types.js'
import type { StoredTask } from './store.js'
import { executeAuthoringTool } from './authoring-tools.js'
import * as authoringCore from '../../src/shared/ai/authoring.js'

type CandidateRecipe = { proposal: TerrainBoundaryProposal; candidateHash: string }
type ProposalReceipt = { atDraftRevision: number; atContentHash: string; candidateRecipe: CandidateRecipe; candidateOperation: AuthoringOperation }
type ApplyCandidates = { atDraftRevision: number; atContentHash: string; candidates: CandidateRecipe[] }

function fixture() {
  const project = cloneJson(svgProjectFixture().bundle.project), scene = project.document
  project.schemaVersion = 2; scene.schemaVersion = 2; scene.visual = emptyVisualSystem(); scene.title = 'PRIVATE_PROJECT_TITLE'
  const floorId = Object.keys(scene.floors)[0], layerId = scene.entityLayers.item, boundsMm = scene.floors[floorId].boundsMm
  const start: AuthoringStart = { schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), seed: randomUUID(), preparedAt: '2026-10-28T00:00:00.000Z',
    disclosure: 'complete-metadata/public-model', skill: { id: 'sceneweave-scene-authoring', version: 1 }, scope: { targetIds: [], operations: [], placement: null,
      scene: { floorId, layerId, boundsMm, entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: [], operations: ['terrain'] },
      visual: { floorId, layerId, boundsMm, entityIds: [], definitionIds: [], materialIds: [], operations: ['visualBoundary'] } },
    brief: { recipe: 'island', requirements: ['Two editable terrain coasts'] } }
  const task: StoredTask = { owner: 'test', fingerprint: 'test', messages: [], calls: {}, runtimeMs: 0, runStartedAt: null, outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '',
    authoring: { start, state: replayAuthoring(start, []).state }, snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: { sceneId: scene.sceneId, revision: scene.revision, audience: 'public' },
      status: 'running', generation: 1, lastSequence: 0, text: '', tools: [], usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 1000 } }
  const run = (name: string, args: unknown, id: string = randomUUID()) => executeAuthoringTool(task, { id, name, arguments: JSON.stringify(args) }, args)
  const land = run('sceneweave_edit_scene', { operations: [
    { kind: 'terrain', id: 'real-land', groundElevationMm: 800, boundaryMm: [
      { x: 6000, y: 5000 }, { x: 11000, y: 4000 }, { x: 15000, y: 6000 }, { x: 12000, y: 8000 },
      { x: 15500, y: 11000 }, { x: 12000, y: 14500 }, { x: 6500, y: 13000 }, { x: 7500, y: 9000 },
    ] },
    { kind: 'terrain', id: 'other-land', groundElevationMm: 0, boundaryMm: [
      { x: 17000, y: 2000 }, { x: 19000, y: 2000 }, { x: 19000, y: 4000 }, { x: 17000, y: 4000 },
    ] },
  ] })
  expect(land.success).toBe(true)
  return { task, run }
}

function proposals(subject: ReturnType<typeof fixture>, count = 2) {
  const before = canonicalJson(subject.task)
  const receipts = [{ areaId: 'real-land', boundaryId: 'real-coast' }, { areaId: 'other-land', boundaryId: 'other-coast' }].slice(0, count).map(query => {
    const result = subject.run('sceneweave_propose_boundary', query)
    expect(result.success).toBe(true)
    ToolResultSchema.parse(result)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192)
    const receipt = JSON.parse(result.output) as ProposalReceipt
    expect(receipt.candidateRecipe).toEqual({ proposal: query, candidateHash: sha256Text(canonicalJson(receipt.candidateOperation)) })
    expect(result.output).not.toContain('PRIVATE_')
    return receipt
  })
  expect(canonicalJson(subject.task)).toBe(before)
  const args: ApplyCandidates = { atDraftRevision: receipts[0].atDraftRevision, atContentHash: receipts[0].atContentHash, candidates: receipts.map(value => value.candidateRecipe) }
  return { receipts, args }
}

describe('short boundary candidate adoption through the ordinary strict ledger', () => {
  it.each([1, 2])('rebuilds %i read-only candidate recipes into the exact ordinary operation, state and expanded cost', count => {
    const subject = fixture(), { task, run } = subject, { receipts, args } = proposals(subject, count), authoring = task.authoring!
    const operations = receipts.map(value => value.candidateOperation), previousRevision = authoring.state.draftRevision
    const expected = applyAuthoringStep(authoring.start, authoring.state, operations, 'adopt-curves')
    const result = run('sceneweave_apply_boundary_candidates', args, 'adopt-curves')
    expect(result.success).toBe(true)
    ToolResultSchema.parse(result)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192)
    expect(JSON.parse(result.output)).toMatchObject({ appliedCandidateCount: count, draftRevision: previousRevision + 1,
      contentHash: expected.state.contentHash, operationCost: expected.state.operationCost, remainingOperations: 256 - expected.state.operationCost })
    expect(authoring.state).toEqual(expected.state)
    expect(authoring.state.steps.at(-1)?.operations).toEqual(operations)
    expect(authoring.state.steps.at(-1)?.operations.every(operation => operation.kind === 'visualBoundary')).toBe(true)
    expect(canonicalJson(replayAuthoring(authoring.start, authoring.state.steps).project)).toBe(canonicalJson(expected.project))
  })

  it.each(['revision', 'hash', 'edited-draft'] as const)('rejects the %s stale baseline before rebuilding or installing any candidate', mode => {
    const subject = fixture(), { task, run } = subject, { args, receipts } = proposals(subject)
    if (mode === 'revision') args.atDraftRevision++
    if (mode === 'hash') args.atContentHash = '0'.repeat(64)
    if (mode === 'edited-draft') expect(run('sceneweave_edit_scene', { operations: [receipts[0].candidateOperation] }).success).toBe(true)
    const before = canonicalJson(task), result = run('sceneweave_apply_boundary_candidates', args)
    expect(result.success).toBe(false)
    expect(JSON.parse(result.output)).toMatchObject({ error: { code: 'stale_candidate' } })
    expect(canonicalJson(task)).toBe(before)
  })

  it.each(['hash', 'smoothness', 'boundary-id'] as const)('rejects a second candidate with a tampered %s without installing the valid first candidate', mode => {
    const subject = fixture(), { task, run } = subject, { args } = proposals(subject)
    if (mode === 'hash') args.candidates[1].candidateHash = '0'.repeat(64)
    if (mode === 'smoothness') args.candidates[1].proposal.smoothness = 0
    if (mode === 'boundary-id') args.candidates[1].proposal.boundaryId = 'forged-coast'
    const before = canonicalJson(task), result = run('sceneweave_apply_boundary_candidates', args)
    expect(result.success).toBe(false)
    expect(JSON.parse(result.output)).toMatchObject({ error: { code: 'invalid_candidate' } })
    expect(result.output).not.toContain('PRIVATE_')
    expect(canonicalJson(task)).toBe(before)
  })

  it.each(['gm', 'public'] as const)('rejects the second candidate ungranted %s note dependency without leaking it or installing the first', visibility => {
    const subject = fixture(), { task, run } = subject, { args } = proposals(subject), authoring = task.authoring!, start = authoring.start
    // Rebase to a valid cold project with the same real rings and a newly
    // attached note. Recipes contain no authority to adopt this dependency.
    start.project = replayAuthoring(start, authoring.state.steps).project
    const noteId = 'PRIVATE_UNGRANTED_DEPENDENCY', scene = start.project.document
    scene.notes[noteId] = { id: noteId, floorId: start.scope.scene!.floorId, editLocked: false,
      anchor: { type: 'entity', entityKind: 'terrainArea', entityId: 'other-land' }, kind: 'clue', title: 'PRIVATE_NOTE_TITLE', text: 'PRIVATE_NOTE_TEXT', visibility, discovered: false }
    scene.entityLayers[noteId] = start.scope.scene!.layerId
    start.scope.scene!.entityIds = ['real-land', 'other-land']; start.scope.visual!.entityIds = ['real-land', 'other-land']
    start.baseContentHash = authoringProjectHash(start.project); authoring.state = replayAuthoring(start, []).state
    args.atDraftRevision = authoring.state.draftRevision; args.atContentHash = authoring.state.contentHash
    const before = canonicalJson(task)
    const first = run('sceneweave_propose_boundary', args.candidates[0].proposal)
    expect(first.success).toBe(true)
    expect(JSON.parse(first.output).candidateRecipe).toEqual(args.candidates[0])
    const result = run('sceneweave_apply_boundary_candidates', args)
    expect(result.success).toBe(false)
    expect(JSON.parse(result.output)).toMatchObject({ error: { code: 'outside_scope' } })
    expect(result.output).not.toContain('PRIVATE_')
    expect(result.output).not.toContain('candidateOperation')
    expect(result.output).not.toContain('affectedIds')
    expect(canonicalJson(task)).toBe(before)
  })

  it('refuses preparing a frozen grant over a terrain with an attached locked note and preserves the existing task', () => {
    const { task } = fixture(), authoring = task.authoring!, before = canonicalJson(task), start = cloneJson(authoring.start)
    start.project = cloneJson(replayAuthoring(authoring.start, authoring.state.steps).project)
    const noteId = 'PRIVATE_LOCKED_DEPENDENCY', scene = start.project.document
    scene.notes[noteId] = { id: noteId, floorId: start.scope.scene!.floorId, editLocked: true,
      anchor: { type: 'entity', entityKind: 'terrainArea', entityId: 'other-land' }, kind: 'clue', text: 'PRIVATE_NOTE_TEXT', visibility: 'public', discovered: false }
    scene.entityLayers[noteId] = start.scope.scene!.layerId
    start.scope.scene!.entityIds = ['real-land', 'other-land']; start.scope.visual!.entityIds = ['real-land', 'other-land']
    start.baseContentHash = authoringProjectHash(start.project)
    // The effective lock propagates through the attachment before a new task
    // can be prepared. Such a grant is never a valid tool-execution fixture.
    expect(() => replayAuthoring(start, [])).toThrow(/未锁定/)
    expect(canonicalJson(task)).toBe(before)
  })

  it('checks the final wrapped receipt before installing even a successfully rebuilt candidate', () => {
    const subject = fixture(), { task } = subject, { args, receipts } = proposals(subject, 1), authoring = task.authoring!, state = authoring.state
    const next = applyAuthoringStep(authoring.start, state, [receipts[0].candidateOperation], 'large-boundary-receipt')
    task.snapshot.usage.requests = 15
    const before = canonicalJson(task)
    let changedIds: string[] = []
    for (let length = 1; length <= 256; length++) {
      const ids = Array.from({ length: 32 }, (_, index) => `affected-${index}-`.padEnd(length, 'x'))
      const output = { draftRevision: next.state.draftRevision, contentHash: next.state.contentHash, operationCost: next.state.operationCost,
        affectedIds: ['real-coast', ...ids].sort(), changedCount: ids.length, remainingOperations: 256 - next.state.operationCost }
      const bytes = Buffer.byteLength(JSON.stringify(output))
      if (bytes >= 7920 && bytes <= 7980) { changedIds = ids; break }
    }
    expect(changedIds).toHaveLength(32)
    // Geometry/hash/ledger equivalence is checked above. This isolates the
    // shared installation gate with a legitimate finite changed-ID receipt.
    const apply = vi.spyOn(authoringCore, 'applyAuthoringStep').mockReturnValue({ ...next, state: { ...next.state, changedIds } })
    try {
      const result = executeAuthoringTool(task, { id: 'large-boundary-receipt', name: 'sceneweave_apply_boundary_candidates', arguments: JSON.stringify(args) }, args, undefined,
        { modelRequests: 16, toolCalls: 64, executionRemainingMs: 12345 })
      expect(result.success).toBe(false)
      expect(JSON.parse(result.output)).toMatchObject({ error: { code: 'tool_output_limit' } })
      ToolResultSchema.parse(result)
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192)
      expect(canonicalJson(task)).toBe(before)
      expect(authoring.state).toBe(state)
    } finally { apply.mockRestore() }
  })

  it('rejects malformed, wrapped, duplicate and oversized candidate lists through the strict input contract without writes', () => {
    const subject = fixture(), { task, run } = subject, { args } = proposals(subject), candidate = args.candidates[0]
    const invalid = [
      { ...args, extra: true },
      { ...args, atDraftRevision: -1 },
      { ...args, atDraftRevision: 1.5 },
      { ...args, atContentHash: 'invalid' },
      { ...args, candidates: [] },
      { ...args, candidates: [...args.candidates, { ...candidate, proposal: { ...candidate.proposal, boundaryId: 'third-coast' } }] },
      { ...args, candidates: [candidate, { ...args.candidates[1], proposal: { ...args.candidates[1].proposal, boundaryId: candidate.proposal.boundaryId } }] },
      { ...args, candidates: [{ ...candidate, candidateHash: 'invalid' }] },
      { ...args, candidates: [{ ...candidate, candidateOperation: { kind: 'visualBoundary' } }] },
      { ...args, candidates: [{ ...candidate, proposal: { ...candidate.proposal, smoothness: null } }] },
      { ...args, candidates: [{ ...candidate, proposal: { ...candidate.proposal, extra: 'PRIVATE_SUBMITTED_VALUE' } }] },
      { ...args, candidates: [null] },
    ]
    const before = canonicalJson(task)
    for (const input of invalid) {
      const result = run('sceneweave_apply_boundary_candidates', input)
      expect(result.success).toBe(false)
      expect(JSON.parse(result.output)).toMatchObject({ error: { code: 'invalid_arguments' } })
      expect(result.output).not.toContain('PRIVATE_')
      expect(canonicalJson(task)).toBe(before)
    }
  })
})
