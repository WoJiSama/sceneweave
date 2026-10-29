import { describe, expect, it } from 'vitest'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { signedVisualArea } from '../visual/geometry.js'
import { evaluateCompositionField, planTerrainComposition, recomputeCompositionThreshold, TerrainCompositionError,
  type TerrainCompositionFeature, type TerrainCompositionInput, type TerrainCompositionMember } from './composition-field.js'

const ellipse = (id: string, x: number, y: number, rx: number, ry: number, kind: 'landmass' | 'lakeBasin' | 'forest' | 'clearing' | 'plateau' = 'landmass'): TerrainCompositionFeature => ({
  id, floorId: 'ground', layerId: 'terrain', visibility: 'public', editLocked: false, kind,
  shape: { kind: 'ellipse', centerMm: { x, y }, radiusXMm: rx, radiusYMm: ry, rotationMilliDeg: 0 },
  elevationMm: 800, roughnessPpm: 0, seedKey: `stream-${id}`,
})
const member = (featureId: string, operation: 'add' | 'subtract' | 'max' = 'add', weightPpm = 1_000_000, field: 'land' | 'elevation' | 'vegetation' = 'land'): TerrainCompositionMember => ({ featureId, field, operation, weightPpm })
function input(): TerrainCompositionInput {
  return { seed: 'three-shores', boundsMm: { x: 0, y: 0, width: 48000, height: 36000 },
    precision: { sampleSpacingMm: 1000, toleranceMm: 1500, noiseCellMm: 4500 }, baseElevationMm: 0,
    landCoveragePpm: 240000, elevationCoveragePpm: 100000,
    features: { west: ellipse('west', 10000, 18000, 6500, 8500), middle: ellipse('middle', 25000, 18000, 6500, 8500), east: ellipse('east', 39000, 18000, 6500, 8500) },
    members: [member('west'), member('middle'), member('east')] }
}
const errorCode = (action: () => unknown): string => { try { action(); return 'NO_ERROR' } catch (error) { if (!(error instanceof TerrainCompositionError)) throw error; return error.code } }

describe('T9 pure terrain composition', () => {
  it('keeps three complete independent components, integer geometry and explicit adoption accounting', () => {
    const request = input(), before = canonicalJson(request), plan = planTerrainComposition(request)
    expect(canonicalJson(request)).toBe(before)
    expect(plan.fields.land.polygons).toHaveLength(3)
    expect(plan.fields.land.polygons.every(polygon => polygon.holes.length === 0)).toBe(true)
    expect(plan.fields.land.polygons.every(polygon => polygon.outer.length >= 3 && polygon.outer.length <= 8)).toBe(true)
    for (const contour of plan.fields.land.contours) {
      expect(contour.pointsMm.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
      expect(signedVisualArea(contour.pointsMm)).toBeGreaterThan(0)
      expect(contour.pointsMm[0]).not.toEqual(contour.pointsMm.at(-1))
    }
    expect(plan.fields.elevation.polygons).toEqual([])
    expect(plan.fields.vegetation.polygons).toEqual([])
    expect(plan.thresholds.elevation).toBeUndefined()
    expect(plan.geometryBudget).toMatchObject({ gridNodes: 49 * 37, polygons: 3, rings: 3, finalAdoptionCostChecked: false })
    expect(plan.geometryBudget.points).toBe(plan.fields.land.vertexCount)
    expect(Object.isFrozen(plan.thresholds.land!.sourceInput.features.west.shape)).toBe(true)
    expect(canonicalJson(planTerrainComposition(request))).toBe(canonicalJson(plan))
  })

  it('keys random channels by feature identity and seedKey, independently of dictionary order and unrelated fields', () => {
    const first = input()
    first.features.west.roughnessPpm = 500000
    const second = cloneJson(first)
    second.features = Object.fromEntries(Object.entries(second.features).reverse())
    second.features.unused = ellipse('unused', 24000, 18000, 2000, 2000, 'forest')
    second.members.unshift(member('unused', 'add', 500000, 'vegetation'))
    for (const point of [{ x: 8000, y: 12000 }, { x: 12000, y: 21000 }, { x: 30000, y: 24000 }]) expect(evaluateCompositionField(first, 'land', point)).toBe(evaluateCompositionField(second, 'land', point))
    const point = { x: 13500, y: 18000 }, original = evaluateCompositionField(first, 'land', point)
    second.features.west.seedKey = 'changed-channel'
    expect(evaluateCompositionField(second, 'land', point)).not.toBe(original)
    expect(planTerrainComposition(first).fields.land).toEqual(planTerrainComposition({ ...first, features: Object.fromEntries(Object.entries(first.features).reverse()) }).fields.land)
  })

  it.each(['coast-1', 'coast-2', 'coast-3', 'coast-4', 'coast-5'])('keeps complete keyed multi-island geometry for seed %s', seed => {
    const request = input(); request.seed = seed
    for (const feature of Object.values(request.features)) feature.roughnessPpm = 300000
    const plan = planTerrainComposition(request)
    expect(plan.fields.land.polygons).toHaveLength(3)
    expect(plan.fields.land.polygons.every(polygon => polygon.holes.length === 0)).toBe(true)
    expect(plan.geometryBudget.points).toBeLessThanOrEqual(8192)
    expect(canonicalJson(planTerrainComposition(request))).toBe(canonicalJson(plan))
  })

  it('executes real weighted add, subtract and max in declared order without changing their random keys', () => {
    const request = input(), point = { x: 24000, y: 18000 }
    request.features = { a: ellipse('a', 24000, 18000, 10000, 10000), b: ellipse('b', 24000, 18000, 10000, 10000) }
    request.members = [member('a', 'add', 500000), member('b', 'add', 500000)]
    expect(evaluateCompositionField(request, 'land', point)).toBe(500000)
    request.members = [member('a'), member('b', 'subtract', 500000)]
    expect(evaluateCompositionField(request, 'land', point)).toBe(333333)
    request.members = [member('a', 'add', 750000), member('b', 'max', 500000)]
    expect(evaluateCompositionField(request, 'land', point)).toBe(428571)
    request.members.reverse()
    expect(evaluateCompositionField(request, 'land', point)).toBe(555556)
    request.members = [member('a', 'subtract')]
    expect(evaluateCompositionField(request, 'land', point)).toBe(-500000)
  })

  it('retains an enclosed lake as a clockwise hole instead of filling it or dropping the component', () => {
    const request = input()
    request.features = { land: ellipse('land', 24000, 18000, 21000, 16000), lake: ellipse('lake', 24000, 18000, 7000, 6000, 'lakeBasin') }
    request.members = [member('land', 'add', 700000), member('lake', 'subtract')]
    request.landCoveragePpm = 400000; request.precision.toleranceMm = 500
    const plan = planTerrainComposition(request), polygon = plan.fields.land.polygons[0]
    expect(plan.fields.land.polygons).toHaveLength(1)
    expect(polygon.holes).toHaveLength(1)
    expect(signedVisualArea(polygon.outer)).toBeGreaterThan(0)
    expect(signedVisualArea(polygon.holes[0])).toBeLessThan(0)
    expect(plan.fields.land.contours.map(contour => contour.hole)).toEqual([false, true])
    expect(plan.fields.land.areaMm2).toBeCloseTo(signedVisualArea(polygon.outer) + signedVisualArea(polygon.holes[0]), 5)
  })

  it('closes river cuts at the actual candidate bounds, including a grid overshoot', () => {
    const request = input()
    request.boundsMm.width = 47500; request.boundsMm.height = 35500
    request.features = { land: ellipse('land', 24000, 18000, 80000, 80000), river: { id: 'river', floorId: 'ground', layerId: 'terrain', visibility: 'public', editLocked: false,
      kind: 'riverValley', shape: { kind: 'corridor', pointsMm: [{ x: 24000, y: 0 }, { x: 24000, y: 35500 }], widthMm: 6000 }, elevationMm: 0, roughnessPpm: 0, seedKey: 'river-stable' } }
    request.members = [member('land'), member('river', 'subtract')]; request.landCoveragePpm = 700000
    const plan = planTerrainComposition(request)
    expect(plan.fields.land.polygons).toHaveLength(2)
    for (const polygon of plan.fields.land.polygons) {
      expect(polygon.holes).toEqual([])
      expect(polygon.outer.some(point => point.y === 0)).toBe(true)
      expect(polygon.outer.some(point => point.y === request.boundsMm.height)).toBe(true)
      expect(polygon.outer.every(point => point.x >= 0 && point.y >= 0 && point.x <= request.boundsMm.width && point.y <= request.boundsMm.height)).toBe(true)
    }
    expect(plan.grid.originMm.x + (plan.grid.columns - 1) * plan.grid.spacingMm).toBeGreaterThan(request.boundsMm.width)
  })

  it('preserves a frozen global threshold and full source after one local feature moves', () => {
    const original = input(), first = planTerrainComposition(original), edited = cloneJson(original)
    const shape = edited.features.west.shape
    if (shape.kind !== 'ellipse') throw new Error('fixture')
    shape.centerMm.x += 1000
    edited.frozenThresholds = { land: first.thresholds.land! }
    const second = planTerrainComposition(edited)
    expect(second.thresholds.land).toEqual(first.thresholds.land)
    expect(second.thresholds.land!.sourceInput.features.west.shape).toEqual(original.features.west.shape)
    expect(second.fields.land.polygons[0]).not.toEqual(first.fields.land.polygons[0])
    expect(second.fields.land.polygons.slice(1)).toEqual(first.fields.land.polygons.slice(1))
    expect(second.input.features.west.shape).toEqual(edited.features.west.shape)
  })

  it('recomputes cold-read thresholds from the full original source and refuses forged thresholds/grid', () => {
    const request = input(), plan = planTerrainComposition(request), threshold = plan.thresholds.land!
    expect(recomputeCompositionThreshold(threshold.sourceInput, 'land', threshold.targetCoveragePpm, threshold.grid)).toBe(threshold.valueQ)
    expect(errorCode(() => recomputeCompositionThreshold(threshold.sourceInput, 'land', threshold.targetCoveragePpm, { ...threshold.grid, columns: threshold.grid.columns + 1 }))).toBe('THRESHOLD_GRID')
    request.frozenThresholds = { land: { ...cloneJson(threshold), valueQ: threshold.valueQ + 1 } }
    expect(errorCode(() => planTerrainComposition(request))).toBe('FROZEN_THRESHOLD')
    request.frozenThresholds = { land: threshold }; request.landCoveragePpm++
    expect(errorCode(() => planTerrainComposition(request))).toBe('FROZEN_THRESHOLD')
  })

  it('provides exact empty/full extrema while reporting unattainable tied coverage honestly', () => {
    const request = input()
    request.landCoveragePpm = 0
    const empty = planTerrainComposition(request)
    expect(empty.fields.land.polygons).toEqual([])
    expect(empty.fields.land.sampledCoveragePpm).toBe(0)
    request.landCoveragePpm = 1_000_000
    const full = planTerrainComposition(request)
    expect(full.fields.land.polygons).toHaveLength(1)
    expect(full.fields.land.polygons[0].outer).toHaveLength(4)
    expect(full.fields.land.areaMm2).toBe(request.boundsMm.width * request.boundsMm.height)
    expect(full.fields.land.sampledCoveragePpm).toBe(1_000_000)
    request.features = { level: ellipse('level', 24000, 18000, 15000, 15000, 'plateau') }
    request.features.level.elevationMm = 0
    request.members = [member('level', 'add', 1_000_000, 'elevation')]; request.elevationCoveragePpm = 500000
    const flat = planTerrainComposition(request)
    expect(flat.fields.elevation.sampledCoveragePpm).toBe(0)
    expect(flat.fields.elevation.coverageErrorPpm).toBe(-500000)
    expect(flat.fields.elevation.polygons).toEqual([])
  })

  it('uses actual elevations relative to the fixed base, independently of unrelated land features', () => {
    const request = input()
    request.features = { ridge: { id: 'ridge', floorId: 'ground', layerId: 'terrain', visibility: 'public', editLocked: false, kind: 'ridge',
      shape: { kind: 'corridor', pointsMm: [{ x: 10000, y: 18000 }, { x: 38000, y: 18000 }], widthMm: 8000 }, elevationMm: 3200, roughnessPpm: 0, seedKey: 'ridge' } }
    request.members = [member('ridge', 'add', 1_000_000, 'elevation')]
    expect(evaluateCompositionField(request, 'elevation', { x: 24000, y: 18000 })).toBe(242424)
    request.baseElevationMm = 3200
    expect(evaluateCompositionField(request, 'elevation', { x: 24000, y: 18000 })).toBe(0)
    request.baseElevationMm = 6400
    expect(evaluateCompositionField(request, 'elevation', { x: 24000, y: 18000 })).toBe(-242424)
  })

  it('rejects grid exhaustion before allocating large fields and enforces feature/reference/floor/operation limits', () => {
    const dense = input(); dense.precision.sampleSpacingMm = 1
    expect(errorCode(() => planTerrainComposition(dense))).toBe('GRID_LIMIT')
    const duplicate = input(); duplicate.members.push(member('west'))
    expect(errorCode(() => planTerrainComposition(duplicate))).toBe('DUPLICATE_MEMBER')
    const missing = input(); missing.members[0].featureId = 'missing'
    expect(errorCode(() => planTerrainComposition(missing))).toBe('FEATURE_REFERENCE')
    const wrongField = input(); wrongField.members[0].field = 'elevation'
    expect(errorCode(() => planTerrainComposition(wrongField))).toBe('FEATURE_FIELD')
    const floor = input(); floor.features.middle.floorId = 'other'
    expect(errorCode(() => planTerrainComposition(floor))).toBe('FLOOR_MISMATCH')
    const tooMany = input(); tooMany.features = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`f${i}`, ellipse(`f${i}`, 24000, 18000, 1000, 1000)]))
    expect(errorCode(() => planTerrainComposition(tooMany))).toBe('FEATURE_LIMIT')
  })

  it('rejects getters, hidden/unknown fields and malformed shape branches without executing caller code', () => {
    const getter = input(); let calls = 0
    Object.defineProperty(getter, 'landCoveragePpm', { get: () => { calls++; return 100000 }, enumerable: true })
    expect(errorCode(() => planTerrainComposition(getter))).toBe('INVALID_INPUT')
    expect(calls).toBe(0)
    const hidden = input(); Object.defineProperty(hidden.features.west, 'hidden', { value: 'secret' })
    expect(errorCode(() => planTerrainComposition(hidden))).toBe('INVALID_INPUT')
    expect(errorCode(() => planTerrainComposition({ ...input(), fallback: true }))).toBe('INVALID_INPUT')
    const wrongShape = input()
    wrongShape.features.west.shape = { kind: 'corridor', pointsMm: [{ x: 1, y: 1 }, { x: 2, y: 2 }], widthMm: 100 }
    expect(errorCode(() => planTerrainComposition(wrongShape))).toBe('INVALID_INPUT')
    expect(errorCode(() => evaluateCompositionField(input(), 'land', { x: NaN, y: 0 }))).toBe('INVALID_INPUT')
  })
})
