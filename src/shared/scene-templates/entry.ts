import { z } from 'zod'
import { captureBytes, sha256Bytes } from '../project/binary.js'

export const SCENE_TEMPLATE_LIMITS = { bytes: 32 * 1024 * 1024, entries: 32, storedBytes: 128 * 1024 * 1024 } as const
export interface SceneTemplateEntry { key: string; name: string; bytes: Uint8Array }

/** Capture all caller metadata and native bytes before the first await. */
export function captureSceneTemplateEntries(input: readonly SceneTemplateEntry[]): SceneTemplateEntry[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > SCENE_TEMPLATE_LIMITS.entries || Reflect.ownKeys(input).length !== input.length + 1) throw new Error('场景模板数组超过保护值或含额外字段。')
  const captured: SceneTemplateEntry[] = []; let total = 0
  for (let index = 0; index < input.length; index++) {
    const field = Object.getOwnPropertyDescriptor(input, String(index))
    if (!field?.enumerable || !('value' in field)) throw new Error('场景模板数组含空洞或访问器。')
    const row: unknown = field.value
    if (!row || typeof row !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(row))) throw new Error('场景模板条目必须是普通数据。')
    const fields = Object.getOwnPropertyDescriptors(row)
    if (Reflect.ownKeys(row).length !== 3 || !['key', 'name', 'bytes'].every(key => fields[key]?.enumerable && 'value' in fields[key])) throw new Error('场景模板条目含未知或访问器字段。')
    const key = z.string().regex(/^[a-f0-9]{64}$/).parse(fields.key.value), name = z.string().trim().min(1).max(80).parse(fields.name.value)
    const bytes = captureBytes(fields.bytes.value, SCENE_TEMPLATE_LIMITS.bytes)
    if ((total += bytes.length) > SCENE_TEMPLATE_LIMITS.storedBytes || sha256Bytes(bytes) !== key) throw new Error('场景模板实际字节、摘要或累计预算不符。')
    captured.push({ key, name, bytes })
  }
  if (new Set(captured.map(row => row.key)).size !== captured.length) throw new Error('场景模板身份重复。')
  return captured
}
