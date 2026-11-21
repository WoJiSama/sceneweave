import { describe, expect, it } from 'vitest'
import { netTransactionWrites, transactionSlot, type TransactionWrite } from './receipt.js'

const write = (path: readonly string[]): TransactionWrite => ({ path, before: { present: false }, after: { present: false } })

describe('net transaction writes', () => {
  it('retains the earliest root order and removes covered and reverted paths', () => {
    const before = { outside: [{ position: 1 }], reverted: { position: 2 }, 'a.b': { '"': 5 }, a: { b: { '"': 3 } } }
    const after = { outside: [{ position: 6 }], reverted: { position: 2 }, 'a.b': { '"': 7 }, a: { b: { '"': 4 } } }
    const observed = [
      write(['reverted', 'position']), write(['a', 'b', '"']), write(['a.b', '"']),
      write(['outside']), write(['reverted']), write(['a.b', '"']), write(['a', 'b']),
    ]
    const expected = [['outside'], ['a.b', '"'], ['a', 'b']]
    expect(netTransactionWrites(before, after, observed)).toEqual(expected.map(path => ({
      path, before: transactionSlot(before, path), after: transactionSlot(after, path),
    })))
    expect(netTransactionWrites(before, after, [...observed, write([])])).toEqual([
      { path: [], before: { present: true, value: before }, after: { present: true, value: after } },
    ])
  })
})
