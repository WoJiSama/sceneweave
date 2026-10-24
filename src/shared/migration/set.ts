import { zipSync } from 'fflate'
import { z } from 'zod'
import { checkCancelled } from '../ports/resources.js'
import type { CancellationSignal } from '../ports/resources.js'
import { captureBytes, sha256Bytes } from '../project/binary.js'
import { parseBoundedJson } from '../project/json.js'
import type { JsonBudget } from '../project/json.js'
import { canonicalJson, captureJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { MIGRATION_SET_LIMITS, failMigrationSet } from './set-limits.js'
import { inspectMigrationVolumeZip } from './zip.js'
import type { BackupReceiptSummary, MigrationScope, PreservationRecordInput, PreservationRole } from './types.js'

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const keySchema = z.string().min(1).max(16_384).refine(value => !value.includes('\0') && value !== '__proto__')
const shortSchema = z.string().min(1).max(256).refine(value => !value.includes('\0') && value !== '__proto__')
const volumePathSchema = z.string().regex(/^part-(?:0[0-4][0-9]{2}|050[0-9]|051[01])\.sceneweave-migration-part$/)
const chunkPathSchema = z.string().regex(/^chunks\/[0-9a-f]{64}\.bin$/)
const roleSchema = z.enum(['current', 'automatic', 'named', 'protection', 'resource', 'license', 'resource-binding', 'history-metadata', 'legacy-source', 'legacy-blob', 'catalog-entry', 'catalog-organization', 'catalog-metadata'])
const scopeSchema = z.object({ kind: z.enum(['project-family', 'catalog']), repository: shortSchema, sourceSceneId: shortSchema.nullable() }).strict()
  .refine(scope => scope.kind === 'catalog' ? scope.sourceSceneId === null : scope.sourceSceneId !== null, 'scope与sourceSceneId不一致。')
const partSchema = z.object({ volume: volumePathSchema, entry: chunkPathSchema, offset: z.number().int().safe().nonnegative(), length: z.number().int().positive().max(MIGRATION_SET_LIMITS.chunkBytes) }).strict()
const recordSchema = z.object({ role: roleSchema, recordKey: keySchema, sourceFormat: shortSchema, contentHash: hashSchema, rawSha256: hashSchema, parts: z.array(partSchema) }).strict()
const volumeSchema = z.object({ path: volumePathSchema, sizeBytes: z.number().int().positive().max(MIGRATION_SET_LIMITS.compressedBytes), sha256: hashSchema }).strict()
const indexSchema = z.object({
  format: z.literal('sceneweave-migration-set'), schemaVersion: z.literal(1), setId: shortSchema,
  createdAt: z.string().datetime(), converterVersion: shortSchema, scope: scopeSchema, sourceFingerprint: hashSchema,
  volumes: z.array(volumeSchema).max(MIGRATION_SET_LIMITS.volumes), records: z.array(recordSchema).min(1), complete: z.literal(true),
}).strict()
const volumeManifestSchema = z.object({
  format: z.literal('sceneweave-migration-volume'), schemaVersion: z.literal(1), setId: shortSchema,
  index: z.number().int().min(0).max(MIGRATION_SET_LIMITS.volumes - 1),
  entries: z.array(z.object({ path: chunkPathSchema, sha256: hashSchema, sizeBytes: z.number().int().positive().max(MIGRATION_SET_LIMITS.chunkBytes) }).strict()).max(MIGRATION_SET_LIMITS.entries - 1),
}).strict()

export type { BackupReceiptSummary, MigrationScope } from './types.js'
export type MigrationRecordRole = PreservationRole
export type MigrationSetIndex = z.infer<typeof indexSchema>
export type MigrationRecord = MigrationSetIndex['records'][number]
export type MigrationRecordInput = PreservationRecordInput
export interface MigrationSetInput { setId: string; createdAt: string; converterVersion: string; scope: MigrationScope; sourceFingerprint: string; records: MigrationRecordInput[] }
export interface MigrationSetFiles { index: Uint8Array; volumes: Map<string, Uint8Array> }
export interface RecoveredMigrationRecord extends Omit<MigrationRecord, 'parts'> { bytes: Uint8Array }
declare const receiptBrand: unique symbol
export interface BackupReceipt extends BackupReceiptSummary { readonly [receiptBrand]: true }
export interface RecoveredMigrationSet { manifest: MigrationSetIndex; records: RecoveredMigrationRecord[]; receipt: BackupReceipt }
const receipts = new WeakMap<object, BackupReceiptSummary>()

/** Only a successful full reread creates this credential. JSON/clones cannot confer it. */
export function assertBackupReceipt(receipt: unknown, expected: { setId?: string; sourceFingerprint: string; indexHash?: string }): BackupReceiptSummary {
  const owned = receipt !== null && typeof receipt === 'object' ? receipts.get(receipt) : undefined
  if (!owned || expected.setId !== undefined && expected.setId !== owned.setId || expected.sourceFingerprint !== owned.sourceFingerprint || expected.indexHash !== undefined && expected.indexHash !== owned.indexHash) failMigrationSet('缺少与完整重读结果匹配的backupReceipt。')
  return owned
}

function ownFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) return failMigrationSet('输入须为普通数据对象。')
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return failMigrationSet('输入包含未知、隐藏或缺失字段。')
  const captured: Record<string, unknown> = {}
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return failMigrationSet('输入不接受访问器或隐藏字段。')
    captured[key] = descriptor.value
  }
  return captured
}

function ownArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return failMigrationSet('记录须为普通完整数组。')
  if (value.length > MIGRATION_SET_LIMITS.jsonValues) return failMigrationSet('记录数量超过JSON保护值。')
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1) return failMigrationSet('数组不接受空洞或额外属性。')
  const values: unknown[] = []
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return failMigrationSet('数组不接受访问器或空洞。')
    values.push(descriptor.value)
  }
  return values
}

function assertRecordIdentities(index: Pick<MigrationSetIndex, 'scope' | 'records'>): void {
  const keys = new Set<string>()
  for (const record of index.records) {
    const key = canonicalJson([record.role, record.recordKey])
    if (keys.has(key)) failMigrationSet('同一角色包含重复recordKey。')
    keys.add(key)
    if ((record.role.startsWith('catalog-')) !== (index.scope.kind === 'catalog') && !['resource', 'license', 'resource-binding', 'legacy-source', 'legacy-blob'].includes(record.role)) failMigrationSet('记录角色与保全scope不符。')
  }
  if (index.scope.kind === 'project-family' && index.records.filter(record => record.role === 'current').length !== 1) failMigrationSet('工程家族须有且仅有一个current。')
  if (index.scope.kind === 'catalog' && index.records.filter(record => record.role === 'catalog-metadata').length !== 1) failMigrationSet('目录须有且仅有一个catalog-metadata。')
}

function parseJson(bytes: Uint8Array, budget: JsonBudget): unknown { return parseBoundedJson(bytes, budget) }
function volumeName(index: number): string { return `part-${String(index).padStart(4, '0')}.sceneweave-migration-part` }
function jsonBytes(value: unknown): Uint8Array { return encodeUtf8(canonicalJson(value)) }

/** Capture metadata and exact opaque bytes before the first asynchronous boundary. */
function captureExportInput(input: MigrationSetInput): MigrationSetInput {
  const fields = ownFields(input, ['setId', 'createdAt', 'converterVersion', 'scope', 'sourceFingerprint', 'records'])
  const metadata = captureJson({ setId: fields.setId, createdAt: fields.createdAt, converterVersion: fields.converterVersion, scope: fields.scope, sourceFingerprint: fields.sourceFingerprint })
  const header = indexSchema.omit({ volumes: true, records: true }).parse({ format: 'sceneweave-migration-set', schemaVersion: 1, ...metadata, complete: true })
  const records = ownArray(fields.records).map(value => {
    const row = ownFields(value, ['role', 'recordKey', 'sourceFormat', 'contentHash', 'bytes'])
    const record = recordSchema.omit({ rawSha256: true, parts: true }).parse(captureJson({ role: row.role, recordKey: row.recordKey, sourceFormat: row.sourceFormat, contentHash: row.contentHash }))
    return { ...record, bytes: captureBytes(row.bytes as Uint8Array, MIGRATION_SET_LIMITS.volumes * MIGRATION_SET_LIMITS.expandedBytes) }
  })
  if (!records.length) failMigrationSet('保全set缺少记录。')
  assertRecordIdentities({ scope: header.scope, records: records.map(record => ({ ...record, rawSha256: '', parts: [] })) })
  return { setId: header.setId, createdAt: header.createdAt, converterVersion: header.converterVersion, scope: header.scope, sourceFingerprint: header.sourceFingerprint, records }
}

export async function exportMigrationSet(input: MigrationSetInput, signal?: CancellationSignal): Promise<MigrationSetFiles> {
  checkCancelled(signal)
  const captured = captureExportInput(input)
  const records: MigrationRecord[] = [], rawParts = new Map<string, MigrationRecord['parts']>(), chunks = new Map<string, { bytes: Uint8Array; volume: string }>()
  const volumeChunks: Map<string, Uint8Array>[] = []
  let currentChunks = new Map<string, Uint8Array>(), payloadSize = 0
  const finishVolume = (): void => { if (currentChunks.size) { volumeChunks.push(currentChunks); currentChunks = new Map(); payloadSize = 0 } }
  for (const record of captured.records) {
    checkCancelled(signal)
    const rawSha256 = sha256Bytes(record.bytes)
    let parts = rawParts.get(rawSha256)
    if (!parts) {
      parts = []
      for (let offset = 0; offset < record.bytes.length; offset += MIGRATION_SET_LIMITS.chunkBytes) {
        checkCancelled(signal)
        const bytes = record.bytes.slice(offset, Math.min(record.bytes.length, offset + MIGRATION_SET_LIMITS.chunkBytes)), hash = sha256Bytes(bytes), entry = `chunks/${hash}.bin`
        let chunk = chunks.get(entry)
        if (!chunk) {
          // Reserve the whole allowed manifest budget before accepting payload.
          if (payloadSize + bytes.length > MIGRATION_SET_LIMITS.expandedBytes - MIGRATION_SET_LIMITS.manifestBytes || currentChunks.size >= MIGRATION_SET_LIMITS.entries - 1) finishVolume()
          if (volumeChunks.length >= MIGRATION_SET_LIMITS.volumes) failMigrationSet('分卷数量超过512。')
          chunk = { bytes, volume: volumeName(volumeChunks.length) }; chunks.set(entry, chunk); currentChunks.set(entry, bytes); payloadSize += bytes.length
        }
        parts.push({ volume: chunk.volume, entry, offset, length: bytes.length })
      }
      rawParts.set(rawSha256, parts)
    }
    records.push({ role: record.role, recordKey: record.recordKey, sourceFormat: record.sourceFormat, contentHash: record.contentHash, rawSha256, parts: parts.map(part => ({ ...part })) })
  }
  finishVolume()
  const volumes = new Map<string, Uint8Array>(), descriptors: MigrationSetIndex['volumes'] = [], budget: JsonBudget = { values: 0 }
  for (let index = 0; index < volumeChunks.length; index++) {
    checkCancelled(signal)
    const files = volumeChunks[index], manifest = { format: 'sceneweave-migration-volume', schemaVersion: 1, setId: captured.setId, index, entries: [...files].map(([path, bytes]) => ({ path, sha256: path.slice(7, -4), sizeBytes: bytes.length })) }
    const manifestBytes = jsonBytes(manifest)
    if (manifestBytes.length > MIGRATION_SET_LIMITS.manifestBytes) failMigrationSet('分卷清单超过1 MiB。')
    parseJson(manifestBytes, budget)
    const bytes = zipSync({ 'volume.json': manifestBytes, ...Object.fromEntries(files) }, { level: 0, mtime: new Date(2000, 0, 1, 0, 0, 0) }), path = volumeName(index)
    if (bytes.length > MIGRATION_SET_LIMITS.compressedBytes) failMigrationSet('分卷ZIP超过33 MiB。')
    volumes.set(path, bytes); descriptors.push({ path, sha256: sha256Bytes(bytes), sizeBytes: bytes.length })
  }
  const manifest: MigrationSetIndex = { format: 'sceneweave-migration-set', schemaVersion: 1, setId: captured.setId, createdAt: captured.createdAt, converterVersion: captured.converterVersion, scope: captured.scope, sourceFingerprint: captured.sourceFingerprint, volumes: descriptors, records, complete: true }
  const index = jsonBytes(manifest)
  if (index.length > MIGRATION_SET_LIMITS.indexBytes) failMigrationSet('主索引超过16 MiB。')
  indexSchema.parse(parseJson(index, budget))
  checkCancelled(signal)
  return { index, volumes }
}

function captureVolumes(input: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array>, expected: MigrationSetIndex['volumes']): Map<string, Uint8Array> {
  const raw = new Map<string, unknown>()
  if (input instanceof Map && Object.getPrototypeOf(input) === Map.prototype && Reflect.ownKeys(input).length === 0) {
    for (const [key, bytes] of Map.prototype.entries.call(input) as MapIterator<[unknown, unknown]>) {
      if (typeof key !== 'string') failMigrationSet('分卷名称须为字符串。')
      raw.set(key, bytes)
    }
  } else {
    const values = ownFields(input, expected.map(volume => volume.path))
    for (const [key, bytes] of Object.entries(values)) raw.set(key, bytes)
  }
  if (raw.size !== expected.length || expected.some(volume => !raw.has(volume.path))) failMigrationSet('缺少分卷或含未声明分卷。')
  const owned = new Map<string, Uint8Array>()
  for (const volume of expected) {
    const bytes = captureBytes(raw.get(volume.path) as Uint8Array, volume.sizeBytes)
    if (bytes.length !== volume.sizeBytes || sha256Bytes(bytes) !== volume.sha256) failMigrationSet('分卷实际长度或SHA256与索引不符。')
    owned.set(volume.path, bytes)
  }
  return owned
}

export async function importMigrationSet(indexInput: Uint8Array, volumeInput: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array>, signal?: CancellationSignal): Promise<RecoveredMigrationSet> {
  checkCancelled(signal)
  const indexBytes = captureBytes(indexInput, MIGRATION_SET_LIMITS.indexBytes), budget: JsonBudget = { values: 0 }, manifest = indexSchema.parse(parseJson(indexBytes, budget))
  assertRecordIdentities(manifest)
  const declaredVolumes = new Set<string>()
  for (const [index, volume] of manifest.volumes.entries()) {
    if (declaredVolumes.has(volume.path) || volume.path !== volumeName(index)) failMigrationSet('分卷名称重复、不连续或顺序错误。')
    declaredVolumes.add(volume.path)
  }
  const volumeBytes = captureVolumes(volumeInput, manifest.volumes)
  const chunks = new Map<string, Uint8Array>(), chunkVolumes = new Map<string, string>()
  for (const [index, volume] of manifest.volumes.entries()) {
    checkCancelled(signal)
    const zip = inspectMigrationVolumeZip(volumeBytes.get(volume.path)!, signal), volumeManifest = volumeManifestSchema.parse(parseJson(await zip.read('volume.json'), budget))
    if (volumeManifest.setId !== manifest.setId || volumeManifest.index !== index || volumeManifest.entries.length + 1 !== zip.entries.size) failMigrationSet('分卷清单setId/index或条目数量不一致。')
    const paths = new Set<string>()
    for (const entry of volumeManifest.entries) {
      if (paths.has(entry.path) || chunks.has(entry.path) || !zip.entries.has(entry.path) || entry.path !== `chunks/${entry.sha256}.bin`) failMigrationSet('分卷清单有重复、未知或hash路径不匹配。')
      paths.add(entry.path)
      const bytes = await zip.read(entry.path)
      if (bytes.length !== entry.sizeBytes || sha256Bytes(bytes) !== entry.sha256) failMigrationSet('块的实际长度或SHA256不一致。')
      chunks.set(entry.path, bytes); chunkVolumes.set(entry.path, volume.path)
    }
    if ([...zip.entries.keys()].some(path => path !== 'volume.json' && !paths.has(path))) failMigrationSet('ZIP含清单未声明内容。')
  }
  const records: RecoveredMigrationRecord[] = [], usedChunks = new Set<string>(), rawRecords = new Map<string, { bytes: Uint8Array; parts: string }>()
  for (const record of manifest.records) {
    checkCancelled(signal)
    let size = 0
    const orderedParts = [...record.parts].sort((a, b) => a.offset - b.offset)
    for (const part of orderedParts) {
      const chunk = chunks.get(part.entry)
      if (!declaredVolumes.has(part.volume) || chunkVolumes.get(part.entry) !== part.volume || !chunk || part.length !== chunk.length || part.offset !== size) failMigrationSet('记录重组缺块、错卷、重复覆盖、重叠或有洞。')
      size += part.length
      if (!Number.isSafeInteger(size) || size > MIGRATION_SET_LIMITS.volumes * MIGRATION_SET_LIMITS.expandedBytes) failMigrationSet('记录重组长度超过分卷保护值。')
      usedChunks.add(part.entry)
    }
    const partSignature = canonicalJson(orderedParts), previous = rawRecords.get(record.rawSha256)
    let bytes: Uint8Array
    if (previous) {
      if (previous.parts !== partSignature) failMigrationSet('同一rawSHA256须引用同一确切分块。')
      bytes = previous.bytes
    } else {
      bytes = new Uint8Array(size)
      for (const part of orderedParts) { checkCancelled(signal); bytes.set(chunks.get(part.entry)!, part.offset) }
      if (sha256Bytes(bytes) !== record.rawSha256) failMigrationSet('记录重组后的原始总SHA256不一致。')
      rawRecords.set(record.rawSha256, { bytes, parts: partSignature })
    }
    // Return independent bytes for each role; mutating recovered records cannot forge receipts.
    records.push({ role: record.role, recordKey: record.recordKey, sourceFormat: record.sourceFormat, contentHash: record.contentHash, rawSha256: record.rawSha256, bytes: bytes.slice() })
  }
  if (usedChunks.size !== chunks.size) failMigrationSet('分卷包含索引记录未使用的块。')
  checkCancelled(signal)
  const summary = freezeJson({ setId: manifest.setId, sourceFingerprint: manifest.sourceFingerprint, indexHash: sha256Bytes(indexBytes), volumeHashes: manifest.volumes.map(volume => ({ path: volume.path, sha256: volume.sha256 })) })
  const receipt = summary as BackupReceipt
  receipts.set(receipt, summary)
  return { manifest: freezeJson(manifest), records, receipt }
}
