import type { DecorationCluster, SceneDocument, SurfaceRuleRegion, TerrainArea } from '../model/scene.js'
import type { ExecutionBudget } from '../budget/task-budget.js'
import { buildDecorationRegeneration } from '../decorations/generate.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../geometry/polygon-boolean.js'
import { terrainPoints } from '../geometry/geometry.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { terrainVariantDefinitionId } from '../visual/terrain-variant-specs.js'
import { SHORE_MATERIAL_IDS } from '../visual/shore-art.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'

/** These defaults belong only to terrain recipe6. Saved rules remain ordinary
 * editable current rules; changing a future recipe must use another selector. */
export const AUTOMATIC_SURFACE_RECIPE6 = Object.freeze([
  { field: 'trees' as const, key: 'tree-wind-oak', coveragePpm: 300_000, spacingMm: 650, radiusMm: 1700 },
  { field: 'shrubs' as const, key: 'shrub-heath-mound', coveragePpm: 75_000, spacingMm: 280, radiusMm: 1200 },
  { field: 'grass' as const, key: 'grass-sedge-fan', coveragePpm: 80_000, spacingMm: 120, radiusMm: 950 },
])
const regions = (polygons: PolygonWithHoles[]): SurfaceRuleRegion[] => polygons.map(row => ({ outerMm: row.outer, holesMm: row.holes }))
const ring = (area: TerrainArea): PolygonWithHoles[] => [{ outer: terrainPoints(area), holes: [] }]
const bounds = (polygons: PolygonWithHoles[]) => {
  const points = polygons.flatMap(row => row.outer), xs = points.map(p => p.x), ys = points.map(p => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const isGrassMaterial = (scene: SceneDocument, id: string) => id === SHORE_MATERIAL_IDS.grass
  || /grass|moss|草|苔/i.test([id, ...(scene.materials[id]?.tags ?? [])].join(' '))
const isWaterMaterial = (scene: SceneDocument, id: string) => /water|sea|ocean|lake|river|浅水|水面|水域/i.test([id, ...(scene.materials[id]?.tags ?? [])].join(' '))

/** New-candidate construction only. It never regenerates or overwrites an
 * adopted scene. All geometry, physical support and privacy stay in place. */
export function addAutomaticSurfaceRules6(input: SceneDocument, seed: string, meter: ExecutionBudget): SceneDocument {
  if (input.generation?.version !== 5 || input.visual?.version !== 3) throw new Error('自动地表配方6需要独立完整候选。')
  for (const spec of AUTOMATIC_SURFACE_RECIPE6) {
    const definition = input.propDefinitions[terrainVariantDefinitionId(spec.key)]
    if (!definition || definition.version !== 1 || definition.defaultAppearance.kind !== 'image') throw new Error(`自动地表配方6缺少已采用的确切固定素材：${spec.key}。`)
  }
  const scene = cloneJson(input)
  scene.decorations = {}; scene.decorationClusters = {}; scene.surfaceRules = {}
  const generation = getLegacyGeneration(scene)!, removed = new Set<string>()
  // Earlier recipes emitted isolated plants under terrain ownership. A new
  // recipe replaces only those fresh candidate plants with independent rule
  // ownership; rocks and every physical terrain/connection remain unchanged.
  for (const prop of Object.values(scene.props)) {
    const definition = prop.definitionRef && scene.propDefinitions[prop.definitionRef.id]
    if (definition?.tags.some(tag => /^(tree|grass|shrub)$/.test(tag))) {
      removed.add(prop.id); delete scene.props[prop.id]; delete scene.entityLayers[prop.id]
    }
  }
  for (const rule of Object.values(generation.rules)) rule.outputs = rule.outputs.filter(ref => !removed.has(ref.entityId))
  for (const [id, owner] of Object.entries(generation.ownership)) if (removed.has(owner.target.entityId)) delete generation.ownership[id]
  let paintOrder = 0
  const identity = (purpose: string, areaId: string) => `surface-recipe6-${purpose}-${sha256Text(canonicalJson([scene.sceneId, seed, areaId])).slice(0, 24)}`
  const areas = Object.values(scene.terrainAreas).sort(byId)
  for (const area of areas) {
    const style = area.surfaceStyle
    if (!style) continue
    meter.charge({ dependencyRefs: 1 })
    const layerId = scene.entityLayers[area.id], common = { floorId: area.floorId, editLocked: false, visibility: area.visibility,
      supportRef: { kind: 'terrainArea' as const, id: area.id } }
    // Keep frozen shoreline patches in their established surface-style field;
    // moving them to a second paint stack can change edge feathering. A plain
    // base paint is safe to expose through the editable rule stack directly.
    const overlays = style.overlays.slice().sort((a, b) => a.renderOrder - b.renderOrder || byId(a, b))
    if (!overlays.length) {
      const baseId = identity('base', area.id)
      scene.surfaceRules[baseId] = { ...common, id: baseId, field: 'material', paintOrder: ++paintOrder,
        regionsMm: regions(ring(area)), paint: cloneJson(style.base), blendWidthMm: 0 }
      scene.entityLayers[baseId] = layerId
    }
    if (area.blocksMovement || area.visibility !== 'public') continue
    // Vegetation selects dry, nonblocking supported land. Explicit water
    // overlays cut holes; grass overlays can restore a patch on a wet base.
    let planted: PolygonWithHoles[] = !isWaterMaterial(scene, style.base.materialRef.id) ? ring(area) : []
    for (const overlay of overlays) {
      const shape = [{ outer: overlay.boundaryMm, holes: [] }]
      const materialId = overlay.paint.materialRef.id
      if (isWaterMaterial(scene, materialId) || isGrassMaterial(scene, materialId)) {
        planted = polygonBooleanWithHoles({ operation: isGrassMaterial(scene, materialId) ? 'union' : 'difference', subject: planted, clip: shape }, meter).polygons
      }
    }
    if (!planted.length) continue
    planted = polygonBooleanWithHoles({ operation: 'intersection', subject: planted, clip: ring(area) }, meter).polygons
    for (const other of areas) if (other.floorId === area.floorId && other.visibility === 'public' && other.coveragePriority > area.coveragePriority) {
      planted = polygonBooleanWithHoles({ operation: 'difference', subject: planted, clip: ring(other) }, meter).polygons
      if (!planted.length) break
    }
    if (!planted.length) continue
    for (const spec of AUTOMATIC_SURFACE_RECIPE6) {
      const id = identity(spec.field, area.id), clusterId = `${id}-cluster`, definitionId = terrainVariantDefinitionId(spec.key)
      const cluster: DecorationCluster = { ...common, id: clusterId, boundsMm: bounds(planted), seed: sha256Text(canonicalJson(['surface-recipe6', seed, area.id, spec.field])),
        algorithmVersion: 'cluster-v1', palette: [{ key: spec.key, definitionRef: { id: definitionId, version: 1 }, kind: spec.field === 'trees' ? 'prop' : 'decoration', weight: 1 }],
        maxInstances: 64, spacingMm: spec.spacingMm, clusterRadiusMm: spec.radiusMm, clearanceMm: 180, members: {} }
      scene.surfaceRules[id] = { ...common, id, field: spec.field, paintOrder: ++paintOrder, regionsMm: regions(cloneJson(planted)), clusterId, coveragePpm: spec.coveragePpm }
      scene.entityLayers[id] = layerId; scene.entityLayers[clusterId] = layerId
      let sequence = 0
      const generated = buildDecorationRegeneration(scene, cluster, { ids: { nextId: () => `${clusterId}-member-${++sequence}` }, clock: { now: () => scene.updatedAt } }, undefined,
        { polygons: planted, coveragePpm: spec.coveragePpm }, meter)
      scene.decorationClusters[clusterId] = generated.cluster
      for (const prop of generated.props) { scene.props[prop.id] = prop; scene.entityLayers[prop.id] = layerId }
      for (const decoration of generated.decorations) { scene.decorations[decoration.id] = decoration; scene.entityLayers[decoration.id] = layerId }
    }
  }
  return scene
}
