import { describe, expect, it } from 'vitest'
import type { PointMm } from '../model/scene.js'
import { STAIRCASE_MATERIALS, STAIRCASE_PRESETS, staircaseMaterial } from './catalog.js'
import { defaultStaircase, staircaseMaterialIds, staircasePresetIds, type StaircaseConfig } from './contracts.js'
import { planStaircase, staircaseLocalPoint, staircasePatch, staircasePointAt } from './geometry.js'
import { drawStaircase } from '../../platform/browser/render/staircase-renderer.js'

const route = [{ x: 0, y: 0 }, { x: 1050, y: 0 }]
const signedArea = (p: PointMm[]) => p.reduce((sum, a, i) => sum + a.x * p[(i + 1) % p.length].y - a.y * p[(i + 1) % p.length].x, 0) / 2
const config = (patch: Partial<StaircaseConfig> = {}): StaircaseConfig => ({ ...defaultStaircase(), ...patch })

describe('dedicated staircase geometry', () => {
  it('repeats physical treads without stretching and keeps the final partial tread', () => {
    const geometry = planStaircase(route, 900, config())
    expect(geometry.treads.map(row => row.endMm - row.startMm)).toEqual([300, 300, 300, 150])
    expect(geometry.treads[0].frontMm).toEqual([{ x: 0, y: -450 }, { x: 0, y: 450 }])
    expect(geometry.treads.at(-1)!.rearMm).toEqual([{ x: 1050, y: -450 }, { x: 1050, y: 450 }])
    const extended = planStaircase([{ x: 0, y: 0 }, { x: 1300, y: 0 }], 900, config())
    expect(extended.treads.map(row => row.endMm - row.startMm)).toEqual([300, 300, 300, 300, 100])
  })

  it('stretches an exact saved step count independently of material scale', () => {
    const settings = config({ layout: { kind: 'stretch', stepCount: 5 }, textureScaleMm: 170 })
    expect(planStaircase(route, 900, settings).treads.map(row => row.endMm - row.startMm)).toEqual([210, 210, 210, 210, 210])
    const extended = planStaircase([{ x: 0, y: 0 }, { x: 1500, y: 0 }], 900, settings)
    expect(extended.treads.map(row => row.endMm - row.startMm)).toEqual([300, 300, 300, 300, 300])
    expect(settings.textureScaleMm).toBe(170)
  })

  it('partitions an entire curved footprint with shared seams, full width and no missing corner wedges', () => {
    const geometry = planStaircase([{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 2200, y: 600 }, { x: 2600, y: 1600 }], 500, config())
    expect(geometry.treads.every(tread => signedArea(tread.polygonMm) > 0)).toBe(true)
    const sum = geometry.treads.reduce((total, tread) => total + signedArea(tread.polygonMm), 0)
    expect(sum).toBeCloseTo(signedArea(geometry.footprintMm), 6)
    for (let i = 1; i < geometry.treads.length; i++) expect(geometry.treads[i - 1].rearMm).toEqual(geometry.treads[i].frontMm)
    expect(staircasePointAt(geometry, 0, 0.5)).toEqual({ x: 0, y: 250 })
    expect(staircasePatch(geometry, 0, geometry.lengthMm)).toEqual(geometry.footprintMm)
  })

  it('lays only the selected portion of an L-shaped route and retains the complete corner', () => {
    const points = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }]
    const geometry = planStaircase(points, 500, config({ range: { startPpm: 250_000, endPpm: 750_000 } }))
    expect(geometry.lengthMm).toBe(2000)
    expect(geometry.sections.map(section => section.distanceMm)).toEqual([0, 1000, 2000])
    expect(staircasePointAt(geometry, 0)).toEqual({ x: 1000, y: 0 })
    expect(staircasePointAt(geometry, 1000)).toEqual({ x: 2000, y: 0 })
    expect(staircasePointAt(geometry, 2000)).toEqual({ x: 2000, y: 1000 })
    expect(geometry.treads.at(-1)?.endMm).toBe(2000)
    expect(geometry.treads.reduce((total, tread) => total + signedArea(tread.polygonMm), 0)).toBeCloseTo(signedArea(geometry.footprintMm))
    expect(() => planStaircase(points, 500, config({ range: { startPpm: 750_000, endPpm: 250_000 } }))).toThrow(/铺阶终点/)
  })

  it('follows a road width profile while keeping the start and end of a selected stair section', () => {
    const line = [{ x: 0, y: 0 }, { x: 10000, y: 0 }]
    const geometry = planStaircase(line, 1400, config({ range: { startPpm: 200000, endPpm: 800000 } }), [
      { startPpm: 300000, endPpm: 700000, widthMm: 900 },
    ])
    expect(geometry.lengthMm).toBe(6000)
    expect(staircasePointAt(geometry, 0, .5)).toEqual({ x: 2000, y: 700 })
    expect(staircasePointAt(geometry, 3000, .5)).toEqual({ x: 5000, y: 450 })
    expect(staircasePointAt(geometry, 6000, -.5)).toEqual({ x: 8000, y: -700 })
  })

  it('retains exact geometry under a quarter turn and translation', () => {
    const points = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 2200, y: 600 }]
    const rotate = (p: PointMm) => ({ x: 3000 - p.y, y: -2000 + p.x })
    const first = planStaircase(points, 400, config()), second = planStaircase(points.map(rotate), 400, config())
    expect(second.lengthMm).toBeCloseTo(first.lengthMm)
    first.treads.forEach((tread, i) => tread.polygonMm.forEach((point, j) => {
      expect(second.treads[i].polygonMm[j].x).toBeCloseTo(rotate(point).x, 6)
      expect(second.treads[i].polygonMm[j].y).toBeCloseTo(rotate(point).y, 6)
    }))
  })

  it('uses an identical band when a saved route contains redundant collinear samples', () => {
    const a = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 1200 }]
    const b = [{ x: 0, y: 0 }, { x: 1199, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 1200 }]
    expect(planStaircase(a, 500, config())).toEqual(planStaircase(b, 500, config()))
  })

  it('maps saved reversible covers with the route without deleting any stair geometry', () => {
    const settings = config({ covers: [{ id: 'soil-edge', kind: 'reveal-ground', pointsPpm: [{ x: 200000, y: -500000 }, { x: 800000, y: -500000 }, { x: 800000, y: 0 }, { x: 200000, y: 0 }] }] })
    const before = structuredClone(settings)
    const covered = planStaircase(route, 900, settings), clear = planStaircase(route, 900, config())
    expect(covered.treads).toEqual(clear.treads)
    expect(covered.covers[0].polygonMm).toContainEqual({ x: 210, y: -450 })
    expect(covered.covers[0].polygonMm).toContainEqual({ x: 840, y: 0 })
    expect(staircaseLocalPoint(route, 900, { x: 200000, y: -500000 })).toEqual({ x: 210, y: -450 })
    expect(settings).toEqual(before)
    const long = planStaircase([{ x: 0, y: 0 }, { x: 2100, y: 0 }], 900, settings)
    expect(long.covers[0].polygonMm).toContainEqual({ x: 420, y: -450 })
  })

  it('validates cover intersections and zero area rather than silently omitting edits', () => {
    const pointsPpm = [{ x: 0, y: -500000 }, { x: 1000000, y: 500000 }, { x: 0, y: 500000 }, { x: 1000000, y: -500000 }]
    expect(() => planStaircase(route, 900, config({ covers: [{ id: 'bad', kind: 'earth', pointsPpm }] }))).toThrow()
    expect(() => planStaircase(route, 900, config({ covers: [{ id: 'bad', kind: 'rock', pointsPpm: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }] }] }))).toThrow()
  })

  it('rejects route self overlap, inside folds, reversals and budgets', () => {
    expect(() => planStaircase([{ x: 0, y: 0 }, { x: 0, y: 0 }], 900, config())).toThrow(/零长/)
    expect(() => planStaircase([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 0 }], 900, config())).toThrow(/转弯/)
    expect(() => planStaircase([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 1000 }], 900, config())).toThrow()
    expect(() => planStaircase([{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }, { x: 1000, y: 0 }], 100, config())).toThrow()
    expect(() => planStaircase([{ x: 0, y: 0 }, { x: 153601, y: 0 }], 900, config())).toThrow(/512/)
    expect(() => planStaircase(route, -1, config())).toThrow(/宽度/)
    expect(() => planStaircase([{ x: 0.5, y: 0 }, { x: 1000, y: 0 }], 900, config())).toThrow(/整数/)
  })

  it('offers every saved construction and material with stable independent IDs', () => {
    expect(STAIRCASE_PRESETS.map(row => row.id)).toEqual([...staircasePresetIds])
    expect(STAIRCASE_MATERIALS.map(row => row.id)).toEqual([...staircaseMaterialIds])
    expect(new Set(STAIRCASE_PRESETS.map(row => row.description)).size).toBe(10)
    for (const preset of STAIRCASE_PRESETS) expect(STAIRCASE_MATERIALS.some(row => row.id === preset.defaultMaterial)).toBe(true)
    for (const material of STAIRCASE_MATERIALS) expect(planStaircase(route, 900, config({ material: material.id })).treads).toEqual(planStaircase(route, 900, config()).treads)
  })

  it('draws ten distinct constructions as native crisp paths using the same material', () => {
    const traces = STAIRCASE_PRESETS.map(preset => {
      const { context, calls } = recordingContext()
      drawStaircase(context, route, 900, config({ preset: preset.id }))
      expect(calls.some(row => row[0] === 'fill')).toBe(true)
      expect(calls.some(row => /Gradient|drawImage/.test(String(row[0])))).toBe(false)
      expect(calls.filter(row => row[0] === 'set:filter').every(row => row[1] === 'none')).toBe(true)
      expect(calls.filter(row => row[0] === 'set:shadowBlur').every(row => row[1] === 0)).toBe(true)
      expect(calls.filter(row => row[0] === 'save')).toHaveLength(calls.filter(row => row[0] === 'restore').length)
      return JSON.stringify(calls)
    })
    expect(new Set(traces).size).toBe(10)
  })

  it('subtracts overlapping reveal masks individually without erasing already rendered ground', () => {
    const pointsPpm = [{ x: 0, y: -500000 }, { x: 600000, y: -500000 }, { x: 600000, y: 0 }, { x: 0, y: 0 }]
    const { context, calls } = recordingContext()
    drawStaircase(context, route, 900, config({ covers: [{ id: 'a', kind: 'reveal-ground', pointsPpm }, { id: 'b', kind: 'reveal-ground', pointsPpm: pointsPpm.map(p => ({ x: p.x + 100000, y: p.y })) }] }))
    expect(calls.filter(row => row[0] === 'clip' && row[1] === 'evenodd')).toHaveLength(2)
    expect(calls.some(row => row.includes('destination-out') || row[0] === 'clearRect')).toBe(false)
  })

  it('preserves world-size wood grain when fixed-count treads stretch, adding grain instead of enlarging it', () => {
    for (const preset of ['timber', 'boardwalk'] as const) {
      const settings = config({ preset, material: 'oak', layout: { kind: 'stretch', stepCount: 3 }, textureScaleMm: 350 })
      const short = recordingContext(), long = recordingContext()
      drawStaircase(short.context, [{ x: 0, y: 0 }, { x: 900, y: 0 }], 900, settings)
      drawStaircase(long.context, [{ x: 0, y: 0 }, { x: 1800, y: 0 }], 900, settings)
      const colour = staircaseMaterial('oak').palette.grain
      const before = colouredPaths(short.calls, colour, 'stroke'), after = colouredPaths(long.calls, colour, 'stroke')
      expect(before.length).toBeGreaterThan(6)
      expect(after.length).toBeGreaterThan(before.length)
      const afterKeys = new Set(after.map(path => JSON.stringify(path)))
      for (const path of before) expect(afterKeys.has(JSON.stringify(path))).toBe(true)
    }
  })

  it('retains repeat texture prefixes and uses textureScaleMm to change the actual grain spacing', () => {
    const settings = config({ preset: 'timber', material: 'oak' })
    const original = recordingContext(), extended = recordingContext(), coarse = recordingContext()
    drawStaircase(original.context, [{ x: 0, y: 0 }, { x: 900, y: 0 }], 900, settings)
    drawStaircase(extended.context, [{ x: 0, y: 0 }, { x: 1800, y: 0 }], 900, settings)
    drawStaircase(coarse.context, [{ x: 0, y: 0 }, { x: 900, y: 0 }], 900, { ...settings, textureScaleMm: 700 })
    const colour = staircaseMaterial('oak').palette.grain
    const before = colouredPaths(original.calls, colour, 'stroke'), after = colouredPaths(extended.calls, colour, 'stroke'), bigger = colouredPaths(coarse.calls, colour, 'stroke')
    expect(after.slice(0, before.length)).toEqual(before)
    expect(bigger.length).toBeLessThan(before.length)
    const x = (path: unknown[][]) => path.find(row => row[0] === 'moveTo')![1] as number
    expect(x(bigger[1]) - x(bigger[0])).toBeCloseTo((x(before[1]) - x(before[0])) * 2, 6)
  })

  it('keeps stone speck dimensions and positions in world units when treads stretch', () => {
    const settings = config({ preset: 'cut-stone', layout: { kind: 'stretch', stepCount: 1 } })
    const short = recordingContext(), long = recordingContext()
    drawStaircase(short.context, [{ x: 0, y: 0 }, { x: 900, y: 0 }], 900, settings)
    drawStaircase(long.context, [{ x: 0, y: 0 }, { x: 1800, y: 0 }], 900, settings)
    const colour = staircaseMaterial(settings.material).palette.grain
    const before = colouredPaths(short.calls, colour, 'fill').filter(path => path.every(row => typeof row[1] !== 'number' || row[1] < 700))
    const after = new Set(colouredPaths(long.calls, colour, 'fill').map(path => JSON.stringify(path)))
    expect(before.length).toBeGreaterThan(5)
    for (const path of before) expect(after.has(JSON.stringify(path))).toBe(true)
  })
})

function colouredPaths(calls: unknown[][], colour: string, operation: 'stroke' | 'fill'): unknown[][][] {
  const result: unknown[][][] = []
  let current: unknown[][] = [], active = ''
  for (const row of calls) {
    if (row[0] === `set:${operation}Style`) active = String(row[1])
    if (row[0] === 'beginPath') current = []
    if (['moveTo', 'lineTo', 'closePath', 'arc'].includes(String(row[0]))) current.push(row.map(value => typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value))
    if (row[0] === operation && active === colour) result.push(current)
  }
  return result
}

function recordingContext(): { context: CanvasRenderingContext2D; calls: unknown[][] } {
  const calls: unknown[][] = [], values: Record<string, unknown> = {}
  const context = new Proxy(values, {
    get: (target, property) => typeof property === 'string' && Object.hasOwn(target, property) ? target[property] : (...args: unknown[]) => { calls.push([String(property), ...args]) },
    set: (target, property, value: unknown) => { target[String(property)] = value; calls.push([`set:${String(property)}`, value]); return true },
  }) as unknown as CanvasRenderingContext2D
  return { context, calls }
}
