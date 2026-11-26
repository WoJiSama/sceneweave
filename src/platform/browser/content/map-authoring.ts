import { prepareGenerationIntent, type GenerationIntent } from '../../../application/workspace/generation-intent.js'
import { prepareDomainProject } from '../../../application/workspace/generation.js'
import { prepareTerrainProject } from '../../../application/workspace/terrain.js'
import { landscapeLandmarks, prepareLandscapeMap } from '../../../application/workspace/landscape-map.js'
import { checkMapHeights, checkMapRoutes, mapSceneSummary, prepareMapOperations } from '../../../application/workspace/map-authoring.js'
import { fromVerifiedBundle, type EditableProject } from '../../../application/workspace/project.js'
import { defaultForestCampCoverages } from '../../../application/workspace/woodland-distribution.js'
import { assertTaskBudget, BUDGET_DIMENSIONS, emptyBudgetUsage, measureTaskBudget, type BudgetUsage, type TaskBudgetProfile } from '../../../shared/budget/task-budget.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { ERODED_COAST_VERSION } from '../../../shared/terrain-generation/generate.js'
import type { LandscapeRoadFailure } from '../../../shared/terrain-generation/landscape-authoring.js'
import { mapDimensions, parseMapEdit, parseMapGenerate, parseMapInspect, type MapGenerateRequest, type MapOperation } from '../../../shared/generation/map-authoring.js'
import { polygonsOverlap, propFootprint } from '../../../shared/geometry/geometry.js'
import { roadEffectsPolygon } from '../../../shared/geometry/road-domain.js'
import { publicTerrainView } from '../../../shared/geometry/visibility.js'
import { importProject } from '../../../shared/project/file.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { reviseSceneSnapshot } from '../../../shared/validation/snapshots.js'
import { OperationRejected } from '../../../shared/validation/operation-rejection.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { browserProjectValidation } from '../project-validation.js'
import { runtime } from '../runtime.js'
import { browserGenerationContent } from './generation-intent.js'
import { createStarterProject } from './factories.js'
import { createRefinedBlankProject } from './refined-blank.js'
import { createCoastalAscentBlankProject, createForestCampBlankProject, createLandscapeBlankProject } from './shore-blank.js'

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
        rooms: recipe.rooms.map(({ minAreaM2, ...room }) => ({ ...room, minAreaMm2: Math.max(1, Math.round(minAreaM2 * 1_000_000)), maxAreaMm2: widthMm * heightMm })),
        relations: recipe.relations, corridor: recipe.corridor ?? { axis: 'none', clearWidthMm: recipe.clearWidthMm },
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
      return { domain: 'volcano', request: { ...base, mountainElevationMm: recipe.mountainElevationMm, craterElevationMm: recipe.craterElevationMm,
        craterWidthPercent: 32, craterHeightPercent: 34, craterCenterYPercent: 52, routeWidthMm: recipe.routeWidthMm, connectionKind: recipe.connection,
        craterHazard: false, craterBlocksMovement: false, craterMovementCostMultiplier: 1, flowEnabled: recipe.lava !== 'none',
        flowWidthMm: 1200, lavaAppearance: recipe.lava === 'hot' ? 'hot' : 'cold', flowHazard: recipe.lava === 'hot',
        flowBlocksMovement: recipe.lava === 'hot', flowMovementCostMultiplier: recipe.lava === 'hot' ? 3 : 1 } }
    case 'mixed':
      return { domain: 'mixed', request: { ...base, environment: recipe.environment, purpose: recipe.purpose,
        roomCount: recipe.roomCount, furniture: recipe.furniture, vegetationMultiplier: recipe.vegetationMultiplier } }
    default:
      throw new Error('此配方使用地形或自由构图入口。')
  }
}

async function initialMap(input: MapGenerateRequest, profile: TaskBudgetProfile, draft: boolean): Promise<{
  project: EditableProject; usage: BudgetUsage; report?: unknown; roadFailures?: LandscapeRoadFailure[]
}> {
  const { recipe, title } = input, { widthMm, heightMm } = mapDimensions(input)
  const options = { title, widthMm, heightMm, preset: 'narrative' as const, gridVisible: false }
  if (recipe.kind === 'landscape') {
    const base = await createLandscapeBlankProject(options)
    return prepareLandscapeMap(base, pickFloor(base.document), input, recipe, { runtime, validation, budget: profile }, draft)
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
  const prepared = await prepareGenerationIntent(generationIntent(input), { runtime, content: browserGenerationContent, selectBudget: () => profile })
  const candidate = await prepareDomainProject(prepared.domain, prepared.base, prepared.input, { runtime, validation, profile })
  return { project: candidate.project, usage: candidate.usage, report: candidate.report }
}

function combinedUsage(profile: TaskBudgetProfile, first: BudgetUsage, second: BudgetUsage, elapsed: number) {
  const usage = emptyBudgetUsage()
  // Work spent on both stages is cumulative. The retained metadata/asset
  // figures are limits on the candidate, so a shared source is counted once.
  for (const key of BUDGET_DIMENSIONS) {
    if (key === 'activeExecutionMs') usage[key] = Math.ceil(elapsed)
    else if (key === 'metadataRecords' || key === 'metadataBytes' || key === 'assetBytes' || key === 'decodePixels') usage[key] = Math.max(first[key], second[key])
    else usage[key] = first[key] + second[key]
  }
  return assertTaskBudget(profile, usage)
}

function reviewed(project: EditableProject, input: Pick<MapGenerateRequest, 'referenceSizePx' | 'checks' | 'heightChecks' | 'oblique'>, floorId: string,
  preserveAspect = false, roadIds: string[] = [], enforce = true, roadFailures?: LandscapeRoadFailure[]) {
  const floor = pickFloor(project.document, floorId), scene = mapSceneSummary(project.document, floor, '', 12)
  const routeChecks = checkMapRoutes(project.document, floor, input, preserveAspect, roadIds, enforce, roadFailures)
  const heightChecks = checkMapHeights(project.document, floor, input, preserveAspect, enforce)
  return { scene, routeChecks, heightChecks, artStyle: project.document.artStyle?.active ?? 'original', floorId,
    oblique: input.oblique ?? scene.hasTerrainHeightDifferences }
}

export async function generateMapCandidate(raw: unknown, profile: TaskBudgetProfile, enforce = true) {
  const start = performance.now(), request = parseMapGenerate(raw)
  const initial = await initialMap(request, profile, !enforce), floor = pickFloor(initial.project.document)
  const preserveAspect = request.recipe.kind === 'landscape'
  const composed = request.operations.length
    ? await prepareMapOperations(initial.project, floor, request, { runtime, validation, budget: profile }, preserveAspect)
    : { project: initial.project, usage: emptyBudgetUsage(), changes: [], geometryWork: undefined }
  const project = { ...composed.project, document: { ...composed.project.document, title: request.title } }
  const roadIds = request.recipe.kind === 'landscape' ? request.recipe.routes.map(route => route.id) : []
  const review = reviewed(project, request, floor.id, preserveAspect, roadIds, enforce, initial.roadFailures)
  const usage = combinedUsage(profile, initial.usage, composed.usage, performance.now() - start)
  return { project, usage, ...review, landmarks: landscapeLandmarks(project.document, floor, request), changes: composed.changes, recipe: request.recipe.kind,
    ...(composed.geometryWork ? { geometryWork: composed.geometryWork } : {}),
    // The recipe report describes the original automatic generation. The
    // composed scene and route evidence describe the actual final candidate.
    ...(initial.report ? { recipeReport: initial.report } : {}) }
}

function roadsAffectedByEdit(scene: SceneDocument, floorId: string, operations: MapOperation[], changes: { id: string; kind: string }[] = []) {
  const view = publicTerrainView(scene)
  const changedAreas = new Set(changes.filter(change => change.kind === 'terrainAreas').map(change => change.id))
  const changedPaths = new Set(changes.filter(change => change.kind === 'paths').map(change => change.id))
  const movedProps = []
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
  const review = reviewed(project, request, floor.id, preserveAspect, roadIds, enforce)
  const usage = assertTaskBudget(profile, { ...composed.usage, activeExecutionMs: Math.ceil(performance.now() - start) })
  return { project, usage, ...review, changes: composed.changes, geometryWork: composed.geometryWork, parentProjectHash: request.projectHash }
}

export function reviewSavedMap(bundle: ProjectBundle, action: 'generate' | 'edit', raw: unknown, floorId: string, profile: TaskBudgetProfile) {
  const project = fromVerifiedBundle(bundle), { document } = project, floor = pickFloor(document, floorId)
  const usage = assertTaskBudget(profile, measureTaskBudget(document, document, { before: project, after: project }, {}, 'spatial-v1'))
  if (action === 'generate') {
    const input = parseMapGenerate(raw)
    const recipe = input.recipe, roads = recipe.kind === 'landscape' ? recipe.routes.map(route => route.id) : []
    return { ...reviewed(project, input, floor.id, recipe.kind === 'landscape', roads), landmarks: landscapeLandmarks(document, floor, input),
      usage, title: document.title, revision: document.revision }
  }
  const input = parseMapEdit(raw)
  if (input.floorId !== floor.id) throw new Error('保存工程与编辑请求的楼层不符。')
  return { ...reviewed(project, input, floor.id, input.referenceMapping === 'fit', roadsAffectedByEdit(document, floor.id, input.operations)),
    usage, title: document.title, revision: document.revision, parentProjectHash: input.projectHash }
}

export async function inspectMapCandidate(bytes: Uint8Array, raw: unknown) {
  const request = parseMapInspect(raw)
  const bundle = await importProject(bytes, validation), scene = bundle.project.document
  const floor = pickFloor(scene, request.floorId)
  return { title: scene.title, artStyle: scene.artStyle?.active ?? 'original', projectHash: projectContentHash(bundle.project), revision: scene.revision,
    floors: Object.values(scene.floors).map(({ id, name, boundsMm }) => ({ id, name, boundsMm })),
    ...mapSceneSummary(scene, floor, request.query, request.limit, request.offset) }
}
