import type { SceneDocument } from '../../../shared/model/scene.js'
import type { EditableProject } from '../../../application/workspace/project.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { sampleConnectionRoute } from '../../../shared/geometry/connection-route.js'
import { visualBase } from '../../../shared/visual/base.js'
import { REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE } from '../../../shared/visual/island-art.js'
import { THEME_PACK_ART, THEME_PACK_LICENSE } from '../../../shared/visual/theme-pack-art.js'
import { createDetailedIslandDocument } from './detailed-island.js'
import { applyIslandSurfaceTransitionsV2 } from './island-surface-transitions-v2.js'
import { createThemePackSampleDocument, themePackAssetId } from './theme-pack-catalog.js'
import { applyOutpostSurfaceTransitionsV2 } from './outpost-surfaces-v2.js'
import { applyOutpostVegetationV2 } from './outpost-vegetation-v2.js'
import { appendVegetationDetailDefinitions, materializeVegetationDetailScene } from './vegetation-detail-catalog.js'
import { applySampleAtmosphere } from './sample-atmosphere.js'
import type { OutpostVegetationDensity } from './outpost-vegetation.js'
import { materializeVisualArt } from './visual-art-project.js'
import { runtime } from '../runtime.js'

export const NATURAL_DETAIL_ISLAND_NAME = '岬湾苔岛 · 自然岩阶与崖面'
export const NATURAL_DETAIL_OUTPOST_NAME = '林中哨站 · 自然编排'
interface Options { sceneId?: string; now?: string }
const checked = (scene: SceneDocument): SceneDocument => {
  const result = validateSceneDocument(scene)
  if (!result.ok) throw new Error(`自然细节样板无效：${result.errors.map(row => `${row.entityId ?? ''}: ${row.message}`).join('；')}`)
  return result.document
}

/** New saved recipe. The earlier detailed island and its fixed art stay callable. */
export function createNaturalDetailIslandDocument(options: Options = {}): SceneDocument {
  const base = createDetailedIslandDocument({ ...options, sceneId: options.sceneId ?? 'natural-detail-island-layout-1' })
  const scene = applyIslandSurfaceTransitionsV2(base), visual = visualBase(scene)!
  for (const id of ['q1-coast-cliff', 'q1-crown-cliff']) visual.edgeLooks[id].renderProfile = 'rockRelief2'
  const stairs = scene.terrainConnections['q1-stairs'], start = stairs.from.positionMm, end = stairs.to.positionMm
  const controls = { version: 1 as const, kind: 'polyline' as const, segments: [{ id: 'natural-detail-stair-control',
    start: { ...start }, control1: { ...start }, control2: { ...end }, end: { ...end } }],
    sampleSpacingMm: 500, toleranceMm: 20, stairStyle: 'naturalRock' as const, treadDepthMm: 280,
    renderProfile: 'naturalRockSteps2' as const }
  stairs.route = { ...controls, centerlineMm: sampleConnectionRoute(controls) }
  scene.title = NATURAL_DETAIL_ISLAND_NAME
  scene.presetSnapshot = { ...scene.presetSnapshot, presetId: 'sceneweave-natural-detail-island', presetVersion: 1,
    source: '自然细节岩岛布局1：原Q1固定素材与800/2600mm地形、1500mm连接带；显式rockRelief2/naturalRockSteps2及surface-transitions2；静态覆盖与装饰不自动跟随；视觉P3待签收' }
  return checked(scene)
}

/** New construction only: all scatter results, paint and actual fixed assets persist. */
export function createNaturalDetailOutpostDocument(options: Options & { density?: OutpostVegetationDensity } = {}): SceneDocument {
  const density = options.density ?? 'balanced'
  let scene = createThemePackSampleDocument('wilderness', 0, { sceneId: options.sceneId ?? `natural-detail-outpost-layout-1-${density}`,
    now: options.now, outpostVegetation: density })
  scene = appendVegetationDetailDefinitions(scene)
  scene = applyOutpostSurfaceTransitionsV2(scene)
  scene = applyOutpostVegetationV2(scene, density)
  scene = applySampleAtmosphere(scene, 'outpost-daylight')
  scene.title = NATURAL_DETAIL_OUTPOST_NAME
  scene.presetSnapshot = { ...scene.presetSnapshot, presetId: 'sceneweave-natural-detail-outpost', presetVersion: 1,
    source: `自然哨站编排1；固定温带荒野v2与植被细节v1；地表过渡2/植被编排2；密度${density}；保存真实成员与覆盖，非冷开重撒；视觉P3待签收` }
  return checked(scene)
}

export async function createNaturalDetailIslandProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materializeVisualArt(createNaturalDetailIslandDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }),
    REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE, key => `refined-art-${key}`, signal)
}
export async function createNaturalDetailOutpostProject(density: OutpostVegetationDensity = 'balanced', signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materializeVegetationDetailScene(createNaturalDetailOutpostDocument({ density, sceneId: runtime.ids.nextId(), now: runtime.clock.now() }),
    [{ artwork: THEME_PACK_ART.wilderness, licenseText: THEME_PACK_LICENSE, assetId: key => themePackAssetId('wilderness', key) }], signal)
}
