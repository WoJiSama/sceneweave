import type { SceneDocument, PointMm, SurfaceRef, BoundsMm } from '../model/scene.js'
import { roomPoints, terrainPoints, propFootprint, supportedPolygon, polygonDistance, polygonsOverlap, pathPolygon, connectionFootprint, pointOnSurface, openingEndpoints } from '../geometry/geometry.js'
import { connectionCenterline } from '../geometry/connection-route.js'
import { wallMovementPolygons, wallEnvelopePolygons, openingEnvelopePolygon } from '../geometry/doorway-clearance.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { freezeArtifact, hashGenerationValue, type ArtifactInput, type GenerationArtifact, type SpaceQueries } from './contracts.js'

const boundsPolygon = (bounds: BoundsMm): PointMm[] => [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]

/** Own and validate the entire authority document. Never trust a caller freeze. */
export function createSpaceContext(raw: SceneDocument, prefix = 'source'): SpaceQueries {
  const checked = validateSceneDocument(captureJson(raw))
  if (!checked.ok) throw new Error(`生成空间上下文无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const scene = freezeJson(checked.document), facts: GenerationArtifact[] = [], publicVisibility = createPublicVisibility(scene)
  const add = (input: ArtifactInput) => facts.push(freezeArtifact(input))
  const key = (kind: string, id: string) => `fact:${hashGenerationValue([prefix, kind, id])}`
  const elevation = (ref: SurfaceRef): number => ref.kind === 'floor' ? 0 : ref.kind === 'room' ? scene.rooms[ref.id].groundElevationMm : scene.terrainAreas[ref.id].groundElevationMm
  const locked = (entity: { id: string; editLocked: boolean }) => entity.editLocked || !!scene.userLayers[scene.entityLayers[entity.id]]?.editLocked
  if (scene.mapMode === 'regional') {
    for (const floor of Object.values(scene.floors)) add({ kind: 'plan-region', id: key('region', floor.id), owner: 'structure', payload: { coordinateFrame: 'region-mm', floorId: floor.id, visibility: 'public', domain: 'regional', purpose: '', boundaryMm: boundsPolygon(floor.boundsMm) } })
  } else {
    for (const floor of Object.values(scene.floors)) add({ kind: 'support-surface', id: key('floor', floor.id), owner: 'structure', payload: { coordinateFrame: 'scene-mm', floorId: floor.id, visibility: 'public', boundaryMm: boundsPolygon(floor.boundsMm), sourceRef: { kind: 'floor', id: floor.id }, elevationMm: 0, blocksMovement: false, editLocked: false } })
    for (const area of Object.values(scene.terrainAreas)) add({ kind: 'support-surface', id: key('terrainArea', area.id), owner: 'structure', payload: { coordinateFrame: 'scene-mm', floorId: area.floorId, visibility: area.visibility, boundaryMm: terrainPoints(area), sourceRef: { kind: 'terrainArea', id: area.id }, elevationMm: area.groundElevationMm, blocksMovement: area.blocksMovement, editLocked: locked(area) } })
    for (const room of Object.values(scene.rooms)) add({ kind: 'support-surface', id: key('room', room.id), owner: 'structure', payload: { coordinateFrame: 'scene-mm', floorId: room.floorId, visibility: room.visibility, boundaryMm: roomPoints(scene, room), sourceRef: { kind: 'room', id: room.id }, elevationMm: room.groundElevationMm, blocksMovement: false, editLocked: locked(room) } })
    for (const wall of Object.values(scene.walls)) {
      const start = scene.vertices[wall.startVertexId], end = scene.vertices[wall.endVertexId]
      add({ kind: 'wall', id: key('wall', wall.id), owner: 'structure', payload: { coordinateFrame: 'scene-mm', floorId: wall.floorId, visibility: publicVisibility.wall(wall.id) ? 'public' : 'gm', entityId: wall.id,
        startMm: { x: start.xMm, y: start.yMm }, endMm: { x: end.xMm, y: end.yMm }, thicknessMm: wall.thicknessMm, blocksMovement: wall.blocksMovement, editLocked: locked(wall) } })
    }
    for (const opening of Object.values(scene.openings)) {
      const [startMm, endMm] = openingEndpoints(scene, opening)
      add({ kind: 'opening', id: key('opening', opening.id), owner: 'connectivity', payload: { coordinateFrame: 'scene-mm', floorId: opening.floorId, visibility: publicVisibility.opening(opening.id) ? 'public' : 'gm', entityId: opening.id,
        wallId: opening.wallId, startMm, endMm, widthMm: opening.widthMm, openingKind: opening.kind, state: opening.state, locked: opening.locked, secret: opening.secret, revealed: opening.revealed, editLocked: locked(opening) } })
    }
    for (const prop of Object.values(scene.props)) {
      const common = { coordinateFrame: 'scene-mm' as const, floorId: prop.floorId, visibility: prop.visibility }
      add({ kind: 'footprint', id: key('footprint', prop.id), owner: 'content', payload: { ...common, boundaryMm: propFootprint(prop), entityId: prop.id, blocksMovement: prop.blocksMovement, editLocked: locked(prop) } })
      add({ kind: 'prop-placement', id: key('prop', prop.id), owner: 'content', payload: { ...common, entityId: prop.id, definitionRef: prop.definitionRef, positionMm: prop.positionMm, rotationDeg: prop.rotationDeg, footprintMm: prop.footprintMm, footprintOffsetMm: prop.footprintOffsetMm, supportRef: prop.supportRef, blocksMovement: prop.blocksMovement } })
    }
    for (const connection of Object.values(scene.terrainConnections)) {
      const common = { coordinateFrame: 'scene-mm' as const, floorId: connection.floorId, visibility: connection.visibility }
      const path = connectionCenterline(connection)
      const direction = (from: PointMm, to: PointMm) => (Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 360) % 360
      for (const [name, endpoint, toward] of [['from', connection.from, path[1]], ['to', connection.to, path[path.length - 2]]] as const) add({ kind: 'port', id: key('port', `${connection.id}:${name}`), owner: 'connectivity', payload: { ...common, positionMm: endpoint.positionMm, directionDeg: direction(endpoint.positionMm, toward), widthMm: connection.widthMm, elevationMm: elevation(endpoint.surfaceRef), supportRef: endpoint.surfaceRef, role: 'connection-end' } })
      add({ kind: 'connection', id: key('connection', connection.id), owner: 'connectivity', payload: { ...common, entityId: connection.id, fromPortId: key('port', `${connection.id}:from`), toPortId: key('port', `${connection.id}:to`), widthMm: connection.widthMm, pathMm: path, blocksMovement: connection.blocksMovement } })
    }
    // Volcano recipes expose their saved ground entrance without inferring a
    // port from texture, bounds or seed alone.
    for (const recipe of Object.values(getLegacyGeneration(scene)?.recipes ?? {})) if ('domain' in recipe && recipe.domain === 'volcano') {
      const identity = (name: string) => `volcano-${hashGenerationValue([scene.sceneId, recipe.seed, name]).slice(0, 32)}`
      const port = getLegacyGeneration(scene)!.constraints[identity('entrance')], surface = scene.terrainAreas[identity('ground')]
      if (port?.kind !== 'port' || !surface || surface.floorId !== port.floorId) continue
      const r = Math.ceil(port.widthMm / 2), e = port.positionMm
      // Soft reservations may outlive manual geometry edits. Publish only an
      // entrance whose complete width still has its exact current support.
      if (!supportedPolygon(scene, boundsPolygon({ x: e.x - r, y: e.y - r, width: r * 2, height: r * 2 }), { kind: 'terrainArea', id: surface.id }, port.floorId)) continue
      add({ kind: 'port', id: key('port', port.id), owner: 'connectivity', payload: {
        coordinateFrame: 'scene-mm', floorId: port.floorId, visibility: port.visibility, positionMm: port.positionMm, directionDeg: port.directionDeg,
        widthMm: port.widthMm, elevationMm: surface.groundElevationMm, supportRef: { kind: 'terrainArea', id: surface.id }, role: 'entrance',
      } })
    }
    // Forest entrances bind a saved explicit port to a saved explicit surface.
    // Old untyped natural port records retain their existing fact projection.
    const generation = getLegacyGeneration(scene)
    for (const recipe of Object.values(generation?.recipes ?? {})) if ('domain' in recipe && recipe.domain === 'forest') {
      const identity = (name: string) => `forest-${hashGenerationValue([scene.sceneId, recipe.seed, name]).slice(0, 32)}`
      for (const entrance of recipe.parameters.entrances) {
        const port = generation!.constraints[identity(`entrance:${entrance.id}`)]
        const supportRef = { kind: 'terrainArea' as const, id: entrance.supportRef.kind === 'generated-ground' ? identity('ground') : entrance.supportRef.id }
        const surface = scene.terrainAreas[supportRef.id]
        if (!port || port.kind !== 'port' || !surface || surface.floorId !== port.floorId) continue
        add({ kind: 'port', id: key('port', port.id), owner: 'connectivity', payload: { coordinateFrame: 'scene-mm', floorId: port.floorId, visibility: port.visibility,
          positionMm: port.positionMm, directionDeg: port.directionDeg, widthMm: port.widthMm, elevationMm: surface.groundElevationMm, supportRef, role: 'entrance' } })
      }
    }
    for (const path of Object.values(scene.paths)) add({ kind: 'access-zone', id: key('path', path.id), owner: 'connectivity', payload: { coordinateFrame: 'scene-mm', floorId: path.floorId, visibility: path.visibility, boundaryMm: pathPolygon(path), sourceId: path.id, purpose: 'route' } })
    for (const constraint of Object.values(getLegacyGeneration(scene)?.constraints ?? {})) if (constraint.kind === 'activityArea') add({ kind: 'access-zone', id: key('activity', constraint.id), owner: 'connectivity', payload: { coordinateFrame: 'scene-mm', floorId: constraint.floorId, visibility: constraint.visibility, boundaryMm: constraint.boundaryMm, sourceId: constraint.id, purpose: 'activity' } })
    for (const region of Object.values(scene.regions)) if (region.kind === 'hazard' || region.kind === 'manualMask') add({ kind: 'reserved-zone', id: key('region', region.id), owner: 'structure', payload: { coordinateFrame: 'scene-mm', floorId: region.floorId, visibility: region.visibility, boundaryMm: region.boundaryMm, sourceId: region.id, reason: region.kind === 'hazard' ? 'hazard' : 'manual-mask' } })
    for (const collection of ['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'rooms', 'walls'] as const) for (const entity of Object.values(scene[collection])) {
      const style = 'surfaceStyle' in entity ? entity.surfaceStyle : 'floorStyle' in entity ? entity.floorStyle : 'topStyle' in entity ? entity.topStyle : null
      const kind = { terrainAreas: 'terrainArea', terrainEdges: 'terrainEdge', terrainConnections: 'terrainConnection', paths: 'path', rooms: 'room', walls: 'wall' } as const
      if (style) add({ kind: 'material-binding', id: key('material', entity.id), owner: 'presentation', payload: { coordinateFrame: 'scene-mm', targetId: entity.id, targetKind: kind[collection], materialRef: style.base.materialRef } })
    }
  }
  const solids = scene.mapMode === 'scene' ? [
    ...Object.values(scene.props).filter(prop => prop.blocksMovement).map(prop => ({ floorId: prop.floorId, entityId: prop.id, polygon: propFootprint(prop) })),
    ...wallMovementPolygons(scene, true),
    ...Object.values(scene.regions).filter(region => region.blocksMovement || region.kind === 'manualMask').map(region => ({ floorId: region.floorId, entityId: region.id, polygon: region.boundaryMm })),
    ...Object.values(scene.terrainAreas).filter(area => area.blocksMovement).map(area => ({ floorId: area.floorId, entityId: area.id, polygon: terrainPoints(area) })),
    ...Object.values(scene.paths).map(path => ({ floorId: path.floorId, entityId: path.id, polygon: pathPolygon(path) })),
    ...Object.values(scene.terrainConnections).map(connection => ({ floorId: connection.floorId, entityId: connection.id, polygon: connectionFootprint(connection) })),
  ] : []
  const geometryPoints = new Map<string, readonly PointMm[]>(), emptyPoints: readonly PointMm[] = Object.freeze([])
  if (scene.mapMode === 'scene') {
    const walls = new Map<string, PointMm[]>()
    for (const envelope of wallEnvelopePolygons(scene)) {
      const points = walls.get(envelope.entityId) ?? []
      points.push(...envelope.polygon); walls.set(envelope.entityId, points)
    }
    for (const [entityId, points] of walls) geometryPoints.set(entityId, freezeJson(points))
    for (const opening of Object.values(scene.openings)) geometryPoints.set(opening.id, freezeJson(openingEnvelopePolygon(scene, opening.id)))
  }
  const context: SpaceQueries = {
    sceneId: scene.sceneId, revision: scene.revision, contentHash: hashGenerationValue(scene), coordinateFrame: scene.mapMode === 'regional' ? 'region-mm' : 'scene-mm', artifacts: freezeJson(facts.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    entityGeometryPoints(entityId) { return geometryPoints.get(entityId) ?? emptyPoints },
    supportsPolygon(boundary, ref, floorId) { return scene.mapMode === 'scene' && boundary.length >= 3 && supportedPolygon(scene, boundary.map(p => ({ ...p })), ref, floorId) },
    conflicts(boundary, floorId, minimumMm = 0, ignore = []) {
      if (!Number.isSafeInteger(minimumMm) || minimumMm < 0 || boundary.length < 3) throw new Error('净空查询参数无效。')
      const polygon = boundary.map(p => ({ ...p })), excluded = new Set(ignore)
      return Object.freeze([...new Set(solids.filter(solid => solid.floorId === floorId && !excluded.has(solid.entityId) && (polygonsOverlap(polygon, solid.polygon) || polygonDistance(polygon, solid.polygon) < minimumMm)).map(solid => solid.entityId))].sort())
    },
    connectionUsable(entityId, minimumWidthMm) {
      const connection = scene.terrainConnections[entityId]
      if (scene.mapMode !== 'scene' || !connection || connection.blocksMovement || connection.widthMm < minimumWidthMm) return false
      const opening = connection.openingId ? scene.openings[connection.openingId] : undefined
      return (!connection.openingId || !!opening && opening.kind === 'door' && opening.state === 'open' && !opening.locked && opening.widthMm >= minimumWidthMm)
        && pointOnSurface(scene, connection.from.positionMm, connection.from.surfaceRef, connection.floorId) && pointOnSurface(scene, connection.to.positionMm, connection.to.surfaceRef, connection.floorId)
    },
  }
  return Object.freeze(context)
}
