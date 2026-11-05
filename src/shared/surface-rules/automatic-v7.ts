import type { DecorationCluster, SceneDocument, SurfaceRuleRegion, TerrainArea } from '../model/scene.js'
import type { ExecutionBudget } from '../budget/task-budget.js'
import { buildDecorationRegeneration, estimateSurfaceRegionInstances } from '../decorations/generate.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../geometry/polygon-boolean.js'
import { terrainPoints } from '../geometry/geometry.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { terrainVariantDefinitionId } from '../visual/terrain-variant-specs.js'
import { terrainVariantV2DefinitionId } from '../visual/terrain-variant-v2-specs.js'
import { SHORE_MATERIAL_IDS } from '../visual/shore-art.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { createCompositionContent } from '../appearance/graph.js'
import { bindTerrainVariantPresentations, bindTerrainVariantV2Presentations } from '../visual/terrain-variant-presentations.js'

/** These defaults belong only to terrain recipe7. Saved rules remain ordinary
 * editable current rules; changing a future recipe must use another selector. */
export const AUTOMATIC_SURFACE_RECIPE7 = Object.freeze([
  { field: 'trees' as const, key: 'tree-highland-copse', coveragePpm: 300_000, spacingMm: 520, radiusMm: 1500 },
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
export function addAutomaticSurfaceRules7(input: SceneDocument, seed: string, meter: ExecutionBudget): SceneDocument {
  if (input.generation?.version !== 5 || input.visual?.version !== 3) throw new Error('自动地表配方7需要独立完整候选。')
  for (const spec of AUTOMATIC_SURFACE_RECIPE7) {
    const definitionId = spec.field === 'trees' ? terrainVariantV2DefinitionId(spec.key) : terrainVariantDefinitionId(spec.key)
    const definition = input.propDefinitions[definitionId]
    if (!definition || definition.version !== 1 || definition.defaultAppearance.kind !== 'image') throw new Error(`自动地表配方7缺少已采用的确切固定素材：${spec.key}。`)
  }
  let presentationSequence = 0
  const appearance = bindTerrainVariantV2Presentations(bindTerrainVariantPresentations(createCompositionContent(input, {
    ids: { nextId: () => `surface-recipe7-presentation-${++presentationSequence}` }, clock: { now: () => input.updatedAt },
  }))).appearance
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
  const identity = (purpose: string, areaId: string) => `surface-recipe7-${purpose}-${sha256Text(canonicalJson([scene.sceneId, seed, areaId])).slice(0, 24)}`
  const areas = Object.values(scene.terrainAreas).sort(byId)
  const maximumLandElevation = Math.max(...areas.filter(area => !area.blocksMovement && area.visibility === 'public').map(area => area.groundElevationMm))
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
    for (const spec of AUTOMATIC_SURFACE_RECIPE7) {
      const id = identity(spec.field, area.id), clusterId = `${id}-cluster`, highland = area.groundElevationMm === maximumLandElevation
      const key = spec.field === 'trees' && !highland ? 'tree-wind-oak' : spec.key
      const definitionId = spec.field === 'trees' && highland ? terrainVariantV2DefinitionId(key) : terrainVariantDefinitionId(key)
      const baseClusterSeed = sha256Text(canonicalJson(['surface-recipe7', seed, area.id, spec.field]))
      const cluster: DecorationCluster = { ...common, id: clusterId, boundsMm: bounds(planted), seed: baseClusterSeed,
        algorithmVersion: 'cluster-v1', palette: [{ key, definitionRef: { id: definitionId, version: 1 }, kind: spec.field === 'trees' ? 'prop' : 'decoration', weight: 1 }],
        maxInstances: 64, spacingMm: spec.spacingMm, clusterRadiusMm: spec.radiusMm, clearanceMm: 180, members: {} }
      scene.surfaceRules[id] = { ...common, id, field: spec.field, paintOrder: ++paintOrder, regionsMm: regions(cloneJson(planted)), clusterId, coveragePpm: spec.coveragePpm }
      scene.entityLayers[id] = layerId; scene.entityLayers[clusterId] = layerId
      let sequence = 0
      const surfaceRegion = { polygons: planted, coveragePpm: spec.coveragePpm }
      const targetCount = estimateSurfaceRegionInstances(scene, cluster.palette, surfaceRegion)
      let generated = buildDecorationRegeneration(scene, cluster, { ids: { nextId: () => `${clusterId}-member-${++sequence}` }, clock: { now: () => scene.updatedAt } }, appearance,
        surfaceRegion, meter)
      if (highland && (spec.field === 'trees' || spec.field === 'shrubs') && targetCount > 0) {
        let best = generated, bestCount = Object.values(generated.cluster.members).filter(member => member.entityId && member.state === 'managed').length
        // The highland can have a small but valid planting corridor around a
        // hard activity area. Try bounded, named sub-seeds and retain the
        // fullest result; the cluster-v1 validator still enforces support,
        // footprint and every clearance for every accepted member.
        for (let attempt = 1; attempt < 5 && bestCount < targetCount; attempt++) {
          const candidate = { ...cluster, seed: sha256Text(canonicalJson(['surface-recipe7-highland-search', baseClusterSeed, attempt])), members: {} }
          const next = buildDecorationRegeneration(scene, candidate, { ids: { nextId: () => `${clusterId}-member-${++sequence}` }, clock: { now: () => scene.updatedAt } }, appearance,
            surfaceRegion, meter)
          const count = Object.values(next.cluster.members).filter(member => member.entityId && member.state === 'managed').length
          if (count > bestCount) { best = next; bestCount = count }
        }
        generated = best
      }
      scene.decorationClusters[clusterId] = generated.cluster
      for (const prop of generated.props) { scene.props[prop.id] = prop; scene.entityLayers[prop.id] = layerId }
      for (const decoration of generated.decorations) { scene.decorations[decoration.id] = decoration; scene.entityLayers[decoration.id] = layerId }
    }
  }
  return scene
}
