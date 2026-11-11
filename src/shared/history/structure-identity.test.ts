import { describe, expect, it } from 'vitest'
import builtin from '../../platform/browser/content/builtin-data.json'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { SceneDocument } from '../model/scene.js'
import { createHistoryIdentity, createHistoryIdentityTrace, mergeIdentityRecords, validateHistoryIdentity, validateHistoryIdentityShape } from './identity.js'
import { assertStructureContinuity, structureWitness } from './structure-identity.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCommands } from '../commands/commands.js'

function fixture() {
  let scene = toCurrentSceneDocument(structuredClone(builtin.project.document) as unknown as SceneDocument)
  let n = 0
  const context = { ids: { nextId: () => `persistent-structure-${++n}` }, clock: { now: () => scene.updatedAt } }
  const floorId = Object.keys(scene.floors)[0]
  scene = applyCommands(scene, [{ type: 'createRoom', id: 'ordinary-building', floorId, boundaryMm: [{ x: 3000, y: 3000 }, { x: 9000, y: 3000 }, { x: 9000, y: 9000 }, { x: 3000, y: 9000 }], thicknessMm: 200 }], context)
  const wall = Object.values(scene.walls)[0]
  scene = applyCommands(scene, [{ type: 'addOpening', id: 'ordinary-door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 2000, widthMm: 1000, kind: 'door', state: 'open' }], context)
  return { scene, context }
}
describe('persistent ordinary structural continuity', () => {
  it('does not manufacture a missing current structure axis by merging historical records', () => {
    const { scene, context } = fixture(), historic = createHistoryIdentity(scene, context), current = structuredClone(historic)
    delete current.structureTokens
    expect(validateHistoryIdentity(current, scene).structureTokens).toBeUndefined()
    expect(() => mergeIdentityRecords(current, [historic])).toThrow(/不能用历史记录补造/)
    expect(current.structureTokens).toBeUndefined()
  })
  it('persists all structural births and exact topology through strict JSON cold validation', () => {
    const { scene, context } = fixture(), identity = createHistoryIdentity(scene, context)
    const ids = ['floors', 'rooms', 'walls', 'vertices', 'openings'].flatMap(key => Object.keys(scene[key as 'floors']))
    expect(Object.keys(identity.structureTokens!).sort()).toEqual(ids.sort())
    expect(validateHistoryIdentity(JSON.parse(JSON.stringify(identity)), scene)).toEqual(identity)
    for (const id of ids) expect(structureWitness(identity, id).token).toBeTruthy()
    const missing = structuredClone(identity); delete missing.structureTokens![ids[0]]
    expect(() => validateHistoryIdentity(missing, scene)).toThrow(/结构缺少/)
    const aliased = structuredClone(identity), records = Object.values(aliased.structureTokens!)
    records[1].token = records[0].token
    expect(() => validateHistoryIdentityShape(aliased)).toThrow(/全局唯一/)
  })
  it('observes topology changed and changed back inside one transaction without rewinding its token', () => {
    const { scene, context } = fixture(), identity = createHistoryIdentity(scene, context), wall = Object.values(scene.walls)[0]
    const trace = createHistoryIdentityTrace(identity, scene, context), draft = structuredClone(scene)
    const changed = draft.walls[wall.id]; [changed.startVertexId, changed.endVertexId] = [changed.endVertexId, changed.startVertexId]
    trace.observe(draft); trace.observe(scene)
    const after = trace.finish(scene)
    expect(after.structureTokens![wall.id].token).toBe(identity.structureTokens![wall.id].token)
    expect(after.structureTokens![wall.id].topologyToken).not.toBe(identity.structureTokens![wall.id].topologyToken)
    expect(() => assertStructureContinuity(after, identity, [wall.id])).toThrow(/连续性不足/)
    expect(mergeIdentityRecords(after, [identity]).structureTokens![wall.id]).toEqual(after.structureTokens![wall.id])
  })
  it('keeps coordinates, width and door state as edits while refusing same-ID resurrection and kind reuse', () => {
    const { scene, context } = fixture(), identity = createHistoryIdentity(scene, context), wall = Object.values(scene.walls)[0]
    const trace = createHistoryIdentityTrace(identity, scene, context), draft = structuredClone(scene)
    draft.walls[wall.id].thicknessMm += 100
    Object.values(draft.vertices)[0].xMm += 20
    const opening = Object.values(draft.openings)[0]
    if (opening) { opening.state = 'closed'; opening.locked = true }
    trace.observe(draft)
    expect(trace.finish(scene).structureTokens).toEqual(identity.structureTokens)
    const removed = structuredClone(scene); delete removed.walls[wall.id]
    const retired = createHistoryIdentityTrace(identity, scene, context)
    retired.observe(removed)
    expect(() => retired.observe(scene)).toThrow(/退休结构ID/)
    const restored = createHistoryIdentityTrace(identity, scene, context, { allowResurrection: true })
    restored.observe(removed); restored.observe(scene)
    expect(restored.finish(scene).structureTokens![wall.id].topologyToken).not.toBe(identity.structureTokens![wall.id].topologyToken)
  })
  it('does not invent historical continuity when an earlier project has no persistent structural axis', () => {
    const { scene, context } = fixture(), legacy = createHistoryIdentity(scene, context)
    delete legacy.structureTokens
    expect(validateHistoryIdentity(legacy, scene).structureTokens).toBeUndefined()
    expect(createHistoryIdentityTrace(legacy, scene, context).finish(scene).structureTokens).toBeUndefined()
    expect(() => structureWitness(legacy, Object.keys(scene.floors)[0])).toThrow(/尚无持久出生证明/)
    const initialized = createHistoryIdentityTrace(legacy, scene, context, { initializeStructures: true }).finish(scene)
    expect(Object.keys(initialized.structureTokens!).length).toBeGreaterThan(0)
    expect(() => assertStructureContinuity(initialized, legacy, [Object.keys(scene.floors)[0]])).toThrow(/连续性不足/)
    expect(legacy.structureTokens).toBeUndefined()
  })
  it('uses the ordinary composition trace for real commands and leaves the caller unchanged', () => {
    const { scene, context } = fixture(), base = createCompositionContent(scene, context), before = structuredClone(base), wall = Object.values(scene.walls)[0]
    const next = applyCompositionCommands(base, [{ type: 'reverseWall', id: wall.id }, { type: 'reverseWall', id: wall.id }], context)
    expect(next.document.walls).toEqual(base.document.walls)
    expect(next.historyIdentity.structureTokens![wall.id].topologyToken).not.toBe(base.historyIdentity.structureTokens![wall.id].topologyToken)
    expect(base).toEqual(before)
  })
})
