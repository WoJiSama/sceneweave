import { describe, expect, it } from 'vitest'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { PointMm } from '../model/scene.js'
import type { ProjectedSurface, ProjectedVisualBoundary, ProjectedVisualSystem, Projection } from '../projection/types.js'
import type { VisualEdgeLook } from './types.js'
import { planTerrainCliffs, type TerrainCliffFace } from './terrain-cliff-plan.js'

const p = (x: number, y: number): PointMm => ({ x, y })
const rect = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
const surface = (id: string, points: PointMm[], elevationMm: number, priority: number): ProjectedSurface => ({ id, points, elevationMm, priority, style: null })
type Input = Pick<Projection, 'terrain' | 'visual'>
function fixture(terrain: ProjectedSurface[], sources: { id: string; points: PointMm[]; bound: string[]; closed?: boolean }[]): Input {
  const boundaries: ProjectedVisualBoundary[] = sources.map(source => ({ id: source.id, points: source.points,
    closed: source.closed ?? true, samples: [], lengthMm: source.points.reduce((sum, a, i, all) => {
      if (!source.closed && source.closed !== undefined && i === all.length - 1) return sum
      const b = all[(i + 1) % all.length]; return sum + Math.hypot(b.x - a.x, b.y - a.y)
    }, 0), terrainAreaIds: source.bound }))
  const edgeLooks: VisualEdgeLook[] = sources.map(source => ({ id: `${source.id}-look`, boundaryId: source.id,
    floorId: 'independent-floor', layerId: 'independent-details', visibility: 'public', editLocked: false,
    kind: 'cliff', side: 'both', widthMm: 3000, color: '#788493', accentColor: '#DEC69B',
    opacity: 1, intensity: 1, seed: 'independent-terrace-relief', repeatMm: 480, enabled: true, renderProfile: 'rockRelief6' }))
  const visual: ProjectedVisualSystem = { boundsMm: { x: -4000, y: -4000, width: 32000, height: 26000 }, boundaries, edgeLooks,
    environment: { ambientColor: '#FFFFFF', ambientOpacity: 0, exposure: 0, lightDirectionDeg: 225, contactShadowMm: 200, contactShadowOpacity: .2 },
    lights: [], fogs: [], filters: [], occluderRings: [], contactRings: [], suppressedTerrainEdgeIds: [] }
  return { terrain, visual }
}
const area = (points: number[][]) => Math.abs(points.reduce((sum, a, i, all) => {
  const b = all[(i + 1) % all.length]; return sum + a[0] * b[1] - b[0] * a[1]
}, 0) / 2)
const totalArea = (polygons: MultiPolygon) => polygons.reduce((sum, polygon) => sum + area(polygon[0]) - polygon.slice(1).reduce((holes, ring) => holes + area(ring), 0), 0)
// A paint face uses even-odd rings, so separate outer components and their
// holes must be reconstructed independently of flattening/order/winding.
const footprint = (face: TerrainCliffFace): MultiPolygon => {
  const polygons = face.rings.map(points => [points.map(a => [a.x, a.y])] as Polygon)
  return polygons.length ? polygonClipping.xor(polygons[0], ...polygons.slice(1)) : []
}
const assertDisjoint = (faces: TerrainCliffFace[]) => {
  expect(faces.length).toBeGreaterThan(0)
  const polygons = faces.map(footprint)
  polygons.forEach(polygon => expect(totalArea(polygon)).toBeGreaterThan(1))
  for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) {
    const overlap = totalArea(polygonClipping.intersection(polygons[i], polygons[j]))
    expect(overlap, `${faces[i].highId}->${faces[i].lowId} intersects ${faces[j].highId}->${faces[j].lowId}`).toBeLessThan(1)
  }
}
function sharedCoast() {
  const sea = surface('independent-sea', rect(-4000, -4000, 32000, 26000), 0, 0)
  const main = surface('independent-main', [p(0, 0), p(22000, 0), p(22000, 14000), p(13000, 14000), p(13000, 18000), p(0, 18000)], 2200, 1)
  const upper = surface('independent-upper', rect(13000, 0, 9000, 7000), 4200, 2)
  return fixture([sea, main, upper], [{ id: 'main-coast', points: main.points, bound: [main.id] },
    { id: 'upper-coast-and-inner-edge', points: upper.points, bound: [upper.id] }])
}

describe('joint height-aware terrain cliff planning', () => {
  it('resolves a three-height plateau/main/coast junction into disjoint owned faces without mutating inputs', () => {
    const source = sharedCoast(), before = structuredClone(source), faces = planTerrainCliffs(source)
    assertDisjoint(faces)
    expect(faces.some(face => face.highId === 'independent-main' && face.lowId === 'independent-sea' && face.highMm - face.lowMm === 2200)).toBe(true)
    expect(faces.some(face => face.highId === 'independent-upper' && face.lowId === 'independent-main' && face.highMm - face.lowMm === 2000)).toBe(true)
    expect(faces.some(face => face.highId === 'independent-upper' && face.lowId === 'independent-sea' && face.highMm - face.lowMm === 4200)).toBe(true)
    expect(source).toEqual(before)
    expect(planTerrainCliffs(source)).toEqual(faces)
    faces[0].rings[0][0].x += 10
    expect(source).toEqual(before)
  })

  it('uses the actual drop to grow exposed width and rocky shoulder under the same saved artistic width', () => {
    const sea = surface('drop-sea', rect(-4000, -4000, 32000, 26000), 0, 0)
    const land = surface('drop-land', rect(2000, 2000, 12000, 8000), 1000, 1)
    const source = fixture([sea, land], [{ id: 'single-south-face', points: [p(14000, 10000), p(2000, 10000)], bound: [land.id], closed: false }])
    const low = planTerrainCliffs(source)
    source.terrain[1].elevationMm = 4000
    const high = planTerrainCliffs(source)
    const average = (faces: TerrainCliffFace[], kind: 'inner' | 'foot') => {
      const cells = faces.flatMap(face => face.cells)
      return cells.reduce((sum, cell) => sum + Math.hypot(cell[kind][0].x - cell.crest[0].x, cell[kind][0].y - cell.crest[0].y), 0) / cells.length
    }
    expect(low).toHaveLength(1); expect(high).toHaveLength(1)
    expect(average(high, 'foot')).toBeGreaterThan(average(low, 'foot') * 3)
    expect(average(high, 'inner')).toBeGreaterThan(average(low, 'inner') * 3)
    expect(totalArea(footprint(high[0]))).toBeGreaterThan(totalArea(footprint(low[0])) * 3)
  })

  it('handles a concave headland and raised inner terrace without overlapping their face envelopes', () => {
    const sea = surface('concave-sea', rect(-4000, -4000, 32000, 26000), 0, 0)
    const main = surface('concave-main', [p(1000, 1000), p(20000, 1000), p(20000, 6500), p(13000, 6500), p(13000, 13000), p(20000, 13000), p(20000, 18000), p(1000, 18000)], 2800, 1)
    const upper = surface('concave-upper', rect(4000, 6000, 9000, 7000), 4700, 2)
    const faces = planTerrainCliffs(fixture([sea, main, upper], [{ id: 'concave-outside', points: main.points, bound: [main.id] },
      { id: 'concave-inner-terrace', points: upper.points, bound: [upper.id] }]))
    assertDisjoint(faces)
    expect(faces.every(face => face.highMm > face.lowMm && face.rings.every(ring => ring.every(a => Number.isFinite(a.x) && Number.isFinite(a.y))))).toBe(true)
  })

  it('recognizes the surrounding 5000 mm mountain as high beside a positive 1800 mm crater floor', () => {
    const mountain = surface('positive-mountain', rect(0, 0, 24000, 20000), 5000, 0)
    const crater = surface('positive-crater-floor', [p(6000, 5000), p(16000, 4500), p(18500, 9000), p(15000, 14500), p(7000, 14000), p(4500, 9000)], 1800, 1)
    const faces = planTerrainCliffs(fixture([mountain, crater], [{ id: 'positive-crater-boundary', points: crater.points, bound: [crater.id] }]))
    assertDisjoint(faces)
    expect(faces.every(face => face.highId === mountain.id && face.lowId === crater.id && face.highMm === 5000 && face.lowMm === 1800)).toBe(true)
  })

  it.each(['rockRelief7', 'rockRelief8', 'rockRelief9'] as const)('keeps visible ownership on %s and preserves the original profile6 plan', profile => {
    const source = sharedCoast(), baseline = planTerrainCliffs(source)
    source.visual!.edgeLooks.forEach(look => { look.renderProfile = profile })
    const natural = planTerrainCliffs(source)
    assertDisjoint(natural)
    expect(natural.every(face => face.natural?.planes.length)).toBe(true)
    if (profile === 'rockRelief8') expect(natural.every(face => face.natural && 'benches' in face.natural && face.natural.benches.length)).toBe(true)
    expect(natural.map(({ highId, lowId, highMm, lowMm }) => ({ highId, lowId, highMm, lowMm })))
      .toEqual(baseline.map(({ highId, lowId, highMm, lowMm }) => ({ highId, lowId, highMm, lowMm })))
    source.visual!.edgeLooks.forEach(look => { look.renderProfile = 'rockRelief6' })
    expect(planTerrainCliffs(source)).toEqual(baseline)
  })

  it('emits no cliff for equal visible heights, fully covered bindings or unbound decorative lines', () => {
    const sameHeight = sharedCoast()
    sameHeight.terrain.forEach(surface => { surface.elevationMm = 0 })
    expect(planTerrainCliffs(sameHeight)).toEqual([])
    const decorative = sharedCoast()
    decorative.visual!.boundaries.forEach(boundary => { boundary.terrainAreaIds = [] })
    expect(planTerrainCliffs(decorative)).toEqual([])
    const covered = sharedCoast()
    covered.terrain.push(surface('later-flat-cover', rect(-4000, -4000, 32000, 26000), 100, 3))
    expect(planTerrainCliffs(covered)).toEqual([])
  })

  it('uses fixed visual world bounds and complete projected geometry rather than a temporary canvas crop', () => {
    const source = sharedCoast(), expected = planTerrainCliffs(source)
    const crop = { ...source, bounds: { x: 11000, y: 3000, width: 4000, height: 5000 } }
    expect(planTerrainCliffs(crop)).toEqual(expected)
    const distantCrop = { ...source, bounds: { x: 100000, y: 100000, width: 500, height: 500 } }
    expect(planTerrainCliffs(distantCrop)).toEqual(expected)
  })
})
