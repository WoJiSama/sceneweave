import type { AppearanceGraph } from '../model/appearance.js'
import { geometryIdentityIds } from '../commands/domain.js'
import type { SceneCommand } from '../commands/commands.js'
import { terrainPoints } from '../geometry/geometry.js'
import { polygonBooleanWithHoles } from '../geometry/polygon-boolean.js'
import type { DecorationCluster, SceneDocument, SurfaceRuleField, SurfaceRuleRegion } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { TERRAIN_VARIANT_SPECS } from '../visual/terrain-variant-specs.js'
import { SHORE_MATERIAL_IDS } from '../visual/shore-art.js'
import { buildDecorationRegeneration, estimateSurfaceRegionInstances } from './generate.js'
import { buildIslandDressingCommandsV2, ISLAND_DRESSING_PRESET_V2 } from './island-dressing.js'

export const ISLAND_SURFACE_DRESSING_PRESET_V1 = 'island-surface-dressing@1' as const

const PLANTS = [
  { field: 'trees', key: 'tree-wind-oak', target: 2, spacingMm: 900, clusterRadiusMm: 2500 },
  { field: 'shrubs', key: 'shrub-heath-mound', target: 4, spacingMm: 350, clusterRadiusMm: 350 },
  { field: 'grass', key: 'grass-sedge-fan', target: 5, spacingMm: 250, clusterRadiusMm: 250 },
] as const satisfies readonly { field: Exclude<SurfaceRuleField, 'material'>; key: string; target: number; spacingMm: number; clusterRadiusMm: number }[]

type UpdateStair = Extract<SceneCommand, { type: 'updateTerrainConnection' }>
type PlantChannel = Exclude<SurfaceRuleField, 'material'>
type PreparedPlant = { field: PlantChannel; key: string; target: number; spacingMm: number; clusterRadiusMm: number; palette: DecorationCluster['palette']; regionsMm: SurfaceRuleRegion[]; density: { coveragePpm: number; count: number } }

const hasV2Route = (scene: SceneDocument) => Object.values(scene.terrainConnections).filter(connection =>
  connection.route?.segments.some(segment => segment.id.startsWith('island-dressing-v2-')))

function hasManualIslandRoute(scene: SceneDocument): boolean {
  const generation = getLegacyGeneration(scene)
  const islandAreaIds = new Set(Object.values(generation?.rules ?? {}).flatMap(rule => {
    const recipe = generation!.recipes[rule.recipeRef.id]
    return rule.kind === 'terrain' && recipe?.algorithmId === 'terrain-scene' && recipe.algorithmVersion === 5
      && recipe.recipeVersion === 5 && rule.recipeRef.version === 5 && recipe.parameters.terrainKind === 'island'
      ? rule.outputs.filter(ref => ref.kind === 'terrainArea' && ref.parentId === null).map(ref => ref.entityId) : []
  }))
  return Object.values(scene.terrainConnections).some(connection => connection.kind === 'stairs' && connection.route
    && !connection.route.segments.some(segment => segment.id.startsWith('island-dressing-v2-'))
    && connection.from.surfaceRef.kind === 'terrainArea' && connection.to.surfaceRef.kind === 'terrainArea'
    && islandAreaIds.has(connection.from.surfaceRef.id) && islandAreaIds.has(connection.to.surfaceRef.id))
}

function reserveCommandIds(commands: readonly SceneCommand[], reserved: Set<string>): void {
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (!Array.isArray(value)) {
      const row = value as Record<string, unknown>
      if (typeof row.id === 'string') reserved.add(row.id)
      if (typeof row.segmentId === 'string') reserved.add(row.segmentId)
    }
    for (const child of Object.values(value)) visit(child)
  }
  commands.forEach(visit)
}

function nextUniqueId(nextId: () => string, reserved: Set<string>): string {
  const value = nextId()
  if (!value || value === '__proto__' || reserved.has(value)) throw new Error('岩岛地表规则需要未分配的独立ID。')
  reserved.add(value)
  return value
}

function exactCoverage(scene: SceneDocument, palette: DecorationCluster['palette'], regions: SurfaceRuleRegion[], target: number, field: string): { coveragePpm: number; count: number } {
  const polygons = regions.map(region => ({ outer: region.outerMm, holes: region.holesMm }))
  const estimate = (coveragePpm: number) => estimateSurfaceRegionInstances(scene, palette, { polygons, coveragePpm })
  let low = 1, high = 1_000_000, best = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    let count: number
    try { count = estimate(mid) } catch { count = Number.POSITIVE_INFINITY }
    if (count > 0 && count <= target) { best = mid; low = mid + 1 } else if (count === 0) low = mid + 1
    else high = mid - 1
  }
  if (best > 0) return { coveragePpm: best, count: estimate(best) }
  throw new Error(`岩岛${field}规则范围不足：无法在目标${target}件内生成至少一件。`)
}

function uncoveredRegions(scene: SceneDocument, crown: SceneDocument['terrainAreas'][string], field: SurfaceRuleField): SurfaceRuleRegion[] {
  const covered = Object.values(scene.surfaceRules ?? {}).filter(rule => rule.supportRef.id === crown.id && rule.field === field && rule.visibility === 'public')
    .sort((a, b) => a.paintOrder - b.paintOrder || a.id.localeCompare(b.id))
    .flatMap(rule => rule.regionsMm.map(region => ({ outer: region.outerMm, holes: region.holesMm })))
  const remaining = polygonBooleanWithHoles({ operation: 'difference',
    subject: [{ outer: terrainPoints(crown), holes: [] }], clip: covered }).polygons
  const regions = remaining.map(polygon => ({ outerMm: polygon.outer, holesMm: polygon.holes }))
  if (regions.length > 128 || regions.some(region => region.outerMm.length > 512 || region.holesMm.some(hole => hole.length > 512))) {
    throw new Error(`岩岛${field}规则可用区域超出有限边界预算。`)
  }
  return regions
}

function simulationContext(prefix: string): PreparationContext {
  let serial = 0
  return { ids: { nextId: () => `${prefix}-${++serial}` }, clock: { now: () => '2000-01-01T00:00:00.000Z' } }
}

function applySimulatedGeneration(scene: SceneDocument, cluster: DecorationCluster, layerId: string, generated: ReturnType<typeof buildDecorationRegeneration>): void {
  for (const row of generated.props) {
    scene.props[row.id] = row
    scene.entityLayers[row.id] = layerId
  }
  for (const row of generated.decorations) {
    scene.decorations![row.id] = row
    scene.entityLayers[row.id] = layerId
  }
  scene.decorationClusters![cluster.id] = generated.cluster
  scene.entityLayers[cluster.id] = layerId
}

function previewBaseCommands(scene: SceneDocument, commands: SceneCommand[], appearance: AppearanceGraph): SceneDocument {
  const preview = cloneJson(scene)
  for (const command of commands) {
    if (command.type === 'updateTerrainConnection') {
      Object.assign(preview.terrainConnections[command.id], cloneJson(command.changes))
    } else if (command.type === 'createDecorationCluster') {
      const { type: _type, layerId, ...fields } = command
      const cluster: DecorationCluster = { ...cloneJson(fields), editLocked: false, algorithmVersion: 'cluster-v1', members: {} }
      const generated = buildDecorationRegeneration(preview, cluster, simulationContext(`island-preview-lower-${cluster.id}`), appearance)
      if (!generated.props.length && !generated.decorations.length) throw new Error('岩岛下层簇在真实支撑与障碍约束下没有可生成成员。')
      applySimulatedGeneration(preview, cluster, layerId, generated)
    }
  }
  return preview
}

function clusterBounds(regions: SurfaceRuleRegion[]): DecorationCluster['boundsMm'] {
  const points = regions.flatMap(region => region.outerMm)
  const xs = points.map(point => point.x), ys = points.map(point => point.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

function selectSeedWithMembers(preview: SceneDocument, fixed: PreparedPlant, clusterId: string, supportId: string, layerId: string, sourceHash: string, appearance: AppearanceGraph, allowEmpty: boolean): string | null {
  const support = preview.terrainAreas[supportId]
  if (!support) throw new Error('岩岛植被预演缺少真实高台支撑。')
  let best: { seed: string; cluster: DecorationCluster; generated: ReturnType<typeof buildDecorationRegeneration>; count: number } | undefined
  for (let trial = 0; trial < 24; trial++) {
    const seed = `${ISLAND_SURFACE_DRESSING_PRESET_V1}/${fixed.field}/${sourceHash}/${trial}`
    const cluster: DecorationCluster = { id: clusterId, floorId: support.floorId,
      editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: supportId },
      boundsMm: clusterBounds(fixed.regionsMm), algorithmVersion: 'cluster-v1', seed, palette: cloneJson(fixed.palette), spacingMm: fixed.spacingMm,
      clusterRadiusMm: fixed.clusterRadiusMm, clearanceMm: 400, maxInstances: 64, members: {} }
    const generated = buildDecorationRegeneration(preview, cluster, simulationContext(`island-preview-${fixed.field}-${trial}`), appearance,
      { polygons: fixed.regionsMm.map(region => ({ outer: region.outerMm, holes: region.holesMm })), coveragePpm: fixed.density.coveragePpm })
    const count = generated.props.length + generated.decorations.length
    if (!best || count > best.count) best = { seed, cluster, generated, count }
    if (count >= fixed.density.count) break
  }
  if (!best || !best.count) {
    if (allowEmpty) return null
    throw new Error(`岩岛${fixed.field}规则在真实支撑、完整足迹及现有障碍约束下没有可生成成员的seed。`)
  }
  applySimulatedGeneration(preview, best.cluster, layerId, best.generated)
  return best.seed
}

/** V8-only island dressing that retains v2 physical and route outputs but stores crown ground and plants as editable surface rules. */
export function buildIslandSurfaceDressingCommandsV1(scene: SceneDocument, options: { nextId: () => string; appearance: AppearanceGraph }): {
  version: typeof ISLAND_SURFACE_DRESSING_PRESET_V1
  sourceHash: string
  commands: SceneCommand[]
  report: string
} {
  if (scene.schemaVersion !== 8 || scene.mapMode !== 'scene') throw new Error('岩岛连续地表布景需要完整v8场景。')
  if (hasIslandSurfaceDressingV1(scene)) throw new Error('此岩岛已应用连续地表布景配方；请编辑现有区域规则，不能重复追加。')

  // V2 owns the real island source, natural-rock route, edge treatment and lower cluster.
  // Its strict eligibility ends at v7, so only the disposable read view is downgraded.
  const v2View: SceneDocument = { ...cloneJson(scene), schemaVersion: 7 }
  const priorV2Routes = hasV2Route(scene)
  if (priorV2Routes.length > 1) throw new Error('岩岛包含多个既有v2生成路线，无法确定布景连接。')
  if (!priorV2Routes.length && hasManualIslandRoute(scene)) throw new Error('岩岛楼梯已有人工路线，请保留并单独编辑，不能由自动布景覆盖。')
  if (priorV2Routes.length === 1) {
    const connection = v2View.terrainConnections[priorV2Routes[0].id]
    const endpointIds = [connection.from.surfaceRef.id, connection.to.surfaceRef.id]
    const crownId = endpointIds.sort((a, b) => (scene.terrainAreas[b]?.groundElevationMm ?? -Infinity) - (scene.terrainAreas[a]?.groundElevationMm ?? -Infinity))[0]
    const generatedKeys = new Set(PLANTS.map(plant => TERRAIN_VARIANT_SPECS.find(row => row.key === plant.key)?.definitionId))
    for (const [id, prop] of Object.entries(v2View.props)) if (prop.supportRef?.kind === 'terrainArea' && prop.supportRef.id === crownId
      && prop.definitionRef && generatedKeys.has(prop.definitionRef.id)) {
      delete v2View.props[id]
      delete v2View.entityLayers[id]
    }
    delete v2View.terrainConnections[priorV2Routes[0].id].route
    // The prior v2 transaction marks its touched legacy output fields manual
    // and pauses their generator. Restore activity only in this disposable
    // source-selection view; the returned v8 candidate never writes it back.
    const generation = getLegacyGeneration(v2View)
    const sourceRules = Object.values(generation?.rules ?? {}).filter(rule => {
      const recipe = generation!.recipes[rule.recipeRef.id]
      return rule.kind === 'terrain' && recipe?.algorithmId === 'terrain-scene' && recipe.algorithmVersion === 5
        && recipe.recipeVersion === 5 && rule.recipeRef.version === 5 && recipe.parameters.terrainKind === 'island'
    })
    if (sourceRules.length === 1 && sourceRules[0].state === 'paused') sourceRules[0].state = 'active'
  }
  const v2 = buildIslandDressingCommandsV2(v2View, options)
  const stairCommand = v2.commands.find((command): command is UpdateStair => command.type === 'updateTerrainConnection')
  const plantCommands = v2.commands.filter((command): command is Extract<SceneCommand, { type: 'addProp' }> => command.type === 'addProp')
  if (!stairCommand || !plantCommands.length) throw new Error('岩岛v2候选缺少真实楼梯或高台支撑来源。')
  if (priorV2Routes.length && priorV2Routes[0].id !== stairCommand.id) throw new Error('既有v2岩岛路线不属于当前真实高台连接。')

  const crownId = plantCommands[0].supportRef?.id
  const crown = crownId ? scene.terrainAreas[crownId] : undefined
  const stair = scene.terrainConnections[stairCommand.id]
  if (!crown || !stair || stair.from.surfaceRef.id === crown.id && stair.to.surfaceRef.id === crown.id) throw new Error('岩岛高台规则缺少明确的楼梯支撑面。')
  const lowerId = stair.from.surfaceRef.id === crown.id ? stair.to.surfaceRef.id : stair.from.surfaceRef.id
  const lower = scene.terrainAreas[lowerId]
  if (!lower) throw new Error('岩岛楼梯未连接现存下层主岩面。')
  const route = stair.route ?? stairCommand.changes.route
  if (!route) throw new Error('岩岛v2候选缺少确定性自然岩阶路线。')

  const materialRegions = uncoveredRegions(scene, crown, 'material')
  const grass = scene.materials[SHORE_MATERIAL_IDS.grass]
  if (materialRegions.length && (!grass || grass.version !== 1 || !grass.applicableSurfaces.includes('terrain'))) {
    throw new Error('岩岛连续布景缺少固定草地材质：shore-v1-material-grass@1。')
  }
  const materialPaint = materialRegions.length ? { materialRef: { id: grass.id, version: grass.version }, tileSizeMm: cloneJson(grass.defaultTileSizeMm),
    rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 } : null
  const groundDescription = materialPaint ? '铺设连续草地底材（320mm过渡）' : '保留已有地表材质规则'
  const fixed: PreparedPlant[] = []
  for (const plant of PLANTS) {
    const spec = TERRAIN_VARIANT_SPECS.find(row => row.key === plant.key)
    const definition = spec && scene.propDefinitions[spec.definitionId]
    if (!spec || !definition || definition.version !== 1) throw new Error(`岩岛连续布景缺少固定素材：${plant.key}。`)
    const field = plant.field
    const palette: DecorationCluster['palette'] = [{ key: spec.key, definitionRef: { id: definition.id, version: definition.version }, kind: field === 'trees' ? 'prop' : 'decoration', weight: 1 }]
    const regionsMm = uncoveredRegions(scene, crown, field)
    if (!regionsMm.length) continue
    let density: PreparedPlant['density']
    try { density = exactCoverage(scene, palette, regionsMm, plant.target, field) }
    catch (error) {
      const hasExistingRule = Object.values(scene.surfaceRules ?? {}).some(rule => rule.supportRef.id === crown.id && rule.field === field && rule.visibility === 'public')
      if (hasExistingRule) continue
      throw error
    }
    fixed.push({ ...plant, palette, regionsMm, density })
  }
  const sourceHash = sha256Text(canonicalJson({
    preset: ISLAND_SURFACE_DRESSING_PRESET_V1,
    basePreset: ISLAND_DRESSING_PRESET_V2,
    crown: { id: crown.id, boundaryMm: crown.boundaryMm },
    lower: { id: lower.id, boundaryMm: lower.boundaryMm },
    stair: { id: stair.id, from: stair.from, to: stair.to, widthMm: stair.widthMm, route },
    ground: materialPaint ? { regionsMm: materialRegions, paint: materialPaint, blendWidthMm: 320 } : null,
    variants: fixed.map(plant => ({ field: plant.field, key: plant.key, regionsMm: plant.regionsMm })),
  }))

  const reserved = geometryIdentityIds(scene)
  reserveCommandIds(v2.commands, reserved)
  const retained = priorV2Routes.length ? [] : v2.commands.filter(command => command.type !== 'addProp')
  const lowerClusters = retained.filter(command => command.type === 'createDecorationCluster')
  const beforeVegetation = retained.filter(command => command.type !== 'createDecorationCluster')
  const preview = previewBaseCommands(scene, beforeVegetation, options.appearance)
  const ruleCommands: SceneCommand[] = []
  const addedPlantFields: string[] = [], emptyPlantFields: string[] = []
  if (materialPaint) ruleCommands.push({ type: 'paintSurfaceMaterial', id: nextUniqueId(options.nextId, reserved), floorId: crown.floorId,
    layerId: scene.entityLayers[crown.id], visibility: 'public', supportRef: { kind: 'terrainArea', id: crown.id }, regionsMm: materialRegions,
    paint: materialPaint, blendWidthMm: 320 })
  for (const plant of fixed) {
    const id = nextUniqueId(options.nextId, reserved), clusterId = nextUniqueId(options.nextId, reserved)
    const hasExistingRule = Object.values(scene.surfaceRules ?? {}).some(rule => rule.supportRef.id === crown.id && rule.field === plant.field && rule.visibility === 'public')
    const seed = selectSeedWithMembers(preview, plant, clusterId, crown.id, scene.entityLayers[crown.id], sourceHash, options.appearance, priorV2Routes.length > 0 || hasExistingRule)
    if (!seed) { emptyPlantFields.push(plant.field); continue }
    ruleCommands.push({ type: 'paintSurfaceVegetation', id, clusterId, floorId: crown.floorId, layerId: scene.entityLayers[crown.id], visibility: 'public',
      supportRef: { kind: 'terrainArea', id: crown.id }, regionsMm: plant.regionsMm, field: plant.field, coveragePpm: plant.density.coveragePpm,
      seed, palette: plant.palette, spacingMm: plant.spacingMm, clusterRadiusMm: plant.clusterRadiusMm, clearanceMm: 400 })
    addedPlantFields.push(`${plant.field}目标${plant.density.count}件`)
  }
  // Generate high-ground rules before the lower cluster. Both supports share a
  // floor and overlap in map coordinates, while their physical elevations do not.
  previewBaseCommands(preview, lowerClusters, options.appearance)
  const commands = [...beforeVegetation, ...ruleCommands, ...lowerClusters]
  const plantReport = addedPlantFields.length ? `新增植被规则：${addedPlantFields.join('、')}` : '本次未新增植被规则'
  const emptyReport = emptyPlantFields.length ? `；${emptyPlantFields.join('、')}区域无可用候选，跳过新规则并保留已有规则及成员` : ''
  return { version: ISLAND_SURFACE_DRESSING_PRESET_V1, sourceHash, commands,
    report: `高台未覆盖区域${groundDescription}；${plantReport}${emptyReport}；已有区域规则保留并从对应新规则中扣除。下层簇、自然岩阶路线与崖缘处理复用既有v2候选。所有操作在同一候选中检查并一次采用或撤销。` }
}

export function hasIslandSurfaceDressingV1(scene: SceneDocument): boolean {
  return Object.values(scene.decorationClusters ?? {}).some(cluster => cluster.seed.startsWith(`${ISLAND_SURFACE_DRESSING_PRESET_V1}/`))
}
