import type { ProjectData } from '../../../shared/model/project.js'
import { canonicalProjectCoordinates, encodeProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import { captureBytes, sha256Bytes } from '../../../shared/project/binary.js'
import { parseBoundedJson } from '../../../shared/project/json.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'

export const CONTENT_BLOCK_FORMAT = 'sceneweave-project-content-blocks' as const
// Storage blocks are not domain JSON partitions. The complete validator still
// applies scene/identity/appearance and license limits independently; a legal
// complete project or one license-map bucket may exceed 20MiB in aggregate.
export const CONTENT_BLOCK_LIMITS = Object.freeze({ blockBytes: 128 * 1024 * 1024, contentBytes: 128 * 1024 * 1024,
  fields: 512, references: 131072, bucketThreshold: 4096 })
export interface ProjectContentBlock { sha256: string; bytes: Uint8Array }
interface BlockRef { sha256: string; byteLength: number }
interface BlockField { path: string[]; mode: 'value' | 'record'; blocks: BlockRef[] }
export interface ProjectBlockManifest {
  format: typeof CONTENT_BLOCK_FORMAT; version: 1; contentHash: string; byteLength: number; fields: BlockField[]
}
const digest = (value: unknown) => sha256Bytes(encodeUtf8(canonicalJson(value)))
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const validKey = (key: unknown): key is string => typeof key === 'string' && key.length > 0 && key !== '__proto__'
const ownSet = (target: Record<string, unknown>, key: string, value: unknown) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })

/** A complete block closure; semantic groups never own or duplicate these bytes. */
export function partitionProjectContent(input: ProjectData): { manifest: ProjectBlockManifest; blocks: ProjectContentBlock[] } {
  const project = input.document.aggregateCoordinates?.encoding === 'local' ? captureJson(input) : encodeProjectCoordinates(input)
  const bytes = encodeUtf8(canonicalProjectCoordinates(project))
  if (bytes.length > CONTENT_BLOCK_LIMITS.contentBytes) throw new Error('完整工程内容超过分块字节保护值。')
  const blocks = new Map<string, ProjectContentBlock>(), fields: BlockField[] = []
  const add = (value: unknown): BlockRef => {
    const bytes = encodeUtf8(canonicalJson(value)), sha256 = sha256Bytes(bytes)
    blocks.set(sha256, { sha256, bytes }); return { sha256, byteLength: bytes.length }
  }
  const field = (path: string[], value: unknown) => {
    if (record(value) && encodeUtf8(canonicalJson(value)).length > CONTENT_BLOCK_LIMITS.bucketThreshold) {
      // Stable hash buckets keep edits independent of insertion order and avoid
      // rewriting a whole large map when one entity changes.
      const buckets = new Map<string, Record<string, unknown>>()
      for (const [key, row] of Object.entries(value)) {
        const bucket = digest(key).slice(0, 2), entries = buckets.get(bucket) ?? {}
        ownSet(entries, key, row); buckets.set(bucket, entries)
      }
      fields.push({ path, mode: 'record', blocks: [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => add(rows)) })
    } else fields.push({ path, mode: 'value', blocks: [add(value)] })
  }
  // Two levels isolate large entity/identity/source maps while keeping arrays
  // and individual geometry records atomic. This is a bounded DAG, no delta chain.
  for (const [key, value] of Object.entries(project)) {
    if (['document', 'historyIdentity', 'appearance'].includes(key) && record(value) && Object.keys(value).length) for (const [child, row] of Object.entries(value)) field([key, child], row)
    else field([key], value)
  }
  const manifest: ProjectBlockManifest = { format: CONTENT_BLOCK_FORMAT, version: 1, contentHash: sha256Bytes(bytes), byteLength: bytes.length, fields }
  validateProjectBlockManifest(manifest)
  return { manifest, blocks: [...blocks.values()] }
}
export function isProjectBlockManifest(input: unknown): input is ProjectBlockManifest {
  return record(input) && input.format === CONTENT_BLOCK_FORMAT
}
export function validateProjectBlockManifest(input: unknown): ProjectBlockManifest {
  const value = captureJson(input) as unknown
  if (!record(value) || !exact(value, ['format', 'version', 'contentHash', 'byteLength', 'fields']) || value.format !== CONTENT_BLOCK_FORMAT || value.version !== 1
    || !hash(value.contentHash) || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 1 || (value.byteLength as number) > CONTENT_BLOCK_LIMITS.contentBytes
    || !Array.isArray(value.fields) || !value.fields.length || value.fields.length > CONTENT_BLOCK_LIMITS.fields) throw new Error('工程内容块清单无效。')
  const paths = new Set<string>(), roots = new Map<string, number>()
  let count = 0, total = 0
  for (const field of value.fields) {
    if (!record(field) || !exact(field, ['path', 'mode', 'blocks']) || !Array.isArray(field.path) || field.path.length < 1 || field.path.length > 2 || !field.path.every(validKey)
      || !['value', 'record'].includes(String(field.mode)) || !Array.isArray(field.blocks) || !field.blocks.length || field.mode === 'value' && field.blocks.length !== 1) throw new Error('工程内容块字段无效。')
    const key = canonicalJson(field.path), root = field.path[0]
    if (paths.has(key) || roots.has(root) && roots.get(root) !== field.path.length) throw new Error('工程内容块字段重复或路径重叠。')
    paths.add(key); roots.set(root, field.path.length)
    const seen = new Set<string>()
    for (const ref of field.blocks) {
      if (!record(ref) || !exact(ref, ['sha256', 'byteLength']) || !hash(ref.sha256) || !Number.isSafeInteger(ref.byteLength) || (ref.byteLength as number) < 1 || (ref.byteLength as number) > CONTENT_BLOCK_LIMITS.blockBytes
        || seen.has(ref.sha256)) throw new Error('工程内容块引用无效或重复。')
      seen.add(ref.sha256); count++; total += ref.byteLength as number
    }
  }
  if (count > CONTENT_BLOCK_LIMITS.references || total > CONTENT_BLOCK_LIMITS.contentBytes) throw new Error('工程内容块累计预算超限。')
  return value as unknown as ProjectBlockManifest
}
export function checkedContentBlock(input: unknown, expected?: BlockRef): ProjectContentBlock {
  if (!record(input) || !exact(input, ['sha256', 'bytes']) || !hash(input.sha256)) throw new Error('工程内容块记录缺失或无效。')
  const bytes = captureBytes(input.bytes as Uint8Array, CONTENT_BLOCK_LIMITS.blockBytes)
  if (!bytes.length || sha256Bytes(bytes) !== input.sha256 || expected && (expected.sha256 !== input.sha256 || expected.byteLength !== bytes.length)) throw new Error('工程内容块实际字节hash或长度损坏。')
  return { sha256: input.sha256, bytes }
}
export async function materializeProjectContent(input: unknown, read: (hash: string) => Promise<ProjectContentBlock | undefined>): Promise<ProjectData> {
  const manifest = validateProjectBlockManifest(input), output: Record<string, unknown> = {}, cache = new Map<string, unknown>()
  const budget = { values: 0 }
  for (const field of manifest.fields) {
    const values: unknown[] = []
    for (const ref of field.blocks) {
      if (!cache.has(ref.sha256)) {
        const checked = checkedContentBlock(await read(ref.sha256), ref)
        const value = parseBoundedJson(checked.bytes, budget)
        if (canonicalJson(value) !== new TextDecoder('utf-8', { fatal: true }).decode(checked.bytes)) throw new Error('工程内容块不是规范JSON字节。')
        cache.set(ref.sha256, value)
      } else {
        const bytes = encodeUtf8(canonicalJson(cache.get(ref.sha256)))
        if (bytes.length !== ref.byteLength) throw new Error('工程内容块引用长度不一致。')
      }
      values.push(cache.get(ref.sha256))
    }
    let value = values[0]
    if (field.mode === 'record') {
      const merged: Record<string, unknown> = {}
      for (const rows of values) {
        if (!record(rows)) throw new Error('工程记录区块须为对象。')
        for (const [key, row] of Object.entries(rows)) {
          if (!validKey(key) || Object.hasOwn(merged, key)) throw new Error('工程记录区块包含重复或非法成员。')
          ownSet(merged, key, row)
        }
      }
      value = merged
    }
    // Hash sharing is an on-disk property. Runtime fields own independent JSON
    // objects, including nested record rows, so a later dotted update cannot
    // mutate another field which happened to share identical stored bytes.
    value = cloneJson(value)
    if (field.path.length === 1) ownSet(output, field.path[0], value)
    else {
      if (!Object.hasOwn(output, field.path[0])) ownSet(output, field.path[0], {})
      ownSet(output[field.path[0]] as Record<string, unknown>, field.path[1], value)
    }
  }
  const project = output as unknown as ProjectData
  const bytes = encodeUtf8(canonicalProjectCoordinates(project))
  if (bytes.length !== manifest.byteLength || sha256Bytes(bytes) !== manifest.contentHash) throw new Error('工程内容块重建的完整hash或长度不符。')
  return project
}
export function manifestStorageBytes(project: ProjectData): number {
  return encodeUtf8(canonicalJson(partitionProjectContent(project).manifest)).length
}
