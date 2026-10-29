import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { terrainAuthoringFixture } from '../../tests/helpers/terrain-authoring-fixture.js'
import { createRefinedBlankDocument } from '../../src/platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import { inspectDependencies } from '../../src/shared/commands/dependencies.js'
import { emptyTerrainDocument } from '../../src/shared/terrain-generation/compose.js'
import { getLegacyGeneration } from '../../src/shared/terrain-generation/composition-contracts.js'
import { validateProjectData } from '../../src/shared/project/validate.js'
import { applyAuthoringStep, authoringProjectHash, replayAuthoring } from '../../src/shared/ai/authoring.js'
import * as authoringCore from '../../src/shared/ai/authoring.js'
import type { AuthoringStart } from '../../src/shared/ai/authoring-protocol.js'
import type { TerrainAuthoringOperation } from '../../src/shared/ai/terrain-protocol.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import type { StoredTask, StoredTerrainCandidate } from './store.js'
import { executeAuthoringTool } from './authoring-tools.js'

afterEach(() => { vi.restoreAllMocks() })

function startFor(kind: 'island' | 'coast'): AuthoringStart {
  const start = terrainAuthoringFixture()
  if (kind === 'island') return start
  const blank = createRefinedBlankDocument('coast', { sceneId: start.project.document.sceneId, title: 'coast version fixture',
    widthMm: 24000, heightMm: 18000, preset: 'narrative', now: start.preparedAt })
  const document = emptyTerrainDocument(blank)
  let sequence = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `coast-version-${++sequence}` }, clock: { now: () => start.preparedAt } })
  const dependencies = inspectDependencies(content.document), licenseText = 'Sceneweave version test metadata license', hash = sha256Text(licenseText)
  start.project = validateProjectData({ ...content, format: 'sceneweave-complete-project', schemaVersion: 3,
    assets: Object.fromEntries(dependencies.assetIds.map(id => { const asset = document.assets[id]; return [asset.sha256, {
      sha256: asset.sha256, mimeType: asset.mimeType, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight, sizeBytes: 1,
    }] })), licenses: { [hash]: { sha256: hash, text: licenseText } },
    licenseBindings: dependencies.subjects.map(subject => ({ ...subject, licensePath: `licenses/${hash}.txt`, embedding: 'allowed' as const })), authoringSources: {} })
  start.scope.scene!.definitionIds = Object.keys(document.propDefinitions)
  start.scope.scene!.materialIds = Object.keys(document.materials)
  start.baseContentHash = authoringProjectHash(start.project)
  return start
}
function fixture(kind: 'island' | 'coast' = 'island') {
  const start = startFor(kind)
  const task: StoredTask = { owner: 'test', fingerprint: 'test', messages: [], calls: {}, runtimeMs: 0, runStartedAt: null,
    outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '', authoring: { start, state: replayAuthoring(start, []).state },
    snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: { sceneId: start.project.document.sceneId,
      revision: start.project.document.revision, audience: 'public' }, status: 'running', generation: 1, lastSequence: 0, text: '', tools: [],
      usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 1000 } }
  const run = (name: string, args: unknown) => executeAuthoringTool(task, { id: randomUUID(), name, arguments: JSON.stringify(args) }, args)
  return { task, run }
}
function generate(start: AuthoringStart, kind: 'island' | 'coast' | 'river' | 'lake' | 'forest' | 'hill' | 'mixed', version?: 1 | 2): Extract<TerrainAuthoringOperation, { kind: 'terrainGenerate' }> {
  return { kind: 'terrainGenerate', request: { sceneId: start.project.document.sceneId, kind, seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000,
    ...(version === undefined ? {} : { algorithmVersion: version }) } }
}
function storedCandidate(task: StoredTask, operation: TerrainAuthoringOperation): StoredTerrainCandidate {
  const authoring = task.authoring!, stepId = `terrain-preview-${sha256Text(canonicalJson([authoring.state.contentHash, operation]))}`
  const preview = applyAuthoringStep(authoring.start, authoring.state, [operation], stepId)
  const hash = sha256Text(canonicalJson({ operation, atContentHash: authoring.state.contentHash, contentHash: preview.state.contentHash }))
  return { id: `terrain-candidate-${hash}`, hash, operation, atContentHash: authoring.state.contentHash,
    atDraftRevision: authoring.state.draftRevision, contentHash: preview.state.contentHash, operationCost: preview.state.operationCost - authoring.state.operationCost }
}
function applyArguments(candidate: StoredTerrainCandidate) {
  return { candidateId: candidate.id, candidateHash: candidate.hash, atContentHash: candidate.atContentHash, atDraftRevision: candidate.atDraftRevision }
}

describe('new terrain tool requests select a version before candidate identity while old replay stays exact', () => {
  it('records version 2 in a fresh default island candidate before hashing without mutating its raw request or draft', () => {
    const { task, run } = fixture(), authoring = task.authoring!, operation = generate(authoring.start, 'island')
    const rawBefore = canonicalJson(operation), stateBefore = canonicalJson(authoring.state), baseBefore = canonicalJson(authoring.start)
    const result = run('sceneweave_terrain_candidates', { operations: [operation] })
    expect(result.success, result.output).toBe(true)
    const candidate = authoring.terrainCandidates![0]
    expect(candidate.operation).toMatchObject({ kind: 'terrainGenerate', request: { algorithmVersion: 2 } })
    expect(candidate.hash).toBe(sha256Text(canonicalJson({ operation: candidate.operation,
      atContentHash: candidate.atContentHash, contentHash: candidate.contentHash })))
    expect(canonicalJson(operation)).toBe(rawBefore)
    expect(canonicalJson(authoring.state)).toBe(stateBefore)
    expect(canonicalJson(authoring.start)).toBe(baseBefore)
    expect(run('sceneweave_terrain_apply_candidate', applyArguments(candidate)).success).toBe(true)
    expect(authoring.state.steps[0].operations[0]).toMatchObject({ kind: 'terrainGenerate', request: { algorithmVersion: 2 } })
    const replayed = replayAuthoring(authoring.start, authoring.state.steps)
    expect(replayed.state).toEqual(authoring.state)
    expect(getLegacyGeneration(replayed.project.document)!.recipes['terrain-recipe'].algorithmVersion).toBe(2)
  })

  it.each([undefined, 1] as const)('selects a fresh coast version %s before identity and preserves the existing atomic authorization rejection', version => {
    const { task, run } = fixture('coast'), authoring = task.authoring!, operation = generate(authoring.start, 'coast', version)
    const expected = { ...operation, request: { ...operation.request, algorithmVersion: version ?? 2 } }
    const before = canonicalJson(task), rawBefore = canonicalJson(operation), apply = vi.spyOn(authoringCore, 'applyAuthoringStep')
    const result = run('sceneweave_terrain_candidates', { operations: [operation] })
    expect(apply).toHaveBeenCalledWith(authoring.start, authoring.state, [expected],
      `terrain-preview-${sha256Text(canonicalJson([authoring.state.contentHash, expected]))}`)
    // The existing coast edge reaches the world border; its full look padding is
    // outside the finite AI grant. Version selection must not weaken that guard.
    expect(result.success).toBe(false)
    expect(JSON.parse(result.output).error.code).toBe('restricted_dependency')
    expect(canonicalJson(task)).toBe(before)
    expect(canonicalJson(operation)).toBe(rawBefore)
  })

  it.each([1, 2] as const)('keeps an explicitly selected version %s when preparing a new candidate', version => {
    const { task, run } = fixture(), operation = generate(task.authoring!.start, 'island', version), before = canonicalJson(operation)
    const result = run('sceneweave_terrain_candidates', { operations: [operation] })
    expect(result.success, result.output).toBe(true)
    expect(canonicalJson(task.authoring!.terrainCandidates![0].operation)).toBe(before)
  })

  it('uses the same new-request default for the direct scene editing tool before recording its ledger', () => {
    const { task, run } = fixture(), authoring = task.authoring!, operation = generate(authoring.start, 'island'), before = canonicalJson(operation)
    expect(run('sceneweave_edit_scene', { operations: [operation] }).success).toBe(true)
    expect(authoring.state.steps[0].operations[0]).toMatchObject({ kind: 'terrainGenerate', request: { algorithmVersion: 2 } })
    expect(canonicalJson(operation)).toBe(before)
    const replayed = replayAuthoring(authoring.start, authoring.state.steps)
    expect(replayed.state).toEqual(authoring.state)
    expect(getLegacyGeneration(replayed.project.document)!.recipes['terrain-recipe'].algorithmVersion).toBe(2)
  })

  it('applies an existing legacy candidate with its original absent version and exact content hash', () => {
    const { task, run } = fixture(), authoring = task.authoring!, operation = generate(authoring.start, 'island')
    const candidate = storedCandidate(task, operation), before = canonicalJson(candidate)
    authoring.terrainCandidates = [candidate]
    expect(run('sceneweave_terrain_apply_candidate', applyArguments(candidate)).success).toBe(true)
    expect(canonicalJson(candidate)).toBe(before)
    expect(authoring.state.steps[0].operations[0]).toEqual(operation)
    const replayed = replayAuthoring(authoring.start, authoring.state.steps)
    expect(replayed.state.contentHash).toBe(candidate.contentHash)
    expect(getLegacyGeneration(replayed.project.document)!.recipes['terrain-recipe'].algorithmVersion).toBe(1)
    expect(operation.request).not.toHaveProperty('algorithmVersion')
  })

  it('replays a JSON-restored legacy ledger without adding version fields during plan/diagnose calls', () => {
    const { task, run } = fixture(), authoring = task.authoring!, operation = generate(authoring.start, 'island')
    authoring.state = JSON.parse(JSON.stringify(applyAuthoringStep(authoring.start, authoring.state, [operation], 'legacy-generate').state))
    const before = canonicalJson(authoring)
    expect(run('sceneweave_terrain_plan', {}).success).toBe(true)
    expect(run('sceneweave_terrain_diagnose', {}).success).toBe(true)
    expect(canonicalJson(authoring)).toBe(before)
    expect(authoring.state.steps[0].operations[0]).toEqual(operation)
    expect(replayAuthoring(authoring.start, authoring.state.steps).state).toEqual(authoring.state)
  })

  it.each(['lake', 'forest', 'hill'] as const)('retains the existing %s algorithm and absent selector', kind => {
    const { task, run } = fixture(), authoring = task.authoring!, operation = generate(authoring.start, kind)
    const result = run('sceneweave_terrain_candidates', { operations: [operation] })
    expect(result.success, result.output).toBe(true)
    expect(authoring.terrainCandidates![0].operation).toEqual(operation)
    expect(operation.request).not.toHaveProperty('algorithmVersion')
  })

  it('does not install the first candidate or mutate requests when a later new request is invalid', () => {
    const { task, run } = fixture(), authoring = task.authoring!, first = generate(authoring.start, 'island')
    const invalid = { ...generate(authoring.start, 'island'), request: { sceneId: 'wrong-scene', kind: 'island', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000 } }
    const args = { operations: [first, invalid] }, before = canonicalJson(task), argsBefore = canonicalJson(args)
    expect(run('sceneweave_terrain_candidates', args).success).toBe(false)
    expect(canonicalJson(task)).toBe(before)
    expect(canonicalJson(args)).toBe(argsBefore)
    expect(authoring.terrainCandidates).toBeUndefined()
  })
})
