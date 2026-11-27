import type { MapLandform } from '../generation/map-authoring.js'
import type { ExecutionBudget } from '../budget/task-budget.js'
import { indexEdges, observeGeometryPairs, type SegmentMm } from '../geometry/edge-index.js'
import { distanceToSegment, pointInPolygon, segmentCuts } from '../geometry/geometry.js'
import type { PointMm } from '../model/scene.js'
import { terrainValueNoise } from './field.js'

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

type TerraceCap = { elevationMm: number; outlet: [PointMm, PointMm]; weight: (p: PointMm) => number }

function nearbyDistance(points: PointMm[], closed = false) {
  const edges: SegmentMm[] = points.slice(0, closed ? points.length : -1).map((a, i) => [a, points[(i + 1) % points.length]])
  const find = indexEdges(edges)
  return (at: PointMm, reach: number) => {
    const possible = find(at, at, reach)
    observeGeometryPairs(possible.length)
    return possible.reduce((nearest, i) => Math.min(nearest, distanceToSegment(at, ...edges[i])), reach)
  }
}

/** Evaluate the physical relief outside a marked core or down the sides of
 * a ridge. A breakline shortens the transition only along that part of it. */
export function landscapeStructureWeight(form: MapLandform, seed: string) {
  const { structure } = form
  if (!structure) return undefined
  const rim = structure.kind === 'area' ? structure.boundary : undefined
  const trace = structure.kind === 'ridge' ? structure.centerline : structure.boundary
  const distance = nearbyDistance(trace, !!rim)
  const breakDistance = structure.breakline && nearbyDistance(structure.breakline)
  const radius = Math.min(form.radius.x, form.radius.y)
  const core = rim ? 0 : radius * .19
  const slopeReach = Math.max(1150, radius * (rim ? .58 : .71))
  const influenceReach = slopeReach * 1.32 + core
  const minX = Math.min(...trace.map(p => p.x)) - influenceReach, maxX = Math.max(...trace.map(p => p.x)) + influenceReach
  const minY = Math.min(...trace.map(p => p.y)) - influenceReach, maxY = Math.max(...trace.map(p => p.y)) + influenceReach
  return (at: PointMm) => {
    if (at.x < minX || at.x > maxX || at.y < minY || at.y > maxY) return 0
    if (rim && pointInPolygon(at, rim)) return 1
    const distanceToCore = distance(at, influenceReach) - core
    if (distanceToCore >= slopeReach * 1.24) return 0
    const fold = terrainValueNoise(seed, `${form.id}/rim`, at.x / 4900, at.y / 4100)
    const nearBreak = breakDistance ? smooth(1 - Math.max(0, breakDistance(at, influenceReach) - Math.max(0, distanceToCore)) / (slopeReach * .54)) : 0
    const reach = Math.max(1250, slopeReach * (1 + fold * .22) * (1 - nearBreak * .60))
    return 1 - smooth(distanceToCore / reach)
  }
}

/** A lower terrace whose core opens beyond a higher plateau needs a shelf
 * connected to that rim. Limit the contribution of the higher plateau there. */
export function joinLandscapeTerraces(forms: MapLandform[], cell: number, meter: ExecutionBudget) {
  const plateaus = forms.flatMap(form => form.shape === 'plateau' && form.structure?.kind === 'area'
    ? [{ form, rim: form.structure.boundary }] : [])
  const joined = new Map<MapLandform, TerraceCap[]>()
  const edges = (rim: PointMm[]): [PointMm, PointMm][] => rim.map((p, i) => [p, rim[(i + 1) % rim.length]])
  for (const { form: upper, rim: upperRim } of plateaus) {
    const caps: TerraceCap[] = []
    for (const { form: lower, rim: lowerRim } of plateaus) {
      const rise = upper.elevationMm - lower.elevationMm
      if (rise < 300 || !pointInPolygon(lower.at, upperRim, false)) continue
      const dx = lower.at.x - upper.at.x, dy = lower.at.y - upper.at.y, separation = Math.hypot(dx, dy)
      if (separation < cell * 2.8) continue
      const bearing = Math.atan2(dy, dx)
      const lowEdges = edges(lowerRim), highEdges = edges(upperRim)
      const reach = Math.max(...lowerRim.map(p => Math.hypot(p.x - lower.at.x, p.y - lower.at.y))) + cell
      const outlet = [0, -.31, .31, -.61, .61].map(turn => {
        const x = Math.cos(bearing + turn), y = Math.sin(bearing + turn)
        const end = { x: lower.at.x + reach * x, y: lower.at.y + reach * y }
        const lowEnd = segmentCuts(lower.at, end, lowEdges)[1] * reach
        const highEnd = segmentCuts(lower.at, end, highEdges)[1] * reach
        return { x, y, lowEnd, gap: lowEnd - highEnd, separation: dx * x + dy * y }
      }).find(row => row.gap >= cell * 1.45 && row.separation >= cell * 2.8)
      if (!outlet) continue
      const pad = Math.min(cell * Math.SQRT2, outlet.separation * .44)
      const width = Math.max(pad, Math.min(lower.radius.x, lower.radius.y, outlet.lowEnd) * .28)
      const sideBlend = Math.max(cell * 1.8, Math.min(rise * .48, width * 1.6))
      const flatReach = outlet.lowEnd - cell
      const end = { x: lower.at.x + flatReach * outlet.x, y: lower.at.y + flatReach * outlet.y }
      caps.push({ elevationMm: lower.elevationMm, outlet: [lower.at, end], weight: (p: PointMm) => {
        const x = p.x - lower.at.x, y = p.y - lower.at.y, along = x * outlet.x + y * outlet.y
        const fromTop = smooth((along + outlet.separation - pad) / (outlet.separation - pad * 2))
        const toRim = 1 - smooth((along - outlet.lowEnd) / sideBlend)
        const cross = Math.abs(y * outlet.x - x * outlet.y), halfWidth = width + Math.max(0, Math.min(along, outlet.lowEnd)) * .25
        return fromTop * toRim * (1 - smooth((cross - halfWidth) / sideBlend))
      } })
    }
    if (caps.length) joined.set(upper, caps)
  }
  const terraces = [...joined.values()].flat()
  meter.charge({ fieldEvaluations: plateaus.length ** 2 + terraces.length * 10 })
  return { joined, correctionFields: terraces.length, preserve: terraces.length ? {
    outlets: terraces.map(({ elevationMm, outlet }) => ({ elevationMm, edge: outlet })),
    weightAt: (p: PointMm) => terraces.reduce((weight, row) => Math.max(weight, row.weight(p)), 0),
  } : undefined }
}

export type TerracePreservation = NonNullable<ReturnType<typeof joinLandscapeTerraces>['preserve']>

/** Preserve the level at a marked landform when a neighboring slope crosses
 * its core. Blend back into the composed field before reaching the other mark. */
export function preserveLandformLevels(forms: MapLandform[], cell: number, ground: (p: PointMm) => number, coastal: boolean, meter: ExecutionBudget) {
  meter.charge({ fieldEvaluations: forms.length * (2 + forms.length) })
  const pins = forms.flatMap(form => {
    const height = coastal ? Math.max(80, form.elevationMm) : form.elevationMm
    if (Math.abs(ground(form.at) - height) <= 100) return []
    const nearest = forms.reduce((reach, other) => other === form || other.elevationMm === form.elevationMm ? reach
      : Math.min(reach, Math.hypot(other.at.x - form.at.x, other.at.y - form.at.y)), Infinity)
    const inner = Math.min(cell * Math.SQRT2, nearest * .48)
    const outer = Math.min(nearest * .74, inner + Math.max(cell, Math.min(form.radius.x, form.radius.y) * .35))
    return outer > inner ? [{ at: form.at, height, inner, outer }] : []
  })
  if (!pins.length) return { heightAt: ground, correctionFields: 0 }
  return { correctionFields: pins.length, heightAt: (p: PointMm) => {
    const base = ground(p)
    let heightSum = 0, weightSum = 0, coverage = 0
    for (const pin of pins) {
      const distance = Math.hypot(p.x - pin.at.x, p.y - pin.at.y)
      if (distance >= pin.outer) continue
      const weight = 1 - smooth((distance - pin.inner) / (pin.outer - pin.inner))
      heightSum += pin.height * weight
      weightSum += weight
      coverage = Math.max(coverage, weight)
    }
    return weightSum ? base * (1 - coverage) + heightSum / weightSum * coverage : base
  } }
}
