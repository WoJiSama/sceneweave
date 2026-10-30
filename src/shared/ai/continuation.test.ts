import { continuationFixture } from '../../../tests/helpers/continuation-fixture.js'
import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCompositionContent, resolveAppearance } from '../appearance/graph.js'
import { inspectDependencies } from '../commands/dependencies.js'
import { validateProjectData } from '../project/validate.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { constraintInputHash, generationInputHash, managedOutputHash } from '../terrain-generation/integrity.js'
import { prepareBaseMapRequestV2, executeBaseMapRequestV2, parseBaseMapResponseV2 } from '../terrain-generation/base-map-v2.js'
import { executeBaseMapRequest } from '../terrain-generation/base-map.js'
import { cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { visualBase } from '../visual/base.js'
import type { ProjectData } from '../model/project.js'
import { CONTINUATION_POLICY, BudgetPolicySchema } from './budget-policy.js'
import { AuthoringStartSchema, DraftLeaseSchema, DraftStampSchema, type AuthoringOperation, type AuthoringStep } from './authoring-protocol.js'
import { authoringDraftStamp, authoringProjectHash, applyAuthoringStep, checkAuthoringDraft, replayAuthoring, validateAuthoringStart, publicAuthoringContext, authoringAssetPage } from './authoring.js'
import { captureBaseMapSource, baseMapResourceClosureHash, assertContinuationAdoptionBudget, semanticChangedTargets, continuationOperationBudget } from './continuation.js'
import type { AuthoringStartV2, BaseMapSource } from './continuation-protocol.js'

const now = '2026-10-30T00:00:00.000Z'
/** Metadata/replay fixture. No actual resource-byte or pixel evidence. */
const fixture = continuationFixture

describe('versioned generated-map authoring continuation', () => {
  it('replays exact source identities and keeps generation separate from initial AI allowance', () => {
    const start = fixture(), initial = replayAuthoring(start, [])
    expect(initial.state.schemaVersion).toBe(2)
    if (initial.state.schemaVersion !== 2) throw new Error('fixture shape')
    expect(initial.project).toEqual(start.source.project)
    expect(initial.state.budget.generationCost).toBeGreaterThan(0)
    expect(initial.state.budget.aiCost).toBe(0)
    expect(initial.state.budget.complexityCost).toBe(start.source.response.domainCost.total)
    expect(initial.state.ledger[0].category).toBe('generation')
    expect(initial.state.ledger[0].semanticCost).toBe(initial.state.budget.generationCost)
  })
  it('strictly dispatches v2 without changing old base-map or authoring payload meaning', () => {
    const start = fixture()
    expect(AuthoringStartSchema.parse(start).schemaVersion).toBe(2)
    expect(() => executeBaseMapRequest(start.source.request)).toThrow()
    expect(() => AuthoringStartSchema.parse({ ...start, schemaVersion: 1 })).toThrow()
    const result = cloneJson(start.source.response); result.policyHash = 'f'.repeat(64)
    expect(() => parseBaseMapResponseV2(start.source.request, result)).toThrow()
    expect(() => BudgetPolicySchema.parse({ ...CONTINUATION_POLICY, aiTargets: 1024 })).toThrow()
  })
  it('starts and edits a source-verified v2 prop-only grant without expanding it to a scene grant', () => {
    const start = fixture(), id = start.scope.targetIds[0]
    start.scope.scene = null
    start.skill = { id: 'sceneweave-prop-authoring', version: 1 }
    expect(validateAuthoringStart(start).scope.scene).toBeNull()
    const initial = replayAuthoring(start, []), edited = applyAuthoringStep(start, initial.state, [{ kind: 'opacity', id, value: .5 }], 'prop-only')
    expect(edited.state.budget.aiCost).toBe(1)
    expect(edited.state.budget.generationCost).toBe(initial.state.budget.generationCost)
    expect(semanticChangedTargets(start.project, edited.project)).toEqual([`prop:${id}`])
    expect(publicAuthoringContext(start, edited.state)).toMatchObject({ allowedOperations: ['opacity'], scene: null })
    expect(authoringAssetPage(start, '', 16).assets).toEqual([])
    expect(() => applyAuthoringStep(start, initial.state, [{ kind: 'terrainUpdate', id: Object.keys(start.project.document.terrainAreas)[0], blocksSight: true }], 'ungranted-scene')).toThrow()
    const { policy: _policy, source: _source, ...legacy } = start
    expect(() => validateAuthoringStart({ ...legacy, schemaVersion: 1 })).toThrow(/须明确scene授权/)
  })
  it.each(['allocation', 'project', 'closure', 'preservation'] as const)('rejects changed complete source %s', field => {
    const start = fixture(), bad = cloneJson(start.source)
    if (field === 'allocation') bad.identityAllocation[0] += '-changed'
    if (field === 'project') bad.project.document.title += ' changed'
    if (field === 'closure') bad.resourceClosureHash = 'b'.repeat(64)
    if (field === 'preservation') bad.preservation.sceneId = 'other-main'
    expect(() => captureBaseMapSource(bad)).toThrow()
  })
  it('counts repeated/no-op/backtracking AI operations, preserves G, and makes step delivery idempotent', () => {
    const start = fixture(), id = start.scope.targetIds[0], initial = replayAuthoring(start, [])
    expect(id).toBeTruthy()
    const first = applyAuthoringStep(start, initial.state, [{ kind: 'opacity', id, value: 1 }], 'no-op')
    const second = applyAuthoringStep(start, first.state, [{ kind: 'opacity', id, value: .5 }, { kind: 'opacity', id, value: 1 }], 'backtrack')
    if (second.state.schemaVersion !== 2 || initial.state.schemaVersion !== 2) throw new Error('fixture shape')
    expect(second.state.budget.aiCost).toBe(3)
    expect(second.state.budget.generationCost).toBe(initial.state.budget.generationCost)
    expect(second.state.ledger).toHaveLength(4)
    expect(applyAuthoringStep(start, second.state, [{ kind: 'opacity', id, value: 1 }], 'no-op')).toEqual(second)
    expect(() => applyAuthoringStep(start, second.state, [{ kind: 'opacity', id, value: .2 }], 'no-op')).toThrow(/相同操作ID/)
  })
  it('binds identical content to different budget/ledger identities through stamps and leases', () => {
    const start = fixture(), initial = replayAuthoring(start, []), id = start.scope.targetIds[0]
    const first = applyAuthoringStep(start, initial.state, [{ kind: 'opacity', id, value: 1 }], 'first')
    const second = applyAuthoringStep(start, first.state, [{ kind: 'opacity', id, value: 1 }], 'repeat')
    expect(first.state.contentHash).toBe(second.state.contentHash)
    const a = authoringDraftStamp(first.state, 1), b = authoringDraftStamp(second.state, 1)
    expect(a).toHaveProperty('policyHash', CONTINUATION_POLICY.policyHash)
    expect(a).not.toEqual(b)
    expect(() => DraftStampSchema.parse({ ...b, policyHash: undefined })).toThrow()
    expect(() => DraftLeaseSchema.parse({ schemaVersion: 2, taskId: 'task', generation: 1, draftRevision: 0, contentHash: first.state.contentHash,
      claimId: 'a4d31c46-5bc1-4e38-b991-e880a0f3a156', serverNow: 0, expiresAt: 30000 })).toThrow()
    if (second.state.schemaVersion !== 2) throw new Error('fixture shape')
    const forged = cloneJson(second.state); forged.budget.aiCost = 0
    expect(() => checkAuthoringDraft(start, forged)).toThrow(/账本/)
  })
  it('counts full geometry as complexity while a changed terrain area is one semantic target', () => {
    const start = fixture(), id = Object.keys(start.project.document.terrainAreas)[0], initial = replayAuthoring(start, [])
    const next = applyAuthoringStep(start, initial.state, [{ kind: 'terrainUpdate', id, blocksSight: !start.project.document.terrainAreas[id].blocksSight }], 'area-edit')
    if (next.state.schemaVersion !== 2) throw new Error('fixture shape')
    expect(next.state.ledger[1].targets).toEqual([`terrainArea:${id}`])
    expect(next.state.ledger[1].semanticCost).toBe(1)
    expect(next.state.ledger[1].complexityCost).toBeGreaterThanOrEqual(1)
  })
  it('checks the pure 512/513 final semantic boundary independently of a generated sample', () => {
    const start = fixture(), blank = start.source.blank
    function changed(count: number): ProjectData {
      const document = cloneJson(blank.document)
      for (let i = 0; i < count; i++) { const id = `note-${i}`; document.notes[id] = { id, floorId: 'visual-floor', editLocked: false, visibility: 'gm', discovered: false,
        anchor: { type: 'point', positionMm: { x: 1000, y: 1000 } }, kind: 'note', title: '', text: 'boundary' }; document.entityLayers[id] = 'visual-layer-ground' }
      let i = 0
      return validateProjectData({ ...blank, ...createCompositionContent(document, { ids: { nextId: () => `boundary-${++i}` }, clock: { now: () => now } }) })
    }
    expect(semanticChangedTargets(blank, changed(512))).toHaveLength(512)
    expect(assertContinuationAdoptionBudget(blank, changed(512))).toHaveLength(512)
    expect(() => assertContinuationAdoptionBudget(blank, changed(513))).toThrow(/512/)
  })
  it('counts group membership through actual editable members and avoids a duplicate carrier target', () => {
    const start = fixture(), before = start.project, after = cloneJson(before), members = Object.keys(before.document.props).slice(0, 3)
    after.document.prefabInstances.group = { id: 'group', floorId: 'visual-floor', editLocked: false, visibility: 'public', definitionRef: { id: 'fixed-group', version: 1 },
      anchorMm: { x: 0, y: 0 }, rotationDeg: 0, members: Object.fromEntries(members.map((id, i) => [`member-${i}`, { propId: id, overrideFields: [] }])) }
    after.document.entityLayers.group = 'visual-layer-props'
    expect(semanticChangedTargets(before, after)).toEqual(members.map(id => `prop:${id}`).sort())
    const ordered = cloneJson(after)
    ordered.document.prefabInstances = Object.fromEntries(Object.entries(ordered.document.prefabInstances).reverse())
    expect(semanticChangedTargets(after, ordered)).toEqual([])
  })
  function filterFixture() {
    const start = fixture(), ids = start.scope.targetIds.slice(0, 3)
    start.scope.visual = { floorId: 'visual-floor', layerId: 'visual-layer-details', boundsMm: start.project.document.exportBoundsMm,
      entityIds: ids, definitionIds: [], materialIds: [], operations: ['visualFilter', 'visualRemove'], allowGlobalEnvironment: true }
    const operation: AuthoringOperation = { kind: 'visualFilter', id: 'finite-filter', target: { kind: 'entities', ids }, preset: 'warm',
      exposure: 1, saturation: 1, contrast: 1, vignette: 0, grain: 0, seed: 'finite-filter', enabled: true }
    return { start, ids, operation }
  }
  it('pure filter accounting expands actual targets, including repeat and removal, without counting its row twice', () => {
    const { start, ids, operation } = filterFixture(), before = start.project, after = cloneJson(before)
    if (operation.kind !== 'visualFilter') throw new Error('fixture shape')
    const { kind: _kind, ...fields } = operation
    visualBase(after.document)!.filters[operation.id] = { ...fields, floorId: 'visual-floor', layerId: 'visual-layer-details', visibility: 'public', editLocked: false }
    validateProjectData(after)
    const targets = ids.map(id => `prop:${id}`).sort()
    expect(continuationOperationBudget(operation, before, after)).toEqual({ targets, semanticCost: 3 })
    expect(continuationOperationBudget(operation, after, after)).toEqual({ targets, semanticCost: 3 })
    expect(continuationOperationBudget({ kind: 'visualRemove', id: operation.id, effectKind: 'filter' }, after, before)).toEqual({ targets, semanticCost: 3 })
    expect(semanticChangedTargets(before, after)).toEqual(targets)
    expect(semanticChangedTargets(before, before)).toEqual([])
  })
  it('pure filter accounting includes both old and new appearance targets when retargeted', () => {
    const { start, ids, operation } = filterFixture(), before = cloneJson(start.project), after = cloneJson(start.project)
    if (operation.kind !== 'visualFilter') throw new Error('fixture shape')
    const { kind: _kind, ...fields } = operation
    const filter = { ...fields, floorId: 'visual-floor', layerId: 'visual-layer-details', visibility: 'public' as const, editLocked: false }
    visualBase(before.document)!.filters[operation.id] = filter
    const nextIds = start.scope.targetIds.slice(2, 5), updated = { ...operation, target: { kind: 'entities' as const, ids: nextIds } }
    visualBase(after.document)!.filters[operation.id] = { ...filter, target: updated.target }
    validateProjectData(before); validateProjectData(after)
    const expected = [...new Set([...ids, ...nextIds])].map(id => `prop:${id}`).sort()
    expect(continuationOperationBudget(updated, before, after)).toEqual({ targets: expected, semanticCost: expected.length })
    expect(semanticChangedTargets(before, after)).toEqual(expected.filter(id => id !== `prop:${nextIds[0]}`))
  })
  it('rejects a filter visual grant before starting unsupported current-v3/v4 visual authoring', () => {
    const { start } = filterFixture()
    expect(() => replayAuthoring(start, [])).toThrow(/不支持视觉授权/)
  })
  it('keeps at most 256 successful AI targets even when generation has its own allowance', () => {
    const start = fixture(), id = start.scope.targetIds[0]
    const steps: AuthoringStep[] = Array.from({ length: 16 }, (_, i) => ({ index: i + 1, stepId: `step-${i}`,
      operations: Array.from({ length: 16 }, () => ({ kind: 'opacity' as const, id, value: 1 })) }))
    const full = replayAuthoring(start, steps)
    if (full.state.schemaVersion !== 2) throw new Error('fixture shape')
    expect(full.state.budget.aiCost).toBe(256)
    expect(full.state.operationCost).toBe(full.state.budget.generationCost + 256)
    expect(() => replayAuthoring(start, [...steps, { index: 17, stepId: 'over', operations: [{ kind: 'opacity', id, value: 1 }] }])).toThrow(/累计/)
  }, 120000)
})
