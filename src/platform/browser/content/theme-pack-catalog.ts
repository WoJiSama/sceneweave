import { applySampleAtmosphere } from './sample-atmosphere.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { PointMm, PropTemplate, SceneDocument, SurfaceRef, SurfaceStyle } from '../../../shared/model/scene.js'
import type { CatalogItem } from '../../../shared/library/types.js'
import { listSnapshotCatalogItems } from '../../../shared/library/content.js'
import { THEME_PACK_PLANS, validateThemePackRegistrations, type ThemePackRegistration } from '../../../shared/assets/theme-packs.js'
import { THEME_PACK_CATALOGS } from '../../../shared/assets/theme-pack-catalogs.js'
import { createThemePackReviewContent, type AssetReviewContent } from '../../../shared/assets/review.js'
import { canonicalJson, cloneJson, freezeJson } from '../../../shared/validation/json.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { THEME_PACK_ART, THEME_PACK_LICENSE, type ThemePackArtId } from '../../../shared/visual/theme-pack-art.js'
import { validateEditableProject, toBundle, type EditableProject } from '../../../application/workspace/project.js'
import { runtime, validation } from '../runtime.js'
import { materializeVisualArt } from './visual-art-project.js'
import { planOutpostEntranceRoad } from './outpost-roads.js'
import { applyOutpostSurfaceTransitions } from './outpost-surfaces.js'
import { applyOutpostVegetation, type OutpostVegetationDensity } from './outpost-vegetation.js'

export type { ThemePackArtId } from '../../../shared/visual/theme-pack-art.js'
export { THEME_PACK_CATALOGS } from '../../../shared/assets/theme-pack-catalogs.js'
export type ThemePackSampleVariant = 0 | 1
export interface ThemePackSampleOptions { sceneId?: string; now?: string; outpostVegetation?: OutpostVegetationDensity; outpostAtmosphere?: 'daylight' }
function metadata(id: ThemePackArtId) {
  const value = THEME_PACK_CATALOGS.find(value => value.id === id)
  if (!value) throw new Error('未知主题包。')
  return value
}
export const themePackAssetId = (id: ThemePackArtId, key: string): string => `theme-pack-${id}-art-${key}-v${metadata(id).fixedVersion}`
export const themePackDefinitionId = (id: ThemePackArtId, kind: 'prop' | 'material' | 'prefab', key: string): string => `theme-pack-${id}-${kind}-${key}-v${metadata(id).fixedVersion}`
const floorId = 'theme-pack-floor', structureLayer = 'theme-pack-structure', propLayer = 'theme-pack-props'
const p = (x: number, y: number): PointMm => ({ x, y })
const ref = (id: string, version = 1) => ({ id, version })
const rectangle = (x: number, y: number, right: number, bottom: number): PointMm[] => [p(x, y), p(right, y), p(right, bottom), p(x, bottom)]
type Member = [key: string, x: number, y: number, rotationDeg?: number]
type Group = { key: string; name: string; members: Member[] }
const groups: Record<ThemePackArtId, Group[]> = {
  investigation: [
    { key: 'investigation-corner', name: '调查工作角', members: [['walnut-desk', 0, 0], ['leather-chair', 0, 1500], ['brass-lamp', -550, -150], ['rotary-phone', 550, -150], ['case-files', 0, 50]] },
    { key: 'archive-corner', name: '档案角', members: [['filing-cabinet', -1400, 0], ['archive-shelf', 1300, 0], ['closed-ledger', 1000, -100], ['travel-case', -1400, 1400]] },
    { key: 'treatment-corner', name: '诊疗角', members: [['medical-couch', 0, 0], ['exam-stool', 1400, 700], ['instrument-tray', 1400, -500]] },
  ],
  modern: [
    { key: 'office-workstation', name: '办公位', members: [['office-desk', 0, 0], ['swivel-chair', 0, 1300], ['computer-terminal', 0, -100]] },
    { key: 'checkout-area', name: '收银区', members: [['checkout-counter', -1500, 0], ['shop-shelf', 1500, 0], ['shipping-cartons', 1500, 1800]] },
    { key: 'treatment-corner', name: '诊疗工作角', members: [['medical-bed', 0, 0], ['washbasin', 1500, -600], ['waste-bin', 1500, 1000]] },
  ],
  fantasy: [
    { key: 'dining-table', name: '餐桌组', members: [['trestle-table', 0, 0], ['wooden-bench', 0, -1600], ['wooden-bench', 0, 1600], ['iron-lantern', 600, 0]] },
    { key: 'market-stall', name: '摊位组', members: [['market-stall', 0, 0], ['barrel', -2200, 300], ['grain-sack', 2200, -300], ['cross-crate', 2200, 1400]] },
    { key: 'workshop-corner', name: '工坊角', members: [['forge', -1500, 0], ['anvil', 1500, 700], ['tool-rack', 1500, -1500]] },
  ],
  ruins: [
    { key: 'ritual-group', name: '祭祀组', members: [['stone-altar', 0, 0], ['candle-cluster', 0, 0], ['ceremony-basin', 2200, 0]] },
    { key: 'tomb-group', name: '墓室组', members: [['sarcophagus', 0, 0], ['burial-urn', 1600, 1000], ['grave-slab', -1900, 0]] },
    { key: 'prison-corner', name: '监牢遗留组', members: [['iron-cage', -1300, 0], ['chain-ring', -1300, 0], ['brazier', 1800, 0]] },
  ],
  wilderness: [
    { key: 'camp-group', name: '营地组', members: [['canvas-tent', -2300, 0], ['bedroll', 1500, -1000], ['rucksack', 3000, -800], ['cold-campfire', 1500, 1700]] },
    { key: 'woodland-group', name: '林下植被组', members: [['broadleaf-tree', -1200, 0], ['low-shrub', 1500, 200], ['fern', 1700, 1700]] },
    { key: 'trail-dressing', name: '路边布景组', members: [['river-willow', -1400, 0], ['boulder', 1700, -400], ['fallen-log', 1000, -1700]] },
    { key: 'abandoned-camp-group', name: '废弃营地残留组', members: [['torn-tent', -1800, -600], ['cold-campfire', 1700, 800], ['scattered-gear', -300, 1700], ['fallen-log', -700, 1000, 20]] },
    { key: 'watch-supplies', name: '哨站补给角', members: [['supply-crate', -900, 0], ['supply-crate', 650, 100], ['rucksack', 500, 1200], ['map-roll', -700, 1200]] },
  ],
  coast: [
    { key: 'fishing-work-group', name: '渔具工作组', members: [['fish-crate', -1200, 0], ['fish-basket', 1300, 0], ['folded-net', 1000, -1400], ['rope-coil', -1100, 1300]] },
    { key: 'supply-group', name: '岸边补给组', members: [['rowboat-decoration', 0, 0], ['oar-pair', 2100, 300], ['wooden-buoy', -1700, 700]] },
    { key: 'shore-work-corner', name: '岸边工作角', members: [['wind-pine', -1700, 0], ['salt-shrub', 1500, 0], ['shell-cluster', 1500, 1600]] },
  ],
}
function template(scene: SceneDocument, id: ThemePackArtId, [key, x, y, rotationDeg = 0]: Member): PropTemplate {
  const definition = scene.propDefinitions[themePackDefinitionId(id, 'prop', key)]
  if (!definition) throw new Error(`主题组合缺少实际物件：${key}`)
  return { definitionRef: ref(definition.id, definition.version), appearance: cloneJson(definition.defaultAppearance),
    visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm), positionMm: p(x, y), rotationDeg,
    footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: cloneJson(definition.defaultFootprintOffsetMm),
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight,
    renderLayer: definition.defaultRenderLayer, renderOrder: definition.defaultBlocksMovement ? 0 : 20,
    shadowClass: definition.defaultShadowClass, shadowOverride: null }
}

/** Internal source document. Zero hashes are placeholders until materializeVisualArt checks and captures real bytes. */
export function createThemePackCatalogDocument(id: ThemePackArtId, options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const pack = metadata(id), now = options.now ?? '2026-11-09T00:00:00.000Z'
  const version = pack.fixedVersion
  const bounds = { x: 0, y: 0, width: id === 'wilderness' ? 36000 : 24000, height: id === 'wilderness' ? 28000 : 18000 }, licenseRef = `Sceneweave-Theme-Pack-${id}-MIT-v${version}`
  const origin = { kind: 'original' as const, attribution: `Sceneweave ${pack.name}静态SVG原创候选v${version}；代码辅助创作，未取得美术或用户P3签收`, canEmbed: true }
  const scene = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1,
    sceneId: options.sceneId ?? `theme-pack-${id}-catalog-v${version}`, revision: 0, title: `${pack.name} · 素材候选`, createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '主题包地面', boundsMm: { ...bounds } } },
    userLayers: { [structureLayer]: { id: structureLayer, floorId, name: '地面与结构', order: 0, editLocked: false },
      [propLayer]: { id: propLayer, floorId, name: '主题物件与组合', order: 1, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: `sceneweave-theme-pack-${id}`, presetVersion: version, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] }, visual: emptyVisualSystem() })
  for (const art of THEME_PACK_ART[id]) {
    const assetId = themePackAssetId(id, art.key), definitionId = themePackDefinitionId(id, art.kind, art.key)
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef, origin: cloneJson(origin) }
    const identity = { id: definitionId, catalogId: `${art.kind}.sceneweave.theme-pack.${id}.${art.key}`, version,
      name: art.name, tags: [...(art.tags ?? [])], licenseRef, origin: cloneJson(origin) }
    if (art.kind === 'material') scene.materials[definitionId] = { ...identity, textureAssetId: assetId,
      defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
    else scene.propDefinitions[definitionId] = { ...identity, defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.round(art.widthMm / 2), y: -Math.round(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
      defaultFootprintMm: { ...art.footprintMm! }, defaultFootprintOffsetMm: p(0, 0),
      defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
  }
  for (const group of groups[id]) {
    const definitionId = themePackDefinitionId(id, 'prefab', group.key)
    scene.prefabDefinitions[definitionId] = { id: definitionId, catalogId: `prefab.sceneweave.theme-pack.${id}.${group.key}`, version,
      name: group.name, tags: ['主题艺术候选', id, '可拆组合'], licenseRef, origin: cloneJson(origin),
      members: group.members.map((member, index) => ({ key: `member-${index + 1}`, propTemplate: template(scene, id, member) })) }
  }
  const ink: Record<ThemePackArtId, string> = { investigation: '#40382F', modern: '#38454C', fantasy: '#4C3D2C', ruins: '#3D474C', wilderness: '#3D5847', coast: '#3D5554' }
  const shadow = (offsetMm: number, blurMm: number, opacity: number) => ({ directionDeg: 50, offsetMm, blurMm, opacity, color: ink[id] })
  const themeId = `theme-pack-${id}-theme-v${version}`
  scene.styleThemes[themeId] = { id: themeId, catalogId: `theme.sceneweave.theme-pack.${id}`, version, name: pack.name, licenseRef, origin,
    materialSuggestions: Object.keys(scene.materials).map(id => ref(id, version)), propSuggestions: Object.keys(scene.propDefinitions).map(id => ref(id, version)), prefabSuggestions: Object.keys(scene.prefabDefinitions).map(id => ref(id, version)),
    outline: { widthMm: 24, color: ink[id] }, openingStyle: { doorStrokeWidthMm: 20, windowStrokeWidthMm: 16, frameWidthMm: 60, doorFill: '#A58F6F', windowFill: '#AEC1BD' },
    edgeStyles: { shore: { strokeWidthMm: 12, color: '#DAD5BB', bandWidthMm: 120 }, cliff: { strokeWidthMm: 20, color: ink[id], bandWidthMm: 250 },
      materialTransition: { strokeWidthMm: 0, color: '#A7AD8B', bandWidthMm: 0 }, path: { strokeWidthMm: 10, color: ink[id], bandWidthMm: 0 } },
    shadowPresets: { none: shadow(0, 0, 0), furniture: shadow(100, 70, .18), vegetation: shadow(230, 100, .2), wall: shadow(130, 70, .22) },
    terrainCliff: { directionDeg: 50, offsetFactor: .15, maxOffsetMm: 500, blurMm: 80, opacity: .18, color: ink[id] } }
  scene.activeStyleThemeRef = ref(themeId, version)
  return checkedScene(scene)
}
function checkedScene(scene: SceneDocument): SceneDocument {
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`主题包场景无效：${checked.errors.map(issue => `${issue.entityId ?? ''}: ${issue.message}`).join('；')}`)
  return checked.document
}
function surface(scene: SceneDocument, id: ThemePackArtId, key: string): SurfaceStyle {
  const definition = scene.materials[themePackDefinitionId(id, 'material', key)]
  if (!definition) throw new Error(`主题场景缺少材质：${key}`)
  return { base: { materialRef: ref(definition.id, definition.version), tileSizeMm: { ...definition.defaultTileSizeMm }, rotationDeg: 0,
    alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] }
}
function area(scene: SceneDocument, packId: ThemePackArtId, id: string, points: PointMm[], materialKey: string, priority: number, blocked = false): string {
  scene.terrainAreas[id] = { id, floorId, editLocked: false, visibility: 'public',
    boundaryMm: points.map((positionMm, index) => ({ id: `${id}-point-${index}`, segmentId: `${id}-segment-${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: priority, surfaceStyle: surface(scene, packId, materialKey),
    blocksMovement: blocked, blocksSight: false, movementCostMultiplier: 1 }
  scene.entityLayers[id] = structureLayer
  return id
}
function room(scene: SceneDocument, packId: ThemePackArtId, id: string, name: string, left: number, right: number, materialKey: string, supportId: string): string {
  const points = rectangle(left, 1500, right, 7500), ids = points.map((_, index) => `${id}-vertex-${index}`)
  points.forEach((point, index) => { scene.vertices[ids[index]] = { id: ids[index], floorId, editLocked: false, xMm: point.x, yMm: point.y }; scene.entityLayers[ids[index]] = structureLayer })
  scene.rooms[id] = { id, floorId, editLocked: false, boundaryVertexIds: ids, purpose: name, visibility: 'public', accessExpectation: 'unspecified',
    supportRef: { kind: 'terrainArea', id: supportId }, groundElevationMm: 0, floorStyle: surface(scene, packId, materialKey) }
  scene.entityLayers[id] = structureLayer
  ids.forEach((startVertexId, index) => {
    const wallId = `${id}-wall-${index}`
    scene.walls[wallId] = { id: wallId, floorId, editLocked: false, startVertexId, endVertexId: ids[(index + 1) % 4], thicknessMm: 180,
      blocksMovement: true, blocksSight: true, topStyle: null }; scene.entityLayers[wallId] = structureLayer
  })
  const openingId = `${id}-door`
  scene.openings[openingId] = { id: openingId, floorId, editLocked: false, wallId: `${id}-wall-2`, offsetReferenceVertexId: ids[2],
    offsetMm: Math.round((right - left) / 2 - 600), widthMm: 1200, kind: 'door', state: 'open', locked: false, secret: false, revealed: true }
  scene.entityLayers[openingId] = structureLayer
  return id
}
function place(scene: SceneDocument, packId: ThemePackArtId, member: Member, supportRef: SurfaceRef, roomId?: string): string {
  const id = `theme-sample-prop-${Object.keys(scene.props).length + 1}`
  scene.props[id] = { id, floorId, editLocked: false, visibility: 'public', ...template(scene, packId, member), supportRef: { ...supportRef }, ...(roomId ? { roomId } : {}) }
  scene.entityLayers[id] = propLayer
  return id
}
function group(scene: SceneDocument, packId: ThemePackArtId, index: number, x: number, y: number, supportRef: SurfaceRef, roomId?: string): void {
  const definition = scene.prefabDefinitions[themePackDefinitionId(packId, 'prefab', groups[packId][index].key)]
  const id = `theme-sample-prefab-${Object.keys(scene.prefabInstances).length + 1}`
  const members = Object.fromEntries(definition.members.map(member => {
    const prop = member.propTemplate, key = scene.propDefinitions[prop.definitionRef!.id].defaultAppearance
    if (key.kind !== 'image') throw new Error('主题组合必须引用真实图像物件。')
    const art = THEME_PACK_ART[packId].find(art => themePackAssetId(packId, art.key) === key.assetId)!
    return [member.key, { propId: place(scene, packId, [art.key, x + prop.positionMm.x, y + prop.positionMm.y, prop.rotationDeg], supportRef, roomId), overrideFields: [] }]
  }))
  scene.prefabInstances[id] = { id, floorId, editLocked: false, visibility: 'public', definitionRef: ref(definition.id, definition.version), anchorMm: p(x, y), rotationDeg: 0, members }
  scene.entityLayers[id] = propLayer
}
function path(scene: SceneDocument, packId: ThemePackArtId, materialKey: string, supportId: string, points: PointMm[], widthMm = 1800): void {
  const id = `theme-sample-path-${Object.keys(scene.paths).length + 1}`
  scene.paths[id] = { id, floorId, editLocked: false, visibility: 'public', centerlineMm: points, widthMm,
    supportRefs: [{ kind: 'terrainArea', id: supportId }], surfaceStyle: surface(scene, packId, materialKey), movementCostMultiplier: 1, renderOrder: 0 }
  scene.entityLayers[id] = structureLayer
}

/** Current wilderness v2 compositions. Every mark remains an editable entity;
 * tent artwork is scenery, while the watch rooms and mountain access are real geometry. */
function wildernessSample(scene: SceneDocument, variant: ThemePackSampleVariant, vegetation: OutpostVegetationDensity): void {
  const id = 'wilderness' as const
  const groundPoints = variant === 0 ? rectangle(0, 0, 36000, 28000)
    : [p(0, 0), p(36000, 0), p(36000, 8000), p(36000, 11200), p(36000, 16000), p(36000, 28000), p(0, 28000), p(0, 22000), p(0, 16500), p(0, 13000)]
  const ground = area(scene, id, 'sample-ground', groundPoints, 'meadow-grass', 0)
  const groundSupport = { kind: 'terrainArea' as const, id: ground }
  const trail = (points: PointMm[], supports: string[], widthMm = 1600, key = 'forest-loam') => {
    path(scene, id, key, supports[0], points, widthMm)
    scene.paths[`theme-sample-path-${Object.keys(scene.paths).length}`].supportRefs = supports.map(id => ({ kind: 'terrainArea', id }))
  }
  // Two corner-cut samples per hand-authored outline vertex keep the saved
  // contours round without hiding curve generation in the renderer.
  const rounded = (points: PointMm[]): PointMm[] => points.flatMap((a, index) => {
    const b = points[(index + 1) % points.length]
    return [p(Math.round(a.x * .75 + b.x * .25), Math.round(a.y * .75 + b.y * .25)),
      p(Math.round(a.x * .25 + b.x * .75), Math.round(a.y * .25 + b.y * .75))]
  })
  const forestPatch = (key: string, points: PointMm[], materialKey: string, renderOrder: number) => {
    scene.terrainAreas[ground].surfaceStyle!.overlays.push({ id: key, boundaryMm: rounded(points),
      paint: surface(scene, id, materialKey).base, blendWidthMm: 450, renderOrder })
  }
  const note = (key: string, positionMm: PointMm, text: string) => {
    scene.notes[key] = { id: key, floorId, editLocked: false, anchor: { type: 'point', positionMm }, kind: 'clue', visibility: 'gm', text }
    scene.entityLayers[key] = propLayer
  }
  if (variant === 0) {
    scene.title += ' · 林中哨站'
    const camp = area(scene, id, 'sample-camp', rounded([p(17600, 16600), p(18600, 14800), p(21600, 13900), p(24800, 14300), p(27700, 15800), p(28800, 18400), p(27900, 20700), p(25500, 21900), p(21800, 22000), p(18600, 20400)]), 'forest-loam', 1)
    const abandoned = area(scene, id, 'sample-abandoned-camp', rounded([p(23200, 23900), p(24700, 22500), p(27900, 22000), p(31400, 22300), p(33900, 23800), p(34500, 25100), p(32700, 27300), p(29000, 27800), p(25800, 27500), p(23600, 25800)]), 'forest-loam', 2)
    forestPatch('watch-west-understory', [p(400, 1500), p(2400, 800), p(3600, 3000), p(3400, 10500), p(4400, 14500), p(3800, 20500), p(900, 23500), p(400, 20700)], 'forest-loam', 0)
    forestPatch('watch-north-understory', [p(15300, 800), p(22000, 600), p(28600, 1100), p(34700, 1400), p(34800, 7000), p(31000, 8900), p(27400, 5600), p(21300, 7000), p(17300, 11000), p(15000, 9500)], 'forest-loam', 1)
    forestPatch('watch-south-moss', [p(8500, 23200), p(12800, 22000), p(17900, 23200), p(21400, 26600), p(17200, 27600), p(11700, 27100), p(9300, 25600)], 'forest-moss', 2)
    forestPatch('watch-east-moss', [p(31000, 10600), p(34700, 11100), p(35400, 16700), p(34700, 20500), p(31600, 21000), p(30000, 17800), p(30600, 14600)], 'forest-moss', 3)
    // Two rooms share the same vertices and one wall, including a real internal door.
    const vertices: [string, number, number][] = [['nw', 4000, 3500], ['nm', 9500, 3500], ['ne', 14000, 3500], ['se', 14000, 11500], ['sm', 9500, 11500], ['sw', 4000, 11500]]
    for (const [key, xMm, yMm] of vertices) {
      const vertexId = `watch-${key}`
      scene.vertices[vertexId] = { id: vertexId, floorId, editLocked: false, xMm, yMm }; scene.entityLayers[vertexId] = structureLayer
    }
    const walls: [string, string, string][] = [['north-west', 'nw', 'nm'], ['north-east', 'nm', 'ne'], ['east', 'ne', 'se'], ['south-east', 'se', 'sm'], ['south-west', 'sm', 'sw'], ['west', 'sw', 'nw'], ['partition', 'nm', 'sm']]
    for (const [key, start, end] of walls) {
      const wallId = `watch-${key}`
      scene.walls[wallId] = { id: wallId, floorId, editLocked: false, startVertexId: `watch-${start}`, endVertexId: `watch-${end}`, thicknessMm: 220, blocksMovement: true, blocksSight: true, topStyle: surface(scene, id, 'weathered-boards') }
      scene.entityLayers[wallId] = structureLayer
    }
    const roomIds = ['watch-record-room', 'watch-rest-room']
    for (const [index, boundary] of [['nw', 'nm', 'sm', 'sw'], ['nm', 'ne', 'se', 'sm']].entries()) {
      const roomId = roomIds[index]
      scene.rooms[roomId] = { id: roomId, floorId, editLocked: false, boundaryVertexIds: boundary.map(key => `watch-${key}`), purpose: index === 0 ? '哨站值守与记录' : '巡林员休息与补给', visibility: 'public', accessExpectation: 'required', supportRef: { ...groundSupport }, groundElevationMm: 0, floorStyle: surface(scene, id, 'weathered-boards') }
      scene.entityLayers[roomId] = structureLayer
    }
    const openings: [string, string, string, number, number, 'door' | 'window'][] = [
      ['watch-entrance', 'watch-south-west', 'watch-sm', 2050, 1400, 'door'],
      ['watch-inner-door', 'watch-partition', 'watch-nm', 3500, 1200, 'door'],
      ['watch-north-window', 'watch-north-west', 'watch-nw', 1700, 1500, 'window'],
      ['watch-east-window', 'watch-east', 'watch-ne', 2600, 1800, 'window'],
    ]
    for (const [openingId, wallId, offsetReferenceVertexId, offsetMm, widthMm, kind] of openings) {
      scene.openings[openingId] = { id: openingId, floorId, editLocked: false, wallId, offsetReferenceVertexId, offsetMm, widthMm, kind, state: 'open', locked: false, secret: false, revealed: true }
      scene.entityLayers[openingId] = structureLayer
    }
    scene.constraints.entranceOpeningIds = ['watch-entrance']
    const office: SurfaceRef = { kind: 'room', id: roomIds[0] }, rest: SurfaceRef = { kind: 'room', id: roomIds[1] }
    place(scene, id, ['watch-table', 7600, 5900], office, roomIds[0])
    group(scene, id, 4, 6000, 4500, office, roomIds[0])
    place(scene, id, ['field-cot', 11500, 5700], rest, roomIds[1]); place(scene, id, ['field-cot', 11500, 9500], rest, roomIds[1])
    place(scene, id, ['supply-crate', 13200, 4400], rest, roomIds[1]); place(scene, id, ['map-roll', 13100, 6500], rest, roomIds[1])
    group(scene, id, 0, 22500, 18000, { kind: 'terrainArea', id: camp })
    group(scene, id, 3, 28200, 25000, { kind: 'terrainArea', id: abandoned })
    trail([p(2500, 26000), p(7000, 22000), p(11500, 20000), p(15000, 15500), p(21000, 13500), p(26000, 12000), p(33000, 5000)], [ground, camp], 1800)
    const entrance = planOutpostEntranceRoad(scene, 'watch-entrance', 1400, p(11500, 20000), [p(6750, 14600), p(8700, 17500)])
    trail(entrance.pointsMm, entrance.supportRefs.map(ref => ref.id), 1400)
    trail([p(21000, 13500), p(21900, 15600), p(22500, 17100)], [ground, camp], 1500)
    trail([p(26000, 12000), p(29400, 16900), p(30900, 20800), p(31500, 23500)], [ground, camp, abandoned], 1100)
    place(scene, id, ['trail-sign', 14500, 19200, 345], groundSupport)
    for (const member of [['boulder', 33000, 19200, 35], ['dead-tree', 22500, 25800, 15], ['fallen-log', 2300, 6500, 65]] as Member[]) place(scene, id, member, groundSupport)
    applyOutpostSurfaceTransitions(scene)
    applyOutpostVegetation(scene, vegetation)
    note('watch-gm-clue', p(27800, 24200), '主持人线索：破帐篷边的灰烬仍有一枚哨站封签，遗弃物中藏着失踪巡林员的路线。')
  } else {
    const riverTop = [p(0, 16500), p(6000, 15000), p(10000, 16500), p(16000, 15400), p(21000, 13500), p(28000, 14200), p(36000, 11200)]
    const river = area(scene, id, 'sample-river', [...riverTop, p(36000, 16000), p(29000, 19000), p(22000, 18200), p(16000, 20100), p(9000, 21300), p(0, 22000)], 'river-water', 1, true)
    const bank = area(scene, id, 'sample-gravel-bank', [p(0, 13000), p(5500, 11500), p(10500, 13000), p(15000, 11800), p(20500, 10200), p(28000, 10800), p(36000, 8000), ...riverTop.slice().reverse()], 'river-gravel', 1)
    const high = area(scene, id, 'sample-mountain', [p(18000, 1800), p(26500, 1500), p(32000, 3800), p(30000, 7200), p(21500, 7600), p(17500, 5200)], 'hill-rock', 2)
    scene.terrainAreas[high].groundElevationMm = 1800
    for (const [index, point] of scene.terrainAreas[high].boundaryMm.entries()) {
      const edgeId = `sample-mountain-cliff-${index}`
      scene.terrainEdges[edgeId] = { id: edgeId, floorId, editLocked: false, visibility: 'public', source: { areaId: high, segmentId: point.segmentId }, neighborAreaId: ground, kind: 'cliff', shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: surface(scene, id, 'hill-rock'), styleOverride: null }; scene.entityLayers[edgeId] = structureLayer
    }
    for (let index = 0; index < riverTop.length - 1; index++) {
      const edgeId = `sample-river-shore-${index}`
      scene.terrainEdges[edgeId] = { id: edgeId, floorId, editLocked: false, visibility: 'public', source: { areaId: bank, segmentId: scene.terrainAreas[bank].boundaryMm[12 - index].segmentId }, neighborAreaId: river, kind: 'shore', shoreline: true, blocksMovement: false, blocksSight: false, surfaceStyle: null, styleOverride: null }; scene.entityLayers[edgeId] = structureLayer
    }
    const connectionId = 'sample-mountain-ramp'
    scene.terrainConnections[connectionId] = { id: connectionId, floorId, editLocked: false, visibility: 'public', kind: 'ramp', from: { surfaceRef: { ...groundSupport }, positionMm: p(15500, 5500) }, to: { surfaceRef: { kind: 'terrainArea', id: high }, positionMm: p(20500, 5500) }, widthMm: 1800, openingId: null, blocksMovement: false, movementCostMultiplier: 1.2, surfaceStyle: surface(scene, id, 'hill-rock') }; scene.entityLayers[connectionId] = structureLayer
    trail([p(1800, 14400), p(5500, 13400), p(10000, 14700), p(15000, 13700), p(20500, 12100), p(26000, 12500), p(32000, 10500)], [bank], 1600, 'forest-loam')
    trail([p(10000, 14700), p(11800, 11000), p(13500, 8500), p(15500, 5500)], [ground, bank], 1500)
    trail([p(20500, 5500), p(23000, 6200), p(26500, 6000), p(29000, 5000)], [high], 1600, 'river-gravel')
    group(scene, id, 2, 25000, 4000, { kind: 'terrainArea', id: high })
    group(scene, id, 1, 6500, 6000, groundSupport); group(scene, id, 1, 7500, 25000, groundSupport)
    for (const member of [['pine-tree', 14400, 2400, 25], ['broadleaf-tree', 3700, 9500, 48], ['broadleaf-tree', 14500, 24500, 89], ['pine-tree', 18900, 24900, 120], ['river-willow', 29500, 24000, 35], ['low-shrub', 33000, 21800, 65], ['fern', 15500, 9600, 45], ['grass-tuft', 13000, 22000, 30], ['trail-sign', 14000, 11100, 20]] as Member[]) place(scene, id, member, groundSupport)
    for (const member of [['pine-tree', 3000, 25000, 15], ['broadleaf-tree', 22500, 25300, 17], ['pine-tree', 33000, 25500, 25],
      ['pine-tree', 3200, 3800, 15], ['broadleaf-tree', 11000, 3500, 21]] as Member[]) place(scene, id, member, groundSupport)
    place(scene, id, ['boulder', 24500, 2800, 12], { kind: 'terrainArea', id: high })
    note('trail-gm-clue', p(27500, 5000), '主持人线索：岩台上的旧刻痕指向上游，河水和崖壁均有实际阻挡，只有坡道连接高差。')
  }
}

/** Two explicitly saved layouts per pack; no flattened image, hidden generation or implied tent/boat interior. */
export function createThemePackSampleDocument(id: ThemePackArtId, variant: ThemePackSampleVariant,
  options: ThemePackSampleOptions = {}): SceneDocument {
  if (variant !== 0 && variant !== 1) throw new Error('主题场景只支持两个明确样板。')
  if (options.outpostVegetation !== undefined && (id !== 'wilderness' || variant !== 0)) throw new Error('植被编排选项仅适用于新建林中哨站样板。')
  if (options.outpostAtmosphere !== undefined && (id !== 'wilderness' || variant !== 0 || options.outpostAtmosphere !== 'daylight')) throw new Error('白昼编排仅适用于新建林中哨站样板。')
  const scene = createThemePackCatalogDocument(id, options), pack = metadata(id)
  scene.title = `${pack.scenarios[variant].name} · 主题候选`
  if (id === 'wilderness') {
    const vegetation = options.outpostVegetation ?? 'balanced'
    wildernessSample(scene, variant, vegetation)
    if (variant === 0) {
      scene.sceneId = options.sceneId ?? `theme-pack-wilderness-outpost-layout-1-${vegetation}`
      scene.presetSnapshot = { ...scene.presetSnapshot, presetId: 'sceneweave-outpost-layout', presetVersion: 1,
        source: `Sceneweave 哨站编排1；温带荒野固定素材v2；植被${vegetation}；未取得美术或用户P3签收` }
      if (options.outpostAtmosphere === 'daylight') {
        const next = applySampleAtmosphere(scene, 'outpost-daylight')
        next.sceneId = options.sceneId ?? `theme-pack-wilderness-outpost-daylight-1-${vegetation}`
        next.title = '林中哨站 · 清朗白昼'
        next.presetSnapshot = { ...next.presetSnapshot, presetId: 'sceneweave-outpost-daylight', presetVersion: 1,
          source: `Sceneweave 哨站白昼编排1；温带荒野固定素材v2；植被${vegetation}；未取得美术或用户P3签收` }
        return checkedScene(next)
      }
    }
  } else if (id === 'coast') {
    const groundBoundary = [p(0, 0), p(14500, 0), p(16000, 0), p(16000, 18000), p(14500, 18000), p(0, 18000)]
    const ground = area(scene, id, 'sample-ground', groundBoundary, 'dry-sand', 0)
    const support: SurfaceRef = { kind: 'terrainArea', id: ground }
    area(scene, id, 'sample-water', rectangle(16000, 0, 24000, 18000), 'coastal-water', 0, true)
    area(scene, id, 'sample-wet-shore', rectangle(14500, 0, 16000, 18000), 'wet-sand', 1)
    path(scene, id, 'shore-shingle', ground, [p(1500, 12000), p(13500, 12000)], 2000)
    if (variant === 0) { group(scene, id, 0, 5000, 5000, support); group(scene, id, 1, 11500, 6000, support); place(scene, id, ['quay-bollard', 13500, 10500], support) }
    else {
      const watch = room(scene, id, 'watch-room', '海岸值守与补给', 1500, 10000, 'weathered-plank', ground)
      group(scene, id, 0, 5500, 4000, { kind: 'room', id: watch }, watch)
      group(scene, id, 2, 5000, 15000, support); place(scene, id, ['eroded-reef', 12500, 4000, 35], support)
    }
    place(scene, id, ['reed-tuft', 13500, 15500], support)
  } else {
    const surfaces: Record<'investigation' | 'modern' | 'fantasy' | 'ruins', [string, string, string]> = {
      investigation: ['courtyard-brick', 'oak-parquet', variant === 0 ? 'archive-plank' : 'clinic-tile'],
      modern: ['poured-concrete', variant === 0 ? 'terrazzo-floor' : 'laminate-floor', variant === 0 ? 'poured-concrete' : 'office-carpet'],
      fantasy: ['town-cobble', variant === 0 ? 'tavern-plank' : 'market-earth', variant === 0 ? 'tavern-plank' : 'hearth-stone'],
      ruins: ['cracked-paving', variant === 0 ? 'burial-earth' : 'old-slab', variant === 0 ? 'old-slab' : 'dark-basalt'],
    }
    const [groundKey, leftKey, rightKey] = surfaces[id], ground = area(scene, id, 'sample-courtyard', rectangle(0, 0, 24000, 18000), groundKey, 0)
    const purposes: Record<typeof id, [string, string]> = {
      investigation: variant === 0 ? ['调查事务所', '卷宗档案室'] : ['旧宅问诊室', '旧宅诊疗室'],
      modern: variant === 0 ? ['街角商店', '后场储物区'] : ['公寓生活区', '办公与诊疗区'],
      fantasy: variant === 0 ? ['酒馆餐饮区', '旅舍客房'] : ['集市摊位', '铁匠工坊'],
      ruins: variant === 0 ? ['石棺墓室', '祭坛仪式室'] : ['废弃监牢', '遗迹储藏室'],
    }
    const left = room(scene, id, 'sample-left-room', purposes[id][0], 1500, 10500, leftKey, ground)
    const right = room(scene, id, 'sample-right-room', purposes[id][1], 13500, 22500, rightKey, ground)
    const ls: SurfaceRef = { kind: 'room', id: left }, rs: SurfaceRef = { kind: 'room', id: right }
    path(scene, id, groundKey, ground, [p(2500, 10500), p(21500, 10500)], 2000)
    if (id === 'investigation') {
      group(scene, id, 0, 6000, 3800, ls, left); group(scene, id, variant === 0 ? 1 : 2, 18000, 3700, rs, right)
      place(scene, id, ['coat-stand', 3000, 6000], ls, left)
    } else if (id === 'modern') {
      if (variant === 0) { group(scene, id, 1, 6000, 3600, ls, left); place(scene, id, ['shipping-cartons', 17000, 3500], rs, right); place(scene, id, ['shop-shelf', 20000, 3500], rs, right) }
      else { place(scene, id, ['two-seat-sofa', 4500, 3500], ls, left); place(scene, id, ['single-bed', 8500, 4000], ls, left); group(scene, id, 0, 17500, 3300, rs, right); place(scene, id, ['medical-bed', 20500, 4700], rs, right) }
    } else if (id === 'fantasy') {
      if (variant === 0) { group(scene, id, 0, 6000, 4200, ls, left); place(scene, id, ['straw-bed', 17000, 4000], rs, right); place(scene, id, ['cross-crate', 20500, 3000], rs, right) }
      else { group(scene, id, 1, 6000, 3600, ls, left); group(scene, id, 2, 18000, 4200, rs, right) }
    } else {
      group(scene, id, variant === 0 ? 1 : 2, 6000, 4000, ls, left)
      group(scene, id, 0, 17500, 3500, rs, right); place(scene, id, ['rubble-pile', 20500, 6200], rs, right)
    }
  }
  return checkedScene(scene)
}

export async function createThemePackCatalogProject(id: ThemePackArtId, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const scene = createThemePackCatalogDocument(id, { sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  const project = await materializeVisualArt(scene, THEME_PACK_ART[id], THEME_PACK_LICENSE, key => themePackAssetId(id, key), signal)
  return validateEditableProject(project, { ...validation, signal })
}
export async function createThemePackSampleProject(id: ThemePackArtId, variant: ThemePackSampleVariant, signal?: AbortSignal,
  options: Pick<ThemePackSampleOptions, 'outpostVegetation' | 'outpostAtmosphere'> = {}): Promise<EditableProject> {
  signal?.throwIfAborted()
  const scene = createThemePackSampleDocument(id, variant, { ...options, sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  const project = await materializeVisualArt(scene, THEME_PACK_ART[id], THEME_PACK_LICENSE, key => themePackAssetId(id, key), signal)
  return validateEditableProject(project, { ...validation, signal })
}
export interface LoadedThemePack {
  project: EditableProject
  items: readonly CatalogItem[]
  registration: ThemePackRegistration
  reviewContent: readonly AssetReviewContent[]
  wholePackReviewContent: ReturnType<typeof createThemePackReviewContent>
  coverage: { materials: number; props: number; prefabs: number; scenarios: 2; status: 'candidate'; unverifiedRequirementIds: string[] }
}
/** Loads one independent pack. Review descriptors bind actual resources but never issue administrative review or P3. */
export async function loadThemePack(id: ThemePackArtId, signal?: AbortSignal): Promise<LoadedThemePack> {
  const project = await createThemePackCatalogProject(id, signal), pack = metadata(id), items = listSnapshotCatalogItems(toBundle(project))
  const theme = project.document.styleThemes[project.document.activeStyleThemeRef!.id]
  const plan = THEME_PACK_PLANS.find(value => value.id === pack.planId)!
  const coverage = { planHash: sha256Text(canonicalJson(plan)), requiredRequirementIds: plan.requirements.map(value => value.id),
    scenarios: plan.scenarios.map((scenario, index) => {
      const layout = createThemePackSampleDocument(id, index as ThemePackSampleVariant)
      return { id: scenario.id, name: scenario.name, sourceLayoutHash: sha256Text(canonicalJson(layout)), requirementIds: [...scenario.requirementIds],
        summary: { rooms: Object.keys(layout.rooms).length, terrainAreas: Object.keys(layout.terrainAreas).length,
          paths: Object.keys(layout.paths).length, props: Object.keys(layout.props).length, prefabInstances: Object.keys(layout.prefabInstances).length } }
    }) }
  const registration = validateThemePackRegistrations([{ id: pack.planId, planId: pack.planId, fixedVersion: pack.fixedVersion,
    name: pack.name, axes: cloneJson(pack.axes), availability: 'candidate', discovery: pack.discovery, catalogKeys: items.map(item => item.identity.key),
    coverage,
    theme: { catalogId: theme.catalogId, fixedVersion: theme.version,
      contentHash: sha256Text(canonicalJson({ theme, licenses: project.licenses, bindings: project.licenseBindings.filter(binding => binding.subjectKind === 'styleTheme' && binding.subjectId === theme.id) })) } }])[0]
  const reviewContent = items.map(item => {
    const definitions = item.selector.kind === 'prefab' ? project.document.prefabDefinitions[item.selector.definitionId].members.map(member => member.propTemplate.definitionRef!.id) : []
    const assetIds = new Set(item.thumbnailAssetIds)
    for (const definitionId of definitions) {
      const appearance = project.document.propDefinitions[definitionId].defaultAppearance
      if (appearance.kind === 'image') assetIds.add(appearance.assetId)
    }
    return { catalogKey: item.identity.key, dependencyKeys: [...new Set(definitions)].map(definitionId => {
      const dependency = items.find(value => value.selector.kind === 'prop' && value.selector.definitionId === definitionId)
      if (!dependency) throw new Error('主题审核描述缺少确切组合依赖。')
      return dependency.identity.key
    }).sort(), resourceHashes: [...new Set([...assetIds].flatMap(assetId => {
      const source = project.authoringSources[assetId]
      if (!source) throw new Error('主题审核描述缺少真实SVG来源。')
      return [project.document.assets[assetId].sha256, source.sourceSha256, source.normalizedSha256]
    }))].sort() }
  })
  signal?.throwIfAborted()
  return { project, items, registration, reviewContent: freezeJson(reviewContent), wholePackReviewContent: createThemePackReviewContent(registration, reviewContent),
    coverage: freezeJson({ materials: Object.keys(project.document.materials).length, props: Object.keys(project.document.propDefinitions).length,
      prefabs: Object.keys(project.document.prefabDefinitions).length, scenarios: 2, status: 'candidate',
      unverifiedRequirementIds: THEME_PACK_PLANS.find(value => value.id === pack.planId)!.requirements.map(value => value.id) }) }
}
