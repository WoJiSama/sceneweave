import { prepareGenerationIntent, type GenerationIntent } from '../../../application/workspace/generation-intent.js'
import { prepareDomainProject } from '../../../application/workspace/generation.js'
import { prepareTerrainProject } from '../../../application/workspace/terrain.js'
import { checkLandscapeAscents, landscapeLandmarks, LANDSCAPE_PAIR_ACCOUNTING, materializeLandscapeCandidate, shapeLandscapeCandidate } from '../../../application/workspace/landscape-map.js'
import { checkMapHeights, checkMapRoutes, mapAssetCatalog, mapSceneSummary, prepareMapOperations } from '../../../application/workspace/map-authoring.js'
import { fromVerifiedBundle, toBundle, type EditableProject } from '../../../application/workspace/project.js'
import { defaultForestCampCoverages } from '../../../application/workspace/woodland-distribution.js'
import { assertTaskBudget, BUDGET_DIMENSIONS, emptyBudgetUsage, measureTaskBudget, type BudgetUsage, type TaskBudgetProfile } from '../../../shared/budget/task-budget.js'
import { VOLCANO_DEFAULTS } from '../../../shared/generation/domains/volcano/contracts.js'
import { reviewSavedVolcano } from '../../../shared/generation/domains/volcano/index.js'
import { reviewSavedInterior } from '../../../shared/generation/domains/interior/review.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { ERODED_COAST_VERSION } from '../../../shared/terrain-generation/generate.js'
import type { LandscapeRoadFailure, LandscapeWidthAttempt } from '../../../shared/terrain-generation/landscape-authoring.js'
import { mapDimensions, parseMapEdit, parseMapGenerate, parseMapInspect, type MapGenerateRequest, type MapLandscapeRecipe, type MapOperation } from '../../../shared/generation/map-authoring.js'
import { polygonsOverlap, propFootprint, terrainPoints } from '../../../shared/geometry/geometry.js'
import { roadEffectsPolygon } from '../../../shared/geometry/road-domain.js'
import { publicTerrainView } from '../../../shared/geometry/visibility.js'
import { PlayerCoverageError, projectScene } from '../../../shared/projection/projection.js'
import { importProject } from '../../../shared/project/file.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { reviseSceneSnapshot } from '../../../shared/validation/snapshots.js'
import { captureJson } from '../../../shared/validation/json.js'
import { OperationRejected } from '../../../shared/validation/operation-rejection.js'
import type { PointMm, SceneDocument } from '../../../shared/model/scene.js'
import { browserProjectValidation } from '../project-validation.js'
import { runtime } from '../runtime.js'
import { browserGenerationContent } from './generation-intent.js'
import { createStarterProject } from './factories.js'
import { createRefinedBlankProject } from './refined-blank.js'
import { createCoastalAscentBlankProject, createForestCampBlankProject, createLandscapeBlankContent } from './shore-blank.js'
import { materializeVisualArtBatches } from './visual-art-project.js'

const validation = browserProjectValidation

function pickFloor(scene: SceneDocument, id?: string) {
  const floor = id === undefined ? Object.values(scene.floors).sort((a, b) => a.id.localeCompare(b.id))[0]
    : Object.hasOwn(scene.floors, id) ? scene.floors[id] : undefined
  if (!floor || scene.mapMode !== 'scene') throw new Error('请选择场景工程中实际存在的楼层。')
  return floor
}

function generationIntent(input: MapGenerateRequest): GenerationIntent {
  const { title, recipe, seed } = input, { widthMm, heightMm } = mapDimensions(input)
  const base = { title, widthMm, heightMm, seed }
  switch (recipe.kind) {
    case 'interior':
      return { domain: 'interior', request: { ...base, wallThicknessMm: 180,
        rooms: recipe.rooms.map(({ minAreaM2, maxAreaM2, ...room }) => ({ ...room, minAreaMm2: Math.max(1, Math.round(minAreaM2 * 1_000_000)),
          maxAreaMm2: maxAreaM2 === undefined ? widthMm * heightMm : Math.max(1, Math.round(maxAreaM2 * 1_000_000)) })),
        relations: recipe.relations, corridor: recipe.corridor ?? { axis: 'none', clearWidthMm: recipe.clearWidthMm },
        ...(recipe.program ? { program: recipe.program } : {}),
        arrangement: { doors: true, entrance: true, furniture: recipe.furniture,
          doorWidthMm: Math.max(1100, recipe.clearWidthMm), clearWidthMm: recipe.clearWidthMm,
          ...(recipe.entranceRoom ? { entranceRoomRequirementId: recipe.entranceRoom } : {}) },
      } }
    case 'forest': {
      const cover = defaultForestCampCoverages({ width: widthMm, height: heightMm })
      const clearings = recipe.clearings ?? [{ id: 'camp', boundsMm: { x: Math.round(widthMm * .35), y: Math.round(heightMm * .35),
        width: Math.round(widthMm * .30), height: Math.round(heightMm * .30) } }]
      const density = (value: number) => Math.min(1_000_000, Math.round(value * recipe.density))
      return { domain: 'forest', request: { ...base, clearings, entranceSide: recipe.entranceSide, routeWidthMm: recipe.routeWidthMm,
        treeCoveragePpm: density(cover.tree), shrubCoveragePpm: density(cover.shrub), grassCoveragePpm: density(cover.grass) } }
    }
    case 'volcano':
      return { domain: 'volcano', request: { ...VOLCANO_DEFAULTS, ...base,
        mountainElevationMm: recipe.mountainElevationMm, craterElevationMm: recipe.craterElevationMm,
        craterWidthPercent: recipe.craterWidthPercent, craterHeightPercent: recipe.craterHeightPercent, craterCenterYPercent: recipe.craterCenterYPercent,
        routeWidthMm: recipe.routeWidthMm, connectionKind: recipe.connection, shape: recipe.shape, entranceSide: recipe.entranceSide,
        breachSide: recipe.breachSide ?? (recipe.shape === 'natural' ? VOLCANO_DEFAULTS.breachSide : 'none'),
        flowEnabled: recipe.lava !== 'none', flowWidthMm: recipe.flowWidthMm, lavaAppearance: recipe.lava === 'hot' ? 'hot' : 'cold' } }
    case 'mixed':
      return { domain: 'mixed', request: { ...base, environment: recipe.environment, purpose: recipe.purpose,
        roomCount: recipe.roomCount, furniture: recipe.furniture, vegetationMultiplier: recipe.vegetationMultiplier } }
    default:
      throw new Error('此配方使用地形或自由构图入口。')
  }
}

type InitialMap = {
  project: EditableProject; usage: BudgetUsage; report?: unknown; roadFailures?: LandscapeRoadFailure[]; widthAttempts?: ReadonlyMap<string, LandscapeWidthAttempt[]>
}

async function landscapeGeometry(input: MapGenerateRequest, recipe: MapLandscapeRecipe, profile: TaskBudgetProfile, draft: boolean, signal?: AbortSignal) {
  const { scene, batches } = await createLandscapeBlankContent({ title: input.title, ...mapDimensions(input), preset: 'narrative', gridVisible: false }, signal)
  signal?.throwIfAborted()
  const floor = pickFloor(scene), candidate = shapeLandscapeCandidate(scene, floor, input, recipe, profile, draft)
  return { scene, floor, candidate, materialize: async (signal?: AbortSignal) => {
    const base = await materializeVisualArtBatches(captureJson(scene), batches, signal)
    return materializeLandscapeCandidate(base, input, recipe, candidate, { runtime, validation: { ...validation, signal }, budget: profile })
  } }
}

async function initialMap(input: MapGenerateRequest, profile: TaskBudgetProfile, draft: boolean, signal?: AbortSignal): Promise<InitialMap> {
  const { recipe, title } = input, { widthMm, heightMm } = mapDimensions(input)
  const options = { title, widthMm, heightMm, preset: 'narrative' as const, gridVisible: false }
  if (recipe.kind === 'landscape') {
    const prepared = await landscapeGeometry(input, recipe, profile, draft, signal)
    return prepared.materialize(signal)
  }
  if (recipe.kind === 'layout') {
    const project = recipe.palette === 'coast' ? await createCoastalAscentBlankProject('coast', options)
      : recipe.palette === 'forest' ? await createForestCampBlankProject(options)
        : recipe.palette === 'interior' ? await createRefinedBlankProject('interior', options)
          : await createStarterProject(options)
    return { project, usage: emptyBudgetUsage() }
  }
  if (recipe.kind === 'island' || recipe.kind === 'coast') {
    const base = await createCoastalAscentBlankProject(recipe.kind, options)
    const candidate = await prepareTerrainProject(base, { sceneId: base.document.sceneId, widthMm, heightMm, seed: input.seed, kind: recipe.kind,
      algorithmVersion: ERODED_COAST_VERSION, budgetProfileId: profile.profileId, quality: 'standard' }, { runtime, validation, budget: profile })
    return { project: candidate.project, usage: candidate.usage!, report: { skeleton: candidate.result.skeleton, activity: candidate.result.activity } }
  }
  const prepared = await prepareGenerationIntent(generationIntent(input), { runtime, content: browserGenerationContent, selectBudget: () => profile, signal })
  const candidate = await prepareDomainProject(prepared.domain, prepared.base, prepared.input, { runtime, validation, profile, signal })
  return { project: candidate.project, usage: candidate.usage, report: candidate.report }
}

function combinedUsage(profile: TaskBudgetProfile, first: BudgetUsage, second: BudgetUsage, elapsed: number) {
  const usage = emptyBudgetUsage()
  // Work spent on both stages is cumulative. The retained metadata/asset
  // figures are limits on the candidate, so a shared source is counted once.
  for (const key of BUDGET_DIMENSIONS) {
    if (key === 'activeExecutionMs') usage[key] = Math.ceil(elapsed)
    else if (key === 'metadataRecords' || key === 'metadataBytes' || key === 'dependencyRefs' || key === 'assetBytes' || key === 'decodePixels') usage[key] = Math.max(first[key], second[key])
    else usage[key] = first[key] + second[key]
  }
  return assertTaskBudget(profile, usage)
}

function reviewed(document: SceneDocument, input: Pick<MapGenerateRequest, 'referenceSizePx' | 'checks' | 'heightChecks' | 'oblique'>, floorId: string,
  preserveAspect = false, roadIds: string[] = [], enforce = true, roadFailures?: LandscapeRoadFailure[]) {
  const floor = pickFloor(document, floorId), scene = mapSceneSummary(document, floor, '', 12)
  const routeChecks = checkMapRoutes(document, floor, input, preserveAspect, roadIds, enforce, roadFailures)
  const heightChecks = checkMapHeights(document, floor, input, preserveAspect, enforce)
  return { scene, routeChecks, heightChecks, artStyle: document.artStyle?.active ?? 'original' as const, floorId,
    oblique: input.oblique ?? scene.hasTerrainHeightDifferences }
}

function reviewedGeneration(document: SceneDocument, floorId: string, request: MapGenerateRequest, enforce: boolean, roadFailures?: LandscapeRoadFailure[],
  widthAttempts?: ReadonlyMap<string, LandscapeWidthAttempt[]>) {
  const roads = request.recipe.kind === 'landscape' ? request.recipe.routes.map(route => route.id) : []
  const floor = pickFloor(document, floorId)
  const review = reviewed(document, request, floorId, request.recipe.kind === 'landscape', roads, enforce, roadFailures)
  const volcano = request.recipe.kind === 'volcano' || (request.recipe.kind === 'mixed' && request.recipe.environment === 'volcano')
    ? reviewSavedVolcano(publicTerrainView(document), floorId) : undefined
  if (volcano && enforce) {
    const failed = volcano.routeChecks.find(check => !check.ok)
    if (failed) throw new OperationRejected('invalid_geometry', `${failed.label}复核失败：${failed.issues.map(issue => issue.message).join('；')}`)
    if (volcano.breach && !volcano.breach.ok) throw new OperationRejected('invalid_geometry', '保存工程的指定方向塌口未通过，须有贯通低口和两侧岩缘。')
  }
  return { ...review, ...(volcano ? { volcanoShape: volcano.shape, routeChecks: [...review.routeChecks, ...volcano.routeChecks],
    heightChecks: [...review.heightChecks, ...(volcano.breach ? [volcano.breach] : [])] } : {}),
    ascentChecks: checkLandscapeAscents(document, floor, request, enforce, widthAttempts), landmarks: landscapeLandmarks(document, floor, request) }
}

type GenerationReview = ReturnType<typeof reviewedGeneration>
export function mapDiagnosticMarkers(result: Pick<GenerationReview, 'routeChecks' | 'heightChecks'> & Partial<Pick<GenerationReview, 'ascentChecks' | 'landmarks'>>) {
  const seen = new Set<string>()
  return [
    ...[...result.routeChecks, ...(result.ascentChecks ?? [])].flatMap(check => check.ok ? [] : check.issues.flatMap(issue => issue.atMm
      ? [{ id: check.id, atMm: issue.atMm, message: issue.message }] : [])),
    ...result.heightChecks.flatMap(check => check.ok || 'side' in check && check.riseMm === null ? [] : [{ id: check.id, atMm: check.highMm,
      message: `实际高差 ${check.riseMm ?? '未知'} mm，目标至少 ${check.minRiseMm} mm。` }]),
    ...(result.landmarks ?? []).flatMap(landmark => landmark.issue ? [{ id: landmark.id, atMm: landmark.atMm, message: landmark.issue }] : []),
  ].filter(marker => {
    const key = `${marker.id}/${marker.atMm.x}/${marker.atMm.y}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 12)
}

export function mapGeometryAcceptable(result: Pick<GenerationReview, 'routeChecks' | 'heightChecks' | 'ascentChecks'>) {
  return [...result.routeChecks, ...result.heightChecks, ...result.ascentChecks].every(check => check.ok || 'required' in check && !check.required)
}

export async function restyleMapCandidate(base: EditableProject, floorId: string, style: MapLandscapeRecipe['style'], profile: TaskBudgetProfile, signal?: AbortSignal) {
  const floor = pickFloor(base.document, floorId)
  const input = parseMapEdit({ projectHash: projectContentHash(toBundle(base).project), floorId, operations: [{ kind: 'art-style', style }] })
  const { project } = await prepareMapOperations(base, floor, input, { runtime, validation: { ...validation, signal }, budget: profile })
  signal?.throwIfAborted()
  return project
}

export async function generateMapCandidate(raw: unknown, profile: TaskBudgetProfile, enforce = true, signal?: AbortSignal) {
  const start = performance.now(), request = parseMapGenerate(raw)
  const initial = await initialMap(request, profile, !enforce, signal)
  return finishMapGeneration(initial, request, profile, start, enforce, signal)
}

async function finishMapGeneration(initial: InitialMap, request: MapGenerateRequest, profile: TaskBudgetProfile, start: number, enforce: boolean, signal?: AbortSignal) {
  const floor = pickFloor(initial.project.document)
  signal?.throwIfAborted()
  const preserveAspect = request.recipe.kind === 'landscape'
  const composed = request.operations.length
    ? await prepareMapOperations(initial.project, floor, request, { runtime, validation: { ...validation, signal }, budget: profile }, preserveAspect)
    : { project: initial.project, usage: emptyBudgetUsage(), changes: [], geometryWork: undefined }
  signal?.throwIfAborted()
  const project = composed.project.document.title === request.title ? composed.project
    : { ...composed.project, document: { ...composed.project.document, title: request.title } }
  const review = reviewedGeneration(project.document, floor.id, request, enforce, initial.roadFailures, initial.widthAttempts)
  const usage = combinedUsage(profile, initial.usage, composed.usage, performance.now() - start)
  return { project, usage, ...review, changes: composed.changes, recipe: request.recipe.kind,
    ...(composed.geometryWork ? { geometryWork: composed.geometryWork } : {}),
    // The recipe report describes the original automatic generation. The
    // composed scene and route evidence describe the actual final candidate.
    ...(initial.report ? { recipeReport: initial.report } : {}) }
}

/** Only the owner of this draft can materialize its exact checked geometry. */
export async function prepareMapDiagnosis(raw: unknown, profile: TaskBudgetProfile, signal?: AbortSignal) {
  const start = performance.now(), request = parseMapGenerate(raw)
  const { recipe } = request
  if (recipe.kind === 'landscape' && !request.operations.length) {
    const { scene, floor, candidate, materialize } = await landscapeGeometry(request, recipe, profile, true, signal)
    const { document } = candidate
    const review = reviewedGeneration(document, floor.id, request, false, candidate.roadFailures, candidate.widthAttempts)
    const usage = assertTaskBudget(profile, measureTaskBudget(scene, document, undefined,
      { ...candidate.execution, intersectionPairs: candidate.execution.intersectionPairs + candidate.checkedPairs,
        activeExecutionMs: Math.ceil(performance.now() - start) }, LANDSCAPE_PAIR_ACCOUNTING))
    signal?.throwIfAborted()
    return { diagnosis: mapDiagnosis(document, review, usage), async createCandidate(signal?: AbortSignal) {
      const started = performance.now() - usage.activeExecutionMs
      return finishMapGeneration(await materialize(signal), request, profile, started, false, signal)
    } }
  }
  const candidate = await generateMapCandidate(request, profile, false, signal)
  return { diagnosis: mapDiagnosis(candidate.project.document, candidate, candidate.usage), async createCandidate(signal?: AbortSignal) {
    signal?.throwIfAborted()
    return candidate
  } }
}

export async function diagnoseMapCandidate(raw: unknown, profile: TaskBudgetProfile, signal?: AbortSignal) {
  return (await prepareMapDiagnosis(raw, profile, signal)).diagnosis
}

export function mapDiagnosis(document: SceneDocument, review: GenerationReview, usage: BudgetUsage) {
  const floor = pickFloor(document, review.floorId), view = publicTerrainView(document)
  const { scene, floorId, routeChecks, heightChecks, ascentChecks, landmarks, artStyle, oblique, volcanoShape } = review
  return { status: 'diagnosed' as const, ok: mapGeometryAcceptable(review), scene, floorId, routeChecks, heightChecks, ascentChecks, landmarks, artStyle, oblique, usage,
    ...(volcanoShape ? { volcanoShape } : {}),
    diagnosticMarkers: mapDiagnosticMarkers(review), geometry: { boundsMm: floor.boundsMm,
      land: Object.values(view.terrainAreas).filter(row => row.floorId === floor.id && !row.waterSurface)
        .map(row => ({ id: row.id, boundaryMm: terrainPoints(row) })),
      roads: Object.values(view.paths).filter(row => row.floorId === floor.id).map(row => ({ id: row.id, pointsMm: row.centerlineMm })) } }
}

function roadsAffectedByEdit(scene: SceneDocument, floorId: string, operations: MapOperation[], changes: { id: string; kind: string }[] = []) {
  const view = publicTerrainView(scene)
  const changedAreas = new Set(changes.filter(change => change.kind === 'terrainAreas').map(change => change.id))
  const changedPaths = new Set(changes.filter(change => change.kind === 'paths').map(change => change.id))
  const movedProps: PointMm[][] = []
  for (const operation of operations) {
    if (operation.kind === 'path-update') {
      changedPaths.add(operation.id)
      if (operation.around) for (const support of view.paths[operation.id]?.supportRefs ?? []) {
        if (support.kind === 'terrainArea') changedAreas.add(support.id)
      }
    }
    if (operation.kind === 'terrain-update' || operation.kind === 'terrain-shape') changedAreas.add(operation.id)
    if (operation.kind === 'cover-zone') changedAreas.add(operation.areaId)
    if (operation.kind === 'prop-move') {
      const prop = view.props[operation.id]
      if (prop?.blocksMovement) movedProps.push(propFootprint(prop))
    }
    if (operation.kind === 'scenery-zone' || operation.kind === 'scenery-density') {
      const domain = view.scatterGroups[operation.id]?.domain
      if (domain?.kind === 'area') changedAreas.add(domain.areaId)
      if (domain?.kind === 'path') changedPaths.add(domain.pathId)
    }
  }
  return Object.values(view.paths).filter(path => {
    if (path.floorId !== floorId || !path.roadSurface) return false
    if (changedPaths.has(path.id) || path.supportRefs.some(ref => ref.kind === 'terrainArea' && changedAreas.has(ref.id))) return true
    if (!movedProps.length) return false
    const effects = roadEffectsPolygon(path)
    return movedProps.some(footprint => polygonsOverlap(footprint, effects))
  }).map(path => path.id)
}

export async function editMapCandidate(bytes: Uint8Array, raw: unknown, profile: TaskBudgetProfile, enforce = true) {
  const start = performance.now(), request = parseMapEdit(raw), bundle = await importProject(bytes, validation)
  const base = fromVerifiedBundle(bundle)
  if (projectContentHash(bundle.project) !== request.projectHash) {
    throw new OperationRejected('stale_candidate', '工程摘要已变化。请重新 inspect，再以新的 projectHash 修改。')
  }
  const floor = pickFloor(base.document, request.floorId)
  const preserveAspect = request.referenceMapping === 'fit'
  const composed = await prepareMapOperations(base, floor, request, { runtime, validation, budget: profile }, preserveAspect)
  if (!composed.changes.length) throw new Error('这些操作没有产生可保存的场景变化。')
  const project = { ...composed.project, document: reviseSceneSnapshot(composed.project.document, base.document.revision + 1, runtime.clock.now()) }
  const roadIds = roadsAffectedByEdit(project.document, floor.id, request.operations, composed.changes)
  const review = reviewed(project.document, request, floor.id, preserveAspect, roadIds, enforce)
  const usage = assertTaskBudget(profile, { ...composed.usage, activeExecutionMs: Math.ceil(performance.now() - start) })
  return { project, usage, ...review, changes: composed.changes, geometryWork: composed.geometryWork, parentProjectHash: request.projectHash }
}

export function reviewSavedMap(bundle: ProjectBundle, action: 'generate' | 'edit', raw: unknown, floorId: string, profile: TaskBudgetProfile) {
  const project = fromVerifiedBundle(bundle), { document } = project, floor = pickFloor(document, floorId)
  const usage = assertTaskBudget(profile, measureTaskBudget(document, document, { before: project, after: project }, {}, 'map-spatial-v2'))
  if (action === 'generate') {
    const input = parseMapGenerate(raw)
    const interior = input.recipe.kind === 'interior' && input.recipe.program
      ? reviewSavedInterior(publicTerrainView(document), floor.id, input.seed, profile) : undefined
    if (interior && !interior.ok) throw new OperationRejected('invalid_geometry', `保存工程的室内需求未通过：${interior.issues.join('；')}`)
    return { ...reviewedGeneration(document, floor.id, input, true),
      ...(interior ? { interior } : {}),
      usage, title: document.title, revision: document.revision }
  }
  const input = parseMapEdit(raw)
  if (input.floorId !== floor.id) throw new Error('保存工程与编辑请求的楼层不符。')
  return { ...reviewed(document, input, floor.id, input.referenceMapping === 'fit', roadsAffectedByEdit(document, floor.id, input.operations)),
    usage, title: document.title, revision: document.revision, parentProjectHash: input.projectHash }
}

export async function inspectMapCandidate(bytes: Uint8Array, raw: unknown) {
  const request = parseMapInspect(raw)
  const bundle = await importProject(bytes, validation), scene = bundle.project.document
  const floor = pickFloor(scene, request.floorId)
  const summary = { title: scene.title, artStyle: scene.artStyle?.active ?? 'original', projectHash: projectContentHash(bundle.project), revision: scene.revision,
    floors: Object.values(scene.floors).map(({ id, name, boundsMm }) => ({ id, name, boundsMm })) }
  if (request.catalog) {
    try {
      const visible = projectScene(scene, 'player', bundle.project.appearance, { floorId: floor.id })
      const props = new Set(visible.props.map(row => row.definitionRef?.id).filter((id): id is string => !!id))
      const catalog = { propDefinitions: Object.fromEntries([...props].map(id => [id, scene.propDefinitions[id]])),
        materials: Object.fromEntries(Object.keys(visible.materials).map(id => [id, scene.materials[id]]).filter(([, material]) => !!material)) }
      return { ...summary, ...mapAssetCatalog(catalog, request) }
    } catch (error) {
      if (error instanceof PlayerCoverageError) throw new OperationRejected('outside_scope', '当前楼层的玩家覆盖尚未通过，请在普通编辑器核对。')
      throw error
    }
  }
  return { ...summary, ...mapSceneSummary(scene, floor, request.query, request.limit, request.offset) }
}
