import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { PointMm, SceneDocument } from '../model/scene.js'
import type { ProjectedVisualSystem } from '../projection/types.js'
import { sampleVisualBoundary } from '../visual/geometry.js'
import { visualBase } from '../visual/base.js'
import { edgeLookPaintPadding } from '../visual/paint-envelopes.js'
import { terrainTransitionStrokePolygon } from '../visual/transition.js'
import type { TerrainInlayPlan, TerrainInlayRequest } from './contracts.js'
import { planTerrainInlay } from './geometry.js'

export interface TerrainInlayVisualInput {
  id: string
  sourceIds: readonly string[]
  footprintMm: PointMm[]
  changedCarriers: { a: PointMm; b: PointMm }[]
}
export interface TerrainInlayVisualScopeRow {
  paintId: string
  boundaryId: string
  kind: 'cliff' | 'source-shore'
  inlayIds: string[]
}
export interface TerrainInlayVisualScope {
  workUnits: number
  /** Finite possible paint impact, not measured pixel differences. */
  paintIds: string[]
  /** Source-bound shore paint covered only inside the actual influence. */
  scopedPaintIds: string[]
  boundaryIds: string[]
  layerIds: string[]
  rows: TerrainInlayVisualScopeRow[]
}
const polygon = (points: PointMm[]): MultiPolygon => [[points.map(p => [p.x, p.y])]]
const pointCount = (regions: MultiPolygon) => regions.reduce((n, p) => n + p.reduce((s, r) => s + r.length, 0), 0)
const area = (regions: MultiPolygon) => regions.reduce((sum, p) => sum + p.reduce((s, r, i) => s + (i ? -1 : 1)
  * Math.abs(r.reduce((a, p, j) => a + p[0] * r[(j + 1) % r.length][1] - r[(j + 1) % r.length][0] * p[1], 0) / 2), 0), 0)

/** Positive-length overlap only; point contacts do not replace an old carrier. */
export function terrainInlayCarrierRange(a: PointMm, b: PointMm, c: PointMm, d: PointMm): [number, number] | null {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
  if (!length || [c, d].some(p => Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) > 1e-5 * length)) return null
  const t = (p: PointMm) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / length ** 2
  const from = Math.max(0, Math.min(t(c), t(d))), to = Math.min(1, Math.max(t(c), t(d)))
  return (to - from) * length > 1e-6 ? [from, to] : null
}

/** The command, candidate review and audience projection share this scope.
 * Audience filtering happens before calling this pure planner. Finite native
 * paint reach and changed carriers protect locks without claiming pixel QA. */
export function planTerrainInlayVisualScope(inlays: readonly TerrainInlayVisualInput[],
  visual: Pick<ProjectedVisualSystem, 'boundaries' | 'edgeLooks'>): TerrainInlayVisualScope {
  if (inlays.reduce((n, row) => n + row.changedCarriers.length, 0) > 4096
    || inlays.reduce((n, row) => n + row.footprintMm.length, 0) > 16384) throw Error('跨台表现替换超过完整点边保护值。')
  const boundaries = new Map(visual.boundaries.map(row => [row.id, row])), rows: TerrainInlayVisualScopeRow[] = []
  let work = 0
  const spend = (count = 1) => { work += count; if (work > 2_000_000) throw Error('跨台表现逐段归属超过有限工作预算。') }
  spend(inlays.reduce((n, row) => n + row.footprintMm.length + row.changedCarriers.length * 2, 0))
  // Reserve every possible edge pairing before the first boolean operation.
  // A two-point finite reach is a four-edge polygon; constructing the reach
  // and walking boolean output also consume the same fixed work envelope.
  const prepared = visual.edgeLooks.flatMap(look => {
    if (!look.enabled || look.opacity <= 0) return []
    const boundary = boundaries.get(look.boundaryId)
    if (!boundary) return []
    const segments = boundary.points.flatMap((a, i) => boundary.closed || i < boundary.points.length - 1
      ? [{ a, b: boundary.points[(i + 1) % boundary.points.length] }] : [])
    spend(boundary.points.length + segments.length * 4)
    const width = Math.ceil(edgeLookPaintPadding(look) * 2)
    const reach = segments.map(({ a, b }) => terrainTransitionStrokePolygon([a, b], width)).filter(points => points.length >= 3).map(polygon)
    const reachEdges = reach.reduce((n, regions) => n + pointCount(regions), 0)
    for (const inlay of inlays) spend(segments.length * inlay.changedCarriers.length + reachEdges * inlay.footprintMm.length)
    return [{ look, boundary, segments, reach }]
  })
  const layers = new Set<string>()
  for (const { look, boundary, segments, reach } of prepared) {
    const affected: string[] = []
    for (const inlay of inlays) {
      const carrierChanged = segments.some(({ a, b }) => inlay.changedCarriers.some(c => terrainInlayCarrierRange(a, b, c.a, c.b)))
      const influence = polygon(inlay.footprintMm)
      const touchesInfluence = reach.some(poly => {
        const intersection = polygonClipping.intersection(poly, influence)
        spend(pointCount(intersection))
        return area(intersection) > 1e-5
      })
      const terrainCliff = look.kind === 'cliff' && boundary.terrainAreaIds.length > 0
      if (terrainCliff) {
        if (!carrierChanged && !touchesInfluence) continue
        if (!['rockRelief6', 'rockRelief7', 'rockRelief8', 'rockRelief9'].includes(look.renderProfile ?? '')) {
          throw Error(`跨台实际域触及尚未提供逐段归属的旧崖画法 ${look.id}；请先明确调整该表现。`)
        }
      } else {
        if (!touchesInfluence) continue
        if (look.kind !== 'shore' || !boundary.terrainAreaIds.some(id => inlay.sourceIds.includes(id))) {
          throw Error(`跨台实际域触及既有草带、岸线或其他装饰 ${look.id}；请明确保留/调整该表现后再采用。`)
        }
      }
      affected.push(inlay.id)
    }
    if (affected.length) {
      rows.push({ paintId: look.id, boundaryId: boundary.id, kind: look.kind === 'cliff' ? 'cliff' : 'source-shore', inlayIds: affected.sort() })
      layers.add(look.layerId)
    }
  }
  rows.sort((a, b) => a.paintId.localeCompare(b.paintId))
  return { workUnits: work, rows, paintIds: rows.map(row => row.paintId), scopedPaintIds: rows.filter(row => row.kind === 'source-shore').map(row => row.paintId),
    boundaryIds: [...new Set(rows.map(row => row.boundaryId))].sort(), layerIds: [...layers].sort() }
}

/** GM transaction scope includes hidden/private authored dependencies too.
 * No document certification, resource bypass, identity or adoption authority. */
export function inspectTerrainInlayVisualScope(scene: SceneDocument, connectionId: string, geometry: TerrainInlayRequest,
  plan: TerrainInlayPlan = planTerrainInlay(geometry)): TerrainInlayVisualScope {
  const connection = scene.terrainConnections[connectionId]
  if (!connection) throw Error('跨台表现范围缺少现存连接。')
  const base = visualBase(scene)
  if (!base) return { workUnits: 0, rows: [], paintIds: [], scopedPaintIds: [], boundaryIds: [], layerIds: [] }
  const boundaries = Object.values(base.boundaries).filter(row => row.floorId === connection.floorId).map(row => {
    const sampled = sampleVisualBoundary(row)
    return { id: row.id, points: sampled.points, samples: sampled.samples, lengthMm: sampled.lengthMm, closed: sampled.closed,
      terrainAreaIds: row.binding.kind === 'terrain' ? row.binding.sides.map(side => side.areaId) : [] }
  })
  const scope = planTerrainInlayVisualScope([{ id: connectionId, sourceIds: geometry.sources.map(row => row.id),
    footprintMm: geometry.footprintVertexIds.map(id => ({ x: geometry.verticesMm[id].x, y: geometry.verticesMm[id].y })),
    changedCarriers: plan.sourceIntervals.map(row => ({ a: row.a, b: row.b })) }], {
    boundaries, edgeLooks: Object.values(base.edgeLooks).filter(row => row.floorId === connection.floorId),
  })
  scope.layerIds = [...new Set([...scope.layerIds, ...scope.boundaryIds.map(id => base.boundaries[id].layerId)])].sort()
  return scope
}

export function assertTerrainInlayVisualLocks(scene: SceneDocument, scope: TerrainInlayVisualScope): void {
  const base = visualBase(scene)
  for (const id of [...scope.paintIds, ...scope.boundaryIds]) {
    const value = base?.edgeLooks[id] ?? base?.boundaries[id]
    if (value && (value.editLocked || scene.userLayers[value.layerId]?.editLocked)) throw Error(`跨台事务涉及锁定视觉对象、边界或图层：${id}。`)
  }
}
