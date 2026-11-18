import { describe, expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures.js'
import { cloneJson } from '../validation/json.js'
import { manualChangedTargets, measureCommandBudget } from './command-budget.js'

describe('manual accounting JSON comparison', () => {
  it('keeps exact counts across record key order and JSON-equivalent signed zero', () => {
    const before = fixture().project.document, after = cloneJson(before)
    before.props.item.rotationDeg = 0
    after.props.item = Object.fromEntries(Object.entries(after.props.item).reverse()) as typeof after.props.item
    after.props.item.rotationDeg = -0
    after.props.item.positionMm = { y: before.props.item.positionMm.y, x: before.props.item.positionMm.x }
    expect(manualChangedTargets(before, after)).toEqual([])
    expect(measureCommandBudget(before, after)).toEqual(measureCommandBudget(before, cloneJson(before)))
    after.props.item.positionMm.x++
    expect(manualChangedTargets(before, after)).toEqual(['prop:item'])
    expect(measureCommandBudget(before, after).semanticTargets).toBe(1)
  })

  it('rejects an accessor or invalid nested JSON even for the same object reference', () => {
    for (const mode of ['accessor', 'nan', 'undefined', 'hidden'] as const) {
      const scene = fixture().project.document
      let calls = 0
      if (mode === 'accessor') Object.defineProperty(scene.props.item, 'rotationDeg', { enumerable: true, get: () => { calls++; return 0 } })
      if (mode === 'nan') scene.props.item.rotationDeg = Number.NaN
      if (mode === 'undefined') Object.assign(scene.props.item, { rotationDeg: undefined })
      if (mode === 'hidden') Object.defineProperty(scene.props.item, 'extra', { enumerable: false, value: 1 })
      expect(() => manualChangedTargets(scene, scene), mode).toThrow()
      expect(calls).toBe(0)
    }
  })
})
