import { Inflate, zipSync } from 'fflate'
import { validateScene } from '../core/schema'
import { cloneScene, newId, type SceneDocument } from '../core/types'

/** M0 deliberately accepts only geometry, not the future asset container profile. */
export const PROJECT_LIMITS = Object.freeze({
  compressedBytes: 5 * 1024 * 1024,
  sceneBytes: 10 * 1024 * 1024,
  manifestBytes: 64 * 1024,
  entries: 2,
  jsonDepth: 128,
  jsonValues: 300_000,
})

interface Manifest {
  format: 'sceneweave-project'
  containerVersion: 1
  documentSchemaVersion: 1
  application: 'Sceneweave'
  applicationVersion: string
  profile: 'm0-geometry'
  sceneId: string
  entries: [{ path: 'scene.json'; sha256: string; sizeBytes: number; mimeType: 'application/json' }]
  assetLicenses: []
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
function fail(message: string): never { throw new Error(`工程文件无效：${message}`) }
const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

function assertM0(document: SceneDocument): void {
  if (Object.keys(document.floors).length !== 1) fail('M0 仅支持单楼层。')
  if (Object.keys(document.assets).length || Object.values(document.props).some(prop => prop.assetId !== null)) {
    fail('M0 仅支持原生符号物件；不能导入或导出外部素材工程。')
  }
}

export async function exportProject(scene: SceneDocument): Promise<Blob> {
  const snapshot = cloneScene(scene)
  const checked = validateScene(snapshot)
  if (!checked.ok) fail(checked.errors.map(issue => issue.message).join('；'))
  assertM0(snapshot)
  const sceneBytes = encoder.encode(JSON.stringify(snapshot))
  if (sceneBytes.length > PROJECT_LIMITS.sceneBytes) fail('场景超过 M0 的 10 MiB 展开限制。')
  const manifest: Manifest = {
    format: 'sceneweave-project', containerVersion: 1, documentSchemaVersion: 1,
    application: 'Sceneweave', applicationVersion: '0.1.0-m0', profile: 'm0-geometry', sceneId: snapshot.sceneId,
    entries: [{ path: 'scene.json', sha256: await sha256(sceneBytes), sizeBytes: sceneBytes.length, mimeType: 'application/json' }],
    assetLicenses: [],
  }
  const bytes = zipSync({ 'manifest.json': encoder.encode(JSON.stringify(manifest)), 'scene.json': sceneBytes }, { level: 6 })
  if (bytes.length > PROJECT_LIMITS.compressedBytes) fail('工程超过 M0 的 5 MiB 压缩限制。')
  return new Blob([bytes.slice().buffer], { type: 'application/x-sceneweave' })
}

/** Read the validated M0 source unchanged; migration retains its real identity and bytes. */
export async function readProjectV1(file: Blob): Promise<SceneDocument> {
  if (!file.size || file.size > PROJECT_LIMITS.compressedBytes) fail('压缩文件大小必须在 1 字节至 5 MiB 之间。')
  const entries = readZip(new Uint8Array(await file.arrayBuffer()))
  const manifest = readManifest(parseJson(entries['manifest.json']))
  const sceneBytes = entries['scene.json']
  const entry = manifest.entries[0]
  if (entry.sizeBytes !== sceneBytes.length || entry.sha256 !== await sha256(sceneBytes)) fail('scene.json 的大小或 SHA-256 不匹配。')
  const checked = validateScene(parseJson(sceneBytes))
  if (!checked.ok) fail(checked.errors.map(issue => issue.message).join('；'))
  const document = checked.document
  if (document.sceneId !== manifest.sceneId) fail('manifest 与 scene 的场景 ID 不匹配。')
  assertM0(document)
  return document
}

export async function importProject(file: Blob): Promise<SceneDocument> {
  const document = await readProjectV1(file)
  const imported = cloneScene(document)
  const stamp = new Date().toISOString()
  imported.sceneId = newId()
  imported.revision = 0
  imported.createdAt = stamp
  imported.updatedAt = stamp
  return imported
}

function ownKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function readManifest(value: unknown): Manifest {
  if (!ownKeys(value, ['format', 'containerVersion', 'documentSchemaVersion', 'application', 'applicationVersion', 'profile', 'sceneId', 'entries', 'assetLicenses'])) fail('manifest 字段缺失或未知。')
  if (value.format !== 'sceneweave-project' || value.containerVersion !== 1 || value.documentSchemaVersion !== 1
    || value.application !== 'Sceneweave' || value.profile !== 'm0-geometry') fail('未知工程版本或 M0 不支持的工程类型。')
  if (typeof value.applicationVersion !== 'string' || value.applicationVersion.length > 100
    || typeof value.sceneId !== 'string' || !value.sceneId.length || value.sceneId.length > 256) fail('manifest 版本或场景 ID 无效。')
  if (!Array.isArray(value.assetLicenses) || value.assetLicenses.length !== 0 || !Array.isArray(value.entries) || value.entries.length !== 1) fail('M0 工程只能声明 scene.json，不能包含素材。')
  const entry: unknown = value.entries[0]
  if (!ownKeys(entry, ['path', 'sha256', 'sizeBytes', 'mimeType']) || entry.path !== 'scene.json' || entry.mimeType !== 'application/json'
    || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)
    || !Number.isSafeInteger(entry.sizeBytes) || Number(entry.sizeBytes) < 1 || Number(entry.sizeBytes) > PROJECT_LIMITS.sceneBytes) fail('manifest 场景条目无效。')
  return value as unknown as Manifest
}

/** Validate duplicate decoded keys before JSON.parse can silently discard one. */
function parseJson(bytes: Uint8Array): unknown {
  let source: string
  try { source = decoder.decode(bytes) } catch { return fail('JSON 必须为有效 UTF-8。') }
  let cursor = 0
  let values = 0
  const primitive = /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y
  const whitespace = () => { while (cursor < source.length && /[\x20\t\r\n]/.test(source[cursor])) cursor++ }
  const readString = (): string => {
    if (source[cursor] !== '"') fail('JSON 字符串格式错误。')
    const start = cursor++
    while (cursor < source.length) {
      const character = source[cursor++]
      if (character === '\\') { cursor++; continue }
      if (character === '"') {
        try { return JSON.parse(source.slice(start, cursor)) as string } catch { return fail('JSON 字符串编码无效。') }
      }
    }
    return fail('JSON 字符串未闭合。')
  }
  const value = (depth: number): void => {
    if (depth > PROJECT_LIMITS.jsonDepth || ++values > PROJECT_LIMITS.jsonValues) fail('JSON 深度或节点数量超过 M0 限制。')
    whitespace()
    const character = source[cursor]
    if (character === '{') {
      cursor++; whitespace()
      const keys = new Set<string>()
      if (source[cursor] === '}') { cursor++; return }
      while (true) {
        whitespace()
        const key = readString()
        if (keys.has(key)) fail(`JSON 包含重复字段：${key.slice(0, 100)}`)
        keys.add(key); whitespace()
        if (source[cursor++] !== ':') fail('JSON 字段缺少冒号。')
        value(depth + 1); whitespace()
        const delimiter = source[cursor++]
        if (delimiter === '}') return
        if (delimiter !== ',') fail('JSON 对象分隔错误。')
      }
    }
    if (character === '[') {
      cursor++; whitespace()
      if (source[cursor] === ']') { cursor++; return }
      while (true) {
        value(depth + 1); whitespace()
        const delimiter = source[cursor++]
        if (delimiter === ']') return
        if (delimiter !== ',') fail('JSON 数组分隔错误。')
      }
    }
    if (character === '"') { readString(); return }
    primitive.lastIndex = cursor
    const token = primitive.exec(source)
    if (!token) fail('JSON 值格式错误。')
    cursor += token[0].length
  }
  value(0); whitespace()
  if (cursor !== source.length) fail('JSON 包含多余内容。')
  try { return JSON.parse(source) } catch { return fail('JSON 格式错误。') }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipEntry { name: string; flags: number; method: number; crc: number; compressed: number; expanded: number; offset: number }

/** Inspect all central/local records and budgets before any decompression. */
function readZip(bytes: Uint8Array): Record<'manifest.json' | 'scene.json', Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  const within = (offset: number, length: number, end = bytes.length): void => {
    if (!Number.isSafeInteger(offset + length) || offset < 0 || length < 0 || offset + length > end) fail('ZIP 条目越界。')
  }
  if (bytes.length < 22) fail('缺少 ZIP 结束记录。')
  let end = bytes.length - 22
  const minimum = Math.max(0, end - 65_535)
  while (end >= minimum && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--
  if (end < minimum) fail('缺少有效 ZIP 结束记录。')
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) fail('不支持分卷 ZIP。')
  if (u16(end + 10) !== PROJECT_LIMITS.entries) fail('M0 ZIP 必须恰好包含 manifest.json 与 scene.json 两个条目。')
  const centralSize = u32(end + 12)
  const centralStart = u32(end + 16)
  within(centralStart, centralSize, end)
  if (centralStart + centralSize !== end) fail('不支持 ZIP64 或额外 ZIP 记录。')
  const entries: ZipEntry[] = []
  const names = new Set<string>()
  let cursor = centralStart
  let totalExpanded = 0
  for (let index = 0; index < PROJECT_LIMITS.entries; index++) {
    within(cursor, 46, end)
    if (u32(cursor) !== 0x02014b50 || u16(cursor + 6) > 20 || u16(cursor + 34)) fail('ZIP 中央目录格式或版本不支持。')
    const nameSize = u16(cursor + 28), extraSize = u16(cursor + 30), commentSize = u16(cursor + 32)
    within(cursor + 46, nameSize + extraSize + commentSize, end)
    let name: string
    try { name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize)) } catch { return fail('ZIP 路径必须为 UTF-8。') }
    if (names.has(name)) fail('ZIP 包含重复路径。')
    names.add(name)
    if (/^(?:[/\\]|[a-z]:)/i.test(name) || name.split(/[/\\]/).some(part => part === '..' || part === '.') || name.includes('\0')) fail('ZIP 包含不安全路径。')
    if (name !== 'manifest.json' && name !== 'scene.json') fail('M0 不接受额外条目、素材或嵌套归档。')
    const entry: ZipEntry = { name, flags: u16(cursor + 8), method: u16(cursor + 10), crc: u32(cursor + 16), compressed: u32(cursor + 20), expanded: u32(cursor + 24), offset: u32(cursor + 42) }
    if (entry.flags & ~0x080e || ![0, 8].includes(entry.method) || (entry.method === 0 && (entry.flags & 6))) fail('ZIP 加密、压缩方式或标志不支持。')
    const budget = name === 'scene.json' ? PROJECT_LIMITS.sceneBytes : PROJECT_LIMITS.manifestBytes
    if (entry.expanded < 1 || entry.expanded > budget || entry.compressed > PROJECT_LIMITS.compressedBytes) fail('ZIP 条目超过 M0 展开预算。')
    totalExpanded += entry.expanded
    if (totalExpanded > PROJECT_LIMITS.sceneBytes + PROJECT_LIMITS.manifestBytes) fail('ZIP 展开总量超过 M0 预算。')
    entries.push(entry)
    cursor += 46 + nameSize + extraSize + commentSize
  }
  if (cursor !== end || names.size !== 2) fail('ZIP 中央目录不完整。')
  entries.sort((left, right) => left.offset - right.offset)
  cursor = 0
  const payloads: { entry: ZipEntry; bytes: Uint8Array }[] = []
  for (const entry of entries) {
    if (entry.offset !== cursor) fail('ZIP 本地条目重叠或包含额外数据。')
    within(cursor, 30, centralStart)
    if (u32(cursor) !== 0x04034b50 || u16(cursor + 4) > 20 || u16(cursor + 6) !== entry.flags || u16(cursor + 8) !== entry.method) fail('ZIP 本地条目与中央目录不一致。')
    const nameSize = u16(cursor + 26), extraSize = u16(cursor + 28)
    within(cursor + 30, nameSize + extraSize, centralStart)
    if (decoder.decode(bytes.subarray(cursor + 30, cursor + 30 + nameSize)) !== entry.name) fail('ZIP 本地路径与中央目录不一致。')
    const dataStart = cursor + 30 + nameSize + extraSize
    within(dataStart, entry.compressed, centralStart)
    if (!(entry.flags & 8)) {
      if (u32(cursor + 14) !== entry.crc || u32(cursor + 18) !== entry.compressed || u32(cursor + 22) !== entry.expanded) fail('ZIP 条目长度不一致。')
    } else if ((u32(cursor + 14) && u32(cursor + 14) !== entry.crc) || (u32(cursor + 18) && u32(cursor + 18) !== entry.compressed) || (u32(cursor + 22) && u32(cursor + 22) !== entry.expanded)) fail('ZIP 数据描述长度不一致。')
    payloads.push({ entry, bytes: bytes.subarray(dataStart, dataStart + entry.compressed) })
    cursor = dataStart + entry.compressed
    if (entry.flags & 8) {
      within(cursor, 12, centralStart)
      if (u32(cursor) === 0x08074b50) { within(cursor, 16, centralStart); cursor += 4 }
      if (u32(cursor) !== entry.crc || u32(cursor + 4) !== entry.compressed || u32(cursor + 8) !== entry.expanded) fail('ZIP 数据描述不一致。')
      cursor += 12
    }
  }
  if (cursor !== centralStart) fail('ZIP 本地数据未完整声明。')
  const output: Record<string, Uint8Array> = {}
  for (const { entry, bytes: compressed } of payloads) {
    let expanded: Uint8Array
    if (entry.method === 0) {
      if (compressed.length !== entry.expanded) fail('未压缩 ZIP 条目长度不匹配。')
      expanded = compressed.slice()
    } else {
      const chunks: Uint8Array[] = []
      let size = 0
      const inflater = new Inflate(chunk => {
        size += chunk.length
        if (size > entry.expanded) fail('ZIP 实际展开量超过声明。')
        chunks.push(chunk)
      })
      try {
        for (let offset = 0; offset < compressed.length; offset += 1024) inflater.push(compressed.subarray(offset, offset + 1024), offset + 1024 >= compressed.length)
      } catch (error) { return fail(error instanceof Error ? error.message : 'ZIP 解压失败。') }
      if (size !== entry.expanded) fail('ZIP 实际展开长度不匹配。')
      expanded = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { expanded.set(chunk, offset); offset += chunk.length }
    }
    if (crc32(expanded) !== entry.crc) fail('ZIP CRC 校验失败。')
    output[entry.name] = expanded
  }
  return output as Record<'manifest.json' | 'scene.json', Uint8Array>
}
