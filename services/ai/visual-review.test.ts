import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { svgFixturePng, svgProjectFixture } from '../../tests/helpers/m24-svg-fixtures.js'
import { authoringProjectHash, replayAuthoring } from '../../src/shared/ai/authoring.js'
import { createPublicVisionInput } from '../../src/shared/ai/vision.js'
import { canonicalJson, cloneJson } from '../../src/shared/validation/json.js'
import type { AuthoringStart } from '../../src/shared/ai/authoring-protocol.js'
import type { StoredTask } from './store.js'
import { executeAuthoringTool } from './authoring-tools.js'
import { proposeVisualReview, visualReviewTool } from './visual-review.js'

function fixture() {
  const project = cloneJson(svgProjectFixture().bundle.project), scene = project.document, floorId = Object.keys(scene.floors)[0]
  const start: AuthoringStart = { schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), seed: randomUUID(), preparedAt: '2026-10-27T00:00:00.000Z',
    skill: { id: 'sceneweave-prop-authoring', version: 1 }, disclosure: 'complete-metadata/public-model',
    scope: { targetIds: ['item'], operations: ['opacity', 'transform'], placement: { floorId, layerId: scene.entityLayers.item, supportRef: { kind: 'floor', id: floorId }, boundsMm: scene.floors[floorId].boundsMm, definitionIds: ['definition'] } } }
  const state = replayAuthoring(start, []).state
  const image = createPublicVisionInput(svgFixturePng(), { sceneId: scene.sceneId, revision: scene.revision, boundsMm: { x: 1000, y: 1000, width: 1000, height: 1000 }, draft: { draftRevision: 0, contentHash: start.baseContentHash } })
  const task: StoredTask = { owner: 'test', fingerprint: 'test', messages: [{ role: 'user', content: 'public screenshot', images: [image] }], calls: {}, runtimeMs: 0, runStartedAt: null, outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '',
    authoring: { start, state }, snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: { sceneId: scene.sceneId, revision: scene.revision, audience: 'public' }, status: 'running', generation: 1, lastSequence: 0, text: '', tools: [], usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 1000 } }
  return { task, image }
}
function args(image: ReturnType<typeof createPublicVisionInput>, overrides: Record<string, unknown> = {}) {
  return { draftRevision: image.draft?.draftRevision ?? 0, contentHash: image.draft?.contentHash ?? '0'.repeat(64), issues: [{ observation: 'edge looks too bright', uncertainty: 'single public screenshot cannot establish final appearance', target: { kind: 'entities', ids: ['item'] } }], candidateOperations: [{ kind: 'opacity', id: 'item', value: 0.8 }], ...overrides }
}

describe('read-only visual review candidate', () => {
  it('publishes a strict tool and returns a valid detached preview without changing task state', () => {
    expect(visualReviewTool.name).toBe('sceneweave_visual_review')
    const { task, image } = fixture(), before = canonicalJson(task), output = proposeVisualReview(task, args(image, { contentHash: task.authoring!.start.baseContentHash }), 'review-1') as Record<string, unknown>
    expect(output).toMatchObject({ previewValid: true, actualOperationCost: 1, atDraftRevision: 0, atContentHash: task.authoring!.state.contentHash, observation: 'unverified', appearance: 'unconfirmed' })
    expect(output.screenshotBinding).toMatchObject({ sha256: image.sha256, draftRevision: 0, contentHash: task.authoring!.start.baseContentHash })
    expect(canonicalJson(task)).toBe(before)
  })

  it('rejects a screenshot whose draft stamp is stale', () => {
    const { task, image } = fixture()
    expect(() => proposeVisualReview(task, args(image, { draftRevision: 1, contentHash: 'a'.repeat(64) }), 'stale')).toThrow(/截图不是任务当前公开图像|草稿基线/)
  })

  it('rejects an ungranted entity and an out-of-bounds region without echoing private IDs', () => {
    const { task, image } = fixture(), privateId = 'PRIVATE_ENTITY_ID'
    const rejected = (value: unknown, callId: string) => {
      let failure: Error | undefined
      try { proposeVisualReview(task, value, callId) } catch (error) { failure = error as Error }
      expect(failure).toBeDefined()
      expect(failure?.message).not.toContain(privateId)
    }
    rejected(args(image, { issues: [{ observation: 'x', uncertainty: 'y', target: { kind: 'entities', ids: [privateId] } }], candidateOperations: [{ kind: 'opacity', id: privateId, value: 0.5 }] }), 'private')
    expect(() => proposeVisualReview(task, args(image, { issues: [{ observation: 'x', uncertainty: 'y', target: { kind: 'region', boundsMm: { x: 2500, y: 1000, width: 100, height: 100 } } }], candidateOperations: [{ kind: 'visualFilter', id: 'new-filter', target: { kind: 'region', boundaryMm: [{ x: 2500, y: 1000 }, { x: 2600, y: 1000 }, { x: 2600, y: 1100 }] }, preset: 'aged', exposure: 1, saturation: 1, contrast: 1, vignette: 0, grain: 0, seed: 's', enabled: true }] }), 'region')).toThrow(/明确授权范围/)
    rejected(args(image, { issues: [{ observation: privateId, uncertainty: 'y', target: { kind: 'entities', ids: [privateId] } }], candidateOperations: [{ kind: 'opacity', id: privateId, value: 0.5 }] }), 'private-message')
  })

  it('rejects more than one bounded authoring step of candidate operations', () => {
    const { task, image } = fixture(), candidateOperations = Array.from({ length: 17 }, (_, index) => ({ kind: 'opacity' as const, id: 'item', value: index / 20 }))
    expect(() => proposeVisualReview(task, args(image, { candidateOperations }), 'too-many')).toThrow(/有限合同|参数/)
  })

  it('allows an artwork-only grant to review its public prop without a Floor grant', () => {
    const { task, image } = fixture()
    task.authoring!.start = { ...task.authoring!.start, skill: { id: 'sceneweave-artwork-authoring', version: 1 },
      scope: { targetIds: ['item'], placement: null, operations: [], artwork: { mode: 'single', targetIds: ['item'], operations: ['style'], boundsMm: { x: 0, y: 0, width: 10000, height: 10000 } } } }
    task.authoring!.state = replayAuthoring(task.authoring!.start, []).state
    const output = proposeVisualReview(task, args(image, { candidateOperations: [{ kind: 'style', ids: ['item'], brightness: 0.8 }] }), 'artwork-review') as Record<string, unknown>
    expect(output).toMatchObject({ previewValid: true, appearance: 'unconfirmed' })
  })

  it('does not install an earlier stage chunk when a later chunk fails', () => {
    const { task } = fixture(), before = canonicalJson(task), operations = [
      ...Array.from({ length: 16 }, () => ({ kind: 'opacity' as const, id: 'item', value: 0.8 })),
      { kind: 'opacity' as const, id: 'UNGRANTED', value: 0.5 },
    ]
    const result = executeAuthoringTool(task, { id: 'stage-atomic', name: 'sceneweave_apply_stage', arguments: JSON.stringify({ stage: 'furnishing', operations }) }, { stage: 'furnishing', operations })
    expect(result.success).toBe(false)
    expect(canonicalJson(task)).toBe(before)
  })
})
