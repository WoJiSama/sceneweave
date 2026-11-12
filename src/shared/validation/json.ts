/** Pure JSON ownership boundary. Never read a caller's getter while inspecting. */
export interface JsonInputIssue { code: string; message: string }
interface JsonInspectionOptions { budgetCode?: string; accessorCode?: string }
export const JSON_LIMITS = Object.freeze({ depth: 128, values: 600_000 })

class JsonInputFailure {
  constructor(readonly issue: JsonInputIssue) {}
}
/** Capture descriptor values in the same walk that checks them. In particular,
 * never re-read a Proxy/getter after inspection to construct a different copy. */
function readJsonInput(input: unknown, options: JsonInspectionOptions, copy: boolean): { value?: unknown; issue?: JsonInputIssue } {
  const ancestors = new Set<object>()
  let values = 0
  function fail(message: string, code = 'NON_JSON_INPUT'): never { throw new JsonInputFailure({ code, message }) }
  const visit = (value: unknown, depth: number): unknown => {
    if (++values > JSON_LIMITS.values || depth > JSON_LIMITS.depth) fail('JSON超过128层或600000值的保护限制。', options.budgetCode)
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : fail('JSON数字必须有限。')
    if (typeof value !== 'object') return fail('输入只能包含JSON值，不接受undefined、函数、BigInt或Symbol。')
    if (ancestors.has(value)) fail('JSON不能包含循环引用。')
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype && !(array && prototype === Array.prototype)) fail('输入只能包含普通JSON对象与数组。')
    ancestors.add(value)
    const keys = Reflect.ownKeys(value)
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : 0
    if (array && (!Number.isSafeInteger(length) || length < 0)) fail('JSON数组长度无效。')
    const owned: Record<string, unknown> | unknown[] | undefined = copy ? array ? [] : {} : undefined
    let indexes = 0
    for (const key of keys) {
      if (key === '__proto__' || typeof key !== 'string') return fail('JSON不接受__proto__或Symbol键。', 'UNSAFE_KEY')
      if (array && key === 'length') continue
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) fail('JSON数组不能带额外属性。')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) return fail('JSON不能含访问器或隐藏字段。', options.accessorCode)
      if (!descriptor.enumerable) fail('JSON不能含访问器或隐藏字段。')
      if (array) indexes++
      const child = visit(descriptor.value, depth + 1)
      if (owned) (owned as Record<string, unknown>)[key] = child
    }
    ancestors.delete(value)
    if (array && indexes !== length) fail('JSON数组不能包含空洞。')
    return owned
  }
  try { return { value: visit(input, 0) } }
  catch (error) { return { issue: error instanceof JsonInputFailure ? error.issue : { code: 'NON_JSON_INPUT', message: '无法独立读取JSON输入。' } } }
}
export function inspectJsonInput(input: unknown, options: JsonInspectionOptions = {}): JsonInputIssue | undefined {
  return readJsonInput(input, options, false).issue
}

/** Owned recursive copy; callers may also use this for optional internal values. */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    const result = new Array(value.length)
    for (let index = 0; index < value.length; index++) if (index in value) result[index] = cloneJson(value[index])
    return result as T
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      const child = cloneJson((value as Record<string, unknown>)[key])
      if (key === '__proto__') Object.defineProperty(result, key, { value: child, enumerable: true, writable: true, configurable: true })
      else result[key] = child
    }
    return result as T
  }
  return value
}

export function captureJson<T>(value: T): T {
  const result = readJsonInput(value, {}, true)
  if (result.issue) throw new Error(result.issue.message)
  return result.value as T
}

/** Complete structural equality for private, already captured JSON values.
 * This helper grants no validation authority to either argument. */
export function equalOwnedJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) if (!equalOwnedJson(left[index], right[index])) return false
    return true
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(right)) return false
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) if (!Object.hasOwn(right, key) || !equalOwnedJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) return false
  return true
}

export function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeJson(child)
  }
  return value
}

/** UTF-16 key order is deterministic; arrays retain their declared order. */
export function canonicalJson(value: unknown): string {
  const issue = inspectJsonInput(value)
  if (issue) throw new Error(issue.message)
  const order = (item: unknown): unknown => Array.isArray(item) ? item.map(order)
    : item !== null && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, order((item as Record<string, unknown>)[key])])) : item
  return JSON.stringify(order(value))
}

/** TextEncoder-equivalent UTF-8, without requiring DOM or Node globals. */
export function encodeUtf8(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 3)
  let length = 0
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i)
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + low - 0xdc00; i++ }
      else cp = 0xfffd
    } else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd
    if (cp < 0x80) bytes[length++] = cp
    else if (cp < 0x800) { bytes[length++] = 0xc0 | cp >> 6; bytes[length++] = 0x80 | cp & 63 }
    else if (cp < 0x10000) { bytes[length++] = 0xe0 | cp >> 12; bytes[length++] = 0x80 | cp >> 6 & 63; bytes[length++] = 0x80 | cp & 63 }
    else { bytes[length++] = 0xf0 | cp >> 18; bytes[length++] = 0x80 | cp >> 12 & 63; bytes[length++] = 0x80 | cp >> 6 & 63; bytes[length++] = 0x80 | cp & 63 }
  }
  return bytes.slice(0, length)
}
