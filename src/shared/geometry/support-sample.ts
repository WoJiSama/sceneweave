import type { GroundSurfaceRef, PointMm, SceneDocument, SurfaceRef } from '../model/scene.js'
import { createCarvedStripSampler } from '../carved-rock/index.js'
import { createRockShellSampler } from '../rock-shell/index.js'
import { createTerrainInlaySampler } from '../terrain-inlay/geometry.js'
import { resolvePropContact, transformAttachmentPoint } from '../attachments/contact.js'
import { coveredEverywhere, pointInPolygon, terrainPoints } from './geometry.js'
import { reliefBounds, sampleTerrainRelief } from './terrain-relief.js'
import { buildRoadSurface, createRoadSurfaceSampler } from './road-surface.js'
import { isFlatCanvasGround } from '../model/canvas-ground.js'

export interface SupportSample {
  rootSupportRef: SurfaceRef
  actualSurfaceId: string
  zMm: number
  normal: { x: number; y: number; z: number }
  walkable: boolean
  sourceConnectionId?: string
  sourceRockShellAreaId?: string
  sourcePathId?: string
}
const EPS = 1e-7
const up = { x: 0, y: 0, z: 1 }
export const rootSurfaceElevation = (scene: SceneDocument, ref: SurfaceRef): number | undefined => ref.kind === 'floor' ? scene.floors[ref.id] && 0 : ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id]?.groundElevationMm : scene.rooms[ref.id]?.groundElevationMm

/** One synchronous operation owns this disposable query. No mutable-scene or ID
 * cache: callers discard it after validation/travel; saved geometry is never regenerated. */
export function createSupportQuery(scene: SceneDocument, floorId: string, excludedAreaIds?: ReadonlySet<string>, includeRoads = true) {
  const floor = scene.floors[floorId]
  const areas = Object.values(scene.terrainAreas).filter(row => row.floorId === floorId && !excludedAreaIds?.has(row.id)).sort((a, b) => b.coveragePriority - a.coveragePriority || a.id.localeCompare(b.id))
  const reliefs = new Map(areas.flatMap(area => area.relief ? [[area.id, { grid: area.relief, bounds: reliefBounds(terrainPoints(area)) }] as const] : []))
  const invalidHosts = new Set<string>()
  const strips = Object.values(scene.terrainConnections).filter(row => row.floorId === floorId && row.carvedStrip).flatMap(connection => {
    try { return [{ connection, sampler: createCarvedStripSampler(connection.carvedStrip!) }] }
    catch { invalidHosts.add(connection.carvedStrip!.hostAreaId); return [] }
  })
  const shells = areas.filter(area => area.rockBody?.shell).flatMap(area => {
    try { return [{ area, sampler: createRockShellSampler(area.rockBody!.shell!) }] }
    catch { invalidHosts.add(area.id); return [] }
  })
  const shellBoundaries = shells.flatMap(row => row.sampler.triangles.map(face => face.verticesMm.map(({ x, y }) => ({ x, y }))))
  const inlays = Object.values(scene.terrainConnections).filter(row => row.floorId === floorId && row.terrainInlay).flatMap(connection => {
    try { return [{ connection, sampler: createTerrainInlaySampler(connection.terrainInlay!.geometry) }] }
    catch { connection.terrainInlay!.geometry.sources.forEach(source => invalidHosts.add(source.id)); return [] }
  })
  const inlayBoundaries = inlays.flatMap(row => Object.values(row.connection.terrainInlay!.geometry.faces).map(face => face.vertexIds.map(id => row.connection.terrainInlay!.geometry.verticesMm[id])))
  const roads = includeRoads ? Object.values(scene.paths).flatMap(path => {
    if (path.floorId !== floorId || !path.roadSurface || path.supportRefs.some(ref => excludedAreaIds?.has(ref.id))) return []
    try {
      const geometry = buildRoadSurface(path, path.roadSurface)
      return [{ path, geometry, sampler: createRoadSurfaceSampler(geometry) }]
    } catch { return [] }
  }) : []
  const sourceBoundaries = [...areas.map(terrainPoints), ...strips.flatMap(row => row.sampler.cutFootprints), ...shellBoundaries, ...inlayBoundaries]
  const boundaries = [...sourceBoundaries, ...roads.flatMap(({ geometry }) => [geometry.footprintMm, geometry.coreMm])]
  const contains = (p: PointMm) => !!floor && p.x >= floor.boundsMm.x - EPS && p.y >= floor.boundsMm.y - EPS && p.x <= floor.boundsMm.x + floor.boundsMm.width + EPS && p.y <= floor.boundsMm.y + floor.boundsMm.height + EPS
  // The unchanged authored top wins its shared boundary. The outward shell is
  // a real owned surface only beyond that top, never a replacement top ring.
  const shellHits = (p: PointMm) => shells.filter(row => !pointInPolygon(p, terrainPoints(row.area))).flatMap(row => {
    const actual = row.sampler.sample(p)
    return actual ? [{ row, actual }] : []
  })
  const rootAt = (p: PointMm): GroundSurfaceRef | null => {
    if (!contains(p)) return null
    const area = areas.find(row => pointInPolygon(p, terrainPoints(row)))
    const hits = shellHits(p)
    if (hits.length > 1 || area && !isFlatCanvasGround(area) && hits.some(hit => hit.row.area.id !== area.id)) return null
    if (hits.length) return { kind: 'terrainArea', id: hits[0].row.area.id }
    return area ? { kind: 'terrainArea', id: area.id } : { kind: 'floor', id: floorId }
  }
  const sourceSample = (p: PointMm, explicitSurfaceId?: string): SupportSample | null => {
    const root = rootAt(p)
    if (!root) return null
    if (root.kind === 'terrainArea' && invalidHosts.has(root.id)) return null
    if (explicitSurfaceId) {
      const surface = scene.attachmentSurfaces?.[explicitSurfaceId]
      if (!surface) return null
      if (surface.feature.kind === 'propTop' && surface.owner.kind === 'prop') {
        const prop = scene.props[surface.owner.id]
        if (!prop || prop.floorId !== floorId || !surface.capabilities.includes('support')) return null
        const polygon = surface.feature.polygonLocalMm.map(point => transformAttachmentPoint(point, prop.positionMm, prop.rotationDeg))
        if (!pointInPolygon(p, polygon)) return null
        const contact = resolvePropContact(scene, prop.id)
        return { rootSupportRef: contact.rootSupportRef, actualSurfaceId: surface.id, zMm: contact.contactElevationMm + surface.feature.heightLocalMm, normal: { ...up }, walkable: surface.capabilities.includes('walk') }
      }
      if (surface.feature.kind !== 'carvedWalk' || surface.owner.kind !== 'terrainConnection') return null
      const row = strips.find(row => row.connection.id === surface.owner.id && row.connection.carvedStrip!.walkSurfaceId === surface.id)
      if (!row || root.kind !== 'terrainArea' || root.id !== row.connection.carvedStrip!.hostAreaId) return null
      const actual = row.sampler.sample(p)
      return actual && surface.feature.faceIds.includes(actual.faceId) ? { rootSupportRef: root, actualSurfaceId: surface.id, zMm: actual.zMm, normal: actual.normal, walkable: !row.connection.blocksMovement && surface.capabilities.includes('walk'), sourceConnectionId: row.connection.id } : null
    }
    const actualHits = inlays.flatMap(row => { const hit = row.sampler.sample(p); return hit ? [{ row, hit }] : [] })
    if (actualHits.length > 1) return null
    if (actualHits.length) {
      const { row, hit } = actualHits[0]
      if (root.kind !== 'terrainArea' || !row.connection.terrainInlay!.geometry.sources.some(source => source.id === root.id)) return null
      return { rootSupportRef: root, actualSurfaceId: hit.faceId, zMm: hit.zMm, normal: hit.normal,
        walkable: hit.kind === 'walk' && !row.connection.blocksMovement && !scene.terrainAreas[root.id].blocksMovement, sourceConnectionId: row.connection.id }
    }
    const shell = shellHits(p)[0]
    if (shell) return { rootSupportRef: root, actualSurfaceId: shell.actual.faceId, zMm: shell.actual.zMm, normal: shell.actual.normal, walkable: false, sourceRockShellAreaId: shell.row.area.id }
    const cuts = root.kind === 'terrainArea' ? strips.filter(row => row.connection.carvedStrip!.hostAreaId === root.id).flatMap(row => { const actual = row.sampler.sampleCut(p); return actual ? [{ row, actual }] : [] }) : []
    // Ambiguous/overlapping physical cuts grant no support; the owning validator
    // separately reports the complete invalid geometry.
    if (cuts.length > 1) return null
    if (cuts.length) {
      const { row, actual } = cuts[0]
      return { rootSupportRef: root, actualSurfaceId: actual.kind === 'walk' ? row.connection.carvedStrip!.walkSurfaceId : actual.faceId, zMm: actual.zMm, normal: actual.normal,
        walkable: actual.kind === 'walk' && !row.connection.blocksMovement && !scene.terrainAreas[root.id].blocksMovement, sourceConnectionId: row.connection.id }
    }
    const relief = root.kind === 'terrainArea' ? reliefs.get(root.id) : undefined
    const shape = relief && sampleTerrainRelief(relief.grid, relief.bounds, p)
    return { rootSupportRef: root, actualSurfaceId: root.kind + ':' + root.id,
      zMm: rootSurfaceElevation(scene, root)! + (shape?.offsetMm ?? 0), normal: shape?.normal ?? { ...up },
      walkable: (root.kind !== 'terrainArea' || !scene.terrainAreas[root.id].blocksMovement) && (!shape || shape.normal.z >= Math.SQRT1_2) }
  }
  const sample = (p: PointMm, explicitSurfaceId?: string): SupportSample | null => {
    const ground = sourceSample(p, explicitSurfaceId)
    if (!ground || explicitSurfaceId || ground.sourceConnectionId || ground.sourceRockShellAreaId) return ground
    const hits = roads.flatMap(({ path, sampler }) => {
      const hit = sampler.sample(p)
      return hit ? [{ path, hit }] : []
    })
    if (hits.length > 1 && hits.some(({ hit }) => Math.abs(hit.zMm - hits[0].hit.zMm) > 1)) return null
    if (!hits.length) return ground
    const { path, hit } = hits.find(row => row.hit.core) ?? hits[0]
    return { rootSupportRef: ground.rootSupportRef, actualSurfaceId: `path:${path.id}`, sourcePathId: path.id,
      zMm: hit.zMm, normal: hit.normal, walkable: hit.normal.z >= Math.SQRT1_2 }
  }
  const flatOn = (p: PointMm, ref: SurfaceRef): boolean => {
    const actual = sample(p)
    return !!actual && !actual.sourceRockShellAreaId && Math.abs(actual.zMm - (rootSurfaceElevation(scene, ref) ?? NaN)) <= EPS && Math.abs(actual.normal.x) <= EPS && Math.abs(actual.normal.y) <= EPS
  }
  return { sample, sourceSample, rootAt, flatOn, boundaries, sourceBoundaries, roads, strips, shells, shellBoundaries, inlays, inlayBoundaries }
}

/** Explicit surface selection is required for raised item surfaces. Ordinary
 * XY queries resolve only current ground/actual carved cuts. */
export function supportSampleAt(scene: SceneDocument, floorId: string, xy: PointMm, explicitSurfaceId?: string): SupportSample | null {
  return createSupportQuery(scene, floorId).sample(xy, explicitSurfaceId)
}

/** Legacy flat authored roads have no explicit actual-surface relation. They
 * must prove every arrangement face at the declared height, not reuse a root
 * ID to paint a second road over a saved carved ramp/cut. */
export function levelGroundPolygon(scene: SceneDocument, floorId: string, polygon: PointMm[], refs: readonly SurfaceRef[], zMm: number): boolean {
  const query = createSupportQuery(scene, floorId)
  return coveredEverywhere(polygon, query.boundaries, point => {
    const sample = query.sample(point)
    return !!sample && !sample.sourceConnectionId && !sample.sourceRockShellAreaId && !sample.sourcePathId && Math.abs(sample.zMm - zMm) <= EPS && Math.abs(sample.normal.x) <= EPS && Math.abs(sample.normal.y) <= EPS
      && refs.some(ref => ref.kind === sample.rootSupportRef.kind && ref.id === sample.rootSupportRef.id)
  })
}
