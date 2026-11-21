import type { BoundsMm, PointMm, SceneDocument } from '../model/scene.js'
import { propFootprint, connectionBand } from '../geometry/geometry.js'
import { propSightLine } from '../geometry/sight-occluder.js'
import { cloneJson } from '../validation/json.js'
import type { Audience, ProjectedVisualBoundary, ProjectedVisualFilter, ProjectedVisualSystem, ProjectedVisualTransition, Projection } from '../projection/types.js'
import { sampleVisualBoundary } from './geometry.js'
import type { VisualSystem } from './types.js'
import { getLegacyVisual } from '../terrain-generation/composition-contracts.js'
import { decorationPaintPolygon } from '../decorations/presentation.js'
import { resolveFloorOutput, type FloorOutput } from '../floors/output.js'
import { playerMaskContains } from '../projection/player-mask.js'
import type { FenceAssembly, PathAssembly } from '../path-assembly/contracts.js'
import { assemblyLampDefaults, effectiveFixtureGlow } from '../path-assembly/lighting.js'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import { planTerrainCliffs } from './terrain-cliff-plan.js'
import { terrainTransitionStrokePolygon } from './transition.js'
import { planTerrainInlayVisualScope, terrainInlayCarrierRange } from '../terrain-inlay/visual-scope.js'
import { presentationBounds } from '../appearance/presentation.js'

const copy = <T>(value: T): T => cloneJson(value)
const bounds = (points: PointMm[]): BoundsMm => ({ x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) })
const segmentKey = (a: PointMm, b: PointMm) => [a, b].map(p => `${p.x},${p.y}`).sort().join('|')
const orderById = (a: string, b: string) => a.localeCompare(b)
function propVisualRing(prop: SceneDocument['props'][string]): PointMm[] {
  const v = prop.visualBoundsMm, angle = prop.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  return [[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]].map(([x, y]) => ({ x: prop.positionMm.x + x * cos - y * sin, y: prop.positionMm.y + x * sin + y * cos }))
}

function projectFixtureGlows(assemblies: readonly (PathAssembly | FenceAssembly)[], projection: Projection,
  scene: SceneDocument, hiddenLayerIds?: ReadonlySet<string>): NonNullable<ProjectedVisualSystem['fixtureGlows']> {
  const glowByLamp = assemblyLampDefaults(assemblies)
  return projection.props.flatMap(prop => {
    const glow = effectiveFixtureGlow(prop, glowByLamp.get(prop.id))
    if (!glow?.intensity || !prop.appearance.opacity) return []
    if (hiddenLayerIds?.has(scene.entityLayers[prop.supportRef.id])) return []
    const presentation = projection.propPresentations?.[prop.id]
    const v = presentationBounds(prop, presentation), tilt = (presentation?.mode === 'nearSide' ? 0 : prop.rotationDeg) * Math.PI / 180
    const { u, v: fraction } = glow.anchor
    const x = v.x + v.width * u, y = v.y + v.height * (prop.appearance.mirrorY ? 1 - fraction : fraction)
    const positionMm = { x: Math.round(prop.positionMm.x + x * Math.cos(tilt) - y * Math.sin(tilt)),
      y: Math.round(prop.positionMm.y + x * Math.sin(tilt) + y * Math.cos(tilt)) }
    if (projection.audience === 'player' && playerMaskContains(positionMm, projection.masks, projection.maskPublicRooms)) return []
    return [{ color: glow.color, radiusMm: glow.radiusMm, positionMm, intensity: glow.intensity * prop.appearance.opacity,
      ...(!glowByLamp.has(prop.id) && { wallOcclusion: true as const }) }]
  })
}

/** This boundary receives the audience's completed physical projection, never a GM render cache. */
export function projectVisualSystem(scene: SceneDocument, visual: VisualSystem, projection: Projection, audience: Audience, hiddenLayerIds?: ReadonlySet<string>, visibleWallIds?: ReadonlySet<string>, resolvedFloor?: FloorOutput): ProjectedVisualSystem {
  const floorId = resolvedFloor?.floorId ?? projection.floorId ?? (Object.keys(scene.floors).length === 1 ? Object.keys(scene.floors)[0] : undefined)
  if (floorId === undefined) throw new Error('多楼层视觉投影必须明确选择目标Floor。')
  const output = resolvedFloor ?? resolveFloorOutput(scene, floorId)
  const shown = (value: { floorId: string; layerId: string; visibility: string; enabled?: boolean }) => value.floorId === floorId && value.enabled !== false && !hiddenLayerIds?.has(value.layerId) && (audience === 'gm' || value.visibility === 'public')
  const terrains = new Set(projection.terrain.map(a => a.id)), paths = new Set(projection.paths.map(a => a.id))
  const boundaries: ProjectedVisualBoundary[] = []
  for (const boundary of Object.values(visual.boundaries).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!shown(boundary) || boundary.fence && audience === 'player') continue
    const binding = boundary.binding
    if (binding.kind === 'terrain' && !binding.sides.every(side => terrains.has(side.areaId))) continue
    if (binding.kind === 'path' && !paths.has(binding.pathId)) continue
    const sampled = sampleVisualBoundary(boundary)
    boundaries.push({ id: boundary.id, points: copy(sampled.points), samples: copy(sampled.samples), lengthMm: sampled.lengthMm, closed: sampled.closed,
      terrainAreaIds: binding.kind === 'terrain' ? binding.sides.map(side => side.areaId) : [], ...(binding.kind === 'decoration' ? { decorationOnly: true as const } : {}) })
  }
  const boundaryIds = new Set(boundaries.map(b => b.id)), edgeLooks = Object.values(visual.edgeLooks).filter(look => shown(look) && boundaryIds.has(look.boundaryId)).sort((a, b) => a.id.localeCompare(b.id)).map(copy)
  const transitions: ProjectedVisualTransition[] = scene.visual?.version === 3
    ? Object.values(scene.visual.transitions).filter(transition => shown(transition) && boundaryIds.has(transition.boundaryId))
      .sort((a, b) => orderById(a.id, b.id)).map(transition => ({
        id: transition.id, floorId: transition.floorId, layerId: transition.layerId, boundaryId: transition.boundaryId,
        kind: transition.kind, side: transition.side, widthMm: transition.widthMm, enabled: transition.enabled,
        polygons: transition.polygons.map(polygon => ({ pointsMm: copy(polygon.pointsMm), fillColor: polygon.fillColor, opacity: polygon.opacity })),
        strokes: transition.strokes.map(stroke => ({ pointsMm: copy(stroke.pointsMm), widthMm: stroke.widthMm, color: stroke.color, opacity: stroke.opacity })),
      }))
    : []
  // Filter both the edge and its source before sorting or suppressing physical
  // outlines. Private/hidden decorations must not change the public picture.
  const legacyVisual = getLegacyVisual(scene)
  const materialized = legacyVisual
    ? Object.values(legacyVisual.materializedEdges).filter(edge => shown(edge) && boundaryIds.has(edge.boundaryId)) : []
  if (materialized.some(edge => edge.materialRef !== null)) throw new Error('当前物化边缘预览仅支持明确颜色几何；材质边缘尚未支持。')
  const order = (a: { id: string; layerId: string }, b: { id: string; layerId: string }) =>
    (scene.userLayers[a.layerId]?.order ?? 0) - (scene.userLayers[b.layerId]?.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const materializedEdges = materialized.sort(order).map(edge => ({ id: edge.id, boundaryId: edge.boundaryId, kind: edge.kind, polygons: copy(edge.polygons),
    strokes: copy(edge.strokes), fillColor: edge.fillColor, opacity: edge.opacity }))
  const edgePaintOrder = legacyVisual ? [
    ...edgeLooks.map(edge => ({ ...edge, representation: 'edgeLook' as const })),
    ...materialized.map(edge => ({ ...edge, representation: 'materializedEdge' as const })),
  ].sort(order).map(edge => ({ kind: edge.representation, id: edge.id })) : undefined
  const decorated = new Set([...edgeLooks, ...materialized].map(look => look.boundaryId)), replacedSegments = new Set<string>()
  for (const boundary of boundaries) if (decorated.has(boundary.id)) {
    for (let i = 1; i < boundary.points.length; i++) replacedSegments.add(segmentKey(boundary.points[i - 1], boundary.points[i]))
    if (boundary.closed) replacedSegments.add(segmentKey(boundary.points[boundary.points.length - 1], boundary.points[0]))
  }
  // Geometry from filtered objects only becomes a selective filter mask. A private
  // entity can neither be a target nor change the shape/bounds of a public filter.
  const targetRings = new Map<string, PointMm[][]>()
  for (const surface of [...projection.terrain, ...projection.rooms]) targetRings.set(surface.id, [copy(surface.points)])
  for (const path of projection.paths) targetRings.set(path.id, [copy(path.points)])
  for (const prop of projection.props) targetRings.set(prop.id, [propVisualRing(prop)])
  for (const value of projection.decorations ?? []) targetRings.set(value.id, [decorationPaintPolygon(value)])
  for (const region of projection.regions) targetRings.set(region.id, [copy(region.points)])
  for (const wall of Object.values(scene.walls).filter(wall => wall.floorId === floorId)) {
    if (visibleWallIds ? !visibleWallIds.has(wall.id) : !projection.walls.some(projected => projected.sourceIds.includes(wall.id))) continue
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId], dx = b.xMm - a.xMm, dy = b.yMm - a.yMm, l = Math.hypot(dx, dy), nx = -dy / l * wall.thicknessMm / 2, ny = dx / l * wall.thicknessMm / 2
    targetRings.set(wall.id, [[{ x: a.xMm + nx, y: a.yMm + ny }, { x: b.xMm + nx, y: b.yMm + ny }, { x: b.xMm - nx, y: b.yMm - ny }, { x: a.xMm - nx, y: a.yMm - ny }]])
  }
  for (const connection of projection.connections) {
    const inlay = projection.inlays?.find(row => row.id === connection.id)
    if (inlay) targetRings.set(connection.id, [copy(inlay.footprintMm)])
    else if (connection.route) targetRings.set(connection.id, [connectionBand(connection.route.centerlineMm, connection.widthMm)])
    else {
      const dx = connection.end.x - connection.start.x, dy = connection.end.y - connection.start.y, l = Math.hypot(dx, dy), nx = -dy / l * connection.widthMm / 2, ny = dx / l * connection.widthMm / 2
      targetRings.set(connection.id, [[{ x: connection.start.x + nx, y: connection.start.y + ny }, { x: connection.end.x + nx, y: connection.end.y + ny }, { x: connection.end.x - nx, y: connection.end.y - ny }, { x: connection.start.x - nx, y: connection.start.y - ny }]])
    }
  }
  for (const group of Object.values(scene.prefabInstances).filter(group => group.floorId === floorId)) {
    const rings = Object.values(group.members).flatMap(member => member.propId ? targetRings.get(member.propId) ?? [] : [])
    if ((audience === 'gm' || group.visibility === 'public') && rings.length) targetRings.set(group.id, rings)
  }
  for (const group of Object.values(scene.scatterGroups).filter(group => group.floorId === floorId)) {
    const rings = Object.values(group.members).flatMap(member => member.state !== 'detached' && member.propId ? targetRings.get(member.propId) ?? [] : [])
    if ((audience === 'gm' || group.visibility === 'public') && rings.length) targetRings.set(group.id, rings)
  }
  for (const group of Object.values(scene.decorationClusters ?? {}).filter(group => group.floorId === floorId)) {
    const rings = Object.values(group.members).flatMap(member => member.state !== 'detached' && member.entityId ? targetRings.get(member.entityId) ?? [] : [])
    if ((audience === 'gm' || group.visibility === 'public') && rings.length) targetRings.set(group.id, rings)
  }
  const renderTargets = new Map([...targetRings.keys()].map(id => [id, [id]]))
  for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].filter(group => group.floorId === floorId)) renderTargets.set(group.id, Object.values(group.members).flatMap(member => member.propId && targetRings.has(member.propId) ? [member.propId] : []))
  for (const group of Object.values(scene.decorationClusters ?? {}).filter(group => group.floorId === floorId)) renderTargets.set(group.id, Object.values(group.members).flatMap(member => member.entityId && member.state !== 'detached' && targetRings.has(member.entityId) ? [member.entityId] : []))
  for (const wall of Object.values(scene.walls).filter(wall => wall.floorId === floorId)) if (targetRings.has(wall.id)) {
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    renderTargets.set(wall.id, projection.walls.filter(projected => {
      const dx = projected.end.x - projected.start.x, dy = projected.end.y - projected.start.y, length2 = dx * dx + dy * dy
      const on = (x: number, y: number) => Math.abs(dx * (y - projected.start.y) - dy * (x - projected.start.x)) < 1e-6 && (x - projected.start.x) * dx + (y - projected.start.y) * dy >= -1e-6 && (x - projected.start.x) * dx + (y - projected.start.y) * dy <= length2 + 1e-6
      return on(a.xMm, a.yMm) && on(b.xMm, b.yMm)
    }).map(projected => projected.id))
  }
  const filters: ProjectedVisualFilter[] = []
  for (const filter of Object.values(visual.filters).filter(shown).sort((a, b) => a.id.localeCompare(b.id))) {
    const target = filter.target
    const rings = target.kind === 'scene' ? null : target.kind === 'region' ? [copy(target.boundaryMm)] : target.kind === 'entities' ? target.ids.flatMap(id => targetRings.get(id) ?? []) : [...targetRings].filter(([id]) => scene.entityLayers[id] === target.layerId).flatMap(([, rings]) => rings)
    if (rings && !rings.length) continue
    const { floorId: _floor, layerId: _layer, visibility: _visibility, editLocked: _lock, target: _target, ...parameters } = filter
    const ids = target.kind === 'entities' ? target.ids : target.kind === 'layer' ? [...targetRings.keys()].filter(id => scene.entityLayers[id] === target.layerId) : undefined
    const sourceEntityIds = ids ? [...new Set(ids.flatMap(id => renderTargets.get(id) ?? []))] : undefined
    if (sourceEntityIds && !sourceEntityIds.length) continue
    const targetBoundsMm = rings ? bounds(rings.flat()) : copy(output.boundsMm)
    filters.push({ ...copy(parameters), ...(sourceEntityIds ? { sourceEntityIds } : {}), ...(target.kind === 'region' ? { regionFeatherMm: Math.min(1200, Math.min(targetBoundsMm.width, targetBoundsMm.height) * .16) } : {}), targetRings: rings, targetBoundsMm })
  }
  const fixtureGlows = projectFixtureGlows([
    ...projection.paths.flatMap(({ id }) => {
      const assembly = scene.paths[id]?.assembly
      return assembly ? [assembly] : []
    }),
    ...Object.values(visual.boundaries).flatMap(boundary => shown(boundary) && boundary.fence ? [boundary.fence] : []),
  ], projection, scene, hiddenLayerIds)
  const result: ProjectedVisualSystem = { environment: copy(output.environment), boundsMm: copy(output.boundsMm), boundaries, transitions, edgeLooks,
    ...(legacyVisual ? { materializedEdges, edgePaintOrder } : {}),
    ...(fixtureGlows.length ? { fixtureGlows } : {}),
    lights: Object.values(visual.lights).filter(light => shown(light) && (audience === 'gm' || !playerMaskContains(light.positionMm, projection.masks, projection.maskPublicRooms))).sort((a, b) => a.id.localeCompare(b.id)).map(copy),
    fogs: Object.values(visual.fogs).filter(shown).sort((a, b) => a.id.localeCompare(b.id)).map(copy), filters,
    ...projectedSightOccluders(projection),
    contactRings: projection.props.filter(prop => !prop.waterAppearance && prop.renderLayer !== 'ground' && prop.shadowClass !== 'none').map(propVisualRing),
    suppressedTerrainEdgeIds: projection.edges.filter(edge => replacedSegments.has(segmentKey(edge.start, edge.end)) || projection.inlays?.length && boundaries.some(boundary => decorated.has(boundary.id)
      && boundary.points.some((a, i) => {
        if (!boundary.closed && i === boundary.points.length - 1) return false
        const b = boundary.points[(i + 1) % boundary.points.length], dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy
        return square > 0 && [edge.start, edge.end].every(p => Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) <= 1e-6 * Math.sqrt(square)
          && (p.x - a.x) * dx + (p.y - a.y) * dy >= -1e-6 && (p.x - b.x) * dx + (p.y - b.y) * dy <= 1e-6)
      }))).map(edge => edge.id) }
  if (projection.inlays?.length) result.inlayExclusions = projectInlayExclusions(projection, result)
  return result
}

const clipPolygon = (ps: PointMm[]): MultiPolygon => [[ps.map(p => [p.x, p.y])]]
const clipArea = (regions: MultiPolygon): number => regions.reduce((sum, poly) => sum + poly.reduce((s, ring, i) => s + (i ? -1 : 1)
  * Math.abs(ring.reduce((a, p, j) => a + p[0] * ring[(j + 1) % ring.length][1] - ring[(j + 1) % ring.length][0] * p[1], 0) / 2), 0), 0)
const clipUnion = (polys: MultiPolygon[]): MultiPolygon => polys.length ? polygonClipping.union(polys[0], ...polys.slice(1)) : []
const clipRings = (rings: PointMm[][]): MultiPolygon => rings.length ? polygonClipping.xor(clipPolygon(rings[0]), ...rings.slice(1).map(clipPolygon)) : []
const interpolate = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** Preserve the original complete boundary/station/seed. Exclusions are actual
 * old face ownership sliced by changed physical carriers, never a broad box.
 * Keeping the original plan also leaves all untouched procedural detail stable. */
function projectInlayExclusions(projection: Projection, visual: ProjectedVisualSystem): NonNullable<ProjectedVisualSystem['inlayExclusions']> {
  const inlays = projection.inlays!
  const carriers = inlays.flatMap(inlay => inlay.changedCarriers)
  if (carriers.length > 4096 || inlays.reduce((sum, inlay) => sum + inlay.footprintMm.length, 0) > 16384) throw Error('跨台表现替换超过完整点边保护值。')
  const influence = clipUnion(inlays.map(inlay => clipPolygon(inlay.footprintMm)))
  let proofWork = 0
  const spend = (count = 1) => { proofWork += count; if (proofWork > 2_000_000) throw Error('跨台表现逐段归属超过有限工作预算。') }
  const scope = planTerrainInlayVisualScope(inlays.map(inlay => ({ ...inlay,
    sourceGroundSlope: !!inlay.finish && !!inlay.groundSurfaces,
    sourceIds: projection.connections.find(row => row.id === inlay.id)?.surfaceIds ?? [] })), visual)
  spend(scope.workUnits)
  const exclusions = new Map<string, MultiPolygon[]>(scope.rows.filter(row => row.kind !== 'preserved-ground').map(row => [row.paintId,
    [clipUnion(inlays.filter(inlay => row.inlayIds.includes(inlay.id)).map(inlay => clipPolygon(inlay.footprintMm)))]]))
  for (const row of scope.rows) if (row.kind === 'source-shore') for (const id of row.inlayIds) {
    const inlay = inlays.find(inlay => inlay.id === id)!, ids = inlay.scopedPaintIds ??= []
    if (!ids.includes(row.paintId)) ids.push(row.paintId)
  }
  // Saved materialized/transition output has no per-carrier ownership proof in
  // this first slice. Refuse an overlap; retain every untouched saved result.
  for (const value of visual.materializedEdges ?? []) {
    const polygons = value.polygons.map(clipPolygon).concat(value.strokes.map(stroke => clipPolygon(terrainTransitionStrokePolygon(stroke.pointsMm, stroke.widthMm))))
    if (polygons.some(poly => clipArea(polygonClipping.intersection(poly, influence)) > 1e-5)) throw Error(`跨台实际域触及已保存的物化边 ${value.id}；请先明确移除或重新制作该表现。`)
  }
  for (const value of visual.transitions ?? []) {
    const polygons = value.polygons.map(poly => clipPolygon(poly.pointsMm)).concat(value.strokes.map(stroke => clipPolygon(terrainTransitionStrokePolygon(stroke.pointsMm, stroke.widthMm))))
    if (polygons.some(poly => clipArea(polygonClipping.intersection(poly, influence)) > 1e-5)) throw Error(`跨台实际域触及已保存的常高过渡 ${value.id}；请先明确移除或重新制作该表现。`)
  }
  for (const face of planTerrainCliffs({ terrain: projection.terrain, visual })) {
    if (!exclusions.has(face.look.id)) continue
    const selected: MultiPolygon[] = []
    spend(face.cells.length * carriers.length)
    for (const cell of face.cells) for (const carrier of carriers) {
      const range = terrainInlayCarrierRange(...cell.crest, carrier.a, carrier.b)
      if (!range) continue
      const [from, to] = range
      selected.push(clipPolygon([interpolate(...cell.inner, from), interpolate(...cell.inner, to), interpolate(...cell.foot, to), interpolate(...cell.foot, from)]))
    }
    if (!selected.length) continue
    const region = clipUnion(selected), owned = polygonClipping.intersection(region, clipRings(face.rings))
    const cuts = exclusions.get(face.look.id)!
    if (owned.length) cuts.push(owned)
    const angle = visual.environment.lightDirectionDeg * Math.PI / 180, reach = Math.min(face.look.widthMm * .6, (face.highMm - face.lowMm) * .18)
    const shifted = region.map(poly => poly.map(ring => ring.map(([x, y]) => [x - Math.cos(angle) * reach, y - Math.sin(angle) * reach] as [number, number])))
    const shadow = polygonClipping.intersection(shifted, clipRings(face.shadowRings))
    if (shadow.length) cuts.push(shadow)
  }
  const replacement = clipUnion([...exclusions.values()].flat())
  // A saved output outside the top influence can still overlap the old wall's
  // displaced owned region. Refuse that exact overlap as well.
  for (const value of visual.materializedEdges ?? []) {
    const polygons = value.polygons.map(clipPolygon).concat(value.strokes.map(stroke => clipPolygon(terrainTransitionStrokePolygon(stroke.pointsMm, stroke.widthMm))))
    if (polygons.some(poly => clipArea(polygonClipping.intersection(poly, replacement)) > 1e-5)) throw Error(`跨台原崖替换范围触及已保存的物化边 ${value.id}；请先明确调整该表现。`)
  }
  for (const value of visual.transitions ?? []) {
    const polygons = value.polygons.map(poly => clipPolygon(poly.pointsMm)).concat(value.strokes.map(stroke => clipPolygon(terrainTransitionStrokePolygon(stroke.pointsMm, stroke.widthMm))))
    if (polygons.some(poly => clipArea(polygonClipping.intersection(poly, replacement)) > 1e-5)) throw Error(`跨台原崖替换范围触及已保存的常高过渡 ${value.id}；请先明确调整该表现。`)
  }
  return [...exclusions].map(([paintId, polys]) => ({ paintId, regionsMm: clipUnion(polys).map(poly => ({
    outerMm: poly[0].map(([x, y]) => ({ x, y })), holesMm: poly.slice(1).map(ring => ring.map(([x, y]) => ({ x, y }))),
  })) }))
}

/** Occlusion reads the audience-filtered physical projection before editor culling. */
export function projectedSightOccluders(projection: Pick<Projection, 'walls' | 'props'>): Pick<ProjectedVisualSystem, 'occluderRings' | 'occluderLines'> {
  const occluderLines = projection.props.filter(prop => prop.sightOccluder).map(propSightLine)
  return { occluderRings: [...projectedWallFootprints(projection), ...projectedPropFootprints(projection)],
    ...(occluderLines.length ? { occluderLines } : {}) }
}

export function projectedPropFootprints(projection: Pick<Projection, 'props'>): PointMm[][] { return projection.props.filter(prop => prop.blocksSight && !prop.sightOccluder).map(propFootprint) }

/** Physical wall solids including closed doors. Derived once before temporary editor culling. */
export function projectedWallFootprints(projection: Pick<Projection, 'walls'>): PointMm[][] {
  const rings: PointMm[][] = []
  for (const wall of projection.walls) {
    if (wall.blocksLight === false) continue
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length, nx = -uy * wall.thicknessMm / 2, ny = ux * wall.thicknessMm / 2
    const intervals = wall.openings.filter(opening => opening.kind === 'window' || opening.state === 'open').map(opening => {
      const position = (p: PointMm) => (p.x - wall.start.x) * ux + (p.y - wall.start.y) * uy
      return [Math.min(position(opening.start), position(opening.end)), Math.max(position(opening.start), position(opening.end))]
    }).sort((a, b) => a[0] - b[0])
    let start = 0
    const band = (near: number, far: number) => {
      if (far <= near) return
      const a = { x: wall.start.x + ux * near, y: wall.start.y + uy * near }, b = { x: wall.start.x + ux * far, y: wall.start.y + uy * far }
      rings.push([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }])
    }
    for (const [near, far] of intervals) { band(start, near); start = Math.max(start, far) }
    band(start, length)
  }
  return rings
}
