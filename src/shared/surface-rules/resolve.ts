import type { ExecutionBudget } from '../budget/task-budget.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../geometry/polygon-boolean.js'
import type { SceneDocument, SurfaceRule, SurfaceRuleBase, SurfaceRuleRegion } from '../model/scene.js'

export interface SurfaceRuleResolveOptions {
  audience?: 'gm' | 'player'
  hiddenLayerIds?: ReadonlySet<string>
  executionMeter?: ExecutionBudget
}
export interface ResolvedSurfaceRule {
  /** An independent domain copy; projection must retain only finite paint values. */
  rule: SurfaceRule
  regionsMm: SurfaceRuleRegion[]
}

const order = (a: SurfaceRule, b: SurfaceRule) => a.paintOrder - b.paintOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const polygons = (regions: SurfaceRuleRegion[]): PolygonWithHoles[] => regions.map(region => ({ outer: region.outerMm, holes: region.holesMm }))
const regions = (values: PolygonWithHoles[]): SurfaceRuleRegion[] => values.map(value => ({ outerMm: value.outer, holesMm: value.holes }))
const copyRegions = (values: SurfaceRuleRegion[]): SurfaceRuleRegion[] => values.map(region => ({
  outerMm: region.outerMm.map(point => ({ ...point })), holesMm: region.holesMm.map(ring => ring.map(point => ({ ...point }))),
}))
function copyRule(rule: SurfaceRule): SurfaceRule {
  const common: SurfaceRuleBase = { id: rule.id, floorId: rule.floorId, editLocked: rule.editLocked, visibility: rule.visibility,
    supportRef: { ...rule.supportRef }, field: rule.field, paintOrder: rule.paintOrder, regionsMm: copyRegions(rule.regionsMm) }
  return rule.field === 'material'
    ? { ...common, field: 'material', paint: { ...rule.paint, materialRef: { ...rule.paint.materialRef }, tileSizeMm: { ...rule.paint.tileSizeMm }, originMm: { ...rule.paint.originMm } }, blendWidthMm: rule.blendWidthMm }
    : { ...common, field: rule.field, clusterId: rule.clusterId, coveragePpm: rule.coveragePpm }
}

/**
 * Resolve a field only after audience and temporary editor-layer filtering.
 * Visibility is its own ownership stack: a private stroke never clips a public
 * rule, even for GM rendering. Material paint can then composite those stacks.
 * Generated vegetation is persisted by commands; this function never spawns it.
 */
export function resolveSurfaceRules(scene: SceneDocument, rules: readonly SurfaceRule[] = Object.values(scene.surfaceRules ?? {}), options: SurfaceRuleResolveOptions = {}): ResolvedSurfaceRule[] {
  if (scene.schemaVersion !== 8) return []
  const audience = options.audience ?? 'gm', hiddenLayers = options.hiddenLayerIds
  const shown = (id: string) => !hiddenLayers?.has(scene.entityLayers[id])
  const visible = rules.filter(rule => {
    const support = scene.terrainAreas[rule.supportRef.id]
    return !!support && shown(rule.id) && shown(support.id) && (audience === 'gm' || rule.visibility === 'public' && support.visibility === 'public')
  }).slice().sort(order)
  const buckets = new Map<string, SurfaceRule[]>()
  for (const rule of visible) {
    const key = JSON.stringify([rule.supportRef.id, rule.visibility, rule.field])
    const bucket = buckets.get(key) ?? []
    bucket.push(rule); buckets.set(key, bucket)
  }
  const resolved: ResolvedSurfaceRule[] = []
  for (const bucket of buckets.values()) {
    const support = [{ outer: scene.terrainAreas[bucket[0].supportRef.id].boundaryMm.map(vertex => vertex.positionMm), holes: [] }]
    const newer: PolygonWithHoles[][] = []
    for (const rule of bucket.slice().reverse()) {
      const clipped = polygonBooleanWithHoles({ operation: 'intersection', subject: polygons(rule.regionsMm), clip: support }, options.executionMeter).polygons
      let effective = clipped
      // Subtract separate newer rule sets instead of joining all stored rings
      // into one unbounded request. Existing holes remain holes at every step.
      for (const covered of newer) {
        if (!effective.length) break
        effective = polygonBooleanWithHoles({ operation: 'difference', subject: effective, clip: covered }, options.executionMeter).polygons
      }
      if (effective.length) resolved.push({ rule: copyRule(rule), regionsMm: regions(effective) })
      if (clipped.length) newer.push(clipped)
    }
  }
  return resolved.sort((a, b) => order(a.rule, b.rule))
}
