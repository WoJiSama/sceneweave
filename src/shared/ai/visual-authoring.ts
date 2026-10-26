import type { ProjectData } from '../model/project.js'
import type { BoundsMm, PointMm, SceneDocument } from '../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS } from '../model/scene.js'
import { geometryIdentityIds } from '../commands/domain.js'
import type { PreparationContext } from '../ports/runtime.js'
import { cloneJson, captureJson } from '../validation/json.js'
import { validateProjectData } from '../project/validate.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { applyVisualCommand, type VisualCommand } from '../visual/commands.js'
import { sampleVisualBoundary, signedVisualArea, visualSampleAtDistance } from '../visual/geometry.js'
import { VISUAL_ENTITY_COLLECTIONS } from '../visual/diagnostics.js'
import type { VisualEntity, VisualBoundary } from '../visual/types.js'
import { corridor, openingEndpoints, pointInPolygon, polygonsOverlap, propFootprint, validateGeometry } from '../geometry/geometry.js'
import { sha256Text } from '../validation/hash.js'
import type { SceneAuthoringScope } from './authoring-protocol.js'
import { TerrainBoundaryProposalSchema, VisualAuthoringScopeSchema, VisualAuthoringOperationSchema, type TerrainBoundaryProposal, type VisualAuthoringScope, type VisualAuthoringOperation } from './visual-protocol.js'
import { assertPublicSceneEntity, applySceneOperation, sceneReadIds, publicSceneContext } from './scene-authoring.js'

const sorted = (values: Iterable<string>) => [...new Set(values)].sort()
const connectionIssueCodes = ['CONNECTION_ENDPOINT', 'CONNECTION_CORRIDOR', 'CONNECTION_TRANSITIONS'] as const
type ConnectionIssue = { code: typeof connectionIssueCodes[number]; entityId: string }
/** Only independently reproducible issues from the frozen public geometry. */
export class VisualBoundaryConnectionError extends Error {
  constructor(readonly issues: readonly ConnectionIssue[]) {
    super('曲线候选改变了已授权连接的有效支撑；请缩小曲线外扩并重新预演。')
    this.name = 'VisualBoundaryConnectionError'
  }
}
function deny(message: string): never { throw new Error(`AI视觉草稿范围无效：${message}`) }
function inside(bounds: BoundsMm, points: PointMm[], padding = 0) {
  return points.length > 0 && points.every(point => point.x - padding >= bounds.x && point.y - padding >= bounds.y
    && point.x + padding <= bounds.x + bounds.width && point.y + padding <= bounds.y + bounds.height)
}
function rectangle(bounds: BoundsMm): PointMm[] {
  return [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]
}
function visualEntity(project: ProjectData, id: string): VisualEntity | undefined {
  return VISUAL_ENTITY_COLLECTIONS.flatMap(key => Object.hasOwn(project.document.visual?.[key] ?? {}, id) ? [project.document.visual![key][id]] : [])[0]
}
function shapes(project: ProjectData, id: string): { points: PointMm[]; padding: number } | null {
  const visual = project.document.visual
  if (!visual) return null
  if (visual.boundaries[id]) return { points: sampleVisualBoundary(visual.boundaries[id]).points, padding: 0 }
  const edge = visual.edgeLooks[id]
  if (edge) return { points: sampleVisualBoundary(visual.boundaries[edge.boundaryId]).points, padding: edge.widthMm * 2 }
  const light = visual.lights[id]
  if (light) return { points: [light.positionMm], padding: light.radiusMm }
  const fog = visual.fogs[id]
  if (fog) return { points: fog.boundaryMm, padding: 0 }
  const filter = visual.filters[id]
  if (filter?.target.kind === 'region') return { points: filter.target.boundaryMm, padding: 0 }
  return null
}
function assertVisual(project: ProjectData, scope: VisualAuthoringScope, id: string): string[] {
  const value = visualEntity(project, id), shape = shapes(project, id), scene = project.document
  if (!value || value.visibility !== 'public' || value.floorId !== scope.floorId || value.editLocked || scene.userLayers[value.layerId]?.editLocked) deny('视觉对象私密、跨Floor或已锁定。')
  if (shape && !inside(scope.boundsMm, shape.points, shape.padding)) deny('视觉实际外扩超出明确范围。')
  if (shape) for (const mask of Object.values(scene.regions).filter(value => value.kind === 'manualMask' && value.floorId === scope.floorId)) {
    const xs = shape.points.map(point => point.x), ys = shape.points.map(point => point.y), band = rectangle({ x: Math.min(...xs) - shape.padding, y: Math.min(...ys) - shape.padding,
      width: Math.max(1, Math.max(...xs) - Math.min(...xs) + shape.padding * 2), height: Math.max(1, Math.max(...ys) - Math.min(...ys) + shape.padding * 2) })
    if (polygonsOverlap(band, mask.boundaryMm) || band.some(point => pointInPolygon(point, mask.boundaryMm)) || mask.boundaryMm.some(point => pointInPolygon(point, band))) deny('视觉范围包含玩家遮罩。')
  }
  return [id, value.floorId, value.layerId]
}
function visualReferences(project: ProjectData, id: string): string[] {
  const visual = project.document.visual
  const boundary = visual?.boundaries[id], edge = visual?.edgeLooks[id], filter = visual?.filters[id]
  return boundary?.binding.kind === 'terrain' ? boundary.binding.sides.map(side => side.areaId) : boundary?.binding.kind === 'path' ? [boundary.binding.pathId]
    : edge ? [edge.boundaryId] : filter?.target.kind === 'entities' ? filter.target.ids : []
}
export function validateVisualAuthoringScope(project: ProjectData, input: VisualAuthoringScope): VisualAuthoringScope {
  const scope = VisualAuthoringScopeSchema.parse(captureJson(input)), scene = project.document
  if (project.schemaVersion !== 2 || scene.schemaVersion !== 2 || !scene.visual) deny('视觉创作须先明确保存v2独立副本。')
  const floor = scene.floors[scope.floorId], layer = scene.userLayers[scope.layerId]
  if (!floor || !layer || layer.floorId !== floor.id || layer.editLocked || !inside(floor.boundsMm, rectangle(scope.boundsMm))) deny('视觉Floor、图层或范围无效/锁定。')
  for (const id of scope.entityIds) {
    if (visualEntity(project, id)) {
      assertVisual(project, scope, id)
      if (visualReferences(project, id).some(id => !scope.entityIds.includes(id))) deny('现存视觉引用须一起明确授权。')
      const target = scene.visual?.filters[id]?.target
      if (target?.kind === 'layer') deny('AI不采用持续图层滤镜，请明确选择冻结实体。')
      if (target?.kind === 'scene' && !scope.allowGlobalEnvironment) deny('现存全图滤镜须单独授权全图。')
    }
    else assertPublicSceneEntity(project, scope, id)
  }
  for (const id of scope.definitionIds) if (!scene.propDefinitions[id]?.origin.canEmbed || scene.propDefinitions[id].tags.includes('sceneweave:retained-appearance')) deny('视觉布景固定素材未获授权。')
  for (const id of scope.materialIds) if (!scene.materials[id]?.origin.canEmbed) deny('视觉固定材质未获授权。')
  if (scope.allowGlobalEnvironment && (scope.boundsMm.x !== floor.boundsMm.x || scope.boundsMm.y !== floor.boundsMm.y || scope.boundsMm.width !== floor.boundsMm.width || scope.boundsMm.height !== floor.boundsMm.height)) deny('全图环境须明确授权整个Floor范围。')
  return scope
}

/**
 * Suggest explicit controls from a small, already authorised persisted ring.
 * This never smooths or changes stored data. The caller must separately replay
 * the returned normal visualBoundary operation against the full frozen ledger.
 */
export function proposeAuthoringTerrainBoundary(project: ProjectData, scope: VisualAuthoringScope, allowed: ReadonlySet<string>, input: TerrainBoundaryProposal) {
  const query = TerrainBoundaryProposalSchema.parse(captureJson(input)), scene = project.document
  if (!scope.operations.includes('visualBoundary') || !allowed.has(query.areaId)) deny('曲线建议须明确授权视觉边界及真实地形。')
  assertPublicSceneEntity(project, scope, query.areaId)
  const area = scene.terrainAreas[query.areaId]
  if (!area || area.boundaryMm.length < 3 || area.boundaryMm.length > 16) deny('曲线建议只接受3–16个真实锚点；已有密集采样环请读取并编辑原曲线。')
  const usedIds = geometryIdentityIds(scene)
  Object.keys(scene.userLayers).forEach(id => usedIds.add(id))
  if (usedIds.has(query.boundaryId)) deny('曲线建议须使用未占用的新曲线ID；已有曲线请读取真实控制点后明确修改。')
  usedIds.add(query.boundaryId)
  const segmentId = (index: number) => {
    for (let attempt = 0; attempt <= usedIds.size; attempt++) {
      const id = `curve-segment-${sha256Text(JSON.stringify([query.boundaryId, index, attempt]))}`
      if (!usedIds.has(id)) { usedIds.add(id); return id }
    }
    return deny('无法分配未占用的曲线控制段身份。')
  }
  const first = query.startPointId ? area.boundaryMm.findIndex(point => point.id === query.startPointId) : 0
  if (first < 0) deny('曲线建议起点须为真实现存地形锚点。')
  const ring = [...area.boundaryMm.slice(first), ...area.boundaryMm.slice(0, first)], smoothness = query.smoothness ?? 1
  const points = ring.map(point => point.positionMm)
  const control = (base: PointMm, next: PointMm, previous: PointMm, sign: number): PointMm => ({
    x: Math.round(base.x + sign * smoothness * (next.x - previous.x) / 6),
    y: Math.round(base.y + sign * smoothness * (next.y - previous.y) / 6),
  })
  const operation = VisualAuthoringOperationSchema.parse({ kind: 'visualBoundary', id: query.boundaryId, closed: true,
    segments: points.map((start, index) => {
      const previous = points[(index + points.length - 1) % points.length], end = points[(index + 1) % points.length], after = points[(index + 2) % points.length]
      return { id: segmentId(index), start: { ...start }, control1: control(start, end, previous, 1), control2: control(end, after, start, -1), end: { ...end } }
    }), sampleSpacingMm: query.sampleSpacingMm ?? 2500, toleranceMm: query.toleranceMm ?? 200,
    binding: { kind: 'terrain', sides: [{ areaId: area.id, startPointId: ring[0].id, endPointId: ring[0].id, reverse: false }] } }) as Extract<VisualAuthoringOperation, { kind: 'visualBoundary' }>
  const sampled = sampleVisualBoundary(operation)
  const concaveCorners = (values: PointMm[]) => {
    const orientation = Math.sign(signedVisualArea(values))
    return values.filter((point, index) => {
      const previous = values[(index + values.length - 1) % values.length], next = values[(index + 1) % values.length]
      return orientation * ((point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x)) < -1e-7
    }).length
  }
  return { candidateOperation: operation, sourceAnchorCount: ring.length, sampleCount: sampled.points.length,
    sourceAreaM2: Math.abs(signedVisualArea(points)) / 1_000_000, candidateAreaM2: Math.abs(signedVisualArea(sampled.points)) / 1_000_000,
    sourceConcaveCorners: concaveCorners(points), candidateConcaveCorners: concaveCorners(sampled.points),
    construction: 'periodic Catmull-Rom cubic controls from the explicit ring; stable start anchor and original ring order preserved',
    disposition: 'read-only proposal; no draft or project changed; only an explicit normal edit can adopt it' }
}
function boundaryConnectionIssues(project: ProjectData, candidate: SceneDocument, scope: VisualAuthoringScope, allowed: ReadonlySet<string>): ConnectionIssue[] {
  const before = project.document, nextProject = { ...project, document: candidate }
  const publicId = (id: string) => {
    if (!allowed.has(id)) return false
    try { assertPublicSceneEntity(project, scope, id); assertPublicSceneEntity(nextProject, scope, id); return true }
    catch { return false }
  }
  const areas = new Set(Object.keys(before.terrainAreas).filter(publicId))
  const connections = new Set(Object.values(before.terrainConnections).filter(connection => publicId(connection.id)
    && [connection.from, connection.to].every(end => end.surfaceRef.kind === 'floor' ? end.surfaceRef.id === scope.floorId : end.surfaceRef.kind === 'terrainArea' && areas.has(end.surfaceRef.id))).map(value => value.id))
  if (!connections.size) return []
  // A private or ungranted terrain cannot be the source of these details: the
  // same new issue must exist using only authorised, public, in-bounds terrain.
  // Room/door and obstruction failures retain the generic redacted error.
  const publicGeometry = (scene: SceneDocument): SceneDocument => ({ ...scene,
    terrainAreas: Object.fromEntries(Object.entries(scene.terrainAreas).filter(([id]) => areas.has(id))),
    terrainConnections: Object.fromEntries(Object.entries(scene.terrainConnections).filter(([id]) => connections.has(id))),
    rooms: {}, walls: {}, openings: {}, vertices: {}, props: {}, paths: {}, terrainEdges: {}, regions: {}, notes: {}, prefabInstances: {}, scatterGroups: {},
  })
  const key = (issue: { code: string; entityId?: string }) => JSON.stringify([issue.code, issue.entityId])
  const previous = new Set(validateGeometry(publicGeometry(before)).errors.map(key))
  const publicIssues = new Set(validateGeometry(publicGeometry(candidate)).errors.map(key))
  return validateGeometry(candidate).errors.filter((issue): issue is ConnectionIssue & { message: string } =>
    connectionIssueCodes.includes(issue.code as ConnectionIssue['code']) && !!issue.entityId && connections.has(issue.entityId)
    && publicIssues.has(key(issue)) && !previous.has(key(issue)))
    .map(({ code, entityId }) => ({ code, entityId })).slice(0, 16)
}
function commandFor(project: ProjectData, scope: VisualAuthoringScope, operation: VisualAuthoringOperation): VisualCommand {
  const previous = 'id' in operation ? visualEntity(project, operation.id) : undefined
  const { kind, ...fields } = operation, common = { floorId: scope.floorId, layerId: previous?.layerId ?? scope.layerId, visibility: 'public' as const, editLocked: false }
  switch (kind) {
    case 'visualBoundary': return { type: 'upsertVisualBoundary', boundary: { ...fields, ...common } as Extract<VisualCommand, { type: 'upsertVisualBoundary' }>['boundary'] }
    case 'visualEdge': { const { edgeKind, ...rest } = fields as Omit<Extract<VisualAuthoringOperation, { kind: 'visualEdge' }>, 'kind'>; return { type: 'upsertVisualEdgeLook', edgeLook: { ...rest, ...common, kind: edgeKind } } }
    case 'visualLight': return { type: 'upsertVisualLight', light: { ...fields, ...common } as Extract<VisualCommand, { type: 'upsertVisualLight' }>['light'] }
    case 'visualFog': return { type: 'upsertVisualFog', fog: { ...fields, ...common } as Extract<VisualCommand, { type: 'upsertVisualFog' }>['fog'] }
    case 'visualFilter': return { type: 'upsertVisualFilter', filter: { ...fields, ...common } as Extract<VisualCommand, { type: 'upsertVisualFilter' }>['filter'] }
    case 'visualEnvironment': return { type: 'setVisualEnvironment', environment: (operation as Extract<VisualAuthoringOperation, { kind: 'visualEnvironment' }>).environment }
    case 'visualRemove': { const remove = operation as Extract<VisualAuthoringOperation, { kind: 'visualRemove' }>; return remove.effectKind === 'boundary' ? { type: 'removeVisualBoundary', id: remove.id, detach: remove.detach ?? false } : { type: 'removeVisualEffect', id: remove.id, kind: remove.effectKind } }
    default: return deny('未知视觉命令。')
  }
}
export function visualAuthoringReadIds(project: ProjectData, scope: VisualAuthoringScope): string[] {
  const read = new Set(sceneReadIds(project, physicalScope(project, scope)))
  for (const id of scope.entityIds) for (const key of visualEntity(project, id) ? assertVisual(project, scope, id) : assertPublicSceneEntity(project, scope, id)) read.add(key)
  return sorted(read)
}
type Result = { project: ProjectData; readIds: string[]; writeIds: string[]; createdIds: string[]; cost: number }
function physicalScope(project: ProjectData, scope: VisualAuthoringScope): SceneAuthoringScope {
  return { floorId: scope.floorId, layerId: scope.layerId, boundsMm: scope.boundsMm, entityIds: scope.entityIds.filter(id => !visualEntity(project, id)),
    definitionIds: scope.definitionIds, materialIds: scope.materialIds, prefabDefinitionIds: [], operations: ['furnish'] }
}
export function applyVisualAuthoringOperation(project: ProjectData, scope: VisualAuthoringScope, input: VisualAuthoringOperation, context: PreparationContext, created: ReadonlySet<string>): Result {
  const operation = VisualAuthoringOperationSchema.parse(captureJson(input)), allowed = new Set([...scope.entityIds, ...created])
  if (!scope.operations.includes(operation.kind)) deny('视觉操作未获授权。')
  const required = (id: string) => { if (!allowed.has(id)) deny('视觉实体或真实依赖未明确授权。'); if (visualEntity(project, id)) assertVisual(project, scope, id); else assertPublicSceneEntity(project, scope, id) }
  if (operation.kind === 'furnishAlong') {
    required(operation.source.id)
    if (!scope.definitionIds.includes(operation.definitionId)) deny('沿边布景素材未获授权。')
    const wall = project.document.walls[operation.source.id]
    let boundary: Pick<VisualBoundary, 'closed' | 'segments' | 'sampleSpacingMm' | 'toleranceMm'>
    if (operation.source.kind === 'wall') {
      if (!wall) deny('沿墙布景须引用真实墙体。')
      const a = project.document.vertices[wall.startVertexId], b = project.document.vertices[wall.endVertexId], start = { x: a.xMm, y: a.yMm }, end = { x: b.xMm, y: b.yMm }
      boundary = { closed: false, segments: [{ id: 'furnish-line', start, end, control1: start, control2: end }], sampleSpacingMm: 20000, toleranceMm: 20 }
    } else { const value = project.document.visual!.boundaries[operation.source.id]; if (!value) deny('沿岸布景须引用视觉曲线。'); boundary = value }
    const sampled = sampleVisualBoundary(boundary)
    if (operation.startDistanceMm + (operation.count - 1) * operation.spacingMm > sampled.lengthMm) deny('沿边布景超过曲线长度。')
    let current = project; const read = new Set<string>(), write = new Set<string>(), fresh = new Set<string>(); let cost = 0
    for (let i = 0; i < operation.count; i++) {
      const sample = visualSampleAtDistance(sampled, operation.startDistanceMm + i * operation.spacingMm)
      const positionMm = { x: Math.round(sample.positionMm.x + sample.normal.x * operation.offsetMm), y: Math.round(sample.positionMm.y + sample.normal.y * operation.offsetMm) }
      const id = context.ids.nextId(), result = applySceneOperation(current, physicalScope(current, scope), { kind: 'furnish', id, definitionId: operation.definitionId, supportRef: operation.supportRef, positionMm,
        rotationDeg: ((Math.atan2(sample.tangent.y, sample.tangent.x) * 180 / Math.PI + (operation.rotationOffsetDeg ?? 0)) % 360 + 360) % 360 }, context, new Set([...allowed, ...fresh]))
      const prop = result.project.document.props[id], footprint = propFootprint(prop)
      if (prop.blocksMovement) {
        for (const other of Object.values(current.document.props).filter(value => value.floorId === scope.floorId && value.blocksMovement)) {
          read.add(other.id)
          if (polygonsOverlap(footprint, propFootprint(other))) deny('沿边布景与既有占地冲突，请减少数量或增大间距。')
        }
        for (const opening of Object.values(current.document.openings).filter(value => value.floorId === scope.floorId && value.kind === 'door')) {
          read.add(opening.id); read.add(opening.wallId)
          if (polygonsOverlap(footprint, corridor(...openingEndpoints(current.document, opening), Math.max(1000, current.document.walls[opening.wallId].thicknessMm)))) deny('沿边布景挡住门口两侧500mm预留区。')
        }
      }
      current = result.project; result.readIds.forEach(id => read.add(id)); result.writeIds.forEach(id => write.add(id)); result.createdIds.forEach(id => fresh.add(id)); cost += result.cost
      if (cost > 256) deny('沿边真实成员展开超过256预算。')
    }
    return { project: current, readIds: sorted(read), writeIds: sorted(write), createdIds: sorted(fresh), cost }
  }
  if (operation.kind === 'visualSurface') {
    required(operation.id)
    if (operation.style) for (const paint of [operation.style.base, ...operation.style.overlays.map(overlay => overlay.paint)]) {
      const material = project.document.materials[paint.materialRef.id]
      if (!scope.materialIds.includes(paint.materialRef.id) || !material || material.version !== paint.materialRef.version) deny('视觉固定材质未授权或版本不符。')
    }
    if (operation.style?.overlays.some(overlay => !inside(scope.boundsMm, overlay.boundaryMm, overlay.blendWidthMm))) deny('材质叠加层和羽化超出明确范围。')
    const command: VisualCommand = { type: 'setVisualSurface', kind: operation.surfaceKind, id: operation.id, style: operation.style }
    const preview = cloneJson(project.document), impact = applyVisualCommand(preview, command, context)
    const content = applyCompositionCommands({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, [command], context)
    const next = validateProjectData({ ...project, ...content, schemaVersion: content.document.schemaVersion, document: { ...content.document, revision: project.document.revision, updatedAt: project.document.updatedAt } })
    return { project: next, readIds: sorted([...impact.affectedIds, ...visualAuthoringReadIds(project, scope), ...visualAuthoringReadIds(next, scope)]), writeIds: impact.changedIds, createdIds: [], cost: Math.max(1, impact.commandCost) }
  }
  if (operation.kind === 'visualEnvironment' || operation.kind === 'visualFilter' && operation.target.kind === 'scene') {
    if (!scope.allowGlobalEnvironment) deny('全图环境或全图滤镜须单独明确授权。')
  }
  if (operation.kind === 'visualFilter') {
    if (operation.target.kind === 'layer') deny('AI滤镜须冻结明确目标，不能持续传播到图层后来对象。')
    if (operation.target.kind === 'entities') operation.target.ids.forEach(required)
  }
  if (operation.kind === 'visualBoundary') {
    if (operation.binding.kind === 'terrain') operation.binding.sides.forEach(side => required(side.areaId))
    if (operation.binding.kind === 'path') required(operation.binding.pathId)
  }
  if (operation.kind === 'visualEdge') required(operation.boundaryId)
  if ('id' in operation && visualEntity(project, operation.id)) required(operation.id)
  if (operation.kind === 'visualRemove') required(operation.id)
  const command = commandFor(project, scope, operation), previewScene = cloneJson(project.document), tape: string[] = []
  const impact = applyVisualCommand(previewScene, command, { clock: context.clock, ids: { nextId: () => { const id = context.ids.nextId(); tape.push(id); return id } } })
  let cursor = 0
  const content = (() => {
    try {
      return applyCompositionCommands({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, [command],
        { clock: context.clock, ids: { nextId: () => cursor < tape.length ? tape[cursor++] : context.ids.nextId() } })
    } catch (error) {
      if (operation.kind === 'visualBoundary' && operation.binding.kind === 'terrain') {
        const issues = boundaryConnectionIssues(project, previewScene, scope, allowed)
        if (issues.length) throw new VisualBoundaryConnectionError(issues)
      }
      throw error
    }
  })()
  const next = validateProjectData({ ...project, ...content, schemaVersion: content.document.schemaVersion,
    document: { ...content.document, revision: project.document.revision, updatedAt: project.document.updatedAt } })
  const writeIds = sorted([...impact.changedIds, ...impact.createdIds, ...impact.removedIds]), read = new Set([scope.floorId, scope.layerId, ...impact.affectedIds])
  const physicalChange = operation.kind === 'visualBoundary' && operation.binding.kind !== 'decoration'
  for (const id of sorted([...writeIds, ...(physicalChange ? impact.affectedIds : [])])) {
    if (LAYER_ENTITY_COLLECTIONS.some(key => Object.hasOwn(project.document[key], id)) || visualEntity(project, id)) required(id)
    if (visualEntity(next, id)) {
      assertVisual(next, scope, id)
      if (!visualEntity(project, id) && visualEntity(next, id)!.layerId !== scope.layerId) deny('视觉新增对象越过授权图层。')
    } else if (LAYER_ENTITY_COLLECTIONS.some(key => Object.hasOwn(next.document[key], id))) assertPublicSceneEntity(next, scope, id)
  }
  if (operation.kind === 'visualEnvironment') { writeIds.push('visual.environment'); read.add('visual.environment') }
  return { project: next, readIds: sorted(read), writeIds: sorted(writeIds), createdIds: impact.createdIds, cost: Math.max(1, impact.commandCost) }
}

export function publicVisualAuthoringContext(project: ProjectData, scope: VisualAuthoringScope, created: ReadonlySet<string>) {
  const allowed = new Set([...scope.entityIds, ...created])
  const entities = VISUAL_ENTITY_COLLECTIONS.flatMap(collection => Object.values(project.document.visual?.[collection] ?? {}).filter(value => allowed.has(value.id) && value.visibility === 'public').map(value => ({ collection, ...cloneJson(value) })))
  return { floorId: scope.floorId, layerId: scope.layerId, boundsMm: scope.boundsMm, allowedOperations: scope.operations, allowGlobalEnvironment: scope.allowGlobalEnvironment ?? false,
    entities, environment: scope.allowGlobalEnvironment ? project.document.visual!.environment : null }
}
/** Physical read projection for visual-only tasks uses the same frozen public closure. */
export function publicVisualPhysicalContext(project: ProjectData, scope: VisualAuthoringScope, created: ReadonlySet<string>) {
  return publicSceneContext(project, physicalScope(project, scope), created)
}
export function assertFinalVisualAuthoringTargets(project: ProjectData, scope: VisualAuthoringScope, touched: ReadonlySet<string>): void {
  const allowed = new Set([...scope.entityIds, ...touched])
  for (const id of allowed) if (visualEntity(project, id)) {
    assertVisual(project, scope, id)
    for (const reference of visualReferences(project, id)) if (!allowed.has(reference)) deny('视觉引用超出冻结的最终目标。')
  }
}
