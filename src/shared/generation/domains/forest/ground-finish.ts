import { defaultMaterialPaint } from '../../../appearance/surface-paint.js'
import type { ExecutionBudget } from '../../../budget/task-budget.js'
import { polygonDistance, polygonInside, terrainPoints } from '../../../geometry/geometry.js'
import type { BoundsMm, PointMm, SceneDocument, SurfaceStyle, VersionRef } from '../../../model/scene.js'
import { terrainRandomUnit } from '../../../terrain-generation/field.js'
import type { ForestParameters } from './contracts.js'
import type { ForestReport } from './index.js'

const trailTint = '#B3A58D'

export function woodlandGroundStyle(document: SceneDocument, ground: Extract<ForestParameters['ground'], { kind: 'new' }>,
  finish: ForestParameters['groundFinish']): SurfaceStyle | undefined {
  if (!finish || !ground.materialRef) return
  const material = document.materials[ground.materialRef.id]
  if (!material || material.version !== ground.materialRef.version || !material.applicableSurfaces.includes('terrain')) return
  return { base: { ...defaultMaterialPaint(material), tint: '#E0E5D5' }, overlays: [] }
}

export function woodlandTrailFinish(document: SceneDocument, finish: ForestParameters['groundFinish'], ref: VersionRef | null) {
  if (!finish || !ref || ref.id !== finish.soilMaterialRef.id || ref.version !== finish.soilMaterialRef.version) return
  const material = document.materials[ref.id]
  if (!material || material.version !== ref.version || !material.applicableSurfaces.includes('path')) return
  const surfaceStyle: SurfaceStyle = { base: { ...defaultMaterialPaint(material, 'path'), tint: trailTint }, overlays: [] }
  return { surfaceStyle, boundaryBlendMm: 215 }
}

function paintPatch(points: PointMm[], clip: BoundsMm, padding: number, seed: string): PointMm[] {
  const left = Math.max(clip.x, Math.min(...points.map(p => p.x)) - padding)
  const top = Math.max(clip.y, Math.min(...points.map(p => p.y)) - padding)
  const right = Math.min(clip.x + clip.width, Math.max(...points.map(p => p.x)) + padding)
  const bottom = Math.min(clip.y + clip.height, Math.max(...points.map(p => p.y)) + padding)
  if (right - left < 300 || bottom - top < 300) return []
  return Array.from({ length: 18 }, (_, index) => {
    const angle = index * Math.PI / 9
    const radius = .69 + terrainRandomUnit(seed, `forest-floor/${index}`) * .30
    return { x: Math.round((left + right + (right - left) * Math.cos(angle) * radius) / 2),
      y: Math.round((top + bottom + (bottom - top) * Math.sin(angle) * radius) / 2) }
  })
}

/** Persist paint over actual planting and activity locations using ordinary editable rules. */
export function paintWoodlandFloor(document: SceneDocument, parameters: ForestParameters, report: ForestReport,
  seed: string, idFor: (key: string) => string, meter: ExecutionBudget, checkCancelled: () => void): void {
  const finish = parameters.groundFinish
  if (!finish) return
  const { floorId, layerId, boundsMm, clearings } = parameters
  // Earlier authored brushwork keeps precedence over new woodland suggestions.
  const painted = new Set(Object.values(document.surfaceRules).flatMap(rule => rule.field === 'material' ? [rule.supportRef.id] : []))
  const patches = new Map<string, PointMm[][]>()
  let paintOrder = Math.max(0, ...Object.values(document.surfaceRules).map(rule => rule.paintOrder))
  const addPatch = (key: string, supportId: string, raw: PointMm[], ref: VersionRef, opacity: number, tint: string | null, blend: number) => {
    checkCancelled()
    if (!raw.length || painted.has(supportId)) return
    const boundary = terrainPoints(document.terrainAreas[supportId]), others = patches.get(supportId) ?? []
    const x = raw.reduce((sum, p) => sum + p.x, 0) / raw.length, y = raw.reduce((sum, p) => sum + p.y, 0) / raw.length
    // Leave a small geometric gap before feathering. Overlapping same-channel
    // strokes can otherwise leave slivers when the native rule resolver rounds.
    const outerMm = [1, .84, .68, .52].map(scale => scale === 1 ? raw : raw.map(p => ({
      x: Math.round(x + (p.x - x) * scale), y: Math.round(y + (p.y - y) * scale),
    }))).find(ring => {
      meter.charge({ fieldEvaluations: ring.length, intersectionPairs: ring.length * (boundary.length + raw.length * others.length), dependencyRefs: 1 })
      return polygonInside(ring, boundary) && others.every(other => polygonDistance(ring, other) >= 12)
    })
    if (!outerMm) return
    others.push(outerMm)
    patches.set(supportId, others)
    const id = idFor(`floor-paint:${key}`)
    document.surfaceRules[id] = { id, floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: supportId },
      field: 'material', paintOrder: ++paintOrder, regionsMm: [{ outerMm, holesMm: [] }], blendWidthMm: blend,
      paint: { ...defaultMaterialPaint(document.materials[ref.id]), opacity, tint } }
    document.entityLayers[id] = layerId
    report.surfaceRuleIds.push(id)
  }

  for (const clearing of clearings) {
    const ring = clearing.boundaryMm
    const inner = ring.map(p => ({ x: Math.round(clearing.anchorMm.x * .10 + p.x * .90), y: Math.round(clearing.anchorMm.y * .10 + p.y * .90) }))
    const patch = paintPatch(inner, boundsMm, 0, `${seed}/${clearing.id}`)
    if (!patch.length || !polygonInside(patch, ring)) continue
    const supportId = clearing.supportRef.kind === 'generated-ground' ? report.groundAreaId! : clearing.supportRef.id
    addPatch(`clearing:${clearing.id}`, supportId, patch, finish.soilMaterialRef, .99, trailTint, 470)
  }

  for (const { role, placed, clusterId, zoneId } of report.vegetation) {
    if (role !== 'tree' || !placed) continue
    const cluster = document.decorationClusters[clusterId]
    const roots = Object.values(cluster.members).flatMap(row => row.kind === 'prop' && row.entityId ? [document.props[row.entityId].positionMm] : [])
    const extent = Math.max(...roots.map(p => p.x)) - Math.min(...roots.map(p => p.x))
      + Math.max(...roots.map(p => p.y)) - Math.min(...roots.map(p => p.y))
    const buckets = new Map<string, PointMm[]>()
    for (const root of roots) {
      const key = extent < 21000 ? 'group' : `${Math.floor((root.x - boundsMm.x) / 11000)}:${Math.floor((root.y - boundsMm.y) / 11000)}`
      const points = buckets.get(key) ?? []
      points.push(root)
      buckets.set(key, points)
    }
    for (const [key, points] of [...buckets].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
      addPatch(`trees:${zoneId}:${key}`, cluster.supportRef.id, paintPatch(points, boundsMm, 3000, `${seed}/${zoneId}/${key}`),
        finish.mossMaterialRef, .88, '#CDD4BD', 1000)
    }
  }
}
