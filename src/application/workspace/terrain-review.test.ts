import { describe, expect, it } from 'vitest'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import type { ProjectData } from '../../shared/model/project.js'
import { createEmptyGeneration, createEmptyIdentity2Fields, createEmptyRegional, type GenerationReference } from '../../shared/terrain-generation/contracts.js'
import { terrainRecordChanges } from '../../shared/terrain-generation/review.js'
import { canonicalJson, cloneJson, freezeJson } from '../../shared/validation/json.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import { atomicChanges } from './atomic.js'
import { fixture } from './test-fixtures.js'

const hash = 'a'.repeat(64), changedHash = 'b'.repeat(64)
const p = (x: number, y: number) => ({ x, y })
const polygon = [p(1000, 1000), p(3000, 1000), p(3000, 3000), p(1000, 3000)]
const target: GenerationReference = { kind: 'terrainArea', entityId: 'land', parentId: null, fieldGroup: 'geometry' }
// These typed snapshots isolate review semantics; they are not validation receipts.
function reviewProject(): ProjectData {
  const project = fixture().project, document = project.document
  project.schemaVersion = 3
  project.historyIdentity = { ...project.historyIdentity, version: 2, ...createEmptyIdentity2Fields() }
  document.schemaVersion = 3; document.mapMode = 'scene'; document.generation = createEmptyGeneration(); document.regional = null
  document.visual = { version: 2, base: emptyVisualSystem(), materializedEdges: {} }
  return project
}
function withGeneration(): ProjectData {
  const project = reviewProject(), document = project.document, generation = getLegacyGeneration(document)!
  const floorId = Object.keys(document.floors)[0], layerId = Object.keys(document.userLayers)[0]
  const common = { floorId, layerId, visibility: 'public' as const, editLocked: false }
  generation.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'terrain-scene', algorithmVersion: 1,
    mapMode: 'scene', seed: 'review-fixture', parameters: { terrainKind: 'island', seaElevationMm: 0, landElevationMm: 800,
      plateauElevationMm: 2600, roughness: .2, densityFactor: .3, baySide: 'south' }, materials: [], props: [],
    precision: { sampleSpacingMm: 1000, toleranceMm: 50, noiseCellMm: 4000 } }
  generation.intents.intent = { id: 'intent', floorId, visibility: 'public', boundsMm: cloneJson(document.exportBoundsMm),
    skeleton: [], constraintIds: ['activity'], preserveIds: [] }
  generation.rules.rule = { ...common, id: 'rule', kind: 'terrain', recipeRef: { id: 'recipe', version: 1 }, inputs: [], outputs: [cloneJson(target)],
    parameters: { widthMm: 100, minWidthMm: 100, maxWidthMm: 200, roughness: .2, densityFactor: .3 }, state: 'active', inputHash: hash, managedOutputHash: hash }
  generation.ownership.owner = { id: 'owner', outputKey: 'land-output', ruleId: 'rule', target: cloneJson(target),
    managedFields: ['geometry'], manualFields: [], state: 'managed', birthToken: 'land-birth' }
  generation.constraints.activity = { id: 'activity', floorId, visibility: 'public', strength: 'hard', kind: 'activityArea', boundaryMm: cloneJson(polygon), clearanceMm: 100 }
  generation.checks.check = { id: 'check', constraintId: 'activity', state: 'passed', algorithmId: 'clearance', algorithmVersion: 1, inputHash: hash, issues: [] }
  generation.exclusions.exclusion = { id: 'exclusion', key: 'manual-clearance', floorId, visibility: 'public', boundaryMm: cloneJson(polygon),
    reason: 'manual', candidateKey: null, birthToken: null }
  generation.sourceLinks.source = { id: 'source', sourceSceneId: 'parent-region', sourceRevision: 1, sourceContentHash: hash,
    selectionMm: cloneJson(document.exportBoundsMm), translationMm: p(0, 0), publicInputHash: hash, inherited: [], recipeRefs: [{ id: 'recipe', version: 1 }] }
  return project
}
function withRegional(): ProjectData {
  const project = reviewProject(), document = project.document
  document.mapMode = 'regional'; document.regional = createEmptyRegional()
  const regional = document.regional, common = { floorId: Object.keys(document.floors)[0], layerId: Object.keys(document.userLayers)[0], visibility: 'public' as const, editLocked: false }
  const style = { fill: '#AABBCC', stroke: '#445566', strokeWidthMm: 100, opacity: 1 }
  regional.areas.land = { ...common, id: 'land', boundaryMm: cloneJson(polygon), kind: 'land', style, relativeElevationMm: null }
  regional.lines.river = { ...common, id: 'river', pointsMm: [{ id: 'river-a', positionMm: p(1000, 1000) }, { id: 'river-b', positionMm: p(3000, 3000) }],
    kind: 'river', displayWidthMm: 500, actualWidthMm: null, portIds: [], connectedLineIds: [], flow: 'forward', style: cloneJson(style) }
  regional.landmarks.camp = { ...common, id: 'camp', positionMm: p(2000, 2000), purpose: 'camp', name: 'Camp', description: '', definitionRef: { id: 'symbol-definition', version: 1 }, areaId: 'land' }
  regional.symbolDefinitions['symbol-definition'] = { id: 'symbol-definition', catalogId: 'review-symbol', version: 1, name: 'Camp', assetId: 'symbol-image', licenseRef: 'review-license',
    origin: { kind: 'original', attribution: 'Sceneweave review fixture', canEmbed: true }, visualBoundsMm: { x: -500, y: -1000, width: 1000, height: 1000 }, rootAnchorMm: p(0, 0), orientation: 'upright' }
  regional.symbols.symbol = { ...common, id: 'symbol', definitionRef: { id: 'symbol-definition', version: 1 }, positionMm: p(2000, 2000), visualBoundsMm: { x: -500, y: -1000, width: 1000, height: 1000 },
    orientation: 'upright', renderOrder: 0, managementKey: null, sourceRef: { kind: 'landmark', id: 'camp' } }
  return project
}

describe('persisted terrain change review', () => {
  it('shows automatic management changes, invalidated checks and source updates without touched entity IDs', () => {
    const before = withGeneration(), after = cloneJson(before), generation = getLegacyGeneration(after.document)!
    generation.rules.rule.state = 'paused'
    generation.ownership.owner.managedFields = []; generation.ownership.owner.manualFields = ['geometry']; generation.ownership.owner.state = 'manual'
    generation.checks.check.state = 'unchecked'
    generation.exclusions.exclusion.reason = 'delete'
    generation.sourceLinks.source.sourceRevision = 2; generation.sourceLinks.source.sourceContentHash = changedHash
    const unchanged = canonicalJson(before), changes = atomicChanges(freezeJson(before), freezeJson(after), [])
    expect(changes.map(({ collection, id, fields }) => ({ collection, id, fields }))).toEqual([
      { collection: 'generation.rules', id: 'rule', fields: ['state'] },
      { collection: 'generation.ownership', id: 'owner', fields: ['managedFields', 'manualFields', 'state'] },
      { collection: 'generation.exclusions', id: 'exclusion', fields: ['reason'] },
      { collection: 'generation.checks', id: 'check', fields: ['state'] },
      { collection: 'generation.sourceLinks', id: 'source', fields: ['sourceContentHash', 'sourceRevision'] },
    ])
    expect(canonicalJson(before)).toBe(unchanged)
    expect(changes[1]).toMatchObject({ before: { state: 'managed', manualFields: [] }, after: { state: 'manual', manualFields: ['geometry'] } })
  })

  it('includes recipe, intent and constraint additions and removals while omitting unchanged rows', () => {
    const before = withGeneration(), after = cloneJson(before), generation = getLegacyGeneration(after.document)!
    generation.recipes['new-recipe'] = { ...cloneJson(generation.recipes.recipe), id: 'new-recipe', seed: 'new-seed' }
    generation.intents.intent.preserveIds = ['land']
    delete generation.constraints.activity
    const changes = terrainRecordChanges(before.document, after.document)
    expect(changes.map(change => `${change.collection}/${change.id}`)).toEqual(['generation.recipes/new-recipe', 'generation.intents/intent', 'generation.constraints/activity'])
    expect(changes[0].before).toBeNull(); expect(changes[0].after).toEqual(generation.recipes['new-recipe'])
    expect(changes[1].fields).toEqual(['preserveIds'])
    expect(changes[2].before).toEqual(getLegacyGeneration(before.document)!.constraints.activity); expect(changes[2].after).toBeNull()
  })

  it('reviews regional geometry, symbol definitions and profile changes with precise addition/deletion states', () => {
    const before = withRegional(), after = cloneJson(before), regional = after.document.regional!
    regional.areas.forest = { ...cloneJson(regional.areas.land), id: 'forest', kind: 'forest' }
    regional.lines.river.flow = 'reverse'
    delete regional.landmarks.camp; regional.symbols.symbol.sourceRef = null
    regional.symbolDefinitions['symbol-definition'].name = 'Forest camp'
    regional.profile.symbolScale = 1.5
    const changes = atomicChanges(before, after, [])
    expect(changes.map(({ collection, id }) => `${collection}/${id}`)).toEqual([
      'regional.areas/forest', 'regional.lines/river', 'regional.landmarks/camp', 'regional.symbols/symbol',
      'regional.symbolDefinitions/symbol-definition', `regional.profile/${regional.profile.id}`,
    ])
    expect(changes[0].before).toBeNull(); expect(changes[2].after).toBeNull()
    expect(changes.at(-1)?.fields).toEqual(['symbolScale'])
  })

  it('treats profile identity replacement as a removal and addition instead of an in-place rename', () => {
    const before = withRegional(), after = cloneJson(before)
    const originalId = after.document.regional!.profile.id
    after.document.regional!.profile.id = 'different-profile'
    const changes = terrainRecordChanges(before.document, after.document)
    expect(changes).toHaveLength(2)
    expect(changes.find(change => change.id === originalId)?.after).toBeNull()
    expect(changes.find(change => change.id === 'different-profile')?.before).toBeNull()
  })

  it('shows a materialized edge once even when touched and invalidated IDs both include it', () => {
    const before = reviewProject(), visual = before.document.visual!
    if (visual.version !== 2) throw new Error('fixture requires visual2')
    visual.materializedEdges.shore = { id: 'shore', floorId: Object.keys(before.document.floors)[0], layerId: Object.keys(before.document.userLayers)[0],
      visibility: 'public', editLocked: false, boundaryId: 'boundary', inputHash: hash, kind: 'shore', polygons: [cloneJson(polygon)],
      strokes: [], materialRef: null, fillColor: '#DDCCAA', opacity: 1 }
    const after = cloneJson(before), next = after.document.visual!
    if (next.version !== 2) throw new Error('fixture requires visual2')
    next.materializedEdges.shore.opacity = .6
    const changes = atomicChanges(before, after, ['shore', 'shore'], ['shore'])
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ id: 'shore', collection: 'visual.materializedEdges', fields: ['opacity'], before: { opacity: 1 }, after: { opacity: .6 } })
    delete next.materializedEdges.shore
    expect(atomicChanges(before, after, ['shore'])).toEqual([expect.objectContaining({ id: 'shore', collection: 'visual.materializedEdges', after: null })])
  })

  it('does not confuse object insertion order with persisted terrain changes', () => {
    const before = withGeneration(), after = cloneJson(before), generation = getLegacyGeneration(after.document)!
    generation.rules.rule = Object.fromEntries(Object.entries(generation.rules.rule).reverse()) as typeof generation.rules.rule
    generation.rules.rule.parameters = Object.fromEntries(Object.entries(generation.rules.rule.parameters).reverse()) as typeof generation.rules.rule.parameters
    generation.sourceLinks.source.selectionMm = Object.fromEntries(Object.entries(generation.sourceLinks.source.selectionMm).reverse()) as typeof generation.sourceLinks.source.selectionMm
    expect(terrainRecordChanges(before.document, after.document)).toEqual([])
    expect(atomicChanges(before, after, ['rule', 'source'])).toEqual([])
  })

  it('keeps legacy projects reviewable without adding terrain or regional records', () => {
    const before = fixture().project, after = cloneJson(before)
    expect(terrainRecordChanges(before.document, after.document)).toEqual([])
    expect(atomicChanges(before, after, [])).toEqual([])
  })
})
