import { STATIC_SVG_LIMITS } from '../../../shared/ai/svg.js'
import { ASSET_PACK_MANIFEST_FILENAME, ASSET_PACK_MANIFEST_LIMITS, createAssetPathRegistry, parseAssetPackManifest,
  type AssetPackItem, type AssetPackLicense, type AssetPackManifest } from '../../../shared/assets/import-manifest.js'
import { inspectBoundedZip, type BoundedZip } from '../../../shared/project/zip.js'
import { sha256Bytes, sha256Text } from '../../../shared/validation/hash.js'
import { checkCancelled, type CancellationSignal } from '../../../shared/ports/resources.js'

const MiB = 1024 * 1024
/** Admission guards for a source selection, not measured library capacity. */
export const ASSET_BATCH_LIMITS = Object.freeze({
  assets: 64, inputFiles: 512, fileBytes: 20 * MiB, sourceTotalBytes: 64 * MiB,
  zipCompressedBytes: 64 * MiB, zipExpandedBytes: 128 * MiB, zipEntries: 512,
  svgBytes: STATIC_SVG_LIMITS.sourceBytes, pathBytes: ASSET_PACK_MANIFEST_LIMITS.pathBytes,
})
export type AssetFileSource = 'files' | 'folder' | 'zip'
export interface CollectedAssetFile {
  readonly key: string
  readonly path: string
  /** Owned immutable bytes. Its MIME is a routing hint, never a validation proof. */
  readonly file: Blob
  readonly format: 'raster' | 'svg'
  readonly metadata?: AssetPackItem
  readonly license?: AssetPackLicense
}
export interface SkippedAssetFile { readonly path: string; readonly reason: string }
export interface AssetFileCollection {
  readonly source: AssetFileSource
  readonly entries: readonly CollectedAssetFile[]
  readonly skipped: readonly SkippedAssetFile[]
  readonly manifest?: AssetPackManifest
  /** Admitted material source bytes plus the optional manifest; ignored sidecars are excluded. */
  readonly totalBytes: number
  readonly inputBytes: number
  /** All ZIP entries, including verified sidecars, or all directly selected files. */
  readonly expandedBytes: number
}
export interface CollectAssetFilesOptions { source?: AssetFileSource; signal?: CancellationSignal }
interface CapturedFile { path: string; file: Blob; size: number }

const fileSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!
const fileType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!
const mimeByExtension: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
}
const extension = (path: string) => /\.([^.\/]+)$/.exec(path)?.[1].toLowerCase() ?? ''
const formatOf = (path: string): CollectedAssetFile['format'] | undefined => extension(path) === 'svg' ? 'svg'
  : ['png', 'jpg', 'jpeg', 'webp'].includes(extension(path)) ? 'raster' : undefined
function fail(message: string): never { throw new Error(`素材批量来源无效：${message}`) }
const zipFailure = (error: unknown): never => {
  if (error instanceof Error && (error.name === 'AbortError' || error.message.startsWith('素材批量来源无效：'))) throw error
  return fail(`ZIP校验失败：${error instanceof Error ? error.message.replace(/^完整v1工程无效：/, '') : '归档无法完整读取。'}`)
}

/** Never calls a caller-owned name, type, size, slice or arrayBuffer accessor. */
function captureFile(input: unknown, index: number, source?: AssetFileSource): CapturedFile {
  if (!(input instanceof Blob)) fail('请选择实际File或Blob；不接受文件描述对象。')
  let size: number, type: string, file: Blob
  try {
    size = fileSize.call(input); type = fileType.call(input)
    file = Blob.prototype.slice.call(input, 0, size, type)
  } catch { return fail('不能独立捕获文件的原生字节。') }
  let name: string | undefined, relative = ''
  if (typeof File !== 'undefined') {
    const getter = Object.getOwnPropertyDescriptor(File.prototype, 'name')?.get
    try { if (getter) name = getter.call(input) as string } catch { /* A plain Blob has no native File name. */ }
    const own = Object.getOwnPropertyDescriptor(input, 'webkitRelativePath')
    if (own) {
      if (!('value' in own) || typeof own.value !== 'string') fail('相对路径不能含访问器。')
      relative = own.value
    } else {
      const getter = Object.getOwnPropertyDescriptor(File.prototype, 'webkitRelativePath')?.get
      try { if (getter) relative = getter.call(input) as string } catch { /* Plain Blob. */ }
    }
  }
  if (!name) {
    const suffix = source === 'zip' ? 'zip' : Object.entries(mimeByExtension).find(([, mime]) => mime === type)?.[0]
    if (!suffix) fail('无原生文件名的Blob必须声明受支持的图片或SVG类型。')
    name = `asset-${index + 1}.${suffix}`
  }
  return { path: relative || name, file: Object.freeze(file), size }
}

function captureFiles(input: readonly Blob[], source?: AssetFileSource): CapturedFile[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) fail('文件列表须为独立数组；请先复制原生FileList。')
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(input)
  const length = descriptors.length?.value
  if (!Number.isSafeInteger(length) || length < 1 || length > ASSET_BATCH_LIMITS.inputFiles) fail('一次须选择1–512个文件。')
  if (Reflect.ownKeys(input).some(key => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) fail('文件数组包含未知字段。')
  const result: CapturedFile[] = []
  for (let i = 0; i < length; i++) {
    const descriptor = descriptors[String(i)]
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('文件数组不能稀疏或包含访问器。')
    result.push(captureFile(descriptor.value, i, source))
  }
  return result
}

function freezeCollection(source: AssetFileSource, entries: CollectedAssetFile[], skipped: SkippedAssetFile[], inputBytes: number, expandedBytes: number,
  manifest?: AssetPackManifest, manifestBytes = 0): AssetFileCollection {
  return Object.freeze({ source, entries: Object.freeze(entries.map(row => Object.freeze(row))), skipped: Object.freeze(skipped.map(row => Object.freeze(row))),
    ...(manifest ? { manifest } : {}), totalBytes: manifestBytes + entries.reduce((sum, row) => sum + fileSize.call(row.file), 0), inputBytes, expandedBytes })
}

function captureOptions(options: CollectAssetFilesOptions): CollectAssetFilesOptions {
  if (!options || typeof options !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail('来源选项必须是普通数据对象。')
  const fields = Object.getOwnPropertyDescriptors(options)
  for (const key of Reflect.ownKeys(options)) if (typeof key !== 'string' || !['source', 'signal'].includes(key)
    || !fields[key]?.enumerable || !('value' in fields[key])) fail('来源选项包含未知字段或访问器。')
  return { source: fields.source?.value, signal: fields.signal?.value }
}

/** Input collection only. Rendering, SVG parsing, licences and atomic adoption
 * stay at the complete-project preparation boundary. No file is installed. */
export async function collectAssetFiles(input: readonly Blob[], options: CollectAssetFilesOptions = {}): Promise<AssetFileCollection> {
  const ownedOptions = captureOptions(options), source = ownedOptions.source ?? 'files', signal = ownedOptions.signal
  if (!['files', 'folder', 'zip'].includes(source)) fail('未知文件来源模式。')
  checkCancelled(signal)
  // Own all native bytes and metadata before the first asynchronous read.
  const captured = captureFiles(input, source), entries: CollectedAssetFile[] = [], skipped: SkippedAssetFile[] = [], register = createAssetPathRegistry(fail)
  const inputBytes = captured.reduce((sum, row) => sum + row.size, 0)
  if (inputBytes > ASSET_BATCH_LIMITS.sourceTotalBytes) fail('原始文件累计超过64MiB。')
  let manifestSource: { path: string; file: Blob } | undefined
  const manifestPath = (path: string): boolean => {
    const basename = path.split('/').at(-1) ?? ''
    if (basename.toLowerCase() !== ASSET_PACK_MANIFEST_FILENAME) return false
    if (basename !== ASSET_PACK_MANIFEST_FILENAME) fail(`素材包清单文件名必须精确为${ASSET_PACK_MANIFEST_FILENAME}。`)
    return true
  }
  const add = (path: string, file: Blob) => {
    if (manifestPath(path)) {
      if (manifestSource) fail('同一批只能包含一份素材包清单。')
      const size = fileSize.call(file)
      if (!size || size > ASSET_PACK_MANIFEST_LIMITS.bytes) fail('素材包清单为空或超过256KiB。')
      manifestSource = { path, file: Object.freeze(Blob.prototype.slice.call(file, 0, size, 'application/json')) }
      return
    }
    const format = formatOf(path)
    if (!format) { skipped.push({ path, reason: extension(path) === 'zip' ? '不展开嵌套归档。' : '不是受支持的PNG、JPEG、WebP或静态SVG素材。' }); return }
    if (entries.length >= ASSET_BATCH_LIMITS.assets) fail('一次最多预览64项素材。')
    const size = fileSize.call(file), maximum = format === 'svg' ? ASSET_BATCH_LIMITS.svgBytes : ASSET_BATCH_LIMITS.fileBytes
    if (!size || size > maximum) fail(`${path}为空或超过${format === 'svg' ? '1' : '20'}MiB单项来源预算。`)
    const owned = Blob.prototype.slice.call(file, 0, size, mimeByExtension[extension(path)])
    entries.push({ key: `asset-file-${sha256Text(path)}`, path, file: Object.freeze(owned), format })
  }
  const finish = async (expandedBytes: number): Promise<AssetFileCollection> => {
    if (!manifestSource) return freezeCollection(source, entries, skipped, inputBytes, expandedBytes)
    const manifestBytes = fileSize.call(manifestSource.file)
    if (manifestBytes + entries.reduce((sum, row) => sum + fileSize.call(row.file), 0) > ASSET_BATCH_LIMITS.sourceTotalBytes) fail('素材与清单累计超过64MiB。')
    checkCancelled(signal)
    const manifest = parseAssetPackManifest(new Uint8Array(await Blob.prototype.arrayBuffer.call(manifestSource.file)))
    checkCancelled(signal)
    const root = manifestSource.path.slice(0, -ASSET_PACK_MANIFEST_FILENAME.length), byPath = new Map(entries.map(row => [row.path, row]))
    const licenseById = new Map(manifest.licenses.map(license => [license.id, license]))
    const mapped = new Map<string, { metadata: AssetPackItem; license: AssetPackLicense }>()
    for (const item of manifest.items) {
      checkCancelled(signal)
      const path = root + item.path, entry = byPath.get(path)
      if (!entry) fail(`清单素材不存在或大小写不匹配：${item.path}。`)
      if (item.sourceSha256 !== undefined) {
        const originalBytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(entry.file))
        checkCancelled(signal)
        if (sha256Bytes(originalBytes) !== item.sourceSha256) fail(`素材原始字节与清单SHA-256不匹配：${item.path}。`)
      }
      mapped.set(path, { metadata: item, license: licenseById.get(item.licenseId)! })
    }
    if (mapped.size !== entries.length) fail('素材包清单须在共同根目录精确列出每份受支持图片；存在未列出的素材。')
    return freezeCollection(source, entries.map(row => ({ ...row, ...mapped.get(row.path)! })), skipped, inputBytes, expandedBytes, manifest, manifestBytes)
  }
  if (source !== 'zip') {
    for (const row of captured) { checkCancelled(signal); register(row.path, false); add(row.path, row.file) }
    return finish(inputBytes)
  }
  if (captured.length !== 1 || !inputBytes || inputBytes > ASSET_BATCH_LIMITS.zipCompressedBytes) fail('ZIP模式须选择一份不超过64MiB的实际归档。')
  const zipBytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(captured[0].file))
  checkCancelled(signal)
  let pathCount = 0
  let archive: BoundedZip
  try {
    archive = inspectBoundedZip(zipBytes, { minEntries: 1, allowEmptyDirectories: true, requiredPaths: [], documentPath: () => false,
      pathBudget: path => {
        if (++pathCount > ASSET_BATCH_LIMITS.zipEntries) fail('ZIP超过512条目录记录。')
        return register(path, true) ? 0 : manifestPath(path) ? ASSET_PACK_MANIFEST_LIMITS.bytes : extension(path) === 'svg' ? ASSET_BATCH_LIMITS.svgBytes : ASSET_BATCH_LIMITS.fileBytes
      } }, signal)
  } catch (error) { return zipFailure(error) }
  const expandedBytes = [...archive.entries.values()].reduce((sum, row) => sum + row.expanded, 0)
  if (expandedBytes > ASSET_BATCH_LIMITS.zipExpandedBytes) fail('ZIP累计展开量超过128MiB。')
  let materialBytes = 0, materialCount = 0, manifestCount = 0
  for (const row of archive.entries.values()) if (!row.name.endsWith('/')) {
    if (formatOf(row.name)) { materialCount++; materialBytes += row.expanded }
    else if (manifestPath(row.name)) { manifestCount++; materialBytes += row.expanded }
  }
  if (manifestCount > 1) fail('同一批只能包含一份素材包清单。')
  if (materialCount > ASSET_BATCH_LIMITS.assets || materialBytes > ASSET_BATCH_LIMITS.sourceTotalBytes) fail('ZIP素材超过64项或原始素材累计64MiB。')
  // Read every record exactly once, including ignored sidecars and zero-byte
  // directories. A skipped README cannot hide bad compressed data or CRCs.
  for (const row of archive.entries.values()) {
    checkCancelled(signal)
    let bytes: Uint8Array
    try { bytes = await archive.read(row.name) } catch (error) { return zipFailure(error) }
    if (!row.name.endsWith('/')) add(row.name, new Blob([bytes.buffer as ArrayBuffer]))
  }
  return finish(expandedBytes)
}
