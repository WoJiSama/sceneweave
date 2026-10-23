import type { MaterialPaint, PointMm, PropV2, SceneDocumentV3, SurfaceRef, SurfaceStyle, TerrainArea } from '../../core/v3/types'
import { LAYER_ENTITY_COLLECTIONS_V3 } from '../../core/v3/types'
import { createCompositionContentV6 } from '../../core/v6/graph'
import { loadBuiltinCatalogV1 } from '../../catalog/builtin'
import { assertFixedCompositionCompatibleV6, validateCompleteProjectV6 } from '../../io/v6/project-file'
import type { CompleteProjectV6 } from '../../io/v6/types'
import { createOutdoorBlankDocument } from './blank-project'
import { outpostPropTemplate } from './outpost-catalog'
import { THEMED_CATALOG, contentMaterialDefinition, contentPropDefinition } from './themed-catalog'

export type ThemedSampleKind = 'graveyard' | 'volcano'
export const THEMED_SAMPLE_BOUNDS = { x: 0, y: 0, width: 20_000, height: 16_000 } as const
const points = (pairs: number[][]): PointMm[] => pairs.map(([x, y]) => ({ x, y }))
const rectangle = (x: number, y: number, right: number, bottom: number) => points([[x, y], [right, y], [right, bottom], [x, bottom]])
const fixedRef = (id: string) => ({ id, version: 1 })
const catalogs = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const

/** Initial, editable content samples. This is not the M1-D from-blank authoring evidence. */
export function createThemedSampleDocument(kind: ThemedSampleKind, provider: CompleteProjectV6,
  options: { sceneId?: string; now?: string } = {}): SceneDocumentV3 {
  const scene = createOutdoorBlankDocument({ title: kind === 'graveyard' ? '苔石墓园 · 内容小样' : '灰烬熔脉 · 内容小样',
    widthMm: THEMED_SAMPLE_BOUNDS.width, heightMm: THEMED_SAMPLE_BOUNDS.height, preset: 'investigation', ...options })
  for (const collection of catalogs) Object.assign(scene[collection], structuredClone(provider.document[collection]))
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  scene.floors[floorId].name = kind === 'graveyard' ? '苔石墓园' : '灰烬熔脉'
  scene.userLayers[layerId].name = '题材小构图'
  const paint = (key: string): MaterialPaint => {
    const definition = contentMaterialDefinition(scene, key)
    return { materialRef: fixedRef(definition.id), tileSizeMm: { ...definition.defaultTileSizeMm }, rotationDeg: 0,
      alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }
  }
  const style = (key: string): SurfaceStyle => ({ base: paint(key), overlays: [] })
  const area = (id: string, boundary: PointMm[], key: string, elevation = 0, priority = 0): TerrainArea => {
    const value: TerrainArea = { id, floorId, editLocked: false, visibility: 'public',
      boundaryMm: boundary.map((positionMm, index) => ({ id: `${id}-v${index}`, segmentId: `${id}-s${index}`, positionMm })),
      groundElevationMm: elevation, coveragePriority: priority, surfaceStyle: style(key), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.terrainAreas[id] = value; return value
  }
  const place = (id: string, key: string, positionMm: PointMm, support: string, rotationDeg = 0) => {
    const definition = contentPropDefinition(scene, key)
    const value: PropV2 = { ...outpostPropTemplate(definition, positionMm.x, positionMm.y, rotationDeg), id, floorId,
      editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: support } }
    scene.props[id] = value
  }
  const group = (id: string, definitionId: string, anchorMm: PointMm, support: string) => {
    const definition = scene.prefabDefinitions[definitionId], visibility = provider.appearance.prefabAppearanceTemplates[definitionId].visibility
    const supportRef: SurfaceRef = { kind: 'terrainArea', id: support }
    scene.prefabInstances[id] = { id, floorId, editLocked: false, visibility, definitionRef: fixedRef(definitionId), anchorMm,
      rotationDeg: 0, members: {} }
    for (const member of definition.members) {
      const propId = `${id}-${member.key}`
      scene.props[propId] = { ...structuredClone(member.propTemplate), id: propId, floorId, editLocked: false, visibility,
        supportRef, positionMm: { x: anchorMm.x + member.propTemplate.positionMm.x, y: anchorMm.y + member.propTemplate.positionMm.y } }
      scene.prefabInstances[id].members[member.key] = { propId, overrideFields: [] }
    }
  }
  const label = (id: string, positionMm: PointMm, text: string, visibility: 'gm' | 'public' = 'public') => {
    scene.notes[id] = { id, floorId, editLocked: false, anchor: { type: 'point', positionMm }, kind: visibility === 'gm' ? 'clue' : 'label', text, visibility }
  }
  if (kind === 'graveyard') {
    area('graveyard-earth', rectangle(0, 0, 20_000, 16_000), 'grave-soil')
    scene.paths['graveyard-walk'] = { id: 'graveyard-walk', floorId, editLocked: false, visibility: 'public',
      centerlineMm: points([[10_000, 2000], [10_000, 14_000]]), widthMm: 1800, supportRefs: [{ kind: 'terrainArea', id: 'graveyard-earth' }],
      surfaceStyle: style('moss-paver'), movementCostMultiplier: 1, renderOrder: 0 }
    for (const [index, x, y] of [[1, 5000, 6000], [2, 15_000, 6000], [3, 5000, 10_500], [4, 15_000, 10_500]]) {
      group(`graveyard-memorial-${index}`, THEMED_CATALOG.prefabs.graveyard, { x, y }, 'graveyard-earth')
    }
    for (const x of [3000, 5000, 7000, 13_000, 15_000, 17_000]) place(`graveyard-fence-${x}`, 'iron-fence', { x, y: 1800 }, 'graveyard-earth')
    place('graveyard-tree-west', 'refined-tree-broadleaf', { x: 3500, y: 12_500 }, 'graveyard-earth')
    place('graveyard-shrub-east', 'refined-shrub-round', { x: 17_500, y: 13_500 }, 'graveyard-earth')
    label('graveyard-public-label', { x: 8500, y: 1000 }, '苔石墓园')
    label('graveyard-gm-clue', { x: 5000, y: 6500 }, '主持人线索：石棺盖侧有新近清理的泥土。', 'gm')
  } else {
    const base = area('volcano-basalt', rectangle(0, 0, 20_000, 16_000), 'basalt')
    base.surfaceStyle!.overlays.push({ id: 'volcano-ash-cover', boundaryMm: points([[500, 1500], [11_000, 700], [13_000, 3000], [12_000, 14_500], [1500, 15_000]]), paint: paint('volcanic-ash'), blendWidthMm: 200, renderOrder: 0 })
    const high = area('volcano-high', rectangle(4000, 4000, 13_000, 11_000), 'refined-rock', 1000, 1)
    const lavaBoundary = points([[14_200, 2500], [17_000, 2000], [18_500, 6000], [17_400, 10_000], [18_000, 14_000], [15_000, 14_500], [14_000, 10_000], [15_500, 6000]])
    // The bitmap and terrain do not grant danger or blocking; the explicit hazard region does.
    area('volcano-lava-visual', lavaBoundary, 'lava', 0, 2)
    scene.regions['volcano-lava-hazard'] = { id: 'volcano-lava-hazard', floorId, editLocked: false, kind: 'hazard',
      boundaryMm: structuredClone(lavaBoundary), visibility: 'public', blocksMovement: true, movementCostMultiplier: 3 }
    high.boundaryMm.forEach((point, index) => {
      const id = `volcano-high-edge-${index}`
      scene.terrainEdges[id] = { id, floorId, editLocked: false, visibility: 'public', source: { areaId: high.id, segmentId: point.segmentId },
        neighborAreaId: base.id, kind: 'cliff', shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: style('basalt'), styleOverride: null }
    })
    scene.terrainConnections['volcano-access-ramp'] = { id: 'volcano-access-ramp', floorId, editLocked: false, visibility: 'public', kind: 'ramp',
      from: { surfaceRef: { kind: 'terrainArea', id: base.id }, positionMm: { x: 2500, y: 8000 } },
      to: { surfaceRef: { kind: 'terrainArea', id: high.id }, positionMm: { x: 5500, y: 8000 } },
      widthMm: 1800, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: style('basalt') }
    group('volcano-rocks-high', THEMED_CATALOG.prefabs.volcano, { x: 8500, y: 7500 }, high.id)
    group('volcano-rocks-low', THEMED_CATALOG.prefabs.volcano, { x: 8500, y: 13_000 }, base.id)
    place('volcano-refined-rock', 'refined-rock-small', { x: 2500, y: 12_000 }, base.id)
    label('volcano-public-label', { x: 13_500, y: 1300 }, '熔脉：独立危险区禁止通行')
    label('volcano-gm-clue', { x: 8500, y: 7500 }, '主持人线索：灰烬下有一段较新的人工石面。', 'gm')
  }
  for (const collection of LAYER_ENTITY_COLLECTIONS_V3) for (const entity of Object.values(scene[collection])) scene.entityLayers[entity.id] = layerId
  return scene
}

export async function createThemedSampleProject(kind: ThemedSampleKind, signal?: AbortSignal): Promise<CompleteProjectV6> {
  const provider = await loadBuiltinCatalogV1(signal)
  signal?.throwIfAborted()
  const document = createThemedSampleDocument(kind, provider), content = createCompositionContentV6(document)
  content.appearance.sources = { ...content.appearance.sources, ...structuredClone(provider.appearance.sources) }
  content.appearance.variants = structuredClone(provider.appearance.variants)
  content.appearance.prefabAppearanceTemplates = structuredClone(provider.appearance.prefabAppearanceTemplates)
  const result: CompleteProjectV6 = { ...content, assets: { ...provider.assets }, licenses: { ...provider.licenses }, licenseBindings: structuredClone(provider.licenseBindings) }
  assertFixedCompositionCompatibleV6(provider, result)
  await validateCompleteProjectV6(result, { signal })
  signal?.throwIfAborted()
  return result
}
