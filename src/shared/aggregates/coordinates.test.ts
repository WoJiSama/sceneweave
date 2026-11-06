import { describe, expect, it } from 'vitest'
import type { AggregateFrame } from '../model/aggregate.js'
import {
  composeAggregateFrames, invertAggregateFrame, localToWorldBounds, localToWorldPoint, localToWorldVector,
  parseAggregateFrame, reparentAggregateFrame, worldToLocalBounds, worldToLocalPoint, worldToLocalVector,
} from './coordinates.js'

const frame = (x: number, y: number, quarterTurns: AggregateFrame['quarterTurns'] = 0): AggregateFrame => ({ translationMm: { x, y }, quarterTurns })
const identity = frame(0, 0)

describe('exact aggregate coordinates', () => {
  it('roundtrips asymmetric negative points through each quarter turn and inverse', () => {
    const value = { x: -1307, y: 2519 }
    const expected = [{ x: -1290, y: 2490 }, { x: -2502, y: -1336 }, { x: 1324, y: -2548 }, { x: 2536, y: 1278 }]
    for (const turns of [0, 1, 2, 3] as const) {
      const current = frame(17, -29, turns), world = localToWorldPoint(current, value)
      expect(world).toEqual(expected[turns])
      expect(worldToLocalPoint(current, world)).toEqual(value)
      expect(localToWorldPoint(invertAggregateFrame(current), world)).toEqual(value)
      expect(composeAggregateFrames(current, invertAggregateFrame(current))).toEqual(identity)
    }
  })

  it('composes parent after child and preserves the noncommutative order', () => {
    const parent = frame(100, -200, 1), child = frame(7, 11, 3), value = { x: 19, y: -23 }
    const combined = composeAggregateFrames(parent, child)
    expect(combined).toEqual(frame(89, -193))
    expect(localToWorldPoint(combined, value)).toEqual(localToWorldPoint(parent, localToWorldPoint(child, value)))
    expect(composeAggregateFrames(child, parent)).toEqual(frame(-193, -89))
    expect(composeAggregateFrames(child, parent)).not.toEqual(combined)
    let rotated = identity
    for (let i = 0; i < 4; i++) rotated = composeAggregateFrames(rotated, frame(0, 0, 1))
    expect(rotated).toEqual(identity)
  })

  it('reparents a frame while preserving world points, rotation and the original frame', () => {
    const oldParent = frame(120, -530, 3), oldLocal = frame(-37, 81, 2), world = composeAggregateFrames(oldParent, oldLocal)
    const newParent = frame(-470, 319, 1), local = reparentAggregateFrame(world, newParent), value = { x: -151, y: 227 }
    expect(composeAggregateFrames(newParent, local)).toEqual(world)
    expect(localToWorldPoint(newParent, localToWorldPoint(local, value))).toEqual(localToWorldPoint(world, value))
    expect(reparentAggregateFrame(world, identity)).toEqual(world)
    expect(reparentAggregateFrame(world, oldParent)).toEqual(oldLocal)
  })

  it('rotates vectors without translation and transforms all bounds corners', () => {
    const current = frame(17, -29, 1), vector = { x: -13, y: 25 }, box = { x: -3, y: 5, width: 7, height: 11 }
    expect(localToWorldVector(current, vector)).toEqual({ x: -25, y: -13 })
    expect(worldToLocalVector(current, localToWorldVector(current, vector))).toEqual(vector)
    expect(localToWorldBounds(current, box)).toEqual({ x: 1, y: -32, width: 11, height: 7 })
    for (const turns of [0, 1, 2, 3] as const) {
      const rotated = frame(17, -29, turns)
      expect(worldToLocalBounds(rotated, localToWorldBounds(rotated, box))).toEqual(box)
    }
  })

  it('captures independent deeply frozen values without freezing or retaining inputs', () => {
    const source = frame(13, -17, 2), parsed = parseAggregateFrame(source), value = { x: 3, y: 7 }
    const result = localToWorldPoint(source, value), composed = composeAggregateFrames(source, identity)
    expect(parsed).not.toBe(source)
    expect(parsed.translationMm).not.toBe(source.translationMm)
    source.translationMm.x = 999; source.quarterTurns = 0; value.x = 888
    expect(parsed).toEqual(frame(13, -17, 2))
    expect(composed).toEqual(parsed)
    expect(result).toEqual({ x: 10, y: -24 })
    expect(Object.isFrozen(source)).toBe(false)
    for (const output of [parsed, composed, invertAggregateFrame(parsed), reparentAggregateFrame(parsed, identity)]) {
      expect(Object.isFrozen(output)).toBe(true)
      expect(Object.isFrozen(output.translationMm)).toBe(true)
    }
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(localToWorldBounds(identity, { x: 0, y: 0, width: 1, height: 1 }))).toBe(true)
  })

  it('rejects free angles, scale, shear, unknown fields and invalid coordinates', () => {
    for (const input of [null, [], 'frame', {}, { ...identity, rotationDeg: 45 }, { ...identity, scale: 1 }, { ...identity, shear: 0 },
      { ...identity, quarterTurns: 0.5 }, { ...identity, quarterTurns: -1 }, { ...identity, quarterTurns: 4 },
      { ...identity, translationMm: { x: 0, y: 0, z: 0 } }, { ...identity, translationMm: { x: 0.1, y: 0 } },
      { ...identity, translationMm: { x: NaN, y: 0 } }, { ...identity, translationMm: { x: Infinity, y: 0 } },
      { ...identity, translationMm: { x: Number.MAX_SAFE_INTEGER + 1, y: 0 } },
      Object.assign(Object.create({ inherited: true }), identity), { ...identity, [Symbol('extra')]: 0 }]) expect(() => parseAggregateFrame(input)).toThrow()
    expect(() => localToWorldPoint(identity, { x: 1, y: 0, z: 0 } as never)).toThrow()
    expect(() => localToWorldBounds(identity, { x: 0, y: 0, width: 0, height: 1 })).toThrow()
    expect(() => worldToLocalBounds(identity, { x: 0, y: 0, width: 1, height: -1 })).toThrow()
    expect(parseAggregateFrame({ translationMm: Object.assign(Object.create(null), { x: -0, y: 0 }), quarterTurns: -0 })).toEqual(identity)
  })

  it('rejects nested and root accessors without executing them or trusting frozen wrappers', () => {
    let reads = 0
    const getter = () => { reads++; return 0 }
    const nested = Object.defineProperty({ y: 0 }, 'x', { get: getter, enumerable: true })
    const root = Object.defineProperty({ translationMm: { x: 0, y: 0 } }, 'quarterTurns', { get: getter, enumerable: true })
    const hidden = Object.defineProperty(frame(0, 0), 'hidden', { value: 0 })
    expect(() => parseAggregateFrame(Object.freeze({ translationMm: nested, quarterTurns: 0 }))).toThrow()
    expect(() => parseAggregateFrame(root)).toThrow()
    expect(() => parseAggregateFrame(hidden)).toThrow()
    expect(() => localToWorldPoint(identity, nested as never)).toThrow()
    expect(() => localToWorldVector(root as never, { x: 0, y: 0 })).toThrow()
    expect(() => composeAggregateFrames(identity, root as never)).toThrow()
    expect(() => reparentAggregateFrame(root as never, identity)).toThrow()
    expect(reads).toBe(0)
  })

  it('retains exact safe-integer limits and rejects overflowing final coordinates', () => {
    const max = Number.MAX_SAFE_INTEGER, extreme = { x: max, y: -max }
    for (const turns of [0, 1, 2, 3] as const) {
      const current = frame(0, 0, turns)
      expect(worldToLocalPoint(current, localToWorldPoint(current, extreme))).toEqual(extreme)
    }
    expect(localToWorldPoint(frame(-max, max), extreme)).toEqual({ x: 0, y: 0 })
    expect(composeAggregateFrames(frame(max, -max, 2), frame(max, -max, 2))).toEqual(identity)
    expect(() => localToWorldPoint(frame(1, 0), { x: max, y: 0 })).toThrow(/安全整数/)
    expect(() => worldToLocalPoint(frame(-1, 0), { x: max, y: 0 })).toThrow(/安全整数/)
    expect(() => composeAggregateFrames(frame(max, 0), frame(1, 0))).toThrow(/安全整数/)
    expect(() => reparentAggregateFrame(frame(max, 0), frame(-1, 0))).toThrow(/安全整数/)
  })

  it('keeps overflowing intermediate bounds corners exact until final world coordinates', () => {
    const max = Number.MAX_SAFE_INTEGER
    // The untransformed right corner is MAX_SAFE_INTEGER+2, but both world edges fit.
    expect(localToWorldBounds(frame(-max, 0), { x: max, y: 0, width: 2, height: 3 })).toEqual({ x: 0, y: 0, width: 2, height: 3 })
    expect(localToWorldBounds(frame(0, -max, 1), { x: max, y: 0, width: 2, height: 3 })).toEqual({ x: -3, y: 0, width: 3, height: 2 })
    expect(worldToLocalBounds(frame(max, 0), { x: max - 2, y: 0, width: 2, height: 3 })).toEqual({ x: -2, y: 0, width: 2, height: 3 })
    expect(() => localToWorldBounds(identity, { x: max, y: 0, width: 2, height: 3 })).toThrow(/安全整数/)
    expect(() => worldToLocalBounds(identity, { x: 0, y: max, width: 2, height: 3 })).toThrow(/安全整数/)
  })
})
