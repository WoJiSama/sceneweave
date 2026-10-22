import { describe, expect, it } from 'vitest'
import { validateSceneV2 } from '../v2/schema'
import { inspectDependenciesV3 } from './dependencies'
import { layerIdForEntityV3 } from './layers'
import { validateSceneV3 } from './schema'
import { groupLayerSceneV3, layerSceneV3 } from './test-fixtures'

describe('native strict v3 user layers', () => {
  it('keeps v2 strict and requires native layer fields with no session visibility', () => {
    const scene = layerSceneV3()
    expect(validateSceneV3(scene).ok).toBe(true)
    expect(validateSceneV2(scene).ok).toBe(false)
    expect(validateSceneV3({ ...scene, hiddenLayerIds: [] }).ok).toBe(false)
    expect(validateSceneV3({ ...scene, userLayers: undefined }).ok).toBe(false)
    const layer = Object.values(scene.userLayers)[0]
    expect(validateSceneV3({ ...scene, userLayers: { [layer.id]: { ...layer, visible: false } } }).ok).toBe(false)
  })

  it('rejects absent, extra, unknown and cross-Floor layer membership', () => {
    const scene = layerSceneV3(), layer = Object.values(scene.userLayers)[0]
    for (const entityLayers of [{}, { ...scene.entityLayers, missing: layer.id }, { item: 'missing' }]) expect(validateSceneV3({ ...scene, entityLayers }).ok).toBe(false)
    scene.userLayers[layer.id].floorId = 'other'
    expect(validateSceneV3(scene).ok).toBe(false)
    scene.floors.other = { id: 'other', name: 'Other', boundsMm: { ...scene.exportBoundsMm } }
    expect(validateSceneV3(scene).ok).toBe(false)
  })

  it('requires continuous unique orders, trimmed names and an existing layer on every Floor', () => {
    const scene = layerSceneV3(), layer = Object.values(scene.userLayers)[0]
    expect(validateSceneV3({ ...scene, userLayers: {} }).ok).toBe(false)
    for (const name of ['', ' ', ' layer', 'x'.repeat(81)]) expect(validateSceneV3({ ...scene, userLayers: { [layer.id]: { ...layer, name } } }).ok).toBe(false)
    for (const order of [-1, .5, 1, 128]) expect(validateSceneV3({ ...scene, userLayers: { [layer.id]: { ...layer, order } } }).ok).toBe(false)
    scene.userLayers.second = { ...layer, id: 'second', name: 'Second' }
    expect(validateSceneV3(scene).ok).toBe(false)
  })

  it('rejects 129 layers, identity collisions and map-key mismatch', () => {
    const scene = layerSceneV3(), base = Object.values(scene.userLayers)[0]
    scene.userLayers = Object.fromEntries(Array.from({ length: 129 }, (_, order) => [`layer-${order}`, { ...base, id: `layer-${order}`, order }]))
    scene.entityLayers.item = 'layer-0'
    expect(validateSceneV3(scene).ok).toBe(false)
    const collision = layerSceneV3(); collision.userLayers.item = { ...Object.values(collision.userLayers)[0], id: 'item', order: 1 }
    expect(validateSceneV3(collision).ok).toBe(false)
    const mismatch = layerSceneV3(); Object.values(mismatch.userLayers)[0].id = 'other'
    expect(validateSceneV3(mismatch).ok).toBe(false)
  })

  it('keeps live container members on one layer without mapping deleted records', () => {
    const scene = groupLayerSceneV3(), base = Object.values(scene.userLayers)[0]
    expect(validateSceneV3(scene).ok).toBe(true)
    scene.userLayers.other = { ...base, id: 'other', name: 'Other', order: 1 }
    scene.entityLayers.left = 'other'
    const result = validateSceneV3(scene)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some(issue => issue.code === 'GROUP_LAYER_MISMATCH')).toBe(true)
  })

  it('inherits embedded terrain point membership and still checks complete resource dependencies', () => {
    const scene = layerSceneV3(), layerId = scene.entityLayers.item
    scene.terrainAreas.land = { id: 'land', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      boundaryMm: [{ x: 10000, y: 10000 }, { x: 18000, y: 10000 }, { x: 18000, y: 18000 }, { x: 10000, y: 18000 }].map((positionMm, i) => ({ id: `land-point-${i}`, segmentId: `land-segment-${i}`, positionMm })),
      groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.entityLayers.land = layerId
    expect(validateSceneV3(scene).ok).toBe(true)
    expect(layerIdForEntityV3(scene, 'land-point-0')).toBe(layerId)
    scene.entityLayers['land-point-0'] = layerId
    expect(validateSceneV3(scene).ok).toBe(false)
    delete scene.entityLayers['land-point-0']
    scene.props.item.appearance = { kind: 'image', assetId: 'missing-resource', tint: null, opacity: 1 }
    expect(inspectDependenciesV3(scene).errors.some(issue => issue.code === 'MISSING_ASSET')).toBe(true)
  })
})
