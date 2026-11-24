import type { SceneDocument } from '../../../shared/model/scene.js'
import { createOceanDocument } from './ocean-sample.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { materializeSceneCollectionDocument } from './scene-collection-catalog.js'
import { WATER_PRESETS } from '../../../shared/ocean/contracts.js'
import { runtime } from '../runtime.js'

import { workspaceSampleNames } from './workspace-samples.js'

export const OPEN_OCEAN_NAME = workspaceSampleNames.openOcean

/** An authored open-water encounter. Original fixed creature/boat dimensions
 * are retained; each remains a normal independently editable supported prop. */
export function createOpenOceanDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const scene = createOceanDocument(options), floorId = 'collection-floor'
  scene.title = OPEN_OCEAN_NAME
  const bounds = { x: 0, y: 0, width: 60000, height: 45000 }
  scene.exportBoundsMm = { ...bounds }; scene.floors[floorId] = { ...scene.floors[floorId], boundsMm: { ...bounds }, outputBoundsMm: { ...bounds } }
  delete scene.terrainAreas['ocean-shallows']; delete scene.entityLayers['ocean-shallows']
  const water = scene.terrainAreas['ocean-open-water']
  water.boundaryMm = [{ x: 0, y: 0 }, { x: 60000, y: 0 }, { x: 60000, y: 45000 }, { x: 0, y: 45000 }]
    .map((positionMm, i) => ({ id: `${water.id}-p${i}`, segmentId: `${water.id}-s${i}`, positionMm }))
  water.waterSurface = { ...WATER_PRESETS.rough, color: '#315F73', clarity: .82, waveSpacingMm: 2800, waveStrength: .46, seed: 'open-ocean-encounter1' }
  const positions: Record<string, [number, number, number]> = {
    'ocean-cutter': [27000, 22500, 20], 'ocean-dinghy': [23000, 31500, 335],
    'ocean-kraken': [38000, 24500, 350], 'ocean-serpent': [46000, 35000, 325],
    'ocean-shark': [43000, 11000, 240], 'ocean-dolphin': [28000, 10500, 35],
    'ocean-manta': [13000, 21000, 65], 'ocean-school': [16000, 33000, 25],
  }
  for (const prop of Object.values(scene.props)) {
    const [x, y, rotation] = positions[prop.id]; prop.positionMm = { x, y }; prop.rotationDeg = rotation
    prop.supportRef = { kind: 'terrainArea', id: water.id }
    if (prop.waterAppearance?.mode === 'surface') prop.waterAppearance.surfaceEffects = { ripples: .7, wakeLengthMm: prop.id === 'ocean-cutter' ? 4800 : 1600 }
  }
  scene.props['ocean-kraken'].waterAppearance = { mode: 'partial', depth: .2, submergedFraction: .48, surfaceEffects: { ripples: .85, wakeLengthMm: 0 } }
  scene.props['ocean-serpent'].waterAppearance = { mode: 'submerged', depth: .32 }
  scene.presetSnapshot = { ...scene.presetSnapshot, presetId: 'sceneweave-open-ocean', presetVersion: 1,
    source: '60×45米静态远洋遭遇；两舟六生物保持固定原毫米，巨怪与船体完整入水域；水线与尾流不授予航行或战斗模拟' }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`远洋遭遇无效：${checked.errors.map(row => `${row.entityId ?? ''}:${row.message}`).join('；')}`)
  return checked.document
}
export function createOpenOceanProject(signal?: AbortSignal) {
  signal?.throwIfAborted()
  return materializeSceneCollectionDocument(createOpenOceanDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), [], signal)
}
