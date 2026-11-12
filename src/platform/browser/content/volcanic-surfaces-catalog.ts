import type { EditableProject } from '../../../application/workspace/project.js'
import { geometryIdentityIds } from '../../../shared/commands/domain.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { VOLCANIC_SURFACE_ART, VOLCANIC_SURFACE_LICENSE, VOLCANIC_SURFACE_LICENSE_REF,
  volcanicSurfaceAssetId, volcanicSurfaceDefinitionId } from '../../../shared/visual/volcanic-surfaces.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { runtime } from '../runtime.js'
import { materializeVisualArtBatches, type VisualArtBatch } from './visual-art-project.js'

export { volcanicSurfaceAssetId, volcanicSurfaceDefinitionId } from '../../../shared/visual/volcanic-surfaces.js'
const origin = { kind: 'original' as const,
  attribution: 'Sceneweave 火山材质v1；独立原创SVG与真实毫米平铺尺寸；代码辅助创作，尚待用户美术签收', canEmbed: true }
export const VOLCANIC_SURFACES_BATCH: VisualArtBatch = Object.freeze({ artwork: VOLCANIC_SURFACE_ART,
  licenseText: VOLCANIC_SURFACE_LICENSE, assetId: volcanicSurfaceAssetId, rasterLongEdgePx: 1024 })

function checked(input: SceneDocument): SceneDocument {
  const result = validateSceneDocument(input)
  if (!result.ok) throw new Error(`火山材质目录无效：${result.errors.map(issue => issue.message).join('；')}`)
  return result.document
}
/** New construction only; ordinary library adoption handles existing projects. */
export function appendVolcanicSurfaceDefinitions(input: SceneDocument): SceneDocument {
  const source = checked(input), scene = cloneJson(source), occupied = geometryIdentityIds(source)
  for (const art of VOLCANIC_SURFACE_ART) {
    if (art.kind !== 'material') throw new Error('火山材质目录只接受材质来源。')
    for (const id of [volcanicSurfaceAssetId(art.key), volcanicSurfaceDefinitionId(art.key)]) {
      if (occupied.has(id) || scene.userLayers[id]) throw new Error('火山材质固定身份已存在，不覆盖旧源或其他记录。')
      occupied.add(id)
    }
  }
  for (const art of VOLCANIC_SURFACE_ART) {
    const assetId = volcanicSurfaceAssetId(art.key), id = volcanicSurfaceDefinitionId(art.key)
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 1024, pixelHeight: 1024,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: VOLCANIC_SURFACE_LICENSE_REF, origin: cloneJson(origin) }
    scene.materials[id] = { id, catalogId: `material.sceneweave.volcanic-surfaces.${art.key}`, version: 1, name: art.name,
      tags: [...(art.tags ?? [])], licenseRef: VOLCANIC_SURFACE_LICENSE_REF, origin: cloneJson(origin), textureAssetId: assetId,
      defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, applicableSurfaces: ['terrain', 'path'] }
  }
  return checked(scene)
}
export function createVolcanicSurfacesCatalogDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const now = options.now ?? '2026-11-12T00:00:00.000Z', floorId = 'volcanic-surfaces-floor', layerId = 'volcanic-surfaces-layer'
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  return appendVolcanicSurfaceDefinitions(toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1,
    sceneId: options.sceneId ?? 'volcanic-surfaces-v1-catalog', revision: 0, title: '火山材质 · 五种独立固定来源', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '目录空白地面', boundsMm: { ...bounds } } },
    userLayers: { [layerId]: { id: layerId, floorId, name: '独立火山材质', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'sceneweave-volcanic-surfaces', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] }, visual: emptyVisualSystem() }))
}
export async function createVolcanicSurfacesCatalogProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const scene = createVolcanicSurfacesCatalogDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  return materializeVisualArtBatches(scene, [VOLCANIC_SURFACES_BATCH], signal)
}
