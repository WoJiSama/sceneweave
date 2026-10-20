import licenseText from '../../../assets/sceneweave-handdrawn-outdoor/LICENSE.txt?raw'
import artManifest from '../../../assets/sceneweave-handdrawn-outdoor/manifest.json'
import { applyCommandsV2 } from '../../core/v2/commands'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import { validateSceneV2 } from '../../core/v2/schema'
import type { AssetRef, MaterialPaint, MaterialRef, PointMm, PropDefinition, PropV2, ScatterGroup, SceneDocumentV2, StyleTheme, SurfaceStyle, TerrainArea } from '../../core/v2/types'
import { validateCompleteProjectV2 } from '../../io/v2/project-file'
import { sha256Bytes, validateImageAssetRecord } from '../../io/v2/resources'
import type { AssetBlobRecord, CompleteProjectV2 } from '../../io/v2/types'
import { validateIslandEditsV2 } from './island-constraints'

import { ISLAND_IDS, islandShallowWaterBoundaryMm } from './island-geometry'
export { ISLAND_IDS, islandShallowWaterBoundaryMm } from './island-geometry'

const origin: AssetRef['origin'] = { kind: 'original', attribution: 'Sceneweave contributors；项目原创 SVG 绘制，Codex 辅助；源文件及 MIT 记录随仓库保存', canEmbed: true }
const bounds = { x: 0, y: 0, width: 30000, height: 27000 }
const versionRef = (id: string) => ({ id, version: 1 })
const assetId = (index: number) => `b3-a-${String(index + 1).padStart(2, '0')}`
const definitionId = (index: number) => `b3-p-${String(index + 1).padStart(2, '0')}`
const mmPoints = (points: number[][]): PointMm[] => points.map(([x, y]) => ({ x, y }))
/** Complete editable fixture. The first adoption expands exact, deterministic scatter into props. */
export function createIslandDocument(options: { sceneId?: string; now?: string } = {}): SceneDocumentV2 {
  const stamp = options.now ?? new Date().toISOString(), floorId = ISLAND_IDS.floor
  let scene: SceneDocumentV2 = {
    format: 'sceneweave', schemaVersion: 2, sceneId: options.sceneId ?? crypto.randomUUID(), revision: 0,
    title: '双层岩岛 · 墨绘原野', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '岩岛 · 两处地面高程', boundsMm: { ...bounds } } },
    vertices: {}, walls: {}, openings: {}, rooms: {}, props: {}, regions: {}, notes: {}, assets: {},
    propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: versionRef(ISLAND_IDS.theme),
    presetSnapshot: { presetId: 'sceneweave-vis02', presetVersion: 1, distanceMode: 'metric',
      source: 'Sceneweave 原创 VIS-02 米制样板；台阶与两端各2000 mm接入区；不含任何官方规则文本', gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] },
  }
  for (const [index, entry] of artManifest.assets.entries()) {
    const id = assetId(index)
    scene.assets[id] = { id, sha256: entry.sha256, mimeType: 'image/png', pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight,
      logicalSizeMm: { ...entry.logicalSizeMm }, licenseRef: 'MIT', origin: { ...origin } }
  }
  for (const [index, entry] of artManifest.assets.filter(entry => entry.kind === 'material').entries()) {
    const id = `b3-m-${String(index + 1).padStart(2, '0')}`, imageIndex = artManifest.assets.findIndex(item => item.catalogId === entry.catalogId)
    scene.materials[id] = { id, catalogId: entry.catalogId, version: 1, name: entry.name, tags: ['墨绘原野', 'VIS-02', '原创'],
      licenseRef: 'MIT', origin: { ...origin }, textureAssetId: assetId(imageIndex), defaultTileSizeMm: { ...entry.logicalSizeMm },
      applicableSurfaces: entry.surfaces as MaterialRef['applicableSurfaces'] }
  }
  for (const [index, entry] of artManifest.assets.filter(entry => entry.kind === 'prop').entries()) {
    const id = definitionId(index), imageIndex = artManifest.assets.findIndex(item => item.catalogId === entry.catalogId)
    scene.propDefinitions[id] = { id, catalogId: entry.catalogId, version: 1, name: entry.name, tags: ['墨绘原野', 'VIS-02', '原创'],
      licenseRef: 'MIT', origin: { ...origin }, defaultAppearance: { kind: 'image', assetId: assetId(imageIndex), tint: null, opacity: 1 },
      defaultVisualBoundsMm: { ...entry.visualBoundsMm! }, defaultFootprintMm: { ...entry.footprintMm! }, defaultFootprintOffsetMm: { ...entry.footprintOffsetMm! },
      defaultBlocksMovement: entry.blocksMovement!, defaultBlocksSight: entry.blocksSight!, defaultRenderLayer: entry.renderLayer as PropDefinition['defaultRenderLayer'], defaultShadowClass: entry.shadowClass as PropDefinition['defaultShadowClass'] }
  }
  const paint = (id: string): MaterialPaint => ({ materialRef: versionRef(id), tileSizeMm: { ...scene.materials[id].defaultTileSizeMm }, rotationDeg: 0,
    alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 })
  const style = (id: string): SurfaceStyle => ({ base: paint(id), overlays: [] })
  const area = (id: string, points: number[][], elevation: number, priority: number, material: string, blocking = false): TerrainArea => ({ id, floorId, editLocked: false, visibility: 'public',
    boundaryMm: mmPoints(points).map((positionMm, index) => ({ id: `${id}-v${index}`, segmentId: `${id}-s${index}`, positionMm })),
    groundElevationMm: elevation, coveragePriority: priority, surfaceStyle: style(material), blocksMovement: blocking, blocksSight: false, movementCostMultiplier: 1 })
  scene.terrainAreas[ISLAND_IDS.water] = area(ISLAND_IDS.water, [[0, 0], [30000, 0], [30000, 27000], [0, 27000]], 0, 0, ISLAND_IDS.materials.deep, true)
  scene.terrainAreas[ISLAND_IDS.low] = area(ISLAND_IDS.low, [[4000, 8000], [9000, 3000], [18000, 4000], [14000, 6000], [14000, 13000], [18000, 19000], [24000, 18000], [18000, 24000], [7000, 22000], [3000, 15000]], 1000, 1, ISLAND_IDS.materials.rock)
  scene.terrainAreas[ISLAND_IDS.high] = area(ISLAND_IDS.high, [[14000, 6000], [18000, 4000], [25000, 9000], [24000, 18000], [18000, 19000], [14000, 13000]], 3000, 1, ISLAND_IDS.materials.grass)
  scene.terrainAreas[ISLAND_IDS.water].surfaceStyle!.overlays.push({ id: ISLAND_IDS.waterOverlay, boundaryMm: islandShallowWaterBoundaryMm(scene), paint: paint(ISLAND_IDS.materials.shallow), blendWidthMm: 250, renderOrder: 0 })
  scene.terrainAreas[ISLAND_IDS.low].surfaceStyle!.overlays.push({ id: ISLAND_IDS.lowOverlay,
    boundaryMm: mmPoints([[4000, 8000], [6200, 9000], [6300, 12700], [7600, 15800], [10400, 18400], [10800, 22500], [7000, 22000], [3000, 15000]]),
    paint: paint(ISLAND_IDS.materials.sand), blendWidthMm: 250, renderOrder: 0 }, { id: 'island-low-grass',
    boundaryMm: mmPoints([[6900, 8000], [10600, 7000], [12500, 8300], [12200, 13200], [10500, 16000], [8100, 13500]]), paint: paint(ISLAND_IDS.materials.grass), blendWidthMm: 250, renderOrder: 1 })
  scene.terrainAreas[ISLAND_IDS.high].surfaceStyle!.overlays.push({ id: ISLAND_IDS.highOverlay,
    boundaryMm: mmPoints([[18000, 4000], [25000, 9000], [24000, 18000], [22000, 18300], [22500, 15000], [22800, 11000], [21300, 7700], [17900, 5900]]),
    paint: paint(ISLAND_IDS.materials.rock), blendWidthMm: 250, renderOrder: 0 })
  const addEdges = (id: string, indexes: number[], shared: Set<number>) => {
    for (const index of indexes) {
      const edgeId = `${id}-edge-${index}`, neighborAreaId = shared.has(index) ? ISLAND_IDS.low : ISLAND_IDS.water
      scene.terrainEdges[edgeId] = { id: edgeId, floorId, editLocked: false, visibility: 'public', source: { areaId: id, segmentId: `${id}-s${index}` },
        neighborAreaId, kind: 'cliff', shoreline: !shared.has(index), blocksMovement: true, blocksSight: false, surfaceStyle: style(ISLAND_IDS.materials.cliffRock), styleOverride: null }
    }
  }
  addEdges(ISLAND_IDS.low, [0, 1, 6, 7, 8, 9], new Set())
  addEdges(ISLAND_IDS.high, [0, 1, 2, 3, 4, 5], new Set([0, 3, 4, 5]))
  scene.terrainConnections[ISLAND_IDS.connection] = { id: ISLAND_IDS.connection, floorId, editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'terrainArea', id: ISLAND_IDS.low }, positionMm: { x: 12500, y: 10000 } },
    to: { surfaceRef: { kind: 'terrainArea', id: ISLAND_IDS.high }, positionMm: { x: 15500, y: 10000 } },
    widthMm: 2000, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: style(ISLAND_IDS.materials.rock) }
  const definition = (key: string) => {
    const found = Object.values(scene.propDefinitions).find(item => item.catalogId === `prop.sw.${key}`)
    if (!found) throw new Error(`岩岛缺少组件定义：${key}`)
    return found
  }
  const entranceExclusion = { id: '', boundaryMm: mmPoints([[10500, 9000], [17500, 9000], [17500, 11000], [10500, 11000]]), reason: 'entrance' as const, sourceCandidateKey: null }
  const scatter = (id: string, domain: ScatterGroup['domain'], keys: string[], cellSizeMm: number, densityFactor: number, minDistanceMm: number): ScatterGroup => ({ id, floorId, editLocked: false, visibility: 'public', domain,
    palette: keys.map(key => ({ key, propDefinitionRef: versionRef(definition(key).id), weight: 1 })), seed: `${id}-vis02-1`, algorithmVersion: 'scatter-cell-v1',
    gridOriginMm: { x: 0, y: 0 }, cellSizeMm, densityFactor, minDistanceMm, rotationRangeDeg: { min: 0, max: 359.999 }, members: {},
    exclusions: [{ ...structuredClone(entranceExclusion), id: `${id}-stairs-clearance` }] })
  // These measured parameters adopt exactly 6 / 12 / 18 concrete instances in this order.
  scene.scatterGroups[ISLAND_IDS.scatterTrees] = scatter(ISLAND_IDS.scatterTrees, { kind: 'area', areaId: ISLAND_IDS.high }, ['tree-broadleaf', 'tree-sparse'], 2600, .4, 1800)
  scene.scatterGroups[ISLAND_IDS.scatterShrubs] = scatter(ISLAND_IDS.scatterShrubs, { kind: 'area', areaId: ISLAND_IDS.low }, ['shrub-round', 'shrub-dry'], 2200, .41, 450)
  scene.scatterGroups[ISLAND_IDS.scatterRocks] = scatter(ISLAND_IDS.scatterRocks, { kind: 'edgeBand', edgeId: 'island-high-edge-4', widthMm: 6000 }, ['rock-small', 'rock-small-worn'], 700, .61, 80)
  // Three decorative reefs are props supported by the blocked water surface; no standable island is created.
  const reef = definition('reef-decoration')
  for (const [index, positionMm] of mmPoints([[3500, 19000], [25500, 16500], [19000, 25500]]).entries()) {
    const id = `island-reef-${index + 1}`
    const prop: PropV2 = { id, floorId, editLocked: false, definitionRef: versionRef(reef.id), appearance: structuredClone(reef.defaultAppearance),
      visualBoundsMm: { ...reef.defaultVisualBoundsMm }, positionMm, rotationDeg: [18, 132, 273][index], footprintMm: { ...reef.defaultFootprintMm }, footprintOffsetMm: { ...reef.defaultFootprintOffsetMm },
      blocksMovement: false, blocksSight: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: ISLAND_IDS.water }, renderLayer: 'object', renderOrder: 0, shadowClass: 'furniture', shadowOverride: null }
    scene.props[id] = prop
  }
  const shadow = (offsetMm: number, blurMm: number, opacity: number) => ({ directionDeg: 45, offsetMm, blurMm, opacity, color: '#24313A' })
  const theme: StyleTheme = { id: ISLAND_IDS.theme, catalogId: 'sceneweave-handdrawn', version: 1, name: '墨绘原野', licenseRef: 'MIT', origin: { ...origin },
    materialSuggestions: Object.keys(scene.materials).map(versionRef), propSuggestions: Object.keys(scene.propDefinitions).map(versionRef), prefabSuggestions: [],
    outline: { widthMm: 24, color: '#30382F' }, openingStyle: { doorStrokeWidthMm: 16, windowStrokeWidthMm: 12, frameWidthMm: 60, doorFill: '#99734F', windowFill: '#A9C4BE' },
    edgeStyles: { shore: { strokeWidthMm: 12, color: '#D9D4B4', bandWidthMm: 180 }, cliff: { strokeWidthMm: 24, color: '#39443E', bandWidthMm: 450 }, materialTransition: { strokeWidthMm: 0, color: '#71865A', bandWidthMm: 250 }, path: { strokeWidthMm: 0, color: '#9B8B68', bandWidthMm: 150 } },
    shadowPresets: { none: shadow(0, 0, 0), furniture: shadow(120, 80, .22), vegetation: shadow(350, 180, .20), wall: shadow(160, 100, .24) },
    terrainCliff: { directionDeg: 45, offsetFactor: .18, maxOffsetMm: 600, blurMm: 120, opacity: .24, color: '#24313A' } }
  scene.styleThemes[theme.id] = theme
  scene = applyCommandsV2(scene, Object.keys(scene.scatterGroups).map(id => ({ type: 'regenerateScatter' as const, id })))
  const checked = validateSceneV2(scene)
  if (!checked.ok) throw new Error(`岩岛样板校验失败：${checked.errors.map(item => `${item.code}: ${item.message}`).join('；')}`)
  validateIslandEditsV2(checked.document)
  return checked.document
}

/** Create a portable, independently decoded project; no asset URL remains in the document. */
export async function createIslandProject(signal?: AbortSignal): Promise<CompleteProjectV2> {
  signal?.throwIfAborted()
  const document = createIslandDocument(), assets: Record<string, AssetBlobRecord> = {}
  for (const entry of artManifest.assets) {
    signal?.throwIfAborted()
    const response = await fetch(`${import.meta.env.BASE_URL}assets/sceneweave-handdrawn-outdoor/${entry.file}`, { signal })
    if (!response.ok) throw new Error(`样板素材读取失败：${entry.file} (${response.status})`)
    const blob = new Blob([await response.arrayBuffer()], { type: 'image/png' })
    const record: AssetBlobRecord = { sha256: entry.sha256, blob, mimeType: 'image/png', sizeBytes: entry.sizeBytes, pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight }
    await validateImageAssetRecord(record, { signal }); assets[record.sha256] = record
  }
  const licenseHash = await sha256Bytes(new TextEncoder().encode(licenseText))
  const project: CompleteProjectV2 = { document, assets, licenses: { [licenseHash]: { sha256: licenseHash, text: licenseText } },
    licenseBindings: collectDependenciesV2(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })) }
  await validateCompleteProjectV2(project, { signal }); signal?.throwIfAborted()
  return project
}
