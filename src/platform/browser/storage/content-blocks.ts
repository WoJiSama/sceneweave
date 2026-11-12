import type { ProjectData } from '../../../shared/model/project.js'
import { canonicalProjectCoordinates, encodeProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import { captureBytes, sha256Bytes } from '../../../shared/project/binary.js'
import { parseBoundedJson } from '../../../shared/project/json.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { getProjectLocalTransaction } from '../../../shared/project/validate.js'
import { encodeProjectContentData, getOwnedProjectEncoding, type OwnedProjectEncoding } from '../../../shared/project/encoding.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8, equalOwnedJson, freezeJson } from '../../../shared/validation/json.js'

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

export interface ProjectContentPartition { manifest: ProjectBlockManifest; blocks: ProjectContentBlock[] }
/** An owned encoding, not a semantic or database validation certificate. Bytes
 * and partition state stay private; callers cannot substitute a declared hash. */
export type EncodedProjectContent = OwnedProjectEncoding
const encodedContents = new WeakMap<EncodedProjectContent, { checked: ReturnType<typeof checkedCanonical>; partition?: ProjectContentPartition }>()
export const CONTENT_BLOCK_CACHE_LIMITS = Object.freeze({ entries: 4, retainedBytes: 64 * 1024 * 1024 })
interface OwnedPartition extends ProjectContentPartition {
  canonical: string
  // Private producer-owned indexes, never supplied by a manifest caller.
  buckets: Map<string, Map<string, BlockRef>>
  retainedBytes: number
}
const partitions = new Map<string, OwnedPartition>()
let retainedPartitionBytes = 0
const pathKey = (path: readonly string[]) => JSON.stringify(path)
const storedProject = (input: ProjectData) => input.document.aggregateCoordinates?.encoding === 'local' ? captureJson(input) : encodeProjectCoordinates(input)
const copyPartition = (partition: ProjectContentPartition): ProjectContentPartition => ({ manifest: cloneJson(partition.manifest), blocks: partition.blocks.map(block => ({ sha256: block.sha256, bytes: block.bytes.slice() })) })
function checkedCanonical(input: ProjectData): { canonical: string; byteLength: number; contentHash: string } {
  const canonical = canonicalProjectCoordinates(input), bytes = encodeUtf8(canonical)
  if (bytes.length > CONTENT_BLOCK_LIMITS.contentBytes) throw new Error('完整工程内容超过分块字节保护值。')
  // Even cache hits still hash the entire actual canonical input. The cache
  // saves partition encoding only, and is never an IO validation certificate.
  return { canonical, byteLength: bytes.length, contentHash: sha256Bytes(bytes) }
}
function cachedPartition(canonical: string): OwnedPartition | undefined {
  const known = partitions.get(canonical)
  if (known) { partitions.delete(canonical); partitions.set(canonical, known) }
  return known
}
function rememberPartition(partition: OwnedPartition): boolean {
  if (partition.retainedBytes > CONTENT_BLOCK_CACHE_LIMITS.retainedBytes) return false
  const previous = partitions.get(partition.canonical)
  if (previous) { retainedPartitionBytes -= previous.retainedBytes; partitions.delete(partition.canonical) }
  while (partitions.size >= CONTENT_BLOCK_CACHE_LIMITS.entries || retainedPartitionBytes + partition.retainedBytes > CONTENT_BLOCK_CACHE_LIMITS.retainedBytes) {
    const oldest = partitions.keys().next().value
    if (oldest === undefined) break
    retainedPartitionBytes -= partitions.get(oldest)!.retainedBytes; partitions.delete(oldest)
  }
  partitions.set(partition.canonical, partition); retainedPartitionBytes += partition.retainedBytes
  return true
}
function ownPartition(canonical: string, manifest: ProjectBlockManifest, blocks: ProjectContentBlock[], buckets: OwnedPartition['buckets']): OwnedPartition {
  // Capture before publishing anything. Typed-array bytes are deliberately
  // private copies because Object.freeze cannot make their elements immutable.
  const owned = { manifest: validateProjectBlockManifest(manifest), blocks: blocks.map(block => ({ sha256: block.sha256, bytes: block.bytes.slice() })) }
  const retainedBytes = canonical.length * 2 + JSON.stringify(owned.manifest).length * 2
    + owned.blocks.reduce((sum, block) => sum + block.bytes.length, 0)
    + [...buckets.values()].reduce((sum, value) => sum + value.size * 160, 0)
  return { ...owned, canonical, buckets: new Map([...buckets].map(([path, entries]) => [path, new Map([...entries].map(([key, ref]) => [key, { ...ref }]))])), retainedBytes }
}
function addBlock(blocks: Map<string, ProjectContentBlock>, value: unknown): BlockRef {
  const bytes = encodeUtf8(canonicalJson(value)), sha256 = sha256Bytes(bytes)
  blocks.set(sha256, { sha256, bytes }); return { sha256, byteLength: bytes.length }
}
function partitionField(path: string[], value: unknown, blocks: Map<string, ProjectContentBlock>, indexes: OwnedPartition['buckets']): BlockField {
  if (record(value) && encodeUtf8(canonicalJson(value)).length > CONTENT_BLOCK_LIMITS.bucketThreshold) {
    const buckets = new Map<string, Record<string, unknown>>()
    for (const [key, row] of Object.entries(value)) {
      const bucket = digest(key).slice(0, 2), entries = buckets.get(bucket) ?? {}
      ownSet(entries, key, row); buckets.set(bucket, entries)
    }
    const refs = new Map([...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => [key, addBlock(blocks, rows)]))
    indexes.set(pathKey(path), refs)
    return { path, mode: 'record', blocks: [...refs.values()] }
  }
  indexes.delete(pathKey(path))
  return { path, mode: 'value', blocks: [addBlock(blocks, value)] }
}
function fullPartition(checked: ReturnType<typeof checkedCanonical>): OwnedPartition {
  // Partition exactly the captured canonical text used as the cache key. Never
  // read an external Proxy again after hashing and capture a different value.
  const project = JSON.parse(checked.canonical) as ProjectData
  const blocks = new Map<string, ProjectContentBlock>(), fields: BlockField[] = [], buckets: OwnedPartition['buckets'] = new Map()
  // Two levels isolate entity/identity/source maps. Arrays and individual
  // geometry remain atomic; this is a bounded DAG, never a delta chain.
  for (const [key, value] of Object.entries(project)) {
    if (['document', 'historyIdentity', 'appearance'].includes(key) && record(value) && Object.keys(value).length) {
      for (const [child, row] of Object.entries(value)) fields.push(partitionField([key, child], row, blocks, buckets))
    } else fields.push(partitionField([key], value, blocks, buckets))
  }
  return ownPartition(checked.canonical, { format: CONTENT_BLOCK_FORMAT, version: 1, contentHash: checked.contentHash, byteLength: checked.byteLength, fields }, [...blocks.values()], buckets)
}
/** A complete block closure; semantic groups never own or duplicate these bytes. */
export function partitionProjectContent(input: ProjectData): ProjectContentPartition {
  const checked = checkedCanonical(input), known = cachedPartition(checked.canonical)
  if (known) return copyPartition(known)
  const result = fullPartition(checked)
  rememberPartition(result)
  return copyPartition(result)
}

/** Compile the sole local representation once before the final write tx. */
export function encodeProjectContent(input: ProjectData): EncodedProjectContent {
  const result = encodeProjectContentData(input)
  if (result.byteLength > CONTENT_BLOCK_LIMITS.contentBytes) throw new Error('完整工程内容超过分块字节保护值。')
  encodedContents.set(result, { checked: result })
  return result
}
/** Only encodings produced above can reuse canonical bytes and their digest. */
export function partitionEncodedProjectContent(input: EncodedProjectContent): ProjectContentPartition {
  const state = encodedContents.get(input)
  if (!state) throw new Error('工程编码快照不是本模块拥有的实际内容。')
  if (!state.partition) {
    const known = cachedPartition(state.checked.canonical), partition = known ?? fullPartition(state.checked)
    if (!known) rememberPartition(partition)
    state.partition = copyPartition(partition)
  }
  // The receiving storage context owns this copy for its whole operation.
  return copyPartition(state.partition)
}

export interface LocalProjectContentPreparation {
  /** Diagnostics only; no permission, changed-id input or persistent receipt. */
  rewrittenFields: readonly string[][]
  rewrittenPropBuckets: number
  reusedBlocks: number
}
/** Consume a real local project transaction after complete save validation.
 * Complete canonical comparison, SHA and byte-length accounting remain O(N).
 * Only block partition encoding is local, and native DB writes still verify
 * every referenced stored block's actual bytes through their existing owner. */
export function prepareLocalProjectContent(originalAfter: ProjectData, fullyValidatedAfter: ProjectData, encoded?: EncodedProjectContent, baselineEncoded?: EncodedProjectContent): LocalProjectContentPreparation | undefined {
  const transaction = getProjectLocalTransaction(originalAfter)
  if (!transaction) return
  try {
    // Only the executor's immutable exact result may consume this producer's
    // actual encoding directly. Public revalidation returns a new object and
    // keeps the complete representation comparison below.
    const owned = encoded && fullyValidatedAfter === transaction.result && getOwnedProjectEncoding(encoded, transaction.result)
    const target = owned ? owned.stored : storedProject(transaction.result)
    const targetCanonical = owned ? owned.canonical : canonicalJson(target)
    // Match the complete world input before frame conversion can normalize a
    // forged angle (for example 450 -> 90). Already-local storage copies must
    // likewise equal the exact local result, without a second normalization.
    if (!owned) {
      const actual = captureJson(fullyValidatedAfter)
      if (!equalOwnedJson(actual, transaction.result) && !equalOwnedJson(actual, target)) return
    }
    const prepared = encoded && encodedContents.get(encoded)?.checked
    if (prepared && prepared.canonical !== targetCanonical) return
    const checked = prepared ?? checkedCanonical(target)
    // Do not build/retain partitions that cannot fit the bounded cache. The
    // normal writer remains able to store larger legal complete projects.
    if (checked.canonical.length * 2 + checked.byteLength > CONTENT_BLOCK_CACHE_LIMITS.retainedBytes) return
    const knownBefore = baselineEncoded && getOwnedProjectEncoding(baselineEncoded, transaction.baseline)
      && encodedContents.get(baselineEncoded)?.checked
    const before = knownBefore ?? checkedCanonical(transaction.baseline)
    let baseline = cachedPartition(before.canonical)
    if (!baseline) { baseline = fullPartition(before); rememberPartition(baseline) }
    const fields = cloneJson(baseline.manifest.fields), indexes = new Map(baseline.buckets)
    const blocks = new Map(baseline.blocks.map(block => [block.sha256, block]))
    const propsIndex = fields.findIndex(field => pathKey(field.path) === pathKey(['document', 'props']))
    if (propsIndex < 0) return
    const rewrittenFields: string[][] = []
    let rewrittenPropBuckets = 0
    if (transaction.propChanges.length) {
      const oldField = fields[propsIndex], oldBuckets = baseline.buckets.get(pathKey(oldField.path)), changedRows = new Map<string, Record<string, unknown>>()
      let delta = 0
      for (const change of transaction.propChanges) {
        const bucket = oldField.mode === 'record' ? digest(change.id).slice(0, 2) : ''
        let rows = changedRows.get(bucket)
        if (!rows) {
          const ref = oldField.mode === 'record' ? oldBuckets?.get(bucket) : oldField.blocks[0]
          if (!ref) return
          const block = blocks.get(ref.sha256)
          if (!block) return
          const parsed = parseBoundedJson(block.bytes)
          if (!record(parsed)) return
          rows = parsed; changedRows.set(bucket, rows)
        }
        if (!Object.hasOwn(rows, change.id) || !Object.hasOwn(target.document.props, change.id)) return
        const next = target.document.props[change.id]
        delta += encodeUtf8(canonicalJson(next)).length - encodeUtf8(canonicalJson(rows[change.id])).length
        ownSet(rows, change.id, next)
      }
      // Combining B nonempty record buckets removes B-1 pairs of braces and
      // adds B-1 separators, so full record length is sum(lengths)-B+1.
      const oldLength = oldField.mode === 'record' ? oldField.blocks.reduce((sum, block) => sum + block.byteLength, 0) - oldField.blocks.length + 1 : oldField.blocks[0].byteLength
      const nextMode = oldLength + delta > CONTENT_BLOCK_LIMITS.bucketThreshold ? 'record' : 'value'
      if (oldField.mode === 'value' || nextMode !== oldField.mode) {
        fields[propsIndex] = partitionField(oldField.path, target.document.props, blocks, indexes)
        rewrittenPropBuckets = fields[propsIndex].blocks.length
      } else {
        if (!oldBuckets) return
        rewrittenPropBuckets = changedRows.size
        const refs = new Map(oldBuckets)
        for (const [bucket, rows] of changedRows) refs.set(bucket, addBlock(blocks, rows))
        indexes.set(pathKey(oldField.path), refs)
        fields[propsIndex] = { path: oldField.path, mode: 'record', blocks: [...refs].sort(([a], [b]) => a.localeCompare(b)).map(([, ref]) => ref) }
      }
      rewrittenFields.push(oldField.path)
    }
    if (transaction.revisionChanges) for (const key of ['revision', 'updatedAt'] as const) {
      if (transaction.revisionChanges[key].before === transaction.revisionChanges[key].after) continue
      const index = fields.findIndex(field => pathKey(field.path) === pathKey(['document', key]))
      if (index < 0) return
      fields[index] = partitionField(['document', key], target.document[key], blocks, indexes)
      rewrittenFields.push(['document', key])
    }
    // Keep exactly the current closure, including shared block hashes. Old
    // replaced buckets must never leak into the returned write collection.
    const closure = new Map<string, ProjectContentBlock>()
    for (const field of fields) for (const ref of field.blocks) {
      const block = blocks.get(ref.sha256)
      if (!block || block.bytes.length !== ref.byteLength) return
      closure.set(ref.sha256, block)
    }
    const result = ownPartition(checked.canonical, { format: CONTENT_BLOCK_FORMAT, version: 1, contentHash: checked.contentHash, byteLength: checked.byteLength, fields }, [...closure.values()], indexes)
    if (!rememberPartition(result)) return
    const baselineHashes = new Set(baseline.blocks.map(block => block.sha256))
    return { rewrittenFields, rewrittenPropBuckets, reusedBlocks: result.blocks.filter(block => baselineHashes.has(block.sha256)).length }
  } catch { return undefined }
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
interface ParsedBlock { value: unknown; byteLength: number; values: number; retainedBytes: number }
type BlockReader = (hash: string) => Promise<ProjectContentBlock | undefined>
async function parseContentBlock(ref: BlockRef, read: BlockReader): Promise<ParsedBlock> {
  const checked = checkedContentBlock(await read(ref.sha256), ref), budget = { values: 0 }
  const value = parseBoundedJson(checked.bytes, budget)
  if (canonicalJson(value) !== new TextDecoder('utf-8', { fatal: true }).decode(checked.bytes)) throw new Error('工程内容块不是规范JSON字节。')
  return { value: freezeJson(value), byteLength: checked.bytes.length, values: budget.values,
    retainedBytes: checked.bytes.length * 2 + budget.values * 32 + 160 }
}
async function assembleProjectContent(input: unknown, read: (ref: BlockRef) => Promise<ParsedBlock>, maximumValues: number = PACKAGE_LIMITS.jsonValues): Promise<ProjectData> {
  const manifest = validateProjectBlockManifest(input), output: Record<string, unknown> = {}, distinct = new Set<string>()
  let valuesUsed = 0
  for (const field of manifest.fields) {
    const values: unknown[] = []
    for (const ref of field.blocks) {
      const block = await read(ref)
      if (block.byteLength !== ref.byteLength) throw new Error('工程内容块引用长度不一致。')
      // The original budget charged each distinct actual block once per
      // manifest. A hit from another version must pay that same charge again.
      if (!distinct.has(ref.sha256)) { distinct.add(ref.sha256); valuesUsed += block.values }
      if (valuesUsed > maximumValues) throw new Error('JSON 深度或累计节点数量超过保护值。')
      values.push(block.value)
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
export async function materializeProjectContent(input: unknown, read: BlockReader): Promise<ProjectData> {
  const cache = new Map<string, ParsedBlock>()
  return assembleProjectContent(input, async ref => {
    let block = cache.get(ref.sha256)
    if (!block) { block = await parseContentBlock(ref, read); cache.set(ref.sha256, block) }
    return block
  })
}

export const MATERIALIZATION_CACHE_BYTES = 64 * 1024 * 1024
/** One captured read operation owns this proof. Each miss captures and hashes
 * actual bytes, strictly parses them, and privately freezes the result. It is
 * never evidence of current DB freshness. Callers retain their raw capture for
 * final exact confirmation, and close this bounded optional cache in finally. */
export function createProjectMaterializer(read: BlockReader, limits: { retainedBytes?: number; values?: number } = {}) {
  const maximum = limits.retainedBytes ?? MATERIALIZATION_CACHE_BYTES
  const maximumValues = limits.values ?? PACKAGE_LIMITS.jsonValues
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > MATERIALIZATION_CACHE_BYTES
    || !Number.isSafeInteger(maximumValues) || maximumValues < 1 || maximumValues > PACKAGE_LIMITS.jsonValues) throw new Error('物化缓存保护限制无效。')
  const cache = new Map<string, ParsedBlock>()
  let retained = 0, closed = false
  return Object.freeze({
    materialize(input: unknown): Promise<ProjectData> {
      if (closed) return Promise.reject(new Error('物化上下文已释放。'))
      return assembleProjectContent(input, async ref => {
        if (closed) throw new Error('物化上下文已释放。')
        let block = cache.get(ref.sha256)
        if (block) { cache.delete(ref.sha256); cache.set(ref.sha256, block); return block }
        block = await parseContentBlock(ref, read)
        if (closed) throw new Error('物化上下文已释放。')
        const concurrent = cache.get(ref.sha256)
        if (concurrent) return concurrent
        if (block.retainedBytes <= maximum) {
          while (retained + block.retainedBytes > maximum && cache.size) {
            const first = cache.keys().next().value!, old = cache.get(first)!
            cache.delete(first); retained -= old.retainedBytes
          }
          cache.set(ref.sha256, block); retained += block.retainedBytes
        }
        return block
      }, maximumValues)
    },
    close(): void { closed = true; cache.clear(); retained = 0 },
  })
}
export function manifestStorageBytes(project: ProjectData): number {
  return encodeUtf8(canonicalJson(partitionProjectContent(project).manifest)).length
}
