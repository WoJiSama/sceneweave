import { captureOwnedData } from '../io/v3/owned-data'
import { parseBoundedJson, utf8Encoder } from '../io/v3/json'
import { checkCancelled, hasExactKeys, isSha256 } from '../io/v6/limits'
import { sha256Bytes } from '../io/v6/resources'
import { readCatalogEntry } from './content'
import { validateCatalogItemV1 } from './metadata'
import { validateCatalogOrganization } from './organization'
import { CATALOG_LIMITS_V1, type CatalogBackupRecordV1, type PreparedCatalogEntryV1 } from './types'

interface SerializedRecord { item: PreparedCatalogEntryV1['item']; capsuleBase64: string; capsuleSha256: string; organization: CatalogBackupRecordV1['organization'] }

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let index = 0; index < bytes.length; index += 32768) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)))
  return btoa(chunks.join(''))
}

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(CATALOG_LIMITS_V1.capsuleBytes / 3) * 4 || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value) || /=/.test(value.slice(0, -2)) || value.endsWith('=') && value.at(-2) !== '=' && value.slice(0, -1).includes('=')) throw new Error('素材库载体必须使用有界规范base64。')
  let decoded: string
  try { decoded = atob(value) } catch { throw new Error('素材库载体base64无效。') }
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0))
  if (bytes.length > CATALOG_LIMITS_V1.capsuleBytes || encodeBase64(bytes) !== value) throw new Error('素材库载体base64不规范或超过32MiB。')
  return bytes
}

function validateDistinct(records: CatalogBackupRecordV1[]): void {
  const keys = new Set<string>(), logicalKeys = new Set<string>()
  for (const record of records) {
    const { key, logicalKey } = record.entry.item.identity
    if (keys.has(key) || logicalKeys.has(logicalKey)) throw new Error('完整库备份包含重复精确身份或逻辑身份。')
    keys.add(key); logicalKeys.add(logicalKey)
  }
}

export async function exportCatalogBackup(input: CatalogBackupRecordV1[], signal?: AbortSignal): Promise<Blob> {
  const records = captureOwnedData(input)
  if (!Array.isArray(records) || records.length < 1 || records.length > CATALOG_LIMITS_V1.batch) throw new Error('每次完整库备份需要1–64个条目。')
  const captured = records.map(record => {
    if (!hasExactKeys(record, ['entry', 'organization']) || !hasExactKeys(record.entry, ['item', 'capsule', 'capsuleSha256'])) throw new Error('完整库备份记录字段无效。')
    const item = validateCatalogItemV1(record.entry.item), organization = validateCatalogOrganization(record.organization)
    if (!(record.entry.capsule instanceof Blob) || record.entry.capsule.size > CATALOG_LIMITS_V1.capsuleBytes || !isSha256(record.entry.capsuleSha256)) throw new Error('完整素材载体超限或摘要无效。')
    return { entry: { ...record.entry, item }, organization }
  })
  validateDistinct(captured)
  if (captured.reduce((total, record) => total + record.entry.capsule.size, 0) > CATALOG_LIMITS_V1.backupPayloadBytes) throw new Error('完整库备份实际载体累计超过47MiB。')
  checkCancelled(signal)
  const serialized: SerializedRecord[] = []
  for (const record of captured) {
    await readCatalogEntry(record.entry, signal); checkCancelled(signal)
    const bytes = new Uint8Array(await record.entry.capsule.arrayBuffer())
    checkCancelled(signal)
    serialized.push({ item: record.entry.item, capsuleBase64: encodeBase64(bytes), capsuleSha256: record.entry.capsuleSha256, organization: record.organization })
  }
  const bytes = utf8Encoder.encode(JSON.stringify({ format: 'sceneweave-library', schemaVersion: 1, records: serialized }))
  if (bytes.length > CATALOG_LIMITS_V1.backupBytes) throw new Error('完整库备份文件超过64MiB。')
  checkCancelled(signal)
  return new Blob([bytes], { type: 'application/json' })
}

export async function readCatalogBackup(input: Blob, signal?: AbortSignal): Promise<CatalogBackupRecordV1[]> {
  const blob = captureOwnedData(input)
  if (!(blob instanceof Blob) || blob.size > CATALOG_LIMITS_V1.backupBytes) throw new Error('完整库备份文件无效或超过64MiB。')
  checkCancelled(signal)
  const value = parseBoundedJson(new Uint8Array(await blob.arrayBuffer()))
  if (!hasExactKeys(value, ['format', 'schemaVersion', 'records']) || value.format !== 'sceneweave-library' || value.schemaVersion !== 1
    || !Array.isArray(value.records) || value.records.length < 1 || value.records.length > CATALOG_LIMITS_V1.batch) throw new Error('不支持的完整库备份格式、版本或条目数量。')
  const records: CatalogBackupRecordV1[] = []
  let total = 0
  // Parse every record and establish aggregate bounds before invoking any native ZIP/image decoder.
  for (const record of value.records) {
    if (!hasExactKeys(record, ['item', 'capsuleBase64', 'capsuleSha256', 'organization']) || !isSha256(record.capsuleSha256)) throw new Error('完整库备份条目字段或摘要无效。')
    const item = validateCatalogItemV1(record.item), organization = validateCatalogOrganization(record.organization), bytes = decodeBase64(record.capsuleBase64)
    total += bytes.length
    if (total > CATALOG_LIMITS_V1.backupPayloadBytes) throw new Error('完整库备份实际载体累计超过47MiB。')
    checkCancelled(signal)
    if (await sha256Bytes(bytes) !== record.capsuleSha256) throw new Error('完整库备份载体SHA-256不匹配。')
    records.push({ entry: { item, capsule: new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), capsuleSha256: record.capsuleSha256 }, organization })
  }
  validateDistinct(records)
  for (const record of records) { await readCatalogEntry(record.entry, signal); checkCancelled(signal) }
  return records
}
