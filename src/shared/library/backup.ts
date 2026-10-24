import type { CompleteValidationOptions } from '../ports/resources.js'
import { checkCancelled } from '../ports/resources.js'
import { captureBytes, sha256Bytes } from '../project/binary.js'
import { parseBoundedJson } from '../project/json.js'
import { hasExactKeys, isSha256 } from '../project/limits.js'
import { captureJson, encodeUtf8 } from '../validation/json.js'
import { captureLibraryEntries, validateLibraryEntry } from './content.js'
import { validateCatalogItem, validateCatalogKey } from './metadata.js'
import { validateCatalogOrganization } from './organization.js'
import { LIBRARY_LIMITS, type CatalogOrganization, type LibraryBackup, type PreparedLibraryEntry } from './types.js'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = []; let chunk = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    chunk += alphabet[a >> 2] + alphabet[(a & 3) << 4 | (b ?? 0) >> 4]
      + (i + 1 < bytes.length ? alphabet[(b & 15) << 2 | (c ?? 0) >> 6] : '=')
      + (i + 2 < bytes.length ? alphabet[c & 63] : '=')
    if (chunk.length >= 8192) { chunks.push(chunk); chunk = '' }
  }
  chunks.push(chunk); return chunks.join('')
}
function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(LIBRARY_LIMITS.capsuleBytes / 3) * 4 || value.length % 4
    || /[^A-Za-z0-9+/=]/.test(value) || /=/.test(value.slice(0, -2)) || value.endsWith('=') && value.at(-2) !== '=' && value.slice(0, -1).includes('=')) throw new Error('素材载体必须使用有界规范base64。')
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array(value.length / 4 * 3 - padding)
  if (bytes.length > LIBRARY_LIMITS.capsuleBytes) throw new Error('素材载体超过32MiB。')
  let offset = 0
  for (let i = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]), b = alphabet.indexOf(value[i + 1]), c = alphabet.indexOf(value[i + 2]), d = alphabet.indexOf(value[i + 3])
    bytes[offset++] = a << 2 | b >> 4
    if (offset < bytes.length) bytes[offset++] = (b & 15) << 4 | c >> 2
    if (offset < bytes.length) bytes[offset++] = (c & 3) << 6 | d
  }
  if (encodeBase64(bytes) !== value) throw new Error('素材载体base64不规范。')
  return bytes
}

export function validateLibraryOrganizations(input: unknown): Record<string, CatalogOrganization> {
  const value = captureJson(input)
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > LIBRARY_LIMITS.organizationRecords) throw new Error('个人整理必须是至多2048条精确身份映射。')
  return Object.fromEntries(Object.entries(value).map(([key, organization]) => [validateCatalogKey(key), validateCatalogOrganization(organization)]))
}
function distinct(entries: PreparedLibraryEntry[]): void {
  const keys = new Set<string>(), logical = new Set<string>()
  for (const entry of entries) {
    const identity = entry.item.identity
    if (keys.has(identity.key) || logical.has(identity.logicalKey)) throw new Error('所选库备份含重复精确或逻辑素材身份。')
    keys.add(identity.key); logical.add(identity.logicalKey)
  }
  if (entries.reduce((total, entry) => total + entry.capsule.length, 0) > LIBRARY_LIMITS.backupPayloadBytes) throw new Error('所选库备份载体累计超过47MiB。')
}
/** One logical fixed identity cannot point to different content, even through organization-only keys. */
export function assertLibraryIdentityCompatibility(entries: readonly { item: PreparedLibraryEntry['item'] }[], organizations: Record<string, CatalogOrganization>): void {
  const logical = new Map<string, string>()
  const check = (key: string) => {
    const tuple = JSON.parse(validateCatalogKey(key)) as unknown[], logicalKey = JSON.stringify(tuple.slice(0, 5)), contentHash = tuple[5] as string
    if (logical.has(logicalKey) && logical.get(logicalKey) !== contentHash) throw new Error('相同逻辑素材身份对应不同固定内容。')
    logical.set(logicalKey, contentHash)
  }
  for (const entry of entries) check(entry.item.identity.key)
  for (const key of Object.keys(organizations)) check(key)
}
function nonempty(entries: PreparedLibraryEntry[], organizations: Record<string, CatalogOrganization>): void {
  if (!entries.length && !Object.keys(organizations).length) throw new Error('所选库备份至少选择一个安装条目或个人整理记录。')
}

/** Selected content and organization backup; whole-library preservation uses a migration set. */
export async function exportLibraryBackup(input: LibraryBackup, validation: CompleteValidationOptions): Promise<Uint8Array> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('所选库备份必须是普通对象。')
  const fields = Object.getOwnPropertyDescriptors(input), keys = ['entries', 'organizations']
  if (Reflect.ownKeys(input).length !== keys.length || !keys.every(key => fields[key]?.enumerable && 'value' in fields[key])) throw new Error('所选库备份含未知、访问器、隐藏或Symbol字段。')
  const entries = captureLibraryEntries(fields.entries.value!, LIBRARY_LIMITS.batch, LIBRARY_LIMITS.backupPayloadBytes), organizations = validateLibraryOrganizations(fields.organizations.value)
  distinct(entries); assertLibraryIdentityCompatibility(entries, organizations); nonempty(entries, organizations); checkCancelled(validation?.signal)
  const records = entries.map(entry => ({ item: entry.item, capsuleBase64: encodeBase64(entry.capsule), capsuleSha256: entry.capsuleSha256 }))
  const bytes = encodeUtf8(JSON.stringify({ format: 'sceneweave-asset-library', schemaVersion: 1, capsuleFormat: 'sceneweave-complete-project@1', records, organizations }))
  if (bytes.length > LIBRARY_LIMITS.backupBytes) throw new Error('所选库备份超过64MiB。')
  for (const entry of entries) { await validateLibraryEntry(entry, validation); checkCancelled(validation?.signal) }
  return bytes
}

export async function importLibraryBackup(input: Uint8Array, validation: CompleteValidationOptions): Promise<LibraryBackup> {
  const bytes = captureBytes(input, LIBRARY_LIMITS.backupBytes)
  checkCancelled(validation?.signal)
  const value = parseBoundedJson(bytes)
  if (!hasExactKeys(value, ['format', 'schemaVersion', 'capsuleFormat', 'records', 'organizations']) || value.format !== 'sceneweave-asset-library'
    || value.schemaVersion !== 1 || value.capsuleFormat !== 'sceneweave-complete-project@1' || !Array.isArray(value.records) || value.records.length > LIBRARY_LIMITS.batch) throw new Error('所选库备份格式、版本或载体格式无效。')
  const organizations = validateLibraryOrganizations(value.organizations), entries: PreparedLibraryEntry[] = []
  let total = 0
  // Establish all aggregate bounds and exact identities before invoking a ZIP or image decoder.
  for (const record of value.records) {
    if (!hasExactKeys(record, ['item', 'capsuleBase64', 'capsuleSha256']) || !isSha256(record.capsuleSha256)) throw new Error('所选库备份记录字段或摘要无效。')
    const item = validateCatalogItem(record.item), capsule = decodeBase64(record.capsuleBase64)
    if ((total += capsule.length) > LIBRARY_LIMITS.backupPayloadBytes) throw new Error('所选库备份载体累计超过47MiB。')
    if (sha256Bytes(capsule) !== record.capsuleSha256) throw new Error('所选库备份载体摘要不符。')
    entries.push({ item, capsule, capsuleSha256: record.capsuleSha256 })
  }
  distinct(entries); assertLibraryIdentityCompatibility(entries, organizations); nonempty(entries, organizations)
  for (const entry of entries) { await validateLibraryEntry(entry, validation); checkCancelled(validation?.signal) }
  return { entries, organizations }
}
