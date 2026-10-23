import { applyCommandsV2 } from '../../core/v2/commands'
import { supportedPolygon, propFootprintV2 } from '../../core/v2/geometry'
import type { MaterialPaint, PointMm, PrefabDefinition, PropV2, ScatterGroup, SurfaceRef, SurfaceStyle, TerrainArea } from '../../core/v2/types'
import { geometryDocumentForValidationV3 } from '../../core/v3/domain'
import { validateSceneV3 } from '../../core/v3/schema'
import { LAYER_ENTITY_COLLECTIONS_V3, type SceneDocumentV3 } from '../../core/v3/types'
import { createCompositionContentV6 } from '../../core/v6/graph'
import { materializeProjectV6 } from '../../io/v6/prepare'
import type { CompleteProjectV6 } from '../../io/v6/types'
import { createBlankDocumentV2 } from '../v2/blank-project'
import { createNativeOutdoorDocument } from './blank-project'
import { adoptOutdoorCatalogV2, loadOutdoorCatalogResources, OUTPOST_CATALOG, outpostPropDefinition, outpostPropTemplate } from './outpost-catalog'
import { OUTPOST_PRESET_ID, validateOutpostEditsV2, validateOutpostEditsV3 } from './outpost-constraints'

export const OUTPOST_IDS = {
  floor: 'blank-floor', water: 'outpost-water', low: 'outpost-low', high: 'outpost-high', room: 'outpost-room', store: 'outpost-store',
  entrance: 'outpost-entrance', sharedDoor: 'outpost-shared-door', sharedWall: 'outpost-shared-wall', southWall: 'outpost-room-south',
  yard: 'outpost-yard', yardOverlay: 'outpost-yard-gravel', path: 'outpost-path', connection: 'outpost-stairs', lookout: 'outpost-lookout',
  lamp: 'outpost-lamp-stand', campfire: 'outpost-campfire', bookshelf: 'outpost-bookshelf', crate: 'outpost-store-crate', rack: 'outpost-supply-rack',
  deskGroup: 'outpost-study-group', suppliesGroup: 'outpost-supplies-group', scatterTrees: 'outpost-trees', scatterShrubs: 'outpost-shrubs', scatterRocks: 'outpost-rocks',
  publicLabel: 'outpost-lookout-label', publicDescription: 'outpost-lookout-description', secretNote: 'outpost-gm-ledger',
  privacyMask: 'outpost-privacy-mask', privacyCrate: 'outpost-private-crate', privacyNote: 'outpost-private-crate-note',
  theme: OUTPOST_CATALOG.theme,
  materials: { wood: 'b2-m-01', woodWorn: 'b2-m-02', paver: 'b2-m-03', wallStone: 'b2-m-04', grass: 'b3-m-01', rock: 'b3-m-02', cliffRock: 'b3-m-03', sand: 'b3-m-04', shallow: 'b3-m-05', deep: 'b3-m-06', dirt: OUTPOST_CATALOG.dirt },
  layers: { terrain: 'outpost-layer-terrain', routes: 'outpost-layer-routes', building: 'outpost-layer-building', furnishings: 'outpost-layer-furnishings', vegetation: 'outpost-layer-vegetation', annotations: 'outpost-layer-annotations' },
} as const
export type OutpostDocumentOptions = { sceneId?: string; now?: string }
export const OUTPOST_BOUNDS = { x: 0, y: 0, width: 36000, height: 28000 } as const
const mm = (points: number[][]): PointMm[] => points.map(([x, y]) => ({ x, y }))
const rectangle = (left: number, top: number, right: number, bottom: number) => mm([[left, top], [right, top], [right, bottom], [left, bottom]])
const ref = (id: string) => ({ id, version: 1 })

/** All geometry is independently editable. No island/house bitmap substitutes for real entities. */
export function createOutpostDocument(options: OutpostDocumentOptions = {}): SceneDocumentV3 {
  let scene = createBlankDocumentV2({ title: '海岸哨所 · 墨绘原野', widthMm: OUTPOST_BOUNDS.width, heightMm: OUTPOST_BOUNDS.height, preset: 'investigation', ...options })
  adoptOutdoorCatalogV2(scene)
  const floorId = OUTPOST_IDS.floor
  scene.floors[floorId].name = '海岸哨所 · 单 Floor／两处地面高程'
  scene.activeStyleThemeRef = ref(OUTPOST_IDS.theme)
  scene.presetSnapshot = { presetId: OUTPOST_PRESET_ID, presetVersion: 1, distanceMode: 'metric', source: 'Sceneweave 原创 SCN-04；有限门口、道路与台阶净空检查，不是全图寻路或官方规则', gridSizeMm: 1000 }
  scene.constraints.entranceOpeningIds = [OUTPOST_IDS.entrance]
  const paint = (id: string): MaterialPaint => ({ materialRef: ref(id), tileSizeMm: { ...scene.materials[id].defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 })
  const style = (id: string): SurfaceStyle => ({ base: paint(id), overlays: [] })
  const area = (id: string, points: PointMm[], groundElevationMm: number, coveragePriority: number, material: string, blocksMovement = false): TerrainArea => ({ id, floorId, editLocked: false, visibility: 'public',
    boundaryMm: points.map((positionMm, index) => ({ id: `${id}-v${index}`, segmentId: `${id}-s${index}`, positionMm })), groundElevationMm, coveragePriority,
    surfaceStyle: style(material), blocksMovement, blocksSight: false, movementCostMultiplier: 1 })
  scene.terrainAreas[OUTPOST_IDS.water] = area(OUTPOST_IDS.water, rectangle(0, 0, 36000, 28000), 0, 0, OUTPOST_IDS.materials.deep, true)
  scene.terrainAreas[OUTPOST_IDS.low] = area(OUTPOST_IDS.low, mm([[2000, 4000], [17000, 2000], [23000, 5000], [23000, 20000], [17000, 24000], [3000, 23000]]), 1000, 1, OUTPOST_IDS.materials.grass)
  scene.terrainAreas[OUTPOST_IDS.high] = area(OUTPOST_IDS.high, mm([[23000, 5000], [32000, 7000], [33000, 18000], [23000, 20000]]), 3000, 1, OUTPOST_IDS.materials.rock)
  scene.terrainAreas[OUTPOST_IDS.water].surfaceStyle!.overlays.push({ id: 'outpost-shallow-water', boundaryMm: mm([[1300, 3500], [17100, 1300], [32900, 6200], [34100, 18500], [17400, 24900], [2200, 23900]]), paint: paint(OUTPOST_IDS.materials.shallow), blendWidthMm: 250, renderOrder: 0 })
  scene.terrainAreas[OUTPOST_IDS.low].surfaceStyle!.overlays.push(
    { id: OUTPOST_IDS.yardOverlay, boundaryMm: rectangle(6000, 13000, 17000, 18000), paint: paint(OUTPOST_IDS.materials.dirt), blendWidthMm: 250, renderOrder: 1 },
    { id: 'outpost-low-bare-rock', boundaryMm: mm([[4000, 19000], [7900, 19500], [9600, 22500], [3300, 22600]]), paint: paint(OUTPOST_IDS.materials.rock), blendWidthMm: 250, renderOrder: 0 },
    { id: 'outpost-low-sand', boundaryMm: mm([[2200, 4100], [4100, 4600], [4700, 11000], [2500, 13400]]), paint: paint(OUTPOST_IDS.materials.sand), blendWidthMm: 250, renderOrder: 0 },
  )
  scene.terrainAreas[OUTPOST_IDS.high].surfaceStyle!.overlays.push({ id: 'outpost-high-grass', boundaryMm: mm([[24700, 7000], [29400, 8000], [30900, 15800], [25700, 17400], [24700, 15000]]), paint: paint(OUTPOST_IDS.materials.grass), blendWidthMm: 250, renderOrder: 0 })
  // The dictionary-smaller high area owns the full shared edge exactly once.
  for (const [areaId, indexes] of [[OUTPOST_IDS.low, [0, 1, 3, 4, 5]], [OUTPOST_IDS.high, [0, 1, 2, 3]]] as const) for (const index of indexes) {
    const id = `${areaId}-edge-${index}`, shared = areaId === OUTPOST_IDS.high && index === 3
    scene.terrainEdges[id] = { id, floorId, editLocked: false, visibility: 'public', source: { areaId, segmentId: `${areaId}-s${index}` }, neighborAreaId: shared ? OUTPOST_IDS.low : OUTPOST_IDS.water,
      kind: 'cliff', shoreline: !shared, blocksMovement: true, blocksSight: false, surfaceStyle: style(OUTPOST_IDS.materials.cliffRock), styleOverride: null }
  }
  // Six stable vertices, seven unique wall segments, and one actual shared wall.
  const vertexPoints: Record<string, PointMm> = { 'outpost-nw': { x: 6000, y: 7000 }, 'outpost-nm': { x: 12000, y: 7000 }, 'outpost-ne': { x: 16000, y: 7000 }, 'outpost-se': { x: 16000, y: 13000 }, 'outpost-sm': { x: 12000, y: 13000 }, 'outpost-sw': { x: 6000, y: 13000 } }
  for (const [id, point] of Object.entries(vertexPoints)) scene.vertices[id] = { id, floorId, editLocked: false, xMm: point.x, yMm: point.y }
  const walls: [string, string, string][] = [
    ['outpost-room-north', 'outpost-nw', 'outpost-nm'], [OUTPOST_IDS.sharedWall, 'outpost-nm', 'outpost-sm'], [OUTPOST_IDS.southWall, 'outpost-sm', 'outpost-sw'],
    ['outpost-room-west', 'outpost-sw', 'outpost-nw'], ['outpost-store-north', 'outpost-nm', 'outpost-ne'], ['outpost-store-east', 'outpost-ne', 'outpost-se'], ['outpost-store-south', 'outpost-se', 'outpost-sm'],
  ]
  for (const [id, startVertexId, endVertexId] of walls) scene.walls[id] = { id, floorId, editLocked: false, startVertexId, endVertexId, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: style(OUTPOST_IDS.materials.wallStone) }
  for (const [id, boundaryVertexIds, purpose, material] of [
    [OUTPOST_IDS.room, ['outpost-nw', 'outpost-nm', 'outpost-sm', 'outpost-sw'], '值守室', OUTPOST_IDS.materials.wood],
    [OUTPOST_IDS.store, ['outpost-nm', 'outpost-ne', 'outpost-se', 'outpost-sm'], '储物间', OUTPOST_IDS.materials.paver],
  ] as const) scene.rooms[id] = { id, floorId, editLocked: false, boundaryVertexIds: [...boundaryVertexIds], purpose, visibility: 'public', accessExpectation: 'required', supportRef: { kind: 'terrainArea', id: OUTPOST_IDS.low }, groundElevationMm: 1000, floorStyle: style(material) }
  scene.openings[OUTPOST_IDS.entrance] = { id: OUTPOST_IDS.entrance, floorId, editLocked: false, wallId: OUTPOST_IDS.southWall, offsetReferenceVertexId: 'outpost-sw', offsetMm: 2400, widthMm: 1200, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
  scene.openings[OUTPOST_IDS.sharedDoor] = { id: OUTPOST_IDS.sharedDoor, floorId, editLocked: false, wallId: OUTPOST_IDS.sharedWall, offsetReferenceVertexId: 'outpost-nm', offsetMm: 2500, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
  scene.paths[OUTPOST_IDS.path] = { id: OUTPOST_IDS.path, floorId, editLocked: false, visibility: 'public', centerlineMm: mm([[9000, 14000], [9000, 16000], [21000, 16000], [21500, 13000]]), widthMm: 2000, supportRefs: [{ kind: 'terrainArea', id: OUTPOST_IDS.low }], surfaceStyle: style(OUTPOST_IDS.materials.dirt), movementCostMultiplier: 1, renderOrder: 0 }
  scene.terrainConnections[OUTPOST_IDS.connection] = { id: OUTPOST_IDS.connection, floorId, editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'terrainArea', id: OUTPOST_IDS.low }, positionMm: { x: 21500, y: 13000 } }, to: { surfaceRef: { kind: 'terrainArea', id: OUTPOST_IDS.high }, positionMm: { x: 24500, y: 13000 } },
    widthMm: 2000, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: style(OUTPOST_IDS.materials.paver) }
  const region = (id: string, boundaryMm: PointMm[]) => ({ id, floorId, editLocked: false, boundaryMm, kind: 'terrain' as const, blocksMovement: false, movementCostMultiplier: 1, visibility: 'public' as const })
  scene.regions[OUTPOST_IDS.yard] = region(OUTPOST_IDS.yard, rectangle(6000, 13000, 17000, 18000))
  scene.regions[OUTPOST_IDS.lookout] = region(OUTPOST_IDS.lookout, rectangle(26500, 11500, 29500, 14500))
  const place = (id: string, key: string, positionMm: PointMm, supportRef: SurfaceRef, renderOrder = 0) => {
    const prop: PropV2 = { id, floorId, editLocked: false, ...outpostPropTemplate(outpostPropDefinition(scene, key), positionMm.x, positionMm.y, 0, renderOrder), visibility: 'public', supportRef,
      ...(supportRef.kind === 'room' ? { roomId: supportRef.id } : {}) }
    scene.props[id] = prop
  }
  const group = (id: string, definition: PrefabDefinition, anchorMm: PointMm, supportRef: SurfaceRef) => {
    scene.prefabInstances[id] = { id, floorId, editLocked: false, visibility: 'public', definitionRef: ref(definition.id), anchorMm, rotationDeg: 0, members: {} }
    for (const member of definition.members) {
      const propId = `${id}-${member.key}`, template = structuredClone(member.propTemplate)
      scene.props[propId] = { id: propId, floorId, editLocked: false, ...template, positionMm: { x: anchorMm.x + template.positionMm.x, y: anchorMm.y + template.positionMm.y }, visibility: 'public', supportRef: { ...supportRef }, ...(supportRef.kind === 'room' ? { roomId: supportRef.id } : {}) }
      scene.prefabInstances[id].members[member.key] = { propId, overrideFields: [] }
    }
  }
  group(OUTPOST_IDS.deskGroup, scene.prefabDefinitions[OUTPOST_CATALOG.studyPrefab], { x: 8600, y: 8500 }, { kind: 'room', id: OUTPOST_IDS.room })
  group(OUTPOST_IDS.suppliesGroup, scene.prefabDefinitions[OUTPOST_CATALOG.suppliesPrefab], { x: 14500, y: 14200 }, { kind: 'terrainArea', id: OUTPOST_IDS.low })
  place(OUTPOST_IDS.bookshelf, 'bookshelf', { x: 6750, y: 9700 }, { kind: 'room', id: OUTPOST_IDS.room })
  place(OUTPOST_IDS.crate, 'crate', { x: 13300, y: 11900 }, { kind: 'room', id: OUTPOST_IDS.store })
  place(OUTPOST_IDS.rack, 'supply-rack', { x: 15000, y: 9300 }, { kind: 'room', id: OUTPOST_IDS.store })
  place(OUTPOST_IDS.campfire, 'campfire', { x: 11700, y: 14200 }, { kind: 'terrainArea', id: OUTPOST_IDS.low })
  place(OUTPOST_IDS.lamp, 'lamp-stand', { x: 28200, y: 12400 }, { kind: 'terrainArea', id: OUTPOST_IDS.high })
  scene.notes[OUTPOST_IDS.publicLabel] = { id: OUTPOST_IDS.publicLabel, floorId, editLocked: false, anchor: { type: 'point', positionMm: { x: 27000, y: 14200 } }, kind: 'label', text: '瞭望点', visibility: 'public' }
  scene.notes[OUTPOST_IDS.secretNote] = { id: OUTPOST_IDS.secretNote, floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: OUTPOST_IDS.lamp }, kind: 'clue', title: '返航账目', text: '灯架下藏有返航账目', visibility: 'gm', discovered: false }
  // Explicitly authored public text; revealing a landmark never publishes the GM clue.
  scene.notes[OUTPOST_IDS.publicDescription] = { id: OUTPOST_IDS.publicDescription, floorId, editLocked: false, anchor: { type: 'point', positionMm: { x: 26200, y: 15000 } }, kind: 'label', text: '旧灯架守着海湾', visibility: 'public' }
  const commonExclusions: { name: string; boundaryMm: PointMm[]; reason: 'entrance' | 'manual' }[] = [
    { name: 'building', boundaryMm: rectangle(5000, 6000, 17000, 14000), reason: 'manual' },
    { name: 'yard-and-road', boundaryMm: rectangle(5000, 12000, 22500, 18500), reason: 'entrance' },
    { name: 'stairs', boundaryMm: rectangle(19500, 11500, 26500, 14500), reason: 'entrance' },
    { name: 'lookout', boundaryMm: rectangle(25000, 10500, 31000, 16300), reason: 'manual' },
  ]
  const scatter = (id: string, domain: ScatterGroup['domain'], keys: string[], cellSizeMm: number, densityFactor: number, minDistanceMm: number): ScatterGroup => ({ id, floorId, editLocked: false, visibility: 'public', domain,
    palette: keys.map(key => ({ key, propDefinitionRef: ref(outpostPropDefinition(scene, key).id), weight: 1 })), seed: `${id}-scn04-1`, algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 0, y: 0 },
    cellSizeMm, densityFactor, minDistanceMm, rotationRangeDeg: { min: 0, max: 359.999 }, members: {}, exclusions: commonExclusions.map(exclusion => ({ id: `${id}-exclude-${exclusion.name}`, boundaryMm: structuredClone(exclusion.boundaryMm), reason: exclusion.reason, sourceCandidateKey: null })) })
  scene.scatterGroups[OUTPOST_IDS.scatterTrees] = scatter(OUTPOST_IDS.scatterTrees, { kind: 'area', areaId: OUTPOST_IDS.high }, ['tree-broadleaf', 'tree-sparse'], 2500, .42, 1600)
  scene.scatterGroups[OUTPOST_IDS.scatterShrubs] = scatter(OUTPOST_IDS.scatterShrubs, { kind: 'area', areaId: OUTPOST_IDS.low }, ['shrub-round', 'shrub-dry'], 2500, .30, 500)
  scene.scatterGroups[OUTPOST_IDS.scatterRocks] = scatter(OUTPOST_IDS.scatterRocks, { kind: 'edgeBand', edgeId: `${OUTPOST_IDS.high}-edge-2`, widthMm: 4500 }, ['rock-small', 'rock-small-worn'], 1200, .36, 180)
  scene = applyCommandsV2(scene, Object.keys(scene.scatterGroups).map(id => ({ type: 'regenerateScatter', id })))
  // Persist real manual movement and a deliberate deletion exclusion; locks remain explicit editing actions.
  const trees = Object.values(scene.scatterGroups[OUTPOST_IDS.scatterTrees].members).flatMap(member => member.propId ? [scene.props[member.propId]] : [])
  const moved = trees.find(prop => supportedPolygon(scene, propFootprintV2({ ...prop, positionMm: { x: prop.positionMm.x + 200, y: prop.positionMm.y } }), prop.supportRef, floorId))
  if (!moved || trees.length < 2) throw new Error('海岸哨所散布未提供可记录人工移动的树木。')
  scene = applyCommandsV2(scene, [{ type: 'updateProp', id: moved.id, changes: { positionMm: { x: moved.positionMm.x + 200, y: moved.positionMm.y } } }])
  const deleted = Object.values(scene.scatterGroups[OUTPOST_IDS.scatterShrubs].members).find(member => member.propId !== null)
  if (!deleted?.propId) throw new Error('海岸哨所散布未提供可记录人工删除的灌木。')
  scene = applyCommandsV2(scene, [{ type: 'deleteProp', id: deleted.propId }])
  validateOutpostEditsV2(scene)
  const document = createNativeOutdoorDocument(scene)
  document.userLayers = Object.fromEntries([
    [OUTPOST_IDS.layers.terrain, '海岸与台地'], [OUTPOST_IDS.layers.routes, '道路与连接'], [OUTPOST_IDS.layers.building, '哨所建筑'],
    [OUTPOST_IDS.layers.furnishings, '家具与补给'], [OUTPOST_IDS.layers.vegetation, '植被与碎石'], [OUTPOST_IDS.layers.annotations, '地点与注记'],
  ].map(([id, name], order) => [id, { id, name, floorId, order, editLocked: false }]))
  const vegetationIds = new Set(Object.values(document.scatterGroups).flatMap(group => Object.values(group.members).flatMap(member => member.propId ?? [])))
  for (const collection of LAYER_ENTITY_COLLECTIONS_V3) for (const entity of Object.values(document[collection])) document.entityLayers[entity.id] =
    collection === 'terrainAreas' || collection === 'terrainEdges' ? OUTPOST_IDS.layers.terrain : collection === 'paths' || collection === 'terrainConnections' || collection === 'regions' ? OUTPOST_IDS.layers.routes :
      collection === 'props' ? vegetationIds.has(entity.id) ? OUTPOST_IDS.layers.vegetation : OUTPOST_IDS.layers.furnishings : collection === 'prefabInstances' ? OUTPOST_IDS.layers.furnishings : collection === 'scatterGroups' ? OUTPOST_IDS.layers.vegetation : collection === 'notes' ? OUTPOST_IDS.layers.annotations : OUTPOST_IDS.layers.building
  const checked = validateSceneV3(document)
  if (!checked.ok) throw new Error(`海岸哨所图层校验失败：${checked.errors.map(issue => `${issue.code}: ${issue.message}`).join('；')}`)
  return checked.document
}

/** Real adopted records for editing/QA; candidate keys are not guessed from visual positions. */
export function outpostScatterRecords(document: SceneDocumentV3) {
  const trees = document.scatterGroups[OUTPOST_IDS.scatterTrees], shrubs = document.scatterGroups[OUTPOST_IDS.scatterShrubs]
  return {
    manuallyMovedTree: Object.entries(trees?.members ?? {}).find(([, member]) => member.state === 'manual' && member.overrideFields.includes('positionMm')) ?? null,
    lockedTrees: Object.entries(trees?.members ?? {}).filter(([, member]) => member.propId && document.props[member.propId]?.editLocked),
    deletedShrub: Object.entries(shrubs?.members ?? {}).find(([, member]) => member.state === 'deleted') ?? null,
  }
}

export type OutpostPrivacyVariant = 'a' | 'b' | 'reference'
/** Independent secret variants with one shared mask; reference removes the varying secret objects entirely. */
export function createOutpostPrivacyDocument(variant: OutpostPrivacyVariant, options: OutpostDocumentOptions = {}): SceneDocumentV3 {
  if (!['a', 'b', 'reference'].includes(variant)) throw new Error('海岸哨所隐私副本只接受 a、b 或 reference。')
  const document = createOutpostDocument({ sceneId: 'outpost-privacy-fixture', now: '2026-10-23T00:00:00.000Z', ...options }), floorId = OUTPOST_IDS.floor
  document.title = '海岸哨所 · 固定遮罩隐私验收副本'
  document.regions[OUTPOST_IDS.privacyMask] = { id: OUTPOST_IDS.privacyMask, floorId, editLocked: false, boundaryMm: rectangle(12500, 7500, 15500, 11500), kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }
  document.entityLayers[OUTPOST_IDS.privacyMask] = OUTPOST_IDS.layers.annotations
  if (variant !== 'reference') {
    const id = OUTPOST_IDS.privacyCrate, definition = outpostPropDefinition(geometryDocumentForValidationV3(document), 'crate')
    document.props[id] = { id, floorId, editLocked: false, ...outpostPropTemplate(definition, variant === 'a' ? 13500 : 14000, variant === 'a' ? 8500 : 9000, variant === 'a' ? 0 : 37, 40),
      appearance: { ...definition.defaultAppearance, tint: variant === 'a' ? null : '#A16B53' }, visibility: 'gm', supportRef: { kind: 'room', id: OUTPOST_IDS.store }, roomId: OUTPOST_IDS.store,
      shadowOverride: variant === 'a' ? { directionDeg: 45, offsetMm: 80, blurMm: 40, opacity: .17, color: '#24313A' } : { directionDeg: 135, offsetMm: 180, blurMm: 90, opacity: .43, color: '#4B4650' } }
    document.notes[OUTPOST_IDS.privacyNote] = { id: OUTPOST_IDS.privacyNote, floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: id }, kind: 'clue', title: `哨所私密木箱 ${variant.toUpperCase()}`, text: variant === 'a' ? 'SECRET-OUTPOST-A：箱底夹着账页。' : 'SECRET-OUTPOST-B：不同文字、颜色与投影。', visibility: 'gm', discovered: false }
    document.entityLayers[id] = OUTPOST_IDS.layers.furnishings; document.entityLayers[OUTPOST_IDS.privacyNote] = OUTPOST_IDS.layers.annotations
    document.generationMetadata = { generatorVersion: 'outpost-privacy-fixture-v1', seed: `private-${variant}`, summary: `SECRET-OUTPOST-${variant.toUpperCase()}`, adoptedAt: document.createdAt }
  }
  const checked = validateSceneV3(document)
  if (!checked.ok) throw new Error(`海岸哨所隐私副本无效：${checked.errors.map(issue => issue.message).join('；')}`)
  validateOutpostEditsV3(checked.document)
  return checked.document
}

async function completeOutpostProject(document: SceneDocumentV3, signal?: AbortSignal): Promise<CompleteProjectV6> {
  const resources = await loadOutdoorCatalogResources(geometryDocumentForValidationV3(document), signal)
  // Real fixed-source tint/brightness produces an adopted native bitmap with bytes,
  // inherited license and pixel verification before this factory returns a project.
  const project = await materializeProjectV6({ ...createCompositionContentV6(document), ...resources }, { signal })
  signal?.throwIfAborted()
  validateOutpostEditsV3(project.document)
  return project
}
export async function createOutpostProject(signal?: AbortSignal): Promise<CompleteProjectV6> {
  signal?.throwIfAborted()
  return completeOutpostProject(createOutpostDocument(), signal)
}
export async function createOutpostPrivacyProject(variant: OutpostPrivacyVariant, signal?: AbortSignal): Promise<CompleteProjectV6> {
  signal?.throwIfAborted()
  return completeOutpostProject(createOutpostPrivacyDocument(variant), signal)
}
