import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { compositionCandidateFixture } from '../../tests/helpers/composition-candidates-fixture.js'
import { replayAuthoring } from '../../src/shared/ai/authoring.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import { ToolResultSchema } from '../../src/shared/ai/protocol.js'
import type { StoredTask } from './store.js'
import { executeAuthoringTool } from './authoring-tools.js'

function fixture() {
  const start = compositionCandidateFixture()
  const task: StoredTask = { owner: 'test', fingerprint: 'test', messages: [], calls: {}, runtimeMs: 0, runStartedAt: null, outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '',
    authoring: { start, state: replayAuthoring(start, []).state }, snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: { sceneId: start.project.document.sceneId, revision: start.project.document.revision, audience: 'public' },
      status: 'running', generation: 1, lastSequence: 0, text: '', tools: [], usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 1000 } }
  const run = (name: string, args: unknown) => executeAuthoringTool(task, { id: randomUUID(), name, arguments: JSON.stringify(args) }, args)
  const result = run('sceneweave_edit_scene', { operations: [2000, 8000].map((x, index) => ({ kind: 'terrain', id: ['low', 'high'][index], groundElevationMm: index * 800,
    boundaryMm: [{ x, y: 2000 }, { x: x + 4000, y: 2000 }, { x: x + 4000, y: 6000 }, { x, y: 6000 }] })) })
  expect(result.success).toBe(true)
  return { task, read: (args: unknown) => run('sceneweave_read_scene', args) }
}

describe('bounded scene anchor query diagnostics', () => {
  it.each([undefined, [], ['low', 'high'], Array.from({ length: 16 }, (_, i) => `PRIVATE_QUERY_${i}`)])('rejects the wrong anchor ID cardinality without a geometry diagnosis or task mutation (%j)', ids => {
    const { task, read } = fixture(), before = canonicalJson(task)
    const result = read({ section: 'anchors', ...(ids === undefined ? {} : { ids }) })
    ToolResultSchema.parse(result)
    expect(result.success).toBe(false)
    expect(JSON.parse(result.output)).toMatchObject({ error: { code: 'invalid_arguments', hint: expect.stringContaining('exactly one'), issues: [{ path: 'ids', code: 'custom' }] } })
    expect(result.output).not.toContain('PRIVATE_')
    expect(canonicalJson(task)).toBe(before)
  })

  it('keeps real single-terrain anchor pages and batch scene summaries available without changing the draft', () => {
    const { task, read } = fixture(), before = canonicalJson(task)
    const page = read({ section: 'anchors', ids: ['low'], offset: 1, limit: 2 })
    expect(page.success).toBe(true)
    const persisted = replayAuthoring(task.authoring!.start, task.authoring!.state.steps).project.document.terrainAreas.low.boundaryMm
    expect(JSON.parse(page.output)).toMatchObject({ entityId: 'low', actualPersistedAnchors: true, total: 4, boundaryMm: persisted.slice(1, 3), nextOffset: 3 })
    const batch = read({ section: 'scene', ids: ['low', 'high'] })
    expect(batch.success).toBe(true)
    expect(JSON.parse(batch.output).entities.map((entity: { id: string }) => entity.id).sort()).toEqual(['high', 'low'])
    expect(canonicalJson(task)).toBe(before)
  })

  it('does not reveal or infer an ungranted ID after its cardinality is valid', () => {
    const { task, read } = fixture(), before = canonicalJson(task)
    const result = read({ section: 'anchors', ids: ['PRIVATE_UNGRANTED_QUERY'] })
    expect(result.success).toBe(false)
    expect(result.output).not.toContain('PRIVATE_')
    expect(result.output).not.toContain('boundaryMm')
    expect(canonicalJson(task)).toBe(before)
  })
})
