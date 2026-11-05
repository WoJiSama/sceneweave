import { toCurrentSceneDocument } from '../model/current-scene.js'
import { probeAuthoringPlacement } from './placement-diagnostics.js'
import { advanceHistoryIdentity } from '../history/identity.js'
import { propPresentation } from '../appearance/presentation.js'
import builtinCatalog from '../../platform/browser/content/builtin-data.json'
import { createNearSideSourceDocument, nearSideAssetId, nearSideDefinitionId } from '../../platform/browser/content/near-side.js'
import { NEAR_SIDE_ART, NEAR_SIDE_LICENSE } from '../../platform/browser/content/near-side-art.js'
import { sha256Text } from '../validation/hash.js'
import { assertCurrentAuthoringResourceEvolution } from './current-authoring-resources.js'
import { describe, expect, it } from 'vitest'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { continuationFixtureV3 } from '../../../tests/helpers/continuation-v3-fixture.js'
import { createCompositionContent, addPropAppearanceSource } from '../appearance/graph.js'
import { emptyTerrainDocument } from '../terrain-generation/compose.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { createEmptyGeneration5 } from '../terrain-generation/composition-contracts.js'
import { sampleConnectionRoute } from '../geometry/connection-route.js'
import { emptyVisualSystem } from '../visual/types.js'
import { validateProjectData } from '../project/validate.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { visualBase } from '../visual/base.js'
import { authoringProjectHash, replayAuthoring, applyAuthoringStep, checkAuthoringDraft, publicAuthoringContext, authoringDraftStamp, authoringSummary } from './authoring.js'
import { createCurrentAuthoringStartV4, createGeneratedAuthoringStartV4, applyAuthoringStageV4 } from './current-authoring.js'
import { AuthoringStartV4Schema, type AuthoringStartV4, type AuthoringOperationV4 } from './authoring-protocol-v4.js'
import { AuthoringStartSchema as LegacyStartSchema } from './authoring-protocol-v1.js'

/** Metadata replay evidence only; real bytes/pixels remain checked by workspace adoption. */
function current(): AuthoringStartV4 {
  const original = cloneJson(svgProjectFixture().bundle.project), old = original.document
  Object.assign(old, toCurrentSceneDocument(old))
  const document = emptyTerrainDocument(old)
  Object.assign(document, toCurrentSceneDocument(document))
  let id = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `current-fixture-${++id}` }, clock: { now: () => document.createdAt } })
  const project = validateProjectData({ ...original, ...content, schemaVersion: 1 })
  const floorId = Object.keys(document.floors)[0], layerId = document.entityLayers.item, boundsMm = document.floors[floorId].boundsMm
  return cloneJson(createCurrentAuthoringStartV4({ project, seed: '70859a22-1bd4-45e3-9a82-96dc5da14af3', preparedAt: document.createdAt, flowId: 'current-v1',
    preservation: { sceneId: document.sceneId, revision: document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 },
    scope: { targetIds: ['item'], operations: ['transform', 'opacity'], placement: null,
      scene: { floorId, layerId, boundsMm, entityIds: ['item'], definitionIds: ['definition'], prefabDefinitionIds: [], materialIds: [], operations: ['furnish'] },
      visual: { floorId, layerId, boundsMm, entityIds: ['item'], definitionIds: ['definition'], materialIds: [], operations: ['visualBoundary', 'visualLight'] } } }))
}

/** Production fixed catalogue metadata; real bitmap decoding is separately proven by browser/Workspace. */
function productionCatalogue() {
  const original = cloneJson(builtinCatalog.project) as unknown as import('../model/project.js').ProjectData, document = original.document
  document.schemaVersion = 1; document.mapMode = 'scene'; document.regional = null; document.generation = createEmptyGeneration5()
  document.visual = { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }; document.decorations = {}; document.decorationClusters = {}; document.surfaceRules = {}
  const lamp = document.propDefinitions['b2-p-10'], lampAsset = lamp.defaultAppearance.kind === 'image' ? document.assets[lamp.defaultAppearance.assetId] : undefined
  if (!lampAsset) throw Error('production lamp')
  document.propDefinitions = { [lamp.id]: lamp }; document.assets = { [lampAsset.id]: lampAsset }; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null; document.prefabDefinitions = {}
  original.assets = { [lampAsset.sha256]: original.assets[lampAsset.sha256] }
  original.authoringSources = Object.fromEntries(Object.entries(original.authoringSources).filter(([id]) => id === lampAsset.id))
  original.licenseBindings = original.licenseBindings.filter(row => row.subjectKind === 'asset' && row.subjectId === lampAsset.id || row.subjectKind === 'propDefinition' && row.subjectId === lamp.id)
  const art = NEAR_SIDE_ART[0], near = createNearSideSourceDocument(), definitionId = nearSideDefinitionId(art.key), assetId = nearSideAssetId(art.key)
  document.propDefinitions[definitionId] = cloneJson(near.propDefinitions[definitionId]); document.assets[assetId] = cloneJson(near.assets[assetId])
  const licenseHash = sha256Text(NEAR_SIDE_LICENSE), asset = document.assets[assetId]
  const assets = { ...original.assets, [asset.sha256]: { sha256: asset.sha256, mimeType: asset.mimeType, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight, sizeBytes: 1 } }
  const licenses = { ...original.licenses, [licenseHash]: { sha256: licenseHash, text: NEAR_SIDE_LICENSE } }
  const licenseBindings = [...original.licenseBindings,
    { subjectKind: 'asset' as const, subjectId: assetId, licenseRef: asset.licenseRef, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const },
    { subjectKind: 'propDefinition' as const, subjectId: definitionId, licenseRef: asset.licenseRef, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const }]
  let sequence = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `catalogue-current-${++sequence}` }, clock: { now: () => document.createdAt } })
  const definition = document.propDefinitions[definitionId]
  addPropAppearanceSource(content.appearance, { definitionRef: { id: definitionId, version: definition.version }, appearance: definition.defaultAppearance,
    visualBoundsMm: definition.defaultVisualBoundsMm, shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, art.presentation)
  const project = validateProjectData({ ...original, ...content, assets, licenses, licenseBindings, schemaVersion: 1 })
  const floorId = Object.keys(document.floors)[0], layerId = Object.keys(document.userLayers)[0]
  const start = createCurrentAuthoringStartV4({ project, flowId: 'production-catalogue', seed: '70859a22-1bd4-45e3-9a82-96dc5da14af3', preparedAt: document.createdAt,
    preservation: { sceneId: document.sceneId, revision: document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 },
    scope: { targetIds: [], operations: ['place'], placement: { floorId, layerId, supportRef: { kind: 'floor', id: floorId }, boundsMm: document.exportBoundsMm, definitionIds: ['b2-p-10', definitionId] } } })
  return { start, definitionId }
}

const boundary: AuthoringOperationV4 = { kind: 'visualBoundary', id: 'curve', closed: false,
  segments: [{ id: 'curve-s', start: { x: 3000, y: 3000 }, control1: { x: 5000, y: 3000 }, control2: { x: 5000, y: 5000 }, end: { x: 7000, y: 5000 } }],
  sampleSpacingMm: 1000, toleranceMm: 100, binding: { kind: 'decoration' } }
const light: AuthoringOperationV4 = { kind: 'visualLight', id: 'light', positionMm: { x: 6000, y: 6000 }, radiusMm: 1000, color: '#FFD080', intensity: .5, wallOcclusion: true, enabled: true }
const cluster = (): AuthoringOperationV4 => ({ kind: 'decorationCluster', id: 'dressing', supportRef: { kind: 'floor', id: 'blank-floor' },
  boundsMm: { x: 3000, y: 3000, width: 14000, height: 10000 }, seed: 'fixed-cluster', palette: [{ key: 'grass', definitionRef: { id: 'definition', version: 1 }, kind: 'decoration', weight: 1 }],
  maxInstances: 4, spacingMm: 500, clusterRadiusMm: 4000, clearanceMm: 500 })

describe('explicit current authoring4 capability and atomic replay', () => {
  it('supports full visual capability on the single complete v1 and refuses legacy task writes', () => {
    const start = current(), initial = replayAuthoring(start, []), before = canonicalJson(start.project)
    expect(initial.state.ledger[0]).toMatchObject({ category: 'baseline', targets: [], semanticCost: 0 })
    expect(initial.state.budget.generationCost).toBe(0)
    const next = applyAuthoringStep(start, initial.state, [boundary, light], 'visual')
    expect(next.project.schemaVersion).toBe(1)
    expect(visualBase(next.project.document)?.boundaries.curve).toBeTruthy()
    expect(replayAuthoring(start, next.state.steps)).toEqual(next)
    expect(canonicalJson(start.project)).toBe(before)
    expect(publicAuthoringContext(start, next.state)).toMatchObject({ schemaVersion: 4, capability: start.capability })
    expect(authoringSummary(start, next.state, null)).toMatchObject({ schemaVersion: 4, budget: next.state.budget })
    expect(authoringDraftStamp(next.state, 1)).toMatchObject({ schemaVersion: 4, sourceHash: next.state.sourceHash })
    const legacy = { ...start, schemaVersion: 1 }; delete (legacy as Record<string, unknown>).source; delete (legacy as Record<string, unknown>).policy; delete (legacy as Record<string, unknown>).capability
    expect(() => replayAuthoring(legacy as never, [])).toThrow(/当前明确能力协议/)
  })
  it('retains real generated source3 and independent registered budgets under explicit new4', () => {
    const old = continuationFixtureV3(), next = createGeneratedAuthoringStartV4(old), initial = replayAuthoring(next, [])
    expect(next.source).toEqual(old.source); expect(next.policy).toEqual(old.policy)
    expect(initial.state.ledger[0].category).toBe('generation')
    expect(initial.state.budget.generationCost).toBeGreaterThan(0)
    expect(initial.state.policyHash).toBe(old.policy.policyHash)
  }, 120000)
  it('does not promote source3 generation accounting IDs into the new4 model grant', () => {
    const old = continuationFixtureV3(), only = Object.keys(old.project.document.props)[0]
    expect(Object.keys(old.project.document.props).length).toBeGreaterThan(1)
    old.scope = { targetIds: [only], operations: ['opacity'], placement: null }
    const start = createGeneratedAuthoringStartV4(old), initial = replayAuthoring(start, []), context = publicAuthoringContext(start, initial.state) as { targets: { id: string }[]; scene: unknown }
    expect(initial.state.changedIds.length).toBeGreaterThan(1)
    expect(context.targets.map(row => row.id)).toEqual([only]); expect(context.scene).toBeNull()
    for (const id of Object.keys(old.project.document.props).filter(id => id !== only)) expect(canonicalJson(context)).not.toContain(id)
    expect(authoringSummary(start, initial.state, null).changedIds).toEqual(initial.state.changedIds)
    const next = applyAuthoringStep(start, initial.state, [{ kind: 'opacity', id: only, value: .7 }], 'only-explicit-target')
    expect((publicAuthoringContext(start, next.state) as { targets: { id: string }[] }).targets.map(row => row.id)).toEqual([only])
  }, 120000)
  it('rejects forged baseline resource/source/policy identities and unregistered capabilities', () => {
    const start = current(), initial = replayAuthoring(start, [])
    expect(() => AuthoringStartV4Schema.parse({ ...start, capability: 'other' })).toThrow()
    for (const key of ['sourceHash', 'policyHash', 'ledgerHeadHash', 'budgetStateHash'] as const) {
      const forged = cloneJson(initial.state); forged[key] = 'f'.repeat(64)
      expect(() => checkAuthoringDraft(start, forged)).toThrow()
    }
    const forged = cloneJson(start)
    if (forged.source.version !== 4) throw Error('baseline')
    forged.source.resourceClosureHash = 'f'.repeat(64)
    expect(() => replayAuthoring(forged, [])).toThrow(/固定资源/)
    expect(() => LegacyStartSchema.parse({ ...start, schemaVersion: 1 })).toThrow()
  })
  it('does not disclose a changed ungranted private baseline or its retained metadata counters in public context', () => {
    const start = current(), original = publicAuthoringContext(start, replayAuthoring(start, []).state) as Record<string, unknown>
    const document = cloneJson(start.project.document), scope = start.scope.scene!
    document.title = 'PRIVATE-BASELINE-TITLE'
    document.notes['PRIVATE-NOTE-ID'] = { id: 'PRIVATE-NOTE-ID', floorId: scope.floorId, editLocked: false, visibility: 'gm', kind: 'note', anchor: { type: 'point', positionMm: { x: 9000, y: 9000 } }, title: 'PRIVATE-NOTE-TITLE', text: 'PRIVATE-NOTE-TEXT'.repeat(50) }
    document.entityLayers['PRIVATE-NOTE-ID'] = scope.layerId
    let sequence = 0
    const content = createCompositionContent(document, { ids: { nextId: () => `private-fixture-${++sequence}` }, clock: { now: () => document.createdAt } })
    const project = validateProjectData({ ...start.project, ...content })
    const changed = createCurrentAuthoringStartV4({ project, scope: start.scope, seed: start.seed, preparedAt: start.preparedAt, flowId: 'private-baseline',
      preservation: { sceneId: document.sceneId, revision: document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 } })
    const projected = publicAuthoringContext(changed, replayAuthoring(changed, []).state) as Record<string, unknown>
    const opaque = new Set(['contentHash', 'policyHash', 'sourceHash', 'ledgerHeadHash', 'budgetStateHash'])
    const withoutOpaque = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => !opaque.has(key)))
    expect(withoutOpaque(projected)).toEqual(withoutOpaque(original))
    expect(canonicalJson(projected)).not.toContain('PRIVATE-')
    expect(projected.budget).not.toHaveProperty('usage')
    expect(authoringSummary(changed, replayAuthoring(changed, []).state, null)).toHaveProperty('budget.usage.metadataBytes')
  })
  it('keeps all 17 stage recipes atomic, binds stable IDs, and leaves the previous draft on a late failure', () => {
    const start = current(), initial = replayAuthoring(start, []), operations = Array.from({ length: 17 }, () => ({ ...light }))
    const next = applyAuthoringStageV4(start, initial.state, operations, 'lighting')
    expect(next.state.steps).toHaveLength(2); expect(Object.keys(visualBase(next.project.document)!.lights)).toHaveLength(1)
    expect(applyAuthoringStageV4(start, next.state, operations, 'lighting')).toEqual(next)
    expect(() => applyAuthoringStageV4(start, next.state, [light], 'lighting')).toThrow(/相同阶段/)
    expect(() => applyAuthoringStageV4(start, initial.state, [...operations, { ...light, positionMm: { x: -10000, y: -10000 } }], 'bad')).toThrow()
    expect(replayAuthoring(start, [])).toEqual(initial)
  })
  it('charges repeated/no-op recipes and rejects the 257th actual expanded operation across steps', () => {
    const start = current(), operations = Array.from({ length: 257 }, () => ({ kind: 'transform' as const, id: 'item', positionMm: start.project.document.props.item.positionMm }))
    const steps = Array.from({ length: 17 }, (_, i) => ({ index: i + 1, stepId: `repeat-${i}`, operations: operations.slice(i * 16, (i + 1) * 16) }))
    expect(() => replayAuthoring(start, steps)).toThrow(/256|预算/)
    const next = replayAuthoring(start, steps.slice(0, 1)); expect(next.state.budget.aiCost).toBe(16)
  })
  it('creates actual persisted compact members, preserves manual deletions, and checks exact palette versions', () => {
    const start = current(), scene = start.scope.scene!; scene.operations = ['decorationCluster', 'decorationDelete', 'decorationRegenerate']
    const create = cluster(); if (create.kind !== 'decorationCluster') throw Error('cluster')
    create.supportRef.id = scene.floorId
    const initial = replayAuthoring(start, []), next = applyAuthoringStep(start, initial.state, [create], 'cluster')
    const ids = Object.keys(next.project.document.decorations!); expect(ids).toHaveLength(4)
    expect(Object.values(next.project.document.decorationClusters!.dressing.members)).toHaveLength(4)
    const deleted = applyAuthoringStep(start, next.state, [{ kind: 'decorationDelete', id: ids[0] }], 'delete')
    const regenerated = applyAuthoringStep(start, deleted.state, [{ kind: 'decorationRegenerate', id: 'dressing' }], 'regenerate')
    expect(regenerated.project.document.decorations![ids[0]]).toBeUndefined()
    expect(Object.values(regenerated.project.document.decorationClusters!.dressing.members).some(row => row.state === 'deleted' && row.entityId === null)).toBe(true)
    expect((publicAuthoringContext(start, regenerated.state) as { scene: { entities: { entityKind: string }[] } }).scene.entities.some(row => row.entityKind === 'decoration')).toBe(true)
    expect(() => applyAuthoringStep(start, initial.state, [{ ...create, palette: [{ ...create.palette[0], definitionRef: { id: 'definition', version: 2 } }] }], 'bad-palette')).toThrow()
  })
  it('accounts the full Prop cluster manual record once and rejects an ungranted group dependency on complete1', () => {
    const initialStart = current(), create = cluster()
    initialStart.scope.scene!.operations = ['decorationCluster']
    if (create.kind !== 'decorationCluster') throw Error('cluster')
    create.supportRef.id = initialStart.scope.scene!.floorId; create.palette[0].kind = 'prop'; create.maxInstances = 1
    const dressed = applyAuthoringStep(initialStart, replayAuthoring(initialStart, []).state, [create], 'full-prop')
    const member = Object.values(dressed.project.document.decorationClusters!.dressing.members)[0].entityId!
    const scope = cloneJson(initialStart.scope); scope.targetIds = [member]; scope.operations = ['opacity', 'transform']
    scope.scene!.entityIds = ['item', 'dressing', member]; scope.scene!.operations = ['furnish']
    const start = createCurrentAuthoringStartV4({ project: dressed.project, scope, seed: initialStart.seed, preparedAt: initialStart.preparedAt, flowId: 'managed-prop',
      preservation: { sceneId: dressed.project.document.sceneId, revision: dressed.project.document.revision, contentHash: authoringProjectHash(dressed.project), checkpoint: 1 } })
    const positionMm = { ...dressed.project.document.props[member].positionMm, x: dressed.project.document.props[member].positionMm.x + 50 }
    const initial = replayAuthoring(start, []), changed = applyAuthoringStep(start, initial.state, [{ kind: 'transform', id: member, positionMm }], 'manual-position')
    expect(Object.values(changed.project.document.decorationClusters!.dressing.members)[0].state).toBe('manual')
    expect(changed.state.changedIds).toContain('dressing'); expect(changed.state.readIds).toContain('dressing')
    const manual = terrainCommandCost(initial.project.document, changed.project.document, { before: initial.project, after: changed.project }).total
    expect(changed.state.budget.aiCost).toBe(manual); expect(manual).toBeGreaterThan(1)
    const ungranted = cloneJson(start); ungranted.scope.scene!.entityIds = [member]
    expect(() => applyAuthoringStep(ungranted, replayAuthoring(ungranted, []).state, [{ kind: 'transform', id: member, positionMm }], 'missing-group')).toThrow(/授权/)
  })
  it('places the production b2-p-10 lamp and a true fixed near-side source while rejecting resource/presentation mutation', () => {
    const { start, definitionId } = productionCatalogue(), initial = replayAuthoring(start, [])
    expect(start.project.document.propDefinitions['b2-p-10'].name).toBe('铜色桌灯')
    const next = applyAuthoringStep(start, initial.state, [{ kind: 'place', definitionId: 'b2-p-10', positionMm: { x: 7000, y: 5000 } },
      { kind: 'place', definitionId, positionMm: { x: 14000, y: 12000 } }], 'catalogue-place')
    const props = Object.values(next.project.document.props), lamp = props.find(row => row.definitionRef?.id === 'b2-p-10')!, tree = props.find(row => row.definitionRef?.id === definitionId)!
    expect(lamp).toBeTruthy(); expect(tree).toBeTruthy()
    const lampSource = next.project.appearance.propSources[lamp.id], treeSource = next.project.appearance.propSources[tree.id]
    expect(next.project.appearance.presentations![lampSource].mode).toBe('topDown')
    expect(next.project.appearance.presentations![treeSource].mode).toBe('nearSide')
    expect(Object.keys(next.project.appearance.presentations!)).toHaveLength(Object.keys(start.project.appearance.presentations!).length + 1)
    expect(next.project.assets).toEqual(start.project.assets); expect(next.project.appearance.variants).toEqual(start.project.appearance.variants)
    expect(replayAuthoring(start, next.state.steps)).toEqual(next)
    const oldId = Object.keys(start.project.appearance.presentations!)[0]
    for (const alter of [
      (project: typeof next.project) => { delete project.appearance.presentations![oldId] },
      (project: typeof next.project) => { project.appearance.presentations![oldId].rootAnchorMm.x += 1 },
      (project: typeof next.project) => { project.appearance.presentations![lampSource].rootAnchorMm.x += 1 },
      (project: typeof next.project) => { const source = project.appearance.sources[lampSource]; if (source.kind === 'prop') source.snapshot.visualBoundsMm.x += 1 },
      (project: typeof next.project) => { project.assets[Object.keys(project.assets)[0]].sizeBytes += 1 },
      (project: typeof next.project) => { project.appearance.variants.newVariant = { id: 'newVariant', sourceAssetId: 'b2-a-14', outputAssetId: 'b2-a-14', tint: null, brightness: 1 } },
    ]) {
      const forged = cloneJson(next.project); alter(forged)
      expect(() => assertCurrentAuthoringResourceEvolution(start, forged)).toThrow(/固定/)
    }
  })
  it('uses one root-anchored paint polygon for near-side placement, start grants, model context and private masks', () => {
    const { start: full, definitionId } = productionCatalogue(), definition = full.project.document.propDefinitions[definitionId], positionMm = { x: 10000, y: 10000 }
    const sourceBounds = definition.defaultVisualBoundsMm, boundsMm = { x: positionMm.x + sourceBounds.x - 10, y: positionMm.y + sourceBounds.y - 10, width: sourceBounds.width + 20, height: sourceBounds.height + 20 }
    const wrap = (project: typeof full.project, scope: AuthoringStartV4['scope']) => createCurrentAuthoringStartV4({ project, scope, seed: full.seed, preparedAt: full.preparedAt, flowId: 'root-scope',
      preservation: { sceneId: project.document.sceneId, revision: project.document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 } })
    const narrowScope = cloneJson(full.scope); narrowScope.placement!.boundsMm = boundsMm
    const narrow = wrap(full.project, narrowScope), probe = probeAuthoringPlacement(narrow.project, narrow, new Set(), { definitionId, supportRef: narrow.scope.placement!.supportRef, positionMm })
    expect(probe.tested.selectedSupportFitsWholeFootprint).toBe(true); expect(probe.tested.insideFrozenBounds).toBe(false)
    expect(() => applyAuthoringStep(narrow, replayAuthoring(narrow, []).state, [{ kind: 'place', definitionId, positionMm }], 'root-outside')).toThrow(/图像.*授权范围/)
    const placed = applyAuthoringStep(full, replayAuthoring(full, []).state, [{ kind: 'place', definitionId, positionMm }], 'root-inside'), prop = Object.values(placed.project.document.props)[0]
    const fixed = propPresentation(placed.project.appearance, prop.id)!
    expect(fixed.mode).toBe('nearSide')
    const targetScope: AuthoringStartV4['scope'] = { targetIds: [prop.id], operations: ['transform'], placement: null }
    const target = wrap(placed.project, targetScope), context = publicAuthoringContext(target, replayAuthoring(target, []).state) as { targets: { visualBoundsMm: { y: number }; paintBoundsMm: { y: number } }[] }
    expect(context.targets[0].visualBoundsMm.y).toBe(sourceBounds.y - fixed.rootAnchorMm.y)
    expect(context.targets[0].paintBoundsMm.y).toBe(positionMm.y + sourceBounds.y - fixed.rootAnchorMm.y)
    const scene = { floorId: prop.floorId, layerId: placed.project.document.entityLayers[prop.id], boundsMm, entityIds: [prop.id], definitionIds: [], prefabDefinitionIds: [], materialIds: [], operations: ['furnish' as const] }
    expect(() => wrap(placed.project, { targetIds: [], operations: [], placement: null, scene })).toThrow(/边界.*授权范围/)
    expect(() => wrap(placed.project, { targetIds: [], operations: [], placement: null, visual: { floorId: scene.floorId, layerId: scene.layerId, boundsMm, entityIds: [prop.id], definitionIds: [], materialIds: [], operations: ['visualLight'] } })).toThrow(/边界.*授权范围/)
    const document = cloneJson(placed.project.document), maskY = Math.round(positionMm.y + sourceBounds.y - fixed.rootAnchorMm.y / 2)
    document.regions.mask = { id: 'mask', floorId: prop.floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', boundaryMm: [{ x: 9900, y: maskY - 50 }, { x: 10100, y: maskY - 50 }, { x: 10100, y: maskY + 50 }, { x: 9900, y: maskY + 50 }], blocksMovement: false, movementCostMultiplier: 1 }
    document.entityLayers.mask = scene.layerId
    let sequence = 0
    const identity = advanceHistoryIdentity(placed.project.historyIdentity, placed.project.document, document, { ids: { nextId: () => `mask-identity-${++sequence}` }, clock: { now: () => document.createdAt } })
    const masked = validateProjectData({ ...placed.project, document, historyIdentity: identity })
    expect(maskY).toBeLessThan(positionMm.y + sourceBounds.y)
    expect(() => wrap(masked, targetScope)).toThrow(/玩家遮罩/)
  })
  it('uses full curved connection bands for scope and admits terrain tools by actual capability on complete1', () => {
    const start = current(), scope = start.scope.scene!, document = start.project.document
    document.exportBoundsMm = { x: 0, y: 0, width: 24000, height: 18000 }; document.floors[scope.floorId].boundsMm = { ...document.exportBoundsMm }
    document.terrainAreas.high = { id: 'high', floorId: scope.floorId, visibility: 'public', editLocked: false,
      boundaryMm: [{ x: 14000, y: 1000 }, { x: 23000, y: 1000 }, { x: 23000, y: 17000 }, { x: 14000, y: 17000 }].map((positionMm, i) => ({ id: `hp${i}`, segmentId: `hs${i}`, positionMm })),
      groundElevationMm: 1200, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    document.entityLayers.high = scope.layerId
    let seq = 0
    const content = createCompositionContent(document, { ids: { nextId: () => `curve-fixture-${++seq}` }, clock: { now: () => document.createdAt } })
    const project = validateProjectData({ ...start.project, ...content })
    start.scope.visual = null; scope.entityIds = ['high']; scope.operations = ['connectionRoute']; scope.boundsMm = document.exportBoundsMm
    const input = createCurrentAuthoringStartV4({ project, scope: start.scope, seed: start.seed, preparedAt: start.preparedAt, flowId: 'curve', preservation: { sceneId: project.document.sceneId, revision: project.document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 } })
    const points = [{ x: 6000, y: 5000 }, { x: 10000, y: 5000 }, { x: 10000, y: 11000 }, { x: 18000, y: 11000 }], segments = points.slice(1).map((end, i) => ({ id: `route-${i}`, start: points[i], control1: points[i], control2: end, end }))
    const source = { version: 1 as const, kind: 'polyline' as const, segments, sampleSpacingMm: 2000, toleranceMm: 20, stairStyle: 'stone' as const, treadDepthMm: 300 }
    const route = { ...source, centerlineMm: sampleConnectionRoute(source) }
    const operation: AuthoringOperationV4 = { kind: 'connectionRoute', id: 'stairs', connectionKind: 'stairs', from: { surfaceRef: { kind: 'floor', id: scope.floorId }, positionMm: points[0] }, to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: points.at(-1)! }, widthMm: 1200, route }
    const next = applyAuthoringStep(input, replayAuthoring(input, []).state, [operation], 'curved')
    expect(next.project.document.terrainConnections.stairs.route).toEqual(route)
    const supported = current(); supported.scope.scene!.operations = ['terrainEdit']
    expect(() => replayAuthoring(supported, [])).not.toThrow()
  })
})
