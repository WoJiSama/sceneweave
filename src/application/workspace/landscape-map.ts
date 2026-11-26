import { createCompositionContent } from '../../shared/appearance/graph.js'
import { assertTaskBudget, captureExecutionBudget, captureGeometryPairBudget, measureDocumentBudget, measureTaskBudget, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import type { MapGenerateRequest, MapLandscapeRecipe } from '../../shared/generation/map-authoring.js'
import type { Floor, PointMm } from '../../shared/model/scene.js'
import { shapeLandscape, LANDSCAPE_VERSION } from '../../shared/terrain-generation/landscape-authoring.js'
import { finishLandscape, landscapeRouteClearances } from '../../shared/terrain-generation/landscape-finish.js'
import { withGeometryPairCounter } from '../../shared/geometry/edge-index.js'
import { createSupportQuery } from '../../shared/geometry/support-sample.js'
import { publicTerrainView } from '../../shared/geometry/visibility.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import type { LandscapeRoadFailure } from '../../shared/terrain-generation/landscape-authoring.js'
import { captureJson } from '../../shared/validation/json.js'
import { newMapArtStyle } from '../../shared/visual/art-style.js'
import { OperationRejected } from '../../shared/validation/operation-rejection.js'
import { validateSceneSnapshot } from '../../shared/validation/snapshots.js'
import { materializeProject, type PrepareOptions } from './prepare.js'
import type { EditableProject } from './project.js'
import { mapCoordinate } from './map-authoring.js'

export async function prepareLandscapeMap(base: EditableProject, floor: Floor, input: MapGenerateRequest, recipe: MapLandscapeRecipe,
  options: PrepareOptions & { budget: TaskBudgetProfile }, draft = false) {
  const { boundsMm: bounds } = floor, { referenceSizePx: reference, seed } = input
  const source = reference ?? { width: 1000, height: 1000 }
  const scale = reference && Math.min(bounds.width / source.width, bounds.height / source.height)
  const size = ({ x, y }: PointMm) => ({ x: Math.round(x * (scale || bounds.width / source.width)),
    y: Math.round(y * (scale || bounds.height / source.height)) })
  const point = mapCoordinate(bounds, source, !!reference), frame = { point, size }
  const scene = captureJson(base.document), meter = captureExecutionBudget(options.budget)
  const roadFailures: LandscapeRoadFailure[] = []
  scene.artStyle = { ...newMapArtStyle(), active: recipe.style }
  meter.charge({ candidateAttempts: 1 })
  const pairs = captureGeometryPairBudget(options.budget)
  const checked = withGeometryPairCounter(pairs.add, () => {
    const forms = shapeLandscape(scene, floor, recipe, frame, seed, meter, draft ? roadFailures : undefined)
    finishLandscape(scene, floor, recipe, forms, frame, seed, meter, landscapeRouteClearances(input.checks, floor, point))
    return validateSceneSnapshot(scene)
  })
  if (!checked.ok) throw new OperationRejected('invalid_geometry', checked.errors.slice(0, 10)
    .map(issue => `${issue.entityId ? `「${issue.entityId}」` : ''}${issue.message}`).join('；'))
  const content = createCompositionContent(checked.document, options.runtime)
  const project = await materializeProject({ ...base, ...content }, { ...options, baseline: base, terrainPairAccounting: 'spatial-v1' })
  const execution = meter.snapshot()
  const usage = assertTaskBudget(options.budget, measureTaskBudget(base.document, project.document, { before: base, after: project },
    { ...execution, intersectionPairs: execution.intersectionPairs + pairs.count() }, 'spatial-v1'))
  return { project, usage, roadFailures, report: { algorithmVersion: LANDSCAPE_VERSION, seed, environment: recipe.environment, style: recipe.style, density: recipe.density,
    geometryWork: { model: 'spatial-v1', previousEstimate: measureDocumentBudget(base.document, project.document).intersectionPairs,
      checkedPairs: pairs.count(), generationPairAllowance: execution.intersectionPairs, billedPairs: usage.intersectionPairs },
    zones: recipe.landforms.map(row => ({ id: row.id, areaId: row.areaId, at: point(row.at), targetElevationMm: row.elevationMm })),
    scenery: recipe.scenery.map(row => {
      const group = project.document.scatterGroups[row.id]
      return { id: row.id, areaId: row.areaId, palette: row.palette, pattern: row.pattern, density: row.density,
        placed: Object.values(group.members).filter(member => member.propId !== null).length,
        reservedZones: group.exclusions.map(({ id, boundaryMm }) => ({ id, boundaryMm })) }
    }),
    scale: reference ? { source, mmPerPixel: scale, contentOriginMm: point({ x: 0, y: 0 }), canvasMm: bounds }
      : { source: 'relative', canvasMm: bounds } } }
}

export function landscapeLandmarks(scene: SceneDocument, floor: Floor, input: MapGenerateRequest) {
  if (input.recipe.kind !== 'landscape') return []
  const source = input.referenceSizePx ?? { width: 1000, height: 1000 }
  const at = mapCoordinate(floor.boundsMm, source, !!input.referenceSizePx)
  const world = publicTerrainView(scene), ground = createSupportQuery(world, floor.id, undefined, false)
  return input.recipe.landforms.map(form => {
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
    return { id: form.id, areaId: form.areaId, atMm, targetElevationMm: form.elevationMm, actualElevationMm, surroundingElevationMm, riseMm,
      ...(form.preserveRelief && (riseMm === null || riseMm <= 0) ? { issue: '保留的地标未高于周围此块地形。请核对高程、范围或附近的坡面。' } : {}) }
  })
}
