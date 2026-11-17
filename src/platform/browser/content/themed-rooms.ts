import type { Prop, SceneDocument } from '../../../shared/model/scene.js'
import { applyCommands } from '../../../shared/commands/commands.js'
import { createBasePlacedProp } from '../../../shared/commands/base.js'
import { furnishInterior, type InteriorFurnishingReport } from '../../../shared/generation/domains/interior/furnishing.js'
import { inspectInteriorConnections } from '../../../shared/generation/domains/interior/connectivity.js'
import type { InteriorFurnitureRole, InteriorGenerationInput } from '../../../shared/generation/domains/interior/contracts.js'
import { taskBudgetProfile } from '../../../shared/budget/task-budget.js'
import { assertDoorwayClearances } from '../../../shared/geometry/doorway-clearance.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { REFINED_INTERIOR_ART, REFINED_INTERIOR_LICENSE } from '../../../shared/visual/interior-art.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { createRefinedInteriorDocument } from './refined-interior.js'
import { materializeVisualArt } from './visual-art-project.js'
import { runtime } from '../runtime.js'

export const THEMED_ROOM_PRESETS = [
  { id: 'guest-compact', name: '灰橡客房 · 紧凑单床', purpose: '客房', widthMm: 5200, heightMm: 6200 },
  { id: 'guest-spacious', name: '灰橡客房 · 宽敞双床', purpose: '客房', widthMm: 8500, heightMm: 7200 },
  { id: 'kitchen-compact', name: '灰石厨房 · 紧凑工作带', purpose: '厨房', widthMm: 6200, heightMm: 5600 },
  { id: 'kitchen-spacious', name: '灰石厨房 · 宽敞备餐间', purpose: '厨房', widthMm: 8500, heightMm: 7200 },
  { id: 'storage-compact', name: '布草储藏 · 紧凑库房', purpose: '储藏间', widthMm: 5000, heightMm: 5000 },
  { id: 'storage-spacious', name: '布草储藏 · 宽敞库房', purpose: '储藏间', widthMm: 7500, heightMm: 6500 },
] as const
export type ThemedRoomPresetId = typeof THEMED_ROOM_PRESETS[number]['id']
const point = (x: number, y: number) => ({ x, y })
const ref = (id: string) => ({ id, version: 1 })
const definitionId = (key: string) => `refined-prop-interior-${key}`
const floorId = 'visual-floor', groundLayer = 'visual-layer-ground', propLayer = 'visual-layer-props', roomId = 'themed-room'

/** New content has its own immutable namespace and exact license identity.
 * Existing refined-art definitions are never edited in a destination project. */
function namespaceRoomContent(scene: SceneDocument): void {
  const renamed = (id: string) => `gray-oak-${id}`, licenseRef = 'sceneweave.gray-oak.original-license.v1'
  for (const key of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) {
    const values = Object.values(scene[key]).map(row => ({ ...cloneJson(row), id: renamed(row.id), licenseRef, ...('catalogId' in row ? { catalogId: `sceneweave.gray-oak.${row.catalogId}` } : {}) }))
    Object.assign(scene, { [key]: Object.fromEntries(values.map(row => [row.id, row])) })
  }
  const appearance = (value: Prop['appearance']) => { if (value.kind === 'image') value.assetId = renamed(value.assetId) }
  for (const definition of Object.values(scene.propDefinitions)) appearance(definition.defaultAppearance)
  for (const material of Object.values(scene.materials)) material.textureAssetId = renamed(material.textureAssetId)
  for (const prop of Object.values(scene.props)) { if (prop.definitionRef) prop.definitionRef.id = renamed(prop.definitionRef.id); appearance(prop.appearance) }
  for (const prefab of Object.values(scene.prefabDefinitions)) for (const member of prefab.members) { if (member.propTemplate.definitionRef) member.propTemplate.definitionRef.id = renamed(member.propTemplate.definitionRef.id); appearance(member.propTemplate.appearance) }
  for (const prefab of Object.values(scene.prefabInstances)) prefab.definitionRef.id = renamed(prefab.definitionRef.id)
  for (const room of Object.values(scene.rooms)) if (room.floorStyle) for (const paint of [room.floorStyle.base, ...room.floorStyle.overlays.map(overlay => overlay.paint)]) paint.materialRef.id = renamed(paint.materialRef.id)
  for (const theme of Object.values(scene.styleThemes)) for (const refs of [theme.materialSuggestions, theme.propSuggestions, theme.prefabSuggestions]) for (const ref of refs) ref.id = renamed(ref.id)
  if (scene.activeStyleThemeRef) scene.activeStyleThemeRef.id = renamed(scene.activeStyleThemeRef.id)
}

/** Coordinated original artwork, real fixed sizes and the existing version-20
 * purpose/use-space solver. These are editable examples, never an AI replay. */
export function createThemedRoomDocument(presetId: ThemedRoomPresetId, options: { sceneId?: string; now?: string; checkCancelled?: () => void } = {}): { document: SceneDocument; report: InteriorFurnishingReport; input: InteriorGenerationInput } {
  const preset = THEMED_ROOM_PRESETS.find(row => row.id === presetId)
  if (!preset) throw new Error('未知主题房间。')
  const checkCancelled = options.checkCancelled ?? (() => {}), bounds = { x: 0, y: 0, width: preset.widthMm + 4000, height: preset.heightMm + 4000 }
  let scene = createRefinedInteriorDocument({ sceneId: options.sceneId ?? `themed-room-${presetId}`, now: options.now ?? '2026-11-16T00:00:00.000Z' })
  for (const key of ['vertices', 'walls', 'openings', 'rooms', 'props', 'notes', 'regions', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'prefabDefinitions', 'scatterGroups'] as const) Object.assign(scene, { [key]: {} })
  scene.entityLayers = {}; scene.title = preset.name; scene.exportBoundsMm = bounds; scene.floors[floorId].boundsMm = cloneJson(bounds)
  scene.visual = { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }
  scene.constraints.entranceOpeningIds = []; scene.constraints.minDoorWidthMm = 1000
  scene.units = { ...scene.units, display: 'm', gridVisible: false }
  scene.styleThemes[scene.activeStyleThemeRef!.id].prefabSuggestions = []
  const roomBounds = { x: 2000, y: 2000, width: preset.widthMm, height: preset.heightMm }
  const layout = { rooms: [{ requirementId: 'purpose-room', roomId, boundsMm: roomBounds, clearAreaMm2: (preset.widthMm - 250) * (preset.heightMm - 250) }], corridors: [] }
  const stamp = { ids: { nextId: (() => { let n = 0; return () => `themed-room-structure-${++n}` })() }, clock: { now: () => scene.updatedAt } }
  scene = applyCommands(scene, [{ type: 'createRoom', id: roomId, floorId, layerId: groundLayer, purpose: preset.purpose, thicknessMm: 250,
    boundaryMm: [point(2000, 2000), point(2000 + preset.widthMm, 2000), point(2000 + preset.widthMm, 2000 + preset.heightMm), point(2000, 2000 + preset.heightMm)], materialRef: ref(preset.purpose === '厨房' ? 'refined-material-interior-material-flags' : 'refined-material-interior-material-planks') }], stamp)
  const walls = Object.values(scene.walls), bottom = walls.find(wall => scene.vertices[wall.startVertexId].yMm === 2000 + preset.heightMm && scene.vertices[wall.endVertexId].yMm === 2000 + preset.heightMm)!
  const top = walls.find(wall => scene.vertices[wall.startVertexId].yMm === 2000 && scene.vertices[wall.endVertexId].yMm === 2000)!
  scene = applyCommands(scene, [{ type: 'addOpening', id: 'themed-room-door', wallId: bottom.id, offsetReferenceVertexId: bottom.startVertexId, offsetMm: Math.floor((preset.widthMm - 1200) / 2), widthMm: 1200, kind: 'door', state: 'open', layerId: groundLayer },
    { type: 'addOpening', id: 'themed-room-window', wallId: top.id, offsetReferenceVertexId: top.startVertexId, offsetMm: preset.widthMm - 2100, widthMm: 1400, kind: 'window', layerId: groundLayer }], stamp)
  const roleKeys: [InteriorFurnitureRole, string][] = [['bed', 'bed-indigo'], ['storage', 'cupboard-linen'], ['seat', 'chair-cushion'], ['table', 'table-round'], ['work', 'counter-kitchen'], ['hearth', 'stove-masonry'], ['shelf', 'shelf-books']]
  const input: InteriorGenerationInput = { version: 1, algorithmVersion: 20, seed: `gray-oak-room-${presetId}-v1`, parameters: { floorId, layerId: propLayer, boundsMm: bounds, wallThicknessMm: 250,
    rooms: [{ id: 'purpose-room', purpose: preset.purpose, minAreaMm2: 1, maxAreaMm2: 1_000_000_000, minClearSideMm: 1000 }], relations: [], corridor: { axis: 'none', clearWidthMm: 1000 }, materials: { floor: null, wall: null },
    arrangement: { doors: true, entrance: true, furniture: true, doorWidthMm: 1200, clearWidthMm: 1000, palette: roleKeys.map(([role, key]) => ({ role, ref: ref(definitionId(key)) })) } } }
  checkCancelled()
  const connectivity = inspectInteriorConnections(scene, input, layout, { profile: taskBudgetProfile('small'), checkCancelled })
  const furnished = furnishInterior(scene, input, layout, connectivity, { profile: taskBudgetProfile('small'), checkCancelled })
  scene = furnished.document
  // Restrained life details sit on their actual working furniture; they never
  // acquire collision or passability roles from their pictures.
  const anchors = Object.values(scene.props).filter(prop => ['table-round', 'counter-kitchen'].some(key => prop.definitionRef?.id === definitionId(key)))
  for (const [index, anchor] of anchors.entries()) {
    if (index > 2) break
    const key = preset.purpose === '厨房' ? 'tableware' : preset.purpose === '储藏间' ? 'basket-linen' : 'papers-books'
    const prop = createBasePlacedProp(scene, definitionId(key), cloneJson(anchor.positionMm), { ids: { nextId: () => `themed-room-detail-${index}` }, clock: stamp.clock }, { floorId, supportRef: { kind: 'room', id: roomId } })
    prop.roomId = roomId; prop.renderOrder = 40
    // Only small nonblocking life details are layered; storage baskets remain
    // independent floor furniture and are not placed over cabinets.
    if (key === 'basket-linen') continue
    scene.props[prop.id] = prop; scene.entityLayers[prop.id] = propLayer
  }
  const living = Object.values(scene.props), anchorMm = point(2000 + Math.floor(preset.widthMm / 2), 2000 + Math.floor(preset.heightMm / 2))
  const members = living.map((prop, index) => { const { id: _id, floorId: _floor, editLocked: _locked, supportRef: _support, roomId: _room, visibility: _visibility, ...template } = cloneJson(prop); return { key: `member-${index + 1}`, propTemplate: { ...template, positionMm: point(prop.positionMm.x - anchorMm.x, prop.positionMm.y - anchorMm.y) } } })
  if (members.length) {
    const definitionId = `gray-oak-dressing-${presetId}-v1`, sample = scene.propDefinitions[Object.values(scene.props)[0].definitionRef!.id]
    scene.prefabDefinitions[definitionId] = { id: definitionId, catalogId: `sceneweave.gray-oak.dressing.${presetId}`, version: 1, licenseRef: sample.licenseRef, origin: cloneJson(sample.origin), name: `${preset.name}布景`, tags: ['灰橡主题', preset.purpose, '当前完整结果'], members }
    scene.prefabInstances['themed-room-dressing'] = { id: 'themed-room-dressing', floorId, editLocked: false, visibility: 'public', definitionRef: ref(definitionId), anchorMm, rotationDeg: 0, members: Object.fromEntries(members.map((member, i) => [member.key, { propId: living[i].id, overrideFields: [] }])) }
    scene.entityLayers['themed-room-dressing'] = propLayer
  }
  // Keep only the fixed art actually used by this room and its immutable group.
  const usedDefinitions = new Set(living.flatMap(prop => prop.definitionRef?.id ?? []))
  scene.propDefinitions = Object.fromEntries(Object.entries(scene.propDefinitions).filter(([id]) => usedDefinitions.has(id)))
  const usedMaterials = new Set(Object.values(scene.rooms).flatMap(room => room.floorStyle ? [room.floorStyle.base.materialRef.id, ...room.floorStyle.overlays.map(overlay => overlay.paint.materialRef.id)] : []))
  scene.materials = Object.fromEntries(Object.entries(scene.materials).filter(([id]) => usedMaterials.has(id)))
  const usedAssets = new Set([...living.flatMap(prop => prop.appearance.kind === 'image' ? [prop.appearance.assetId] : []), ...Object.values(scene.materials).map(material => material.textureAssetId)])
  scene.assets = Object.fromEntries(Object.entries(scene.assets).filter(([id]) => usedAssets.has(id)))
  const theme = scene.styleThemes[scene.activeStyleThemeRef!.id]
  theme.materialSuggestions = Object.keys(scene.materials).map(ref); theme.propSuggestions = Object.keys(scene.propDefinitions).map(ref); theme.prefabSuggestions = Object.keys(scene.prefabDefinitions).map(ref)
  scene.presetSnapshot = { presetId: 'gray-oak-room-v1', presetVersion: 1, distanceMode: 'metric', source: `原创灰橡主题；用途布置算法20；${presetId}；全尺寸家具和现存结果`, gridSizeMm: 1000 }
  scene.revision = 0
  namespaceRoomContent(scene)
  for (const row of input.parameters.arrangement.palette) row.ref.id = `gray-oak-${row.ref.id}`
  for (const room of furnished.report.rooms) for (const row of room.placed) row.definitionRef.id = `gray-oak-${row.definitionRef.id}`
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`主题房间无效：${checked.errors.map(issue => `${issue.entityId}:${issue.code}:${issue.message}`).join('；')}`)
  assertDoorwayClearances(checked.document, [{ openingId: 'themed-room-door', minWidthMm: 1000, approachDepthMm: 1000 }])
  return { document: checked.document, report: furnished.report, input }
}

export async function createThemedRoomProject(presetId: ThemedRoomPresetId, signal?: AbortSignal) {
  const source = createThemedRoomDocument(presetId, { sceneId: runtime.ids.nextId(), now: runtime.clock.now(), checkCancelled: () => signal?.throwIfAborted() })
  const artwork = REFINED_INTERIOR_ART.filter(art => !!source.document.assets[`gray-oak-refined-art-${art.key}`])
  const project = await materializeVisualArt(source.document, artwork, REFINED_INTERIOR_LICENSE, key => `gray-oak-refined-art-${key}`, signal)
  return { project, report: source.report, input: source.input }
}
