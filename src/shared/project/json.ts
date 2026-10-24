import { failPackage, PACKAGE_LIMITS } from './limits.js'
import { decodeUtf8 } from './binary.js'

export interface JsonBudget { values: number }

/** Reject aliases such as title / \u0074itle before JSON.parse discards one. */
export function parseBoundedJson(bytes: Uint8Array, budget: JsonBudget = { values: 0 }): unknown {
  let source: string
  try { source = decodeUtf8(bytes) } catch { return failPackage('JSON 必须为有效 UTF-8。') }
  let cursor = 0
  const primitive = /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y
  const whitespace = () => { while (cursor < source.length && /[\x20\t\r\n]/.test(source[cursor])) cursor++ }
  const readString = (): string => {
    if (source[cursor] !== '"') failPackage('JSON 字符串格式错误。')
    const start = cursor++
    while (cursor < source.length) {
      const character = source[cursor++]
      if (character === '\\') { cursor++; continue }
      if (character === '"') {
        try { return JSON.parse(source.slice(start, cursor)) as string } catch { return failPackage('JSON 字符串编码无效。') }
      }
    }
    return failPackage('JSON 字符串未闭合。')
  }
  const value = (depth: number): void => {
    if (depth > PACKAGE_LIMITS.jsonDepth || ++budget.values > PACKAGE_LIMITS.jsonValues) failPackage('JSON 深度或累计节点数量超过保护值。')
    whitespace()
    const character = source[cursor]
    if (character === '{') {
      cursor++; whitespace()
      const keys = new Set<string>()
      if (source[cursor] === '}') { cursor++; return }
      while (true) {
        whitespace()
        const key = readString()
        if (keys.has(key)) failPackage(`JSON 包含重复字段：${key.slice(0, 100)}`)
        keys.add(key); whitespace()
        if (source[cursor++] !== ':') failPackage('JSON 字段缺少冒号。')
        value(depth + 1); whitespace()
        const delimiter = source[cursor++]
        if (delimiter === '}') return
        if (delimiter !== ',') failPackage('JSON 对象分隔错误。')
      }
    }
    if (character === '[') {
      cursor++; whitespace()
      if (source[cursor] === ']') { cursor++; return }
      while (true) {
        value(depth + 1); whitespace()
        const delimiter = source[cursor++]
        if (delimiter === ']') return
        if (delimiter !== ',') failPackage('JSON 数组分隔错误。')
      }
    }
    if (character === '"') { readString(); return }
    primitive.lastIndex = cursor
    const token = primitive.exec(source)
    if (!token) failPackage('JSON 值格式错误。')
    if (token[0] !== 'true' && token[0] !== 'false' && token[0] !== 'null' && !Number.isFinite(Number(token[0]))) failPackage('JSON数字必须有限。')
    cursor += token[0].length
  }
  value(0); whitespace()
  if (cursor !== source.length) failPackage('JSON 包含多余内容。')
  try { return JSON.parse(source) } catch { return failPackage('JSON 格式错误。') }
}
