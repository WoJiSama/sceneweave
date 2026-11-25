import { z } from 'zod'
import type { ProjectBundle, ProjectData } from '../model/project.js'
import type { GroundSurfaceRef, PointMm, SceneDocument, SurfaceStyle, SurfaceRef, Vertex, Room, Wall, Opening, Prop, Note, Region, PrefabInstance, Path, TerrainArea } from '../model/scene.js'
import type { CompleteValidationOptions } from '../ports/resources.js'
import type { PreparationContext } from '../ports/runtime.js'
import { checkCancelled } from '../ports/resources.js'
import { captureProjectBundleInput, createMemoryResources, validateProjectBundle } from '../project/resources.js'
import { exportProject, importProject } from '../project/file.js'
import { assertFixedProjectCompatible } from '../project/history.js'
import { projectResourceHashes } from '../project/source-resources.js'
import { captureBytes, sha256Bytes } from '../project/binary.js'
import { canonicalJson, captureJson, cloneJson } from '../validation/json.js'
import { id, point } from '../validation/primitives.js'
import { extractTemplateFixedContent } from '../library/content.js'
import type { CatalogSelector } from '../library/types.js'
import { effectiveEditLocked } from '../commands/layers.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { pointInPolygon, roomPoints, propFootprint, polygonsOverlap, terrainPoints } from '../geometry/geometry.js'
import { roomFurnitureIds } from '../furnishing/room-members.js'
import { syncAggregatePlacements } from '../aggregates/placement-members.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { propPresentation, effectivePropShadow } from '../appearance/presentation.js'
import { addPropAppearanceSource, addSurfaceAppearanceSource, freezeEffectivePropAppearance, freezeEffectiveSurfaceAppearance, surfaceStyle } from '../appearance/graph.js'
import { createHistoryIdentity, createHistoryIdentityTrace } from '../history/identity.js'
import { placePropAtAttachmentAnchor } from '../attachments/commands.js'
import { propAttachmentMaterialized } from '../attachments/contact.js'
import type { PropAttachment } from '../attachments/contracts.js'
import { syncNewAttachmentProofs } from '../attachments/identity.js'
import { assertAllFloorPlayerProjections } from '../projection/projection.js'
import { wallEnvelopePolygons } from '../geometry/doorway-clearance.js'
import { assertCommandBudget, measureCommandBudget, type CommandBudgetUsage, type ManualTransactionBudget } from '../budget/command-budget.js'
import { emptyBudgetUsage } from '../budget/task-budget.js'
import { assessSceneTemplatePlacement, templateMetadata, templateResourceUsage } from './placement-budget.js'
import { bridgeDeckGeometry } from '../path-assembly/layout.js'
import { bridgeTemplateKeySchema } from '../path-assembly/contracts.js'
import { assemblyMemberFingerprint, assemblyRouteFingerprint } from '../path-assembly/validation.js'
import { SCENE_TEMPLATE_LIMITS, type SceneTemplateEntry } from './entry.js'

export { captureSceneTemplateEntries, SCENE_TEMPLATE_LIMITS, type SceneTemplateEntry } from './entry.js'
export interface SceneTemplateScope { roomIds: string[]; propIds: string[]; wallIds: string[]; openingIds: string[]; vertexIds: string[]; noteIds: string[]; maskIds: string[]; prefabIds: string[]; pathIds: string[]; terrainAreaIds: string[]; layerIds: string[]; attachmentSurfaceIds: string[]; attachmentIds: string[] }
const requestSchema = z.object({ name: z.string().trim().min(1).max(80), roomIds: z.array(id).max(32).default([]), bridgeId: id.optional(), revisesBridgeTemplate: bridgeTemplateKeySchema.optional(),
  noteIds: z.array(id).max(128).default([]), maskIds: z.array(id).max(32).default([]) }).strict()
  .refine(request => request.bridgeId ? !request.roomIds.length : !!request.roomIds.length && !request.revisesBridgeTemplate, '请选择一座桥或同一楼层的房间。')
const placementSchema = z.object({ floorId: id, layerId: id, supportRef: z.discriminatedUnion('kind', [z.object({ kind: z.literal('floor'), id }).strict(), z.object({ kind: z.literal('terrainArea'), id }).strict()]), anchorMm: point, quarterTurns: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }).strict()
export type SceneTemplatePlacement = z.infer<typeof placementSchema>
const stamp = '1970-01-01T00:00:00.000Z'
const geometryCollections = ['vertices', 'rooms', 'walls', 'openings', 'props', 'notes', 'regions', 'prefabInstances', 'paths', 'terrainAreas'] as const
const attachmentCollections = ['attachmentSurfaces', 'attachments'] as const
const fixedCollections = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
const fixedGraphCollections = ['sources', 'variants', 'prefabAppearanceTemplates', 'presentations'] as const
const edge = (a: string, b: string) => canonicalJson([a, b].sort())
const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) throw new Error('模板范围不能重复。'); return ids }

function roomTemplateAttachments(scene: SceneDocument, propIds: Set<string>, wallIds: ReadonlySet<string>) {
  const byOwner = new Map<string, string[]>(), bySurface = new Map<string, PropAttachment[]>()
  const attachmentSurfaceIds: string[] = [], included = new Set<string>()
  for (const surface of Object.values(scene.attachmentSurfaces ?? {})) {
    if (surface.owner.kind === 'wall' && wallIds.has(surface.owner.id)) throw new Error('房间模板暂不支持墙面挂接。')
    if (surface.owner.kind !== 'prop' || surface.feature.kind !== 'propTop') continue
    const owned = byOwner.get(surface.owner.id)
    if (owned) owned.push(surface.id)
    else byOwner.set(surface.owner.id, [surface.id])
  }
  const attachments = Object.values(scene.attachments ?? {})
  for (const row of attachments) {
    if (row.mode !== 'support') continue
    const children = bySurface.get(row.surfaceId)
    if (children) children.push(row)
    else bySurface.set(row.surfaceId, [row])
  }
  // A selected supporting prop brings its children, including an unassigned
  // floor prop whose physical root and position already match that host.
  for (const id of propIds) for (const surfaceId of byOwner.get(id) ?? []) {
    attachmentSurfaceIds.push(surfaceId)
    for (const row of bySurface.get(surfaceId) ?? []) {
      included.add(row.id)
      propIds.add(row.child.id)
    }
  }
  if (attachments.some(row => propIds.has(row.child.id) && !included.has(row.id))) throw new Error('模板物件仍有范围外或未支持的附着宿主。')
  return { attachmentSurfaceIds, attachmentIds: [...included] }
}

/** Review actual ownership before preparing bytes; never infer missing external dependencies. */
export function inspectSceneTemplate(scene: SceneDocument, raw: unknown): SceneTemplateScope {
  return inspectTemplateScope(scene, raw, false)
}

function inspectTemplateScope(scene: SceneDocument, raw: unknown, readingStoredTemplate: boolean): SceneTemplateScope {
  const request = requestSchema.parse(captureJson(raw))
  if (request.bridgeId) return inspectBridgeTemplate(scene, request.bridgeId, unique(request.noteIds), unique(request.maskIds))
  const roomIds = unique(request.roomIds), rooms = roomIds.map(id => {
    const room = scene.rooms[id]; if (!room) throw new Error(`模板房间不存在：${id}。`); return room
  })
  const floorId = rooms[0].floorId
  if (rooms.some(room => room.floorId !== floorId)) throw new Error('场景模板首版只支持同一楼层。')
  const edges = new Set(rooms.flatMap(room => room.boundaryVertexIds.map((a, i) => edge(a, room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length]))))
  for (const room of Object.values(scene.rooms)) if (!roomIds.includes(room.id) && room.boundaryVertexIds.some((a, i) => edges.has(edge(a, room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length])))) throw new Error(`模板边界仍与范围外房间${room.id}共墙；请明确包含完整建筑。`)
  const wallIds = Object.values(scene.walls).filter(wall => edges.has(edge(wall.startVertexId, wall.endVertexId))).map(wall => wall.id)
  if (wallIds.length !== edges.size) throw new Error('模板边界缺少完整实际墙段。')
  const openingIds = Object.values(scene.openings).filter(opening => wallIds.includes(opening.wallId)).map(opening => opening.id)
  const vertexIds = [...new Set(rooms.flatMap(room => room.boundaryVertexIds))]
  const roomSet = new Set(roomIds), propSet = new Set(roomFurnitureIds(scene, roomSet))
  // Earlier v1 templates could explicitly store independent floor props inside
  // the room outline. Retain their original spatial check only on capsule reads.
  if (readingStoredTemplate) {
    const outlines = rooms.map(room => roomPoints(scene, room))
    for (const prop of Object.values(scene.props)) if (prop.floorId === floorId && prop.roomId === undefined && prop.supportRef.kind === 'floor'
      && outlines.some(polygon => pointInPolygon(prop.positionMm, polygon) || polygonsOverlap(propFootprint(prop), polygon))) propSet.add(prop.id)
  }
  const attachments = roomTemplateAttachments(scene, propSet, new Set(wallIds)), propIds = [...propSet]
  for (const propId of propIds) {
    const prop = scene.props[propId]
    if (prop.floorId !== floorId || prop.roomId && !roomSet.has(prop.roomId) || prop.supportRef.kind !== 'floor' && (prop.supportRef.kind !== 'room' || !roomSet.has(prop.supportRef.id))) throw new Error(`物件${propId}依赖范围外支撑或房间，不能改挂。`)
  }
  const prefabIds: string[] = []
  for (const group of Object.values(scene.prefabInstances)) {
    const members = Object.values(group.members).flatMap(member => member.propId ?? [])
    if (members.some(id => propSet.has(id))) {
      if (!members.every(id => propSet.has(id))) throw new Error(`组合${group.id}跨越模板边界，请选择完整范围。`)
      prefabIds.push(group.id)
    }
  }
  const noteIds = unique(request.noteIds), maskIds = unique(request.maskIds), ids = new Set([...roomIds, ...wallIds, ...openingIds, ...vertexIds, ...propIds, ...prefabIds, ...noteIds, ...maskIds])
  for (const id of noteIds) {
    const note = scene.notes[id]
    if (!note || note.floorId !== floorId || note.anchor.type === 'entity' && !ids.has(note.anchor.entityId)) throw new Error(`注记${id}不存在、跨楼层或锚点不完整。`)
  }
  for (const id of maskIds) if (scene.regions[id]?.kind !== 'manualMask' || scene.regions[id].floorId !== floorId) throw new Error('只能明确携带同楼层玩家遮罩。')
  for (const id of ids) if (effectiveEditLocked(scene, id)) throw new Error(`提取涉及锁定对象、图层或祖先组：${id}。`)
  for (const group of Object.values(scene.aggregateCoordinates?.groups ?? {})) if (group.members.some(member => ids.has(member.id))) throw new Error('请先明确解除层级组关系，再保存完整场景模板；不能隐式丢弃组。')
  for (const group of Object.values(scene.scatterGroups)) if (Object.values(group.members).some(member => member.propId && ids.has(member.propId))) throw new Error('模板暂不提取散布人工记录。')
  for (const cluster of Object.values(scene.decorationClusters)) if (Object.values(cluster.members).some(member => member.entityId && ids.has(member.entityId))) throw new Error('模板暂不提取布景簇记录。')
  for (const collection of [scene.paths, scene.decorations, scene.decorationClusters]) for (const row of Object.values(collection)) {
    const refs: SurfaceRef[] = 'supportRefs' in row ? row.supportRefs : [row.supportRef]
    if (refs.some(ref => ids.has(ref.id))) throw new Error(`模板仍有未支持的路径或装饰依赖：${row.id}。`)
  }
  for (const connection of Object.values(scene.terrainConnections)) if (ids.has(connection.from.surfaceRef.id) || ids.has(connection.to.surfaceRef.id) || connection.openingId && ids.has(connection.openingId)) throw new Error('建筑仍与室外连接关联，请先处理完整连接范围。')
  for (const row of Object.values(scene.pathAttachments ?? {})) if (canonicalJson(row).split('"').some(value => ids.has(value))) throw new Error('建筑仍有外门道路附着关系。')
  return { roomIds, propIds, wallIds, openingIds, vertexIds, noteIds, maskIds, prefabIds, pathIds: [], terrainAreaIds: [], ...attachments,
    layerIds: [...new Set([...ids].map(id => scene.entityLayers[id]).filter(Boolean))] }
}

function inspectBridgeTemplate(scene: SceneDocument, bridgeId: string, noteIds: string[], maskIds: string[]): SceneTemplateScope {
  const path = scene.paths[bridgeId], assembly = path?.assembly, bridge = assembly?.bridge, deck = bridge && scene.terrainAreas[bridge.deckId]
  if (!bridge || !assembly || !deck) throw new Error('请选择一座带实际桥面的桥。')
  const propIds = new Set(Object.values(assembly.members).flatMap(member => member.state === 'placed' ? [member.propId] : []))
  for (const prop of Object.values(scene.props)) if (prop.supportRef.kind === 'terrainArea' && prop.supportRef.id === deck.id) propIds.add(prop.id)
  const prefabIds = Object.values(scene.prefabInstances).flatMap(group => {
    const members = Object.values(group.members).flatMap(member => member.propId ?? [])
    if (!members.some(id => propIds.has(id))) return []
    if (!members.every(id => propIds.has(id))) throw new Error('桥上组合含桥外成员，请先调整组成关系。')
    return [group.id]
  })
  const ids = new Set([path.id, deck.id, ...propIds, ...prefabIds, ...noteIds, ...maskIds])
  if ([...propIds].some(id => scene.props[id].supportRef.kind !== 'terrainArea' || scene.props[id].supportRef.id !== deck.id || scene.props[id].roomId)) {
    throw new Error('桥梁成员仍依赖桥面外的承托或房间，请先处理这些支撑。')
  }
  for (const id of noteIds) {
    const note = scene.notes[id]
    if (!note || note.floorId !== path.floorId || note.anchor.type === 'entity' && !ids.has(note.anchor.entityId)) throw new Error(`注记 ${id} 的锚点须随桥一起保存。`)
  }
  for (const id of maskIds) if (scene.regions[id]?.kind !== 'manualMask' || scene.regions[id].floorId !== path.floorId) throw new Error('只能明确携带同楼层玩家遮罩。')
  if (Object.values(scene.attachments ?? {}).some(row => ids.has(row.child.id)) || Object.values(scene.attachmentSurfaces ?? {}).some(row => ids.has(row.owner.id))
    || Object.values(scene.aggregateCoordinates?.groups ?? {}).some(group => group.members.some(member => ids.has(member.id)))
    || Object.values(scene.scatterGroups).some(group => Object.values(group.members).some(member => member.propId && propIds.has(member.propId)))
    || Object.values(scene.decorationClusters ?? {}).some(group => Object.values(group.members).some(member => member.entityId && ids.has(member.entityId)))) {
    throw new Error('桥上布置仍引用附着、层级组或散布。请先处理这些关系，再保存整桥。')
  }
  return { roomIds: [], propIds: [...propIds], wallIds: [], openingIds: [], vertexIds: [], noteIds, maskIds, prefabIds, attachmentSurfaceIds: [], attachmentIds: [],
    pathIds: [path.id], terrainAreaIds: [deck.id], layerIds: [...new Set([...ids].map(id => scene.entityLayers[id]).filter(Boolean))] }
}

function roots(project: ProjectData) {
  const selectors: CatalogSelector[] = [
    ...Object.values(project.document.props).flatMap(prop => prop.definitionRef ? [{ kind: 'prop' as const, definitionId: prop.definitionRef.id }] : []),
    ...Object.values(project.document.prefabInstances).map(group => ({ kind: 'prefab' as const, definitionId: group.definitionRef.id })),
    ...Object.values(project.document.paths).flatMap(path => {
      const recipe = path.assembly?.recipe
      if (!recipe) return []
      const result: CatalogSelector[] = []
      if (recipe.section.kind === 'prop' || recipe.section.kind === 'prefab') result.push({ kind: recipe.section.kind, definitionId: recipe.section.ref.id })
      if (recipe.lamps?.ref) result.push({ kind: 'prop', definitionId: recipe.lamps.ref.id })
      return result
    }),
  ]
  const sideAssets = Object.values(project.document.props).flatMap(prop => prop.volume?.sideAssetId ?? [])
  return extractTemplateFixedContent(project, selectors, [...Object.values(project.appearance.propSources), ...Object.values(project.appearance.surfaceSources)], sideAssets)
}

function* transformContentSteps(source: ProjectData, target: ProjectData, mapping: Record<string, string>, floorId: string, layerId: string, support: GroundSurfaceRef, origin: PointMm, anchor: PointMm, quarterTurns: number, elevation: number, bridgeTemplateKey?: string) {
  const bridgeTemplate = Object.values(source.document.paths)[0], sourceDeckId = bridgeTemplate?.assembly?.bridge?.deckId
  const transform = (p: PointMm): PointMm => {
    const x = p.x - origin.x, y = p.y - origin.y, rotated = quarterTurns === 0 ? { x, y } : quarterTurns === 1 ? { x: -y, y: x } : quarterTurns === 2 ? { x: -x, y: -y } : { x: y, y: -x }
    const result = { x: anchor.x + rotated.x, y: anchor.y + rotated.y }
    if (!Number.isSafeInteger(result.x) || !Number.isSafeInteger(result.y)) throw new Error('模板变换超出整数毫米范围。')
    return result
  }
  const style = (value: SurfaceStyle | null): SurfaceStyle | null => {
    if (!value) return null
    const copy = cloneJson(value)
    for (const paint of [copy.base, ...copy.overlays.map(overlay => overlay.paint)]) { paint.originMm = transform(paint.originMm); paint.rotationDeg = (paint.rotationDeg + quarterTurns * 90) % 360 }
    for (const overlay of copy.overlays) { overlay.id = mapping[overlay.id]; overlay.boundaryMm = overlay.boundaryMm.map(transform) }
    return copy
  }
  for (const collection of geometryCollections) for (const row of Object.values(source.document[collection])) {
    const copy = cloneJson(row) as Vertex | Room | Wall | Opening | Prop | Note | Region | PrefabInstance | Path | TerrainArea, oldId = copy.id
    copy.id = mapping[oldId]; copy.floorId = floorId
    if (!sourceDeckId) copy.editLocked = false
    if ('xMm' in copy) { const p = transform({ x: copy.xMm, y: copy.yMm }); copy.xMm = p.x; copy.yMm = p.y }
    if ('boundaryVertexIds' in copy) { copy.boundaryVertexIds = copy.boundaryVertexIds.map(id => mapping[id]); copy.supportRef = cloneJson(support); copy.groundElevationMm = elevation; copy.floorStyle = style(copy.floorStyle) }
    if ('startVertexId' in copy) { copy.startVertexId = mapping[copy.startVertexId]; copy.endVertexId = mapping[copy.endVertexId]; copy.topStyle = style(copy.topStyle) }
    if ('wallId' in copy) { copy.wallId = mapping[copy.wallId]; copy.offsetReferenceVertexId = mapping[copy.offsetReferenceVertexId] }
    if ('positionMm' in copy) {
      copy.positionMm = transform(copy.positionMm)
      const presentation = propPresentation(source.appearance, oldId)
      if (presentation?.mode !== 'nearSide') copy.rotationDeg = (copy.rotationDeg + quarterTurns * 90) % 360
      copy.supportRef = copy.supportRef.kind === 'room' ? { kind: 'room', id: mapping[copy.supportRef.id] }
        : copy.supportRef.id === sourceDeckId ? { kind: 'terrainArea', id: mapping[sourceDeckId] } : cloneJson(support)
      if (copy.roomId) copy.roomId = mapping[copy.roomId]
      if (copy.shadowOverride) copy.shadowOverride.directionDeg = (copy.shadowOverride.directionDeg + quarterTurns * 90) % 360
    }
    if ('anchorMm' in copy) { copy.anchorMm = transform(copy.anchorMm); copy.rotationDeg = (copy.rotationDeg + quarterTurns * 90) % 360; for (const member of Object.values(copy.members)) if (member.propId) member.propId = mapping[member.propId] }
    if ('anchor' in copy) { if (copy.anchor.type === 'point') copy.anchor.positionMm = transform(copy.anchor.positionMm); else copy.anchor.entityId = mapping[copy.anchor.entityId] }
    if ('centerlineMm' in copy) {
      const assembly = copy.assembly!, bridge = assembly.bridge!
      copy.centerlineMm = copy.centerlineMm.map(transform)
      copy.surfaceStyle = style(copy.surfaceStyle)
      bridge.deckId = mapping[bridge.deckId]; bridge.elevationMm += elevation; delete bridge.roadLinks
      if (bridgeTemplateKey) bridge.templateKey = bridgeTemplateKey
      else delete bridge.templateKey
      copy.supportRefs = [{ kind: 'terrainArea', id: bridge.deckId }]
      assembly.routeFingerprint = assemblyRouteFingerprint(copy)
      for (const member of Object.values(assembly.members)) if (member.state === 'placed') {
        const sourceId = member.propId
        member.propId = mapping[sourceId]
        if (assemblyMemberFingerprint(source.document.props[sourceId], source.document.entityLayers[sourceId]) === member.fingerprint) {
          member.fingerprint = assemblyMemberFingerprint(target.document.props[member.propId], layerId)
        }
      }
    }
    if ('coveragePriority' in copy) {
      const path = target.document.paths[mapping[bridgeTemplate.id]], recipe = path.assembly!.recipe
      const { outline } = bridgeDeckGeometry(path, recipe.shoulderMm, recipe.structure?.bridgehead)
      if (outline.length !== copy.boundaryMm.length) throw new Error('旋转后桥面顶点数量发生变化，请换一个桥梁朝向。')
      copy.boundaryMm = copy.boundaryMm.map((vertex, index) => ({ id: mapping[vertex.id], segmentId: mapping[vertex.segmentId], positionMm: outline[index] }))
      copy.surfaceStyle = style(copy.surfaceStyle); copy.groundElevationMm += elevation
      copy.coveragePriority = 1 + Math.max(0, ...Object.values(target.document.terrainAreas).filter(area => area.floorId === floorId).map(area => area.coveragePriority))
    } else if ('boundaryMm' in copy) copy.boundaryMm = copy.boundaryMm.map(transform)
    // Each union is restored into exactly its original collection.
    Object.assign(target.document[collection], { [copy.id]: copy }); target.document.entityLayers[copy.id] = layerId
    const propSource = source.appearance.propSources[oldId]
    if (propSource && 'positionMm' in copy) target.appearance.propSources[copy.id] = addPropAppearanceSource(target.appearance, copy, propSource)
    const surfaceSource = source.appearance.surfaceSources[oldId], currentStyle = surfaceStyle(target.document, copy.id)
    if (surfaceSource && currentStyle) target.appearance.surfaceSources[copy.id] = addSurfaceAppearanceSource(target.appearance, currentStyle, surfaceSource)
    const adjustments = source.appearance.instanceAdjustments[oldId]
    if (adjustments) target.appearance.instanceAdjustments[copy.id] = cloneJson(adjustments)
    yield
  }
  const doc = target.document, byChild = new Map<string, PropAttachment>()
  for (const surface of Object.values(source.document.attachmentSurfaces ?? {})) {
    const copy = cloneJson(surface)
    copy.id = mapping[surface.id]; copy.owner.id = mapping[surface.owner.id]
    ;(doc.attachmentSurfaces ??= {})[copy.id] = copy
    yield
  }
  for (const row of Object.values(source.document.attachments ?? {})) {
    if (row.mode !== 'support') throw new Error('房间模板只支持物件顶面承托。')
    const surface = source.document.attachmentSurfaces![row.surfaceId]
    if (quarterTurns && [surface.owner.id, row.child.id].some(id => propPresentation(source.appearance, id)?.mode === 'nearSide')) throw new Error('含近侧视承托物件的模板须保持原朝向。')
    const copy = cloneJson(row)
    copy.id = mapping[row.id]; copy.child.id = mapping[row.child.id]; copy.surfaceId = mapping[row.surfaceId]
    ;(doc.attachments ??= {})[copy.id] = copy
    byChild.set(copy.child.id, copy)
  }
  // Recompute in host order to keep exact integer positions at round-off
  // boundaries and preserve the original local anchor even after rotation.
  const positioned = new Set<string>()
  const position = (row: PropAttachment) => {
    if (positioned.has(row.id)) return
    const upstream = byChild.get(doc.attachmentSurfaces![row.surfaceId].owner.id)
    if (upstream) position(upstream)
    placePropAtAttachmentAnchor(doc, row)
    row.materialized = propAttachmentMaterialized(doc, row)
    positioned.add(row.id)
  }
  for (const row of byChild.values()) { position(row); yield }
}
function transformContent(...args: Parameters<typeof transformContentSteps>) { for (const _ of transformContentSteps(...args)) { /* synchronous extraction, no scene commit */ } }

function templateGeometryIds(scene: SceneDocument): string[] {
  const ids = geometryCollections.flatMap(key => Object.keys(scene[key]))
  for (const area of Object.values(scene.terrainAreas)) for (const vertex of area.boundaryMm) ids.push(vertex.id, vertex.segmentId)
  for (const id of [...ids]) for (const overlay of surfaceStyle(scene, id)?.overlays ?? []) ids.push(overlay.id)
  return [...ids, ...attachmentCollections.flatMap(key => Object.keys(scene[key] ?? {}))]
}

function freshMapping(project: ProjectData, context: PreparationContext): Record<string, string> {
  return Object.fromEntries(templateGeometryIds(project.document).map(id => [id, context.ids.nextId()]))
}

function templatePlacementIdentity(before: SceneDocument, after: SceneDocument, identity: ProjectData['historyIdentity'], runtime: PreparationContext, hasAttachments: boolean) {
  const trace = createHistoryIdentityTrace(identity, before, runtime, { initializeStructures: true })
  if (hasAttachments) syncNewAttachmentProofs(before, after, trace.capture(after))
  return trace.finish(after)
}

/** Complete-v1 capsule with neutral metadata; no source history or migration originals. */
export async function prepareSceneTemplate(input: ProjectBundle, raw: unknown, options: { validation: CompleteValidationOptions; runtime: PreparationContext }): Promise<SceneTemplateEntry> {
  const captured = captureProjectBundleInput(input), request = requestSchema.parse(captureJson(raw))
  const source = await validateProjectBundle(captured, options.validation), scope = inspectSceneTemplate(source.project.document, request)
  const selected = cloneJson(source.project), scene = selected.document, publicVisibility = createPublicVisibility(scene)
  // Templates freeze actual living content, never source-room automation memory.
  for (const room of Object.values(scene.rooms)) delete room.furnishingPlan
  for (const id of scope.roomIds) if (!publicVisibility.room(id)) scene.rooms[id].visibility = 'gm'
  const theme = scene.activeStyleThemeRef ? scene.styleThemes[scene.activeStyleThemeRef.id] : undefined
  for (const id of scope.propIds) {
    const prop = scene.props[id]
    if (!publicVisibility.prop(prop)) prop.visibility = 'gm'
    if (!prop.shadowOverride) {
      const shadow = effectivePropShadow(prop, propPresentation(selected.appearance, id), theme?.shadowPresets[prop.shadowClass])
      if (shadow) prop.shadowOverride = cloneJson(shadow)
      else prop.shadowClass = 'none'
    }
  }
  const scopes = [scope.vertexIds, scope.roomIds, scope.wallIds, scope.openingIds, scope.propIds, scope.noteIds, scope.maskIds, scope.prefabIds, scope.pathIds, scope.terrainAreaIds]
  geometryCollections.forEach((collection, i) => { Object.assign(scene, { [collection]: Object.fromEntries(scopes[i].map(id => [id, scene[collection][id]])) }) })
  const attachmentScopes = [scope.attachmentSurfaceIds, scope.attachmentIds]
  attachmentCollections.forEach((collection, i) => {
    if (attachmentScopes[i].length) Object.assign(scene, { [collection]: Object.fromEntries(attachmentScopes[i].map(id => [id, scene[collection]![id]])) })
    else delete scene[collection]
  })
  let frozen = { document: scene, historyIdentity: selected.historyIdentity, appearance: selected.appearance }
  for (const id of scope.propIds) frozen = freezeEffectivePropAppearance(frozen, id, scene.props[id])
  const surfaces = [...scope.roomIds, ...scope.wallIds, ...scope.pathIds, ...scope.terrainAreaIds]
  for (const id of surfaces) { const style = surfaceStyle(scene, id); if (style) frozen = freezeEffectiveSurfaceAppearance(frozen, id, style) }
  if (request.bridgeId) for (const member of Object.values(scene.paths[request.bridgeId].assembly!.members)) {
    if (member.state !== 'placed') continue
    const id = member.propId
    if (assemblyMemberFingerprint(source.project.document.props[id], source.project.document.entityLayers[id]) === member.fingerprint) {
      member.fingerprint = assemblyMemberFingerprint(scene.props[id], scene.entityLayers[id])
    }
  }
  selected.appearance = frozen.appearance
  selected.appearance.propSources = Object.fromEntries(scope.propIds.map(id => [id, frozen.appearance.propSources[id]]))
  selected.appearance.surfaceSources = Object.fromEntries(surfaces.flatMap(id => frozen.appearance.surfaceSources[id] ? [[id, frozen.appearance.surfaceSources[id]]] : []))
  selected.appearance.instanceAdjustments = Object.fromEntries([...scope.propIds, ...surfaces].flatMap(id => frozen.appearance.instanceAdjustments[id] ? [[id, frozen.appearance.instanceAdjustments[id]]] : []))
  const target = roots(selected), doc = target.document, floorId = Object.keys(doc.floors)[0], layerId = Object.keys(doc.userLayers)[0]
  const points = [...scope.vertexIds.map(id => ({ x: scene.vertices[id].xMm, y: scene.vertices[id].yMm })), ...scope.terrainAreaIds.flatMap(id => terrainPoints(scene.terrainAreas[id]))]
  const min = { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)) }, max = { x: Math.max(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)) }
  const margin = 5000, bounds = { x: 0, y: 0, width: max.x - min.x + margin * 2, height: max.y - min.y + margin * 2 }
  doc.exportBoundsMm = bounds; doc.floors[floorId].boundsMm = cloneJson(bounds)
  doc.title = request.name; doc.presetSnapshot = { ...doc.presetSnapshot, presetId: 'scene-template-v1', source: 'Sceneweave 场景模板' }
  const beforeAttachments = scope.attachmentSurfaceIds.length ? cloneJson(doc) : undefined
  const identity = beforeAttachments && createHistoryIdentity(beforeAttachments, options.runtime)
  transformContent(selected, target, freshMapping(selected, options.runtime), floorId, layerId, { kind: 'floor', id: floorId }, min, { x: margin, y: margin }, 0, 0, request.revisesBridgeTemplate)
  target.historyIdentity = beforeAttachments && identity ? templatePlacementIdentity(beforeAttachments, doc, identity, options.runtime, true) : createHistoryIdentity(doc, options.runtime)
  assertAllFloorPlayerProjections(doc, target.appearance)
  const bytes = await exportProject({ project: target, resources: source.resources }, options.validation)
  if (bytes.length > SCENE_TEMPLATE_LIMITS.bytes) throw new Error('场景模板超过32MiB。')
  checkCancelled(options.validation.signal)
  return { key: sha256Bytes(bytes), name: request.name, bytes }
}

/** External file/cold library reads always verify actual bytes, pixels and the finite template contract. */
export async function loadSceneTemplate(input: Uint8Array, validation: CompleteValidationOptions): Promise<ProjectBundle> {
  const bytes = captureBytes(input, SCENE_TEMPLATE_LIMITS.bytes), bundle = await importProject(bytes, validation), project = bundle.project, doc = project.document
  const floorId = Object.keys(doc.floors)[0], layerId = Object.keys(doc.userLayers)[0]
  const bridgeId = Object.keys(doc.paths)[0]
  if (Object.values(doc.rooms).some(room => room.furnishingPlan)) throw new Error('模板不能携带源房间的布置或删除记忆。')
  if (Object.keys(doc.floors).length !== 1 || Object.keys(doc.userLayers).length !== 1 || doc.presetSnapshot.presetId !== 'scene-template-v1' || doc.revision !== 0 || doc.createdAt !== stamp || doc.updatedAt !== stamp || project.appearance.layerAdjustments && Object.keys(project.appearance.layerAdjustments).length) throw new Error('文件不是中性完整场景模板。')
  for (const key of ['terrainEdges', 'terrainConnections', 'scatterGroups', 'decorations', 'decorationClusters', 'surfaceRules', 'pathAttachments'] as const) if (Object.keys(doc[key] ?? {}).length) throw new Error('场景模板包含未支持依赖。')
  if (doc.aggregateCoordinates || doc.regional || doc.mapMode !== 'scene' || doc.generationMetadata || doc.activeStyleThemeRef || doc.constraints.pathChecks.length || doc.constraints.entranceOpeningIds.length) throw new Error('场景模板含范围外工程状态。')
  const scope = inspectTemplateScope(doc, { name: doc.title, roomIds: Object.keys(doc.rooms), ...(bridgeId ? { bridgeId } : {}), noteIds: Object.keys(doc.notes), maskIds: Object.keys(doc.regions) }, true)
  if (scope.pathIds.length !== Object.keys(doc.paths).length || scope.terrainAreaIds.length !== Object.keys(doc.terrainAreas).length
    || scope.wallIds.length !== Object.keys(doc.walls).length || scope.vertexIds.length !== Object.keys(doc.vertices).length
    || scope.openingIds.length !== Object.keys(doc.openings).length || scope.prefabIds.length !== Object.keys(doc.prefabInstances).length
    || scope.attachmentSurfaceIds.length !== Object.keys(doc.attachmentSurfaces ?? {}).length || scope.attachmentIds.length !== Object.keys(doc.attachments ?? {}).length
    || bridgeId && doc.paths[bridgeId].assembly?.bridge?.roadLinks) throw new Error('模板包含范围外结构或源地图链接。')
  if (scope.propIds.length !== Object.keys(doc.props).length || Object.values(doc.entityLayers).some(id => id !== layerId) || Object.values(doc.rooms).some(room => room.supportRef.kind !== 'floor' || room.supportRef.id !== floorId || room.groundElevationMm !== 0)) throw new Error('场景模板包含范围外对象或支撑。')
  const closure = roots(project)
  const neutral = cloneJson(closure.document)
  neutral.title = doc.title; neutral.exportBoundsMm = cloneJson(doc.exportBoundsMm); neutral.floors[floorId].boundsMm = cloneJson(doc.floors[floorId].boundsMm)
  neutral.presetSnapshot = { ...neutral.presetSnapshot, presetId: 'scene-template-v1', source: 'Sceneweave 场景模板' }
  for (const key of geometryCollections) Object.assign(neutral, { [key]: cloneJson(doc[key]) })
  for (const key of attachmentCollections) if (doc[key] && Object.keys(doc[key]).length) Object.assign(neutral, { [key]: cloneJson(doc[key]) })
  neutral.entityLayers = cloneJson(doc.entityLayers)
  if (canonicalJson(neutral) !== canonicalJson(doc)) throw new Error('模板含范围外工程元数据、视觉效果或环境。')
  const live = new Set([floorId, ...templateGeometryIds(doc)])
  for (const key of ['propTokens', 'prefabTokens', 'outdoorTokens', 'terrainTokens', 'decorationTokens', 'surfaceRuleTokens', 'structureTokens', 'aggregateTokens', 'generationTokens', 'regionalTokens', 'presentationTokens'] as const) {
    const records = (project.historyIdentity as unknown as Record<string, unknown>)[key]
    if (records && Object.keys(records).some(id => !live.has(id))) throw new Error('模板不能携带范围外历史身份或墓碑。')
  }
  if (Object.keys(project.appearance.instanceAdjustments).some(id => !doc.props[id] && !surfaceStyle(doc, id))) throw new Error('模板含范围外外观调整。')
  for (const key of fixedCollections) if (canonicalJson(closure.document[key]) !== canonicalJson(doc[key])) throw new Error('模板含范围外固定内容。')
  for (const key of ['assets', 'licenses', 'licenseBindings', 'authoringSources'] as const) if (canonicalJson(closure[key]) !== canonicalJson(project[key])) throw new Error('模板资源闭包不精确。')
  for (const key of fixedGraphCollections) if (canonicalJson(closure.appearance[key] ?? {}) !== canonicalJson(project.appearance[key] ?? {})) throw new Error('模板固定外观闭包不精确。')
  assertAllFloorPlayerProjections(doc, project.appearance)
  return bundle
}

export interface SceneTemplatePreparationProgress {
  stage: 'reading' | 'assessing' | 'merging' | 'placing' | 'collisions' | 'resources' | 'validating' | 'ready'
  completed: number
  total: number
  profile?: ManualTransactionBudget
}
export interface SceneTemplatePreparationControl {
  /** Trusted host scheduler, never supplied by template JSON. */
  cooperate?: () => Promise<void>
  onProgress?: (progress: SceneTemplatePreparationProgress) => void
}

/** Trusted bounded executor, called only by the workspace preview lifecycle. */
export async function prepareSceneTemplatePlacement(input: ProjectBundle, templateBytes: Uint8Array, raw: unknown, options: { validation: CompleteValidationOptions; runtime: PreparationContext } & SceneTemplatePreparationControl): Promise<{ bundle: ProjectBundle; addedIds: string[]; operationCost: number; budgetProfile: ManualTransactionBudget; budgetUsage: CommandBudgetUsage }> {
  const captured = captureProjectBundleInput(input), bytes = captureBytes(templateBytes, SCENE_TEMPLATE_LIMITS.bytes), request = placementSchema.parse(captureJson(raw))
  const execution = { ...emptyBudgetUsage(), candidateAttempts: 1 }
  let profile: ManualTransactionBudget | undefined, clockStart = Date.parse(options.runtime.clock.now())
  const elapsed = () => {
    const now = Date.parse(options.runtime.clock.now())
    if (!Number.isFinite(now) || !Number.isFinite(clockStart)) throw new Error('模板准备时钟无效。')
    execution.activeExecutionMs += Math.max(0, Math.ceil(now - clockStart)); clockStart = now
  }
  const checkpoint = async (stage: SceneTemplatePreparationProgress['stage'], completed = 0, total = 0) => {
    checkCancelled(options.validation.signal); elapsed()
    if (profile) assertCommandBudget(profile, execution)
    options.onProgress?.({ stage, completed, total, ...(profile ? { profile } : {}) })
    await options.cooperate?.()
    clockStart = Date.parse(options.runtime.clock.now()); checkCancelled(options.validation.signal)
  }
  await checkpoint('reading')
  const current = await validateProjectBundle(captured, options.validation), template = await loadSceneTemplate(bytes, options.validation)
  await checkpoint('assessing')
  profile = assessSceneTemplatePlacement(current.project, template.project).profile
  await checkpoint('assessing', 1, 1)
  const project = cloneJson(current.project), doc = project.document
  if (!doc.floors[request.floorId] || doc.userLayers[request.layerId]?.floorId !== request.floorId || doc.userLayers[request.layerId].editLocked) throw new Error('目标楼层／图层不存在或已锁定。')
  const support = request.supportRef.kind === 'floor' ? doc.floors[request.supportRef.id] : doc.terrainAreas[request.supportRef.id]
  if (!support || request.supportRef.kind === 'floor' && support.id !== request.floorId || 'floorId' in support && support.floorId !== request.floorId || effectiveEditLocked(doc, support.id)) throw new Error('目标支撑不存在、跨楼层或已锁定。')
  assertFixedProjectCompatible(project, template.project)
  let merged = 0
  const merge = async (target: Record<string, unknown>, source: Record<string, unknown>) => { for (const [id, value] of Object.entries(source)) {
    if (Object.hasOwn(target, id)) { if (canonicalJson(target[id]) !== canonicalJson(value)) throw new Error(`模板固定内容或许可冲突：${id}。`) }
    else target[id] = cloneJson(value)
    if (++merged % 32 === 0) await checkpoint('merging', merged)
  } }
  for (const key of fixedCollections) await merge(doc[key], template.project.document[key])
  for (const key of fixedGraphCollections) { project.appearance[key] ??= {}; await merge(project.appearance[key]!, template.project.appearance[key] ?? {}) }
  for (const key of ['assets', 'licenses', 'authoringSources'] as const) await merge(project[key], template.project[key])
  const bindings = new Map(project.licenseBindings.map(binding => [`${binding.subjectKind}:${binding.subjectId}`, binding]))
  for (const binding of template.project.licenseBindings) {
    const existing = bindings.get(`${binding.subjectKind}:${binding.subjectId}`)
    if (existing) { if (canonicalJson(existing) !== canonicalJson(binding)) throw new Error('模板许可绑定冲突。') }
    else { const copy = cloneJson(binding); project.licenseBindings.push(copy); bindings.set(`${copy.subjectKind}:${copy.subjectId}`, copy) }
    if (++merged % 32 === 0) await checkpoint('merging', merged)
  }
  await checkpoint('merging', merged, merged)
  const mapping = freshMapping(template.project, options.runtime), addedIds = Object.values(mapping)
  const retained = new Set([...geometryIdentityIds(doc), ...Object.values(current.project.historyIdentity).flatMap(value => typeof value === 'object' && value ? Object.keys(value) : []), ...Object.values(doc).flatMap(value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [])])
  if (new Set(addedIds).size !== addedIds.length || addedIds.some(id => retained.has(id))) throw new Error('模板新身份重复或占用现有身份／墓碑。')
  let placed = 0
  for (const _ of transformContentSteps(template.project, project, mapping, request.floorId, request.layerId, request.supportRef, { x: 5000, y: 5000 }, request.anchorMm, request.quarterTurns, 'groundElevationMm' in support ? support.groundElevationMm : 0,
    Object.keys(template.project.document.paths).length ? sha256Bytes(bytes) : undefined)) {
    if (++placed % 32 === 0) await checkpoint('placing', placed, addedIds.length)
  }
  await checkpoint('placing', placed, placed)
  syncAggregatePlacements(current.project.document, doc, addedIds)
  const added = new Set(addedIds), existingProps = Object.values(current.project.document.props).filter(prop => prop.floorId === request.floorId && prop.blocksMovement)
  // The shared wall envelope inspects all wall pairs to form real miter/bevel joins.
  const wallCount = Object.keys(doc.walls).length
  execution.intersectionPairs += wallCount * (wallCount - 1) / 2
  await checkpoint('collisions')
  const walls = wallEnvelopePolygons(doc).filter(row => row.floorId === request.floorId), newWalls = walls.filter(row => added.has(row.entityId)), oldWalls = walls.filter(row => !added.has(row.entityId))
  let comparisons = 0
  const overlap = (a: PointMm[], b: PointMm[]) => {
    execution.intersectionPairs += a.length * b.length
    if (execution.intersectionPairs > profile!.limits.intersectionPairs) assertCommandBudget(profile!, execution)
    return polygonsOverlap(a, b)
  }
  for (const prop of existingProps) for (const wall of newWalls) {
    if (overlap(wall.polygon, propFootprint(prop))) throw new Error(`模板新墙与现有阻挡家具${prop.id}冲突；请调整位置。`)
    if (++comparisons % 256 === 0) await checkpoint('collisions', comparisons)
  }
  const existingFootprints = [...existingProps.map(propFootprint), ...oldWalls.map(wall => wall.polygon)]
  for (const prop of Object.values(doc.props).filter(prop => added.has(prop.id) && prop.blocksMovement)) {
    const footprint = propFootprint(prop)
    for (const other of existingFootprints) {
      if (overlap(footprint, other)) throw new Error(`模板家具${prop.id}与现有阻挡家具或墙体冲突；请调整位置。`)
      if (++comparisons % 256 === 0) await checkpoint('collisions', comparisons)
    }
  }
  await checkpoint('collisions', comparisons, comparisons)
  project.historyIdentity = templatePlacementIdentity(current.project.document, doc, current.project.historyIdentity, options.runtime, !!Object.keys(template.project.document.attachmentSurfaces ?? {}).length)
  const beforeMetadata = templateMetadata(current.project), afterMetadata = templateMetadata(project)
  const measure = () => {
    const usage = measureCommandBudget(current.project.document, doc, { before: current.project, after: project }, execution, profile)
    return assertCommandBudget(profile!, { ...usage, ...templateResourceUsage(project),
      metadataRecords: usage.metadataRecords + Math.max(0, afterMetadata.metadataRecords - beforeMetadata.metadataRecords),
      metadataBytes: usage.metadataBytes + Math.max(0, afterMetadata.metadataBytes - beforeMetadata.metadataBytes) })
  }
  measure() // Reject the actual expanded closure before resource assembly/decoding.
  const resourceBytes = new Map<string, Uint8Array>(), hashes = projectResourceHashes(project), currentHashes = new Set(projectResourceHashes(current.project))
  for (const [index, hash] of hashes.entries()) {
    const owner = currentHashes.has(hash) ? current : template
    resourceBytes.set(hash, await owner.resources.read(hash))
    await checkpoint('resources', index + 1, hashes.length)
  }
  await checkpoint('validating')
  const bundle = await validateProjectBundle({ project, resources: createMemoryResources(resourceBytes) }, options.validation)
  assertAllFloorPlayerProjections(bundle.project.document, bundle.project.appearance)
  await checkpoint('ready', 1, 1)
  const budgetUsage = measure()
  return { bundle, addedIds, operationCost: budgetUsage.semanticTargets, budgetProfile: profile, budgetUsage }
}
