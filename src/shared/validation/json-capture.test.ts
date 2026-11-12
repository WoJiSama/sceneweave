import { expect, it, vi } from 'vitest'
import { captureJson, cloneJson, equalOwnedJson, inspectJsonInput } from './json.js'

it('captures exactly the descriptor values inspected without reading caller getters or Proxy values', () => {
  const get = vi.fn(() => { throw new Error('uninspected read') })
  const target = { nested: { value: 42 }, list: [1, null, 'text'] }, proxy = new Proxy(target, { get })
  const captured = captureJson(proxy)
  expect(captured).toEqual(target); expect(get).not.toHaveBeenCalled()
  target.nested.value = 99; target.list[0] = 3
  expect(captured.nested.value).toBe(42); expect(captured.list[0]).toBe(1)
  expect(captureJson(new Proxy([1, 2], { get }))).toEqual([1, 2]); expect(get).not.toHaveBeenCalled()
})

it('keeps complete strict JSON rejection for both inspection and capture', () => {
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: vi.fn() })
  const hidden = Object.defineProperty({}, 'value', { enumerable: false, value: 1 })
  const cycle: { self?: unknown } = {}; cycle.self = cycle
  const unsafe = Object.fromEntries([['__proto__', { unsafe: true }]])
  const sparse = new Array(2); sparse[1] = 1
  for (const input of [accessor, hidden, cycle, unsafe, sparse, { [Symbol('hidden')]: 1 },
    { value: undefined }, { value: Infinity }, Object.create({ inherited: true }), new Date(), new Uint8Array([1])]) {
    expect(inspectJsonInput(input)).toBeDefined(); expect(() => captureJson(input)).toThrow()
  }
  expect(Object.getOwnPropertyDescriptor(accessor, 'value')!.get).not.toHaveBeenCalled()
  let deep: unknown = 1
  for (let n = 0; n < 129; n++) deep = [deep]
  expect(inspectJsonInput(deep, { budgetCode: 'LIMIT' })?.code).toBe('LIMIT')
  expect(() => captureJson(deep)).toThrow(/128/)
})

it('preserves valid special IDs and full equality without aliasing or prototype changes', () => {
  const source = Object.assign(Object.create(null), { constructor: { prototype: [0, -0, 'same'] }, other: { x: 1 } })
  const captured = captureJson(source), copy = cloneJson(captured)
  expect(Object.getPrototypeOf(captured)).toBe(Object.prototype)
  expect(Object.hasOwn(captured, 'constructor')).toBe(true)
  expect(equalOwnedJson(captured, { other: { x: 1 }, constructor: { prototype: [0, 0, 'same'] } })).toBe(true)
  copy.other.x = 2; expect(captured.other.x).toBe(1); expect(equalOwnedJson(captured, copy)).toBe(false)
  expect(equalOwnedJson([1, 2], [2, 1])).toBe(false)
  const unsafeCopy = cloneJson(Object.fromEntries([['__proto__', { retained: true }]]))
  expect(Object.getPrototypeOf(unsafeCopy)).toBe(Object.prototype); expect(Object.hasOwn(unsafeCopy, '__proto__')).toBe(true)
})
