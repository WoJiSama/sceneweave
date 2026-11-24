import type { SceneDocument, PointMm } from '../../../shared/model/scene.js'
import type { WaterAppearance, WaterSurface } from '../../../shared/ocean/contracts.js'
import { WATER_PRESETS } from '../../../shared/ocean/contracts.js'
import { MARINE_DESIGNS, marineDefinitionId } from '../../../shared/assets/marine-collection.js'
import { transportDefinitionId } from '../../../shared/assets/transport-collection.js'
import { createBasePlacedProp } from '../../../shared/commands/base.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { createSceneCollectionSelectionDocument, materializeSceneCollectionDocument } from './scene-collection-catalog.js'
import { runtime } from '../runtime.js'

import { workspaceSampleNames } from './workspace-samples.js'

export const OCEAN_SAMPLE_NAME = workspaceSampleNames.ocean
const floorId = 'collection-floor', waterLayer = 'collection-structure', propLayer = 'collection-props'

/** Authored static scene. Every ship and creature retains one editable prop. */
export function createOceanDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const scene = createSceneCollectionSelectionDocument([
    ...MARINE_DESIGNS.map(row => marineDefinitionId(row.key)),
    transportDefinitionId('boat-medieval-cutter'), transportDefinitionId('boat-medieval-dinghy'),
  ], { sceneId: options.sceneId ?? 'ocean-sample-v1', now: options.now ?? '2026-11-17T00:00:00.000Z' })
  const bounds = { x: 0, y: 0, width: 40000, height: 30000 }
  scene.title = OCEAN_SAMPLE_NAME
  scene.exportBoundsMm = { ...bounds }
  scene.floors[floorId] = { ...scene.floors[floorId], name: '海面', boundsMm: { ...bounds } }
  scene.userLayers[waterLayer].name = '海水与浪纹'
  scene.userLayers[propLayer].name = '舟船与海洋生物'
  scene.presetSnapshot = { ...scene.presetSnapshot, presetId: 'sceneweave-ocean', presetVersion: 1,
    source: '原创静态海面与浪纹、固定舟船和六种海洋生物；水下深度仅为视觉参数，船内多层地图另行实现' }
  const area = (id: string, points: PointMm[], waterSurface: WaterSurface, priority: number) => {
    scene.terrainAreas[id] = { id, floorId, editLocked: false, visibility: 'public',
      boundaryMm: points.map((positionMm, i) => ({ id: `${id}-p${i}`, segmentId: `${id}-s${i}`, positionMm })),
      coveragePriority: priority, groundElevationMm: 0, surfaceStyle: null, waterSurface,
      blocksMovement: true, blocksSight: false, movementCostMultiplier: 1 }
    scene.entityLayers[id] = waterLayer
  }
  area('ocean-open-water', [{ x: 0, y: 0 }, { x: 14500, y: 0 }, { x: 40000, y: 0 }, { x: 40000, y: 30000 }, { x: 0, y: 30000 }, { x: 0, y: 27000 }],
    { ...WATER_PRESETS.calm, color: '#396F80', clarity: .78, waveSpacingMm: 2100, seed: 'tide-route-open-v1' }, 0)
  area('ocean-shallows', [{ x: 0, y: 0 }, { x: 14500, y: 0 }, { x: 13500, y: 5000 }, { x: 11500, y: 10500 },
    { x: 12500, y: 14500 }, { x: 11000, y: 19000 }, { x: 6000, y: 25000 }, { x: 0, y: 27000 }],
    { ...WATER_PRESETS.shallow, color: '#649C9E', waveSpacingMm: 2500, seed: 'tide-route-shallow-v1' }, 1)
  scene.terrainAreas['ocean-shallows'].boundaryBlendMm = 800
  const context = { ids: { nextId: () => 'unused-ocean-id' }, clock: { now: () => scene.updatedAt } }
  const place = (id: string, definitionId: string, x: number, y: number, rotationDeg: number, supportId: string, waterAppearance: WaterAppearance, visibility: 'public' | 'gm' = 'public') => {
    const prop = createBasePlacedProp(scene, definitionId, { x, y }, context, { id, floorId, rotationDeg, supportRef: { kind: 'terrainArea', id: supportId } })
    scene.props[id] = { ...prop, waterAppearance, visibility }
    scene.entityLayers[id] = propLayer
  }
  place('ocean-cutter', transportDefinitionId('boat-medieval-cutter'), 18000, 13500, 24, 'ocean-open-water', { mode: 'surface' })
  place('ocean-dinghy', transportDefinitionId('boat-medieval-dinghy'), 13500, 20500, 322, 'ocean-open-water', { mode: 'surface' })
  place('ocean-dolphin', marineDefinitionId('dolphin'), 20600, 5700, 55, 'ocean-open-water', { mode: 'surface' })
  place('ocean-shark', marineDefinitionId('reef-shark'), 30300, 8400, 224, 'ocean-open-water', { mode: 'submerged', depth: .35 })
  place('ocean-manta', marineDefinitionId('manta'), 6500, 10500, 25, 'ocean-shallows', { mode: 'submerged', depth: .22 })
  place('ocean-school', marineDefinitionId('silver-school'), 5000, 20500, 335, 'ocean-shallows', { mode: 'submerged', depth: .12 })
  place('ocean-kraken', marineDefinitionId('kraken'), 26500, 18500, 340, 'ocean-open-water', { mode: 'partial', depth: .3, submergedFraction: .5 })
  place('ocean-serpent', marineDefinitionId('sea-serpent'), 34500, 24800, 315, 'ocean-open-water', { mode: 'submerged', depth: .58 })
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`海洋样图无效：${checked.errors.map(row => `${row.entityId ?? ''}:${row.message}`).join('；')}`)
  return checked.document
}

export function createOceanProject(signal?: AbortSignal) {
  signal?.throwIfAborted()
  return materializeSceneCollectionDocument(createOceanDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), [], signal)
}
