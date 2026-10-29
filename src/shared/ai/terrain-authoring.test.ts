import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { describe, expect, it } from 'vitest'
import { terrainAuthoringFixture } from '../../../tests/helpers/terrain-authoring-fixture.js'
import { applyAuthoringStep, authoringProjectHash, replayAuthoring } from './authoring.js'
import { regionalSceneCandidate } from './terrain-authoring.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateProjectData } from '../project/validate.js'
import { prepareTerrainEdit, terrainEditRequestSchema } from '../terrain-generation/edit.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { generateTerrainDocument } from '../terrain-generation/generate.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import type { TerrainAuthoringOperation } from './terrain-protocol.js'
import { constraintInputHash, managedOutputHash } from '../terrain-generation/integrity.js'
import { regionalAuthorizedSubsetHash } from '../terrain-generation/regional-authoring.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import { createCompositionContent } from '../appearance/graph.js'

function regionalCandidateFixture() {
  const start = terrainAuthoringFixture(false, true), initial = replayAuthoring(start, []).state
  const generated = applyAuthoringStep(start, initial, [{ kind: 'regionalGenerate', request: { kind: 'regional', sceneId: start.project.document.sceneId, operationId: 'region-candidate', seed: 'fixed', widthMm: 1_000_000, heightMm: 800_000 } }], 'regional-candidate')
  const project = cloneJson(generated.project), regional = project.document.regional!
  const asset = project.document.assets[Object.keys(project.document.assets)[0]]
  const definition = { id: 'regional-candidate-definition', catalogId: 'regional-candidate', version: 1, name: 'Candidate symbol', assetId: asset.id, licenseRef: asset.licenseRef,
    origin: cloneJson(asset.origin), visualBoundsMm: { x: -20_000, y: -20_000, width: 40_000, height: 40_000 }, rootAnchorMm: { x: 0, y: 0 }, orientation: 'upright' as const }
  regional.symbolDefinitions[definition.id] = definition
  const areaId = Object.keys(regional.areas)[0]
  const symbol = { id: 'regional-candidate-symbol', floorId: 'visual-floor', layerId: 'visual-layer-ground', visibility: 'public' as const, editLocked: false,
    definitionRef: { id: definition.id, version: 1 }, positionMm: { x: 300_000, y: 300_000 }, visualBoundsMm: definition.visualBoundsMm,
    orientation: 'upright' as const, renderOrder: 0, managementKey: null, sourceRef: { kind: 'area' as const, id: areaId } }
  regional.symbols[symbol.id] = symbol
  const scope = cloneJson(start.scope.scene!)
  scope.entityIds = [symbol.id]
  scope.operations = ['regionalEdit']
  scope.boundsMm = project.document.exportBoundsMm
  scope.regionalDefinitionIds = [definition.id]
  return { project, scope, symbol, definition, areaId }
}

function edit(start = terrainAuthoringFixture(true)): TerrainAuthoringOperation {
  return { kind: 'terrainEdit', request: terrainEditRequestSchema.parse({ kind: 'brush', sceneId: start.project.document.sceneId, operationId: 'ai-explicit-clear', floorId: 'visual-floor', scopeMm: start.scope.scene!.boundsMm, linkMode: 'scenery', mode: 'clearArea', targetAreaId: 'terrain-low', materialRef: null, elevationMm: null, strokes: [{ pointsMm: [{ x: 2000, y: 2000 }], radiusMm: 300 }] }) }
}

/** A strict v4 fixture for the local transition/scenery AI path. */
function local(start = terrainAuthoringFixture(true)) {
  const document = emptyCompositionDocument(start.project.document)
  const layerId = 'visual-layer-ground'
  const area = Object.values(document.terrainAreas).find(value => !value.blocksMovement) ?? Object.values(document.terrainAreas)[0]
  const definition = Object.values(document.propDefinitions)[0]
  if (!area || !definition) throw new Error('local fixture requires a terrain area and fixed definition')
  const groupId = 'ai-local-scatter'
  document.scatterGroups[groupId] = { id: groupId, floorId: area.floorId, editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: area.id },
    palette: [{ key: 'primary', propDefinitionRef: { id: definition.id, version: definition.version }, weight: 1 }], seed: 'ai-local-seed', algorithmVersion: 'scatter-cell-v1',
    gridOriginMm: { x: document.exportBoundsMm.x, y: document.exportBoundsMm.y }, cellSizeMm: 6000, densityFactor: .35, minDistanceMm: 500, rotationRangeDeg: { min: 0, max: 0 }, members: {}, exclusions: [] }
  document.entityLayers[groupId] = layerId
  const runtime = { ids: { nextId: (() => { let n = 0; return () => `ai-local-${++n}` })() }, clock: { now: () => document.updatedAt } }
  const content = createCompositionContent(document, runtime)
  const project = validateProjectData({ ...start.project, schemaVersion: 4, ...content })
  const scope = cloneJson(start.scope)
  if (!scope.scene) throw new Error('local fixture requires scene scope')
  scope.scene.operations = [...new Set([...scope.scene.operations, 'terrainLocal' as const])] as typeof scope.scene.operations
  scope.scene.entityIds = [...new Set([...scope.scene.entityIds, groupId])]
  scope.scene.definitionIds = [...new Set([...scope.scene.definitionIds, definition.id])]
  return { ...start, project, baseContentHash: authoringProjectHash(project), scope }
}
describe('same-core terrain authoring finite replay', () => {
  it('rejects a selected regional symbol when its fixed definition is not separately authorized', () => {
    const fixture = regionalCandidateFixture()
    fixture.scope.regionalDefinitionIds = []
    expect(() => regionalSceneCandidate(fixture.project, fixture.scope, new Set([fixture.symbol.id]), {
      kind: 'regionalDrillDown', sourceSceneId: fixture.project.document.sceneId, sceneId: 'regional-child-denied', operationId: 'regional-child-denied',
      selectionMm: { x: 0, y: 0, width: 500_000, height: 500_000 }, includePrivate: false,
    })).toThrow(/地形候选存在未授权依赖/)
  })

  it('keeps an authorized regional definition but strips unselected source relations and constraints', () => {
    const fixture = regionalCandidateFixture(), portId = 'ungranted-regional-port'
    getLegacyGeneration(fixture.project.document)!.constraints[portId] = { id: portId, floorId: 'visual-floor', visibility: 'public', strength: 'soft', kind: 'port', positionMm: { x: 300_000, y: 300_000 }, directionDeg: 0, widthMm: 10_000 }
    const result = regionalSceneCandidate(fixture.project, fixture.scope, new Set([fixture.symbol.id]), {
      kind: 'regionalDrillDown', sourceSceneId: fixture.project.document.sceneId, sceneId: 'regional-child-allowed', operationId: 'regional-child-allowed',
      selectionMm: { x: 0, y: 0, width: 500_000, height: 500_000 }, includePrivate: false,
    })
    const inherited = result.sourceLink.inherited.find(row => row.sourceEntityId === fixture.symbol.id)
    expect(inherited?.kind).toBe('symbol')
    expect(inherited && 'symbol' in inherited ? inherited.symbol.definition.id : null).toBe(fixture.definition.id)
    expect(inherited && 'symbol' in inherited ? inherited.symbol.sourceRef : null).toBeNull()
    expect(result.sourceLink.inherited.some(row => row.sourceEntityId === portId)).toBe(false)
    expect(regionalAuthorizedSubsetHash(fixture.project.document, result.sourceLink)).toBe(result.sourceLink.sourceContentHash)
    fixture.project.document.regional!.areas[fixture.areaId].style.fill = '#123456'
    expect(regionalAuthorizedSubsetHash(fixture.project.document, result.sourceLink)).toBe(result.sourceLink.sourceContentHash)
    const unrelated = cloneJson(fixture.definition); unrelated.id = 'unrelated-definition'; unrelated.catalogId = 'unrelated-definition'
    fixture.project.document.regional!.symbolDefinitions[unrelated.id] = unrelated
    const repeated = regionalSceneCandidate(fixture.project, fixture.scope, new Set([fixture.symbol.id]), {
      kind: 'regionalDrillDown', sourceSceneId: fixture.project.document.sceneId, sceneId: 'regional-child-allowed-2', operationId: 'regional-child-allowed-2',
      selectionMm: { x: 0, y: 0, width: 500_000, height: 500_000 }, includePrivate: false,
    })
    expect(repeated.sourceLink.sourceContentHash).toBe(result.sourceLink.sourceContentHash)
    fixture.project.document.regional!.symbols[fixture.symbol.id].positionMm.x += 100
    expect(regionalAuthorizedSubsetHash(fixture.project.document, result.sourceLink)).not.toBe(result.sourceLink.sourceContentHash)
  })

  it('compares authorized landmark sources with their omitted area relation removed', () => {
    const fixture = regionalCandidateFixture(), regional = fixture.project.document.regional!, landmarkId = 'regional-candidate-landmark'
    delete regional.symbols[fixture.symbol.id]
    regional.landmarks[landmarkId] = { id: landmarkId, floorId: fixture.symbol.floorId, layerId: fixture.symbol.layerId, visibility: 'public', editLocked: false,
      positionMm: fixture.symbol.positionMm, purpose: 'ruin', name: 'Public ruin', description: 'Authorized landmark', definitionRef: fixture.symbol.definitionRef, areaId: fixture.areaId }
    const result = regionalSceneCandidate(fixture.project, fixture.scope, new Set([landmarkId]), {
      kind: 'regionalDrillDown', sourceSceneId: fixture.project.document.sceneId, sceneId: 'landmark-subset-child', operationId: 'landmark-subset-child',
      selectionMm: { x: 0, y: 0, width: 500_000, height: 500_000 }, includePrivate: false,
    })
    const feature = result.sourceLink.inherited.find(row => row.sourceEntityId === landmarkId)
    expect(feature && 'landmark' in feature ? feature.landmark.areaId : undefined).toBeNull()
    expect(regionalAuthorizedSubsetHash(fixture.project.document, result.sourceLink)).toBe(result.sourceLink.sourceContentHash)
    regional.landmarks[landmarkId].description = 'Changed authorized landmark'
    expect(regionalAuthorizedSubsetHash(fixture.project.document, result.sourceLink)).not.toBe(result.sourceLink.sourceContentHash)
  })

  it('retains an explicitly copied relation to an authorized source outside the child selection', () => {
    const fixture = regionalCandidateFixture(), regional = fixture.project.document.regional!, outsideId = 'regional-authorized-outside'
    regional.areas[outsideId] = { ...cloneJson(regional.areas[fixture.areaId]), id: outsideId,
      boundaryMm: [{ x: 600_000, y: 600_000 }, { x: 900_000, y: 600_000 }, { x: 900_000, y: 750_000 }, { x: 600_000, y: 750_000 }] }
    regional.symbols[fixture.symbol.id].sourceRef = { kind: 'area', id: outsideId }
    const result = regionalSceneCandidate(fixture.project, fixture.scope, new Set([fixture.symbol.id, outsideId]), {
      kind: 'regionalDrillDown', sourceSceneId: fixture.project.document.sceneId, sceneId: 'outside-relation-child', operationId: 'outside-relation-child',
      selectionMm: { x: 0, y: 0, width: 500_000, height: 500_000 }, includePrivate: false,
    })
    expect(result.sourceLink.inherited.some(row => row.sourceEntityId === outsideId)).toBe(false)
    expect(regionalAuthorizedSubsetHash(fixture.project.document, result.sourceLink)).toBe(result.sourceLink.sourceContentHash)
    regional.symbols[fixture.symbol.id].sourceRef = null
    expect(regionalAuthorizedSubsetHash(fixture.project.document, result.sourceLink)).not.toBe(result.sourceLink.sourceContentHash)
  })

  it('replays a real generated complete3 candidate with actual full expansion and no baseline mutation', () => {
    const start = terrainAuthoringFixture(), before = canonicalJson(start), operation: TerrainAuthoringOperation = { kind: 'terrainGenerate', request: { sceneId: start.project.document.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000 } }
    const initial = replayAuthoring(start, []).state, result = applyAuthoringStep(start, initial, [operation], 'generate')
    expect(result.project.schemaVersion).toBe(3)
    expect(Object.keys(result.project.document.terrainAreas).length).toBeGreaterThan(1)
    expect(result.state.operationCost).toBe(terrainCommandCost(start.project.document, result.project.document).total)
    expect(result.state.operationCost).toBeLessThanOrEqual(256)
    expect(replayAuthoring(start, result.state.steps).state).toEqual(result.state)
    expect(validateProjectData(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    expect(canonicalJson(start)).toBe(before)
  })
  it('matches the existing local-edit pure core exactly and preserves complete sources/history', () => {
    const start = terrainAuthoringFixture(true), operation = edit(start)
    if (operation.kind !== 'terrainEdit') throw new Error('fixture')
    const expected = prepareTerrainEdit(start.project.document, operation.request), result = applyAuthoringStep(start, replayAuthoring(start, []).state, [operation], 'clear')
    expect(result.project.document).toEqual(expected.document)
    expect(result.state.operationCost).toBe(expected.cost.total)
    expect(replayAuthoring(start, result.state.steps).project).toEqual(result.project)
  })
  it('authorizes a strict v4 local refresh, replays the same project and keeps the base immutable', () => {
    const start = local(), before = canonicalJson(start.project), initial = replayAuthoring(start, [])
    const operation: TerrainAuthoringOperation = { kind: 'terrainLocal', request: { sceneId: start.project.document.sceneId, scopeMm: start.project.document.exportBoundsMm } }
    const result = applyAuthoringStep(start, initial.state, [operation], 'local-refresh')
    expect(result.project.schemaVersion).toBe(4)
    expect(result.project.document.generation?.version).toBe(5)
    expect(result.project.document.visual?.version).toBe(3)
    expect(result.state.operationCost).toBeGreaterThan(0)
    expect(replayAuthoring(start, result.state.steps)).toEqual(result)
    expect(canonicalJson(start.project)).toBe(before)
  })
  it('rejects local refresh when the v4 grant or complete public closure is missing', () => {
    const start = local(), operation: TerrainAuthoringOperation = { kind: 'terrainLocal', request: { sceneId: start.project.document.sceneId, scopeMm: start.project.document.exportBoundsMm } }
    const noGrant = cloneJson(start)
    noGrant.scope.scene!.operations = noGrant.scope.scene!.operations.filter(kind => kind !== 'terrainLocal')
    noGrant.baseContentHash = authoringProjectHash(noGrant.project)
    expect(() => applyAuthoringStep(noGrant, replayAuthoring(noGrant, []).state, [operation], 'denied')).toThrow(/未授权/)
    const privateSource = cloneJson(start), definitionId = privateSource.project.document.scatterGroups['ai-local-scatter'].palette[0].propDefinitionRef.id
    privateSource.scope.scene!.definitionIds = privateSource.scope.scene!.definitionIds.filter(id => id !== definitionId)
    privateSource.baseContentHash = authoringProjectHash(privateSource.project)
    expect(() => applyAuthoringStep(privateSource, replayAuthoring(privateSource, []).state, [operation], 'private')).toThrow(/地形候选存在未授权依赖/)
  })
  it('requires explicit kind, bounds, fixed palette and all generation layers', () => {
    for (const remove of ['kind', 'layers', 'materials'] as const) {
      const start = terrainAuthoringFixture()
      if (remove === 'kind') start.scope.scene!.operations = ['terrainEdit']
      if (remove === 'layers') start.scope.scene!.generationLayerIds = []
      if (remove === 'materials') start.scope.scene!.materialIds = []
      expect(() => applyAuthoringStep(start, replayAuthoring(start, []).state, [{ kind: 'terrainGenerate', request: { sceneId: start.project.document.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000 } }], 'denied')).toThrow(/未授权/)
    }
    const start = terrainAuthoringFixture(true), operation = edit(start)
    if (operation.kind !== 'terrainEdit') throw new Error('fixture')
    operation.request.scopeMm.width += 1
    expect(() => applyAuthoringStep(start, replayAuthoring(start, []).state, [operation], 'denied')).toThrow(/未授权/)
  })
  it('rejects any ungranted or private closure with one fixed message before the private geometry can steer a candidate', () => {
    const messages: string[] = []
    for (const privateValue of [false, true]) {
      const start = terrainAuthoringFixture(true), id = Object.keys(start.project.document.props)[0]
      start.scope.scene!.entityIds = start.scope.scene!.entityIds.filter(value => value !== id)
      if (privateValue) { start.project.document.props[id].visibility = 'gm'; start.project.document.props[id].positionMm.x += 1 }
      for (const rule of Object.values(getLegacyGeneration(start.project.document)!.rules)) rule.managedOutputHash = managedOutputHash(start.project.document, rule)
      for (const check of Object.values(start.project.document.generation!.checks)) check.inputHash = constraintInputHash(start.project.document, check.constraintId)
      start.baseContentHash = authoringProjectHash(start.project)
      try { applyAuthoringStep(start, replayAuthoring(start, []).state, [edit(start)], 'private') } catch (error) { messages.push((error as Error).message) }
    }
    expect(messages).toEqual(['地形候选存在未授权依赖，此步骤未采用。', '地形候选存在未授权依赖，此步骤未采用。'])
  })
  it('creates an independent regional draft within existing bounds and applies explicit region edits', () => {
    const start = terrainAuthoringFixture(false, true), initial = replayAuthoring(start, []).state
    const created = applyAuthoringStep(start, initial, [{ kind: 'regionalGenerate', request: { kind: 'regional', sceneId: start.project.document.sceneId, operationId: 'region-ai', seed: 'fixed', widthMm: 1_000_000, heightMm: 800_000 } }], 'regional')
    expect(created.project.document.mapMode).toBe('regional')
    expect(Object.keys(created.project.document.regional!.areas).length).toBeGreaterThan(0)
    const area = cloneJson(Object.values(created.project.document.regional!.areas)[0]); area.style.fill = '#AABBCC'
    const edited = applyAuthoringStep(start, created.state, [{ kind: 'regionalEdit', request: { kind: 'regionalEdit', sceneId: start.project.document.sceneId, operationId: 'regional-edit', operation: 'upsertArea', area } }], 'edit-region')
    expect(edited.project.document.regional!.areas[area.id].style.fill).toBe('#AABBCC')
    expect(edited.state.operationCost).toBeGreaterThan(created.state.operationCost)
    expect(replayAuthoring(start, edited.state.steps).project).toEqual(edited.project)
  })
})
