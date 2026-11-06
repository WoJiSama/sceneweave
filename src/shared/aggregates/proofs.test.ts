import { describe, expect, it } from 'vitest'
import { fixture as workspaceFixture } from '../../application/workspace/test-fixtures.js'
import { AGGREGATE_CONTRACT, type AggregateContract } from '../model/aggregate.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { aggregateSceneSource } from './contracts.js'
import { createAggregateInternalProof, isAggregateInternalProofValid } from './proofs.js'

function fixture() {
  const project = cloneJson(workspaceFixture({ building: true }).project), scene = project.document
  const contract: AggregateContract = {
    contract: AGGREGATE_CONTRACT,
    source: aggregateSceneSource(scene),
    groups: { root: { id: 'root', floorId: 'blank-floor', parentId: null, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 },
      members: [{ kind: 'prop', id: 'item' }], editLocked: false } },
    ports: {}, chunkSizeMm: 10000, chunks: [],
  }
  return { project, scene, contract }
}

function refreshed(scene: SceneDocument, contract: AggregateContract): AggregateContract {
  return { ...cloneJson(contract), source: aggregateSceneSource(scene) }
}

describe('private aggregate internal proof snapshots', () => {
  it('issues a frozen proof only after complete contract validation and binds the whole context', () => {
    const { project, scene, contract } = fixture(), constraints = { clearanceMm: 600, support: 'floor' }
    const proof = createAggregateInternalProof(project, contract, 'root', constraints, 'building-layout@2')
    expect(Object.isFrozen(proof)).toBe(true)
    expect(Object.isFrozen(proof.source)).toBe(true)
    expect(proof.memberCount).toBe(1)
    expect(isAggregateInternalProofValid(project, contract, proof, constraints, 'building-layout@2')).toBe(true)
    expect(isAggregateInternalProofValid(project, contract, structuredClone(proof), constraints, 'building-layout@2')).toBe(false)
    expect(isAggregateInternalProofValid(project, contract, proof, { ...constraints, clearanceMm: 700 }, 'building-layout@2')).toBe(false)
    expect(isAggregateInternalProofValid(project, contract, proof, constraints, 'building-layout@3')).toBe(false)
  })

  it('rejects same-ID content edits, lock and secret changes, and stale aggregate bindings', () => {
    const { project, scene, contract } = fixture(), proof = createAggregateInternalProof(project, contract, 'root', {}, 'test-geometry@1')
    const changed = cloneJson(project)
    changed.document.props.item.positionMm.x += 100
    expect(isAggregateInternalProofValid(changed, contract, proof, {}, 'test-geometry@1')).toBe(false)

    const changedAppearance = cloneJson(project)
    changedAppearance.appearance.instanceAdjustments.item = [{ id: 'proof-opacity', kind: 'opacity', value: 0.5, enabled: true }]
    expect(isAggregateInternalProofValid(changedAppearance, contract, proof, {}, 'test-geometry@1')).toBe(false)

    const changedDocument = cloneJson(scene)
    changedDocument.props.item.editLocked = true
    const changedContract = refreshed(changedDocument, contract)
    const changedProject = cloneJson(project); changedProject.document = changedDocument
    expect(isAggregateInternalProofValid(changedProject, changedContract, proof, {}, 'test-geometry@1')).toBe(false)
    expect(() => createAggregateInternalProof(changedProject, contract, 'root', {}, 'test-geometry@1')).toThrow(/过期/)
  })

  it('rejects unregistered objects and does not invoke constraint accessors', () => {
    const { project, contract } = fixture(), proof = createAggregateInternalProof(project, contract, 'root', {}, 'test-geometry@1')
    let getterCalls = 0
    const constraints = Object.defineProperty({}, 'scope', { enumerable: true, get: () => { getterCalls++; return 'all' } })
    expect(isAggregateInternalProofValid(project, contract, proof, constraints, 'test-geometry@1')).toBe(false)
    expect(getterCalls).toBe(0)
    expect(isAggregateInternalProofValid(project, contract, { ...proof }, {}, 'test-geometry@1')).toBe(false)
  })
})
