import { z } from 'zod'
import { prepareNaturalVolcanoProject } from '../../../application/workspace/natural-volcano.js'
import { prepareCatalogAdoption, materializeProject } from '../../../application/workspace/prepare.js'
import { applyCompositionCommands } from '../../../shared/appearance/commands.js'
import { selectManualTransactionBudget } from '../../../shared/budget/command-budget.js'
import { createBasePlacedProp } from '../../../shared/commands/base.js'
import { furnitureBoundsPolygon } from '../../../shared/generation/domains/interior/furnishing-poses.js'
import { connectionFootprint, pathPolygon, polygonDistance, polygonsOverlap, propFootprint, supportedPolygon, terrainPoints } from '../../../shared/geometry/geometry.js'
import { assertTerrainConnectionClearances, checkTerrainRoute } from '../../../shared/geometry/terrain-travel.js'
import { prepareLibraryEntries } from '../../../shared/library/content.js'
import type { CompositionContent } from '../../../shared/model/appearance.js'
import type { PointMm, SurfaceRef } from '../../../shared/model/scene.js'
import { reviseCompositionContent } from '../../../shared/validation/content.js'
import type { SceneCommand } from '../../../shared/commands/commands.js'
import { selectTaskBudget } from '../../../shared/budget/task-budget.js'
import { captureJson } from '../../../shared/validation/json.js'
import { runtime, validation } from '../runtime.js'
import { createVolcanicSurfacesCatalogDocument, VOLCANIC_SURFACES_BATCH } from './volcanic-surfaces-catalog.js'
import { materializeVisualArtBatches } from './visual-art-project.js'
import { loadBuiltinCatalog } from './builtin.js'

const optionsSchema = z.object({ title: z.string().trim().min(1).max(120).default('灰脊火口 · 自然岩坡与熔岩池'),
  sceneId: z.string().min(1).max(120).refine(value => value !== '__proto__').optional(), now: z.string().datetime().optional(),
  widthMm: z.number().int().min(30000).max(200000).default(50000),
  heightMm: z.number().int().min(24000).max(200000).default(38000),
  seed: z.string().min(1).max(90).default('ashridge-natural-crater-1'),
}).strict()
export type NaturalVolcanoOptions = z.input<typeof optionsSchema>

/** Demand-loaded, editable new creation. It never reads or writes the user DB. */
export async function createNaturalVolcanoCandidate(signal?: AbortSignal, raw: NaturalVolcanoOptions = {}) {
  signal?.throwIfAborted()
  const options = optionsSchema.parse(captureJson(raw)), now = options.now ?? runtime.clock.now()
  const document = createVolcanicSurfacesCatalogDocument({ sceneId: options.sceneId ?? runtime.ids.nextId(), now })
  const bounds = { x: 0, y: 0, width: options.widthMm, height: options.heightMm }
  Object.values(document.floors)[0].boundsMm = { ...bounds }
  document.exportBoundsMm = { ...bounds }; document.title = options.title
  Object.values(document.userLayers)[0].name = '火山真实地形、路线与岩层细节'
  document.presetSnapshot.source = 'Sceneweave 自然火山独立新建；真实低火口、可编辑岩阶和显式危险区；待用户美术签收'
  const base = await materializeVisualArtBatches(document, [VOLCANIC_SURFACES_BATCH], signal)
  signal?.throwIfAborted()
  const profile = selectTaskBudget({ task: 'generation', widthMm: bounds.width, heightMm: bounds.height, quality: 'standard', device: 'expanded' })
  const candidate = await prepareNaturalVolcanoProject(base, { runtime, validation: { ...validation, signal }, signal, profile,
    seed: options.seed, nowMilliseconds: () => Math.floor(performance.now()) })
  signal?.throwIfAborted()
  const donor = await loadBuiltinCatalog({ ...validation, signal })
  const entries = await prepareLibraryEntries(donor, [{ kind: 'prop', definitionId: 'content-p-basalt-boulder' },
    { kind: 'prop', definitionId: 'content-p-volcanic-crack' }], { ...validation, signal })
  const adopted = await prepareCatalogAdoption(candidate.project, entries, { runtime, validation: { ...validation, signal }, signal })
  const source = adopted.project, floorId = candidate.profile.input.parameters.floorId, layerId = candidate.profile.input.parameters.layerId
  const content: CompositionContent = { document: source.document, historyIdentity: source.historyIdentity, appearance: source.appearance }
  // Pose search owns only this detached props record. It cannot certify or
  // publish a project; all 24 additions still cross one normal transaction.
  const placementDocument = { ...source.document, props: { ...source.document.props } }
  const placementCommands: SceneCommand[] = []
  const at = (x: number, y: number): PointMm => ({ x: Math.round(bounds.width * x / 50000), y: Math.round(bounds.height * y / 38000) })
  const platform = terrainPoints(source.document.terrainAreas[candidate.generated.report.platformAreaId])
  const reservations = [platform, ...Object.values(source.document.paths).map(pathPolygon), ...Object.values(source.document.terrainConnections).map(connectionFootprint)]
  const placements: { id: string; kind: string; requestedMm: PointMm; positionMm: PointMm; rotationDeg: number; supportRef: SurfaceRef }[] = []
  const place = (kind: 'basalt-boulder' | 'volcanic-crack', index: number, x: number, y: number, rotation: number, areaId: string) => {
    signal?.throwIfAborted()
    const document = placementDocument, id = `natural-volcano-${kind}-${index}`, definition = document.propDefinitions[`content-p-${kind}`]
    const supportRef: SurfaceRef = { kind: 'terrainArea', id: areaId }, requestedMm = at(x, y)
    const detached = createBasePlacedProp(document, definition.id, requestedMm, runtime, { id, floorId, supportRef })
    const offsets = [[0, 0], [-450, 0], [450, 0], [0, -450], [0, 450], [-900, -450], [900, 450], [-900, 450], [900, -450], [0, -1000], [0, 1000],
      [-1500, -1200], [1500, 1200], [-1500, 1200], [1500, -1200], [-2200, 0], [2200, 0]]
    for (const rotationDeg of [rotation, (rotation + 90) % 360, (rotation + 270) % 360, (rotation + 180) % 360]) for (const [dx, dy] of offsets) {
      const offset = at(dx, dy), positionMm = { x: requestedMm.x + offset.x, y: requestedMm.y + offset.y }, prop = { ...detached, positionMm, rotationDeg }
      const physical = propFootprint(prop), painted = furnitureBoundsPolygon(prop.visualBoundsMm, prop)
      if (!supportedPolygon(document, physical, supportRef, floorId) || !supportedPolygon(document, painted, supportRef, floorId)) continue
      if (reservations.some(polygon => polygonDistance(physical, polygon) < 150 || polygonsOverlap(painted, polygon))) continue
      if (Object.values(document.props).some(other => polygonDistance(physical, propFootprint(other)) < 100
        || polygonsOverlap(painted, furnitureBoundsPolygon(other.visualBoundsMm, other)))) continue
      placementCommands.push({ type: 'addProp', id, floorId, layerId,
        definitionRef: { id: definition.id, version: definition.version }, supportRef, positionMm, rotationDeg })
      document.props[id] = prop
      placements.push({ id, kind, requestedMm, positionMm, rotationDeg, supportRef }); return
    }
    throw new Error(`自然火山布景不能在完整支撑、路线和活动区外安全落位：${id}`)
  }
  const report = candidate.generated.report
  const ground = [[5500, 6000, 15], [7800, 6700, 70], [3800, 8200, 210], [7000, 32400, 45], [10100, 34200, 170]]
  const shoulder = [[19000, 8000, 15], [21400, 8500, 70], [23500, 7200, 210], [43000, 15100, 40], [41800, 25000, 130],
    [40000, 29000, 250], [28600, 30100, 30], [31100, 30900, 80], [34300, 29200, 160], [35800, 31100, 250]]
  const crater = [[29200, 11900, 25], [32700, 10400, 110], [38800, 14200, 220], [38400, 20700, 50], [33200, 23000, 190]]
  const cracks = [[29900, 19900, 30], [31000, 11900, 5], [38100, 18400, 80], [31000, 22600, 15]]
  let index = 0
  for (const [poses, areaId] of [[ground, report.groundAreaId], [shoulder, report.mountainAreaId], [crater, report.craterAreaId]] as const) {
    for (const [x, y, rotation] of poses) place('basalt-boulder', ++index, x, y, rotation, areaId)
  }
  for (const [x, y, rotation] of cracks) place('volcanic-crack', ++index, x, y, rotation, report.craterAreaId)
  const budget = selectManualTransactionBudget(content.document)
  const edited = applyCompositionCommands(content, placementCommands, runtime, { budget })
  for (const pathId of candidate.generated.report.pathIds) {
    const path = edited.document.paths[pathId]
    if (!checkTerrainRoute(edited.document, { floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }).ok) {
      throw new Error('自然火山布景事务未保留完整路线净宽与真实支撑。')
    }
  }
  assertTerrainConnectionClearances(edited.document, candidate.fixtures)
  const revised = reviseCompositionContent(edited, source.document.revision + 1, now)
  const project = await materializeProject({ ...source, ...revised }, { runtime, validation: { ...validation, signal }, signal, baseline: source, budget })
  signal?.throwIfAborted()
  return { ...candidate, project, placements }
}
export async function createNaturalVolcanoProject(signal?: AbortSignal, options: NaturalVolcanoOptions = {}) {
  return (await createNaturalVolcanoCandidate(signal, options)).project
}
