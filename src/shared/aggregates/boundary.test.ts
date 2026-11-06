import { describe, expect, it } from 'vitest'
import { fixture as workspaceFixture, runtime } from '../../application/workspace/test-fixtures.js'
import { AGGREGATE_CONTRACT, type AggregateContract } from '../model/aggregate.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { advanceHistoryIdentity } from '../history/identity.js'
import { createAggregateBoundaryInspector, inspectAggregateBoundaryImpact } from './boundary.js'
import { aggregateSceneSource } from './contracts.js'
import { createAggregateInternalProof } from './proofs.js'
import { buildAggregateSpatialIndex } from './spatial.js'

function fixture() {
  const project = cloneJson(workspaceFixture().project), scene = project.document, before = cloneJson(scene)
  scene.notes.attached = { id: 'attached', floorId: 'blank-floor', editLocked: true, kind: 'note', text: 'private dependency',
    visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
  scene.entityLayers.attached = scene.entityLayers.item
  const contract: AggregateContract = {
    contract: AGGREGATE_CONTRACT, source: aggregateSceneSource(scene),
    groups: {
      root: { id: 'root', floorId: 'blank-floor', parentId: null, editLocked: false,
        frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [] },
      child: { id: 'child', floorId: 'blank-floor', parentId: 'root', editLocked: false,
        frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [{ kind: 'prop', id: 'item' }] },
      externalGroup: { id: 'externalGroup', floorId: 'blank-floor', parentId: null, editLocked: false,
        frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [{ kind: 'prop', id: 'other' }] },
    }, ports: {}, chunkSizeMm: 10000, chunks: [],
  }
  scene.aggregateCoordinates = { encoding: 'world', groups: cloneJson(contract.groups) }
  project.historyIdentity = advanceHistoryIdentity(project.historyIdentity, before, scene, runtime)
  contract.source = aggregateSceneSource(scene)
  const constraints = { clearanceMm: 600 }, algorithmContract = 'boundary-test@1'
  const proof = createAggregateInternalProof(project, contract, 'root', constraints, algorithmContract)
  return { project, contract, index: buildAggregateSpatialIndex(scene, { audience: 'gm' }), groupId: 'root', floorId: 'blank-floor',
    previousBoundsMm: { x: 3500, y: 3500, width: 1000, height: 1000 }, nextBoundsMm: { x: 8500, y: 8500, width: 1000, height: 1000 },
    changedTargets: [{ kind: 'prop', id: 'item' }], constraints, algorithmContract, proof }
}

describe('aggregate read-only boundary impact', () => {
  it('keeps external old/new candidates, nested ownership and reverse locked dependencies distinct', () => {
    const input = fixture(), before = canonicalJson(input.project), impact = inspectAggregateBoundaryImpact(input)
    expect(impact.externalCandidates.previous.some(row => row.entity.id === 'item')).toBe(false)
    expect(impact.externalCandidates.next).toContainEqual(expect.objectContaining({ entity: { kind: 'prop', id: 'other' } }))
    expect(impact.externalCandidates.previous).toContainEqual(expect.objectContaining({ entity: { kind: 'floor', id: 'blank-floor' } }))
    expect(impact.dependencyClosure.affected).toContainEqual({ kind: 'note', id: 'attached' })
    expect(impact.lockedDependencies).toContainEqual(expect.objectContaining({ entity: { kind: 'note', id: 'attached' } }))
    expect(impact.baselineProofValid).toBe(true)
    expect(impact.queryScope).toBe('supplied-bounds')
    expect(impact.requiresFullDomainValidation).toBe(true)
    expect(canonicalJson(input.project)).toBe(before)
  })

  it('refuses proofs from another group, forged handles and changed complete-project metadata', () => {
    const input = fixture()
    expect(inspectAggregateBoundaryImpact({ ...input, proof: createAggregateInternalProof(input.project, input.contract, 'externalGroup', input.constraints, input.algorithmContract) }).baselineProofValid).toBe(false)
    expect(inspectAggregateBoundaryImpact({ ...input, proof: cloneJson(input.proof) }).baselineProofValid).toBe(false)
    const changed = cloneJson(input.project)
    changed.appearance.instanceAdjustments.item = [{ id: 'boundary-opacity', kind: 'opacity', value: 0.5, enabled: false }]
    expect(inspectAggregateBoundaryImpact({ ...input, project: changed }).baselineProofValid).toBe(false)
  })

  it('rejects forged/player/stale indices, missing groups and a mismatched Floor', () => {
    const input = fixture()
    expect(() => inspectAggregateBoundaryImpact({ ...input, index: cloneJson(input.index) })).toThrow(/索引/)
    expect(() => inspectAggregateBoundaryImpact({ ...input, index: buildAggregateSpatialIndex(input.project.document, { audience: 'player' }) })).toThrow(/GM/)
    expect(() => inspectAggregateBoundaryImpact({ ...input, groupId: 'missing' })).toThrow(/不存在/)
    expect(() => inspectAggregateBoundaryImpact({ ...input, floorId: 'missing' })).toThrow(/Floor/)
    const changed = cloneJson(input.project)
    changed.document.props.item.positionMm.x += 100
    const contract = { ...input.contract, source: aggregateSceneSource(changed.document) }
    expect(() => inspectAggregateBoundaryImpact({ ...input, project: changed, contract })).toThrow(/过期/)
  })

  it('falls back conservatively on unknown dependencies and never invokes accessors', () => {
    const input = fixture()
    const unknown = inspectAggregateBoundaryImpact({ ...input, changedTargets: [{ kind: 'prop', id: 'missing' }] })
    expect(unknown.dependencyClosure.requiresSceneWideFallback).toBe(true)
    expect(unknown.baselineProofValid).toBe(false)
    let calls = 0
    const unsafe = Object.defineProperty({ ...input }, 'constraints', { enumerable: true, get: () => { calls++; return {} } })
    expect(() => inspectAggregateBoundaryImpact(unsafe)).toThrow(/访问器/)
    expect(calls).toBe(0)
    expect(() => inspectAggregateBoundaryImpact({ ...input, changedTargets: [{ kind: 'unknown', id: 'item' }] })).toThrow()
    expect(() => inspectAggregateBoundaryImpact({ ...input, roles: [] })).toThrow()
  })

  it('cannot hide an external obstacle by replacing the persistent ownership with a temporary proposal', () => {
    const input = fixture(), contract = cloneJson(input.contract)
    contract.groups.root.members.push({ kind: 'prop', id: 'other' })
    contract.groups.externalGroup.members = []
    expect(() => inspectAggregateBoundaryImpact({ ...input, contract })).toThrow(/持久聚合归属/)
  })

  it('reuses only captured baseline summaries and returns immutable diagnostics', () => {
    const input = fixture(), inspector = createAggregateBoundaryInspector(input.project, input.contract, input.constraints, input.algorithmContract)
    const { project: _project, contract: _contract, index: _index, constraints: _constraints, algorithmContract: _algorithm, proof: _proof, ...query } = input
    const first = inspector.inspect(query), second = inspector.inspect(query)
    expect(second.dependencyClosure).toBe(first.dependencyClosure)
    expect(inspector.affectedClosure(query.changedTargets)).toBe(first.dependencyClosure)
    expect(() => inspector.affectedClosure([])).toThrow()
    expect(() => inspector.affectedClosure([{ kind: 'unsupported', id: 'item' }])).toThrow()
    expect(Object.isFrozen(first)).toBe(true)
    input.project.document.props.item.positionMm.x += 200
    input.contract.groups.child.members = []
    const captured = inspector.inspect(query)
    expect(captured).toEqual(second)
    expect(() => inspectAggregateBoundaryImpact(input)).toThrow(/过期/)
  })
})
