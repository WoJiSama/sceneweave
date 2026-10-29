import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { svgProjectFixture } from '../../tests/helpers/m24-svg-fixtures.js'
import type { AuthoringStart } from '../../src/shared/ai/authoring-protocol.js'
import { authoringProjectHash, applyAuthoringStep, replayAuthoring } from '../../src/shared/ai/authoring.js'
import { canonicalJson, cloneJson } from '../../src/shared/validation/json.js'
import { emptyVisualSystem } from '../../src/shared/visual/types.js'
import { proposeAuthoringTerrainBoundary } from '../../src/shared/ai/visual-authoring.js'
import type { StoredTask } from './store.js'
import { executeAuthoringTool } from './authoring-tools.js'

function fixture() {
  const project = cloneJson(svgProjectFixture().bundle.project), scene = project.document
  project.schemaVersion = 2; scene.schemaVersion = 2; scene.visual = emptyVisualSystem()
  scene.title = 'PRIVATE_PROJECT_TITLE'
  const floorId = Object.keys(scene.floors)[0], layerId = scene.entityLayers.item, boundsMm = scene.floors[floorId].boundsMm
  const start: AuthoringStart = { schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), seed: randomUUID(), preparedAt: '2026-10-25T00:00:00.000Z',
    disclosure: 'complete-metadata/public-model', skill: { id: 'sceneweave-scene-authoring', version: 1 }, scope: { targetIds: [], operations: [], placement: null,
      scene: { floorId, layerId, boundsMm, entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: [], operations: ['terrain'] },
      visual: { floorId, layerId, boundsMm, entityIds: [], definitionIds: [], materialIds: [], operations: ['visualBoundary'] } },
    brief: { recipe: 'island', requirements: ['Asymmetric rocky coast with a readable cliff'] } }
  const task: StoredTask = { owner: 'test', fingerprint: 'test', messages: [], calls: {}, runtimeMs: 0, runStartedAt: null, outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '',
    authoring: { start, state: replayAuthoring(start, []).state }, snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: { sceneId: scene.sceneId, revision: scene.revision, audience: 'public' },
      status: 'running', generation: 1, lastSequence: 0, text: '', tools: [], usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 1000 } }
  const run = (name: string, args: unknown, id: string = randomUUID()) => executeAuthoringTool(task, { id, name, arguments: JSON.stringify(args) }, args)
  const land = run('sceneweave_edit_scene', { operations: [{ kind: 'terrain', id: 'real-land', groundElevationMm: 800, boundaryMm: [
    { x: 6000, y: 5000 }, { x: 11000, y: 4000 }, { x: 15000, y: 6000 }, { x: 12000, y: 8000 },
    { x: 15500, y: 11000 }, { x: 12000, y: 14500 }, { x: 6500, y: 13000 }, { x: 7500, y: 9000 },
  ] }] })
  expect(land.success).toBe(true)
  return { task, run }
}

describe('read-only terrain proposal shape measurements at the AI service boundary', () => {
  it('adds only authorised measurements after native preview and preserves the exact operation, cost and ledger', () => {
    const { task, run } = fixture(), before = canonicalJson(task), authoring = task.authoring!, query = { areaId: 'real-land', boundaryId: 'real-coast' }
    const replayed = replayAuthoring(authoring.start, authoring.state.steps)
    const expected = proposeAuthoringTerrainBoundary(replayed.project, authoring.start.scope.visual!, new Set(authoring.state.changedIds), query)
    const proposal = run('sceneweave_propose_boundary', query, 'proposal')
    expect(proposal.success).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(proposal))).toBeLessThanOrEqual(8192)
    const receipt = JSON.parse(proposal.output)
    expect(receipt.candidateOperation).toEqual(expected.candidateOperation)
    expect(receipt).toMatchObject({ editHint: expect.stringContaining('{"operations":[candidateOperation]}'), previewValid: true, atDraftRevision: authoring.state.draftRevision, atContentHash: authoring.state.contentHash,
      shapeReview: { sourceAnchorCount: 8, anchorsPreserved: true, appearance: 'unconfirmed', sourceCorners: { concave: expect.any(Number) } } })
    expect(receipt.shapeReview.sourceCorners.concave).toBeGreaterThan(0)
    expect(canonicalJson(task)).toBe(before)
    expect(proposal.output).not.toContain('PRIVATE_')
    const fullPreview = applyAuthoringStep(authoring.start, authoring.state, [receipt.candidateOperation], 'proposal')
    expect(receipt.actualOperationCost).toBe(fullPreview.state.operationCost - authoring.state.operationCost)
    expect(receipt.remainingOperationsAfterEdit).toBe(256 - fullPreview.state.operationCost)
    expect(run('sceneweave_edit_scene', { operations: [receipt.candidateOperation] }, 'adopt').success).toBe(true)
    expect(authoring.state.operationCost).toBe(fullPreview.state.operationCost)
  })

  it('rejects wrapper and null-field mistakes atomically with a safe exact-shape hint, then accepts the unchanged candidate', () => {
    const { task, run } = fixture(), proposal = run('sceneweave_propose_boundary', { areaId: 'real-land', boundaryId: 'real-coast' })
    expect(proposal.success).toBe(true)
    const { candidateOperation } = JSON.parse(proposal.output), before = canonicalJson(task)
    for (const operation of [
      { kind: 'visualBoundary', candidateOperation },
      { kind: 'visualBoundary', boundary: { ...candidateOperation, id: 'PRIVATE_WRAPPER_VALUE' } },
      { ...candidateOperation, binding: null },
    ]) {
      const rejected = run('sceneweave_edit_scene', { operations: [operation] })
      expect(rejected.success).toBe(false)
      expect(JSON.parse(rejected.output)).toMatchObject({ error: { code: 'invalid_arguments', hint: expect.stringContaining('{"operations":[candidateOperation]}') } })
      expect(rejected.output).not.toContain('PRIVATE_')
      expect(canonicalJson(task)).toBe(before)
    }
    const accepted = run('sceneweave_edit_scene', { operations: [candidateOperation] })
    expect(accepted.success).toBe(true)
    expect(task.authoring!.state.draftRevision).toBe(2)
  })

  it('refuses ungranted and private targets without returning shape measurements or identifying them', () => {
    for (const kind of ['ungranted', 'private'] as const) {
      const { task, run } = fixture(), authoring = task.authoring!, hiddenId = 'PRIVATE_UNGRANTED_COAST'
      const built = applyAuthoringStep(authoring.start, authoring.state, [{ kind: 'terrain', id: hiddenId, groundElevationMm: 0, boundaryMm: [
        { x: 17000, y: 2000 }, { x: 19000, y: 2000 }, { x: 19000, y: 4000 }, { x: 17000, y: 4000 },
      ] }], 'existing-other-land')
      authoring.start.project = built.project
      authoring.start.project.document.terrainAreas[hiddenId].visibility = kind === 'private' ? 'gm' : 'public'
      authoring.start.scope.scene!.entityIds = ['real-land']; authoring.start.scope.visual!.entityIds = ['real-land']
      authoring.start.baseContentHash = authoringProjectHash(authoring.start.project)
      // Cold replay proves this is a valid frozen baseline whose other coast
      // is outside the grant, rather than a forged project hash rejection.
      authoring.state = replayAuthoring(authoring.start, []).state
      const baseline = canonicalJson(task), refused = run('sceneweave_propose_boundary', { areaId: hiddenId, boundaryId: 'new-curve' })
      expect(refused.success).toBe(false)
      const error = JSON.parse(refused.output).error
      expect(error).not.toHaveProperty('shapeReview')
      expect(refused.output).not.toContain(hiddenId)
      expect(canonicalJson(task)).toBe(baseline)
    }
  })
})
