import { createRefinedInteriorProject } from '../../src/platform/browser/content/refined-interior.js'
import { createRefinedIslandProject } from '../../src/platform/browser/content/refined-island.js'
import { createMixedBlankProject } from '../../src/platform/browser/content/factories.js'
import { validation } from '../../src/platform/browser/runtime.js'
import { prepareMixedProject } from '../../src/application/workspace/mixed.js'
import { fromBundle, toBundle } from '../../src/application/workspace/project.js'
import { syncAppearanceGraph } from '../../src/shared/appearance/graph.js'
import { prepareCompositionCommands } from '../../src/application/workspace/prepare.js'
import { createHistoryIdentity } from '../../src/shared/history/identity.js'
import { buildingAggregateMembers } from '../../src/shared/commands/building.js'
import { naturalAggregateMembers, inspectAggregateDomain } from '../../src/shared/aggregates/domain-adapters.js'
import { defaultMixedInput } from '../../src/shared/generation/domains/mixed/index.js'
import { taskBudgetProfile } from '../../src/shared/budget/task-budget.js'
import { selectManualTransactionBudget } from '../../src/shared/budget/command-budget.js'
import { propFootprint, pointInPolygon, polygonsOverlap, roomPoints, openingEndpoints, supportedPolygon, supportSurfaceAt } from '../../src/shared/geometry/geometry.js'
import { decorationAsProp, decorationFootprint } from '../../src/shared/decorations/geometry.js'
import { effectivePropShadow, nearSidePaintEnvelope, propPaintPolygon, propPresentation } from '../../src/shared/appearance/presentation.js'
import { exportProject, importProject } from '../../src/shared/project/file.js'
import { projectContentHash } from '../../src/shared/project/validate.js'
import { sha256Text, sha256Bytes } from '../../src/shared/validation/hash.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../../src/shared/validation/json.js'
import { validateSceneDocument } from '../../src/shared/validation/scene.js'
import { visualBase } from '../../src/shared/visual/base.js'
import { detachChangedOutputs } from '../../src/shared/terrain-generation/integrity.js'
import { projectScene, pointsBounds, shadowPadding } from '../../src/shared/projection/projection.js'
import type { BoundsMm, Decoration, PointMm, Prop, PropDefinition, SceneDocument, SurfaceRef } from '../../src/shared/model/scene.js'
import type { EditableProject } from '../../src/application/workspace/project.js'
import type { AppearanceGraph, CompositionContent } from '../../src/shared/model/appearance.js'

export type AggregateCapacityKind = 'building' | 'natural' | 'mixed'
export interface AggregateCapacityVariant { remoteExtraDetails?: 0 | 500; extraExternalConnections?: 0 | 16 }
export const AGGREGATE_CAPACITY_FIXTURE_VERSION = 'aggregate-capacity-complex-v1' as const
const stamp = '2026-11-06T00:00:00.000Z'
const count = (value: object) => Object.keys(value).length
const point = (x: number, y: number): PointMm => ({ x, y })
const ref = (definition: PropDefinition) => ({ id: definition.id, version: definition.version })
const contextFor = (kind: AggregateCapacityKind) => {
  let sequence = 0
  return { ids: { nextId: () => `capacity-${kind}-identity-${sequence++}` }, clock: { now: () => stamp } }
}
const complexBases = new Map<AggregateCapacityKind, Promise<EditableProject>>()
function complexBase(kind: AggregateCapacityKind): Promise<EditableProject> {
  let existing = complexBases.get(kind)
  if (!existing) {
    existing = (async () => {
      if (kind === 'building') return createRefinedInteriorProject()
      if (kind === 'natural') return createRefinedIslandProject()
      const base = await createMixedBlankProject('forest', { title: '混合容量基底', widthMm: 40000, heightMm: 30000, preset: 'narrative', sceneId: 'capacity-mixed-source', now: stamp })
      return (await prepareMixedProject(base, defaultMixedInput(base.document, 'forest', 'capacity-mixed-fixed'),
        { runtime: contextFor(kind), validation, profile: taskBudgetProfile('expanded'), nowMilliseconds: () => 0 })).project
    })()
    complexBases.set(kind, existing)
  }
  return existing
}

function placedProp(scene: SceneDocument, id: string, definition: PropDefinition, positionMm: PointMm, supportRef: SurfaceRef, index: number): Prop {
  const scale = .5 + index % 4 * .025, v = definition.defaultVisualBoundsMm, footprint = definition.defaultFootprintMm
  return { id, floorId: Object.keys(scene.floors)[0], editLocked: false, visibility: 'public', definitionRef: ref(definition),
    appearance: captureJson(definition.defaultAppearance), positionMm, rotationDeg: index * 47 % 360,
    visualBoundsMm: { x: Math.round(v.x * scale), y: Math.round(v.y * scale), width: Math.max(1, Math.round(v.width * scale)), height: Math.max(1, Math.round(v.height * scale)) },
    footprintMm: { width: Math.max(1, Math.round(footprint.width * scale)), height: Math.max(1, Math.round(footprint.height * scale)) },
    footprintOffsetMm: { x: Math.round(definition.defaultFootprintOffsetMm.x * scale), y: Math.round(definition.defaultFootprintOffsetMm.y * scale) },
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, supportRef,
    ...(supportRef.kind === 'room' ? { roomId: supportRef.id } : {}), renderLayer: definition.defaultRenderLayer,
    renderOrder: index % 50, shadowClass: definition.defaultShadowClass, shadowOverride: null }
}

/** World-fixed privacy masks deliberately remain outside the moving group.
 * Cover only the old/new sensitive paint envelopes, never the whole map. */
function fixedPrivacyMasks(scene: SceneDocument, prefix: string, privateMemberId: string, appearance?: AppearanceGraph) {
  const floorId = scene.props[privateMemberId].floorId, floor = scene.floors[floorId].boundsMm
  const layerId = scene.entityLayers[privateMemberId], offset = point(1000, 0)
  const theme = scene.activeStyleThemeRef ? scene.styleThemes[scene.activeStyleThemeRef.id] : undefined
  const visual = visualBase(scene), maskIds: string[] = []
  const expand = (bounds: BoundsMm, padding: number): BoundsMm => ({ x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + 2 * padding, height: bounds.height + 2 * padding })
  const install = (id: string, bounds: BoundsMm) => {
    const x = Math.max(floor.x, Math.floor(bounds.x - 32)), y = Math.max(floor.y, Math.floor(bounds.y - 32))
    const right = Math.min(floor.x + floor.width, Math.ceil(bounds.x + bounds.width + offset.x + 32))
    const bottom = Math.min(floor.y + floor.height, Math.ceil(bounds.y + bounds.height + offset.y + 32))
    scene.regions[id] = { id, floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1,
      boundaryMm: [point(x, y), point(right, y), point(right, bottom), point(x, bottom)] }
    scene.entityLayers[id] = layerId; maskIds.push(id)
  }
  const prop = scene.props[privateMemberId], presentation = appearance ? propPresentation(appearance, privateMemberId) : undefined
  const shadow = effectivePropShadow(prop, presentation, theme?.shadowPresets[prop.shadowClass])
  const contactBlur = presentation?.mode === 'nearSide' && shadow && visual?.environment.contactShadowOpacity ? visual.environment.contactShadowMm : null
  const envelope = nearSidePaintEnvelope(prop, presentation, shadow, visual?.environment.lightDirectionDeg, contactBlur)
    ?? expand(pointsBounds(propPaintPolygon(prop, presentation)), shadowPadding(shadow))
  install(`${prefix}-private-prop-mask`, envelope)
  for (const opening of Object.values(scene.openings)) if (opening.secret && !opening.revealed) {
    const wall = scene.walls[opening.wallId]
    install(`${prefix}-secret-opening-mask-${opening.id}`, expand(pointsBounds(openingEndpoints(scene, opening)), wall.thicknessMm / 2 + shadowPadding(theme?.shadowPresets.wall)))
  }
  return maskIds
}

/** The same finite composition command path used by the normal UI. This is
 * preparation-only correctness evidence, outside every measured operation. */
export function assertAggregateCapacityPlayerPrivacy(content: CompositionContent, moved: CompositionContent, controls: ReturnType<typeof buildAggregateCapacityDocument>['controls']) {
  const before = projectScene(content.document, 'player', content.appearance)
  const after = projectScene(moved.document, 'player', moved.appearance)
  const masks = Object.values(content.document.regions).filter(row => row.kind === 'manualMask')
  for (const mask of masks) if (canonicalJson(mask) !== canonicalJson(moved.document.regions[mask.id])) throw new Error('固定玩家遮罩被错误纳入组内随动。')
  for (const value of [before, after]) if (canonicalJson(value).includes('CAPACITY_PRIVATE_SENTINEL') || value.props.some(prop => prop.id === controls.privateMemberId)) throw new Error('容量夹具玩家投影泄露私密物件或注记。')
  return { originalAndMovedPlayerProjection: true, fixedMasksRemainWorldAnchored: true, fixedMaskIds: masks.map(row => row.id),
    boundary: 'Appearance-aware original/moved player projection; does not establish PNG pixel/privacy acceptance.' }
}
export async function preflightAggregateCapacityPrivacy(project: EditableProject, controls: ReturnType<typeof buildAggregateCapacityDocument>['controls'], kind: AggregateCapacityKind) {
  const command = { type: controls.domain === 'building' ? 'transformAggregateBuilding' as const : 'transformAggregateNatural' as const,
    id: controls.groupId, offsetMm: controls.offsetMm, pivotMm: controls.pivotMm, quarterTurns: controls.quarterTurns }
  const moved = await prepareCompositionCommands(project, [command], { runtime: contextFor(kind), validation, baseline: project,
    budget: selectManualTransactionBudget(project.document, 1, inspectAggregateDomain(project.document, controls.groupId, controls.domain).members.length),
  })
  return { ...assertAggregateCapacityPlayerPrivacy(project, moved, controls),
    completePreparation: 'Normal prepareCompositionCommands materializes real required bitmaps and validates exact resources/licenses before the moved player projection. Preparation only; no input-package mutation.' }
}

/** Pure tooling seam: authored/generated geometry remains the complex base. Added
 * detail is an explicit deterministic density load, not an art-quality sample
 * or a claim that the generated algorithm produced 500/2000 natural objects. */
export function buildAggregateCapacityDocument(kind: AggregateCapacityKind, detailCount: number, source: SceneDocument, variant: AggregateCapacityVariant = {}) {
  if (!['building', 'natural', 'mixed'].includes(kind) || !Number.isSafeInteger(detailCount) || detailCount < 120 || detailCount > 2000) throw new Error('容量夹具须选择建筑/自然/混合与120–2000个真实物件及轻量装饰。')
  const scene = captureJson(source), originalCounts = { props: count(source.props), decorations: count(source.decorations), rooms: count(source.rooms), walls: count(source.walls),
    terrainAreas: count(source.terrainAreas), paths: count(source.paths), connections: count(source.terrainConnections) }
  const originalDocumentHash = sha256Text(canonicalJson(source)), floorId = Object.keys(scene.floors)[0]
  const prefix = `capacity-${kind}`, layerId = 'visual-layer-props' in scene.userLayers ? 'visual-layer-props' : Object.keys(scene.userLayers)[0]
  const groundLayerId = 'visual-layer-ground' in scene.userLayers ? 'visual-layer-ground' : layerId
  const originalTerrainIds = Object.keys(scene.terrainAreas), originalRoomIds = Object.keys(scene.rooms)
  if (Object.keys(scene.floors).length !== 1 || kind === 'building' && !originalRoomIds.length || kind !== 'building' && !originalTerrainIds.length) throw new Error('容量夹具需要相应领域的完整复杂基底。')
  Object.assign(scene, { sceneId: `${prefix}-scene`, title: `容量整合 · ${kind} · ${detailCount}`, revision: 0, createdAt: stamp, updatedAt: stamp })
  scene.floors[floorId].boundsMm = { x: 0, y: 0, width: 180000, height: 180000 }
  const extensionIds: string[] = [], focusTerrainIds = [...originalTerrainIds]
  if (kind === 'building') {
    // One real annex shares the source inn's existing two east-wall segments.
    // No duplicate shared wall or scaled-away physical footprint is introduced.
    const shared = ['q2-wall-vertical-3-0', 'q2-wall-vertical-3-1'].map(id => scene.walls[id])
    if (shared.some(wall => !wall)) throw new Error('建筑容量基底缺少精修旅舍的确切共享东墙。')
    const top = scene.vertices[shared[0].startVertexId], bottom = scene.vertices[shared[1].endVertexId], mid = shared[0].endVertexId
    const topRight = `${prefix}-annex-ne`, bottomRight = `${prefix}-annex-se`, roomId = `${prefix}-annex`
    scene.vertices[topRight] = { id: topRight, floorId, editLocked: false, xMm: 100000, yMm: top.yMm }
    scene.vertices[bottomRight] = { id: bottomRight, floorId, editLocked: false, xMm: 100000, yMm: bottom.yMm }
    const edges = [[top.id, topRight], [topRight, bottomRight], [bottomRight, bottom.id]]
    edges.forEach(([startVertexId, endVertexId], index) => {
      const id = `${prefix}-annex-wall-${index}`
      scene.walls[id] = { ...captureJson(shared[0]), id, startVertexId, endVertexId }; scene.entityLayers[id] = groundLayerId; extensionIds.push(id)
    })
    scene.rooms[roomId] = { ...captureJson(scene.rooms[originalRoomIds[0]]), id: roomId, purpose: '容量夹具：与旅舍共墙的宽敞展厅',
      boundaryVertexIds: [top.id, topRight, bottomRight, bottom.id, mid], accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: floorId }, groundElevationMm: 0 }
    const yard = scene.terrainAreas[originalTerrainIds[0]]
    // Extend the existing real foundation instead of overlaying it with an
    // unsplit competing surface or pretending its covered Floor is available.
    yard.boundaryMm[1].positionMm.x = 102000
    yard.boundaryMm[2].positionMm.x = 102000
    scene.rooms[roomId].supportRef = { kind: 'terrainArea', id: yard.id }
    const doorId = `${prefix}-annex-secret-door`
    scene.openings[doorId] = { id: doorId, floorId, editLocked: false, wallId: shared[0].id, offsetReferenceVertexId: shared[0].startVertexId,
      offsetMm: 2000, widthMm: 1400, kind: 'door', state: 'closed', locked: false, secret: true, revealed: false }
    for (const id of [topRight, bottomRight, roomId, doorId]) { scene.entityLayers[id] = groundLayerId; extensionIds.push(id) }
    scene.exportBoundsMm = { x: 0, y: 0, width: 102000, height: 19000 }
  } else {
    const id = `${prefix}-focus-extension`, template = scene.terrainAreas[originalTerrainIds.find(id => /low|ground/.test(id)) ?? originalTerrainIds[0]]
    const ring = [point(50000, 1000), point(102000, 1000), point(102000, 60000), point(50000, 60000)]
    scene.terrainAreas[id] = { ...captureJson(template), id, groundElevationMm: 0, coveragePriority: 0, blocksMovement: false, blocksSight: false,
      surfaceStyle: template.surfaceStyle ? { base: captureJson(template.surfaceStyle.base), overlays: [] } : null,
      boundaryMm: ring.map((positionMm, index) => ({ id: `${id}-p${index}`, segmentId: `${id}-s${index}`, positionMm })) }
    scene.entityLayers[id] = groundLayerId; extensionIds.push(id); focusTerrainIds.push(id)
    const roadId = `${prefix}-extension-path`
    scene.paths[roadId] = { id: roadId, floorId, editLocked: false, visibility: 'public', centerlineMm: [point(55000, 58000), point(97000, 58000)],
      widthMm: 1600, supportRefs: [{ kind: 'terrainArea', id }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    scene.entityLayers[roadId] = groundLayerId; extensionIds.push(roadId)
    scene.exportBoundsMm = { x: 0, y: 0, width: 104000, height: 62000 }
  }
  const focusBounds = captureJson(scene.exportBoundsMm)
  const remoteAreaId = `${prefix}-remote-ground`, remoteBounds = { x: 130000, y: 130000, width: 46000, height: 46000 }
  const remoteRing = [point(130000, 130000), point(176000, 130000), point(176000, 176000), point(130000, 176000)]
  scene.terrainAreas[remoteAreaId] = { id: remoteAreaId, floorId, editLocked: false, visibility: 'public',
    boundaryMm: remoteRing.map((positionMm, i) => ({ id: `${remoteAreaId}-p${i}`, segmentId: `${remoteAreaId}-s${i}`, positionMm })),
    groundElevationMm: 1000, coveragePriority: 0, surfaceStyle: (() => { const style = Object.values(scene.terrainAreas)[0]?.surfaceStyle ?? Object.values(scene.rooms)[0]?.floorStyle; return style ? { base: captureJson(style.base), overlays: [] } : null })(),
    blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.entityLayers[remoteAreaId] = groundLayerId
  // A genuine road near the focus and a distant stair/road stay outside the
  // moving closure; their complete Floor/support geometry remains validated.
  const externalRoadId = `${prefix}-outside-road`, roadX = focusBounds.x + focusBounds.width + 3500
  scene.paths[externalRoadId] = { id: externalRoadId, floorId, editLocked: false, visibility: 'public', centerlineMm: [point(roadX, 4000), point(roadX, 13000)],
    widthMm: 1200, supportRefs: [{ kind: 'floor', id: floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  const remoteRoadId = `${prefix}-remote-road`
  scene.paths[remoteRoadId] = { ...captureJson(scene.paths[externalRoadId]), id: remoteRoadId, centerlineMm: [point(120000, 126000), point(128000, 126000)] }
  const remoteConnectionId = `${prefix}-remote-stairs`
  scene.terrainConnections[remoteConnectionId] = { id: remoteConnectionId, floorId, editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'floor', id: floorId }, positionMm: point(127000, 137000) },
    to: { surfaceRef: { kind: 'terrainArea', id: remoteAreaId }, positionMm: point(132000, 137000) }, widthMm: 1200,
    openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
  for (const id of [externalRoadId, remoteRoadId, remoteConnectionId]) scene.entityLayers[id] = groundLayerId
  const extraExternalConnections = variant.extraExternalConnections ?? 0, remoteExtraDetails = variant.remoteExtraDetails ?? 0
  if (![0, 16].includes(extraExternalConnections) || ![0, 500].includes(remoteExtraDetails) || Object.keys(variant).some(key => !['extraExternalConnections', 'remoteExtraDetails'].includes(key))) throw new Error('容量夹具变体只支持500个额外远端细节或16条额外外部连接。')
  for (let i = 0; i < extraExternalConnections; i++) {
    const id = `${prefix}-extra-external-stairs-${i}`
    scene.terrainConnections[id] = { ...captureJson(scene.terrainConnections[remoteConnectionId]), id,
      from: { surfaceRef: { kind: 'floor', id: floorId }, positionMm: point(127000, 130600 + i * 1200) },
      to: { surfaceRef: { kind: 'terrainArea', id: remoteAreaId }, positionMm: point(131000, 130600 + i * 1200) }, widthMm: 600 }
    scene.entityLayers[id] = groundLayerId
  }
  const definitions = Object.values(scene.propDefinitions).filter(definition => definition.defaultAppearance.kind === 'image' && !/terrain-variants/.test(definition.id))
  const compact = definitions.filter(definition => !definition.defaultBlocksMovement && !definition.defaultBlocksSight && definition.defaultAppearance.kind === 'image' && definition.defaultAppearance.tint === null)
  if (!definitions.length || !compact.length) throw new Error('复杂容量基底缺少真实图片物件或无阻挡装饰来源。')
  const interior = (definition: PropDefinition) => /interior/.test(definition.id)
  const candidates = (support: SurfaceRef, lightweight: boolean) => {
    const pool = lightweight ? compact : definitions, preferred = pool.filter(definition => support.kind === 'room' ? interior(definition) : !interior(definition))
    return preferred.length ? preferred : pool
  }
  const focusTarget = Math.round(detailCount * .9), remoteTarget = detailCount - focusTarget
  const focusAdded: string[] = [], remoteAdded: string[] = []
  const originalDetails = count(scene.props) + count(scene.decorations)
  if (originalDetails >= focusTarget) throw new Error('复杂基底已超过本次细节目标，请提高夹具规模。')
  const roomCache = Object.values(scene.rooms).map(room => ({ room, polygon: roomPoints(scene, room) }))
  const doorCenters = Object.values(scene.openings).filter(opening => opening.kind === 'door').map(opening => {
    const [a, b] = openingEndpoints(scene, opening); return point((a.x + b.x) / 2, (a.y + b.y) / 2)
  })
  const cells = new Map<string, PointMm[][]>()
  const keys = (polygon: PointMm[]) => {
    const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y), result: string[] = []
    for (let x = Math.floor(Math.min(...xs) / 1000); x <= Math.floor(Math.max(...xs) / 1000); x++) for (let y = Math.floor(Math.min(...ys) / 1000); y <= Math.floor(Math.max(...ys) / 1000); y++) result.push(`${x}:${y}`)
    return result
  }
  const reserve = (polygons: PointMm[][]) => { for (const polygon of polygons) for (const key of keys(polygon)) { const rows = cells.get(key) ?? []; rows.push(polygon); cells.set(key, rows) } }
  const available = (polygons: PointMm[][]) => polygons.every(polygon => {
    if (polygon.some(p => p.x < 2 || p.y < 2 || p.x > 179998 || p.y > 179998)) return false
    const neighbors = new Set(keys(polygon).flatMap(key => cells.get(key) ?? []))
    return [...neighbors].every(previous => !polygonsOverlap(previous, polygon))
  })
  for (const row of Object.values(scene.props)) reserve([propPaintPolygon(row), propFootprint(row)])
  for (const row of Object.values(scene.decorations)) reserve([propPaintPolygon(decorationAsProp(scene, row)), decorationFootprint(scene, row)])
  const supportAt = (position: PointMm): SurfaceRef | null => {
    const room = roomCache.find(value => pointInPolygon(position, value.polygon))?.room
    if (room) return { kind: 'room', id: room.id }
    if (kind === 'building') return null
    const support = supportSurfaceAt(scene, position, floorId)
    return support?.kind === 'terrainArea' && focusTerrainIds.includes(support.id) ? support : null
  }
  const install = (position: PointMm, supportRef: SurfaceRef, index: number, remote: boolean, attempt = index): boolean => {
    const lightweight = index % 4 !== 0, palette = candidates(supportRef, lightweight), definition = palette[attempt % palette.length]
    const id = `${prefix}-${remote ? 'remote' : 'focus'}-${String(index).padStart(4, '0')}`
    if (!remote && doorCenters.some(center => Math.abs(position.x - center.x) < 1500 && Math.abs(position.y - center.y) < 1500)) return false
    let polygons: PointMm[][]
    if (lightweight) {
      const row: Decoration = { id, floorId, editLocked: false, visibility: 'public', definitionRef: ref(definition), supportRef,
        positionMm: position, rotationDeg: index * 47 % 360, scalePpm: 500000 + index % 4 * 25000, renderOrder: index % 50 }
      scene.decorations[id] = row
      polygons = [propPaintPolygon(decorationAsProp(scene, row)), decorationFootprint(scene, row)]
      if (!supportedPolygon(scene, polygons[1], supportRef, floorId) || !available(polygons)) { delete scene.decorations[id]; return false }
    } else {
      const row = placedProp(scene, id, definition, position, supportRef, index)
      polygons = [propPaintPolygon(row), propFootprint(row)]
      if (!supportedPolygon(scene, polygons[1], supportRef, floorId) || !supportedPolygon(scene, polygons[1].map(p => point(p.x + 2, p.y)), supportRef, floorId) || !available(polygons)) return false
      scene.props[id] = row
    }
    reserve(polygons)
    scene.entityLayers[id] = layerId; (remote ? remoteAdded : focusAdded).push(id)
    return true
  }
  let index = 0, attempt = 0
  for (let y = focusBounds.y + 600; y < focusBounds.y + focusBounds.height - 600 && originalDetails + focusAdded.length < focusTarget; y += 300) {
    for (let x = focusBounds.x + 600; x < focusBounds.x + focusBounds.width - 600 && originalDetails + focusAdded.length < focusTarget; x += 300) {
      const position = point(x + index % 3 * 17, y + index % 5 * 13), support = supportAt(position)
      if (support && install(position, support, index, false, attempt++)) index++
    }
  }
  if (originalDetails + focusAdded.length !== focusTarget) throw new Error(`复杂容量基底的有效支撑耗尽：${originalDetails + focusAdded.length}/${focusTarget}。`)
  let remoteAttempt = 0
  for (let y = 132000; y < 174000 && remoteAdded.length < remoteTarget + remoteExtraDetails; y += 350) for (let x = 132000; x < 174000 && remoteAdded.length < remoteTarget + remoteExtraDetails; x += 350) {
    install(point(x, y), { kind: 'terrainArea', id: remoteAreaId }, remoteAdded.length, true, remoteAttempt++)
  }
  if (remoteAdded.length !== remoteTarget + remoteExtraDetails) throw new Error(`远端有效支撑耗尽：${remoteAdded.length}/${remoteTarget + remoteExtraDetails}。`)
  // Prepared manual records are explicit fixture input. The measured edit does
  // not normalize managed slots, erase deleted slots or regenerate any seed.
  for (const group of Object.values(scene.prefabInstances)) for (const member of Object.values(group.members)) if (member.propId) member.overrideFields = [...new Set([...member.overrideFields, 'positionMm' as const, 'rotationDeg' as const])]
  for (const group of Object.values(scene.scatterGroups)) for (const member of Object.values(group.members)) if (member.propId && member.state !== 'deleted' && member.state !== 'detached') {
    member.state = 'manual'; member.overrideFields = [...new Set([...member.overrideFields, 'positionMm' as const, 'rotationDeg' as const])]
  }
  for (const group of Object.values(scene.decorationClusters)) for (const member of Object.values(group.members)) if (member.entityId && member.state !== 'deleted' && member.state !== 'detached') member.state = 'manual'
  const privateMemberId = focusAdded.find(id => scene.props[id])!
  if (!privateMemberId) throw new Error('复杂夹具没有可单独编辑的完整物件。')
  scene.props[privateMemberId].visibility = 'gm'
  const noteId = `${prefix}-secret-note`
  scene.notes[noteId] = { id: noteId, floorId, editLocked: false, kind: 'clue', title: '主持人线索', text: 'CAPACITY_PRIVATE_SENTINEL', visibility: 'gm',
    anchor: { type: 'entity', entityKind: 'prop', entityId: privateMemberId } }
  scene.entityLayers[noteId] = layerId
  const manualDecorations = focusAdded.filter(id => scene.decorations[id]).slice(0, 3), clusterId = `${prefix}-manual-cluster`
  const firstDecoration = scene.decorations[manualDecorations[0]]
  scene.decorationClusters[clusterId] = { id: clusterId, floorId, editLocked: false, visibility: 'public', supportRef: captureJson(firstDecoration.supportRef),
    boundsMm: captureJson(focusBounds), seed: 'persisted-manual-detail-fixture', algorithmVersion: 'cluster-v1',
    palette: [...new Map(manualDecorations.map(id => { const definitionRef = scene.decorations[id].definitionRef; return [definitionRef.id, { key: definitionRef.id, kind: 'decoration' as const, definitionRef: captureJson(definitionRef), weight: 1 }] })).values()],
    maxInstances: 8, spacingMm: 300, clusterRadiusMm: 1000, clearanceMm: 100,
    members: Object.fromEntries([...manualDecorations.map(id => [sha256Text(id), { kind: 'decoration' as const, entityId: id, state: 'manual' as const }]),
      [sha256Text(`${clusterId}-deleted`), { kind: 'decoration' as const, entityId: null, state: 'deleted' as const }],
      [sha256Text(`${clusterId}-detached`), { kind: 'decoration' as const, entityId: null, state: 'detached' as const }]]) }
  scene.entityLayers[clusterId] = layerId
  const privacyMaskIds = fixedPrivacyMasks(scene, prefix, privateMemberId)
  const domain = kind === 'building' ? 'building' as const : 'natural' as const
  const members = domain === 'building' ? buildingAggregateMembers(scene, originalRoomIds[0]) : naturalAggregateMembers(scene, focusTerrainIds)
  const groupId = `${prefix}-group`, childId = `${prefix}-detail-group`, owned = new Set(members.map(row => row.id))
  const childMembers = members.filter(row => ['prop', 'decoration'].includes(row.kind) && focusAdded.includes(row.id)).slice(0, 64)
  const childIds = new Set(childMembers.map(row => row.id)), pivotMm = point(focusBounds.x + Math.floor(focusBounds.width / 2), focusBounds.y + Math.floor(focusBounds.height / 2))
  scene.aggregateCoordinates = { encoding: 'world', groups: {
    [groupId]: { id: groupId, floorId, parentId: null, frame: { translationMm: pivotMm, quarterTurns: 0 }, editLocked: false, members: members.filter(row => !childIds.has(row.id)) },
    [childId]: { id: childId, floorId, parentId: groupId, frame: { translationMm: point(500, -500), quarterTurns: 1 }, editLocked: false, members: childMembers },
  } }
  if (remoteAdded.some(id => owned.has(id)) || owned.has(remoteAreaId) || owned.has(externalRoadId) || privacyMaskIds.some(id => owned.has(id))) throw new Error('远端分区、只读道路或世界固定玩家遮罩被错误吸收进移动组。')
  // Preparing explicit manual container states is a real edit of generated
  // output. Use the production reconciliation to pause/update its exact hashes.
  detachChangedOutputs(source, scene)
  const scope = inspectAggregateDomain(scene, groupId, domain), checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`复杂容量夹具领域校验失败：${checked.errors.slice(0, 12).map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  const details = count(scene.props) + count(scene.decorations)
  if (details !== detailCount + remoteExtraDetails) throw new Error(`复杂容量夹具细节数量不同：${details}/${detailCount + remoteExtraDetails}。`)
  const editableMemberId = focusAdded.find(id => scene.props[id] && id !== privateMemberId && owned.has(id))!
  if (!editableMemberId) throw new Error('复杂容量夹具缺少公开且归组的编辑物件。')
  const controls = { groupId, groupName: `${kind === 'building' ? '建筑' : kind === 'natural' ? '自然' : '混合'}容量组`, domain,
    editableMemberId, editableMemberKind: 'prop' as const, bulkEditableMemberIds: focusAdded.filter(id => scene.props[id] && id !== privateMemberId && owned.has(id)).slice(0, 32),
    privateMemberId, secretNoteId: noteId, remoteEntityId: remoteAdded[0], remoteAreaId,
    externalRoadId, remoteRoadId, remoteConnectionId, lockedMemberId: editableMemberId, offsetMm: point(1000, 0), pivotMm, quarterTurns: 0 as const }
  const visual = visualBase(scene)!
  return { document: checked.document, controls, summary: { fixtureVersion: AGGREGATE_CAPACITY_FIXTURE_VERSION, kind, detailCount, actualDetailCount: details, variant,
    detailMeaning: 'props + lightweight decorations; structure, surfaces, curves, containers and metadata are additional',
    originalDocumentHash, originalCounts, counts: { props: count(scene.props), decorations: count(scene.decorations), rooms: count(scene.rooms), walls: count(scene.walls), openings: count(scene.openings),
      terrainAreas: count(scene.terrainAreas), paths: count(scene.paths), connections: count(scene.terrainConnections), notes: count(scene.notes), manualMasks: privacyMaskIds.length, aggregateGroups: 2,
      prefabs: count(scene.prefabInstances), scatterGroups: count(scene.scatterGroups), decorationClusters: count(scene.decorationClusters), surfaceRules: count(scene.surfaceRules),
      curves: count(visual.boundaries), edgeLooks: count(visual.edgeLooks), lights: count(visual.lights), fogs: count(visual.fogs), filters: count(visual.filters) },
    focusDetails: focusTarget, remoteDetails: remoteTarget + remoteExtraDetails, aggregateMembers: scope.members.length, aggregateReadDependencies: scope.readDependencies,
    focusBounds, floorBounds: scene.floors[floorId].boundsMm, remoteBounds, originalTerrainIds, explicitExtensionIds: extensionIds,
    fixedPrivacyMasks: privacyMaskIds.map(id => ({ id, boundsMm: pointsBounds(scene.regions[id].boundaryMm) })),
    explicitChangesToSource: 'Floor/export extent and deterministic identity/clock/title; live container records are prepared as manual position/rotation input. Building gets one real shared-wall annex with a secret door and explicitly extends the original zero-elevation yard eastward to support old/new rooms; natural/mixed gets an explicit terrain extension and road. Local world-fixed manualMasks cover only private prop/secret-opening old/new paint and shadow bounds with a 32mm margin. Other original geometry and fixed artwork are retained. Project preparation syncs the original appearance graph, preserving its fixed source ancestry and adjustments, and allocates fresh fixture history identities.',
    densityMethod: 'Persisted deterministic supported placements at 50–57.5% source scale, 300mm focus lattice and 350mm remote lattice; one in four added details is a full Prop. Each added image rectangle and physical footprint excludes all previous image rectangles/footprints; door approaches have a 1500mm reserve. This is a synthetic detail load over real complex authored/generated geometry, not a beauty sample or natural-generation count.',
    manualRecordBoundary: 'Canonical successful fixture starts with manual live records. First move of managed records may require real member-level accounting; no normalization occurs in the measured edit.' } }
}

/** Runs only in the isolated preparation browser. The returned package is then
 * imported through the normal production UI; no measured-page API is installed. */
export async function prepareAggregateCapacityFixture(kind: AggregateCapacityKind, detailCount: number, variant: AggregateCapacityVariant = {}) {
  const context = contextFor(kind), complex = await complexBase(kind)
  const built = buildAggregateCapacityDocument(kind, detailCount, complex.document, variant)
  // The base is already resolved and has immutable presentation witnesses.
  // Sync preserves its source/override mappings; new props capture their actual
  // scaled snapshot and inherit the definition's existing fixed presentation.
  // Whole-catalogue binders are only for fresh generation: they would rebind
  // existing forest instances to unscaled defaults while leaving their fields.
  const content = syncAppearanceGraph({ document: built.document,
    historyIdentity: createHistoryIdentity(built.document, context), appearance: complex.appearance }, complex.document)
  fixedPrivacyMasks(content.document, `capacity-${kind}`, built.controls.privateMemberId, content.appearance)
  const project = await fromBundle({ project: { ...toBundle(complex).project, ...content }, resources: complex.resources }, validation)
  const privacyPreflight = await preflightAggregateCapacityPrivacy(project, built.controls, kind)
  const bytes = await exportProject(toBundle(project), validation), cold = await importProject(bytes, validation), contentHash = projectContentHash(toBundle(project).project)
  if (projectContentHash(cold.project) !== contentHash) throw new Error('复杂容量夹具完整导出/冷导入哈希不同。')
  const assets = Object.values(project.assets)
  if (!assets.length || assets.some(asset => asset.pixelWidth <= 1 || asset.pixelHeight <= 1)) throw new Error('复杂容量夹具必须携带真实固定图片，不能使用1像素测试替身。')
  return { bytes, controls: built.controls, summary: { ...built.summary, privacyPreflight, packageSha256: sha256Bytes(bytes), contentHash,
    documentHash: sha256Text(canonicalJson(project.document)), packageBytes: bytes.length, uniqueImages: assets.length,
    imageBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0), imagePixels: assets.reduce((sum, asset) => sum + asset.pixelWidth * asset.pixelHeight, 0),
    authoringSources: count(project.authoringSources), licenseBindings: project.licenseBindings.length,
    freezeBoundary: 'One cached original complex base per kind in this preparation module instance; all counts/variants capture that exact base without mutating it. Saved package hashes identify this frozen disk corpus. Independent preparation instances may allocate different source/history identities and need not produce identical package hashes.',
    resourceValidation: 'Browser strict fromBundle/exportProject/importProject; actual PNG/SVG bytes, decoded pixels and exact license closure; current complete v1 and exact cold content hash.' } }
}
