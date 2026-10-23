import indoorLicense from '../../../assets/sceneweave-handdrawn/LICENSE.txt?raw'
import indoor from '../../../assets/sceneweave-handdrawn/manifest.json'
import outdoorLicense from '../../../assets/sceneweave-handdrawn-outdoor/LICENSE.txt?raw'
import outdoor from '../../../assets/sceneweave-handdrawn-outdoor/manifest.json'
import outpostLicense from '../../../assets/sceneweave-handdrawn-outpost/LICENSE.txt?raw'
import outpost from '../../../assets/sceneweave-handdrawn-outpost/manifest.json'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import type { AssetRef, BoundsMm, MaterialRef, PointMm, PrefabDefinition, PropDefinition, PropTemplate, SceneDocumentV2, StyleTheme } from '../../core/v2/types'
import { sha256Bytes } from '../../io/v2/resources'
import type { AssetBlobRecord, LicenseTextRecord } from '../../io/v2/types'

interface CatalogEntry {
  kind: string; catalogId: string; name: string; file: string; sha256: string; sizeBytes: number
  pixelWidth: number; pixelHeight: number; logicalSizeMm: { width: number; height: number }
  surfaces?: string[]; visualBoundsMm?: BoundsMm; footprintMm?: { width: number; height: number }; footprintOffsetMm?: PointMm
  blocksMovement?: boolean; blocksSight?: boolean; renderLayer?: string; shadowClass?: string
}
interface CatalogPack { prefix: string; folder: string; manifest: { assets: CatalogEntry[] }; license: string; tag: string }

/** Existing fixed IDs/defaults stay identical; the added pack has its own immutable namespace. */
export const OUTPOST_CATALOG_PACKS: readonly CatalogPack[] = [
  { prefix: 'b2', folder: 'sceneweave-handdrawn', manifest: indoor, license: indoorLicense, tag: 'VIS-01' },
  { prefix: 'b3', folder: 'sceneweave-handdrawn-outdoor', manifest: outdoor, license: outdoorLicense, tag: 'VIS-02' },
  { prefix: 'm1d', folder: 'sceneweave-handdrawn-outpost', manifest: outpost, license: outpostLicense, tag: 'SCN-04' },
]
export const OUTPOST_CATALOG = { theme: 'm1d-theme-01', dirt: 'm1d-m-01', studyPrefab: 'b2-pf-01', terracePrefab: 'b2-pf-02', suppliesPrefab: 'm1d-pf-01' } as const
export const outpostOrigin: AssetRef['origin'] = { kind: 'original', attribution: 'Sceneweave contributors；项目原创 SVG 绘制，Codex 辅助；源文件及 MIT 记录随仓库保存', canEmbed: true }
const ref = (id: string) => ({ id, version: 1 })
const numbered = (prefix: string, kind: string, index: number) => `${prefix}-${kind}-${String(index + 1).padStart(2, '0')}`

export function outpostPropTemplate(definition: PropDefinition, x = 0, y = 0, rotationDeg = 0, renderOrder = 0): PropTemplate {
  return { definitionRef: ref(definition.id), appearance: structuredClone(definition.defaultAppearance), positionMm: { x, y }, rotationDeg,
    visualBoundsMm: { ...definition.defaultVisualBoundsMm }, footprintMm: { ...definition.defaultFootprintMm }, footprintOffsetMm: { ...definition.defaultFootprintOffsetMm },
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, renderLayer: definition.defaultRenderLayer, renderOrder,
    shadowClass: definition.defaultShadowClass, shadowOverride: null }
}
export function outpostPropDefinition(scene: SceneDocumentV2, key: string): PropDefinition {
  const definition = Object.values(scene.propDefinitions).find(item => item.catalogId === `prop.sw.${key}`)
  if (!definition) throw new Error(`内置目录缺少固定物件定义：${key}。`)
  return definition
}

/** Fill a detached fresh scene; no existing catalog or source version is rewritten in an open project. */
export function adoptOutdoorCatalogV2(scene: SceneDocumentV2): void {
  for (const pack of OUTPOST_CATALOG_PACKS) {
    let materialIndex = 0, propIndex = 0
    for (const [index, entry] of pack.manifest.assets.entries()) {
      const imageId = numbered(pack.prefix, 'a', index)
      scene.assets[imageId] = { id: imageId, sha256: entry.sha256, mimeType: 'image/png', pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight,
        logicalSizeMm: { ...entry.logicalSizeMm }, licenseRef: 'MIT', origin: { ...outpostOrigin } }
      if (entry.kind === 'material') {
        const id = numbered(pack.prefix, 'm', materialIndex++)
        scene.materials[id] = { id, catalogId: entry.catalogId, version: 1, name: entry.name, tags: pack.prefix === 'm1d' ? ['墨绘原野', pack.tag, '原创'] : ['墨绘原野', '原创', 'P2'], licenseRef: 'MIT', origin: { ...outpostOrigin },
          textureAssetId: imageId, defaultTileSizeMm: { ...entry.logicalSizeMm }, applicableSurfaces: entry.surfaces as MaterialRef['applicableSurfaces'] }
      } else if (entry.kind === 'prop') {
        const id = numbered(pack.prefix, 'p', propIndex++)
        scene.propDefinitions[id] = { id, catalogId: entry.catalogId, version: 1, name: entry.name, tags: ['墨绘原野', pack.tag, '原创'], licenseRef: 'MIT', origin: { ...outpostOrigin },
          defaultAppearance: { kind: 'image', assetId: imageId, tint: null, opacity: 1 }, defaultVisualBoundsMm: { ...entry.visualBoundsMm! },
          defaultFootprintMm: { ...entry.footprintMm! }, defaultFootprintOffsetMm: { ...entry.footprintOffsetMm! }, defaultBlocksMovement: entry.blocksMovement!,
          defaultBlocksSight: entry.blocksSight!, defaultRenderLayer: entry.renderLayer as PropDefinition['defaultRenderLayer'], defaultShadowClass: entry.shadowClass as PropDefinition['defaultShadowClass'] }
      }
    }
  }
  const member = (key: string, catalogKey: string, x = 0, y = 0, rotation = 0, order = 0) => ({ key, propTemplate: outpostPropTemplate(outpostPropDefinition(scene, catalogKey), x, y, rotation, order) })
  const prefab = (id: string, catalogId: string, name: string, tag: string, members: PrefabDefinition['members']): PrefabDefinition => ({ id, catalogId, version: 1, name,
    tags: ['墨绘原野', tag], licenseRef: 'MIT', origin: { ...outpostOrigin }, members })
  const study = prefab(OUTPOST_CATALOG.studyPrefab, 'prefab.sw.study-desk', '书桌六件组', '书房', [
    member('desk', 'desk-oak'), member('chair', 'chair-oak', 0, 900), member('books-left', 'book-stack', -450, -100, 0, 10),
    member('books-middle', 'book-stack', 0, -100, 0, 10), member('books-right', 'book-stack', 450, -100, 0, 10), member('papers', 'papers', 550, 175, 0, 20),
  ])
  const terrace = prefab(OUTPOST_CATALOG.terracePrefab, 'prefab.sw.terrace-table', '露台一桌两椅', '露台', [
    member('table', 'table-round'), member('chair-north', 'chair-oak', 0, -1000, 180), member('chair-south', 'chair-oak', 0, 1000),
  ])
  const supplies = prefab(OUTPOST_CATALOG.suppliesPrefab, 'prefab.sw.outpost-supplies', '哨所补给三件组', '海岸哨所', [
    member('crate-left', 'crate', -600, 0), member('crate-right', 'crate', 600, 0, 90), member('papers', 'papers', -600, 0, 0, 20),
  ])
  for (const definition of [study, terrace, supplies]) scene.prefabDefinitions[definition.id] = definition
  const shadow = (offsetMm: number, blurMm: number, opacity: number) => ({ directionDeg: 45, offsetMm, blurMm, opacity, color: '#24313A' })
  const theme: StyleTheme = { id: OUTPOST_CATALOG.theme, catalogId: 'sceneweave-handdrawn', version: 1, name: '墨绘原野', licenseRef: 'MIT', origin: { ...outpostOrigin },
    materialSuggestions: Object.keys(scene.materials).map(ref), propSuggestions: Object.keys(scene.propDefinitions).map(ref), prefabSuggestions: Object.keys(scene.prefabDefinitions).map(ref),
    outline: { widthMm: 24, color: '#30382F' }, openingStyle: { doorStrokeWidthMm: 16, windowStrokeWidthMm: 12, frameWidthMm: 60, doorFill: '#99734F', windowFill: '#A9C4BE' },
    edgeStyles: { shore: { strokeWidthMm: 12, color: '#D9D4B4', bandWidthMm: 180 }, cliff: { strokeWidthMm: 24, color: '#39443E', bandWidthMm: 450 }, materialTransition: { strokeWidthMm: 0, color: '#71865A', bandWidthMm: 250 }, path: { strokeWidthMm: 0, color: '#9B8B68', bandWidthMm: 150 } },
    shadowPresets: { none: shadow(0, 0, 0), furniture: shadow(120, 80, .22), vegetation: shadow(350, 180, .20), wall: shadow(160, 100, .24) },
    terrainCliff: { directionDeg: 45, offsetFactor: .18, maxOffsetMm: 600, blurMm: 120, opacity: .24, color: '#24313A' } }
  scene.styleThemes[theme.id] = theme
}

/** Fetch source bytes into the portable resource closure; validation remains the caller's final adoption gate. */
export async function loadOutdoorCatalogResources(scene: SceneDocumentV2, signal?: AbortSignal) {
  const assets: Record<string, AssetBlobRecord> = {}, licenses: Record<string, LicenseTextRecord> = {}, licensePaths = new Map<string, string>()
  for (const pack of OUTPOST_CATALOG_PACKS) {
    signal?.throwIfAborted()
    const hash = await sha256Bytes(new TextEncoder().encode(pack.license))
    licenses[hash] = { sha256: hash, text: pack.license }; licensePaths.set(pack.prefix, `licenses/${hash}.txt`)
    for (const entry of pack.manifest.assets) {
      signal?.throwIfAborted()
      const response = await fetch(`${import.meta.env.BASE_URL}assets/${pack.folder}/${entry.file}`, { signal })
      if (!response.ok) throw new Error(`内置素材读取失败：${entry.file} (${response.status})`)
      const blob = new Blob([await response.arrayBuffer()], { type: 'image/png' })
      signal?.throwIfAborted()
      assets[entry.sha256] = { sha256: entry.sha256, blob, mimeType: 'image/png', sizeBytes: entry.sizeBytes, pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight }
    }
  }
  const licenseBindings = collectDependenciesV2(scene).subjects.map(subject => {
    const prefix = subject.subjectId.startsWith('m1d-') ? 'm1d' : subject.subjectId.slice(0, 2), licensePath = licensePaths.get(prefix)
    if (!licensePath) throw new Error(`内置素材缺少确切许可绑定：${subject.subjectId}。`)
    return { ...subject, licensePath, embedding: 'allowed' as const }
  })
  return { assets, licenses, licenseBindings }
}
