import type { MapGenerateRequest, MapOperation } from '../../shared/generation/map-authoring.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import type { BoundsMm, Floor, PointMm, SceneDocument, SurfaceRef } from '../../shared/model/scene.js'
import { DECORATION_COLLECTIONS, LAYER_ENTITY_COLLECTIONS, SURFACE_RULE_COLLECTIONS } from '../../shared/model/scene.js'
import { createPublicVisibility, publicTerrainView } from '../../shared/geometry/visibility.js'
import { roomPoints, terrainPoints } from '../../shared/geometry/geometry.js'
import { createReliefBrush } from '../../shared/geometry/terrain-relief-edit.js'
import { createAutomaticRoadPlanner } from '../../shared/geometry/automatic-road.js'
import { landmarkRoutes } from '../../shared/geometry/landmark-route.js'
import { createRoadGround } from '../../shared/geometry/road-domain.js'
import { reliefBounds } from '../../shared/geometry/terrain-relief.js'
import { createSupportQuery } from '../../shared/geometry/support-sample.js'
import { AUTOMATIC_ROAD_MAX_FIXED_POINTS, AUTOMATIC_ROAD_VERSION } from '../../shared/geometry/road-surface.js'
import { connectionArcFrame } from '../../shared/geometry/connection-route.js'
import { withGeometryPairCounter } from '../../shared/geometry/edge-index.js'
import { splitNewTerrainJunctions } from '../../shared/geometry/terrain-junctions.js'
import { checkGradedRoadOnValidScene, checkRouteOnValidScene } from '../../shared/geometry/terrain-travel.js'
import { findExposedTerrainEdge, reconcileTerrainBoundary } from '../../shared/commands/outdoor.js'
import { SHORE_MATERIAL_IDS } from '../../shared/visual/shore-art.js'
import { newMapArtStyle, upgradeSceneArtStyle } from '../../shared/visual/art-style.js'
import { visualBase } from '../../shared/visual/base.js'
import { canonicalJson } from '../../shared/validation/json.js'
import { OperationRejected } from '../../shared/validation/operation-rejection.js'
import { assertTaskBudget, captureExecutionBudget, captureGeometryPairBudget, measureDocumentBudget, measureTaskBudget, type ExecutionBudget, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { LANDSCAPE_SCATTER_ALGORITHM_VERSIONS } from '../../shared/geometry/scatter-algorithm.js'
import { gradeLandscapeRouteRelief, landscapeRouteAnchors, LANDSCAPE_WATER_ID, type LandscapeRoadFailure } from '../../shared/terrain-generation/landscape-authoring.js'
import { landscapeCover, landscapeRouteClearances, landscapeSceneryExclusions, landscapeSceneryZone } from '../../shared/terrain-generation/landscape-finish.js'
import { prepareCompositionCommands, type PrepareOptions } from './prepare.js'
import type { EditableProject } from './project.js'

const own = <T>(record: Record<string, T>, id: string) => Object.hasOwn(record, id) ? record[id] : undefined
const same = (a: unknown, b: unknown) => a === b || canonicalJson(a ?? null) === canonicalJson(b ?? null)

export function mapCoordinate(bounds: BoundsMm, reference?: MapGenerateRequest['referenceSizePx'], preserveAspect = false) {
  const scale = reference && Math.min(bounds.width / reference.width, bounds.height / reference.height)
  return ({ x, y }: PointMm): PointMm => {
    if (!reference) return { x, y }
    if (x < 0 || y < 0 || x > reference.width || y > reference.height) throw new Error('参考图坐标超出声明的像素范围。')
    if (preserveAspect && scale) return {
      x: bounds.x + Math.round((bounds.width - reference.width * scale) / 2 + x * scale),
      y: bounds.y + Math.round((bounds.height - reference.height * scale) / 2 + y * scale),
    }
    return { x: bounds.x + Math.round(x * bounds.width / reference.width), y: bounds.y + Math.round(y * bounds.height / reference.height) }
  }
}

const shoreMaterials = {
  water: SHORE_MATERIAL_IDS.waterDeep, shallow: SHORE_MATERIAL_IDS.waterShallow, rock: SHORE_MATERIAL_IDS.rockDry,
  grass: SHORE_MATERIAL_IDS.grass, sand: SHORE_MATERIAL_IDS.sandDry, 'rock-wet': SHORE_MATERIAL_IDS.rockWet,
  'sand-wet': SHORE_MATERIAL_IDS.sandWet,
}

function compileMapOperations(scene: SceneDocument, floor: Floor, input: Pick<MapGenerateRequest, 'operations' | 'referenceSizePx' | 'checks'>,
  runtime: PrepareOptions['runtime'], preserveAspect: boolean, meter: ExecutionBudget) {
  const point = mapCoordinate(floor.boundsMm, input.referenceSizePx, preserveAspect)
  const origin = point({ x: 0, y: 0 })
  const size = (radius: PointMm) => {
    const end = point(radius)
    return { x: end.x - origin.x, y: end.y - origin.y }
  }
  const frame = { point, size }, clearances = landscapeRouteClearances(input.checks, floor, point)
  const plannedCovers = new Map<string, NonNullable<SceneDocument['terrainAreas'][string]['surfaceStyle']>>()
  const exclusionCommands = (groupId: string, exclusions: SceneDocument['scatterGroups'][string]['exclusions']): CompositionCommand[] =>
    exclusions.map(({ id, boundaryMm, reason }) => ({ type: 'upsertScatterExclusion', groupId,
      exclusion: { id, boundaryMm, reason: reason === 'manual' ? 'manual' : 'entrance' } }))
  const visibility = createPublicVisibility(scene)
  const areaIds = new Set(input.operations.filter(row => row.kind === 'terrain').map(row => row.id))
  const roomIds = new Set(input.operations.filter(row => row.kind === 'room').map(row => row.id))
  const material = (requested: string | undefined, kind: 'terrain' | 'room' | 'path') => {
    if (!requested) return {}
    const row = own(scene.materials, own(shoreMaterials, requested as keyof typeof shoreMaterials) ?? requested)
    if (!row || !row.applicableSurfaces.includes(kind)) throw new Error(`未找到适用于 ${kind} 的固定材质「${requested}」。`)
    return { materialRef: { id: row.id, version: row.version } }
  }
  const requireTarget = <T extends { id: string; floorId: string }>(row: T | undefined, isPublic: boolean, id: string): T => {
    if (!row || row.floorId !== floor.id || !isPublic) throw new OperationRejected('outside_scope', `「${id}」不在本次指定楼层的公开编辑范围。`)
    return row
  }
  type PlanSupport = Extract<MapOperation, { kind: 'path' }>['supports']
  const floorSupport = { kind: 'floor', id: floor.id } as const
  const support = (ref: NonNullable<PlanSupport>[number] | undefined): SurfaceRef => {
    if (!ref) return floorSupport
    if (ref.kind === 'terrainArea' && !areaIds.has(ref.id)) requireTarget(own(scene.terrainAreas, ref.id), visibility.terrainArea(ref.id), ref.id)
    if (ref.kind === 'room' && !roomIds.has(ref.id)) requireTarget(own(scene.rooms, ref.id), visibility.room(ref.id), ref.id)
    return ref
  }
  const connectionEnd = ({ at, support: ref }: Extract<MapOperation, { kind: 'connection' }>['from']) => ({ surfaceRef: support(ref), positionMm: point(at) })
  const wallAt = (id: string) => requireTarget(own(scene.walls, id), visibility.wall(id), id)
  const preparedRings = new Map(splitNewTerrainJunctions(input.operations.flatMap((row, index) => {
    if (row.kind !== 'terrain') return []
    try { return [{ id: row.id, points: row.boundary.map(point) }] }
    catch (error) { throw new Error(`operations[${index}]「${row.id}」：${error instanceof Error ? error.message : String(error)}`) }
  })).map(row => [row.id, row.points]))
  return input.operations.flatMap((row, index): CompositionCommand | CompositionCommand[] => {
    try {
      const layer = 'layerId' in row && row.layerId !== undefined ? { layerId: row.layerId } : {}
      const placed = { id: row.id, floorId: floor.id, ...layer }
      switch (row.kind) {
        case 'terrain':
          return { type: 'createTerrainArea', ...placed, boundaryMm: preparedRings.get(row.id)!, groundElevationMm: row.elevationMm,
            coveragePriority: row.priority, blocksMovement: row.blocksMovement, ...material(row.material, 'terrain') }
        case 'room': {
          const host = support(row.support)
          if (host.kind === 'room') throw new Error('房间需要地面或地形支撑。')
          return { type: 'createRoom', ...placed, boundaryMm: row.boundary.map(point), purpose: row.purpose,
            thicknessMm: row.thicknessMm, supportRef: { kind: host.kind, id: host.id }, ...material(row.material, 'room') }
        }
        case 'path':
          return { type: 'createPath', ...placed, centerlineMm: row.points.map(point), widthMm: row.widthMm,
            supportRefs: row.supports?.map(support) ?? [floorSupport], ...material(row.material, 'path') }
        case 'connection':
          return { type: 'createTerrainConnection', ...placed, kind: row.style, widthMm: row.widthMm,
            from: connectionEnd(row.from), to: connectionEnd(row.to) }
        case 'prop': {
          const definition = own(scene.propDefinitions, row.definitionId)
          if (!definition) throw new Error(`工程中没有固定物件定义「${row.definitionId}」。`)
          return { type: 'addProp', ...placed, definitionRef: { id: definition.id, version: definition.version },
            positionMm: point(row.at), supportRef: support(row.support), rotationDeg: row.rotationDeg }
        }
        case 'opening': {
          const wall = wallAt(row.wallId)
          return { type: 'addOpening', id: row.id, wallId: wall.id, offsetReferenceVertexId: row.fromVertexId,
            offsetMm: row.offsetMm, widthMm: row.widthMm, kind: row.style, ...(row.style === 'door' ? { state: 'open' as const } : {}) }
        }
        case 'terrain-update': {
          const area = requireTarget(own(scene.terrainAreas, row.id), visibility.terrainArea(row.id), row.id)
          const boundaryMm = row.boundary && reconcileTerrainBoundary(area.boundaryMm, row.boundary.map(point), runtime)
          const command: CompositionCommand = { type: 'updateTerrainArea', id: row.id, changes: {
            ...(boundaryMm ? { boundaryMm } : {}),
            ...(row.elevationMm !== undefined ? { groundElevationMm: row.elevationMm } : {}),
          } }
          return boundaryMm ? [command, ...terrainBoundaryChanges(scene, floor, area, boundaryMm)] : command
        }
        case 'terrain-shape': {
          const area = requireTarget(own(scene.terrainAreas, row.id), visibility.terrainArea(row.id), row.id)
          const result = createReliefBrush(scene, floor.id, area.id).plan({ points: [point(row.at)], radiusMm: row.radiusMm, amountMm: row.deltaMm }, true)
          if (result.length !== 1 || result[0].area.id !== area.id) throw new OperationRejected('outside_scope', '此次塑形会影响相邻地形，请缩小半径。')
          return { type: 'updateTerrainArea', id: area.id, changes: { relief: result[0].relief } }
        }
        case 'scenery-density': {
          const group = requireTarget(own(scene.scatterGroups, row.id), visibility.scatterGroup(row.id), row.id)
          const domain = group.domain, area = domain.kind === 'area' && own(scene.terrainAreas, domain.areaId)
          const exclusions = area && domain.kind === 'area' ? landscapeSceneryExclusions(group.id, domain.boundaryMm ?? terrainPoints(area), clearances) : []
          return [...exclusionCommands(group.id, exclusions), { type: 'regenerateScatter', id: row.id, densityFactor: row.density }]
        }
        case 'scenery-zone': {
          const area = requireTarget(own(scene.terrainAreas, row.areaId), visibility.terrainArea(row.areaId), row.areaId)
          if (area.blocksMovement || area.waterSurface) throw new Error('请为布景区选择可承托物件的陆地。')
          const { config, exclusions, fieldEvaluations } = landscapeSceneryZone(scene, floor, area, row, frame, 'local-scenery')
          meter.charge({ fieldEvaluations })
          return [{ type: 'createScatter', ...placed, ...config }, ...exclusionCommands(row.id,
            [...exclusions, ...landscapeSceneryExclusions(row.id, config.domain.boundaryMm, clearances)]), { type: 'regenerateScatter', id: row.id }]
        }
        case 'cover-zone': {
          const area = requireTarget(own(scene.terrainAreas, row.areaId), visibility.terrainArea(row.areaId), row.areaId)
          const style = plannedCovers.get(area.id) ?? area.surfaceStyle
          if (!style || area.waterSurface) throw new Error('请为地表覆盖选择已有材质的陆地。')
          const overlay = landscapeCover(scene, floor, { ...area, surfaceStyle: style }, row, frame)
          const overlays = style.overlays.some(item => item.id === overlay.id)
            ? style.overlays.map(item => item.id === overlay.id ? overlay : item)
            : [...style.overlays, overlay]
          const surfaceStyle = { ...style, overlays }
          plannedCovers.set(area.id, surfaceStyle)
          return { type: 'updateTerrainArea', id: area.id, changes: { surfaceStyle } }
        }
        case 'art-style': {
          const style = scene.artStyle?.version === 1 ? upgradeSceneArtStyle(scene.artStyle) : scene.artStyle ?? newMapArtStyle()
          return { type: 'setSceneArtStyle', style: { ...style, active: row.style } }
        }
        case 'path-update': {
          const path = requireTarget(own(scene.paths, row.id), visibility.path(row.id), row.id)
          if (row.around) {
            const landmark = own(scene.regions, row.around.landmarkId)
            return planMapPathAround(scene, floor, path, requireTarget(landmark, landmark?.visibility === 'public', row.around.landmarkId),
              { ...row.around, widthMm: row.widthMm, points: row.points?.map(point) }, meter)
          }
          if (path.roadSurface && path.automaticRoute?.algorithm === AUTOMATIC_ROAD_VERSION) {
            const previous = path.automaticRoute, points = row.points?.map(point) ?? previous.fixedPointsMm
            if (points.length > AUTOMATIC_ROAD_MAX_FIXED_POINTS) throw new Error(`贴地道路请提交最多 ${AUTOMATIC_ROAD_MAX_FIXED_POINTS} 个途经点，程序会重算道路断面。`)
            const widthMm = row.widthMm ?? path.widthMm, previousLandings = previous.landings ?? []
            const landings = previousLandings.map(landing => {
              const oldIndex = previous.fixedPointsMm.findIndex(p => p.x === landing.pointMm.x && p.y === landing.pointMm.y)
              const at = points.length === previous.fixedPointsMm.length ? points[oldIndex]
                : points.find(p => p.x === landing.pointMm.x && p.y === landing.pointMm.y)
              if (!at) throw new Error('请保留现有歇脚平台对应的途经点。')
              return { ...landing, pointMm: at }
            })
            const planner = createAutomaticRoadPlanner(scene, { ...path, widthMm }, path.id)
            const plan = planner(points, { ...path, ...previous }, { landings, widthChanged: widthMm !== path.widthMm })
            return { type: 'updatePath', id: row.id, changes: { widthMm, centerlineMm: plan.centerlineMm, supportRefs: plan.supportRefs,
              roadSurface: plan.roadSurface!, automaticRoute: { ...previous, fixedPointsMm: points, ...(previous.landings ? { landings } : {}) } } }
          }
          return { type: 'updatePath', id: row.id, changes: {
            ...(row.points ? { centerlineMm: row.points.map(point) } : {}),
            ...(row.widthMm !== undefined ? { widthMm: row.widthMm } : {}),
          } }
        }
        case 'prop-move': {
          const prop = own(scene.props, row.id)
          requireTarget(prop, !!prop && visibility.prop(prop), row.id)
          return { type: 'updateProp', id: row.id, changes: {
            positionMm: point(row.at), ...(row.rotationDeg !== undefined ? { rotationDeg: row.rotationDeg } : {}),
          } }
        }
        case 'room-purpose':
          requireTarget(own(scene.rooms, row.id), visibility.room(row.id), row.id)
          return { type: 'updateRoom', id: row.id, changes: { purpose: row.purpose } }
        case 'room-move':
          requireTarget(own(scene.rooms, row.id), visibility.room(row.id), row.id)
          for (const opening of row.openingsToMove) requireTarget(own(scene.openings, opening), visibility.opening(opening), opening)
          return { type: 'moveRoom', id: row.id, offsetMm: row.offsetMm, splitId: runtime.ids.nextId(), openingsToMove: row.openingsToMove }
        case 'vertex-move':
          requireTarget(own(scene.vertices, row.id), Object.values(scene.walls).some(wall =>
            (wall.startVertexId === row.id || wall.endVertexId === row.id) && visibility.wall(wall.id)), row.id)
          return { type: 'moveVertex', id: row.id, positionMm: point(row.at) }
        case 'opening-move':
          requireTarget(own(scene.openings, row.id), visibility.opening(row.id), row.id)
          return { type: 'updateOpening', id: row.id, changes: { wallId: wallAt(row.wallId).id,
            offsetReferenceVertexId: row.fromVertexId, offsetMm: row.offsetMm, ...(row.widthMm !== undefined ? { widthMm: row.widthMm } : {}) } }
        case 'connection-update':
          requireTarget(own(scene.terrainConnections, row.id), visibility.terrainConnection(row.id), row.id)
          return { type: 'updateTerrainConnection', id: row.id, changes: {
            ...(row.from ? { from: connectionEnd(row.from) } : {}), ...(row.to ? { to: connectionEnd(row.to) } : {}),
            ...(row.widthMm !== undefined ? { widthMm: row.widthMm } : {}),
          } }
      }
    } catch (error) {
      const message = `operations[${index}]「${row.id}」：${error instanceof Error ? error.message : String(error)}`
      if (error instanceof OperationRejected) throw new OperationRejected(error.code, message)
      throw new Error(message)
    }
  })
}

export function planMapPathAround(scene: SceneDocument, floor: Floor, path: SceneDocument['paths'][string],
  landmark: SceneDocument['regions'][string], request: NonNullable<Extract<MapOperation, { kind: 'path-update' }>['around']>
    & { points?: PointMm[]; widthMm?: number }, meter: ExecutionBudget, audience: 'gm' | 'player' = 'player'):
    Extract<CompositionCommand, { type: 'updatePath' | 'rerouteTerrainPath' }> {
  const previous = path.automaticRoute
  if (!path.roadSurface || previous?.algorithm !== AUTOMATIC_ROAD_VERSION) throw new Error('方向绕行用于已保存的自动道路。')
  if (previous.landings?.length) throw new Error('道路有手工固定平台，请调整现有途经点，以保留平台。')
  const { side, radiusMm } = request
  const box = reliefBounds(landmark.boundaryMm)
  const center = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
  const points = request.points ?? previous.fixedPointsMm
  const widthMm = request.widthMm ?? path.widthMm
  const view = audience === 'gm' ? scene : publicTerrainView(scene), ground = createRoadGround(view, floor.id, path.id)
  const support = ground.sample(center)?.rootSupportRef
  if (!support || !path.supportRefs.some(ref => ref.kind === support.kind && ref.id === support.id)) throw new Error('地标须落在道路同一承托地面。')
  const radius = radiusMm ?? Math.max(widthMm * 2.2, Math.min(box.width, box.height) * 1.75)
  const courses = landmarkRoutes(points[0], points.at(-1)!, center, side, radius, widthMm, band => !!ground.supports(band), radiusMm === undefined)
  const stairs = path.roadSurface.stations.some(station => !!station.outZMm)
  const area = support.kind === 'terrainArea' && own(scene.terrainAreas, support.id)
  const canGrade = area && !area.editLocked && !scene.userLayers[scene.entityLayers[area.id]]?.editLocked && area.relief && !area.rockBody
    && previous.alignment === 'anchors-v1' && path.supportRefs.length === 1
  const planOn = (groundScene: SceneDocument, anchors: PointMm[]) => {
    try {
      const planner = createAutomaticRoadPlanner(groundScene, { ...path, widthMm }, path.id)
      const plan = planner(anchors, { ...path, ...previous }, { widthChanged: widthMm !== path.widthMm, anchorOnly: true })
      const changes = { widthMm, centerlineMm: plan.centerlineMm, supportRefs: plan.supportRefs,
        roadSurface: plan.roadSurface!, automaticRoute: { ...previous, alignment: 'anchors-v1' as const, fixedPointsMm: anchors } }
      const rerouted = { ...path, ...changes }
      const publicGround = audience === 'gm' ? groundScene : groundScene === scene ? view : publicTerrainView(groundScene)
      const tested = checkGradedRoadOnValidScene({ ...publicGround, paths: { ...publicGround.paths, [path.id]: rerouted } }, rerouted)
      if (tested.ok && (!stairs || tested.treadCount > 0)) return { type: 'updatePath' as const, id: path.id, changes }
    } catch (error) {
      if (error instanceof OperationRejected) throw error
    }
  }
  for (const anchors of courses) {
    const command = planOn(scene, anchors)
    if (command) return command
  }
  if (canGrade) for (const anchors of courses.slice(0, 3)) {
    const relief = gradeLandscapeRouteRelief(area, { id: path.id, areaId: area.id, style: stairs ? 'stairs' : 'trail', widthMm,
      via: landscapeRouteAnchors(anchors, stairs ? 'stairs' : 'trail', widthMm) }, meter)
    const terrainAreas = { ...scene.terrainAreas, [area.id]: { ...area, relief } }
    const command = planOn({ ...scene, terrainAreas }, anchors)
    if (command) return { type: 'rerouteTerrainPath', id: path.id, areaId: area.id, relief, changes: command.changes }
  }
  throw new Error('指定一侧未找到满足净宽、坡度及现有物件避让的路线。可调整起终点、净宽或绕行半径。')
}

/** Check derived changes as well as explicit targets. Commands own topology,
 * history identity, lock checks and materialization. */
function mapChanges(before: SceneDocument, after: SceneDocument, floorId: string) {
  const oldPublic = createPublicVisibility(before), nextPublic = createPublicVisibility(after)
  const oldView = publicTerrainView(before, oldPublic), nextView = publicTerrainView(after, nextPublic)
  const collections = [...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS] as const
  type Row = { id: string; floorId: string; visibility?: string }
  const visible = (collection: typeof collections[number], row: Row, view: SceneDocument, rules: typeof oldPublic) => {
    if (collection === 'notes') return false
    if (collection === 'scatterGroups') return rules.scatterGroup(row.id)
    return Object.hasOwn(view[collection] ?? {}, row.id) && row.visibility !== 'gm'
  }
  const change = (a: Row | undefined, b: Row | undefined, allowed: boolean) => {
    if (!allowed || a && a.floorId !== floorId || b && b.floorId !== floorId) {
      throw new OperationRejected('outside_scope', '此操作会改变指定楼层之外或私密的依赖。请选择更局部的修改。')
    }
  }
  const changes: Array<{ id: string; kind: string; status: 'added' | 'updated' | 'removed' }> = []
  if (!same(before.artStyle, after.artStyle)) changes.push({ id: 'scene', kind: 'artStyle', status: 'updated' })
  for (const collection of collections) {
    const previous: Record<string, Row> = before[collection] ?? {}, next: Record<string, Row> = after[collection] ?? {}
    for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      const a = own(previous, id), b = own(next, id)
      if (same(a, b) && before.entityLayers[id] === after.entityLayers[id]) continue
      change(a, b, (!a || visible(collection, a, oldView, oldPublic)) && (!b || visible(collection, b, nextView, nextPublic)))
      if (collection !== 'vertices') changes.push({ id, kind: collection, status: !a ? 'added' : b ? 'updated' : 'removed' })
    }
  }
  const beforeVisual = visualBase(before), afterVisual = visualBase(after)
  for (const field of ['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const) {
    const previous: Record<string, Row> = beforeVisual?.[field] ?? {}, next: Record<string, Row> = afterVisual?.[field] ?? {}
    for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      const a = own(previous, id), b = own(next, id)
      if (!same(a, b)) change(a, b, a?.visibility !== 'gm' && b?.visibility !== 'gm')
    }
  }
  return changes
}

function scopedGeometryError(scene: SceneDocument, floor: Floor, error: unknown) {
  if (!(error instanceof Error) || error instanceof OperationRejected && error.code === 'operation_budget') return error
  const visibility = createPublicVisibility(scene)
  const hasPrivate = Object.values(scene.terrainAreas).some(row => row.floorId === floor.id && !visibility.terrainArea(row.id))
    || Object.values(scene.rooms).some(row => row.floorId === floor.id && !visibility.room(row.id))
    || Object.values(scene.walls).some(row => row.floorId === floor.id && !visibility.wall(row.id))
    || Object.values(scene.paths).some(row => row.floorId === floor.id && !visibility.path(row.id))
    || Object.values(scene.terrainConnections).some(row => row.floorId === floor.id && !visibility.terrainConnection(row.id))
    || Object.values(scene.props).some(row => row.floorId === floor.id && !visibility.prop(row))
    || Object.values(scene.openings).some(row => scene.walls[row.wallId]?.floorId === floor.id && !visibility.opening(row.id))
    || Object.values(scene.terrainEdges).some(row => row.floorId === floor.id && !visibility.terrainEdge(row.id))
    || Object.values(scene.notes).some(row => row.floorId === floor.id && row.visibility !== 'public')
    || Object.values(scene.regions).some(row => row.floorId === floor.id && row.visibility !== 'public')
  if (hasPrivate) return new OperationRejected(error instanceof OperationRejected ? error.code : 'invalid_geometry',
    '该编辑与现有场景约束冲突。请缩小范围或在普通编辑器核对。')
  return error
}

function terrainBoundaryChanges(scene: SceneDocument, floor: Floor, area: SceneDocument['terrainAreas'][string],
  boundaryMm: SceneDocument['terrainAreas'][string]['boundaryMm']): CompositionCommand[] {
  const draft = { ...scene, terrainAreas: { ...scene.terrainAreas, [area.id]: { ...area, boundaryMm } } }
  const related = Object.values(scene.terrainEdges).filter(edge => edge.source.areaId === area.id || edge.neighborAreaId === area.id)
  const visibility = createPublicVisibility(scene), edges: CompositionCommand[] = []
  for (const edge of related) {
    if (edge.floorId !== floor.id || !visibility.terrainEdge(edge.id)) {
      throw new OperationRejected('outside_scope', '轮廓涉及未授权边缘。请在普通编辑器调整。')
    }
    const old = edge.source.areaId === area.id ? area.boundaryMm.find(point => point.segmentId === edge.source.segmentId) : undefined
    if (old && boundaryMm.some(point => point.segmentId === old.segmentId) && edge.neighborAreaId === LANDSCAPE_WATER_ID) continue
    const replacement = old && (boundaryMm.find(point => point.segmentId === old.segmentId) ?? boundaryMm.find(point => point.id === old.id))
    const source = replacement ? { areaId: area.id, segmentId: replacement.segmentId } : edge.source
    if (source.areaId === area.id && !boundaryMm.some(point => point.segmentId === source.segmentId)) {
      throw new Error(`轮廓修改移除了岸边「${edge.id}」的来源点，请保留该点或在编辑器重新绑定。`)
    }
    const relation = findExposedTerrainEdge(draft, source)
    if (!relation) throw new Error(`轮廓修改使岸边「${edge.id}」失去外露支撑，请检查交接位置。`)
    const { source: attached, neighborAreaId, requiresCliff } = relation
    if (same(attached, edge.source) && neighborAreaId === edge.neighborAreaId && (!requiresCliff || edge.kind === 'cliff' && edge.blocksMovement)) continue
    edges.push({ type: 'updateTerrainEdge', id: edge.id, changes: { source: attached, neighborAreaId,
      kind: requiresCliff ? 'cliff' : edge.kind, blocksMovement: requiresCliff || edge.blocksMovement } })
  }
  return edges
}

export async function prepareMapOperations(base: EditableProject, floor: Floor,
  input: Pick<MapGenerateRequest, 'operations' | 'referenceSizePx' | 'checks'>, options: PrepareOptions & { budget: TaskBudgetProfile }, preserveAspect = false) {
  const started = performance.now()
  const pairs = captureGeometryPairBudget(options.budget), meter = captureExecutionBudget(options.budget)
  let commands
  try { commands = withGeometryPairCounter(pairs.add, () => compileMapOperations(base.document, floor, input, options.runtime, preserveAspect, meter)) }
  catch (error) { throw scopedGeometryError(base.document, floor, error) }
  const project = await prepareCompositionCommands(base, commands, {
    ...options, terrainPairAccounting: 'map-spatial-v2', onGeometryPairs: pairs.add, onOperationCost: () => {},
  }).catch(error => {
    if (error instanceof OperationRejected && error.code === 'operation_budget') {
      const targets = [...new Set(input.operations.map(row => row.id))]
      const scope = targets.slice(0, 4).map(id => `「${id}」`).join('、')
      throw new OperationRejected(error.code, `${error.message} 本次编辑对象 ${scope}${targets.length > 4 ? ` 等 ${targets.length} 项` : ''}。`)
    }
    throw scopedGeometryError(base.document, floor, error)
  })
  const changes = mapChanges(base.document, project.document, floor.id)
  const usage = assertTaskBudget(options.budget, measureTaskBudget(base.document, project.document, { before: base, after: project },
    { ...meter.snapshot(), activeExecutionMs: Math.ceil(performance.now() - started), intersectionPairs: pairs.count() }, 'map-spatial-v2'))
  const geometryWork = { model: 'map-spatial-v2', previousEstimate: measureDocumentBudget(base.document, project.document).intersectionPairs,
    checkedPairs: pairs.count(), billedPairs: usage.intersectionPairs }
  return { project, changes, usage, geometryWork }
}

export function checkMapRoutes(scene: SceneDocument, floor: Floor, input: Pick<MapGenerateRequest, 'checks' | 'referenceSizePx'>, preserveAspect = false,
  requiredRoadIds: readonly string[] = [], enforce = true, roadFailures: readonly LandscapeRoadFailure[] = []) {
  const point = mapCoordinate(floor.boundsMm, input.referenceSizePx, preserveAspect)
  const publicScene = publicTerrainView(scene)
  const roads = requiredRoadIds.map(id => {
    const path = own(publicScene.paths, id)
    const failure = roadFailures.find(row => row.id === id)
    if (!path && !enforce && failure) return { source: 'road' as const, ok: false, ...failure }
    if (!path || path.floorId !== floor.id) throw new OperationRejected('outside_scope', `路线「${id}」不在当前楼层的公开范围。`)
    const result = checkGradedRoadOnValidScene(publicScene, path)
    if (!result.ok && enforce) throw new OperationRejected('invalid_geometry', `道路「${id}」的已保存通行面未通过：${result.issues.map(issue => issue.message).join('；')}`)
    return { id, source: 'road' as const, ...result }
  })
  const authored = input.checks.map(check => {
    const { ok, lengthMm, issues, connectionIds } = checkRouteOnValidScene(publicScene, {
      floorId: floor.id, pointsMm: check.points.map(point), widthMm: check.widthMm,
    })
    if (!ok && check.required && enforce) {
      throw new OperationRejected('invalid_geometry', `通路「${check.id}」未达到 ${check.widthMm} mm 净宽：${issues.map(issue => issue.entityId ? `「${issue.entityId}」${issue.message}` : issue.message).join('；')}`)
    }
    return { id: check.id, widthMm: check.widthMm, required: check.required, ok, lengthMm, issues, connectionIds }
  })
  return [...roads, ...authored]
}

export function checkMapHeights(scene: SceneDocument, floor: Floor,
  input: Pick<MapGenerateRequest, 'heightChecks' | 'referenceSizePx'>, preserveAspect = false, enforce = true) {
  if (!input.heightChecks.length) return []
  const point = mapCoordinate(floor.boundsMm, input.referenceSizePx, preserveAspect)
  const ground = createSupportQuery(publicTerrainView(scene), floor.id, undefined, false)
  const height = (at: PointMm) => {
    const sample = ground.sourceSample(at)
    return sample?.rootSupportRef.kind === 'terrainArea' ? Math.round(sample.zMm) : null
  }
  return input.heightChecks.map(check => {
    const lowMm = point(check.low), highMm = point(check.high)
    const lowElevationMm = height(lowMm), highElevationMm = height(highMm)
    const riseMm = lowElevationMm !== null && highElevationMm !== null ? highElevationMm - lowElevationMm : null
    const ok = riseMm !== null && riseMm >= check.minRiseMm
    if (!ok && enforce && check.required) throw new OperationRejected('invalid_geometry',
      `高差「${check.id}」需要至少 ${check.minRiseMm} mm，实际 ${riseMm === null ? '缺少地形' : `${riseMm} mm`}。请核对地标与低地是否相互覆盖。`)
    return { id: check.id, required: check.required, ok, lowMm, highMm, lowElevationMm, highElevationMm, riseMm, minRiseMm: check.minRiseMm }
  })
}

export function mapSceneSummary(scene: SceneDocument, floor: Floor, query = '', limit = 24, offset = 0) {
  const visibility = createPublicVisibility(scene), view = publicTerrainView(scene, visibility)
  const onFloor = <T extends { floorId: string }>(source: Record<string, T>) => Object.values(source).filter(row => row.floorId === floor.id)
  const rooms = onFloor(view.rooms), areas = onFloor(view.terrainAreas), paths = onFloor(view.paths)
  const connections = onFloor(view.terrainConnections), props = onFloor(view.props), openings = onFloor(view.openings), walls = onFloor(view.walls)
  const regions = onFloor(view.regions)
  const ground = regions.length ? createSupportQuery(view, floor.id, undefined, false) : undefined
  const entities = [
    ...rooms.map(row => ({ kind: 'room', id: row.id, purpose: row.purpose, boundary: roomPoints(view, row), support: row.supportRef, locked: row.editLocked })),
    ...areas.map(row => ({ kind: 'terrain', id: row.id, boundary: terrainPoints(row), elevationMm: row.groundElevationMm, locked: row.editLocked,
      ...(row.relief ? { relief: { minimumMm: row.groundElevationMm + Math.min(...row.relief.offsetsMm), maximumMm: row.groundElevationMm + Math.max(...row.relief.offsetsMm) } } : {}) })),
    ...paths.map(row => ({ kind: 'path', id: row.id, points: row.centerlineMm, widthMm: row.widthMm, locked: row.editLocked,
      ...(row.automaticRoute ? { anchors: row.automaticRoute.fixedPointsMm,
        landings: row.automaticRoute.algorithm === AUTOMATIC_ROAD_VERSION ? row.automaticRoute.landings ?? [] : [] } : {}),
      ...(row.roadSurface ? { treadCount: row.roadSurface.stations.filter(station => !!station.outZMm).length,
        lengthMm: Math.round(connectionArcFrame(row.centerlineMm).length) } : {}) })),
    ...connections.map(row => ({ kind: row.kind, id: row.id, from: row.from, to: row.to, widthMm: row.widthMm, locked: row.editLocked })),
    ...openings.map(row => ({ kind: row.kind, id: row.id, wallId: row.wallId, widthMm: row.widthMm, locked: row.editLocked })),
    ...walls.map(row => ({ kind: 'wall', id: row.id, a: row.startVertexId, b: row.endVertexId,
      points: [view.vertices[row.startVertexId], view.vertices[row.endVertexId]].map(vertex => ({ x: vertex.xMm, y: vertex.yMm })), locked: row.editLocked })),
    ...props.map(row => ({ kind: 'prop', id: row.id, definitionId: row.definitionRef?.id ?? null, at: row.positionMm, locked: row.editLocked })),
    ...regions.map(row => {
      const points = row.boundaryMm, at = { x: Math.round(points.reduce((sum, p) => sum + p.x, 0) / points.length),
        y: Math.round(points.reduce((sum, p) => sum + p.y, 0) / points.length) }
      const sample = ground?.sourceSample(at)
      return { kind: 'region', id: row.id, name: row.name, boundary: points, at, locked: row.editLocked,
        ...(sample ? { support: sample.rootSupportRef, elevationMm: Math.round(sample.zMm) } : {}) }
    }),
    ...onFloor(view.scatterGroups).filter(row => visibility.scatterGroup(row.id)
      && LANDSCAPE_SCATTER_ALGORITHM_VERSIONS.some(version => row.algorithmVersion === version))
      .map(row => ({ kind: 'scenery', id: row.id, domain: row.domain, density: row.densityFactor, locked: row.editLocked,
        members: Object.values(row.members).filter(member => member.propId && own(view.props, member.propId)).length })),
  ].filter(row => `${row.kind} ${row.id} ${'purpose' in row ? row.purpose : ''} ${'name' in row ? row.name ?? '' : ''}`.toLowerCase().includes(query.toLowerCase()))
  return {
    floorId: floor.id, boundsMm: floor.boundsMm,
    layers: onFloor(scene.userLayers).map(({ id, name, editLocked }) => ({ id, name, locked: editLocked })),
    counts: { rooms: rooms.length, terrainAreas: areas.length, paths: paths.length, connections: connections.length,
      props: props.length, openings: openings.length, walls: walls.length },
    objects: entities.slice(offset, offset + limit), totalObjects: entities.length,
    nextOffset: offset + limit < entities.length ? offset + limit : null,
    hasTerrainHeightDifferences: areas.some(row => row.groundElevationMm !== 0 || row.relief?.offsetsMm.some(value => value !== 0)) || connections.length > 0,
  }
}
