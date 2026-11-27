import { createCompositionContent } from '../../shared/appearance/graph.js'
import { assertTaskBudget, captureExecutionBudget, captureGeometryPairBudget, measureDocumentBudget, measureTaskBudget, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import type { MapGenerateRequest, MapLandscapeRecipe } from '../../shared/generation/map-authoring.js'
import type { Floor, PointMm } from '../../shared/model/scene.js'
import { shapeLandscape, LANDSCAPE_VERSION, ASCENT_APPROACH_MM } from '../../shared/terrain-generation/landscape-authoring.js'
import { finishLandscape, landscapeRouteClearances } from '../../shared/terrain-generation/landscape-finish.js'
import { withGeometryPairCounter } from '../../shared/geometry/edge-index.js'
import { createSupportQuery } from '../../shared/geometry/support-sample.js'
import { reachesLandmarkSide } from '../../shared/geometry/landmark-route.js'
import { checkGradedRoadOnValidScene, type TerrainTravelIssue } from '../../shared/geometry/terrain-travel.js'
import { publicTerrainView } from '../../shared/geometry/visibility.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import type { LandscapeRoadFailure, LandscapeWidthAttempt } from '../../shared/terrain-generation/landscape-authoring.js'
import { captureJson } from '../../shared/validation/json.js'
import { newMapArtStyle } from '../../shared/visual/art-style.js'
import { OperationRejected } from '../../shared/validation/operation-rejection.js'
import { validateSceneSnapshot } from '../../shared/validation/snapshots.js'
import { materializeProject, type PrepareOptions } from './prepare.js'
import type { EditableProject } from './project.js'
import { mapCoordinate } from './map-authoring.js'

export function shapeLandscapeCandidate(base: SceneDocument, floor: Floor, input: MapGenerateRequest, recipe: MapLandscapeRecipe,
  budget: TaskBudgetProfile, draft = false) {
  const { boundsMm: bounds } = floor, { referenceSizePx: reference, seed } = input
  const source = reference ?? { width: 1000, height: 1000 }
  const scale = reference && Math.min(bounds.width / source.width, bounds.height / source.height)
  const size = ({ x, y }: PointMm) => ({ x: Math.round(x * (scale || bounds.width / source.width)),
    y: Math.round(y * (scale || bounds.height / source.height)) })
  const point = mapCoordinate(bounds, source, !!reference), frame = { point, size }
  const scene = captureJson(base), meter = captureExecutionBudget(budget)
  const roadFailures: LandscapeRoadFailure[] = []
  const widthAttempts = new Map<string, LandscapeWidthAttempt[]>()
  scene.artStyle = { ...newMapArtStyle(), active: recipe.style }
  meter.charge({ candidateAttempts: 1 })
  const pairs = captureGeometryPairBudget(budget)
  const checked = withGeometryPairCounter(pairs.add, () => {
    const forms = shapeLandscape(scene, floor, recipe, frame, seed, meter, draft ? roadFailures : undefined, widthAttempts)
    finishLandscape(scene, floor, recipe, forms, frame, seed, meter, landscapeRouteClearances(input.checks, floor, point))
    return validateSceneSnapshot(scene)
  })
  if (!checked.ok) {
    const issues = checked.errors.slice(0, 10)
    throw Object.assign(new OperationRejected('invalid_geometry', issues
      .map(issue => `${issue.entityId ? `「${issue.entityId}」` : ''}${issue.message}`).join('；')), { details: { issues } })
  }
  return { document: checked.document, execution: meter.snapshot(), checkedPairs: pairs.count(), roadFailures, widthAttempts,
    report: { zones: recipe.landforms.map(row => ({ id: row.id, areaId: row.areaId, at: point(row.at), targetElevationMm: row.elevationMm })),
      scale: reference ? { source, mmPerPixel: scale, contentOriginMm: point({ x: 0, y: 0 }), canvasMm: bounds }
        : { source: 'relative', canvasMm: bounds } } }
}

export const LANDSCAPE_PAIR_ACCOUNTING = 'landscape-spatial-v3'

export async function materializeLandscapeCandidate(base: EditableProject, input: MapGenerateRequest, recipe: MapLandscapeRecipe,
  candidate: ReturnType<typeof shapeLandscapeCandidate>, options: PrepareOptions & { budget: TaskBudgetProfile }) {
  const { document, execution, checkedPairs, roadFailures, widthAttempts, report } = candidate
  // Geometry was prepared with the fixed palette's definitions. Bind the
  // real raster assets before rebuilding identities and full validation.
  const content = createCompositionContent({ ...document, assets: base.document.assets }, options.runtime)
  const project = await materializeProject({ ...base, ...content }, { ...options, baseline: base, terrainPairAccounting: LANDSCAPE_PAIR_ACCOUNTING })
  const usage = assertTaskBudget(options.budget, measureTaskBudget(base.document, project.document, { before: base, after: project },
    { ...execution, intersectionPairs: execution.intersectionPairs + checkedPairs }, LANDSCAPE_PAIR_ACCOUNTING))
  return { project, usage, roadFailures, widthAttempts, report: { ...report, algorithmVersion: LANDSCAPE_VERSION, seed: input.seed, environment: recipe.environment, style: recipe.style, density: recipe.density,
    geometryWork: { model: LANDSCAPE_PAIR_ACCOUNTING, previousEstimate: measureDocumentBudget(base.document, project.document).intersectionPairs,
      checkedPairs, generationPairAllowance: execution.intersectionPairs, billedPairs: usage.intersectionPairs,
      documentPairs: usage.intersectionPairs - checkedPairs - execution.intersectionPairs, limitPairs: options.budget.limits.intersectionPairs },
    scenery: recipe.scenery.map(row => {
      const group = project.document.scatterGroups[row.id]
      return { id: row.id, areaId: row.areaId, palette: row.palette, pattern: row.pattern, density: row.density,
        placed: Object.values(group.members).filter(member => member.propId !== null).length,
        reservedZones: group.exclusions.map(({ id, boundaryMm }) => ({ id, boundaryMm })) }
    }) } }
}

export function landscapeLandmarks(scene: SceneDocument, floor: Floor, input: MapGenerateRequest) {
  if (input.recipe.kind !== 'landscape') return []
  const recipe = input.recipe, source = input.referenceSizePx ?? { width: 1000, height: 1000 }
  const at = mapCoordinate(floor.boundsMm, source, !!input.referenceSizePx)
  const world = publicTerrainView(scene), ground = createSupportQuery(world, floor.id, undefined, false)
  return recipe.landforms.map(form => {
    const atMm = at(form.at), sample = ground.sourceSample(atMm)
    const actualElevationMm = sample?.rootSupportRef.id === form.areaId ? Math.round(sample.zMm) : null
    const nearby = Array.from({ length: 8 }, (_, i) => {
      const angle = i * Math.PI / 4, rotation = form.rotationDeg * Math.PI / 180
      const x = Math.cos(angle) * form.radius.x, y = Math.sin(angle) * form.radius.y
      const p = { x: Math.round(form.at.x + x * Math.cos(rotation) - y * Math.sin(rotation)),
        y: Math.round(form.at.y + x * Math.sin(rotation) + y * Math.cos(rotation)) }
      if (p.x < 0 || p.y < 0 || p.x > source.width || p.y > source.height) return []
      const hit = ground.sourceSample(at(p))
      return hit?.rootSupportRef.id === form.areaId ? [Math.round(hit.zMm)] : []
    }).flat().sort((a, b) => a - b)
    const surroundingElevationMm = nearby.length ? nearby[Math.floor(nearby.length / 2)] : null
    const riseMm = surroundingElevationMm !== null && actualElevationMm !== null ? actualElevationMm - surroundingElevationMm : null
    const issue = form.preserveRelief && (riseMm === null || riseMm <= 0)
      ? '保留的地标未高于周围此块地形。' : recipe.finish === 'natural'
        && (actualElevationMm === null || Math.abs(form.elevationMm - actualElevationMm) > Math.max(450, Math.abs(form.elevationMm) * .19))
        ? `目标高程 ${form.elevationMm} mm，成图 ${actualElevationMm ?? '无有效承托'}${actualElevationMm === null ? '' : ' mm'}。请核对地貌范围或道路填挖。` : undefined
    return { id: form.id, areaId: form.areaId, atMm, targetElevationMm: form.elevationMm, actualElevationMm, surroundingElevationMm, riseMm, issue }
  })
}

/** Validate the saved road against the marked start area and destination.
 * Its full-width surface is separately checked by checkMapRoutes. */
export function checkLandscapeAscents(scene: SceneDocument, floor: Floor, input: MapGenerateRequest, enforce: boolean,
  attempts?: ReadonlyMap<string, LandscapeWidthAttempt[]>) {
  if (input.recipe.kind !== 'landscape') return []
  const bounds = floor.boundsMm, source = input.referenceSizePx ?? { width: 1000, height: 1000 }
  const point = mapCoordinate(bounds, source, !!input.referenceSizePx)
  const scale = input.referenceSizePx && Math.min(bounds.width / source.width, bounds.height / source.height)
  const view = publicTerrainView(scene), ground = createSupportQuery(view, floor.id, undefined, false)
  const forms = input.recipe.landforms
  return input.recipe.routes.flatMap(route => {
    if (!('ascent' in route)) return []
    const { from, toLandmarkId, minRiseMm } = route.ascent
    const minimumWidthMm = route.ascent.minWidthMm ?? route.widthMm
    const marked = point(from.at), radius = { x: Math.round(from.radius.x * (scale || bounds.width / source.width)),
      y: Math.round(from.radius.y * (scale || bounds.height / source.height)) }
    const summit = point(forms.find(form => form.id === toLandmarkId)!.at)
    const path = Object.hasOwn(view.paths, route.id) ? view.paths[route.id] : undefined
    const actualWidthMm = path ? Math.min(path.widthMm, ...(path.widthSections ?? []).map(section => section.widthMm)) : null
    const startMm = path?.centerlineMm[0], endMm = path?.centerlineMm.at(-1), issues: TerrainTravelIssue[] = []
    const issue = (code: string, atMm: PointMm, message: string) => issues.push({ code, entityId: route.id, atMm, message })
    const elevation = (p: PointMm | undefined) => {
      const sample = p && ground.sourceSample(p)
      return sample?.rootSupportRef.kind === 'terrainArea' && sample.rootSupportRef.id === route.areaId ? Math.round(sample.zMm) : null
    }
    const lowElevationMm = elevation(startMm), highElevationMm = elevation(endMm)
    const riseMm = highElevationMm !== null && lowElevationMm !== null ? highElevationMm - lowElevationMm : null
    if (!path?.roadSurface || path.floorId !== floor.id || !startMm || !endMm) {
      issue('ASCENT_MISSING', marked, '低处到地标的连续道路尚未生成。')
    } else {
      if (Math.hypot((startMm.x - marked.x) / Math.max(1, radius.x), (startMm.y - marked.y) / Math.max(1, radius.y)) > 1.002
        || lowElevationMm === null) issue('ASCENT_START', startMm, '道路起点未落在标记低处的有效承托面内。')
      if (endMm.x !== summit.x || endMm.y !== summit.y || highElevationMm === null) issue('ASCENT_END', endMm, '道路终点未接至标记的高处地标。')
      if (riseMm === null || riseMm < minRiseMm) issue('ASCENT_RISE', startMm, `低处到终点实际高差 ${riseMm ?? '未知'} mm，目标至少 ${minRiseMm} mm。`)
      if (actualWidthMm! < minimumWidthMm) {
        issue('ASCENT_WIDTH', startMm, `连续道路净宽 ${actualWidthMm} mm，要求至少 ${minimumWidthMm} mm。`)
      }
      if (route.around) {
        const landmark = point(forms.find(form => form.id === route.around!.landmarkId)!.at)
        if (!reachesLandmarkSide(path.centerlineMm, landmark, route.around.side)) {
          issue('ASCENT_SIDE', landmark, '实际道路未经过地标指定的绕行侧。')
        }
      }
      const approach = checkGradedRoadOnValidScene(view, path, ASCENT_APPROACH_MM)
      if (!approach.ok) issues.push(...approach.issues)
    }
    if (issues.length && enforce) throw new OperationRejected('invalid_geometry', `「${route.id}」：${issues.map(row => row.message).join('；')}`)
    const rejected = attempts?.get(route.id)
    const reduction = actualWidthMm !== null && actualWidthMm < route.widthMm ? {
      message: rejected?.length
        ? `首选 ${route.widthMm / 1000} 米净宽未通过选路，按允许范围采用 ${actualWidthMm / 1000} 米。`
        : `保存的道路净宽为 ${actualWidthMm / 1000} 米，首选为 ${route.widthMm / 1000} 米。`,
      ...(rejected?.length ? { rejected } : {}),
    } : undefined
    return [{ id: route.id, ok: issues.length === 0, required: true as const, toLandmarkId, startMm, endMm,
      lowElevationMm, highElevationMm, riseMm, minRiseMm, preferredWidthMm: route.widthMm, minimumWidthMm, actualWidthMm,
      ...(reduction ? { reduction } : {}), approachMm: ASCENT_APPROACH_MM, issues }]
  })
}
