import { describe, expect, it } from 'vitest'
import { taskBudgetProfile, withExecutionWorkObserver } from '../../../budget/task-budget.js'
import { cloneJson, canonicalJson } from '../../../validation/json.js'
import type { InteriorGenerationInput, InteriorLayout } from './contracts.js'
import { checkInteriorLayout, solveInteriorLayout } from './layout.js'

const profile = taskBudgetProfile('small')
function input(): InteriorGenerationInput {
  return { version: 1, algorithmVersion: 10, seed: 'layout-quality', parameters: {
    floorId: 'floor', layerId: 'layer', boundsMm: { x: 0, y: 0, width: 20000, height: 16000 }, wallThicknessMm: 200,
    rooms: [
      { id: 'common', purpose: '旅店餐厅与酒馆', minAreaMm2: 48_000_000, maxAreaMm2: 140_000_000, minClearSideMm: 4500 },
      { id: 'guest-east', purpose: '客房', minAreaMm2: 16_000_000, maxAreaMm2: 42_000_000, minClearSideMm: 3000 },
      { id: 'guest-west', purpose: '客房', minAreaMm2: 16_000_000, maxAreaMm2: 42_000_000, minClearSideMm: 3000 },
      { id: 'kitchen', purpose: '厨房', minAreaMm2: 18_000_000, maxAreaMm2: 55_000_000, minClearSideMm: 3200 },
      { id: 'pantry', purpose: '储藏室', minAreaMm2: 10_000_000, maxAreaMm2: 30_000_000, minClearSideMm: 2500 },
    ], relations: [], corridor: { axis: 'horizontal', clearWidthMm: 1600 }, materials: { floor: null, wall: null },
    arrangement: { doors: false, entrance: false, furniture: false, doorWidthMm: 1400, clearWidthMm: 1000, palette: [] },
  } }
}
const solve = (value: InteriorGenerationInput, cancelled = () => {}) => solveInteriorLayout('layout-quality-scene', value, profile, 'layout-proof', cancelled)
const corridorArea = (layout: InteriorLayout) => layout.corridors.reduce((n, c) => n + (c.boundsMm.width - 200) * (c.boundsMm.height - 200), 0)

describe('bounded room proportions and corridor families', () => {
  it('lets a middle storage requirement take the long strip rather than spending all four comparisons on a long kitchen', () => {
    const value = input(); value.algorithmVersion = 11; value.parameters.corridor.axis = 'none'
    value.parameters.boundsMm = { x: 26500, y: 8360, width: 19000, height: 16340 }
    value.parameters.rooms = [
      { id: 'room-1', purpose: '值守卧室', minAreaMm2: 12_710_000, maxAreaMm2: 114_390_000, minClearSideMm: 2200 },
      { id: 'room-2', purpose: '补给仓库', minAreaMm2: 12_710_000, maxAreaMm2: 114_390_000, minClearSideMm: 2200 },
      { id: 'room-3', purpose: '厨房', minAreaMm2: 12_710_000, maxAreaMm2: 114_390_000, minClearSideMm: 2200 },
    ]
    let attempts = 0, nodes = 0
    const result = withExecutionWorkObserver(delta => { attempts += delta.candidateAttempts ?? 0; nodes += delta.gridNodes ?? 0 }, () => solve(value))
    expect(checkInteriorLayout(value, result)).toEqual([])
    const kitchen = result.rooms.find(r => r.requirementId === 'room-3')!.boundsMm
    expect(Math.max(kitchen.width - 200, kitchen.height - 200) / Math.min(kitchen.width - 200, kitchen.height - 200)).toBeLessThan(1.8)
    expect(attempts).toBe(4); expect(nodes).toBeLessThanOrEqual(8192)
    const reordered = cloneJson(value); reordered.parameters.rooms.reverse()
    expect(solve(reordered)).toEqual(result)
  })

  it.each(['horizontal', 'vertical'] as const)('shortens a real %s corridor while preserving all room areas, full-wall bounds and complete tiling', axis => {
    const value = input(); value.parameters.corridor.axis = axis
    if (axis === 'vertical') value.parameters.boundsMm = { x: -1200, y: 3000, width: 16000, height: 20000 }
    const before = canonicalJson(value), old = solve({ ...value, algorithmVersion: 9 }), result = solve(value)
    expect(checkInteriorLayout(value, result)).toEqual([])
    expect(corridorArea(result)).toBeLessThan(corridorArea(old) * .7)
    const rooms = result.rooms.filter(r => r.requirementId.startsWith('guest'))
    for (const room of rooms) {
      const w = room.boundsMm.width - 200, h = room.boundsMm.height - 200
      expect(Math.max(w / h, h / w)).toBeLessThan(1.7)
    }
    const gross = [...result.rooms, ...result.corridors].reduce((n, r) => n + r.boundsMm.width * r.boundsMm.height, 0)
    expect(gross).toBe((value.parameters.boundsMm.width - 200) * (value.parameters.boundsMm.height - 200))
    expect(solve(value)).toEqual(result); expect(canonicalJson(value)).toBe(before)
  })

  it.each([1, 2, 3, 6, 12, 24])('supports %s rooms without an imposed corridor or a square-room requirement', count => {
    const value = input(); value.parameters.corridor.axis = 'none'
    value.parameters.boundsMm = { x: 0, y: 0, width: 32000, height: 24000 }
    value.parameters.rooms = Array.from({ length: count }, (_, i) => ({ id: `room-${i}`, purpose: i % 2 ? '仓库' : '卧室', minAreaMm2: 1_000_000, maxAreaMm2: 1_000_000_000, minClearSideMm: 1000 }))
    const result = solve(value)
    expect(result.rooms).toHaveLength(count); expect(result.corridors).toHaveLength(0)
    expect(checkInteriorLayout(value, result)).toEqual([])
  })

  it('meters completed comparisons and finite search work in the existing four-attempt envelope', () => {
    let attempts = 0, nodes = 0, fields = 0
    withExecutionWorkObserver(delta => { attempts += delta.candidateAttempts ?? 0; nodes += delta.gridNodes ?? 0; fields += delta.fieldEvaluations ?? 0 }, () => solve(input()))
    expect(attempts).toBe(4); expect(nodes).toBeGreaterThan(4); expect(nodes).toBeLessThanOrEqual(8192); expect(fields).toBeGreaterThan(nodes)
    expect(profile.limits.candidateAttempts).toBe(4)
  })

  it('keeps explicit adjacency and separation hard and reports exhausted finite search honestly', () => {
    const value = input(); value.parameters.relations = [{ a: 'kitchen', b: 'pantry', kind: 'adjacent', minimumSharedWallMm: 3200 }]
    expect(checkInteriorLayout(value, solve(value))).toEqual([])
    const impossible = input(); impossible.parameters.rooms = impossible.parameters.rooms.slice(0, 2)
    impossible.parameters.rooms.forEach(r => { r.maxAreaMm2 = 400_000_000 })
    impossible.parameters.corridor.axis = 'none'
    impossible.parameters.relations = [{ a: 'common', b: 'guest-east', kind: 'separate', minimumSharedWallMm: 0 }]
    expect(() => solve(impossible)).toThrow(/有限.*不证明需求不可行/)
  })

  it('keeps single-room corridors explicit and observes cancellation during planning', () => {
    const value = input(); value.parameters.rooms = [{ id: 'hall', purpose: '展廊', minAreaMm2: 260_000_000, maxAreaMm2: 275_000_000, minClearSideMm: 1000 }]
    expect(checkInteriorLayout(value, solve(value))).toEqual([])
    let ticks = 0
    expect(() => solve(input(), () => { if (++ticks === 15) throw new Error('cancelled during plan ranking') })).toThrow('cancelled during plan ranking')
    const reordered = cloneJson(input()); reordered.parameters.rooms.reverse()
    expect(solve(reordered)).toEqual(solve(input()))
  })
})
