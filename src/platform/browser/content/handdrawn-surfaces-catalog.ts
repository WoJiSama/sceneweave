import type { EditableProject } from '../../../application/workspace/project.js'
import { geometryIdentityIds } from '../../../shared/commands/domain.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { HANDDRAWN_SURFACE_ART, HANDDRAWN_SURFACE_LICENSE, HANDDRAWN_SURFACE_LICENSE_REF,
  handdrawnSurfaceAssetId, handdrawnSurfaceDefinitionId } from '../../../shared/visual/handdrawn-surfaces.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { runtime } from '../runtime.js'
import { materializeVisualArtBatches, type VisualArtBatch } from './visual-art-project.js'

export { handdrawnSurfaceAssetId, handdrawnSurfaceDefinitionId } from '../../../shared/visual/handdrawn-surfaces.js'

const origin = { kind: 'original' as const,
  attribution: 'Sceneweave 手绘基础材质v1；独立原创SVG及固定毫米平铺尺寸；代码辅助创作，尚待美术与用户签收', canEmbed: true }

export const HANDDRAWN_SURFACES_BATCH: VisualArtBatch = Object.freeze({
  artwork: HANDDRAWN_SURFACE_ART, licenseText: HANDDRAWN_SURFACE_LICENSE, assetId: handdrawnSurfaceAssetId, rasterLongEdgePx: 1024,
})

function checked(input: SceneDocument): SceneDocument {
  const result = validateSceneDocument(input)
  if (!result.ok) throw new Error(`手绘材质目录无效：${result.errors.map(issue => issue.message).join('；')}`)
  return result.document
}

/** New construction only. Existing projects use ordinary catalog adoption. */
export function appendHanddrawnSurfaceDefinitions(input: SceneDocument): SceneDocument {
  const source = checked(input), scene = cloneJson(source), occupied = geometryIdentityIds(source)
  for (const art of HANDDRAWN_SURFACE_ART) {
    if (art.kind !== 'material') throw new Error('手绘基础材质目录只接受材质来源。')
    for (const id of [handdrawnSurfaceAssetId(art.key), handdrawnSurfaceDefinitionId(art.key)]) {
      if (occupied.has(id) || scene.userLayers[id]) throw new Error('手绘材质固定身份已存在，不覆盖旧源或其他记录。')
      occupied.add(id)
    }
  }
  for (const art of HANDDRAWN_SURFACE_ART) {
    const assetId = handdrawnSurfaceAssetId(art.key), id = handdrawnSurfaceDefinitionId(art.key)
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 1024, pixelHeight: 1024,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: HANDDRAWN_SURFACE_LICENSE_REF, origin: cloneJson(origin) }
    scene.materials[id] = { id, catalogId: `material.sceneweave.handdrawn-surfaces.${art.key}`, version: 1,
      name: art.name, tags: [...(art.tags ?? [])], licenseRef: HANDDRAWN_SURFACE_LICENSE_REF, origin: cloneJson(origin),
      textureAssetId: assetId, defaultTileSizeMm: { width: art.widthMm, height: art.heightMm },
      applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
  }
  return checked(scene)
}

/** Metadata placeholders become actual PNG, SVG and licence records when materialized. */
export function createHanddrawnSurfacesCatalogDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const now = options.now ?? '2026-11-11T00:00:00.000Z', floorId = 'handdrawn-surfaces-floor', layerId = 'handdrawn-surfaces-layer'
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  return appendHanddrawnSurfaceDefinitions(toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1,
    sceneId: options.sceneId ?? 'handdrawn-surfaces-v1-catalog', revision: 0, title: '手绘基础材质 · 四种独立固定来源', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '目录空白地面', boundsMm: { ...bounds } } },
    userLayers: { [layerId]: { id: layerId, floorId, name: '手绘基础材质', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'sceneweave-handdrawn-surfaces', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] }, visual: emptyVisualSystem() }))
}

/** Demand-loaded material-only catalog with exact source, byte, pixel and licence validation. */
export async function createHanddrawnSurfacesCatalogProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const scene = createHanddrawnSurfacesCatalogDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  return materializeVisualArtBatches(scene, [HANDDRAWN_SURFACES_BATCH], signal)
}
