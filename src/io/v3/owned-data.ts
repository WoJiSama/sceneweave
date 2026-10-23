import { PROJECT_LIMITS_V3 } from './limits'

// Node's native slice adds an own constructor; File also has native state.
// Admit only observed native data slots, never caller accessors or methods.
const blobKeys = new Set(Reflect.ownKeys(new Blob()))
const fileKeys = typeof File === 'undefined' ? blobKeys : new Set(Reflect.ownKeys(new File([], '')))
const slicedConstructor = Object.getOwnPropertyDescriptor(new Blob().slice(), 'constructor')
const nativeClone = structuredClone

export function assertDataObject(value: unknown, array = false): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || (array ? !Array.isArray(value) : Array.isArray(value))
    || ![array ? Array.prototype : Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('完整工程必须只包含普通数据字段。')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    const descriptor = typeof key === 'string' ? descriptors[key] : undefined
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('完整工程不能包含访问器、隐藏字段或symbol。')
    if (array && (!/^(0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= (value as unknown as unknown[]).length)) throw new Error('完整工程数组不能包含额外字段。')
  }
}

/** Synchronous, detached capture before the first await; never invokes a caller getter. */
export function captureOwnedData<T>(input: T): T {
  const visiting = new Set<object>(), copies = new Map<object, unknown>()
  let nodes = 0
  const capture = (value: unknown, depth: number): unknown => {
    if (++nodes > PROJECT_LIMITS_V3.jsonValues || depth > PROJECT_LIMITS_V3.jsonDepth) throw new Error('完整工程捕获超过深度或节点预算。')
    if (!value || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('完整工程包含不可序列化数据。')
      return value
    }
    if (visiting.has(value)) throw new Error('完整工程不能包含循环数据。')
    if (copies.has(value)) return copies.get(value)
    if (value instanceof Blob) {
      const prototype = Object.getPrototypeOf(value), file = typeof File !== 'undefined' && prototype === File.prototype
      const keys = file ? fileKeys : blobKeys
      if (prototype !== Blob.prototype && !file || Reflect.ownKeys(value).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        return !('value' in descriptor) || !(keys.has(key) || key === 'constructor' && slicedConstructor && descriptor.value === Blob)
      })) throw new Error('完整工程Blob不能包含自定义字段、子类或方法覆盖。')
      const blob = nativeClone(value)
      // Node exposes the newly detached native handle through a symbol. Its
      // own methods must be immutable too; browser Blobs have no own slots.
      for (const key of Reflect.ownKeys(blob)) {
        const child = Object.getOwnPropertyDescriptor(blob, key)!.value
        if (child && typeof child === 'object') Object.freeze(child)
      }
      Object.freeze(blob)
      copies.set(value, blob)
      return blob
    }
    const array = Array.isArray(value)
    assertDataObject(value, array)
    visiting.add(value)
    const result: Record<string, unknown> | unknown[] = array ? new Array((value as unknown as unknown[]).length) : Object.create(Object.getPrototypeOf(value))
    copies.set(value, result)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (array && key === 'length') continue
      Object.defineProperty(result, key, { value: capture(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true })
    }
    visiting.delete(value)
    return result
  }
  return capture(input, 0) as T
}

/** Only call on detached native data owned by the validator. */
export function freezeOwnedData<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    if (!(value instanceof Blob)) for (const child of Object.values(value)) freezeOwnedData(child)
  }
  return value
}
