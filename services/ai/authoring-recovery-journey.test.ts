import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { compositionCandidateFixture } from '../../tests/helpers/composition-candidates-fixture.js'
import { currentAuthoringFixture } from '../../tests/helpers/current-authoring-fixture.js'
import { authoringProjectHash, replayAuthoring } from '../../src/shared/ai/authoring.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import { validateGeometry } from '../../src/shared/geometry/geometry.js'
import type { StoredTask } from './store.js'
import { executeAuthoringTool } from './authoring-tools.js'

describe('building/outdoor authoring recovery through the real finite executor', () => {
  it('recovers support and structural reads, then validates real doors, paths and furnishing without changing its source', () => {
    const input = compositionCandidateFixture()
    input.scope.scene!.operations.push('path')
    input.brief = { recipe: 'custom', requirements: ['Create three connected rooms on grass with roads and furnishing'] }
    const start = currentAuthoringFixture(input), sourceHash = authoringProjectHash(start.project)
    const task: StoredTask = { owner: 'test', fingerprint: 'test', messages: [], calls: {}, runtimeMs: 0, runStartedAt: null,
      outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '', authoring: { start, state: replayAuthoring(start, []).state },
      snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: { sceneId: start.project.document.sceneId,
        revision: start.project.document.revision, audience: 'public' }, status: 'running', generation: 1, lastSequence: 0, text: '',
        tools: [], usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 1000 } }
    const run = (name: string, args: unknown) => {
      const result = executeAuthoringTool(task, { id: randomUUID(), name, arguments: JSON.stringify(args) }, args)
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192)
      return { result, output: JSON.parse(result.output) }
    }
    const edit = (operations: unknown[]) => run('sceneweave_edit_scene', { operations })
    const ring = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
    const grass = { kind: 'terrain', id: 'grass', boundaryMm: ring(0, 0, 24000, 18000), groundElevationMm: 0, materialId: 'tile' }
    const rooms = [
      { kind: 'room', id: 'hall', boundaryMm: ring(6000, 4000, 5000, 8000), thicknessMm: 300, materialId: 'tile' },
      { kind: 'room', id: 'rest', boundaryMm: ring(11000, 4000, 5000, 4000), thicknessMm: 300, materialId: 'tile' },
      { kind: 'room', id: 'storage', boundaryMm: ring(11000, 8000, 5000, 4000), thicknessMm: 300, materialId: 'tile' },
    ]
    const before = canonicalJson(task.authoring!.state)
    const rejected = edit([grass, ...rooms])
    expect(rejected.result.success).toBe(false)
    expect(rejected.output.error).toMatchObject({ operationIndex: 1, hint: expect.stringContaining('supportRef') })
    expect(canonicalJson(task.authoring!.state)).toBe(before)
    expect(edit([grass, ...rooms.map(room => ({ ...room, supportRef: { kind: 'terrainArea', id: 'grass' } }))]).result.success).toBe(true)

    const built = replayAuthoring(start, task.authoring!.state.steps).project.document
    const wallIds = Object.keys(built.walls)
    const wrongRead = run('sceneweave_read_scene', { section: 'targets', ids: wallIds })
    expect(wrongRead.result.success).toBe(false)
    expect(wrongRead.output.error).toMatchObject({ code: 'outside_scope', hint: expect.stringContaining('scene') })
    const walls = run('sceneweave_read_scene', { section: 'scene', ids: wallIds })
    expect(walls.result.success).toBe(true)
    expect(walls.output.entities).toHaveLength(10)
    for (const wall of walls.output.entities) {
      expect(wall.startVertexId).toBe(built.walls[wall.id].startVertexId)
      expect(wall.endVertexId).toBe(built.walls[wall.id].endVertexId)
    }
    // Select walls by the actual persisted endpoints; numeric ID suffixes are not topology.
    const wallAt = (ax: number, ay: number, bx: number, by: number) => {
      const wall = Object.values(built.walls).find(value => {
        const a = built.vertices[value.startVertexId], b = built.vertices[value.endVertexId]
        return a.xMm === ax && a.yMm === ay && b.xMm === bx && b.yMm === by
          || b.xMm === ax && b.yMm === ay && a.xMm === bx && a.yMm === by
      })!
      expect(wall).toBeDefined()
      return wall
    }
    const south = wallAt(6000, 12000, 11000, 12000)
    const northDivider = wallAt(11000, 4000, 11000, 8000)
    const southDivider = wallAt(11000, 8000, 11000, 12000)
    const door = (id: string, wall: typeof south, widthMm = 1200) => ({ kind: 'opening', id, wallId: wall.id,
      offsetReferenceVertexId: wall.startVertexId, offsetMm: 1400, widthMm, openingKind: 'door', state: 'open' })
    const beforeEntrance = canonicalJson(task.authoring!.state)
    const doors = [door('outside', south), door('hall-rest', northDivider), door('hall-storage', southDivider)]
    const badEntrance = edit([...doors, { kind: 'entrance', id: 'unsupported-extra-id', openingIds: ['outside'] }])
    expect(badEntrance.result.success).toBe(false)
    expect(badEntrance.output.error).toMatchObject({ code: 'invalid_arguments', hint: expect.stringContaining('openingIds') })
    expect(canonicalJson(task.authoring!.state)).toBe(beforeEntrance)
    expect(edit([...doors, { kind: 'entrance', openingIds: ['outside'] }]).result.success).toBe(true)
    const supportRef = { kind: 'terrainArea', id: 'grass' }
    expect(edit([
      { kind: 'path', id: 'main-road', centerlineMm: [{ x: 8000, y: 17250 }, { x: 8000, y: 13300 }], widthMm: 1500,
        supportRefs: [supportRef], materialId: 'tile' },
      { kind: 'path', id: 'camp-road', centerlineMm: [{ x: 8000, y: 15800 }, { x: 3000, y: 15800 }], widthMm: 1500,
        supportRefs: [supportRef], materialId: 'tile' },
      { kind: 'furnish', id: 'hall-desk', definitionId: 'definition', positionMm: { x: 7800, y: 6000 }, supportRef: { kind: 'room', id: 'hall' } },
      { kind: 'furnish', id: 'camp-prop', definitionId: 'alternate', positionMm: { x: 3000, y: 13000 }, supportRef },
    ]).result.success).toBe(true)
    expect(run('sceneweave_check_draft', {}).result.success).toBe(true)
    const project = replayAuthoring(start, task.authoring!.state.steps).project
    expect(validateGeometry(project.document).errors).toEqual([])
    expect(Object.keys(project.document.rooms)).toHaveLength(3)
    expect(Object.keys(project.document.openings)).toHaveLength(3)
    expect(Object.keys(project.document.paths)).toHaveLength(2)
    expect(Object.keys(project.document.props)).toHaveLength(2)
    expect(project.document.constraints.entranceOpeningIds).toEqual(['outside'])
    expect(task.authoring!.state.operationCost).toBeLessThanOrEqual(256)
    expect(authoringProjectHash(start.project)).toBe(sourceHash)
  }, 20000)
})
