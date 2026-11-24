import { addSurfaceAppearanceSource, surfaceStyle } from '../../shared/appearance/graph.js'
import { assertTaskBudget, captureExecutionBudget, measureTaskBudget, type BudgetUsage, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { geometryIdentityIds } from '../../shared/commands/domain.js'
import { findExposedTerrainEdge } from '../../shared/commands/outdoor.js'
import { decorationFootprint } from '../../shared/decorations/geometry.js'
import { connectionFootprint, pathPolygon, pointInPolygon, polygonsOverlap, propFootprint, roomPoints, supportedPolygon, terrainPoints, corridor } from '../../shared/geometry/geometry.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import { isFloorSizedCanvasGround } from '../../shared/model/canvas-ground.js'
import type { ProjectData } from '../../shared/model/project.js'
import { DECORATION_COLLECTIONS, LAYER_ENTITY_COLLECTIONS, SURFACE_RULE_COLLECTIONS, type BoundsMm, type PointMm, type SceneDocument } from '../../shared/model/scene.js'
import { checkCancelled, type CompleteValidationOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { projectResourceHashes } from '../../shared/project/source-resources.js'
import { compositionInputHash, compositionOutputHash, dependencyInputHash, terrainRequirementInputHash } from '../../shared/terrain-generation/composition-integrity.js'
import { evaluateTerrainRequirement } from '../../shared/terrain-generation/composition-requirements.js'
import { constraintInputHash, generationInputHash, managedOutputHash, materializedBoundaryHash } from '../../shared/terrain-generation/integrity.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import { sha256Text } from '../../shared/validation/hash.js'
import { refreshTerrainTransition } from '../../shared/visual/transition.js'
import { type EditableProject } from './project.js'
import { materializeProject } from './prepare.js'

export interface CanvasGenerationTarget {
  floorId: string
  layerId: string
  boundsMm: BoundsMm
}

const entities = [...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS,
  'attachments', 'attachmentSurfaces', 'pathAttachments'] as const
const catalogs = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
const catalogBySubject = { asset: 'assets', material: 'materials', propDefinition: 'propDefinitions',
  prefabDefinition: 'prefabDefinitions', styleTheme: 'styleThemes' } as const
const rectangle = ({ x, y, width, height }: BoundsMm): PointMm[] =>
  [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]

function append<T>(target: Record<string, T>, source: Record<string, T>, fixed = false): void {
  for (const [id, value] of Object.entries(source)) {
    if (!Object.hasOwn(target, id)) target[id] = value
    else if (!fixed || canonicalJson(target[id]) !== canonicalJson(value)) throw new Error(`生成内容的身份或固定资源冲突：${id}。`)
  }
}

function appendCatalog(project: ProjectData, source: ProjectData): void {
  const bindings = new Map(project.licenseBindings.map(binding => [`${binding.subjectKind}:${binding.subjectId}`, binding]))
  const pathsByRef = new Map(project.licenseBindings.map(binding => [binding.licenseRef, binding.licensePath]))
  const records = Object.fromEntries(catalogs.map(key => [key, captureJson(source.document[key])])) as Pick<SceneDocument, typeof catalogs[number]>
  for (const binding of captureJson(source.licenseBindings)) {
    const kind = binding.subjectKind
    if (kind === 'regionalSymbolDefinition') throw new Error('区域图符属于独立的区域地图。')
    const key = `${kind}:${binding.subjectId}`, prior = bindings.get(key)
    if (prior && prior.licensePath !== binding.licensePath) throw new Error(`固定素材许可冲突：${binding.subjectId}。`)
    const alias = pathsByRef.get(binding.licenseRef)
    // Legacy palettes reused generic labels such as MIT. Give newly added
    // subjects a text-specific reference and preserve existing bindings.
    binding.licenseRef = prior?.licenseRef ?? (alias && alias !== binding.licensePath
      ? `license-${binding.licensePath.slice(9, -4)}` : binding.licenseRef)
    records[catalogBySubject[kind]][binding.subjectId].licenseRef = binding.licenseRef
    if (!prior) {
      bindings.set(key, binding)
      pathsByRef.set(binding.licenseRef, binding.licensePath)
    }
  }
  project.licenseBindings = [...bindings.values()]
  for (const key of catalogs) append(project.document[key] as Record<string, unknown>, records[key], true)
}

function verifyPlacement(scene: SceneDocument, { floorId, layerId, boundsMm }: CanvasGenerationTarget, outdoors: boolean,
  budget: ReturnType<typeof captureExecutionBudget>, signal: CompleteValidationOptions['signal']) {
  const floor = scene.floors[floorId], layer = scene.userLayers[layerId]
  if (scene.mapMode !== 'scene' || !floor || layer?.floorId !== floorId || layer.editLocked) throw new Error('请选择当前楼层上可编辑的图层。')
  const { x, y, width, height } = boundsMm, b = floor.boundsMm
  if (![x, y, width, height, x + width, y + height].every(Number.isSafeInteger) || width <= 0 || height <= 0
    || x < b.x || y < b.y || x + width > b.x + b.width || y + height > b.y + b.height) throw new Error('生成范围须完整落在当前楼层内。请调整位置或尺寸。')
  const scope = rectangle(boundsMm)
  const conflict = (kind: string, rows: Iterable<{ id: string; floorId: string }>, polygon: (id: string) => PointMm[]) => {
    for (const row of rows) {
      if (row.floorId !== floorId) continue
      checkCancelled(signal)
      const ring = polygon(row.id)
      if (!ring.length || ring.every(p => p.x < x) || ring.every(p => p.x > x + width)
        || ring.every(p => p.y < y) || ring.every(p => p.y > y + height)) continue
      budget.charge({ intersectionPairs: scope.length * ring.length, dependencyRefs: 1 })
      if (polygonsOverlap(scope, ring)) throw new Error(`生成范围与已有${kind}重叠。请在空处调整范围。`)
    }
  }
  conflict('房间', Object.values(scene.rooms), id => roomPoints(scene, scene.rooms[id]))
  conflict('墙体', Object.values(scene.walls), id => {
    const wall = scene.walls[id], a = scene.vertices[wall.startVertexId], c = scene.vertices[wall.endVertexId]
    return corridor({ x: a.xMm, y: a.yMm }, { x: c.xMm, y: c.yMm }, wall.thicknessMm, true)
  })
  conflict('物件', Object.values(scene.props), id => propFootprint(scene.props[id]))
  conflict('装饰', Object.values(scene.decorations), id => decorationFootprint(scene, scene.decorations[id]))
  conflict('道路', Object.values(scene.paths), id => pathPolygon(scene.paths[id]))
  conflict('高差连接', Object.values(scene.terrainConnections), id => connectionFootprint(scene.terrainConnections[id]))
  conflict('区域', Object.values(scene.regions).filter(row => row.kind !== 'partition'), id => scene.regions[id].boundaryMm)
  if (outdoors) {
    conflict('地形', Object.values(scene.terrainAreas).filter(area => !isFloorSizedCanvasGround(area, floor)), id => terrainPoints(scene.terrainAreas[id]))
    for (const rule of Object.values(scene.surfaceRules)) for (const region of rule.regionsMm) conflict('地表规则', [rule], () => region.outerMm)
    return null
  }
  const surfaces = Object.values(scene.terrainAreas).filter(area => area.floorId === floorId).sort((a, c) => c.coveragePriority - a.coveragePriority)
  const area = surfaces.find(row => pointInPolygon({ x: x + width / 2, y: y + height / 2 }, terrainPoints(row)))
  const support = !area || isFloorSizedCanvasGround(area, floor) ? { kind: 'floor' as const, id: floorId } : { kind: 'terrainArea' as const, id: area.id }
  if (area?.editLocked || area && scene.userLayers[scene.entityLayers[area.id]]?.editLocked
    || area?.blocksMovement || !supportedPolygon(scene, scope, support, floorId)) throw new Error('室内布局需要一块完整、可通行且未锁定的平地。请调整范围。')
  return { support, elevationMm: support.kind === 'floor' ? 0 : area!.groundElevationMm }
}

// Generation supplies a strict, single-Floor snapshot. Map its world fields
// into the destination while leaving definition-local coordinates untouched.
const worldFields = new Set(['boundsMm', 'boundaryMm', 'positionMm', 'pointsMm', 'pointMm', 'anchorMm',
  'centerMm', 'centerlineMm', 'gridOriginMm', 'fromMm', 'toMm', 'viaMm', 'toPlatformViaMm', 'toCraterViaMm', 'routeHintMm',
  'start', 'end', 'control1', 'control2', 'outerMm', 'holesMm', 'polygons', 'regionsMm', 'clipMm', 'scopeMm',
  'from', 'to', 'translationMm', 'verticesMm', 'floorVerticesMm'])
const fixedIdentityFields = new Set(['assetId', 'definitionId', 'materialId', 'catalogId', 'licenseRef', 'seed', 'seedKey', 'purpose', 'title', 'name', 'text', 'message'])

function relocate<T>(input: T, mapping: ReadonlyMap<string, string>, offset: PointMm, recipes: readonly string[]): T {
  const walk = (value: unknown, field = '', pointSet = false): unknown => {
    if (typeof value === 'string') {
      if (field === 'outputKey' || field === 'candidateKey' || field === 'key') {
        const recipe = recipes.find(id => value.startsWith(id + ':'))
        if (recipe) return mapping.get(recipe) + value.slice(recipe.length)
      }
      return fixedIdentityFields.has(field) ? value : mapping.get(value) ?? value
    }
    if (value === null || typeof value !== 'object') return value
    const translate = pointSet || worldFields.has(field)
    if (Array.isArray(value)) return value.map(child => walk(child, field, translate))
    const record = value as Record<string, unknown>
    // The threshold's frozen source is evidence in generator coordinates.
    // Noise depends on those original coordinates and on its original IDs.
    const threshold = typeof record.targetCoveragePpm === 'number' && Object.hasOwn(record, 'sourceInput')
    const entries = Object.entries(record).map(([key, child]) => [
      mapping.get(key) ?? key,
      threshold && (key === 'sourceInput' || key === 'grid') ? captureJson(child)
        : walk(child, key, translate && field === 'verticesMm' || key === 'originMm' && record.alignment === 'surface'),
    ])
    const result = Object.fromEntries(entries)
    if (translate && typeof record.x === 'number' && typeof record.y === 'number') {
      result.x = record.x + offset.x; result.y = record.y + offset.y
    }
    if (typeof record.xMm === 'number' && typeof record.yMm === 'number' && typeof record.floorId === 'string') {
      result.xMm = record.xMm + offset.x; result.yMm = record.yMm + offset.y
    }
    return result
  }
  return walk(input) as T
}

export async function prepareCanvasGeneration(current: EditableProject, source: EditableProject, target: CanvasGenerationTarget,
  options: { runtime: PreparationContext; validation: CompleteValidationOptions; profile: TaskBudgetProfile; execution?: Partial<BudgetUsage> }): Promise<EditableProject> {
  const { validation, profile, runtime } = options, signal = validation.signal
  const budget = captureExecutionBudget(profile)
  const original = source.document, sourceFloor = Object.values(original.floors)[0]
  if (original.mapMode !== 'scene' || Object.keys(original.floors).length !== 1
    || sourceFloor.boundsMm.width !== target.boundsMm.width || sourceFloor.boundsMm.height !== target.boundsMm.height) {
    throw new Error('生成内容的尺寸与当前范围不同，请重新预览。')
  }
  const roomGround = verifyPlacement(current.document, target, Object.keys(original.terrainAreas).length > 0, budget, signal)
  const { resources, ...metadata } = current
  const project = { ...captureJson(metadata), resources }
  const scene = project.document, generation = scene.generation, floorId = target.floorId
  const reserved = geometryIdentityIds(scene)
  for (const value of Object.values(project.historyIdentity)) if (typeof value === 'object' && value) for (const id of Object.keys(value)) reserved.add(id)
  const prefix = `generated-${sha256Text(original.sceneId).slice(0, 24)}`
  const ownIds = geometryIdentityIds(original)
  for (const key of catalogs) for (const id of Object.keys(original[key])) ownIds.delete(id)
  for (const id of Object.keys(original.userLayers)) ownIds.add(id)
  const mapping = new Map([...ownIds].sort().map((id, index) => [id, `${prefix}-${String(index).padStart(6, '0')}`]))
  mapping.set(sourceFloor.id, floorId)
  mapping.set(original.sceneId, scene.sceneId)
  for (const [id, next] of mapping) if (id !== sourceFloor.id && id !== original.sceneId && (reserved.has(next) || Object.hasOwn(scene.userLayers, next))) {
    throw new Error('此生成结果的身份已使用，请重新预览。')
  }
  const offset = { x: target.boundsMm.x - sourceFloor.boundsMm.x, y: target.boundsMm.y - sourceFloor.boundsMm.y }
  const placed = relocate(original, mapping, offset, Object.keys(original.generation.legacy.recipes))

  appendCatalog(project, source)
  const highest = Math.max(0, ...Object.values(scene.userLayers).filter(row => row.floorId === floorId).map(row => row.order))
  Object.values(placed.userLayers).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).forEach((layer, index) => {
    scene.userLayers[layer.id] = { ...layer, name: `生成 · ${layer.name}`, order: highest + index + 1 }
  })
  for (const key of entities) {
    if (!placed[key] || !Object.keys(placed[key]!).length) continue
    const targetRecords = (scene[key] ??= {}) as Record<string, unknown>
    append(targetRecords, placed[key] as Record<string, unknown>)
  }
  append(scene.entityLayers, placed.entityLayers)
  scene.constraints.pathChecks.push(...placed.constraints.pathChecks)
  scene.constraints.entranceOpeningIds.push(...placed.constraints.entranceOpeningIds)
  if (roomGround) {
    for (const room of Object.values(placed.rooms)) if (room.supportRef.kind === 'floor') {
      room.supportRef = roomGround.support
      room.groundElevationMm = roomGround.elevationMm
    }
    for (const prop of Object.values(placed.props)) if (prop.supportRef.kind === 'floor') prop.supportRef = roomGround.support
  }
  for (const edge of Object.values(placed.terrainEdges)) {
    const exposed = findExposedTerrainEdge(scene, edge.source)
    if (exposed) edge.neighborAreaId = exposed.neighborAreaId
  }

  const sourceVisual = placed.visual.base, visual = scene.visual.base
  for (const key of ['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const) append(visual.base[key] as Record<string, unknown>, sourceVisual.base[key])
  for (const edge of Object.values(sourceVisual.materializedEdges)) edge.inputHash = materializedBoundaryHash(visual.base.boundaries[edge.boundaryId])
  append(visual.materializedEdges, sourceVisual.materializedEdges)
  for (const row of Object.values(placed.visual.transitions)) scene.visual.transitions[row.id] = refreshTerrainTransition(scene, row)
  if (placed.aggregateCoordinates) {
    scene.aggregateCoordinates ??= { encoding: 'world', groups: {} }
    append(scene.aggregateCoordinates.groups, placed.aggregateCoordinates.groups)
  }
  const placedGen = placed.generation
  for (const key of ['recipes', 'rules', 'intents', 'ownership', 'exclusions', 'constraints', 'checks', 'sourceLinks'] as const) append(generation.legacy[key] as Record<string, unknown>, placedGen.legacy[key])
  for (const key of ['features', 'compositions', 'requirements', 'checks', 'thresholds', 'dependencies'] as const) append(generation[key] as Record<string, unknown>, placedGen[key])
  for (const row of Object.values(placedGen.legacy.rules)) {
    row.inputHash = generationInputHash(scene, row)
    row.managedOutputHash = managedOutputHash(scene, row)
  }
  for (const row of Object.values(generation.legacy.checks)) if (row.state !== 'unchecked') row.inputHash = constraintInputHash(scene, row.constraintId)
  for (const row of Object.values(placedGen.dependencies)) {
    row.reads.forEach(read => { read.contentHash = sha256Text(canonicalJson(read.snapshot)) })
    row.inputHash = dependencyInputHash(scene, row)
  }
  for (const row of Object.values(placedGen.compositions)) row.inputHash = compositionInputHash(scene, row)
  for (const row of Object.values(generation.checks)) {
    const requirement = generation.requirements[row.requirementId]
    if (generation.compositions[requirement.compositionId].state !== 'active') continue
    const actual = evaluateTerrainRequirement(scene, requirement, budget)
    if (actual.state !== 'passed') throw new Error('生成范围与已有地形约束冲突，请调整范围。')
    row.inputHash = terrainRequirementInputHash(scene, requirement)
    row.state = actual.state; row.issues = actual.issues
  }

  const appearance = project.appearance, sourceAppearance = source.appearance
  for (const key of ['sources', 'variants', 'prefabAppearanceTemplates'] as const) append(appearance[key] as Record<string, unknown>, captureJson(sourceAppearance[key]), true)
  if (sourceAppearance.presentations) {
    appearance.presentations ??= {}
    append(appearance.presentations, captureJson(sourceAppearance.presentations), true)
  }
  for (const [id, sourceId] of Object.entries(sourceAppearance.propSources)) appearance.propSources[mapping.get(id)!] = sourceId
  for (const id of Object.keys(sourceAppearance.surfaceSources)) {
    const nextId = mapping.get(id)!, style = surfaceStyle(scene, nextId)
    if (style) appearance.surfaceSources[nextId] = addSurfaceAppearanceSource(appearance, style)
  }
  for (const key of ['instanceAdjustments', 'layerAdjustments'] as const) append(appearance[key], relocate(sourceAppearance[key], mapping, offset, []))
  for (const key of ['assets', 'licenses', 'authoringSources'] as const) append(project[key] as Record<string, unknown>, captureJson(source[key]), true)
  const currentHashes = new Set(projectResourceHashes(current))
  project.resources = { read: hash => (currentHashes.has(hash) ? current : source).resources.read(hash) }
  project.historyIdentity = advanceHistoryIdentity(project.historyIdentity, current.document, scene, runtime, { initializeStructures: true })
  for (const row of Object.values(placedGen.compositions)) row.outputHash = compositionOutputHash(scene, row, project.historyIdentity)
  const usage = budget.snapshot()
  const execution = { ...options.execution, intersectionPairs: usage.intersectionPairs + (options.execution?.intersectionPairs ?? 0),
    dependencyRefs: usage.dependencyRefs + (options.execution?.dependencyRefs ?? 0) }
  assertTaskBudget(profile, measureTaskBudget(current.document, scene, { before: current, after: project }, execution))
  checkCancelled(signal)
  const prepared = await materializeProject(project, { runtime, validation })
  assertTaskBudget(profile, measureTaskBudget(current.document, prepared.document, { before: current, after: prepared }, execution))
  return prepared
}
