import type { BoundsMm, EdgeStyle, MaterialRef, NoteV2, PointMm, PropV2, SceneDocumentV2, ShadowStyle, StyleTheme, SurfaceRef, SurfaceStyle, TerrainArea, TerrainEdge } from '../../core/v2/types'
import { openingEndpointsV2, pointInPolygonV2, roomPointsV2, terrainPointsV2 } from '../../core/v2/geometry'

export type AudienceV2 = 'gm' | 'player'
export interface ProjectedSurfaceV2 { id: string; points: PointMm[]; style: SurfaceStyle | null; elevationMm: number; priority: number }
export interface ProjectedTerrainEdgeV2 { id: string; start: PointMm; end: PointMm; sourceAreaId: string; neighborAreaId: string | null; elevationMm: number; neighborElevationMm: number; kind: TerrainEdge['kind']; shoreline: boolean; style: EdgeStyle; surfaceStyle: SurfaceStyle | null }
export interface ProjectedConnectionV2 { id: string; kind: 'stairs' | 'ramp'; start: PointMm; end: PointMm; widthMm: number; fromElevationMm: number; toElevationMm: number; blocksMovement: boolean; style: SurfaceStyle | null }
export interface ProjectedOpeningV2 { id: string; start: PointMm; end: PointMm; widthMm: number; kind: 'door' | 'window'; state: 'open' | 'closed'; secret: boolean }
export interface ProjectedWallV2 { id: string; sourceIds: string[]; start: PointMm; end: PointMm; thicknessMm: number; style: SurfaceStyle | null; openings: ProjectedOpeningV2[] }
export interface ProjectedNoteV2 { id: string; positionMm: PointMm; text: string; kind: NoteV2['kind']; visibility: 'gm' | 'public' }
export interface ProjectedRegionV2 { id: string; points: PointMm[]; kind: 'terrain' | 'hazard' }
/** Disposable visual data. In particular, a player projection has no source document or hidden definitions. */
export interface ProjectionV2 {
  audience: AudienceV2; sourceRevision: number; bounds: BoundsMm; gridSizeMm: number | null
  rooms: ProjectedSurfaceV2[]; terrain: ProjectedSurfaceV2[]; walls: ProjectedWallV2[]
  /** Canonical ground/object/canopy, renderOrder, id order; independent copies of source props. */
  props: PropV2[]
  edges: ProjectedTerrainEdgeV2[]; connections: ProjectedConnectionV2[]
  notes: ProjectedNoteV2[]; regions: ProjectedRegionV2[]; masks: PointMm[][]
  theme: Pick<StyleTheme, 'outline' | 'openingStyle' | 'shadowPresets' | 'edgeStyles' | 'terrainCliff'> | null
  materials: Record<string, Pick<MaterialRef, 'id' | 'version' | 'textureAssetId'>>
  assetIds: string[]; limitations: string[]; diagnostics: string[]
}

const EPS = 1e-6
const clone = <T>(value: T): T => structuredClone(value)
const point = (x: number, y: number): PointMm => ({ x, y })
const midpoint = (a: PointMm, b: PointMm): PointMm => point((a.x + b.x) / 2, (a.y + b.y) / 2)
const center = (points: PointMm[]): PointMm => point(points.reduce((sum, p) => sum + p.x, 0) / points.length, points.reduce((sum, p) => sum + p.y, 0) / points.length)
export const pointsBoundsV2 = (points: PointMm[]): BoundsMm => ({ x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) })
const inflate = (b: BoundsMm, padding: number): BoundsMm => ({ x: b.x - padding, y: b.y - padding, width: b.width + padding * 2, height: b.height + padding * 2 })
const includesPoint = (r: BoundsMm, p: PointMm) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height
const intersects = (a: BoundsMm, b: BoundsMm): BoundsMm | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}
function simplify(points: PointMm[]): PointMm[] {
  return points.filter((p, i) => {
    const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length]
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > EPS
  }).map(p => ({ ...p }))
}
function maskRectangle(points: PointMm[]): BoundsMm {
  const ring = simplify(points)
  if (ring.length !== 4 || ring.some((p, i) => p.x !== ring[(i + 1) % ring.length].x && p.y !== ring[(i + 1) % ring.length].y)) throw new Error('玩家输出不安全：遮罩须为固定的轴对齐矩形。')
  const box = pointsBoundsV2(ring)
  if (!(box.width > 0 && box.height > 0)) throw new Error('玩家输出不安全：遮罩须有面积。')
  return box
}
/** A union of rectangles can cover a private object without one rectangle covering it alone. */
export function boundsCoveredV2(bounds: BoundsMm, rectangles: BoundsMm[]): boolean {
  const cuts = [...new Set([bounds.x, bounds.x + bounds.width, ...rectangles.flatMap(r => [r.x, r.x + r.width])])].filter(x => x >= bounds.x && x <= bounds.x + bounds.width).sort((a, b) => a - b)
  for (let i = 1; i < cuts.length; i++) {
    const x = (cuts[i - 1] + cuts[i]) / 2
    const intervals = rectangles.filter(r => x >= r.x && x <= r.x + r.width).map(r => [r.y, r.y + r.height]).sort((a, b) => a[0] - b[0])
    let to = bounds.y
    for (const [start, end] of intervals) { if (start > to + EPS) break; to = Math.max(to, end) }
    if (to < bounds.y + bounds.height - EPS) return false
  }
  return cuts.length > 1
}

export function transformedVisualBoundsV2(prop: PropV2): BoundsMm {
  const v = prop.visualBoundsMm, a = prop.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return pointsBoundsV2([[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]].map(([x, y]) => point(prop.positionMm.x + x * c - y * s, prop.positionMm.y + x * s + y * c)))
}
const shadowPadding = (shadow: ShadowStyle | null | undefined) => shadow && shadow.opacity ? shadow.offsetMm + shadow.blurMm * 4 : 0
const styleKey = (style: SurfaceStyle | null) => JSON.stringify(style)
const wallOrder = (a: ProjectedWallV2, b: ProjectedWallV2) => a.start.y - b.start.y || a.start.x - b.start.x || a.end.y - b.end.y || a.end.x - b.end.x || a.thicknessMm - b.thicknessMm || styleKey(a.style).localeCompare(styleKey(b.style))
const close = (a: PointMm, b: PointMm) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** Canonical collinear merges prevent private split vertices creating public seams or joins. */
function canonicalWalls(walls: ProjectedWallV2[]): ProjectedWallV2[] {
  for (const wall of walls) if (wall.start.x > wall.end.x || wall.start.x === wall.end.x && wall.start.y > wall.end.y) [wall.start, wall.end] = [wall.end, wall.start]
  walls.sort(wallOrder)
  const result: ProjectedWallV2[] = []
  for (const wall of walls) {
    const previous = result.find(item => {
      const dx = item.end.x - item.start.x, dy = item.end.y - item.start.y
      return item.thicknessMm === wall.thicknessMm && styleKey(item.style) === styleKey(wall.style) && close(item.end, wall.start) && Math.abs(dx * (wall.end.y - wall.start.y) - dy * (wall.end.x - wall.start.x)) < EPS * Math.hypot(dx, dy)
    })
    if (previous) { previous.end = wall.end; previous.sourceIds.push(...wall.sourceIds); previous.openings.push(...wall.openings) }
    else result.push(wall)
  }
  return result.sort(wallOrder).map((wall, i) => ({ ...wall, id: `wall-${i}`, sourceIds: [], openings: wall.openings.sort((a, b) => a.start.y - b.start.y || a.start.x - b.start.x).map((o, j) => ({ ...o, id: `opening-${i}-${j}` })) }))
}

export const propLayerV2 = { ground: 0, object: 1, canopy: 2 }
export const orderedPropsV2 = (props: PropV2[]) => [...props].sort((a, b) => propLayerV2[a.renderLayer] - propLayerV2[b.renderLayer] || a.renderOrder - b.renderOrder || a.id.localeCompare(b.id))

const defaultEdgeStyles: Record<TerrainEdge['kind'], EdgeStyle> = {
  shore: { strokeWidthMm: 12, color: '#D9D4B4', bandWidthMm: 180 },
  cliff: { strokeWidthMm: 24, color: '#39443E', bandWidthMm: 450 },
  materialTransition: { strokeWidthMm: 0, color: '#71865A', bandWidthMm: 250 },
}
/** Only this audience's surfaces enter coverage resolution. No GM hole/edge cache is reused. */
function deriveTerrainEdges(areas: TerrainArea[], declarations: TerrainEdge[], theme: ProjectionV2['theme']): ProjectedTerrainEdgeV2[] {
  // This local index is built only after audience filtering and never survives the projection.
  const byPriority = [...areas].sort((a, b) => b.coveragePriority - a.coveragePriority || a.id.localeCompare(b.id)).map(area => ({ area, points: terrainPointsV2(area) }))
  const support = (p: PointMm) => byPriority.find(item => pointInPolygonV2(p, item.points, false))?.area
  const declared = new Map(declarations.map(e => [`${e.source.areaId}\0${e.source.segmentId}`, e]))
  const result = new Map<string, ProjectedTerrainEdgeV2>()
  for (const area of [...areas].sort((a, b) => a.id.localeCompare(b.id))) for (let i = 0; i < area.boundaryMm.length; i++) {
    const vertex = area.boundaryMm[i], a = vertex.positionMm, b = area.boundaryMm[(i + 1) % area.boundaryMm.length].positionMm
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (!length) continue
    const mid = midpoint(a, b), step = Math.min(.01, length / 100), inward = point(-dy / length * step, dx / length * step)
    const inside = support(point(mid.x + inward.x, mid.y + inward.y)), outside = support(point(mid.x - inward.x, mid.y - inward.y))
    if (inside?.id !== area.id || outside?.id === area.id) continue
    const declaration = declared.get(`${area.id}\0${vertex.segmentId}`), neighborElevationMm = outside?.groundElevationMm ?? 0
    if (!declaration && area.groundElevationMm === neighborElevationMm) continue
    const kind = area.groundElevationMm !== neighborElevationMm ? 'cliff' : declaration?.kind ?? 'materialTransition'
    const key = [a, b].map(p => `${p.x},${p.y}`).sort().join('|')
    if (result.has(key)) continue
    result.set(key, { id: declaration?.id ?? `derived-${area.id}-${vertex.segmentId}`, start: clone(a), end: clone(b), sourceAreaId: area.id, neighborAreaId: outside?.id ?? null, elevationMm: area.groundElevationMm, neighborElevationMm, kind, shoreline: !!declaration?.shoreline || declaration?.kind === 'shore', style: clone(declaration?.styleOverride ?? theme?.edgeStyles[kind] ?? defaultEdgeStyles[kind]), surfaceStyle: clone(declaration?.surfaceStyle ?? null) })
  }
  return [...result.values()].sort((a, b) => Math.max(a.elevationMm, a.neighborElevationMm) - Math.max(b.elevationMm, b.neighborElevationMm) || a.start.y - b.start.y || a.start.x - b.start.x || a.end.y - b.end.y || a.end.x - b.end.x)
}

/** Audience filtering precedes textures, joins, shadows and resource decoding. */
export function projectSceneV2(scene: SceneDocumentV2, audience: AudienceV2): ProjectionV2 {
  if (audience !== 'gm' && audience !== 'player') throw new Error('必须明确选择主持人或玩家输出。')
  if (Object.keys(scene.floors).length !== 1) throw new Error('素材场景渲染仅支持单楼层。')
  const bounds = clone(scene.exportBoundsMm)
  if (Object.values(bounds).some(v => !Number.isFinite(v)) || bounds.width <= 0 || bounds.height <= 0) throw new Error('导出边界必须是有效固定矩形。')
  const themeDefinition = scene.activeStyleThemeRef ? scene.styleThemes[scene.activeStyleThemeRef.id] : null
  if (scene.activeStyleThemeRef && (!themeDefinition || themeDefinition.version !== scene.activeStyleThemeRef.version)) throw new Error('主题快照缺失或版本不匹配。')
  const theme = themeDefinition ? clone({ outline: themeDefinition.outline, openingStyle: themeDefinition.openingStyle, shadowPresets: themeDefinition.shadowPresets, edgeStyles: themeDefinition.edgeStyles, terrainCliff: themeDefinition.terrainCliff }) : null
  const masks = Object.values(scene.regions).filter(r => r.kind === 'manualMask').map(r => clone(r.boundaryMm))
  const rectangles = audience === 'player' ? masks.map(maskRectangle) : []
  const maskedPoint = (p: PointMm) => rectangles.some(r => includesPoint(r, p))
  const areaPublic = (id: string) => scene.terrainAreas[id]?.visibility === 'public'
  const roomPublic = (id: string): boolean => !!scene.rooms[id] && scene.rooms[id].visibility === 'public' && (scene.rooms[id].supportRef.kind === 'floor' || areaPublic(scene.rooms[id].supportRef.id))
  const surfacePublic = (ref: SurfaceRef): boolean => ref.kind === 'floor' ? !!scene.floors[ref.id] : ref.kind === 'room' ? roomPublic(ref.id) : areaPublic(ref.id)
  const pathPublic = (id: string) => scene.paths[id]?.visibility === 'public' && scene.paths[id].supportRefs.every(surfacePublic)
  const edgePublic = (id: string) => scene.terrainEdges[id]?.visibility === 'public' && areaPublic(scene.terrainEdges[id].source.areaId) && (!scene.terrainEdges[id].neighborAreaId || areaPublic(scene.terrainEdges[id].neighborAreaId!))
  const groupHiddenProps = new Set<string>()
  if (audience === 'player') {
    for (const group of Object.values(scene.prefabInstances)) if (group.visibility !== 'public') for (const member of Object.values(group.members)) if (member.propId) groupHiddenProps.add(member.propId)
    for (const group of Object.values(scene.scatterGroups)) {
      const visibleDomain = group.domain.kind === 'area' ? areaPublic(group.domain.areaId) : group.domain.kind === 'path' ? pathPublic(group.domain.pathId) : edgePublic(group.domain.edgeId)
      if (group.visibility !== 'public' || !visibleDomain) for (const member of Object.values(group.members)) if (member.propId && member.state !== 'detached') groupHiddenProps.add(member.propId)
    }
  }
  const propPublic = (prop: PropV2) => prop.visibility === 'public' && !groupHiddenProps.has(prop.id) && surfacePublic(prop.supportRef) && (!prop.roomId || roomPublic(prop.roomId))
  const visibleRooms = Object.values(scene.rooms).filter(r => audience === 'gm' || roomPublic(r.id))
  const visibleTerrain = Object.values(scene.terrainAreas).filter(a => audience === 'gm' || areaPublic(a.id))
  const rooms = visibleRooms.map(r => ({ id: r.id, points: simplify(roomPointsV2(scene, r)), style: clone(r.floorStyle), elevationMm: r.groundElevationMm, priority: 0 }))
  const terrain = visibleTerrain.map(a => ({ id: a.id, points: simplify(terrainPointsV2(a)), style: clone(a.surfaceStyle), elevationMm: a.groundElevationMm, priority: a.coveragePriority })).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  const edges = deriveTerrainEdges(visibleTerrain, Object.values(scene.terrainEdges).filter(e => audience === 'gm' || edgePublic(e.id)), theme)
  const connectionPublic = (id: string) => { const c = scene.terrainConnections[id]; return c?.visibility === 'public' && surfacePublic(c.from.surfaceRef) && surfacePublic(c.to.surfaceRef) }
  const surfaceElevation = (ref: SurfaceRef) => ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id]?.groundElevationMm ?? 0 : ref.kind === 'room' ? scene.rooms[ref.id]?.groundElevationMm ?? 0 : 0
  const connections: ProjectedConnectionV2[] = Object.values(scene.terrainConnections).filter(c => audience === 'gm' || connectionPublic(c.id)).map(c => ({ id: c.id, kind: c.kind, start: clone(c.from.positionMm), end: clone(c.to.positionMm), widthMm: c.widthMm, fromElevationMm: surfaceElevation(c.from.surfaceRef), toElevationMm: surfaceElevation(c.to.surfaceRef), blocksMovement: c.blocksMovement, style: clone(c.surfaceStyle) })).sort((a, b) => a.id.localeCompare(b.id))
  const visibleProps = Object.values(scene.props).filter(p => audience === 'gm' || propPublic(p) && !maskedPoint(p.positionMm))
  const props = orderedPropsV2(visibleProps.map(clone))
  const visiblePropIds = new Set(props.map(p => p.id))
  const diagnostics: string[] = []
  const allRoomEdges = new Map<string, string[]>()
  const edgeKey = (a: string, b: string) => [a, b].sort().join('\0')
  for (const room of Object.values(scene.rooms)) for (let i = 0; i < room.boundaryVertexIds.length; i++) {
    const key = edgeKey(room.boundaryVertexIds[i], room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length])
    allRoomEdges.set(key, [...allRoomEdges.get(key) ?? [], room.id])
  }
  const visibleWallIds = new Set<string>(), visibleOpeningIds = new Set<string>()
  const openingsByWall = new Map<string, SceneDocumentV2['openings'][string][]>()
  for (const opening of Object.values(scene.openings)) {
    if (audience === 'player' && opening.secret && !opening.revealed) continue
    const group = openingsByWall.get(opening.wallId)
    if (group) group.push(opening)
    else openingsByWall.set(opening.wallId, [opening])
  }
  const walls: ProjectedWallV2[] = []
  for (const wall of Object.values(scene.walls)) {
    const av = scene.vertices[wall.startVertexId], bv = scene.vertices[wall.endVertexId]
    if (!av || !bv) throw new Error('墙的顶点缺失。')
    const start = point(av.xMm, av.yMm), end = point(bv.xMm, bv.yMm)
    if (audience === 'player') {
      const neighbors = allRoomEdges.get(edgeKey(wall.startVertexId, wall.endVertexId)) ?? []
      if (neighbors.length && !neighbors.some(roomPublic)) continue
      if (!neighbors.length && boundsCoveredV2(inflate(pointsBoundsV2([start, end]), wall.thicknessMm / 2 + shadowPadding(theme?.shadowPresets.wall)), rectangles)) continue
    }
    visibleWallIds.add(wall.id)
    const openings = (openingsByWall.get(wall.id) ?? []).map(o => {
      visibleOpeningIds.add(o.id)
      const [a, b] = openingEndpointsV2(scene, o)
      return { id: o.id, start: { ...a }, end: { ...b }, widthMm: o.widthMm, kind: o.kind, state: o.state, secret: audience === 'gm' && o.secret }
    })
    walls.push({ id: wall.id, sourceIds: [wall.id], start, end, thicknessMm: wall.thicknessMm, style: clone(wall.topStyle), openings })
  }
  const regionVisible = (id: string) => scene.regions[id]?.kind !== 'manualMask' && scene.regions[id]?.visibility === 'public'
  const visibleIds: Partial<Record<string, Set<string>>> = { terrainEdge: new Set(edges.map(e => e.id)), terrainConnection: new Set(connections.map(c => c.id)), room: new Set(rooms.map(r => r.id)), terrainArea: new Set(terrain.map(a => a.id)), wall: visibleWallIds, opening: visibleOpeningIds, prop: visiblePropIds, region: new Set(Object.values(scene.regions).filter(r => regionVisible(r.id)).map(r => r.id)), vertex: new Set([...visibleWallIds].flatMap(id => [scene.walls[id].startVertexId, scene.walls[id].endVertexId])), prefabInstance: new Set(Object.values(scene.prefabInstances).filter(g => g.visibility === 'public' && Object.values(g.members).some(m => !!m.propId && visiblePropIds.has(m.propId))).map(g => g.id)), scatterGroup: new Set(Object.values(scene.scatterGroups).filter(g => g.visibility === 'public' && Object.values(g.members).some(m => !!m.propId && m.state !== 'detached' && visiblePropIds.has(m.propId))).map(g => g.id)) }
  function anchorPosition(note: NoteV2, seen = new Set<string>()): PointMm | null {
    if (seen.has(note.id)) return null
    seen.add(note.id)
    if (note.anchor.type === 'point') return clone(note.anchor.positionMm)
    const { entityKind: kind, entityId: id } = note.anchor
    if (kind === 'note') {
      const parent = scene.notes[id]
      if (!parent || audience === 'player' && parent.visibility !== 'public') return null
      const p = anchorPosition(parent, seen)
      return audience === 'player' && p && maskedPoint(p) ? null : p
    }
    if (audience === 'player' && !visibleIds[kind]?.has(id)) return null
    if (kind === 'vertex') { const v = scene.vertices[id]; return v ? point(v.xMm, v.yMm) : null }
    if (kind === 'prop') return scene.props[id] ? clone(scene.props[id].positionMm) : null
    if (kind === 'room') return scene.rooms[id] ? center(roomPointsV2(scene, scene.rooms[id])) : null
    if (kind === 'terrainArea') return scene.terrainAreas[id] ? center(terrainPointsV2(scene.terrainAreas[id])) : null
    if (kind === 'wall') { const w = scene.walls[id]; return w ? midpoint(point(scene.vertices[w.startVertexId].xMm, scene.vertices[w.startVertexId].yMm), point(scene.vertices[w.endVertexId].xMm, scene.vertices[w.endVertexId].yMm)) : null }
    if (kind === 'opening') { const o = scene.openings[id]; return o ? midpoint(...openingEndpointsV2(scene, o)) : null }
    if (kind === 'terrainEdge') { const e = edges.find(e => e.id === id); return e ? midpoint(e.start, e.end) : null }
    if (kind === 'terrainConnection') { const c = connections.find(c => c.id === id); return c ? midpoint(c.start, c.end) : null }
    if (kind === 'region') return scene.regions[id] ? center(scene.regions[id].boundaryMm) : null
    if (kind === 'prefabInstance') return scene.prefabInstances[id] ? clone(scene.prefabInstances[id].anchorMm) : null
    if (kind === 'scatterGroup') { const g = scene.scatterGroups[id], first = g && Object.values(g.members).find(m => m.propId && (audience === 'gm' || visibleIds.prop?.has(m.propId))); return first?.propId ? clone(scene.props[first.propId].positionMm) : null }
    return null
  }
  const notes: ProjectedNoteV2[] = []
  for (const note of Object.values(scene.notes)) {
    const position = anchorPosition(note)
    if (audience === 'player' && note.visibility !== 'public') continue
    if (!position || audience === 'player' && maskedPoint(position)) { if (audience === 'gm') diagnostics.push(`注记 ${note.id} 的锚点尚不支持。`); continue }
    // Titles/text are plain Canvas text; no IDs, purpose or source metadata become labels.
    notes.push({ id: note.id, positionMm: position, text: note.kind === 'label' ? note.text : note.title || note.text, kind: note.kind, visibility: note.visibility })
  }
  if (audience === 'player') {
    const privateBounds: BoundsMm[] = []
    for (const room of Object.values(scene.rooms)) if (!roomPublic(room.id)) {
      const adjacent = Object.values(scene.walls).filter(w => allRoomEdges.get(edgeKey(w.startVertexId, w.endVertexId))?.includes(room.id))
      privateBounds.push(inflate(pointsBoundsV2(roomPointsV2(scene, room)), Math.max(0, ...adjacent.map(w => w.thicknessMm)) / 2 * 2 + shadowPadding(theme?.shadowPresets.wall)))
    }
    for (const prop of Object.values(scene.props)) if (!propPublic(prop)) privateBounds.push(inflate(transformedVisualBoundsV2(prop), shadowPadding(prop.shadowOverride ?? theme?.shadowPresets[prop.shadowClass])))
    // Face and shadow extents are bounded by one controlled displacement, not stacked offsets.
    const cliff = theme?.terrainCliff, shore = theme?.edgeStyles.shore ?? defaultEdgeStyles.shore
    const styles = [...Object.values(theme?.edgeStyles ?? defaultEdgeStyles), ...Object.values(scene.terrainEdges).flatMap(e => e.styleOverride ? [e.styleOverride] : [])]
    const edgePadding = Math.max(cliff?.maxOffsetMm ?? 600, shore.bandWidthMm * .65 + shore.strokeWidthMm / 2, ...styles.map(s => Math.max(s.bandWidthMm * 1.7, s.strokeWidthMm / 2))) + (cliff?.opacity ? cliff.blurMm * 4 : 0)
    for (const area of Object.values(scene.terrainAreas)) if (!areaPublic(area.id)) privateBounds.push(inflate(pointsBoundsV2(terrainPointsV2(area)), edgePadding))
    for (const edge of Object.values(scene.terrainEdges)) if (!edgePublic(edge.id)) {
      const area = scene.terrainAreas[edge.source.areaId], index = area?.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId) ?? -1
      if (area && index >= 0) privateBounds.push(inflate(pointsBoundsV2([area.boundaryMm[index].positionMm, area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm]), edgePadding))
    }
    for (const connection of Object.values(scene.terrainConnections)) if (!connectionPublic(connection.id)) privateBounds.push(inflate(pointsBoundsV2([connection.from.positionMm, connection.to.positionMm]), connection.widthMm / 2 + 24))
    for (const region of Object.values(scene.regions)) if (region.kind !== 'manualMask' && region.visibility !== 'public') privateBounds.push(pointsBoundsV2(region.boundaryMm))
    for (const box of privateBounds) { const clipped = intersects(box, bounds); if (clipped && !boundsCoveredV2(clipped, rectangles)) throw new Error('玩家输出不安全：固定遮罩未覆盖私密几何、视觉范围或装饰阴影；请扩大遮罩或恢复公开。') }
  }
  const limitations: string[] = []
  if (Object.values(scene.paths).some(p => audience === 'gm' || pathPublic(p.id))) limitations.push('B3 暂不绘制道路。')
  if (props.some(p => p.appearance.tint)) limitations.push('B3 暂不绘制物件着色。')
  if (audience === 'gm' && Object.values(scene.notes).some(n => n.anchor.type === 'entity' && n.anchor.entityKind === 'path')) limitations.push('B3 暂不绘制道路上的注记。')
  const styles = [...rooms, ...terrain].map(s => s.style).concat(walls.map(w => w.style), edges.map(e => e.surfaceStyle), connections.map(c => c.style))
  const materials: ProjectionV2['materials'] = {}, assetIds = new Set<string>()
  for (const style of styles) if (style) for (const paint of [style.base, ...style.overlays.map(o => o.paint)]) {
    const material = scene.materials[paint.materialRef.id]
    if (!material || material.version !== paint.materialRef.version) throw new Error('绘制需要的材质快照缺失或版本不符。')
    materials[material.id] = { id: material.id, version: material.version, textureAssetId: material.textureAssetId }; assetIds.add(material.textureAssetId)
  }
  for (const prop of props) if (prop.appearance.kind === 'image') assetIds.add(prop.appearance.assetId)
  const regions = Object.values(scene.regions).filter(r => r.kind !== 'manualMask' && (audience === 'gm' || regionVisible(r.id))).map(r => ({ id: r.id, points: clone(r.boundaryMm), kind: r.kind as 'terrain' | 'hazard' }))
  return { audience, sourceRevision: scene.revision, bounds, gridSizeMm: scene.units.gridVisible ? scene.units.gridSizeMm : null, rooms, terrain, walls: audience === 'player' ? canonicalWalls(walls) : walls.sort(wallOrder), props, edges, connections, notes, regions, masks, theme, materials, assetIds: [...assetIds].sort(), limitations, diagnostics }
}
