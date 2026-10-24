import { describe, expect, it } from 'vitest'
import { createStudyDocument } from '../editor/v2/study-sample'
import { createIslandDocument } from '../editor/v2/island-sample'
import { scatterFixtureV2, terrainFixtureV2 } from '../core/v2/b3.test-helpers'
import { validateGeometryV2, openingEndpointsV2, pathPolygonV2, propFootprintV2 } from '../core/v2/geometry'
import { sampleScatterCellV1 as legacyScatterCell, buildScatterRegenerationV2 } from '../core/v2/scatter'
import { checkTerrainTravelV2 } from '../core/v2/terrain-travel'
import { geometryDocumentForValidationV3 } from '../core/v3/domain'
import { inspectDependenciesV3 } from '../core/v3/dependencies'
import { migrateSceneV2 } from '../core/v3/migration'
import { validateSceneV3 } from '../core/v3/schema'
import { groupLayerSceneV3, layerSceneV3, scatterLayerSceneV3, STAMP_V3 } from '../core/v3/test-fixtures'
import type { SceneDocumentV3 } from '../core/v3/types'
import { projectSceneV3, projectEditorSceneV3 } from '../render/v3/projection'
import type { SceneDocument } from './model/scene'
import { inspectDependencies } from './commands/dependencies'
import { geometryDocumentForValidation } from './commands/domain'
import { openingEndpoints, pathPolygon, propFootprint, validateGeometry } from './geometry/geometry'
import { sampleScatterCellV1, buildScatterRegeneration } from './geometry/scatter'
import { checkTerrainTravel } from './geometry/terrain-travel'
import { projectScene, projectEditorScene } from './projection/projection'
import { validateSceneDocument } from './validation/scene'
import { isCertifiedSceneSnapshot, reviseSceneSnapshot, validateSceneSnapshot } from './validation/snapshots'

/** A test-only discriminator adapter; this is deliberately not a production converter. */
function native(legacy: SceneDocumentV3): SceneDocument {
  return { ...structuredClone(legacy), format: 'sceneweave-scene', schemaVersion: 1 }
}
const layers = (scene: Parameters<typeof migrateSceneV2>[0]) => migrateSceneV2(scene, { sceneId: 'shared-equivalence', now: STAMP_V3 })
function sceneErrors(input: unknown): string[] {
  const result = validateSceneDocument(input)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.errors.map(issue => issue.code)
}

describe('native complete-v1 scene rules and legacy equivalence', () => {
  it('preserves strict parsed fields, complete resource dependencies and geometry on indoor, outdoor and grouped fixtures', () => {
    for (const legacy of [layers(createStudyDocument()), layers(createIslandDocument()), groupLayerSceneV3()]) {
      const source = native(legacy), old = validateSceneV3(legacy), checked = validateSceneDocument(source)
      expect(old.ok).toBe(true); expect(checked.ok).toBe(true)
      if (!old.ok || !checked.ok) throw new Error('Representative source fixture must remain valid')
      expect(checked.document).toEqual({ ...old.document, format: 'sceneweave-scene', schemaVersion: 1 })
      expect(checked.warnings).toEqual(old.warnings)
      expect(inspectDependencies(checked.document)).toEqual(inspectDependenciesV3(legacy))
      expect(validateGeometry(checked.document)).toEqual(validateGeometryV2(geometryDocumentForValidationV3(legacy)))
      expect(legacy.format).toBe('sceneweave'); expect(legacy.schemaVersion).toBe(3)
    }
  })

  it('dispatches by the new discriminator and rejects unknown persisted or session-only fields', () => {
    const source = native(layerSceneV3()), layer = Object.values(source.userLayers)[0]
    expect(validateSceneDocument(layerSceneV3()).ok).toBe(false)
    expect(validateSceneDocument({ ...source, format: 'sceneweave', schemaVersion: 1 }).ok).toBe(false)
    expect(validateSceneDocument({ ...source, schemaVersion: 2 }).ok).toBe(false)
    expect(validateSceneDocument({ ...source, hiddenLayerIds: [] }).ok).toBe(false)
    expect(validateSceneDocument({ ...source, userLayers: { [layer.id]: { ...layer, visible: false } } }).ok).toBe(false)
    expect(validateSceneV3(source).ok).toBe(false)
  })

  it('rejects accessors and non-JSON input without executing a supplied getter', () => {
    let reads = 0
    const accessor = native(layerSceneV3())
    Object.defineProperty(accessor, 'title', { enumerable: true, get: () => { reads++; throw new Error('caller getter executed') } })
    expect(validateSceneDocument(accessor).ok).toBe(false)
    expect(reads).toBe(0)
    for (const value of [new Date(STAMP_V3), 1n, () => 'not JSON', Number.NaN, undefined]) {
      expect(sceneErrors({ ...native(layerSceneV3()), unknown: value })).toContain('NON_JSON_INPUT')
    }
    const symbol = native(layerSceneV3())
    Object.defineProperty(symbol, Symbol('hidden'), { enumerable: true, value: 'secret' })
    expect(sceneErrors(symbol)).toContain('UNSAFE_KEY')
    const unsafe = native(layerSceneV3())
    Object.defineProperty(unsafe.props, '__proto__', { enumerable: true, value: unsafe.props.item })
    expect(sceneErrors(unsafe)).toContain('UNSAFE_KEY')
  })

  it('retains layer membership, group-layer and embedded identity invariants', () => {
    const missing = native(layerSceneV3()); delete missing.entityLayers.item
    expect(sceneErrors(missing)).toContain('MISSING_LAYER_MEMBERSHIP')
    const grouped = groupLayerSceneV3(), base = Object.values(grouped.userLayers)[0]
    grouped.userLayers.other = { ...base, id: 'other', name: 'Other', order: 1 }
    grouped.entityLayers.left = 'other'
    expect(inspectDependencies(native(grouped))).toEqual(inspectDependenciesV3(grouped))
    expect(sceneErrors(native(grouped))).toContain('GROUP_LAYER_MISMATCH')
    const terrain = native(scatterLayerSceneV3(0))
    terrain.entityLayers['domain-point-0'] = terrain.entityLayers.domain
    expect(sceneErrors(terrain)).toContain('UNKNOWN_LAYER_MEMBER')
  })

  it('checks actual rotated footprint support rather than its centre, layer or declared floor alone', () => {
    const source = native(scatterLayerSceneV3(0)), prop = source.props.item
    prop.positionMm = { x: 1050, y: 4000 }; prop.rotationDeg = 45
    prop.footprintMm = { width: 300, height: 300 }
    expect(sceneErrors(source)).toContain('PROP_SUPPORT')
    prop.positionMm.x = 4000
    expect(validateSceneDocument(source).ok).toBe(true)
    prop.supportRef = { kind: 'floor', id: prop.floorId }
    expect(sceneErrors(source)).toContain('PROP_SUPPORT')
    source.userLayers[source.entityLayers.item].editLocked = true
    expect(sceneErrors(source)).toContain('PROP_SUPPORT')
  })

  it('preserves stable opening endpoints, real footprint offsets and square-cap path bands', () => {
    const legacy = layers(createStudyDocument()), source = native(legacy)
    for (const opening of Object.values(legacy.openings)) expect(openingEndpoints(source, source.openings[opening.id])).toEqual(openingEndpointsV2(legacy, opening))
    const oldProp = Object.values(legacy.props)[0]
    oldProp.rotationDeg = 37; oldProp.footprintOffsetMm = { x: 123, y: -79 }
    expect(propFootprint(native(legacy).props[oldProp.id])).toEqual(propFootprintV2(oldProp))
    const path = { id: 'path-band', floorId: Object.keys(source.floors)[0], editLocked: false, visibility: 'public' as const,
      centerlineMm: [{ x: 1000, y: 1000 }, { x: 3000, y: 1000 }, { x: 3100, y: 3000 }], widthMm: 400,
      supportRefs: [{ kind: 'floor' as const, id: Object.keys(source.floors)[0] }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    const polygon = pathPolygon(path)
    expect(polygon).toEqual(pathPolygonV2(path))
    expect(Math.min(...polygon.map(point => point.x))).toBe(800)
  })

  it('retains full-width current terrain travel and refuses a visually plausible blocked crossing', () => {
    const legacy = terrainFixtureV2(), source = native(layers(legacy))
    const route = { floorId: 'f-a1', from: { x: 6500, y: 10000 }, to: { x: 13500, y: 10000 }, widthMm: 2000 }
    expect(checkTerrainTravel(source, route)).toEqual(checkTerrainTravelV2(legacy, route))
    expect(checkTerrainTravel(source, route).ok).toBe(true)
    for (const request of [{ ...route, widthMm: 2001 }, { ...route, from: { x: 8000, y: 5000 }, to: { x: 12000, y: 5000 }, widthMm: 500 }]) {
      expect(checkTerrainTravel(source, request)).toEqual(checkTerrainTravelV2(legacy, request))
      expect(checkTerrainTravel(source, request).ok).toBe(false)
    }
    source.terrainConnections['island-stairs'].blocksMovement = true
    legacy.terrainConnections['island-stairs'].blocksMovement = true
    expect(checkTerrainTravel(source, route)).toEqual(checkTerrainTravelV2(legacy, route))
    expect(checkTerrainTravel(source, route).ok).toBe(false)
  })

  it('preserves scatter streams, UTF-8 stable keys, adopted results and permanent deletion records', () => {
    const legacy = scatterFixtureV2(), source = native(layers(legacy)), oldGroup = legacy.scatterGroups.trees
    const cell = legacyScatterCell(oldGroup, 2, -1)
    expect(sampleScatterCellV1(source.scatterGroups.trees, 2, -1)).toEqual(cell)
    const deletion = { propId: null, state: 'deleted' as const, overrideFields: [] }
    legacy.scatterGroups.trees.members[cell.candidateKey] = structuredClone(deletion)
    source.scatterGroups.trees.members[cell.candidateKey] = structuredClone(deletion)
    const exclusion = { id: 'deleted-cell', boundaryMm: [{ x: 1000, y: 1000 }, { x: 1200, y: 1000 }, { x: 1200, y: 1200 }, { x: 1000, y: 1200 }], reason: 'delete' as const, sourceCandidateKey: cell.candidateKey }
    legacy.scatterGroups.trees.exclusions.push(structuredClone(exclusion)); source.scatterGroups.trees.exclusions.push(structuredClone(exclusion))
    const regenerated = buildScatterRegeneration(source, 'trees')
    expect(regenerated).toEqual(buildScatterRegenerationV2(legacy, 'trees'))
    expect(regenerated.props.length).toBeGreaterThan(0)
    expect(regenerated.group.members[cell.candidateKey]).toEqual(deletion)
  })

  it('preserves complete GM and player projections for representative indoor and elevated outdoor scenes', () => {
    for (const legacy of [layers(createStudyDocument()), layers(createIslandDocument())]) {
      const source = native(legacy), before = structuredClone(source)
      for (const audience of ['gm', 'player'] as const) expect(projectScene(source, audience)).toEqual(projectSceneV3(legacy, audience))
      expect(source).toEqual(before)
    }
  })

  it('filters private group members and anchored notes, while keeping editor hiding separate from published audiences', () => {
    const legacy = groupLayerSceneV3(), base = Object.keys(legacy.userLayers)[0]
    legacy.regions.mask = { id: 'mask', floorId: 'blank-floor', editLocked: false,
      boundaryMm: [{ x: 5000, y: 3000 }, { x: 9000, y: 3000 }, { x: 9000, y: 5000 }, { x: 5000, y: 5000 }],
      kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1, visibility: 'gm' }
    legacy.entityLayers.mask = base
    legacy.notes.secret = { id: 'secret', floorId: 'blank-floor', editLocked: false,
      anchor: { type: 'entity', entityKind: 'prefabInstance', entityId: 'group' }, kind: 'label', text: 'PRIVATE-GROUP-NOTE', visibility: 'public' }
    legacy.entityLayers.secret = base
    const source = native(legacy), player = projectScene(source, 'player'), hiddenLayerIds = new Set([base])
    expect(player).toEqual(projectSceneV3(legacy, 'player'))
    expect(player.props.map(prop => prop.id)).toEqual(['item'])
    expect(JSON.stringify(player)).not.toContain('PRIVATE-GROUP-NOTE')
    expect(projectScene(source, 'gm').props).toHaveLength(3)
    expect(projectEditorScene(source, { hiddenLayerIds })).toEqual(projectEditorSceneV3(legacy, { hiddenLayerIds }))
    expect(projectEditorScene(source, { hiddenLayerIds }).props).toEqual([])
    expect(projectScene(source, 'player')).toEqual(player)
  })

  it('certifies only independently parsed frozen output and revalidates shallow-frozen caller mutations', () => {
    const input = native(layerSceneV3()); Object.freeze(input)
    const first = validateSceneSnapshot(input)
    if (!first.ok) throw new Error(JSON.stringify(first.errors))
    expect(isCertifiedSceneSnapshot(input)).toBe(false)
    expect(isCertifiedSceneSnapshot(first.document)).toBe(true)
    expect(Object.isFrozen(first.document.props.item.positionMm)).toBe(true)
    expect(validateSceneSnapshot(first.document)).toBe(first)
    input.props.item.positionMm.x = 7000
    const second = validateSceneSnapshot(input)
    if (!second.ok) throw new Error(JSON.stringify(second.errors))
    expect(second.document.props.item.positionMm.x).toBe(7000)
    expect(first.document.props.item.positionMm.x).toBe(4000)
    input.props.item.supportRef = { kind: 'floor', id: 'missing' }
    expect(validateSceneSnapshot(input).ok).toBe(false)
    expect(validateSceneSnapshot(first.document)).toBe(first)
  })

  it('keeps the native format and layers in effective-lock views and shares only certified content on revision changes', () => {
    const source = native(layerSceneV3()), layerId = source.entityLayers.item
    source.userLayers[layerId].editLocked = true
    const checked = validateSceneSnapshot(source)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    const effective = geometryDocumentForValidation(checked.document, true)
    expect(effective.format).toBe('sceneweave-scene'); expect(effective.schemaVersion).toBe(1)
    expect(effective.userLayers).toBe(checked.document.userLayers)
    expect(effective.entityLayers).toBe(checked.document.entityLayers)
    expect(effective.props.item.editLocked).toBe(true); expect(checked.document.props.item.editLocked).toBe(false)
    const revised = reviseSceneSnapshot(checked.document, 1, STAMP_V3)
    expect(revised.revision).toBe(1); expect(checked.document.revision).toBe(0)
    expect(revised.props).toBe(checked.document.props); expect(revised.userLayers).toBe(checked.document.userLayers)
    expect(isCertifiedSceneSnapshot(revised)).toBe(true)
    expect(() => reviseSceneSnapshot(checked.document, Number.MAX_SAFE_INTEGER + 1, STAMP_V3)).toThrow(/安全整数/)
    expect(() => reviseSceneSnapshot(checked.document, 1, 'invalid')).toThrow()
  })
})
