import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeStaticSvg, verifyNormalizedStaticSvg } from '../../src/shared/ai/svg.js'
import { canonicalJson, encodeUtf8 } from '../../src/shared/validation/json.js'
import type { PrivateArtifacts } from './artifacts.js'
import type { PrivateStorage } from './private-storage.js'

const taskId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hash = /^[a-f0-9]{64}$/
const recordName = 'record.json'
const sourceName = 'source.svg'
const normalizedName = 'normalized.svg'

export interface StaticSvgArtifactRecord {
  schemaVersion: 1
  id: string
  sourceSha256: string
  normalizedSha256: string
  sourceSizeBytes: number
  normalizedSizeBytes: number
  processorId: 'sceneweave-static-svg'
  processorVersion: 1
}

export interface StoredStaticSvgArtifact {
  record: StaticSvgArtifactRecord
  sourceSvg: string
  normalizedSvg: string
}

function invalid(message: string): never { throw new Error('私有SVG制品无效：' + message) }
function requireTask(value: string): void { if (!taskId.test(value)) invalid('任务ID无效。') }
function requireHash(value: string): void { if (!hash.test(value)) invalid('制品ID无效。') }
function privateDirectory(access: PrivateStorage, path: string): void {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isDirectory()) invalid('私有制品目录不是实际目录。')
  access.directory(path)
}
function privateFile(access: PrivateStorage, path: string): void {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) invalid('私有制品文件不是实际普通文件。')
  access.file(path)
}
function writePrivate(access: PrivateStorage, path: string, value: Uint8Array): void {
  const fd = openSync(path, 'wx', 0o600)
  try { access.file(path); writeFileSync(fd, value); fsyncSync(fd) } finally { closeSync(fd) }
}
function readUtf8(access: PrivateStorage, path: string, maximum: number): string {
  privateFile(access, path)
  const bytes = readFileSync(path)
  if (!bytes.length || bytes.length > maximum) invalid('制品文件超过保护预算。')
  // Preserve a BOM as U+FEFF instead of silently discarding disk bytes before
  // the exact source/hash/size and canonical metadata checks below.
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return invalid('制品文件不是有效UTF-8。') }
}
function exactRecord(input: unknown): StaticSvgArtifactRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) invalid('制品记录不是普通对象。')
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = ['schemaVersion', 'id', 'sourceSha256', 'normalizedSha256', 'sourceSizeBytes', 'normalizedSizeBytes', 'processorId', 'processorVersion']
  if (Reflect.ownKeys(input).length !== keys.length || keys.some(key => !descriptors[key]?.enumerable || !('value' in descriptors[key]))) invalid('制品记录字段不完整。')
  const value = input as Record<string, unknown>
  if (value.schemaVersion !== 1 || typeof value.id !== 'string' || typeof value.sourceSha256 !== 'string' || typeof value.normalizedSha256 !== 'string'
    || typeof value.sourceSizeBytes !== 'number' || typeof value.normalizedSizeBytes !== 'number'
    || value.processorId !== 'sceneweave-static-svg' || value.processorVersion !== 1) invalid('制品记录字段无效。')
  requireHash(value.id); requireHash(value.sourceSha256); requireHash(value.normalizedSha256)
  if (value.id !== value.sourceSha256 || !Number.isSafeInteger(value.sourceSizeBytes) || value.sourceSizeBytes < 1 || value.sourceSizeBytes > 1024 * 1024
    || !Number.isSafeInteger(value.normalizedSizeBytes) || value.normalizedSizeBytes < 1 || value.normalizedSizeBytes > 1024 * 1024) invalid('制品记录摘要或大小无效。')
  return value as unknown as StaticSvgArtifactRecord
}

/**
 * Private task-local persistence for source SVGs. This deliberately has no URL
 * or filesystem-path return value: only the service can re-read a verified
 * artifact and the browser remains responsible for local rasterization.
 */
export class StaticSvgArtifacts {
  readonly root: string
  constructor(private readonly artifacts: Pick<PrivateArtifacts, 'root' | 'access'>) {
    this.root = resolve(artifacts.root)
    privateDirectory(artifacts.access, this.root)
  }
  private taskRoot(id: string, create: boolean): string {
    requireTask(id)
    const taskRoot = join(this.root, id), svgRoot = join(taskRoot, 'svg')
    if (create) { this.artifacts.access.directory(taskRoot); this.artifacts.access.directory(svgRoot) }
    else { privateDirectory(this.artifacts.access, taskRoot); privateDirectory(this.artifacts.access, svgRoot) }
    return svgRoot
  }
  private cleanStaging(root: string): void {
    const staging = join(root, '.staging')
    if (!existsSync(staging)) return
    privateDirectory(this.artifacts.access, staging)
    for (const name of readdirSync(staging)) {
      const path = join(staging, name), info = lstatSync(path)
      if (info.isSymbolicLink() || !info.isDirectory()) invalid('暂存制品目录无效。')
      rmSync(path, { recursive: true, force: true })
    }
  }
  private readAt(path: string, expectedId: string): StoredStaticSvgArtifact {
    privateDirectory(this.artifacts.access, path)
    const recordText = readUtf8(this.artifacts.access, join(path, recordName), 16 * 1024)
    let parsed: unknown
    try { parsed = JSON.parse(recordText) as unknown } catch { return invalid('制品记录不是JSON。') }
    const record = exactRecord(parsed)
    if (record.id !== expectedId) invalid('制品路径和记录ID不一致。')
    if (canonicalJson(record) !== recordText) invalid('制品记录没有规范编码。')
    const sourceSvg = readUtf8(this.artifacts.access, join(path, sourceName), 1024 * 1024), normalizedSvg = readUtf8(this.artifacts.access, join(path, normalizedName), 1024 * 1024)
    const normalized = normalizeStaticSvg(sourceSvg)
    if (normalized.sourceSha256 !== record.sourceSha256 || normalized.normalizedSha256 !== record.normalizedSha256
      || normalized.sourceSizeBytes !== record.sourceSizeBytes || normalized.normalizedSizeBytes !== record.normalizedSizeBytes
      || normalized.normalizedSource !== normalizedSvg || normalized.processorId !== record.processorId || normalized.processorVersion !== record.processorVersion) {
      invalid('制品源、规范化内容或摘要不一致。')
    }
    // A second parser pass explicitly verifies that the stored normalized source
    // remains a valid proof even if the original source formatting differs.
    verifyNormalizedStaticSvg(normalized)
    return Object.freeze({ record: Object.freeze({ ...record }), sourceSvg, normalizedSvg })
  }
  store(id: string, sourceSvg: string): StoredStaticSvgArtifact {
    requireTask(id)
    const normalized = normalizeStaticSvg(sourceSvg)
    const artifactId = normalized.sourceSha256, taskRoot = this.taskRoot(id, true), finalRoot = join(taskRoot, artifactId)
    this.cleanStaging(taskRoot)
    if (existsSync(finalRoot)) return this.readAt(finalRoot, artifactId)
    const stagingParent = join(taskRoot, '.staging')
    this.artifacts.access.directory(stagingParent)
    const staging = join(stagingParent, randomUUID())
    this.artifacts.access.directory(staging)
    try {
      privateDirectory(this.artifacts.access, staging)
      const record: StaticSvgArtifactRecord = Object.freeze({ schemaVersion: 1, id: artifactId, sourceSha256: normalized.sourceSha256,
        normalizedSha256: normalized.normalizedSha256, sourceSizeBytes: normalized.sourceSizeBytes, normalizedSizeBytes: normalized.normalizedSizeBytes,
        processorId: normalized.processorId, processorVersion: normalized.processorVersion })
      writePrivate(this.artifacts.access, join(staging, sourceName), encodeUtf8(normalized.sourceSvg))
      writePrivate(this.artifacts.access, join(staging, normalizedName), encodeUtf8(normalized.normalizedSource))
      writePrivate(this.artifacts.access, join(staging, recordName), encodeUtf8(canonicalJson(record)))
      // Ensure the staging set is fully self-consistent before its sole visible
      // state transition into the task's artifact namespace.
      this.readAt(staging, artifactId)
      try { renameSync(staging, finalRoot) } catch (error) {
        if (existsSync(finalRoot)) return this.readAt(finalRoot, artifactId)
        throw error
      }
      return this.readAt(finalRoot, artifactId)
    } finally {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    }
  }
  read(id: string, artifactId: string): StoredStaticSvgArtifact {
    requireHash(artifactId)
    return this.readAt(join(this.taskRoot(id, false), artifactId), artifactId)
  }
}
