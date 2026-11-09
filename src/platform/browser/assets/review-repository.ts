import Dexie, { type Table } from 'dexie'
import { parseAssetReviewDeclaration, parseThemePackReviewDeclaration, recordControlledAssetReview, recordControlledThemePackReview,
  type AssetReviewDeclaration, type ControlledAssetReview, type ControlledThemePackReview, type ThemePackReviewDeclaration } from '../../../shared/assets/review.js'
import { hasExactKeys } from '../../../shared/project/limits.js'
import { canonicalJson, captureJson, encodeUtf8, freezeJson } from '../../../shared/validation/json.js'
import { currentDatabaseNames } from '../storage/current-databases.js'

export const ASSET_REVIEW_STORAGE_LIMITS = Object.freeze({ assets: 512, packs: 128, recordBytes: 4 * 1024 * 1024, totalBytes: 32 * 1024 * 1024 })
const stores = { assets: 'key', packs: 'key' } as const
const tables = Object.keys(stores) as (keyof typeof stores)[]
function fail(message: string): never { throw new Error(`本机素材审核记录无效：${message}`) }
interface AssetReviewRow { key: string; declaration: AssetReviewDeclaration }
interface PackReviewRow { key: string; declaration: ThemePackReviewDeclaration }
export interface AssetReviewSnapshot { assets: ControlledAssetReview[]; packs: ControlledThemePackReview[] }

/** Follow the selected current library scope without opening or altering that library. */
export function assetReviewDatabaseName(): string {
  return currentDatabaseNames().library.replace(/^sceneweave-library/, 'sceneweave-asset-reviews')
}
const packKey = (record: ThemePackReviewDeclaration) => canonicalJson([record.content.packId, record.content.fixedVersion, record.content.registrationHash])
const encodedSize = (value: unknown) => encodeUtf8(JSON.stringify(value)).length
function boundedSize(value: unknown): number {
  const size = encodedSize(value)
  if (size > ASSET_REVIEW_STORAGE_LIMITS.recordBytes) fail('单份审核记录超过4MiB保护值。')
  return size
}
function assetRow(input: unknown): AssetReviewRow {
  const value = captureJson(input)
  if (!hasExactKeys(value, ['key', 'declaration'])) fail('单件审核存储字段缺失或未知。')
  boundedSize(value)
  const declaration = parseAssetReviewDeclaration(value.declaration)
  if (value.key !== declaration.content.catalogKey) fail('单件审核主键与确切目录身份不一致。')
  return { key: declaration.content.catalogKey, declaration }
}
function packRow(input: unknown): PackReviewRow {
  const value = captureJson(input)
  if (!hasExactKeys(value, ['key', 'declaration'])) fail('整包审核存储字段缺失或未知。')
  boundedSize(value)
  const declaration = parseThemePackReviewDeclaration(value.declaration), key = packKey(declaration)
  if (value.key !== key) fail('整包审核主键与确切包注册身份不一致。')
  return { key, declaration }
}
function snapshot(assetsInput: unknown[], packsInput: unknown[]): { assets: AssetReviewRow[]; packs: PackReviewRow[]; bytes: number } {
  if (assetsInput.length > ASSET_REVIEW_STORAGE_LIMITS.assets || packsInput.length > ASSET_REVIEW_STORAGE_LIMITS.packs) fail('本机审核数量超过512项素材或128个包的保护值。')
  const assets = assetsInput.map(assetRow), packs = packsInput.map(packRow)
  if (new Set(assets.map(row => row.key)).size !== assets.length || new Set(packs.map(row => row.key)).size !== packs.length) fail('本机审核存在重复确切身份。')
  const bytes = [...assets, ...packs].reduce((sum, row) => sum + encodedSize(row), 0)
  if (bytes > ASSET_REVIEW_STORAGE_LIMITS.totalBytes) fail('本机审核记录累计超过32MiB保护值。')
  return { assets, packs, bytes }
}

/** Probe without upgrading, deleting or claiming a foreign IndexedDB schema. */
function inspectDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let absent = false, settled = false
    const rejectOnce = (error: unknown) => { if (!settled) { settled = true; reject(error) } }
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort() }
    request.onerror = () => {
      if (absent && request.error?.name === 'AbortError') { settled = true; resolve() }
      else rejectOnce(request.error ?? new Error('无法检查本机素材审核库。'))
    }
    request.onblocked = () => rejectOnce(new Error('本机素材审核库被其他连接阻塞。'))
    request.onsuccess = () => {
      const database = request.result
      try {
        if (settled) return
        if (database.version !== 10 || [...database.objectStoreNames].sort().join(',') !== [...tables].sort().join(',')) fail('不支持的审核库结构版本；原数据保持。')
        const transaction = database.transaction(tables, 'readonly')
        for (const name of tables) {
          const store = transaction.objectStore(name)
          if (store.keyPath !== 'key' || store.autoIncrement || store.indexNames.length) fail('不支持的审核库表结构；原数据保持。')
        }
        settled = true; resolve()
      } catch (error) { rejectOnce(error) } finally { database.close() }
    }
  })
}

class AssetReviewDatabase extends Dexie {
  assets!: Table<AssetReviewRow, string>
  packs!: Table<PackReviewRow, string>
  constructor(name: string) {
    if (!/^sceneweave-asset-reviews-dev-v1(?:-[a-f0-9]{64})?$/.test(name)) fail('审核库必须使用独立的当前开发命名空间。')
    super(name, { autoOpen: false })
    this.version(1).stores(stores).upgrade(() => { fail('不支持升级既有审核库；原数据保持。') })
  }
}

/**
 * Administrative local records, written only by an explicit review/signoff UI.
 * Importers must never write package declarations here. A successful write does
 * not certify artwork, license bytes or reviewer identity, or publish anything.
 */
export class AssetReviewRepository {
  readonly database: AssetReviewDatabase
  private opening: Promise<void> | null = null
  private closed = false
  constructor(name = assetReviewDatabaseName()) {
    this.database = new AssetReviewDatabase(name)
    this.database.on('versionchange', () => { this.close(); return false })
    this.database.on('blocked', () => { this.close() })
  }
  private async open(): Promise<void> {
    if (this.closed) throw new Error('本机素材审核库连接已关闭。')
    this.opening ??= inspectDatabase(this.database.name).then(async () => {
      if (this.closed) throw new Error('本机素材审核库连接已关闭。')
      await this.database.open()
      if (this.closed) { this.database.close(); throw new Error('本机素材审核库连接已关闭。') }
    }).catch(error => { this.opening = null; throw error })
    await this.opening
  }
  async read(): Promise<AssetReviewSnapshot> {
    await this.open()
    const stored = await this.database.transaction('r', this.database.assets, this.database.packs, async () => {
      const [assets, packs] = await Promise.all([this.database.assets.limit(ASSET_REVIEW_STORAGE_LIMITS.assets + 1).toArray(), this.database.packs.limit(ASSET_REVIEW_STORAGE_LIMITS.packs + 1).toArray()])
      return snapshot(assets, packs)
    })
    return freezeJson({ assets: stored.assets.map(row => recordControlledAssetReview(row.declaration)),
      packs: stored.packs.map(row => recordControlledThemePackReview(row.declaration)) })
  }
  async putAsset(input: AssetReviewDeclaration): Promise<ControlledAssetReview> {
    // Capture before the first await; caller edits cannot rewrite the pending action.
    const declaration = parseAssetReviewDeclaration(input), row = assetRow({ key: declaration.content.catalogKey, declaration })
    await this.put('assets', row)
    return recordControlledAssetReview(row.declaration)
  }
  async putPack(input: ThemePackReviewDeclaration): Promise<ControlledThemePackReview> {
    const declaration = parseThemePackReviewDeclaration(input), row = packRow({ key: packKey(declaration), declaration })
    await this.put('packs', row)
    return recordControlledThemePackReview(row.declaration)
  }
  private async put(kind: 'assets' | 'packs', row: AssetReviewRow | PackReviewRow): Promise<void> {
    await this.open()
    await this.database.transaction('rw', this.database.assets, this.database.packs, async () => {
      const [assets, packs] = await Promise.all([this.database.assets.limit(ASSET_REVIEW_STORAGE_LIMITS.assets + 1).toArray(), this.database.packs.limit(ASSET_REVIEW_STORAGE_LIMITS.packs + 1).toArray()])
      const current = snapshot(assets, packs)
      const own = current[kind], previous = own.find(value => value.key === row.key)
      const maximum = ASSET_REVIEW_STORAGE_LIMITS[kind]
      if (!previous && own.length >= maximum) fail(`本机${kind === 'assets' ? '素材' : '整包'}审核已达到${maximum}项保护值。`)
      if (current.bytes - (previous ? encodedSize(previous) : 0) + encodedSize(row) > ASSET_REVIEW_STORAGE_LIMITS.totalBytes) fail('本机审核记录累计超过32MiB保护值。')
      if (kind === 'assets') await this.database.assets.put(row as AssetReviewRow)
      else await this.database.packs.put(row as PackReviewRow)
    })
  }
  close(): void { this.closed = true; this.database.close() }
}
