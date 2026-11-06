import { describe, expect, it } from 'vitest'
import { createRefinedInteriorDocument } from '../../src/platform/browser/content/refined-interior.js'
import { createRefinedIslandDocument } from '../../src/platform/browser/content/refined-island.js'
import { inspectAggregateDomain } from '../../src/shared/aggregates/domain-adapters.js'
import { encodeSceneCoordinates, decodeSceneCoordinates } from '../../src/shared/aggregates/scene-coordinates.js'
import { canonicalJson, cloneJson } from '../../src/shared/validation/json.js'
import { propFootprint, supportedPolygon } from '../../src/shared/geometry/geometry.js'
import { runMixedGeneration } from '../../src/shared/generation/domains/mixed/index.js'
import { taskBudgetProfile } from '../../src/shared/budget/task-budget.js'
import { AGGREGATE_ENTITY_COLLECTIONS } from '../../src/shared/model/aggregate.js'
import { sceneSchema } from '../../src/shared/validation/scene.js'
import { validateSceneDocument } from '../../src/shared/validation/scene.js'
import { applyBuildingCommand } from '../../src/shared/commands/building.js'
import { applyNaturalAggregateCommand } from '../../src/shared/aggregates/natural-transform.js'
import { reconcileDecorationMembers } from '../../src/shared/decorations/commands.js'
import { detachChangedOutputs } from '../../src/shared/terrain-generation/integrity.js'
import { pauseChangedCompositions } from '../../src/shared/terrain-generation/composition-lifecycle.js'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import { bindTerrainVariantPresentations, bindTerrainVariantV2Presentations } from '../../src/shared/visual/terrain-variant-presentations.js'
import { projectScene } from '../../src/shared/projection/projection.js'
import { domainExecutionFixture } from './domain-execution-fixtures.js'
import { buildAggregateCapacityDocument, assertAggregateCapacityPlayerPrivacy } from './aggregate-capacity-fixtures.js'

function privacyPreflight(result: ReturnType<typeof buildAggregateCapacityDocument>) {
  let sequence = 0
  const runtime = { ids: { nextId: () => `capacity-privacy-test-${sequence++}` }, clock: { now: () => '2026-11-06T00:00:00.000Z' } }
  const content = bindTerrainVariantV2Presentations(bindTerrainVariantPresentations(createCompositionContent(result.document, runtime)))
  // Pure metadata/geometry coverage does not fabricate the authored sample's
  // derived image bytes. Browser preparation uses full prepareCompositionCommands.
  const moved = cloneJson(content.document), transform = { id: result.controls.groupId, offsetMm: result.controls.offsetMm, pivotMm: result.controls.pivotMm, quarterTurns: 0 as const }
  if (result.controls.domain === 'building') applyBuildingCommand(moved, { type: 'transformAggregateBuilding', ...transform })
  else applyNaturalAggregateCommand(moved, { type: 'transformAggregateNatural', ...transform })
  reconcileDecorationMembers(content.document, moved); detachChangedOutputs(content.document, moved); pauseChangedCompositions(content.document, moved)
  const proof = assertAggregateCapacityPlayerPrivacy(content, { ...content, document: moved }, result.controls)
  expect(proof.originalAndMovedPlayerProjection).toBe(true)
  expect(proof.fixedMasksRemainWorldAnchored).toBe(true)
  const scope = inspectAggregateDomain(result.document, result.controls.groupId, result.controls.domain)
  expect(scope.members.some(member => proof.fixedMaskIds.includes(member.id))).toBe(false)
  const maskedArea = result.summary.fixedPrivacyMasks.reduce((total, mask) => total + mask.boundsMm.width * mask.boundsMm.height, 0)
  expect(maskedArea).toBeLessThan(result.summary.focusBounds.width * result.summary.focusBounds.height * .05)
  const unmasked = cloneJson(content.document)
  for (const id of proof.fixedMaskIds) { delete unmasked.regions[id]; delete unmasked.entityLayers[id] }
  expect(() => projectScene(unmasked, 'player', content.appearance)).toThrow(/玩家输出不安全/)
}

function mixedSource() {
  const { base, input } = domainExecutionFixture('mixed')
  return sceneSchema.parse(runMixedGeneration(base, input, { profile: taskBudgetProfile('expanded'), nowMilliseconds: () => 0 }).candidate.document)
}

describe('representative complex aggregate fixtures', () => {
  it.each([['building', 500], ['building', 2000], ['natural', 500], ['natural', 2000], ['mixed', 500], ['mixed', 2000]] as const)('builds %s with exactly %i supported details and independent remote content', (kind, count) => {
    const source = kind === 'building' ? createRefinedInteriorDocument() : kind === 'natural' ? createRefinedIslandDocument() : mixedSource()
    const original = canonicalJson(source), result = buildAggregateCapacityDocument(kind, count, source), scene = result.document
    expect(canonicalJson(source)).toBe(original)
    expect(Object.keys(scene.props).length + Object.keys(scene.decorations).length).toBe(count)
    expect(result.summary.counts.rooms).toBe(kind === 'building' ? 6 : kind === 'mixed' ? 1 : 0)
    if (kind === 'natural') expect(result.summary.counts.curves).toBeGreaterThan(0)
    expect(scene.props[result.controls.editableMemberId]).toBeDefined()
    expect(scene.props[result.controls.privateMemberId].visibility).toBe('gm')
    expect(scene.props[result.controls.remoteEntityId]).toBeDefined()
    expect(result.controls.bulkEditableMemberIds).toHaveLength(32)
    for (const id of result.controls.bulkEditableMemberIds) {
      const prop = scene.props[id]
      expect(prop.visibility).toBe('public')
      expect(supportedPolygon(scene, propFootprint(prop).map(p => ({ x: p.x + 1, y: p.y })), prop.supportRef, prop.floorId)).toBe(true)
    }
    const scope = inspectAggregateDomain(scene, result.controls.groupId, result.controls.domain)
    expect(scope.members.some(row => row.id === result.controls.remoteEntityId)).toBe(false)
    expect(scope.members.some(row => row.id === result.controls.externalRoadId)).toBe(false)
    expect(scope.members.some(row => row.id === result.controls.secretNoteId)).toBe(true)
    expect(scene.terrainConnections[result.controls.remoteConnectionId].to.surfaceRef.id).toBe(result.controls.remoteAreaId)
    expect(decodeSceneCoordinates(encodeSceneCoordinates(scene))).toEqual(scene)
    expect(Object.values(scene.decorationClusters).flatMap(cluster => Object.values(cluster.members)).some(row => row.state === 'deleted')).toBe(true)
    const moved = cloneJson(scene), transform = { id: result.controls.groupId, offsetMm: result.controls.offsetMm, pivotMm: result.controls.pivotMm, quarterTurns: 0 as const }
    if (result.controls.domain === 'building') applyBuildingCommand(moved, { type: 'transformAggregateBuilding', ...transform })
    else applyNaturalAggregateCommand(moved, { type: 'transformAggregateNatural', ...transform })
    reconcileDecorationMembers(scene, moved); detachChangedOutputs(scene, moved); pauseChangedCompositions(scene, moved)
    const checked = validateSceneDocument(moved)
    expect(checked.ok, checked.ok ? undefined : canonicalJson(checked.errors)).toBe(true)
    expect(moved.props[result.controls.remoteEntityId]).toEqual(scene.props[result.controls.remoteEntityId])
    expect(moved.paths[result.controls.externalRoadId]).toEqual(scene.paths[result.controls.externalRoadId])
    privacyPreflight(result)
  }, 30000)
  it.each([{ remoteExtraDetails: 500 as const }, { extraExternalConnections: 16 as const }])('preserves the selected mixed group when varying only remote load %j', variant => {
    const source = mixedSource(), baseline = buildAggregateCapacityDocument('mixed', 500, source)
    const changed = buildAggregateCapacityDocument('mixed', 500, source, variant)
    expect(changed.controls).toEqual(baseline.controls)
    const local = inspectAggregateDomain(baseline.document, baseline.controls.groupId, baseline.controls.domain).members
    expect(inspectAggregateDomain(changed.document, changed.controls.groupId, changed.controls.domain).members).toEqual(local)
    expect(changed.summary.actualDetailCount).toBe(variant.remoteExtraDetails ? 1000 : 500)
    expect(changed.summary.counts.connections - baseline.summary.counts.connections).toBe(variant.extraExternalConnections ?? 0)
    privacyPreflight(changed)
    // Remote-only variants cannot silently move, replace, recolor or rewrite
    // ownership of any entity already in the canonical selected group.
    for (const { kind, id } of local) {
      const collection = AGGREGATE_ENTITY_COLLECTIONS[kind]
      expect(baseline.document[collection][id]).toBeDefined()
      expect(changed.document[collection][id]).toEqual(baseline.document[collection][id])
    }
  }, 30000)
})
