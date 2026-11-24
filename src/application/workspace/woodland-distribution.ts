import type { PointMm, SceneDocument, SizeMm } from '../../shared/model/scene.js'
import type { ForestParameters, ForestVegetation } from '../../shared/generation/domains/forest/contracts.js'
import { forestRectangle } from '../../shared/generation/domains/forest/index.js'
import { estimateSurfaceRegionInstances } from '../../shared/decorations/generate.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../../shared/geometry/polygon-boolean.js'
import { distanceToSegment, pointInPolygon } from '../../shared/geometry/geometry.js'
import type { MixedParameters } from '../../shared/generation/domains/mixed/contracts.js'
import { cloneJson } from '../../shared/validation/json.js'
import { sha256Text } from '../../shared/validation/hash.js'

export type WoodlandDistribution = 'auto' | 'uniform' | 'copses'
type Zone = ForestParameters['zones'][number]
class WoodlandSpaceError extends Error {}

export function defaultWoodlandCoverages({ width, height }: SizeMm) {
  // Keep the suggested number manageable as the extent grows, including the
  // mixed form's maximum 2× multiplier. Explicit coverage still uses the
  // generation budget and reports the requested counts.
  const factor = Math.min(1, 3_000_000_000 / (width * height))
  const ppm = (value: number) => Math.round(value * factor) * 1000
  return { tree: ppm(145), shrub: ppm(28), grass: ppm(15) }
}

type PlantingReservation = { points: PointMm[]; closed?: boolean; margin: number }
function plantingReservations(p: ForestParameters, mixed?: Pick<MixedParameters, 'building' | 'approach'>) {
  const result: PlantingReservation[] = p.clearings.map(c => ({ points: c.boundaryMm, closed: true, margin: c.clearanceMm }))
  for (const route of p.routes) {
    const start = p.entrances.find(row => row.id === route.fromEntranceId), end = p.clearings.find(row => row.id === route.toClearingId)
    if (start && end) result.push({ points: [start.positionMm, ...route.viaMm, end.anchorMm], margin: route.widthMm / 2 })
  }
  if (mixed) {
    const b = mixed.building.boundsMm, route = mixed.approach, start = [route.fromMm, ...route.viaMm], last = start.at(-1)!
    const end = { x: Math.max(b.x, Math.min(b.x + b.width, last.x)), y: Math.max(b.y, Math.min(b.y + b.height, last.y)) }
    result.push({ points: forestRectangle(b), closed: true, margin: mixed.building.wallThicknessMm },
      { points: [...start, end], margin: route.widthMm / 2 })
  }
  return result
}

function areaMm2(polygons: PolygonWithHoles[]): bigint {
  const ringArea2 = (ring: PointMm[]) => {
    const value = ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]
      return sum + BigInt(p.x) * BigInt(q.y) - BigInt(q.x) * BigInt(p.y)
    }, 0n)
    return value < 0n ? -value : value
  }
  return polygons.reduce((sum, p) => sum + ringArea2(p.outer) - p.holes.reduce((holes, ring) => holes + ringArea2(ring), 0n), 0n) / 2n
}

function coverageForCount(document: SceneDocument, row: ForestVegetation, polygons: PolygonWithHoles[], count: number): number {
  if (!count) return 0
  let weightedArea = 0n, weight = 0n
  for (const item of row.palette) {
    const definition = document.propDefinitions[item.definitionRef.id]
    if (!definition || definition.version !== item.definitionRef.version) throw new Error('疏密林地需要工程内确切固定的植被素材。')
    weightedArea += BigInt(definition.defaultVisualBoundsMm.width) * BigInt(definition.defaultVisualBoundsMm.height) * BigInt(item.weight)
    weight += BigInt(item.weight)
  }
  const denominator = areaMm2(polygons) * weight
  if (!denominator) throw new WoodlandSpaceError('活动空地已占满疏密林地区域；请调整空地或选择均匀散布。')
  const numerator = BigInt(count) * weightedArea * 1_000_000n
  const coveragePpm = Number((numerator + denominator - 1n) / denominator)
  if (coveragePpm > 1_000_000 || estimateSurfaceRegionInstances(document, row.palette, { polygons, coveragePpm }) !== count) {
    throw new WoodlandSpaceError('疏密林地区域不足以保留当前植被目标；请降低覆盖目标或选择均匀散布。')
  }
  return coveragePpm
}

/** A form preset expands to ordinary, complete forest inputs. Existing recipes,
 * forest algorithms and cluster-v1 never read or reinterpret this choice. */
export function createWoodlandZones(document: SceneDocument, parameters: ForestParameters, seed: string, secondTree?: ForestVegetation['palette'], reservations?: PlantingReservation[]): Zone[] {
  const b = parameters.boundsMm, source = parameters.zones[0], rectangle = forestRectangle(b)
  if (parameters.zones.length !== 1 || source.boundaryMm.length !== 4
    || !rectangle.every(p => source.boundaryMm.some(q => p.x === q.x && p.y === q.y))) {
    throw new Error('疏密林地目前用于单块完整矩形林区；已有分区请使用均匀散布。')
  }
  if (b.width < 16000 || b.height < 16000) throw new WoodlandSpaceError('疏密林地需要宽和高至少16米；请扩大地图或选择均匀散布。')
  const hash = sha256Text(JSON.stringify(['sceneweave-woodland-form', 1, seed]))
  const unit = (channel: number) => Number.parseInt(hash.slice(channel * 2, channel * 2 + 2), 16) / 255
  const flip = unit(0) < .5
  // Each copse stays in its own half. The larger undergrowth envelope contains
  // its core; opposing envelopes remain apart without partitioning the map.
  const rings = [0, 1].map(index => {
    const cx = .26 + index * .48, seededY = (index === 0) !== flip ? .34 : .66
    let cy = seededY
    if (reservations?.length) {
      const trees = source.vegetation.find(row => row.role === 'tree')
      const palette = index === 1 && secondTree ? secondTree : trees?.palette ?? []
      const radius = Math.max(0, ...palette.map(item => {
        const bounds = document.propDefinitions[item.definitionRef.id]?.defaultVisualBoundsMm
        return bounds ? Math.hypot(bounds.width, bounds.height) / 2 : 0
      })) + (trees?.clearanceMm ?? 0)
      // Estimate usable canopy centres before committing the zone. The actual
      // generator still checks each rotated plant, door and full-width path.
      const usable = (centerY: number) => {
        let sites = 0
        for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
          if (x * x + y * y > 10) continue
          const p = { x: b.x + b.width * (cx + x * .055), y: b.y + b.height * (centerY + y * .063) }
          if (Math.min(p.x - b.x, p.y - b.y, b.x + b.width - p.x, b.y + b.height - p.y) < radius) continue
          const blocked = reservations.some(r => (r.closed && pointInPolygon(p, r.points)) || r.points.some((a, i) =>
            (i > 0 || r.closed) && distanceToSegment(p, a, r.points[(i + r.points.length - 1) % r.points.length]) < radius + r.margin))
          if (!blocked) sites++
        }
        return sites
      }
      const first = usable(seededY), opposite = usable(1 - seededY)
      if (!first && !opposite) throw new WoodlandSpaceError('两处候选树群都缺少容纳树冠的空间。')
      if (opposite > first) cy = 1 - seededY
    }
    const radial = Array.from({ length: 12 }, (_, vertex) => .82 + .18 * unit(1 + index * 12 + vertex))
    const ring = (rx: number, ry: number): PointMm[] => radial.map((radius, vertex) => {
      const angle = vertex * Math.PI / 6
      return { x: b.x + Math.round(b.width * (cx + rx * radius * Math.cos(angle))),
        y: b.y + Math.round(b.height * (cy + ry * radius * Math.sin(angle))) }
    })
    return { tree: ring(.20, .23), undergrowth: ring(.235, .30) }
  })
  const clip = parameters.clearings.map(row => ({ outer: row.boundaryMm, holes: [] }))
  const effective = (boundaryMm: PointMm[]) => polygonBooleanWithHoles({ operation: 'difference', subject: [{ outer: boundaryMm, holes: [] }], clip }).polygons
  const original = effective(source.boundaryMm)
  const prepared = rings.map(row => ({ tree: effective(row.tree), undergrowth: effective(row.undergrowth) }))
  const vegetation: ForestVegetation[][][] = rings.map(() => [[], []])
  for (const row of source.vegetation) {
    const target = estimateSurfaceRegionInstances(document, row.palette, { polygons: original, coveragePpm: row.coveragePpm })
    const regions = prepared.map(p => row.role === 'tree' ? p.tree : p.undergrowth)
    const areas = regions.map(areaMm2), total = areas[0] + areas[1]
    if (target && !total) throw new WoodlandSpaceError('活动空地已占满疏密林地区域；请调整空地或选择均匀散布。')
    const numerators = areas.map(area => area * BigInt(target))
    const counts = total ? numerators.map(value => Number(value / total)) : [0, 0]
    if (counts[0] + counts[1] < target) counts[total && numerators[1] % total > numerators[0] % total ? 1 : 0]++
    for (let index = 0; index < 2; index++) {
      const planting = index === 1 && row.role === 'tree' && secondTree ? { ...row, palette: secondTree } : row
      vegetation[index][row.role === 'tree' ? 0 : 1].push({ ...cloneJson(planting), coveragePpm: coverageForCount(document, planting, regions[index], counts[index]) })
    }
  }
  const prefix = `woodland-${sha256Text(source.id).slice(0, 16)}`
  return rings.flatMap((ring, index) => ([
    { id: `${prefix}:trees-${index + 1}`, supportRef: cloneJson(source.supportRef), boundaryMm: ring.tree, vegetation: vegetation[index][0] },
    { id: `${prefix}:undergrowth-${index + 1}`, supportRef: cloneJson(source.supportRef), boundaryMm: ring.undergrowth, vegetation: vegetation[index][1] },
  ]).filter(zone => zone.vegetation.length))
}

export function forestZonesForDistribution(document: SceneDocument, parameters: ForestParameters, seed: string, mode?: WoodlandDistribution,
  secondTree?: ForestVegetation['palette'], mixed?: Pick<MixedParameters, 'building' | 'approach'>) {
  if (!mode || mode === 'uniform') return parameters.zones
  let zones: Zone[]
  try { zones = createWoodlandZones(document, parameters, seed, secondTree, mode === 'auto' ? plantingReservations(parameters, mixed) : undefined) }
  catch (error) {
    if (mode !== 'auto' || !(error instanceof WoodlandSpaceError)) throw error
    zones = cloneJson(parameters.zones)
  }
  if (mode === 'auto') for (const zone of zones) for (const row of zone.vegetation) row.clusterVersion = 'cluster-v2'
  return zones
}
