import { describe, expect, it } from 'vitest'
import { createRefinedInteriorDocument } from '../../src/platform/browser/content/refined-interior.js'
import { createRefinedIslandDocument } from '../../src/platform/browser/content/refined-island.js'
import { runMixedGeneration } from '../../src/shared/generation/domains/mixed/index.js'
import { taskBudgetProfile } from '../../src/shared/budget/task-budget.js'
import { sceneSchema, validateSceneDocument } from '../../src/shared/validation/scene.js'
import { canonicalJson, cloneJson } from '../../src/shared/validation/json.js'
import { inspectAggregateDomain } from '../../src/shared/aggregates/domain-adapters.js'
import { applyNaturalAggregateCommand } from '../../src/shared/aggregates/natural-transform.js'
import { encodeSceneCoordinates, decodeSceneCoordinates } from '../../src/shared/aggregates/scene-coordinates.js'
import { supportedPolygon, propFootprint } from '../../src/shared/geometry/geometry.js'
import { AGGREGATE_ENTITY_COLLECTIONS } from '../../src/shared/model/aggregate.js'
import { buildFormalCapacityDocument } from './formal-capacity-fixtures.js'
import { domainExecutionFixture } from './domain-execution-fixtures.js'

function source(kind: 'building' | 'natural' | 'mixed') {
  if (kind === 'building') return createRefinedInteriorDocument()
  if (kind === 'natural') return createRefinedIslandDocument()
  const fixture = domainExecutionFixture('mixed')
  return sceneSchema.parse(runMixedGeneration(fixture.base, fixture.input, { profile: taskBudgetProfile('expanded'), nowMilliseconds: () => 0 }).candidate.document)
}

describe('formal complete-v1 full-Prop capacity corpus', () => {
  it.each([['building', 500], ['building', 2000], ['natural', 500], ['natural', 2000], ['mixed', 500], ['mixed', 2000]] as const)('retains real %s geometry and exactly %i full Props on an actual 50 by 50 grid', (kind, total) => {
    const original = source(kind), hash = canonicalJson(original), built = buildFormalCapacityDocument(kind, total, original), scene = built.document
    expect(canonicalJson(original)).toBe(hash)
    expect(Object.keys(scene.props)).toHaveLength(total)
    expect(Object.keys(scene.decorations)).toHaveLength(0)
    expect(scene.units.gridVisible).toBe(true)
    expect(scene.exportBoundsMm.width / scene.units.gridSizeMm).toBe(50)
    expect(scene.exportBoundsMm.height / scene.units.gridSizeMm).toBe(50)
    expect(scene.floors[Object.keys(scene.floors)[0]].boundsMm).toEqual(scene.exportBoundsMm)
    expect(built.summary.fullPropCount).toBe(total)
    expect(built.summary.convertedFullPropIds.length).toBeGreaterThan(total / 2)
    expect(Object.keys(scene.assets).length).toBeGreaterThan(1)
    expect(Object.keys(scene.rooms)).toHaveLength(kind === 'building' ? 6 : kind === 'mixed' ? 1 : 0)
    expect(decodeSceneCoordinates(encodeSceneCoordinates(scene))).toEqual(scene)
    const scope = inspectAggregateDomain(scene, built.controls.groupId, built.controls.domain)
    expect(scope.members.some(row => row.id === built.controls.remoteEntityId)).toBe(false)
    expect(scope.members.some(row => row.id === built.controls.privateMemberId)).toBe(true)
    expect(scope.members.every(row => scene[AGGREGATE_ENTITY_COLLECTIONS[row.kind]][row.id])).toBe(true)
    expect(scene.props[built.controls.privateMemberId].visibility).toBe('gm')
    expect(scene.notes[built.controls.secretNoteId].text).toContain('CAPACITY_PRIVATE_SENTINEL')
    for (const propId of built.controls.bulkEditableMemberIds) {
      const prop = scene.props[propId]
      expect(prop.visibility).toBe('public')
      expect(supportedPolygon(scene, propFootprint(prop).map(point => ({ x: point.x + 1, y: point.y })), prop.supportRef, prop.floorId)).toBe(true)
    }
    expect(built.controls.bulkEditableMemberIds).toHaveLength(32)
    const manualCluster = scene.decorationClusters[`capacity-${kind}-manual-cluster`]
    expect(manualCluster).toBeDefined()
    expect(Object.values(manualCluster.members).filter(member => member.state === 'manual')).toHaveLength(3)
    expect(Object.values(manualCluster.members).filter(member => member.state === 'deleted')).toEqual([{ kind: 'prop', entityId: null, state: 'deleted' }])
    expect(Object.values(manualCluster.members).filter(member => member.state === 'detached')).toEqual([{ kind: 'prop', entityId: null, state: 'detached' }])
    for (const group of Object.values(scene.decorationClusters)) {
      expect(group.palette.every(entry => entry.kind === 'prop')).toBe(true)
      expect(Object.values(group.members).every(member => member.kind === 'prop')).toBe(true)
      for (const member of Object.values(group.members)) if (member.entityId) expect(scene.props[member.entityId]).toBeDefined()
    }
    for (const [id, originalCluster] of Object.entries(original.decorationClusters)) {
      const expected = cloneJson(originalCluster)
      for (const entry of expected.palette) entry.kind = 'prop'
      for (const member of Object.values(expected.members)) {
        member.kind = 'prop'
        if (member.entityId && member.state !== 'deleted' && member.state !== 'detached') member.state = 'manual'
      }
      // Only explicit full-Prop representation and prepared manual state differ;
      // every original parameter, slot key, exclusion state and reference remains.
      expect(scene.decorationClusters[id]).toEqual(expected)
    }
  }, 60000)

  it('adds only real remote full Props while retaining the entire local group', () => {
    const base = source('mixed'), before = buildFormalCapacityDocument('mixed', 500, base)
    const after = buildFormalCapacityDocument('mixed', 500, base, { remoteExtraProps: 500 })
    expect(Object.keys(after.document.props)).toHaveLength(1000)
    expect(Object.keys(after.document.decorations)).toHaveLength(0)
    const left = inspectAggregateDomain(before.document, before.controls.groupId, 'natural').members
    const right = inspectAggregateDomain(after.document, after.controls.groupId, 'natural').members
    expect(right).toEqual(left)
    for (const row of left) expect(after.document[AGGREGATE_ENTITY_COLLECTIONS[row.kind]][row.id]).toEqual(before.document[AGGREGATE_ENTITY_COLLECTIONS[row.kind]][row.id])
    expect(after.summary.displayedGrid).toEqual(before.summary.displayedGrid)
  }, 60000)

  it('uses sixteen actual local external connections and refuses an incomplete-support transform atomically', () => {
    const built = buildFormalCapacityDocument('mixed', 500, source('mixed'), { localExternalPorts: 16 })
    const scene = built.document, before = canonicalJson(scene)
    expect(built.controls.localExternalPortIds).toHaveLength(16)
    expect(built.controls.localExternalSupportIds).toHaveLength(1)
    const scope = inspectAggregateDomain(scene, built.controls.groupId, 'natural')
    expect(scope.readDependencies.some(row => row.kind === 'terrainArea' && built.controls.localExternalSupportIds.includes(row.id))).toBe(true)
    for (const id of built.controls.localExternalPortIds) {
      const connection = scene.terrainConnections[id]
      expect(scope.members.some(member => member.kind === 'terrainConnection' && member.id === id)).toBe(true)
      expect(connection.from.surfaceRef.id).toBe('capacity-mixed-focus-extension')
      expect(built.controls.localExternalSupportIds).toContain(connection.to.surfaceRef.id)
    }
    const detached = cloneJson(scene)
    expect(() => applyNaturalAggregateCommand(detached, { type: 'transformAggregateNatural', id: built.controls.groupId,
      offsetMm: built.controls.offsetMm, pivotMm: built.controls.pivotMm, quarterTurns: 0 })).toThrow(/未随动|完整支撑/)
    expect(canonicalJson(detached)).toBe(before)
    expect(validateSceneDocument(detached).ok).toBe(true)
    expect(canonicalJson(scene)).toBe(before)
  }, 60000)
})
