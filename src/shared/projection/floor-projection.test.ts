import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDetailedIslandDocument } from '../../platform/browser/content/detailed-island.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import type { PointMm, PropDefinition, SceneDocument, SurfaceStyle, TerrainArea } from '../model/scene.js'
import { sha256Text } from '../validation/hash.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { visualBase } from '../visual/base.js'
import * as snapshots from '../validation/snapshots.js'
import { projectionAssetConsumers, surfacePresentationEnvelopes } from './presentation-contract.js'
import { assertAllFloorPlayerProjections, projectEditorScene, projectScene } from './projection.js'

const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const aFloor = 'visual-floor', bFloor = 'upper-floor', aLayer = 'visual-layer-ground', bLayer = 'upper-ground'
afterEach(() => vi.restoreAllMocks())
function multiFloorFixture(): SceneDocument {
  const scene = createRefinedBlankDocument('island', { sceneId: 'same-xy-floors', title: '独立两层', widthMm: 24000, heightMm: 18000,
    now: '2026-11-10T00:00:00.000Z', preset: 'narrative' })
  scene.activeStyleThemeRef = null
  const visual = visualBase(scene)!, materials = Object.values(scene.materials).filter(material => material.applicableSurfaces.includes('terrain'))
  const environment = cloneJson(visual.environment)
  scene.floors[aFloor].outputBoundsMm = { x: 0, y: 0, width: 24000, height: 16000 }
  scene.floors[aFloor].environment = { ...environment, ambientColor: '#F0EEE0', ambientOpacity: .12 }
  scene.floors[bFloor] = { id: bFloor, name: '上层', boundsMm: cloneJson(scene.floors[aFloor].boundsMm),
    outputBoundsMm: { x: 1000, y: 1000, width: 22000, height: 15000 }, environment: { ...environment, ambientColor: '#222B40', ambientOpacity: .25, lightDirectionDeg: 25 } }
  scene.userLayers[bLayer] = { ...cloneJson(scene.userLayers[aLayer]), id: bLayer, floorId: bFloor, name: '上层地面' }
  const paint = (index: number): SurfaceStyle => ({ base: { materialRef: { id: materials[index].id, version: materials[index].version }, tileSizeMm: cloneJson(materials[index].defaultTileSizeMm), rotationDeg: 0,
    alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] })
  const area = (id: string, floorId: string, boundary: PointMm[], elevationMm: number, index: number): TerrainArea => ({ id, floorId, editLocked: false, visibility: 'public',
    boundaryMm: boundary.map((positionMm, n) => ({ id: `${id}-point-${n}`, segmentId: `${id}-segment-${n}`, positionMm })), groundElevationMm: elevationMm, coveragePriority: 10,
    surfaceStyle: paint(index), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 })
  for (const [prefix, floorId, layerId, materialIndex] of [['a', aFloor, aLayer, 0], ['b', bFloor, bLayer, 1]] as const) {
    const low = `${prefix}-low`, high = `${prefix}-high`, prop = `${prefix}-prop`, deco = `${prefix}-grass`, cluster = `${prefix}-cluster`
    scene.terrainAreas[low] = area(low, floorId, rect(1000, 1000, 10000, 14000), 1000, materialIndex)
    scene.terrainAreas[high] = area(high, floorId, rect(11000, 1000, 10000, 14000), 3000, materialIndex)
    const material = materials[materialIndex], asset = scene.assets[material.textureAssetId]
    const definition: PropDefinition = { id: `${prefix}-image-definition`, catalogId: `floor.fixture.${prefix}`, version: 1, licenseRef: asset.licenseRef, origin: cloneJson(asset.origin),
      name: '楼层专用图片', tags: ['grass'], defaultAppearance: { kind: 'image', assetId: asset.id, tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -250, y: -250, width: 500, height: 500 },
      defaultFootprintMm: { width: 300, height: 300 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'ground', defaultShadowClass: 'none' }
    scene.propDefinitions[definition.id] = definition
    scene.props[prop] = { id: prop, floorId, editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: 1 }, appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
      positionMm: { x: 7000, y: 3000 }, rotationDeg: 0, footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: true, blocksSight: true,
      supportRef: { kind: 'terrainArea', id: low }, renderLayer: 'object', renderOrder: 0, shadowClass: 'vegetation', shadowOverride: null }
    scene.decorations[deco] = { id: deco, floorId, editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: 1 }, supportRef: { kind: 'terrainArea', id: low },
      positionMm: { x: 7500, y: 4500 }, rotationDeg: 0, scalePpm: 1000000, renderOrder: 1 }
    scene.decorationClusters[cluster] = { id: cluster, floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: low }, boundsMm: { x: 7000, y: 4000, width: 1000, height: 1000 },
      seed: `cluster-${prefix}`, algorithmVersion: 'cluster-v1', palette: [{ key: 'grass', definitionRef: { id: definition.id, version: 1 }, kind: 'decoration', weight: 1 }], maxInstances: 4, spacingMm: 500, clusterRadiusMm: 500, clearanceMm: 100,
      members: { ['a'.repeat(64)]: { kind: 'decoration', entityId: deco, state: 'managed' } } }
    for (const [n, points] of [[1, [{ x: 2500, y: 6000 }, { x: 6000, y: 6000 }]], [2, [{ x: 6000, y: 6000 }, { x: 8500, y: 7000 }]]] as const) {
      const id = `${prefix}-path-${n}`
      scene.paths[id] = { id, floorId, editLocked: false, visibility: 'public', centerlineMm: cloneJson([...points]), widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: low }], surfaceStyle: paint(materialIndex), movementCostMultiplier: 1, renderOrder: n }
      scene.entityLayers[id] = layerId
    }
    const stair = `${prefix}-stairs`
    scene.terrainConnections[stair] = { id: stair, floorId, editLocked: false, visibility: 'public', kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: low }, positionMm: { x: 9500, y: 8000 } },
      to: { surfaceRef: { kind: 'terrainArea', id: high }, positionMm: { x: 12500, y: 8000 } }, widthMm: 1500, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: paint(materialIndex) }
    const room = `${prefix}-room`, roomPoints = rect(14500, 4000, 5000, 5000)
    for (const [n, position] of roomPoints.entries()) {
      const id = `${prefix}-vertex-${n}`, wall = `${prefix}-wall-${n}`
      scene.vertices[id] = { id, floorId, editLocked: false, xMm: position.x, yMm: position.y }
      scene.walls[wall] = { id: wall, floorId, editLocked: false, startVertexId: id, endVertexId: `${prefix}-vertex-${(n + 1) % 4}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
      scene.entityLayers[id] = layerId; scene.entityLayers[wall] = layerId
    }
    scene.rooms[room] = { id: room, floorId, editLocked: false, visibility: 'public', boundaryVertexIds: roomPoints.map((_, n) => `${prefix}-vertex-${n}`), purpose: `${prefix}-purpose`, accessExpectation: 'unspecified',
      supportRef: { kind: 'terrainArea', id: high }, groundElevationMm: 3000, floorStyle: paint(materialIndex) }
    scene.openings[`${prefix}-door`] = { id: `${prefix}-door`, floorId, editLocked: false, wallId: `${prefix}-wall-0`, offsetReferenceVertexId: `${prefix}-vertex-0`, offsetMm: 1500, widthMm: 1400, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
    scene.notes[`${prefix}-label`] = { id: `${prefix}-label`, floorId, editLocked: false, visibility: 'public', kind: 'label', text: `${prefix}-label`, anchor: { type: 'entity', entityKind: 'prop', entityId: prop } }
    scene.regions[`${prefix}-hazard`] = { id: `${prefix}-hazard`, floorId, editLocked: false, visibility: 'public', kind: 'hazard', boundaryMm: rect(2000, 11000, 1000, 1000), blocksMovement: false, movementCostMultiplier: 2 }
    const curve = `${prefix}-curve`, start = { x: 3000, y: 1500 }, end = { x: 8000, y: 1500 }
    visual.boundaries[curve] = { id: curve, floorId, layerId, visibility: 'public', editLocked: false, closed: false, binding: { kind: 'decoration' }, segments: [{ id: `${curve}-segment`, start, control1: start, control2: end, end }], sampleSpacingMm: 400, toleranceMm: 10 }
    visual.edgeLooks[`${prefix}-look`] = { id: `${prefix}-look`, floorId, layerId, visibility: 'public', editLocked: false, boundaryId: curve, kind: 'grass', side: 'left', widthMm: prefix === 'a' ? 100 : 2000, color: '#738350', accentColor: '#BBC28A', opacity: .5, intensity: .5, repeatMm: 300, seed: prefix, enabled: true }
    visual.lights[`${prefix}-light`] = { id: `${prefix}-light`, floorId, layerId, visibility: 'public', editLocked: false, positionMm: { x: 9000, y: 10000 }, radiusMm: 1500, color: '#F4E5C0', intensity: .5, wallOcclusion: true, enabled: true }
    visual.fogs[`${prefix}-fog`] = { id: `${prefix}-fog`, floorId, layerId, visibility: 'public', editLocked: false, boundaryMm: rect(3000, 9000, 3000, 3000), color: '#AABBAA', opacity: .2, directionDeg: 40, scaleMm: 500, seed: prefix, enabled: true }
    visual.filters[`${prefix}-filter`] = { id: `${prefix}-filter`, floorId, layerId, visibility: 'public', editLocked: false, target: { kind: 'scene' }, preset: 'warm', exposure: 1, saturation: 1, contrast: 1, vignette: .1, grain: 0, seed: prefix, enabled: true }
    scene.surfaceRules[`${prefix}-paint`] = { id: `${prefix}-paint`, floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: low }, field: 'material', paintOrder: 1,
      regionsMm: [{ outerMm: rect(3500, 10000, 1000, 1000), holesMm: [] }], paint: cloneJson(paint(materialIndex).base), blendWidthMm: 120 }
    const edgeId = `${prefix}-declared-edge`
    scene.terrainEdges[edgeId] = { id: edgeId, floorId, editLocked: false, visibility: 'public', source: { areaId: low, segmentId: scene.terrainAreas[low].boundaryMm[0].segmentId }, neighborAreaId: null, kind: 'cliff', shoreline: false, blocksMovement: true, blocksSight: true,
      styleOverride: { strokeWidthMm: 10, color: '#556655', bandWidthMm: prefix === 'a' ? 200 : 9000 }, surfaceStyle: null }
    for (const id of [low, high, prop, deco, cluster, stair, room, `${prefix}-door`, `${prefix}-label`, `${prefix}-hazard`, `${prefix}-paint`, edgeId]) scene.entityLayers[id] = layerId
  }
  const secret = area('a-private-area', aFloor, rect(22000, 12000, 500, 500), 1500, 0)
  secret.visibility = 'gm'; secret.coveragePriority = 20; scene.terrainAreas[secret.id] = secret; scene.entityLayers[secret.id] = aLayer
  scene.regions['a-mask'] = { id: 'a-mask', floorId: aFloor, editLocked: false, visibility: 'gm', kind: 'manualMask', boundaryMm: rect(20000, 10000, 4000, 4000), blocksMovement: false, movementCostMultiplier: 1 }; scene.entityLayers['a-mask'] = aLayer
  scene.props['b-private-prop'] = { ...cloneJson(scene.props['b-prop']), id: 'b-private-prop', visibility: 'gm', positionMm: { x: 5000, y: 5000 } }; scene.entityLayers['b-private-prop'] = bLayer
  scene.regions['b-mask'] = { id: 'b-mask', floorId: bFloor, editLocked: false, visibility: 'gm', kind: 'manualMask', boundaryMm: rect(3500, 3500, 3000, 3000), blocksMovement: false, movementCostMultiplier: 1 }; scene.entityLayers['b-mask'] = bLayer
  return scene
}

describe('explicit target Floor projections', () => {
  it('retains the frozen single-Floor complete GM/player projection baselines', () => {
    const scene = createDetailedIslandDocument({ sceneId: 'floor-projection-single-fixed', now: '2026-11-10T00:00:00.000Z' })
    const hashes = (['gm', 'player'] as const).map(audience => [audience, sha256Text(canonicalJson(projectScene(scene, audience)))])
    expect(hashes).toEqual([
      ['gm', 'ddf432dd326951bb9881b1048183e5c2255eb6b7bc4f48f596e0a4e714ff10d9'],
      ['player', 'e14bb0e4629fa0c850bbed563e961041ed346dc20b711858d04d15499e6f5aee'],
    ])
    expect(projectScene(scene, 'gm', undefined, { floorId: Object.keys(scene.floors)[0] })).toEqual({ ...projectScene(scene, 'gm'), floorId: Object.keys(scene.floors)[0] })
  })

  it.each(['gm', 'player'] as const)('projects only the explicitly selected Floor for %s, including resources, masks and scene effects', audience => {
    const scene = multiFloorFixture(), before = canonicalJson(scene), checked = validateSceneDocument(scene)
    expect(checked.ok, checked.ok ? '' : JSON.stringify(checked.errors)).toBe(true)
    const a = projectScene(scene, audience, undefined, { floorId: aFloor }), b = projectScene(scene, audience, undefined, { floorId: bFloor })
    expect(a.floorId).toBe(aFloor); expect(b.floorId).toBe(bFloor)
    expect(a.bounds).toEqual(scene.floors[aFloor].outputBoundsMm); expect(b.bounds).toEqual(scene.floors[bFloor].outputBoundsMm)
    expect(a.visual!.environment).toEqual(scene.floors[aFloor].environment); expect(b.visual!.environment).toEqual(scene.floors[bFloor].environment)
    for (const output of [a, b]) {
      const prefix = output.floorId === aFloor ? 'a' : 'b'
      for (const rows of [output.rooms, output.terrain, output.props, output.decorations ?? [], output.paths, output.connections, output.notes, output.regions]) expect(rows.every(row => row.id.startsWith(`${prefix}-`))).toBe(true)
      expect(output.visual!.edgeLooks.map(row => row.id)).toEqual([`${prefix}-look`])
      expect(output.visual!.lights.map(row => row.id)).toEqual([`${prefix}-light`]); expect(output.visual!.fogs.map(row => row.id)).toEqual([`${prefix}-fog`])
      expect(output.visual!.filters.map(row => row.id)).toEqual([`${prefix}-filter`])
      expect(output.visual!.filters[0].targetBoundsMm).toEqual(output.bounds)
      expect(output.pathJoinGroups).toEqual([[`${prefix}-path-1`, `${prefix}-path-2`]])
      expect(output.pathTerrainJoins?.terrainPaintOrder.every(id => id.startsWith(`${prefix}-`))).toBe(true)
      expect(projectionAssetConsumers(output).complete).toBe(true)
    }
    expect(a.masks).toEqual([scene.regions['a-mask'].boundaryMm]); expect(b.masks).toEqual([scene.regions['b-mask'].boundaryMm])
    expect(a.assetIds).not.toEqual(b.assetIds)
    expect(surfacePresentationEnvelopes(a).every(row => !row.id.startsWith('b-'))).toBe(true)
    expect(canonicalJson(scene)).toBe(before)
  })

  it.each(['gm', 'player'] as const)('keeps %s Floor A output and bitmap consumers invariant when same-XY Floor B content changes', audience => {
    const scene = multiFloorFixture(), before = projectScene(scene, audience, undefined, { floorId: aFloor }), changed = cloneJson(scene), visual = visualBase(changed)!
    changed.floors[bFloor].environment!.exposure = 1.3
    changed.floors[bFloor].outputBoundsMm = { x: 0, y: 0, width: 24000, height: 18000 }
    changed.regions['b-mask'].boundaryMm = rect(0, 0, 24000, 18000)
    changed.props['b-private-prop'].visualBoundsMm = { x: -2000, y: -2000, width: 4000, height: 4000 }
    changed.walls['b-wall-0'].thicknessMm = 600
    changed.terrainEdges['b-declared-edge'].styleOverride!.bandWidthMm = 15000
    changed.decorationClusters['b-cluster'].visibility = 'gm'; changed.decorations['b-grass'].visibility = 'gm'
    visual.edgeLooks['b-look'].widthMm = 2300
    visual.lights['b-light'].radiusMm = 8000; visual.fogs['b-fog'].opacity = .75
    visual.filters['b-filter'].exposure = 1.4
    const checked = validateSceneDocument(changed)
    expect(checked.ok, checked.ok ? '' : JSON.stringify(checked.errors)).toBe(true)
    const after = projectScene(changed, audience, undefined, { floorId: aFloor })
    expect(after).toEqual(before)
    expect(projectionAssetConsumers(after)).toEqual(projectionAssetConsumers(before))
    expect(surfacePresentationEnvelopes(after)).toEqual(surfacePresentationEnvelopes(before))
  })

  it('keeps editor layer hiding local to its selected Floor and requires an explicit target for every multi-Floor entry', () => {
    const scene = multiFloorFixture()
    expect(() => projectScene(scene, 'gm')).toThrow(/目标Floor/)
    expect(() => projectEditorScene(scene)).toThrow(/目标Floor/)
    expect(() => projectScene(scene, 'gm', undefined, { floorId: 'absent' })).toThrow(/现存目标Floor/)
    const ordinary = projectScene(scene, 'gm', undefined, { floorId: aFloor })
    expect(projectEditorScene(scene, { floorId: aFloor, hiddenLayerIds: new Set([bLayer]) })).toEqual(ordinary)
    const hidden = projectEditorScene(scene, { floorId: aFloor, hiddenLayerIds: new Set([aLayer]) })
    expect(hidden.terrain).toEqual([]); expect(hidden.props).toEqual([]); expect(hidden.visual!.lights).toEqual([])
    expect(projectScene(scene, 'gm', undefined, { floorId: aFloor })).toEqual(ordinary)
  })

  it('validates all Floors before projecting one and rejects missing per-Floor output ranges', () => {
    const missing = multiFloorFixture(); delete missing.floors[bFloor].outputBoundsMm
    expect(() => projectScene(missing, 'gm', undefined, { floorId: aFloor })).toThrow(/输出范围/)
    const invalid = multiFloorFixture(); delete invalid.vertices['b-vertex-0']
    expect(() => projectScene(invalid, 'gm', undefined, { floorId: aFloor })).toThrow(/不能绘制/)
    expect(() => assertAllFloorPlayerProjections(invalid)).toThrow(/不能绘制/)
  })

  it('checks every player Floor after one full-scene validation and never borrows another Floor mask for secrets', () => {
    const scene = multiFloorFixture(), check = vi.spyOn(snapshots, 'validateSceneSnapshot')
    assertAllFloorPlayerProjections(scene)
    expect(check).toHaveBeenCalledTimes(1)
    const unsafe = cloneJson(scene); delete unsafe.regions['b-mask']; delete unsafe.entityLayers['b-mask']
    unsafe.regions['a-extra-mask'] = { ...cloneJson(scene.regions['b-mask']), id: 'a-extra-mask', floorId: aFloor }; unsafe.entityLayers['a-extra-mask'] = aLayer
    expect(() => projectScene(unsafe, 'player', undefined, { floorId: aFloor })).not.toThrow()
    expect(() => projectScene(unsafe, 'player', undefined, { floorId: bFloor })).toThrow(/固定遮罩/)
    expect(() => assertAllFloorPlayerProjections(unsafe)).toThrow(/固定遮罩/)
  })
})
