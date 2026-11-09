import type { PointMm, RenderLayer, ShadowClass } from '../model/scene.js'
import { captureBytes, decodeUtf8 } from '../project/binary.js'
import { parseBoundedJson } from '../project/json.js'
import { hasExactKeys, isSha256 } from '../project/limits.js'
import { captureJson, encodeUtf8, freezeJson } from '../validation/json.js'

export const ASSET_PACK_MANIFEST_FILENAME = 'sceneweave-assets.json'
/** Source admission bounds, not a claim about measured library capacity. */
export const ASSET_PACK_MANIFEST_LIMITS = Object.freeze({
  bytes: 256 * 1024, items: 64, licenses: 64, pathBytes: 128, jsonDepth: 16, jsonValues: 20_000,
})
export interface AssetPackInfo {
  readonly id: string; readonly name: string; readonly version: number
  readonly style: string; readonly scenes: readonly string[]
}
export interface AssetPackLicense { readonly id: string; readonly text: string; readonly attribution: string }
export interface AssetPackItem {
  readonly path: string; readonly name: string; readonly kind: 'prop' | 'material'
  readonly widthMm: number; readonly heightMm: number; readonly licenseId: string
  readonly tags?: readonly string[]
  readonly footprintWidthMm?: number; readonly footprintHeightMm?: number
  readonly rootAnchorMm?: Readonly<PointMm>; readonly footprintOffsetMm?: Readonly<PointMm>
  readonly blocksMovement?: boolean; readonly blocksSight?: boolean
  readonly renderLayer?: RenderLayer; readonly shadowClass?: ShadowClass
  readonly applicableSurfaces?: readonly ('room' | 'wall' | 'terrain' | 'path')[]
  readonly sourceSha256?: string
}
/** Descriptive import metadata only. It never grants embedding or review approval. */
export interface AssetPackManifest {
  readonly format: 'sceneweave-asset-pack'; readonly schemaVersion: 1
  readonly pack: AssetPackInfo; readonly licenses: readonly AssetPackLicense[]; readonly items: readonly AssetPackItem[]
}

function fail(message: string): never { throw new Error(`素材包清单无效：${message}`) }
const fold = (value: string) => value.toLowerCase().normalize('NFC')
const unsafeText = /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/
const validUnicode = (value: string) => value === decodeUtf8(encodeUtf8(value))
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && !!value.trim()
  && Array.from(value).length <= maximum && !unsafeText.test(value) && validUnicode(value)
const size = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 1_000_000
const exact = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
const uniqueTexts = (value: unknown, maximumItems: number, maximumLength: number, minimumItems = 0): value is string[] =>
  Array.isArray(value) && value.length >= minimumItems && value.length <= maximumItems
  && value.every(item => text(item, maximumLength)) && new Set(value).size === value.length

/** Returns exactly the supplied text. Validation must never silently rename an asset. */
export function validateAssetDisplayName(name: unknown): string {
  if (!text(name, 120)) fail('素材名称须为非空、最多120个Unicode字符的文本，且不含控制字符、双向控制符或孤立代理项。')
  return name
}

/** Remove only the final extension; numbers, spaces, underscores and Unicode stay intact. */
export function assetDisplayNameFromPath(path: string): string {
  if (typeof path !== 'string') fail('素材路径必须为文本。')
  const basename = path.split(/[\\/]/).at(-1) ?? '', dot = basename.lastIndexOf('.')
  return dot >= 0 ? basename.slice(0, dot) : basename
}

/** Shared by source paths and manifest paths, including ignored ZIP records. */
export function createAssetPathRegistry(reject: (message: string) => never = fail): (path: string, directories: boolean) => boolean {
  const explicit = new Set<string>(), nodes = new Map<string, { spelling: string; kind: 'file' | 'directory' | 'implicit' }>()
  return (path, directories) => {
    if (typeof path !== 'string' || !path || encodeUtf8(path).length > ASSET_PACK_MANIFEST_LIMITS.pathBytes || !validUnicode(path) || path !== path.normalize('NFC')
      || /[\\\x00-\x1f\x7f<>:"|?*]/.test(path) || path.startsWith('/')) reject('路径必须是规范、相对且不含控制字符的UTF-8名称（最多128字节）。')
    const directory = path.endsWith('/')
    if (directory && !directories) reject('素材路径不能是目录记录。')
    const parts = (directory ? path.slice(0, -1) : path).split('/')
    if (parts.some(part => !part || part === '.' || part === '..' || part.trim() !== part || part.endsWith('.')
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) reject('路径包含空段、上级目录或不可携带的名称。')
    const canonical = fold(parts.join('/'))
    if (explicit.has(canonical)) reject('同一批中存在重复或大小写不明确的完整路径。')
    explicit.add(canonical)
    for (let i = 1; i <= parts.length; i++) {
      const spelling = parts.slice(0, i).join('/'), key = fold(spelling), prior = nodes.get(key)
      const kind = i < parts.length ? 'implicit' : directory ? 'directory' : 'file'
      if (prior && (prior.spelling !== spelling || prior.kind === 'file' || kind === 'file')) reject('路径的大小写或文件/目录关系存在冲突。')
      if (!prior || kind === 'directory') nodes.set(key, { spelling, kind })
    }
    return directory
  }
}

function point(value: unknown): value is PointMm {
  return hasExactKeys(value, ['x', 'y']) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y)
    && Math.abs(value.x as number) <= 1_000_000 && Math.abs(value.y as number) <= 1_000_000
}

/** Own plain JSON before reading any fields, then enforce the complete strict schema. */
export function validateAssetPackManifest(input: unknown): AssetPackManifest {
  let owned: unknown
  try { owned = captureJson(input) } catch (error) { return fail(error instanceof Error ? error.message : '不能独立读取清单。') }
  if (encodeUtf8(JSON.stringify(owned)).length > ASSET_PACK_MANIFEST_LIMITS.bytes) fail('清单超过256KiB。')
  if (!hasExactKeys(owned, ['format', 'schemaVersion', 'pack', 'licenses', 'items']) || owned.format !== 'sceneweave-asset-pack' || owned.schemaVersion !== 1) fail('格式、版本或根字段不受支持。')
  const pack = owned.pack
  if (!hasExactKeys(pack, ['id', 'name', 'version', 'style', 'scenes']) || !text(pack.id, 120) || !text(pack.name, 120)
    || !Number.isSafeInteger(pack.version) || (pack.version as number) < 1 || !text(pack.style, 120) || !uniqueTexts(pack.scenes, 32, 80, 1)) fail('主题包须提供有效标识、名称、正整数版本、画风及场景。')
  if (!Array.isArray(owned.licenses) || !owned.licenses.length || owned.licenses.length > ASSET_PACK_MANIFEST_LIMITS.licenses) fail('须提供1–64项内联许可。')
  const licenseIds = new Set<string>()
  for (const license of owned.licenses) {
    if (!hasExactKeys(license, ['id', 'text', 'attribution']) || !text(license.id, 120) || !text(license.attribution, 500)
      || typeof license.text !== 'string' || !license.text.trim() || !validUnicode(license.text)
      || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(license.text) || encodeUtf8(license.text).length > ASSET_PACK_MANIFEST_LIMITS.bytes) fail('许可须包含唯一标识、完整内联文本和来源署名。')
    if (licenseIds.has(license.id)) fail('许可标识重复。')
    licenseIds.add(license.id)
  }
  if (!Array.isArray(owned.items) || !owned.items.length || owned.items.length > ASSET_PACK_MANIFEST_LIMITS.items) fail('清单须列出1–64项素材。')
  const register = createAssetPathRegistry()
  const propKeys = ['footprintWidthMm', 'footprintHeightMm', 'rootAnchorMm', 'footprintOffsetMm', 'blocksMovement', 'blocksSight', 'renderLayer', 'shadowClass']
  for (const item of owned.items) {
    if (!exact(item, ['path', 'name', 'kind', 'widthMm', 'heightMm', 'licenseId'], ['tags', ...propKeys, 'applicableSurfaces', 'sourceSha256'])) fail('素材字段缺失、未知或含不支持的审批/行为字段。')
    if (typeof item.path !== 'string') fail('素材路径必须为文本。')
    register(item.path, false)
    if (!/\.(?:png|jpe?g|webp|svg)$/i.test(item.path)) fail('清单只能引用PNG、JPEG、WebP或静态SVG。')
    validateAssetDisplayName(item.name)
    if (!size(item.widthMm) || !size(item.heightMm) || typeof item.licenseId !== 'string' || !licenseIds.has(item.licenseId)) fail('素材须提供有效整数毫米尺寸和已定义的许可引用。')
    if (item.tags !== undefined && !uniqueTexts(item.tags, 50, 80)) fail('素材标签须为不重复、最多50项且每项最多80字符的文本。')
    if (item.sourceSha256 !== undefined && !isSha256(item.sourceSha256)) fail('原始来源校验和必须为64位小写SHA-256。')
    if (item.kind === 'prop') {
      if (!size(item.footprintWidthMm) || !size(item.footprintHeightMm)) fail('物件必须明确提供正整数毫米实际占地宽高。')
      if (Object.hasOwn(item, 'applicableSurfaces')) fail('物件不能声明材质适用表面。')
      if (item.rootAnchorMm !== undefined && (!point(item.rootAnchorMm) || item.rootAnchorMm.x < 0 || item.rootAnchorMm.y < 0
        || item.rootAnchorMm.x > item.widthMm || item.rootAnchorMm.y > item.heightMm)) fail('物件根锚须为图像内的整数毫米坐标。')
      if (item.footprintOffsetMm !== undefined && !point(item.footprintOffsetMm)) fail('占地偏移须为绝对值不超过1000000的整数毫米坐标。')
      for (const key of ['blocksMovement', 'blocksSight']) if (item[key] !== undefined && typeof item[key] !== 'boolean') fail('通行及视线参数必须为布尔值。')
      if (item.renderLayer !== undefined && !['ground', 'object', 'canopy'].includes(item.renderLayer as string)) fail('物件渲染层无效。')
      if (item.shadowClass !== undefined && !['none', 'furniture', 'vegetation'].includes(item.shadowClass as string)) fail('物件阴影类别无效。')
    } else if (item.kind === 'material') {
      if (propKeys.some(key => Object.hasOwn(item, key))) fail('材质不能声明物件占地、根锚、阻挡、渲染层或阴影参数。')
      if (item.applicableSurfaces !== undefined && (!Array.isArray(item.applicableSurfaces) || !item.applicableSurfaces.length
        || item.applicableSurfaces.length > 4 || item.applicableSurfaces.some(surface => !['room', 'wall', 'terrain', 'path'].includes(surface))
        || new Set(item.applicableSurfaces).size !== item.applicableSurfaces.length)) fail('材质适用表面须为不重复的受支持表面。')
    } else fail('原始素材包仅支持物件和材质；组合使用完整素材库格式。')
  }
  return freezeJson(owned as unknown as AssetPackManifest)
}

/** Parse the original UTF-8 bytes, rejecting duplicate keys before JSON.parse. */
export function parseAssetPackManifest(input: Uint8Array): AssetPackManifest {
  try {
    const bytes = captureBytes(input, ASSET_PACK_MANIFEST_LIMITS.bytes)
    return validateAssetPackManifest(parseBoundedJson(bytes, { values: 0 }, { depth: ASSET_PACK_MANIFEST_LIMITS.jsonDepth, values: ASSET_PACK_MANIFEST_LIMITS.jsonValues }))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('素材包清单无效：')) throw error
    return fail(error instanceof Error ? error.message.replace(/^完整v1工程无效：/, '') : '清单无法读取。')
  }
}
