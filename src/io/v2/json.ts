import { failV2, PROJECT_LIMITS_V2 } from './limits'

export interface JsonBudget { values: number }
export const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
export const utf8Encoder = new TextEncoder()

/** Reject aliases such as title / \u0074itle before JSON.parse discards one. */
export function parseBoundedJson(bytes: Uint8Array, budget: JsonBudget = { values: 0 }): unknown {
  let source: string
  try { source = utf8Decoder.decode(bytes) } catch { return failV2('JSON 必须为有效 UTF-8。') }
  let cursor = 0
  const primitive = /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y
  const whitespace = () => { while (cursor < source.length && /[\x20\t\r\n]/.test(source[cursor])) cursor++ }
  const readString = (): string => {
    if (source[cursor] !== '"') failV2('JSON 字符串格式错误。')
    const start = cursor++
    while (cursor < source.length) {
      const character = source[cursor++]
      if (character === '\\') { cursor++; continue }
      if (character === '"') {
        try { return JSON.parse(source.slice(start, cursor)) as string } catch { return failV2('JSON 字符串编码无效。') }
      }
    }
    return failV2('JSON 字符串未闭合。')
  }
  const value = (depth: number): void => {
    if (depth > PROJECT_LIMITS_V2.jsonDepth || ++budget.values > PROJECT_LIMITS_V2.jsonValues) failV2('JSON 深度或累计节点数量超过保护值。')
    whitespace()
    const character = source[cursor]
    if (character === '{') {
      cursor++; whitespace()
      const keys = new Set<string>()
      if (source[cursor] === '}') { cursor++; return }
      while (true) {
        whitespace()
        const key = readString()
        if (keys.has(key)) failV2(`JSON 包含重复字段：${key.slice(0, 100)}`)
        keys.add(key); whitespace()
        if (source[cursor++] !== ':') failV2('JSON 字段缺少冒号。')
        value(depth + 1); whitespace()
        const delimiter = source[cursor++]
        if (delimiter === '}') return
        if (delimiter !== ',') failV2('JSON 对象分隔错误。')
      }
    }
    if (character === '[') {
      cursor++; whitespace()
      if (source[cursor] === ']') { cursor++; return }
      while (true) {
        value(depth + 1); whitespace()
        const delimiter = source[cursor++]
        if (delimiter === ']') return
        if (delimiter !== ',') failV2('JSON 数组分隔错误。')
      }
    }
    if (character === '"') { readString(); return }
    primitive.lastIndex = cursor
    const token = primitive.exec(source)
    if (!token) failV2('JSON 值格式错误。')
    cursor += token[0].length
  }
  value(0); whitespace()
  if (cursor !== source.length) failV2('JSON 包含多余内容。')
  try { return JSON.parse(source) } catch { return failV2('JSON 格式错误。') }
}
