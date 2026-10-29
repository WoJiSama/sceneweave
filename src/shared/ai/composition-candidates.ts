import { visualBase } from '../visual/base.js'
import { z } from 'zod'
import type { ProjectData } from '../model/project.js'
import type { BoundsMm, PointMm, Prop, SurfaceRef, SurfaceStyle } from '../model/scene.js'
import { cloneJson, captureJson } from '../validation/json.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { assertPublicSceneEntity } from './scene-authoring.js'
import { probeAuthoringPlacement } from './placement-diagnostics.js'
import type { AuthoringOperation, AuthoringStart } from './authoring-protocol.js'
import { VisualAuthoringOperationSchema } from './visual-protocol.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const prefix = z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,47}$/)
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const point = z.object({ x: integer, y: integer }).strict()
const bounds = z.object({ x: integer, y: integer, width: integer.positive(), height: integer.positive() }).strict()
const common = { reserveOperations: z.number().int().min(0).max(128).optional() }
/** Read-only tool queries. Returned operations use the existing strict ledger schema. */
export const CompositionCandidateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('layout'), recipe: z.enum(['beach', 'island', 'interior']), idPrefix: prefix,
    variant: z.number().int().min(0).max(1).optional(),
    materialIds: z.object({
      base: id.optional().describe('beach/island: water terrain. interior: unused; does not assign wall materials.'),
      primary: id.optional().describe('beach: sand. island: low shelf. interior: non-kitchen room floors, and kitchen floor fallback when secondary is absent.'),
      secondary: id.optional().describe('island: high land. interior: kitchen floor override only. beach: unused.'),
    }).strict().optional(), ...common }).strict(),
  z.object({ kind: z.literal('furnishing'), idPrefix: prefix, supportRef: z.object({ kind: z.enum(['floor', 'room', 'terrainArea']), id }).strict(),
    definitionIds: z.array(id).min(1).max(6).refine(values => new Set(values).size === values.length), positionMm: point,
    count: z.number().int().min(1).max(8).optional(), rotationDeg: z.number().finite().min(0).lt(360).optional(),
    minimumClearanceMm: z.number().int().min(0).max(5000).optional(), keepClearBoundsMm: z.array(bounds).max(4).optional(), ...common }).strict(),
  z.object({ kind: z.literal('style'), surfaceIds: z.array(id).max(4).optional(), propIds: z.array(id).max(4).optional(),
    edgeIds: z.array(id).max(4).optional(), includeEnvironment: z.boolean().optional(), ...common }).strict(),
])
export type CompositionCandidate = z.infer<typeof CompositionCandidateSchema>
export type CompositionCandidateResult = { candidateOperations: AuthoringOperation[]; guidance: string[]; details: unknown; appearance: 'unconfirmed' }
const rectangle = (b: BoundsMm): PointMm[] => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
function deny(): never { throw new Error('构图候选须使用明确授权的公开范围、固定定义和操作。') }
const publicIds = (start: AuthoringStart, ids: ReadonlySet<string>) => new Set([...start.scope.targetIds, ...(start.scope.scene?.entityIds ?? []), ...(start.scope.visual?.entityIds ?? []), ...ids])
function layout(start: AuthoringStart, query: Extract<CompositionCandidate, { kind: 'layout' }>): CompositionCandidateResult {
  const scope = start.scope.scene
  if (!scope || query.recipe === 'interior' && !scope.operations.includes('room') || query.recipe !== 'interior' && !scope.operations.includes('terrain')) deny()
  const b = scope.boundsMm, p = (x: number, y: number) => ({ x: Math.round(b.x + x * b.width), y: Math.round(b.y + y * b.height) })
  if (b.width < 12000 || b.height < 12000) throw new Error('有限布局候选需要至少12×12米的已授权范围；较小范围请明确手工构造。')
  const name = (value: string) => `${query.idPrefix}-${value}`, material = query.materialIds ?? {}, operations: AuthoringOperation[] = []
  const terrain = (key: string, points: PointMm[], elevation: number, priority: number, materialId?: string, blocksMovement = false) => operations.push({ kind: 'terrain', id: name(key), boundaryMm: points, groundElevationMm: elevation,
    coveragePriority: priority, blocksMovement, ...(materialId ? { materialId } : {}) })
  let details: Record<string, unknown>
  if (query.recipe === 'beach') {
    const offset = query.variant ? .045 : 0
    // Keep the shared editable curve inside the grant, with room for a normal
    // 500mm shore band's full existing 2x-width dependency bound. The remaining
    // physical coast reaches the map frame through explicit straight segments.
    const outerTop = p(.43 + offset, 0), outerBottom = p(.46 + offset, 1)
    const coast = [[.43 + offset, 0], [.47 + offset, .16], [.40 + offset, .34], [.48 + offset, .52], [.42 + offset, .74], [.46 + offset, 1]].map(([x, y]) => p(x, y))
    coast[0] = { ...outerTop, y: b.y + 1200 }; coast[coast.length - 1] = { ...outerBottom, y: b.y + b.height - 1200 }
    terrain('water', [p(0, 0), outerTop, ...coast, outerBottom, p(0, 1)], 0, 0, material.base, true)
    terrain('sand', [outerTop, p(1, 0), p(1, 1), outerBottom, ...coast.slice().reverse()], 0, 1, material.primary)
    const proposedActivityBoundsMm = { x: p(.62, .32).x, y: p(.62, .32).y, width: Math.round(b.width * .29), height: Math.round(b.height * .42) }
    const explicitActivity = start.brief?.checks?.filter(check => check.kind === 'clearArea').map(check => check.boundsMm) ?? []
    details = { materialRoles: { base: 'water terrain', primary: 'sand terrain', secondary: 'unused' }, activityAreas: explicitActivity.length ? explicitActivity : [proposedActivityBoundsMm],
      reefGroupCentresMm: [p(.53 + offset, .17), p(.55 + offset, .51), p(.52 + offset, .83)],
      sharedCoastAnchorsMm: coast, waterId: name('water'), sandId: name('sand'),
      boundaryNextStep: 'Read the real point IDs after editing; use these inset shared anchors for one open shared terrain curve with shore-band clearance. Explicit straight physical segments continue from its endpoints to the map frame. This proposal does not create a persistent material-to-coast binding.' }
  } else if (query.recipe === 'island') {
    terrain('water', rectangle(b), 0, 0, material.base, true)
    const reflect = query.variant ? (x: number) => 1 - x : (x: number) => x
    const ring = (points: number[][]) => { const values = points.map(([x, y]) => p(reflect(x), y)); return query.variant ? values.reverse() : values }
    terrain('low', ring([[.12, .45], [.18, .21], [.36, .17], [.45, .29], [.61, .14], [.79, .24], [.87, .49], [.77, .75], [.53, .80], [.35, .72], [.19, .82], [.10, .65]]), 800, 1, material.primary)
    terrain('high', ring([[.39, .40], [.50, .31], [.68, .34], [.75, .50], [.66, .65], [.48, .68], [.37, .57]]), 2600, 2, material.secondary)
    if (scope.operations.includes('connection')) operations.push({ kind: 'connection', id: name('stairs'), connectionKind: 'stairs',
      from: { surfaceRef: { kind: 'terrainArea', id: name('low') }, positionMm: p(reflect(.28), .53) },
      to: { surfaceRef: { kind: 'terrainArea', id: name('high') }, positionMm: p(reflect(.45), .53) }, widthMm: Math.min(1500, Math.max(1000, Math.floor(b.height * .075))) })
    details = { materialRoles: { base: 'water terrain', primary: 'low shelf', secondary: 'high land' }, lowId: name('low'), highId: name('high'), bayAnchorMm: p(reflect(.45), .29), headlandAnchorMm: p(reflect(.87), .49),
      broadActivityCentreMm: p(reflect(.56), .51), stairsId: scope.operations.includes('connection') ? name('stairs') : null,
      missingGrant: scope.operations.includes('connection') ? null : 'A real stairs/ramp connection is not granted. This is an incomplete height layout.',
      boundaryNextStep: 'After an explicit edit, propose one closed boundary for each existing land ring and measure the full cost, concavity and stair support before editing.' }
  } else {
    const rooms = [
      ['common', '餐厅 common dining', .12, .15, .61, .50], ['kitchen', '厨房 kitchen', .61, .15, .88, .50],
      ['guest', '客房 guest bedroom', .12, .50, .38, .85], ['study', '书房 study', .38, .50, .64, .85], ['storage', '储藏 storage', .64, .50, .88, .85],
    ] as const
    for (const [key, purpose, left, top, right, bottom] of rooms) operations.push({ kind: 'room', id: name(key), boundaryMm: [p(left, top), p(right, top), p(right, bottom), p(left, bottom)],
      purpose, thicknessMm: 180, supportRef: { kind: 'floor', id: scope.floorId }, ...(key === 'kitchen' && material.secondary ? { materialId: material.secondary } : material.primary ? { materialId: material.primary } : {}) })
    details = { materialRoles: { base: 'unused', primary: 'non-kitchen floors; kitchen fallback when secondary is absent', secondary: 'kitchen floor override only', walls: 'not assigned; use an explicit wall material operation' }, rooms: rooms.map(([key, purpose]) => ({ id: name(key), purpose })),
      furnishingNextStep: 'Use actual granted stove/counter/storage for the kitchen, table/chairs for dining, bed/storage for the guest room, desk/shelves for study. Probe each room after its real doors exist. Purpose words alone are not evidence.',
      connectionNextStep: scope.operations.includes('opening') && scope.operations.includes('entrance') ? 'The service will append a finite door tree and explicit entrance from these newly generated actual wall IDs.' : 'Opening/entrance permission is absent; rooms remain a legal incomplete draft.' }
  }
  return { candidateOperations: operations, details, appearance: 'unconfirmed', guidance: ['This finite layout is an explicit candidate, not an adopted scene or a general layout solver.',
    'Material IDs must be real permitted IDs. Empty choices leave surfaces unfinished; complete with a separate explicit style/material step.'] }
}

/** Use only walls belonging to rooms created by this candidate, after native preview. */
export function connectCompositionRooms(project: ProjectData, start: AuthoringStart, query: CompositionCandidate, operations: AuthoringOperation[]): AuthoringOperation[] {
  if (query.kind !== 'layout' || query.recipe !== 'interior' || !start.scope.scene?.operations.includes('opening') || !start.scope.scene.operations.includes('entrance')) return operations
  const scene = project.document, roomIds = operations.filter(value => value.kind === 'room').map(value => value.id), rooms = roomIds.map(id => scene.rooms[id])
  const owners = (wall: typeof scene.walls[string]) => rooms.filter(room => room.boundaryVertexIds.some((id, i, all) => id === wall.startVertexId && all[(i + 1) % all.length] === wall.endVertexId || id === wall.endVertexId && all[(i + 1) % all.length] === wall.startVertexId)).map(room => room.id)
  const walls = Object.values(scene.walls).map(wall => ({ wall, owners: owners(wall) })).filter(value => value.owners.length)
  const selected = new Set([roomIds[0]]), doors: AuthoringOperation[] = []
  const add = (wall: typeof scene.walls[string], key: string) => {
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId], length = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm), widthMm = 1100
    if (length < widthMm + 400) throw new Error('候选用途房间不足以容纳1100mm门及墙端净空。')
    doors.push({ kind: 'opening', id: `${query.idPrefix}-${key}`, openingKind: 'door', state: 'open', wallId: wall.id,
      offsetReferenceVertexId: a.id, offsetMm: Math.floor((length - widthMm) / 2), widthMm })
  }
  while (selected.size < roomIds.length) {
    const next = walls.find(value => value.owners.length === 2 && value.owners.some(id => selected.has(id)) && value.owners.some(id => !selected.has(id)))
    if (!next) throw new Error('有限室内候选的房间未形成可连接共享墙。')
    add(next.wall, `door-${doors.length + 1}`); next.owners.forEach(id => selected.add(id))
  }
  const exterior = walls.filter(value => value.owners.length === 1 && value.owners[0] === roomIds[0]).sort((a, b) => {
    const midpoint = (wall: typeof scene.walls[string]) => (scene.vertices[wall.startVertexId].xMm + scene.vertices[wall.endVertexId].xMm) / 2
    return midpoint(a.wall) - midpoint(b.wall) || a.wall.id.localeCompare(b.wall.id)
  })[0]
  if (!exterior) throw new Error('有限室内候选缺少明确外门墙。')
  add(exterior.wall, 'entrance')
  return [...operations, ...doors, { kind: 'entrance', openingIds: [`${query.idPrefix}-entrance`] }]
}

function furnishing(project: ProjectData, start: AuthoringStart, ids: ReadonlySet<string>, query: Extract<CompositionCandidate, { kind: 'furnishing' }>): CompositionCandidateResult {
  const definitions = query.definitionIds, allowed = publicIds(start, ids), definitionGrants = new Set([...(start.scope.scene?.definitionIds ?? []), ...(start.scope.visual?.definitionIds ?? [])])
  if (definitions.some(id => !definitionGrants.has(id)) || !start.scope.scene?.operations.includes('furnish')) deny()
  const density = start.brief?.style?.detailDensity ?? .35, count = query.count ?? Math.max(1, Math.round(2 + density * 6)), operations: AuthoringOperation[] = []
  let temporary: ProjectData = { ...project, document: { ...project.document, props: { ...project.document.props } } }
  const clear = [...(query.keepClearBoundsMm ?? []), ...(start.brief?.checks?.filter(check => check.kind === 'clearArea').map(check => check.boundsMm) ?? [])]
  if (clear.length > 8) throw new Error('布景候选保留区超过8个有限范围。')
  for (let index = 0; index < count; index++) {
    const definitionId = definitions[index % definitions.length], definition = project.document.propDefinitions[definitionId]
    const rotationDeg = query.rotationDeg ?? (query.supportRef.kind === 'room' ? 0 : [17, 83, 146, 239, 311, 44, 192, 278][index])
    const probe = probeAuthoringPlacement(temporary, start, allowed, { definitionId, supportRef: query.supportRef, positionMm: query.positionMm,
      rotationDeg, minimumClearanceMm: query.minimumClearanceMm ?? (query.supportRef.kind === 'room' ? 180 : 240), avoidVisual: true, limit: 1, keepClearBoundsMm: clear })
    const chosen = probe.candidates[0]
    if (!chosen) break
    const id = `${query.idPrefix}-${index + 1}`
    if (allowed.has(id) || Object.hasOwn(project.document.props, id)) deny()
    const operation: AuthoringOperation = { kind: 'furnish', id, definitionId, positionMm: chosen.positionMm, rotationDeg, supportRef: query.supportRef }
    operations.push(operation)
    const prop: Prop = { id, floorId: query.supportRef.kind === 'floor' ? query.supportRef.id : query.supportRef.kind === 'room' ? project.document.rooms[query.supportRef.id].floorId : project.document.terrainAreas[query.supportRef.id].floorId,
      editLocked: false, visibility: 'public', definitionRef: { id: definitionId, version: definition.version }, appearance: definition.defaultAppearance,
      positionMm: chosen.positionMm, rotationDeg, visualBoundsMm: definition.defaultVisualBoundsMm, footprintMm: definition.defaultFootprintMm, footprintOffsetMm: definition.defaultFootprintOffsetMm,
      blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, renderLayer: definition.defaultRenderLayer, shadowClass: definition.defaultShadowClass, renderOrder: 0, shadowOverride: null,
      supportRef: query.supportRef, ...(query.supportRef.kind === 'room' ? { roomId: query.supportRef.id } : {}) }
    temporary.document.props[id] = prop; allowed.add(id)
  }
  return { candidateOperations: operations, appearance: 'unconfirmed', details: { requestedCount: count, feasibleCount: operations.length, unfulfilledCount: count - operations.length,
    definitionRotation: definitions, detailDensity: density, keepClearBoundsMm: clear, supportRef: query.supportRef }, guidance: [
    'Whole rotated images and footprints are separated using the existing finite placement probe; door approaches, stairs and explicit activity areas remain reserved.',
    'A finite search may return fewer props. It cannot prove that no other arrangement exists; revise only an explicitly granted layout or report the missing furnishing.',
    definitions.length < 2 ? 'Only one requested fixed source is available here. Rotation does not create a new silhouette; variant richness remains unfulfilled.' : 'Actual fixed definitions alternate. These do not rewrite sources, existing members or manual scatter records.' ] }
}

function style(project: ProjectData, start: AuthoringStart, ids: ReadonlySet<string>, query: Extract<CompositionCandidate, { kind: 'style' }>): CompositionCandidateResult {
  const brief = start.brief?.style, scope = start.scope.visual, scene = project.document, allowed = publicIds(start, ids), operations: AuthoringOperation[] = [], unsupported: string[] = []
  if (!brief) throw new Error('风格候选需要冻结brief.style参数；不能从作品名称推断风格。')
  const required = (id: string) => { if (!scope || !allowed.has(id)) deny(); assertPublicSceneEntity(project, scope, id) }
  for (const id of [...new Set(query.surfaceIds ?? [])]) {
    required(id)
    if (!scope!.operations.includes('visualSurface')) deny()
    let current: SurfaceStyle | null | undefined, surfaceKind: 'room' | 'terrainArea' | 'wall' | 'path' | 'terrainEdge' | 'terrainConnection'
    if (scene.rooms[id]) { current = scene.rooms[id].floorStyle; surfaceKind = 'room' }
    else if (scene.walls[id]) { current = scene.walls[id].topStyle; surfaceKind = 'wall' }
    else if (scene.terrainAreas[id]) { current = scene.terrainAreas[id].surfaceStyle; surfaceKind = 'terrainArea' }
    else if (scene.paths[id]) { current = scene.paths[id].surfaceStyle; surfaceKind = 'path' }
    else if (scene.terrainEdges[id]) { current = scene.terrainEdges[id].surfaceStyle; surfaceKind = 'terrainEdge' }
    else if (scene.terrainConnections[id]) { current = scene.terrainConnections[id].surfaceStyle; surfaceKind = 'terrainConnection' }
    else deny()
    if (!current) { unsupported.push(`surface_without_base:${id}`); continue }
    const next = cloneJson(current), original = next.base.tileSizeMm, scale = brief.textureScaleMm / Math.max(original.width, original.height)
    next.base.tileSizeMm = { width: Math.max(1, Math.round(original.width * scale)), height: Math.max(1, Math.round(original.height * scale)) }
    if (next.base.tint || next.overlays.some(value => value.paint.tint)) { unsupported.push(`surface_requires_materialized_tint:${id}`); continue }
    operations.push(VisualAuthoringOperationSchema.parse({ kind: 'visualSurface', id, surfaceKind, style: next }))
  }
  for (const id of [...new Set(query.edgeIds ?? [])]) {
    const edge = visualBase(scene)?.edgeLooks[id]
    if (!scope || !scope.operations.includes('visualEdge') || !allowed.has(id) || !edge || edge.visibility !== 'public') deny()
    const { floorId: _floor, layerId: _layer, visibility: _visibility, editLocked: _locked, kind: edgeKind, ...fields } = edge
    operations.push({ kind: 'visualEdge', edgeKind, ...fields, color: brief.palette[0], accentColor: brief.palette[1] ?? brief.palette[0] })
  }
  if (query.propIds?.length) {
    const artwork = start.scope.artwork
    if (!artwork?.operations.includes('style') || query.propIds.some(id => !allowed.has(id) || !scene.props[id] || !createPublicVisibility(scene).prop(scene.props[id]))) deny()
    operations.push({ kind: 'style', ids: [...new Set(query.propIds)], tint: brief.palette[0] })
  }
  if (query.includeEnvironment) {
    const visual = visualBase(scene)
    if (!scope?.allowGlobalEnvironment || !scope.operations.includes('visualEnvironment') || !visual) deny()
    operations.push({ kind: 'visualEnvironment', environment: { ...visual.environment, lightDirectionDeg: brief.lightDirectionDeg } })
  }
  if (!query.propIds?.length && !query.edgeIds?.length) unsupported.push('palette_requires_matching_fixed_sources_or_explicit_artwork_or_edge_targets')
  unsupported.push('lineWeightMm_requires_matching_fixed_art_or_a_new_restricted_SVG_version; existing_bitmap_strokes_are_not_resized')
  return { candidateOperations: operations, appearance: 'unconfirmed', details: { textureScaleMm: brief.textureScaleMm, lightDirectionDeg: brief.lightDirectionDeg,
    palette: brief.palette, densityMapping: 'furnishing count defaults to round(2 + detailDensity * 6), bounded to 1–8', unsupported }, guidance: [
    'Texture scale changes real base tileSizeMm while preserving its aspect ratio, material version, world/surface phase and explicit overlays.',
    'Palette is applied only to explicitly selected edge looks or adopted artwork derivations. The original fixed sources and physical/secret properties remain unchanged.',
    'Light direction updates the granted global environment only; it does not override existing fixed per-source shadow directions or prove consistent lighting.'] }
}

export function proposeAuthoringComposition(project: ProjectData, start: AuthoringStart, ids: ReadonlySet<string>, input: CompositionCandidate): CompositionCandidateResult {
  const query = CompositionCandidateSchema.parse(captureJson(input))
  return query.kind === 'layout' ? layout(start, query) : query.kind === 'furnishing' ? furnishing(project, start, ids, query) : style(project, start, ids, query)
}
