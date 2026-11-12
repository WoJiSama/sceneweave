import type { PointMm, SceneDocument } from '../../shared/model/scene.js'
import type { ForestParameters, ForestVegetation } from '../../shared/generation/domains/forest/contracts.js'
import { forestRectangle } from '../../shared/generation/domains/forest/index.js'
import { estimateSurfaceRegionInstances } from '../../shared/decorations/generate.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../../shared/geometry/polygon-boolean.js'
import { cloneJson } from '../../shared/validation/json.js'
import { sha256Text } from '../../shared/validation/hash.js'

export type WoodlandDistribution = 'uniform' | 'copses'
type Zone = ForestParameters['zones'][number]

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
  if (!denominator) throw new Error('活动空地已占满疏密林地区域；请调整空地或选择均匀散布。')
  const numerator = BigInt(count) * weightedArea * 1_000_000n
  const coveragePpm = Number((numerator + denominator - 1n) / denominator)
  if (coveragePpm > 1_000_000 || estimateSurfaceRegionInstances(document, row.palette, { polygons, coveragePpm }) !== count) {
    throw new Error('疏密林地区域不足以保留当前植被目标；请降低覆盖目标或选择均匀散布。')
  }
  return coveragePpm
}

/** A form preset expands to ordinary, complete forest inputs. Existing recipes,
 * forest algorithms and cluster-v1 never read or reinterpret this choice. */
export function createWoodlandZones(document: SceneDocument, parameters: ForestParameters, seed: string): Zone[] {
  const b = parameters.boundsMm, source = parameters.zones[0], rectangle = forestRectangle(b)
  if (parameters.zones.length !== 1 || source.boundaryMm.length !== 4
    || !rectangle.every(p => source.boundaryMm.some(q => p.x === q.x && p.y === q.y))) {
    throw new Error('疏密林地目前用于单块完整矩形林区；已有分区请使用均匀散布。')
  }
  if (b.width < 16000 || b.height < 16000) throw new Error('疏密林地需要宽和高至少16米；请扩大地图或选择均匀散布。')
  const hash = sha256Text(JSON.stringify(['sceneweave-woodland-form', 1, seed]))
  const unit = (channel: number) => Number.parseInt(hash.slice(channel * 2, channel * 2 + 2), 16) / 255
  const flip = unit(0) < .5
  // Each copse stays in its own half. The larger undergrowth envelope contains
  // its core; opposing envelopes remain apart without partitioning the map.
  const rings = [0, 1].map(index => {
    const cx = .26 + index * .48, cy = (index === 0) !== flip ? .34 : .66
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
    if (target && !total) throw new Error('活动空地已占满疏密林地区域；请调整空地或选择均匀散布。')
    const numerators = areas.map(area => area * BigInt(target))
    const counts = total ? numerators.map(value => Number(value / total)) : [0, 0]
    if (counts[0] + counts[1] < target) counts[total && numerators[1] % total > numerators[0] % total ? 1 : 0]++
    for (let index = 0; index < 2; index++) {
      vegetation[index][row.role === 'tree' ? 0 : 1].push({ ...cloneJson(row), coveragePpm: coverageForCount(document, row, regions[index], counts[index]) })
    }
  }
  const prefix = `woodland-${sha256Text(source.id).slice(0, 16)}`
  return rings.flatMap((ring, index) => ([
    { id: `${prefix}:trees-${index + 1}`, supportRef: cloneJson(source.supportRef), boundaryMm: ring.tree, vegetation: vegetation[index][0] },
    { id: `${prefix}:undergrowth-${index + 1}`, supportRef: cloneJson(source.supportRef), boundaryMm: ring.undergrowth, vegetation: vegetation[index][1] },
  ]).filter(zone => zone.vegetation.length))
}
