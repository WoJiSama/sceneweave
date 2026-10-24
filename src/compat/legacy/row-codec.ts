import { parseBoundedJson } from '../../shared/project/json.js'
import { captureBytes, sha256Bytes } from '../../shared/project/binary.js'
import { canonicalJson, encodeUtf8 } from '../../shared/validation/json.js'

const MAX_ROW_BYTES = 512 * 1024 * 1024
const MAGIC = [0x53, 0x57, 0x52, 0x31]
type Node = null | boolean | string | number | { t: string; [key: string]: unknown }
const blobSize = (blob: Blob): number => Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!.call(blob) as number
const blobType = (blob: Blob): string => Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!.call(blob) as string

/** A captured IDB value, not a claim about the original disk JSON formatting. */
export async function encodeLegacyRow(input: unknown): Promise<Uint8Array> {
  const pending: { blob: Blob | Uint8Array; type: string }[] = [], ancestors = new Set<object>()
  let nodes = 0, declared = 0
  const visit = (value: unknown, depth: number): Node => {
    if (++nodes > 600_000 || depth > 128) throw new Error('旧记录超过128层或600000值保护值。')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : { t: 'number', value: String(value), negativeZero: Object.is(value, -0) }
    if (value === undefined) return { t: 'undefined' }
    if (typeof value === 'bigint') return { t: 'bigint', value: value.toString() }
    if (!value || typeof value !== 'object') throw new Error('旧记录含不可保全的函数或Symbol值。')
    if (ancestors.has(value)) throw new Error('旧记录循环引用不能保全，原库保持不变。')
    const prototype = Object.getPrototypeOf(value)
    const binary = (blob: Blob | Uint8Array, type: string) => {
      const size = blob instanceof Blob ? blobSize(blob) : blob.byteLength
      if ((declared += size) > MAX_ROW_BYTES) throw new Error('旧记录实际字节超过保护值。')
      const index = pending.length; pending.push({ blob, type }); return { t: type, index, length: size, mimeType: blob instanceof Blob ? blobType(blob) : '' }
    }
    if (prototype === Blob.prototype) return binary(Blob.prototype.slice.call(value, 0, undefined, blobType(value as Blob)), 'blob')
    if (prototype === ArrayBuffer.prototype) return binary(new Uint8Array(ArrayBuffer.prototype.slice.call(value, 0)), 'array-buffer')
    if (prototype === Uint8Array.prototype) return binary(captureBytes(value as Uint8Array, MAX_ROW_BYTES), 'uint8-array')
    if (prototype === Date.prototype) return { t: 'date', value: Date.prototype.getTime.call(value) }
    const array = Array.isArray(value)
    if (prototype !== Object.prototype && prototype !== null && !(array && prototype === Array.prototype)) throw new Error('旧记录含未支持的可序列化类型，不能跳过后宣称保全完整。')
    ancestors.add(value)
    const entries: [string, Node][] = []
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) throw new Error('旧记录含Symbol、访问器或隐藏字段。')
      entries.push([key, visit(descriptor.value, depth + 1)])
    }
    entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    ancestors.delete(value)
    return { t: array ? 'array' : 'object', nullPrototype: prototype === null, ...(array ? { length: value.length } : {}), entries }
  }
  // Capture the complete object graph and immutable Blob slices before the first await.
  const tree = visit(input, 0), binaries: Uint8Array[] = []
  for (const item of pending) binaries.push(item.blob instanceof Blob ? new Uint8Array(await Blob.prototype.arrayBuffer.call(item.blob)) : item.blob)
  const metadata = encodeUtf8(canonicalJson({ tree, binaries: binaries.map(bytes => ({ size: bytes.length, sha256: sha256Bytes(bytes) })) }))
  const size = 8 + metadata.length + binaries.reduce((sum, bytes) => sum + bytes.length, 0)
  if (metadata.length > 16 * 1024 * 1024 || size > MAX_ROW_BYTES) throw new Error('旧记录保全编码超过保护值。')
  const bytes = new Uint8Array(size); bytes.set(MAGIC); new DataView(bytes.buffer).setUint32(4, metadata.length, true); bytes.set(metadata, 8)
  let offset = 8 + metadata.length
  for (const binary of binaries) { bytes.set(binary, offset); offset += binary.length }
  return bytes
}

/** Strict data-only decoder for the bounded preservation row codec. */
export function decodeLegacyRow(input: Uint8Array): unknown {
  const bytes = captureBytes(input, MAX_ROW_BYTES)
  if (bytes.length < 8 || MAGIC.some((byte, i) => bytes[i] !== byte)) throw new Error('旧行保全编码标识无效。')
  const length = new DataView(bytes.buffer).getUint32(4, true)
  if (length > 16 * 1024 * 1024 || length > bytes.length - 8) throw new Error('旧行保全元数据长度无效。')
  const parsed = parseBoundedJson(bytes.subarray(8, 8 + length)) as Record<string, unknown>
  const exact = (object: unknown, keys: string[]): object is Record<string, unknown> => !!object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key))
  if (!exact(parsed, ['tree', 'binaries']) || !Array.isArray(parsed.binaries)) throw new Error('旧行保全索引无效。')
  const binaries: Uint8Array[] = []; let offset = 8 + length
  for (const descriptor of parsed.binaries) {
    if (!exact(descriptor, ['size', 'sha256']) || !Number.isSafeInteger(descriptor.size) || Number(descriptor.size) < 0 || Number(descriptor.size) > bytes.length - offset) throw new Error('旧行二进制长度无效。')
    const binary = bytes.slice(offset, offset + Number(descriptor.size)); offset += binary.length
    if (sha256Bytes(binary) !== descriptor.sha256) throw new Error('旧行二进制hash不匹配。')
    binaries.push(binary)
  }
  if (offset !== bytes.length) throw new Error('旧行编码有未索引字节。')
  const used = new Set<number>()
  const visit = (node: unknown): unknown => {
    if (node === null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return node
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('旧行编码节点无效。')
    const value = node as Record<string, unknown>
    if (value.t === 'undefined' && exact(value, ['t'])) return undefined
    if (value.t === 'bigint' && exact(value, ['t', 'value']) && typeof value.value === 'string' && /^-?(0|[1-9]\d*)$/.test(value.value)) return BigInt(value.value)
    if (value.t === 'number' && exact(value, ['t', 'value', 'negativeZero'])) {
      if (value.negativeZero === true && value.value === '0') return -0
      if (value.negativeZero === false && ['NaN', 'Infinity', '-Infinity'].includes(String(value.value))) return Number(value.value)
    }
    if (value.t === 'date' && exact(value, ['t', 'value']) && typeof value.value === 'number' && Number.isFinite(value.value)) return new Date(value.value)
    if (['blob', 'array-buffer', 'uint8-array'].includes(String(value.t)) && exact(value, ['t', 'index', 'length', 'mimeType'])) {
      if (!Number.isSafeInteger(value.index) || Number(value.index) < 0 || Number(value.index) >= binaries.length || used.has(Number(value.index)) || typeof value.mimeType !== 'string') throw new Error('旧行二进制引用无效。')
      const binary = binaries[Number(value.index)]; used.add(Number(value.index))
      if (binary.length !== value.length) throw new Error('旧行二进制引用长度无效。')
      return value.t === 'blob' ? new Blob([binary.slice().buffer], { type: value.mimeType }) : value.t === 'array-buffer' ? binary.slice().buffer : binary.slice()
    }
    const array = value.t === 'array'
    if ((array || value.t === 'object') && exact(value, array ? ['t', 'nullPrototype', 'length', 'entries'] : ['t', 'nullPrototype', 'entries']) && typeof value.nullPrototype === 'boolean' && Array.isArray(value.entries)) {
      if (array && (!Number.isSafeInteger(value.length) || Number(value.length) < 0 || Number(value.length) > 600_000 || value.nullPrototype)) throw new Error('旧行数组长度无效。')
      const output = array ? new Array(Number(value.length)) : Object.create(value.nullPrototype ? null : Object.prototype), keys = new Set<string>()
      for (const entry of value.entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || keys.has(entry[0]) || array && (!/^(0|[1-9]\d*)$/.test(entry[0]) || Number(entry[0]) >= Number(value.length))) throw new Error('旧行对象键无效。')
        keys.add(entry[0]); Object.defineProperty(output, entry[0], { value: visit(entry[1]), enumerable: true, writable: true, configurable: true })
      }
      return output
    }
    throw new Error('旧行编码类型或字段无效。')
  }
  const result = visit(parsed.tree)
  if (used.size !== binaries.length) throw new Error('旧行保全含未引用二进制。')
  return result
}
