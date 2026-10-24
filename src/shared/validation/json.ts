/** Pure JSON ownership boundary. Never read a caller's getter while inspecting. */
export interface JsonInputIssue { code: string; message: string }
export const JSON_LIMITS = Object.freeze({ depth: 128, values: 600_000 })

export function inspectJsonInput(input: unknown): JsonInputIssue | undefined {
  const ancestors = new Set<object>()
  let values = 0
  const invalid = (message: string): JsonInputIssue => ({ code: 'NON_JSON_INPUT', message })
  const visit = (value: unknown, depth: number): JsonInputIssue | undefined => {
    if (++values > JSON_LIMITS.values || depth > JSON_LIMITS.depth) return invalid('JSON超过128层或600000值的保护限制。')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number') return Number.isFinite(value) ? undefined : invalid('JSON数字必须有限。')
    if (typeof value !== 'object') return invalid('输入只能包含JSON值，不接受undefined、函数、BigInt或Symbol。')
    if (ancestors.has(value)) return invalid('JSON不能包含循环引用。')
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype && !(array && prototype === Array.prototype)) return invalid('输入只能包含普通JSON对象与数组。')
    ancestors.add(value)
    const keys = Reflect.ownKeys(value)
    let indexes = 0
    for (const key of keys) {
      if (key === '__proto__' || typeof key !== 'string') return { code: 'UNSAFE_KEY', message: 'JSON不接受__proto__或Symbol键。' }
      if (array && key === 'length') continue
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return invalid('JSON数组不能带额外属性。')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid('JSON不能含访问器或隐藏字段。')
      if (array) indexes++
      const issue = visit(descriptor.value, depth + 1)
      if (issue) return issue
    }
    ancestors.delete(value)
    return array && indexes !== value.length ? invalid('JSON数组不能包含空洞。') : undefined
  }
  try { return visit(input, 0) } catch { return invalid('无法独立读取JSON输入。') }
}

/** Owned recursive copy; callers may also use this for optional internal values. */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(child => cloneJson(child)) as T
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)])) as T
  return value
}

export function captureJson<T>(value: T): T {
  const issue = inspectJsonInput(value)
  if (issue) throw new Error(issue.message)
  return cloneJson(value)
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
