import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compositionCandidateFixture } from '../../tests/helpers/composition-candidates-fixture.js'
import { replayAuthoring } from '../../src/shared/ai/authoring.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import { ToolResultSchema, utf8Size } from '../../src/shared/ai/protocol.js'
import type { StoredTask } from './store.js'
import { executeAuthoringTool, getAuthoringTools } from './authoring-tools.js'

function fixture() {
  const start = compositionCandidateFixture()
  const task: StoredTask = { owner: 'test', fingerprint: 'test', messages: [], calls: {}, runtimeMs: 0, runStartedAt: null, outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '',
    authoring: { start, state: replayAuthoring(start, []).state }, snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: { sceneId: start.project.document.sceneId, revision: start.project.document.revision, audience: 'public' },
      status: 'running', generation: 1, lastSequence: 0, text: '', tools: [], usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 1000 } }
  const run = (name: string, args: unknown) => {
    const result = executeAuthoringTool(task, { id: randomUUID(), name, arguments: JSON.stringify(args) }, args)
    ToolResultSchema.parse(result); expect(utf8Size(JSON.stringify(result))).toBeLessThanOrEqual(8192)
    return { ...result, value: JSON.parse(result.output) }
  }
  const room = { kind: 'room', id: 'hall', boundaryMm: [{ x: 6000, y: 5000 }, { x: 14000, y: 5000 }, { x: 14000, y: 11000 }, { x: 6000, y: 11000 }], thicknessMm: 300, materialId: 'tile' }
  return { task, run, room }
}

describe('actionable authoring recovery without weakening the frozen grant', () => {
  it('guides an unsupported room to its explicit ground support and preserves the rejected atomic batch', () => {
    const { task, run, room } = fixture(), before = canonicalJson(task)
    const terrain = { kind: 'terrain', id: 'grass', groundElevationMm: 0, boundaryMm: [{ x: 0, y: 0 }, { x: 24000, y: 0 }, { x: 24000, y: 18000 }, { x: 0, y: 18000 }], materialId: 'tile' }
    const rejected = run('sceneweave_edit_scene', { operations: [terrain, room] })
    expect(rejected.success).toBe(false)
    expect(rejected.value.error).toMatchObject({ code: 'invalid_geometry', operationIndex: 1, hint: expect.stringContaining('room.supportRef') })
    expect(rejected.value.error.hint).toContain('terrainArea')
    expect(rejected.value.error.hint).not.toContain('probe_placement')
    expect(canonicalJson(task)).toBe(before)
    expect(run('sceneweave_edit_scene', { operations: [terrain, { ...room, supportRef: { kind: 'terrainArea', id: 'grass' } }] }).success).toBe(true)
  })

  it('reports the wrong wall-read section accurately and reads the same actual wall through scene', () => {
    const { task, run, room } = fixture()
    expect(run('sceneweave_edit_scene', { operations: [room] }).success).toBe(true)
    const before = canonicalJson(task), wall = replayAuthoring(task.authoring!.start, task.authoring!.state.steps).project.document.walls['hall:wall:0']
    const wrong = run('sceneweave_read_scene', { section: 'targets', ids: [wall.id] })
    expect(wrong.success).toBe(false)
    expect(wrong.value.error).toMatchObject({ code: 'outside_scope', hint: expect.stringContaining('section scene') })
    expect(wrong.value.error.hint).toContain('props only')
    expect(canonicalJson(task)).toBe(before)
    const right = run('sceneweave_read_scene', { section: 'scene', ids: [wall.id] })
    expect(right.success).toBe(true)
    expect(right.value.entities).toContainEqual(expect.objectContaining({ id: wall.id, startVertexId: wall.startVertexId, endVertexId: wall.endVertexId }))
    expect(canonicalJson(task)).toBe(before)
  })

  it('does not offer a ground-support repair or reveal IDs for an unauthorised room support', () => {
    const { task, run, room } = fixture(), before = canonicalJson(task)
    const result = run('sceneweave_edit_scene', { operations: [{ ...room, supportRef: { kind: 'terrainArea', id: 'PRIVATE_UNGRANTED_SURFACE' } }] })
    expect(result.success).toBe(false)
    expect(result.value.error.code).toBe('outside_scope')
    expect(result.output).not.toContain('PRIVATE_UNGRANTED_SURFACE')
    expect(result.value.error.hint ?? '').not.toContain('room.supportRef')
    expect(canonicalJson(task)).toBe(before)
  })

  it.each(['PRIVATE_UNGRANTED_WALL', 'PRIVATE_UNGRANTED_PROP'])('does not leak or infer ungranted IDs while suggesting a read section (%s)', id => {
    const { task, run } = fixture(), before = canonicalJson(task)
    const result = run('sceneweave_read_scene', { section: 'targets', ids: [id] })
    expect(result.success).toBe(false)
    expect(result.value.error.code).toBe('outside_scope')
    expect(result.output).not.toContain(id)
    expect(canonicalJson(task)).toBe(before)
  })

  it('identifies entrance fields instead of suggesting unrelated boundary candidates', () => {
    const { task, run } = fixture(), before = canonicalJson(task)
    const result = run('sceneweave_edit_scene', { operations: [{ kind: 'entrance', id: 'PRIVATE_EXTRA_KEY_VALUE', openingIds: ['door'] }] })
    expect(result.success).toBe(false)
    expect(result.value.error).toMatchObject({ code: 'invalid_arguments', hint: expect.stringContaining('entrance') })
    expect(result.value.error.hint).toContain('openingIds')
    expect(result.value.error.hint).toContain('no id')
    expect(result.value.error.hint).not.toContain('boundary')
    expect(result.output).not.toContain('PRIVATE_EXTRA_KEY_VALUE')
    expect(canonicalJson(task)).toBe(before)
  })

  it('keeps Floor out of plan evidence and teaches pending requirements to use no evidence', () => {
    const { task, run } = fixture(), before = canonicalJson(task), floor = task.authoring!.start.scope.scene!.floorId
    const result = run('sceneweave_plan_draft', { phase: 'layout', requirements: [{ index: 0, state: 'pending', evidenceIds: [floor] }] })
    expect(result.success).toBe(false)
    expect(result.value.error).toMatchObject({ code: 'outside_scope', hint: expect.stringContaining('pending') })
    expect(result.value.error.hint).toContain('evidenceIds: []')
    expect(canonicalJson(task)).toBe(before)
    expect(run('sceneweave_plan_draft', { phase: 'layout', requirements: [{ index: 0, state: 'pending', evidenceIds: [] }] }).success).toBe(true)
  })

  it('describes the structural read section at the section field itself', () => {
    const { task } = fixture()
    const read = getAuthoringTools(task.authoring!.start.scope, 4).find(tool => tool.name === 'sceneweave_read_scene')!
    expect((read.parameters as { properties: { section: { description?: string } } }).properties.section.description).toContain('walls')
  })
})
