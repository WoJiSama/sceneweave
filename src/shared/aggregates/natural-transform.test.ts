import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent, listRequiredVariants, resolveAppearance } from '../appearance/graph.js'
import { applyCommands } from '../commands/commands.js'
import { domainExecutionFixture } from '../../../tools/testing/domain-execution-fixtures.js'
import { reconcileDecorationMembers } from '../decorations/commands.js'
import { runForestGeneration } from '../generation/domains/forest/index.js'
import { runVolcanoGeneration } from '../generation/domains/volcano/index.js'
import { defaultMixedInput, runMixedGeneration } from '../generation/domains/mixed/index.js'
import { getLegacyGeneration, getLegacyVisual } from '../terrain-generation/composition-contracts.js'
import { pauseChangedCompositions } from '../terrain-generation/composition-lifecycle.js'
import { detachChangedOutputs, managedOutputHash, materializedBoundaryHash } from '../terrain-generation/integrity.js'
import type { SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { applyAggregateRepresentationCommand } from './commands.js'
import { naturalAggregateMembers } from './domain-adapters.js'
import { applyNaturalAggregateCommand, naturalAggregateCommandSchema, type NaturalAggregateCommand } from './natural-transform.js'
import { encodeSceneCoordinates, decodeSceneCoordinates } from './scene-coordinates.js'
import { aggregateWorldFrames } from './state.js'
import { visualBase } from '../visual/base.js'
import { sampleVisualBoundary } from '../visual/geometry.js'
import { materializeTerrainTransition, validateTerrainTransitions } from '../visual/transition.js'

const move: NaturalAggregateCommand = { type: 'transformAggregateNatural', id: 'natural', offsetMm: { x: 1000, y: 500 }, pivotMm: { x: 8000, y: 8000 }, quarterTurns: 1 }
function group(scene: SceneDocument, seeds = Object.keys(scene.terrainAreas)) {
  applyAggregateRepresentationCommand(scene, { type: 'createAggregateGroup', group: { id: 'natural', floorId: scene.terrainAreas[seeds[0]].floorId, parentId: null,
    frame: { translationMm: { x: 8000, y: 8000 }, quarterTurns: 0 }, members: naturalAggregateMembers(scene, seeds), editLocked: false } })
  return scene
}
function checked(scene: SceneDocument): SceneDocument {
  const result = validateSceneDocument(scene)
  if (!result.ok) throw new Error(result.errors.map(row => `${row.code}:${row.entityId}:${row.message}`).join('\n'))
  return result.document
}
/** The same post-command lifecycle used by the owning ordinary dispatcher. */
function apply(scene: SceneDocument, command = move, fixedUprightIds?: ReadonlySet<string>) {
  const next = cloneJson(scene)
  applyNaturalAggregateCommand(next, command, { fixedUprightIds })
  reconcileDecorationMembers(scene, next); detachChangedOutputs(scene, next); pauseChangedCompositions(scene, next)
  return checked(next)
}
function simple() {
  const scene = fixture({ image: true }).project.document, floorId = 'blank-floor', layer = scene.entityLayers.item
  scene.props.item.positionMm = { x: 6000, y: 6000 }; scene.props.item.supportRef = { kind: 'terrainArea', id: 'ground' }
  scene.props.other.positionMm = { x: 18000, y: 18000 }
  scene.terrainAreas.ground = { id: 'ground', floorId, editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 3000, y: 3000 }, { x: 13000, y: 3000 }, { x: 13000, y: 13000 }, { x: 3000, y: 13000 }]
      .map((positionMm, i) => ({ id: `ground-p${i}`, segmentId: `ground-s${i}`, positionMm })), groundElevationMm: 0, coveragePriority: 1,
    surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.paths.road = { id: 'road', floorId, editLocked: false, visibility: 'public', centerlineMm: [{ x: 5000, y: 9000 }, { x: 10000, y: 9000 }],
    widthMm: 400, supportRefs: [{ kind: 'terrainArea', id: 'ground' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  scene.scatterGroups.scatter = { id: 'scatter', floorId, editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: 'ground' },
    palette: [{ key: 'item', propDefinitionRef: { id: 'definition', version: 1 }, weight: 1 }], seed: 'keep-real-results', algorithmVersion: 'scatter-cell-v1',
    gridOriginMm: { x: 4000, y: 4000 }, cellSizeMm: 1000, densityFactor: .5, minDistanceMm: 100, rotationRangeDeg: { min: 0, max: 359 },
    members: { ['d'.repeat(64)]: { propId: 'item', state: 'manual', overrideFields: ['positionMm'] }, ['e'.repeat(64)]: { propId: null, state: 'deleted', overrideFields: [] },
      ['f'.repeat(64)]: { propId: null, state: 'detached', overrideFields: [] } },
    exclusions: [{ id: 'scatter-delete', boundaryMm: [{ x: 7000, y: 7000 }, { x: 8000, y: 7000 }, { x: 8000, y: 8000 }, { x: 7000, y: 8000 }], reason: 'delete', sourceCandidateKey: 'e'.repeat(64) }] }
  scene.decorations.decor = { id: 'decor', floorId, editLocked: false, visibility: 'public', definitionRef: { id: 'definition', version: 1 },
    supportRef: { kind: 'terrainArea', id: 'ground' }, positionMm: { x: 5000, y: 5000 }, rotationDeg: 0, scalePpm: 1000000, renderOrder: 0 }
  scene.decorationClusters.cluster = { id: 'cluster', floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: 'ground' },
    boundsMm: { x: 4000, y: 4000, width: 7000, height: 7000 }, seed: 'retain-slots', algorithmVersion: 'cluster-v1',
    palette: [{ key: 'decor', definitionRef: { id: 'definition', version: 1 }, kind: 'decoration', weight: 1 }], maxInstances: 4, spacingMm: 100, clusterRadiusMm: 1000, clearanceMm: 100,
    members: { ['a'.repeat(64)]: { kind: 'decoration', entityId: 'decor', state: 'manual' }, ['b'.repeat(64)]: { kind: 'decoration', entityId: null, state: 'deleted' }, ['c'.repeat(64)]: { kind: 'decoration', entityId: null, state: 'detached' } } }
  scene.notes.clue = { id: 'clue', floorId, editLocked: false, kind: 'clue', text: 'private', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
  for (const id of ['ground', 'road', 'scatter', 'decor', 'cluster', 'clue']) scene.entityLayers[id] = layer
  return group(checked(scene))
}
describe('natural aggregate rigid transformations', () => {
  it('preserves exact local geometry, source identity, manual/deleted/detached slots and scatter exclusions', () => {
    const scene = simple(), before = canonicalJson(scene), local = encodeSceneCoordinates(scene), result = apply(scene), encoded = encodeSceneCoordinates(result)
    expect(result.props.item.positionMm).toEqual({ x: 11000, y: 6500 })
    expect(result.props.other).toEqual(scene.props.other)
    expect(result.scatterGroups.scatter.members).toEqual(scene.scatterGroups.scatter.members)
    expect(result.decorationClusters.cluster.members).toEqual(scene.decorationClusters.cluster.members)
    expect(result.scatterGroups.scatter.exclusions[0].boundaryMm).not.toEqual(scene.scatterGroups.scatter.exclusions[0].boundaryMm)
    for (const field of ['terrainAreas', 'paths', 'props', 'decorations', 'decorationClusters', 'scatterGroups'] as const) expect(encoded[field]).toEqual(local[field])
    expect(result.notes).toEqual(scene.notes)
    expect(decodeSceneCoordinates(encoded)).toEqual(result)
    expect(canonicalJson(scene)).toBe(before)
  })
  it('retains a near-side source orientation and composes a nested parent frame without moving the parent', () => {
    const scene = simple()
    applyAggregateRepresentationCommand(scene, { type: 'createAggregateGroup', group: { id: 'parent', floorId: 'blank-floor', parentId: null,
      frame: { translationMm: { x: 100, y: -200 }, quarterTurns: 3 }, members: [], editLocked: false } })
    applyAggregateRepresentationCommand(scene, { type: 'reparentAggregateGroup', id: 'natural', parentId: 'parent' })
    const result = apply(scene, move, new Set(['item', 'decor']))
    expect(result.props.item.rotationDeg).toBe(scene.props.item.rotationDeg)
    expect(result.decorations.decor.rotationDeg).toBe(scene.decorations.decor.rotationDeg)
    expect(result.aggregateCoordinates!.groups.parent).toEqual(scene.aggregateCoordinates!.groups.parent)
    expect(aggregateWorldFrames(result.aggregateCoordinates!).get('natural')).toEqual({ translationMm: { x: 9000, y: 8500 }, quarterTurns: 1 })
  })
  it('rejects locks, unsupported fields, unsafe coordinates, extra members and unresolved world exclusions atomically', () => {
    for (const mode of ['lock', 'extra', 'exclusion', 'overflow'] as const) {
      const scene = simple()
      if (mode === 'lock') scene.notes.clue.editLocked = true
      if (mode === 'extra') scene.aggregateCoordinates!.groups.natural.members.push({ kind: 'prop', id: 'other' })
      if (mode === 'exclusion') getLegacyGeneration(scene)!.exclusions.world = { id: 'world', key: 'world', floorId: 'blank-floor', visibility: 'gm',
        boundaryMm: [{ x: 6000, y: 6000 }, { x: 7000, y: 6000 }, { x: 7000, y: 7000 }], reason: 'manual', candidateKey: null, birthToken: null }
      const before = canonicalJson(scene)
      expect(() => applyNaturalAggregateCommand(scene, mode === 'overflow' ? { ...move, offsetMm: { x: Number.MAX_SAFE_INTEGER, y: 0 } } : move), mode).toThrow()
      expect(canonicalJson(scene)).toBe(before)
    }
    expect(naturalAggregateCommandSchema.safeParse({ ...move, scale: 2 }).success).toBe(false)
    expect(naturalAggregateCommandSchema.safeParse({ ...move, quarterTurns: .5 }).success).toBe(false)
  })
  it('moves a high terrain-to-Floor connection with both actual endpoints and preserves its external Floor', () => {
    const scene = simple(), floor = cloneJson(scene.floors)
    scene.terrainAreas.ground.groundElevationMm = 1000
    scene.terrainConnections.stairs = { id: 'stairs', floorId: 'blank-floor', editLocked: false, visibility: 'public', kind: 'stairs',
      from: { surfaceRef: { kind: 'terrainArea', id: 'ground' }, positionMm: { x: 8000, y: 4000 } },
      to: { surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 8000, y: 2000 } }, widthMm: 600, openingId: null,
      blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    scene.entityLayers.stairs = scene.entityLayers.ground
    scene.aggregateCoordinates!.groups.natural.members = naturalAggregateMembers(scene, ['ground'])
    checked(scene)
    const next = apply(scene)
    expect(next.floors).toEqual(floor)
    expect(next.terrainConnections.stairs.from).toEqual({ surfaceRef: { kind: 'terrainArea', id: 'ground' }, positionMm: { x: 13000, y: 8500 } })
    expect(next.terrainConnections.stairs.to).toEqual({ surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 15000, y: 8500 } })
    expect(next.terrainAreas.ground.groundElevationMm).toBe(1000)
  })
  it('checks locked external dependencies in both the old and transformed physical neighborhood', () => {
    for (const mode of ['old', 'next'] as const) {
      const scene = simple()
      if (mode === 'next') {
        scene.props.other.positionMm = { x: 14000, y: 6000 }
        scene.props.other.blocksMovement = false
        scene.props.other.editLocked = true
      } else {
        scene.terrainAreas.neighbor = { ...cloneJson(scene.terrainAreas.ground), id: 'neighbor', editLocked: true, boundaryMm: [
          { x: 13000, y: 3000 }, { x: 17000, y: 3000 }, { x: 17000, y: 13000 }, { x: 13000, y: 13000 },
        ].map((positionMm, i) => ({ id: `neighbor-p${i}`, segmentId: `neighbor-s${i}`, positionMm })) }
        scene.entityLayers.neighbor = scene.entityLayers.ground
      }
      checked(scene)
      const before = canonicalJson(scene)
      const command = mode === 'next' ? move : { ...move, quarterTurns: 0 as const, offsetMm: { x: -1000, y: 0 } }
      expect(() => applyNaturalAggregateCommand(scene, command), mode).toThrow(/锁定依赖/)
      expect(canonicalJson(scene)).toBe(before)
    }
  })
  it('refuses an attached edge whose other terrain remains outside the explicit group', () => {
    const scene = simple(), layer = scene.entityLayers.ground
    scene.terrainAreas.neighbor = { ...cloneJson(scene.terrainAreas.ground), id: 'neighbor', boundaryMm: [
      { x: 13000, y: 3000 }, { x: 17000, y: 3000 }, { x: 17000, y: 13000 }, { x: 13000, y: 13000 },
    ].map((positionMm, i) => ({ id: `neighbor-p${i}`, segmentId: `neighbor-s${i}`, positionMm })) }
    scene.terrainEdges.shared = { id: 'shared', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      source: { areaId: 'ground', segmentId: 'ground-s1' }, neighborAreaId: 'neighbor', kind: 'materialTransition', shoreline: false,
      blocksMovement: false, blocksSight: false, surfaceStyle: null, styleOverride: null }
    scene.entityLayers.neighbor = layer; scene.entityLayers.shared = layer
    scene.aggregateCoordinates!.groups.natural.members = naturalAggregateMembers(scene, ['ground'])
    checked(scene)
    const before = canonicalJson(scene)
    expect(() => applyNaturalAggregateCommand(scene, move)).toThrow(/未随动/)
    expect(canonicalJson(scene)).toBe(before)
    scene.aggregateCoordinates!.groups.natural.members = naturalAggregateMembers(scene, ['ground', 'neighbor'])
    expect(() => apply(scene)).not.toThrow()
  })
  it('moves actual visual sources/materialized geometry/transitions and atomically refuses locked or stale results', () => {
    const scene = simple(), layerId = scene.entityLayers.ground, visual = visualBase(scene)!
    scene.materials.grass = { id: 'grass', catalogId: 'natural.grass', version: 1, name: 'Grass', tags: ['grass'], licenseRef: scene.assets.image.licenseRef,
      origin: cloneJson(scene.assets.image.origin), textureAssetId: 'image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain'] }
    scene.terrainAreas.ground.surfaceStyle = { base: { materialRef: { id: 'grass', version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0,
      alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
    const start = { x: 5000, y: 9000 }, end = { x: 10000, y: 9000 }
    const boundary = { id: 'curve-road', floorId: 'blank-floor', layerId, visibility: 'public' as const, editLocked: false,
      closed: false, segments: [{ id: 'road-cubic', start, control1: { ...start }, control2: { ...end }, end }], sampleSpacingMm: 10000, toleranceMm: 1,
      binding: { kind: 'path' as const, pathId: 'road' } }
    visual.boundaries[boundary.id] = boundary
    scene.paths.road.centerlineMm = sampleVisualBoundary(boundary).points
    getLegacyVisual(scene)!.materializedEdges.detail = { id: 'detail', floorId: 'blank-floor', layerId, visibility: 'public', editLocked: false,
      boundaryId: boundary.id, inputHash: materializedBoundaryHash(boundary), kind: 'path',
      polygons: [[{ x: 6000, y: 9200 }, { x: 7000, y: 9200 }, { x: 7000, y: 9300 }, { x: 6000, y: 9300 }]], strokes: [],
      materialRef: null, fillColor: '#667755', opacity: 1 }
    // A path shoulder uses the actual path surface plus its terrain support.
    scene.visual.transitions.shoulder = materializeTerrainTransition(scene, { id: 'shoulder', layerId, boundaryId: boundary.id, kind: 'pathShoulder', side: 'both', widthMm: 100,
      clipMm: { x: 4000, y: 8000, width: 7000, height: 2000 } })
    checked(scene)
    for (const locked of ['boundary', 'materialized', 'transition', 'layer', 'stale'] as const) {
      const candidate = cloneJson(scene)
      if (locked === 'boundary') visualBase(candidate)!.boundaries[boundary.id].editLocked = true
      if (locked === 'materialized') getLegacyVisual(candidate)!.materializedEdges.detail.editLocked = true
      if (locked === 'transition') candidate.visual.transitions.shoulder.editLocked = true
      if (locked === 'layer') candidate.userLayers[layerId].editLocked = true
      if (locked === 'stale') getLegacyVisual(candidate)!.materializedEdges.detail.inputHash = '0'.repeat(64)
      const before = canonicalJson(candidate)
      expect(() => applyNaturalAggregateCommand(candidate, move), locked).toThrow(/锁定|过期/)
      expect(canonicalJson(candidate), locked).toBe(before)
    }
    const result = apply(scene), nextBoundary = visualBase(result)!.boundaries[boundary.id]
    expect(nextBoundary.segments[0].start).toEqual({ x: 8000, y: 5500 })
    expect(getLegacyVisual(result)!.materializedEdges.detail.polygons[0][0]).toEqual({ x: 7800, y: 6500 })
    expect(getLegacyVisual(result)!.materializedEdges.detail.inputHash).toBe(materializedBoundaryHash(nextBoundary))
    expect(result.visual.transitions.shoulder.distanceSource.clipMm).toEqual({ x: 7000, y: 4500, width: 2000, height: 7000 })
    expect(validateTerrainTransitions(result)).toEqual([])
    expect(result.visual.transitions.shoulder.outputHash).not.toBe(scene.visual.transitions.shoulder.outputHash)
  })
  it('keeps immutable fixed surface sources and instance overrides independent of the transformed terrain', () => {
    const scene = simple(), asset = scene.assets.image
    scene.materials.tile = { id: 'tile', catalogId: 'natural.test', version: 1, name: 'Tile', tags: [], licenseRef: asset.licenseRef, origin: cloneJson(asset.origin),
      textureAssetId: 'image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain'] }
    scene.terrainAreas.ground.surfaceStyle = { base: { materialRef: { id: 'tile', version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0,
      alignment: 'surface', originMm: { x: 4000, y: 4000 }, tint: null, opacity: 1 }, overlays: [] }
    let content = createCompositionContent(scene, runtime)
    content.appearance.instanceAdjustments.ground = [{ id: 'ground-tint', kind: 'tint', enabled: true, value: '#8899AA' }]
    for (const variant of listRequiredVariants(content)) {
      content.appearance.variants[variant.id] = variant
      content.document.assets[variant.outputAssetId] = { ...cloneJson(content.document.assets[variant.sourceAssetId]), id: variant.outputAssetId }
    }
    content = resolveAppearance(content)
    const sourceId = content.appearance.surfaceSources.ground, material = content.document.terrainAreas.ground.surfaceStyle!.base.materialRef
    const result = resolveAppearance(applyCompositionCommands(content, [move], runtime))
    expect(result.historyIdentity).toEqual(content.historyIdentity)
    expect(result.appearance.sources[sourceId]).toEqual(content.appearance.sources[sourceId])
    expect(result.appearance.sources[result.appearance.surfaceSources.ground]).toMatchObject({ kind: 'surface', parentSourceId: sourceId,
      snapshot: { base: { materialRef: { id: 'tile', version: 1 }, tint: null, originMm: { x: 13000, y: 4500 }, rotationDeg: 90 } } })
    expect(result.appearance.instanceAdjustments).toEqual(content.appearance.instanceAdjustments)
    expect(result.document.terrainAreas.ground.surfaceStyle!.base.materialRef).toEqual(material)
  })
  it.each(['forest', 'volcano', 'mixed'] as const)('moves actual %s generation with preserved recipes and valid managed hashes, without seed replay', kind => {
    const fixture = domainExecutionFixture(kind === 'mixed' ? 'forest' : kind), options = { profile: fixture.profile, nowMilliseconds: () => 0 }
    const source = kind === 'forest' ? runForestGeneration(fixture.base, domainExecutionFixture('forest').input, options).candidate.document
      : kind === 'volcano' ? runVolcanoGeneration(fixture.base, domainExecutionFixture('volcano').input, options).candidate.document
      : runMixedGeneration(fixture.base, defaultMixedInput(fixture.base, 'forest', 'natural-mixed'), options).candidate.document
    let scene = cloneJson(source) as SceneDocument
    scene.floors['visual-floor'].boundsMm = { x: 0, y: 0, width: 100000, height: 100000 }; scene.exportBoundsMm = { x: 0, y: 0, width: 100000, height: 100000 }
    if (kind === 'forest') scene = applyCommands(scene, [{ type: 'deleteProp', id: Object.keys(scene.props)[0] }], runtime)
    Object.assign(scene, group(checked(scene)))
    const generation = cloneJson(getLegacyGeneration(scene)!), before = canonicalJson(scene)
    const result = apply(scene, { ...move, pivotMm: { x: 0, y: 0 }, offsetMm: { x: 60000, y: 10000 } })
    expect(getLegacyGeneration(result)!.recipes).toEqual(generation.recipes)
    if (kind === 'forest') {
      expect(Object.values(generation.exclusions).length).toBeGreaterThan(0)
      for (const old of Object.values(generation.exclusions)) expect(getLegacyGeneration(result)!.exclusions[old.id]).toEqual({ ...old,
        boundaryMm: old.boundaryMm.map(point => ({ x: 60000 - point.y, y: 10000 + point.x })) })
    }
    for (const rule of Object.values(getLegacyGeneration(result)!.rules)) expect(rule.managedOutputHash).toBe(managedOutputHash(result, rule))
    for (const collection of ['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'props', 'decorations', 'decorationClusters', 'surfaceRules', 'regions', 'rooms', 'walls', 'openings'] as const) {
      expect(Object.keys(result[collection])).toEqual(Object.keys(scene[collection]))
    }
    if (kind === 'forest' || kind === 'mixed') expect(Object.keys(result.surfaceRules).length).toBeGreaterThan(0)
    if (kind === 'volcano') expect(Object.keys(result.terrainConnections).length).toBeGreaterThan(0)
    if (kind === 'mixed') expect(Object.keys(result.rooms).length).toBeGreaterThan(0)
    expect(canonicalJson(scene)).toBe(before)
  }, 30000)
})
