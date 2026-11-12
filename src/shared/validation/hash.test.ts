import {createHash} from 'node:crypto'
import {describe, expect, it} from 'vitest'
import {sha256Bytes, sha256Text} from './hash.js'

describe('complete actual byte SHA-256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('matches the published vector %j', (text, digest) => { expect(sha256Text(text)).toBe(digest) })

  it('matches the million-a vector', () => {
    expect(sha256Text('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  })

  it('matches independent native crypto across padding boundaries and offset views without mutating input', () => {
    const sizes = new Set([...Array.from({length:260}, (_, i) => i), 511, 512, 513, 4095, 4096, 4097, 65535, 65536, 65537, 2_376_653])
    for (const size of sizes) {
      const backing = new Uint8Array(size + 37)
      let state = 0x9e3779b9
      for (let i = 0; i < backing.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; backing[i] = state & 255 }
      const before = backing.slice(), input = backing.subarray(13,13+size)
      expect(sha256Bytes(input), `offset view size ${size}`).toBe(createHash('sha256').update(input).digest('hex'))
      expect(backing.every((byte, index) => byte === before[index]), `input unchanged at size ${size}`).toBe(true)
    }
  })

  it('encodes full Unicode text and detects an actual changed byte', () => {
    const text = '完整工程 😀\u0000\ud800\udfff\u2028', bytes = new TextEncoder().encode(text)
    expect(sha256Text(text)).toBe(createHash('sha256').update(bytes).digest('hex'))
    const first = sha256Bytes(bytes); bytes[bytes.length-1] ^= 1
    expect(sha256Bytes(bytes)).not.toBe(first)
  })

  it('accepts an offset shared buffer by capturing its bytes before hashing', () => {
    const input = new Uint8Array(new SharedArrayBuffer(153), 7, 128)
    for (let i = 0; i < input.length; i++) input[i] = i
    expect(sha256Bytes(input)).toBe(createHash('sha256').update(new Uint8Array(input)).digest('hex'))
  })
})
