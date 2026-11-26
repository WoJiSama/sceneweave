import type { Path, PointMm, SceneDocument, SurfaceRef } from '../model/scene.js'
import { connectionArcFrame } from './connection-route.js'
import { wallMovementPolygons } from './doorway-clearance.js'
import { connectionFootprint, corridor, coveredEverywhere, pathPolygon, polygonValid, polygonsOverlap, propFootprint, roomPoints } from './geometry.js'
import { AUTOMATIC_ROAD_VERSION, ROAD_MIN_GOING_MM, ROAD_PPM, ROAD_RISER_LIMIT_MM, ROAD_SURFACE_DEPTH_MM, RoadFootprintConflict, RoadProfileConflict, buildRoadSurface, roadFaceNormal, roadSpanTriangles, roadSurfaceFrame, roadSurfaceSchema, toRoadPpm, type RoadLanding, type RoadVertex } from './road-surface.js'
import { createSupportQuery, rootSurfaceElevation } from './support-sample.js'
import { reliefBounds } from './terrain-relief.js'

export const roadSupportKey = ({ kind, id }: SurfaceRef) => `${kind}:${id}`
export const roadPointEquals = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y

/** Both the sketch and the saved road use the same ground and occupancy checks. */
export function createRoadGround(scene: SceneDocument, floorId: string, editingId?: string) {
  const query = createSupportQuery(scene, floorId, undefined, false)
  const sameFloor = <T extends { floorId: string }>(records: Record<string, T>) => Object.values(records).filter(item => item.floorId === floorId)
  const blockers = [
    ...wallMovementPolygons(scene, true).filter(wall => wall.floorId === floorId).map(wall => wall.polygon),
    ...sameFloor(scene.rooms).map(room => roomPoints(scene, room)),
    ...sameFloor(scene.props).map(propFootprint),
    ...sameFloor(scene.regions).filter(region => region.blocksMovement).map(region => region.boundaryMm),
    ...sameFloor(scene.terrainConnections).map(connectionFootprint),
    ...sameFloor(scene.paths).filter(path => path.id !== editingId).map(roadEffectsPolygon),
    ...sameFloor(scene.terrainEdges).filter(edge => edge.blocksMovement).flatMap(edge => {
      const boundary = scene.terrainAreas[edge.source.areaId]?.boundaryMm ?? []
      const i = boundary.findIndex(vertex => vertex.segmentId === edge.source.segmentId)
      return i < 0 ? [] : [corridor(boundary[i].positionMm, boundary[(i + 1) % boundary.length].positionMm, .2)]
    }),
  ].filter(polygon => polygon.length >= 3).map(polygon => ({ polygon, bounds: reliefBounds(polygon) }))
  const sample = (point: PointMm) => {
    const ground = query.sourceSample(point)
    if (!ground || ground.sourceConnectionId || ground.sourceRockShellAreaId) return null
    const area = scene.terrainAreas[ground.rootSupportRef.id]
    return area?.blocksMovement || area?.waterSurface ? null : ground
  }
  const clear = (band: PointMm[]) => {
    const bounds = reliefBounds(band)
    return !blockers.some(({ bounds: b, polygon }) => bounds.x <= b.x + b.width && b.x <= bounds.x + bounds.width
      && bounds.y <= b.y + b.height && b.y <= bounds.y + bounds.height && polygonsOverlap(band, polygon))
  }
  const supports = (band: PointMm[]) => {
    if (!clear(band)) return null
    const refs = new Map<string, SurfaceRef>(), datums = new Set<number>()
    const covered = coveredEverywhere(band, query.sourceBoundaries, point => {
      const ground = sample(point)
      if (!ground) return false
      refs.set(roadSupportKey(ground.rootSupportRef), ground.rootSupportRef)
      datums.add(rootSurfaceElevation(scene, ground.rootSupportRef)!)
      return datums.size === 1
    })
    return covered ? [...refs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, ref]) => ref) : null
  }
  return { sample, supports, clear }
}

/** Includes both banks for collision, impact and audience coverage checks. */
export function roadEffectsPolygon(path: Path): PointMm[] {
  if (path.roadSurface) {
    try { return buildRoadSurface(path, path.roadSurface).footprintMm } catch { return [] }
  }
  return pathPolygon(path)
}

export function assertRoadProfile(path: Pick<Path, 'centerlineMm' | 'widthMm' | 'widthSections'>, raw: NonNullable<Path['roadSurface']>,
  landings: readonly RoadLanding[], fixed: readonly PointMm[], ground: ReturnType<typeof createRoadGround>) {
  const surface = roadSurfaceSchema.parse(raw), frame = roadSurfaceFrame(path), geometry = buildRoadSurface(path, surface)
  const turnConflict = (at: PointMm) => { throw new RoadProfileConflict('道路及两侧边坡在转弯处重叠，请拉开前后两段。', at, 'turn') }
  if (!polygonValid(geometry.footprintMm, true, turnConflict) || !polygonValid(geometry.coreMm, true, turnConflict)) turnConflict(path.centerlineMm[0])
  const stationKeys = new Set(surface.stations.map(row => row.atPpm))
  if ([...frame.knots.keys()].some(key => !stationKeys.has(key))) throw new Error('道路断面缺少转弯或宽度过渡。')
  const refs = ground.supports(geometry.footprintMm)
  if (!refs) {
    const shoulderMm = Math.max(...surface.stations.flatMap(row => row.shoulderMm))
    throw new RoadFootprintConflict('道路或边坡的实际占地与附近地面、道路或物件冲突。', shoulderMm)
  }
  let lastRiser = -Infinity
  for (const [i, row] of surface.stations.entries()) {
    const xy = frame.sectionAt(row.atPpm, row.shoulderMm), end = row.atPpm === 0 || row.atPpm === ROAD_PPM
    const heights = [row.inZMm, row.outZMm ?? row.inZMm]
    for (const side of [0, 1] as const) {
      const bank = ground.sample(xy[side ? 3 : 0]), raw = ground.sample(xy[side + 1])
      if (!bank || !raw || Math.abs(bank.zMm - row.bankZMm[side]) > 1.01) throw new Error('道路边坡须与保存时的来源地形接合。')
      if (end && row.shoulderMm[side]) throw new Error('道路两端须以完整净宽接地。')
      if (heights.some(z => Math.abs(z[side] - row.bankZMm[side]) > (row.shoulderMm[side] ? ROAD_SURFACE_DEPTH_MM : 1)
        || Math.abs(z[side] - raw.zMm) > ROAD_SURFACE_DEPTH_MM)) throw new Error('道路挖填高差超过可接合范围。')
    }
    if (row.outZMm) {
      const [right, left] = row.outZMm.map((z, side) => z - row.inZMm[side])
      if (!right || right !== left || Math.abs(right) > ROAD_RISER_LIMIT_MM || frame.distance(row.atPpm) - lastRiser < ROAD_MIN_GOING_MM - 1
        || row.kind !== 'tread' || surface.stations[i - 1]?.kind !== 'tread') throw new Error('路阶须全宽等高升降，每级高度与有效踏深须在范围内。')
      lastRiser = frame.distance(row.atPpm)
    }
  }
  for (const span of geometry.spans) {
    const length = frame.distance(span.bPpm) - frame.distance(span.aPpm)
    const aZ = (span.start[1].z + span.start[2].z) / 2, bZ = (span.end[1].z + span.end[2].z) / 2
    if (span.kind === 'landing' && (aZ !== bZ || [span.start[1], span.start[2], span.end[1], span.end[2]].some(vertex => vertex.z !== aZ))) throw new Error('歇脚平台的整个净宽须水平。')
    if (Math.abs(aZ - bZ) > length * (span.kind === 'tread' ? .19 : .43) + 2) {
      throw new RoadProfileConflict('道路纵坡过急，须调整路线或平台。', span.start[1])
    }
    for (const lane of [0, 1, 2] as const) {
      const faces = roadSpanTriangles(span, lane)
      if (lane === 1 && faces.length !== 2) throw new Error('道路断面须保有完整净宽。')
      for (const face of faces) {
        const [a, b, c] = face, area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
        if (area <= 0) throw new RoadProfileConflict('道路两侧边坡或净宽在转弯处折返。', a, 'turn')
        if (lane === 1 && roadFaceNormal(face).z < Math.SQRT1_2 - 1e-9) throw new RoadProfileConflict('完整净宽内有无法步行的坡面，请调整路线或净宽。', a)
      }
    }
  }
  const checkContact = (a: RoadVertex, b: RoadVertex) => {
    const count = Math.min(32, Math.max(2, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 125)))
    for (let i = 1; i < count; i++) {
      const t = i / count, point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      const source = ground.sample(point)
      if (!source || Math.abs(source.zMm - (a.z + (b.z - a.z) * t)) > ROAD_RISER_LIMIT_MM) {
        throw new RoadProfileConflict('路肩或端部在两断面之间与原地面落差过大。', point)
      }
    }
  }
  for (const { start, end } of geometry.spans) {
    checkContact(start[0], end[0])
    checkContact(start[3], end[3])
  }
  const first = geometry.spans[0].start, last = geometry.spans.at(-1)!.end
  checkContact(first[1], first[2])
  checkContact(last[1], last[2])
  const arc = connectionArcFrame(path.centerlineMm)
  const pinned = new Set<number>()
  for (const landing of landings) {
    const anchor = fixed.findIndex(point => roadPointEquals(point, landing.pointMm))
    if (anchor < 1 || anchor >= fixed.length - 1 || pinned.has(anchor)) throw new Error('每个手调平台须绑定一个不同的内部固定点。')
    pinned.add(anchor)
    const center = arc.distances[path.centerlineMm.findIndex(point => roadPointEquals(point, landing.pointMm))]
    const start = toRoadPpm(center - landing.lengthMm / 2, frame.length), end = toRoadPpm(center + landing.lengthMm / 2, frame.length)
    if (!stationKeys.has(start) || !stationKeys.has(end) || geometry.spans.some(span => span.aPpm < end && span.bPpm > start
      && (span.kind !== 'landing' || span.start[1].z !== landing.elevationMm))) throw new Error('已固定平台的完整长度与高程须保留在保存的断面中。')
  }
  return { geometry, refs }
}

export function validateAdoptedRoad(scene: SceneDocument, path: Path) {
  const intent = path.automaticRoute
  if (!path.roadSurface || intent?.algorithm !== AUTOMATIC_ROAD_VERSION || !intent.automaticStairs || path.assembly?.bridge
    || Object.values(scene.pathAttachments ?? {}).some(binding => binding.pathId === path.id)) throw new Error('道路塑形须有匹配的自动选路版本，且使用陆地承托。')
  const { refs } = assertRoadProfile(path, path.roadSurface, intent.landings ?? [], intent.fixedPointsMm, createRoadGround(scene, path.floorId, path.id))
  if (refs.map(roadSupportKey).join('\n') !== path.supportRefs.map(roadSupportKey).sort((a, b) => a.localeCompare(b)).join('\n')) throw new Error('道路及两侧边坡须声明完整的真实承托。')
}
