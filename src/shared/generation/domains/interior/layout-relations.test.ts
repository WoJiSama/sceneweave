import { describe, expect, it } from 'vitest'
import { taskBudgetProfile, withExecutionWorkObserver } from '../../../budget/task-budget.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { hashGenerationValue } from '../../contracts.js'
import type { InteriorGenerationInput } from './contracts.js'
import { checkInteriorLayout, solveInteriorLayout } from './layout.js'
import { partialInteriorRelationsPossible, type InteriorPartitionGroup } from './layout-relations.js'

function inn(): InteriorGenerationInput {
  return { version: 1, algorithmVersion: 16, seed: 'ember-inn-five-uses-authored-1', parameters: {
    floorId: 'floor', layerId: 'layer', boundsMm: { x: 1500, y: 1500, width: 14500, height: 12000 }, wallThicknessMm: 260,
    rooms: [
      { id: 'ember-dining', purpose: '余烬酒馆公共餐厅', minAreaMm2: 54_000_000, maxAreaMm2: 78_000_000, minClearSideMm: 5200 },
      { id: 'ember-guest-a', purpose: '旅舍小客房卧室', minAreaMm2: 16_000_000, maxAreaMm2: 24_000_000, minClearSideMm: 3000 },
      { id: 'ember-guest-b', purpose: '旅舍宽敞行李客房卧室', minAreaMm2: 24_500_000, maxAreaMm2: 32_000_000, minClearSideMm: 3300 },
      { id: 'ember-kitchen', purpose: '备餐厨房', minAreaMm2: 27_000_000, maxAreaMm2: 39_000_000, minClearSideMm: 3600 },
      { id: 'ember-pantry', purpose: '酒桶与粮食储藏室', minAreaMm2: 13_000_000, maxAreaMm2: 22_000_000, minClearSideMm: 2600 },
    ],
    relations: [
      ...['ember-guest-a', 'ember-guest-b', 'ember-kitchen'].map(b => ({ a: 'ember-dining', b, kind: 'adjacent' as const, minimumSharedWallMm: 1800 })),
      { a: 'ember-kitchen', b: 'ember-pantry', kind: 'adjacent', minimumSharedWallMm: 1800 },
      { a: 'ember-dining', b: 'ember-pantry', kind: 'no-direct-connection', minimumSharedWallMm: 0 },
    ],
    corridor: { axis: 'none', clearWidthMm: 1600 }, materials: { floor: null, wall: null },
    arrangement: { doors: false, entrance: false, furniture: false, doorWidthMm: 1400, clearWidthMm: 1000, palette: [] },
  } }
}
const profile = taskBudgetProfile('small')
const solve = (input: InteriorGenerationInput, checkCancelled = () => {}) => solveInteriorLayout('relation-proof', input, profile,
  hashGenerationValue([input.seed, 'interior-layout', 11, 'layout', 'interior-layout', 11, 1, 'rectangular-layout']), checkCancelled)
const room = (id: string) => ({ id, purpose: id, minAreaMm2: 1, maxAreaMm2: 1e9, minClearSideMm: 1 })
const group = (ids: string[], x: number, y: number, width: number, height: number): InteriorPartitionGroup => ({ rooms: ids.map(room), bounds: { x, y, width, height } })

describe('conservative partial room contact search', () => {
  it.each([false, true])('finds the five-room inn without spending four complete attempts on impossible contacts (transposed: %s)', transposed => {
    const input = inn()
    if (transposed) {
      const b = input.parameters.boundsMm
      input.parameters.boundsMm = { x: -9000, y: 3000, width: b.height, height: b.width }
    }
    const original = canonicalJson(input)
    expect(() => solve({ ...input, algorithmVersion: 15 })).toThrow(/有限.*不证明需求不可行/)
    let attempts = 0, nodes = 0, fields = 0
    const result = withExecutionWorkObserver(delta => { attempts += delta.candidateAttempts ?? 0; nodes += delta.gridNodes ?? 0; fields += delta.fieldEvaluations ?? 0 }, () => solve(input))
    expect(checkInteriorLayout(input, result)).toEqual([])
    expect(result.rooms).toHaveLength(5); expect(result.corridors).toHaveLength(0)
    expect(attempts).toBeGreaterThan(0); expect(attempts).toBeLessThanOrEqual(4)
    expect(nodes).toBeLessThanOrEqual(8192); expect(fields).toBeGreaterThan(nodes)
    const t = input.parameters.wallThicknessMm
    expect(result.rooms.reduce((n, r) => n + r.boundsMm.width * r.boundsMm.height, 0)).toBe((input.parameters.boundsMm.width - t) * (input.parameters.boundsMm.height - t))
    for (const requirement of input.parameters.rooms) {
      const b = result.rooms.find(r => r.requirementId === requirement.id)!.boundsMm
      expect((b.width - t) * (b.height - t)).toBeGreaterThanOrEqual(requirement.minAreaMm2)
      expect((b.width - t) * (b.height - t)).toBeLessThanOrEqual(requirement.maxAreaMm2)
      expect(Math.min(b.width, b.height) - t).toBeGreaterThanOrEqual(requirement.minClearSideMm)
    }
    const reversed = cloneJson(input); reversed.parameters.rooms.reverse(); reversed.parameters.relations.reverse()
    expect(solve(reversed)).toEqual(result); expect(canonicalJson(input)).toBe(original)
  })

  it('does not confuse forbidden door connections with geometric separation', () => {
    let charged = 0
    const groups = [group(['a', 'b'], 0, 0, 5000, 5000), group(['c'], 5000, 0, 5000, 5000)]
    expect(partialInteriorRelationsPossible(groups, [{ a: 'a', b: 'b', kind: 'no-direct-connection', minimumSharedWallMm: 0 }], () => {}, () => { charged++ })).toBe(true)
    expect(partialInteriorRelationsPossible(groups, [{ a: 'a', b: 'b', kind: 'separate', minimumSharedWallMm: 0 }], () => {}, () => {})).toBe(false)
    expect(charged).toBe(1)
  })

  it('uses actual shared parent-boundary length and retains every feasible descendant in a known tiling', () => {
    const groups = [group(['a', 'b'], 0, 0, 5000, 5000), group(['c', 'd'], 5000, 3201, 5000, 5000)]
    const relation = { a: 'a', b: 'c', kind: 'adjacent' as const, minimumSharedWallMm: 1800 }
    expect(partialInteriorRelationsPossible(groups, [relation], () => {}, () => {})).toBe(false)
    groups[1].bounds.y = 3200
    expect(partialInteriorRelationsPossible(groups, [relation], () => {}, () => {})).toBe(true)
    // Three valid frontier refinements of a four-room rectangular tiling.
    for (const frontier of [
      [group(['a', 'b', 'c', 'd'], 0, 0, 10000, 10000)],
      [group(['a', 'b'], 0, 0, 5000, 10000), group(['c', 'd'], 5000, 0, 5000, 10000)],
      [group(['a'], 0, 0, 5000, 5000), group(['b'], 0, 5000, 5000, 5000), group(['c', 'd'], 5000, 0, 5000, 10000)],
    ]) expect(partialInteriorRelationsPossible(frontier, [relation, { a: 'b', b: 'c', kind: 'separate', minimumSharedWallMm: 0 }], () => {}, () => {})).toBe(true)
  })

  it('leaves complete candidates at the independently metered gate and propagates cancellation', () => {
    const complete = [group(['a'], 0, 0, 5000, 5000), group(['b'], 5000, 0, 5000, 5000)]
    expect(partialInteriorRelationsPossible(complete, [{ a: 'a', b: 'b', kind: 'separate', minimumSharedWallMm: 0 }], () => { throw Error('should be checked by full gate') }, () => {})).toBe(true)
    let checks = 0
    expect(() => solve(inn(), () => { if (++checks === 700) throw Error('cancelled relation search') })).toThrow('cancelled relation search')
  })
})
