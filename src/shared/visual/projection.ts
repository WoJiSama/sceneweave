import type { BoundsMm, PointMm, SceneDocument } from '../model/scene.js'
import { propFootprint } from '../geometry/geometry.js'
import { cloneJson } from '../validation/json.js'
import type { Audience, ProjectedVisualBoundary, ProjectedVisualFilter, ProjectedVisualSystem, Projection } from '../projection/types.js'
import { sampleVisualBoundary } from './geometry.js'
import type { VisualSystem } from './types.js'

const copy = <T>(value: T): T => cloneJson(value)
const bounds = (points: PointMm[]): BoundsMm => ({ x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) })
const segmentKey = (a: PointMm, b: PointMm) => [a, b].map(p => `${p.x},${p.y}`).sort().join('|')
function propVisualRing(prop: SceneDocument['props'][string]): PointMm[] {
  const v = prop.visualBoundsMm, angle = prop.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  return [[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]].map(([x, y]) => ({ x: prop.positionMm.x + x * cos - y * sin, y: prop.positionMm.y + x * sin + y * cos }))
}

/** This boundary receives the audience's completed physical projection, never a GM render cache. */
export function projectVisualSystem(scene: SceneDocument, visual: VisualSystem, projection: Projection, audience: Audience, hiddenLayerIds?: ReadonlySet<string>, visibleWallIds?: ReadonlySet<string>): ProjectedVisualSystem {
  const shown = (value: { layerId: string; visibility: string; enabled?: boolean }) => value.enabled !== false && !hiddenLayerIds?.has(value.layerId) && (audience === 'gm' || value.visibility === 'public')
  const terrains = new Set(projection.terrain.map(a => a.id)), paths = new Set(projection.paths.map(a => a.id))
  const boundaries: ProjectedVisualBoundary[] = []
  for (const boundary of Object.values(visual.boundaries).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!shown(boundary)) continue
    const binding = boundary.binding
    if (binding.kind === 'terrain' && !binding.sides.every(side => terrains.has(side.areaId))) continue
    if (binding.kind === 'path' && !paths.has(binding.pathId)) continue
    const sampled = sampleVisualBoundary(boundary)
    boundaries.push({ id: boundary.id, points: copy(sampled.points), samples: copy(sampled.samples), lengthMm: sampled.lengthMm, closed: sampled.closed, terrainAreaIds: binding.kind === 'terrain' ? binding.sides.map(side => side.areaId) : [] })
  }
  const boundaryIds = new Set(boundaries.map(b => b.id)), edgeLooks = Object.values(visual.edgeLooks).filter(look => shown(look) && boundaryIds.has(look.boundaryId)).sort((a, b) => a.id.localeCompare(b.id)).map(copy)
  const decorated = new Set(edgeLooks.map(look => look.boundaryId)), replacedSegments = new Set<string>()
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
  for (const region of projection.regions) targetRings.set(region.id, [copy(region.points)])
  for (const wall of Object.values(scene.walls)) {
    if (visibleWallIds ? !visibleWallIds.has(wall.id) : !projection.walls.some(projected => projected.sourceIds.includes(wall.id))) continue
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId], dx = b.xMm - a.xMm, dy = b.yMm - a.yMm, l = Math.hypot(dx, dy), nx = -dy / l * wall.thicknessMm / 2, ny = dx / l * wall.thicknessMm / 2
    targetRings.set(wall.id, [[{ x: a.xMm + nx, y: a.yMm + ny }, { x: b.xMm + nx, y: b.yMm + ny }, { x: b.xMm - nx, y: b.yMm - ny }, { x: a.xMm - nx, y: a.yMm - ny }]])
  }
  for (const connection of projection.connections) {
    const dx = connection.end.x - connection.start.x, dy = connection.end.y - connection.start.y, l = Math.hypot(dx, dy), nx = -dy / l * connection.widthMm / 2, ny = dx / l * connection.widthMm / 2
    targetRings.set(connection.id, [[{ x: connection.start.x + nx, y: connection.start.y + ny }, { x: connection.end.x + nx, y: connection.end.y + ny }, { x: connection.end.x - nx, y: connection.end.y - ny }, { x: connection.start.x - nx, y: connection.start.y - ny }]])
  }
  for (const group of Object.values(scene.prefabInstances)) {
    const rings = Object.values(group.members).flatMap(member => member.propId ? targetRings.get(member.propId) ?? [] : [])
    if ((audience === 'gm' || group.visibility === 'public') && rings.length) targetRings.set(group.id, rings)
  }
  for (const group of Object.values(scene.scatterGroups)) {
    const rings = Object.values(group.members).flatMap(member => member.state !== 'detached' && member.propId ? targetRings.get(member.propId) ?? [] : [])
    if ((audience === 'gm' || group.visibility === 'public') && rings.length) targetRings.set(group.id, rings)
  }
  const renderTargets = new Map([...targetRings.keys()].map(id => [id, [id]]))
  for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) renderTargets.set(group.id, Object.values(group.members).flatMap(member => member.propId && targetRings.has(member.propId) ? [member.propId] : []))
  for (const wall of Object.values(scene.walls)) if (targetRings.has(wall.id)) {
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
    const targetBoundsMm = rings ? bounds(rings.flat()) : copy(scene.exportBoundsMm)
    filters.push({ ...copy(parameters), ...(sourceEntityIds ? { sourceEntityIds } : {}), ...(target.kind === 'region' ? { regionFeatherMm: Math.min(1200, Math.min(targetBoundsMm.width, targetBoundsMm.height) * .16) } : {}), targetRings: rings, targetBoundsMm })
  }
  return { environment: copy(visual.environment), boundsMm: copy(scene.exportBoundsMm), boundaries, edgeLooks,
    lights: Object.values(visual.lights).filter(light => shown(light) && (audience === 'gm' || !projection.masks.some(mask => { const b = bounds(mask); return light.positionMm.x >= b.x && light.positionMm.y >= b.y && light.positionMm.x <= b.x + b.width && light.positionMm.y <= b.y + b.height }))).sort((a, b) => a.id.localeCompare(b.id)).map(copy),
    fogs: Object.values(visual.fogs).filter(shown).sort((a, b) => a.id.localeCompare(b.id)).map(copy), filters,
    occluderRings: [...projectedWallFootprints(projection), ...projectedPropFootprints(projection)],
    contactRings: projection.props.filter(prop => prop.renderLayer !== 'ground' && prop.shadowClass !== 'none').map(propVisualRing),
    suppressedTerrainEdgeIds: projection.edges.filter(edge => replacedSegments.has(segmentKey(edge.start, edge.end))).map(edge => edge.id) }
}

/** Contact and point-light occlusion use physical footprints, independent of editor LOD. */
export function projectedPropFootprints(projection: Pick<Projection, 'props'>): PointMm[][] { return projection.props.filter(prop => prop.blocksSight).map(propFootprint) }

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
