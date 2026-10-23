import contentLicense from '../../../assets/sceneweave-handdrawn-content/LICENSE.txt?raw'
import content from '../../../assets/sceneweave-handdrawn-content/manifest.json'
import type { AssetRef, BoundsMm, MaterialRef, PointMm, PrefabDefinition, PropDefinition, SceneDocumentV3 } from '../../core/v3/types'
import { syncAppearanceGraphV6 } from '../../core/v6/graph'
import { assertFixedCompositionCompatibleV6, canonicalJsonV6, captureCompleteProjectV6, validateCompleteProjectV6 } from '../../io/v6/project-file'
import { sha256Bytes } from '../../io/v6/resources'
import { freezeOwnedData } from '../../io/v3/owned-data'
import type { CompleteProjectV6, LicenseBinding } from '../../io/v6/types'
import { outpostOrigin, outpostPropTemplate } from './outpost-catalog'

export type ContentTopic = 'graveyard' | 'volcano' | 'refined' | 'interior'
export interface ThemedCatalogEntry {
  key: string; kind: 'material' | 'prop'; catalogId: string; version: number; name: string; file: string
  sha256: string; sizeBytes: number; pixelWidth: number; pixelHeight: number
  logicalSizeMm: { width: number; height: number }; topic: ContentTopic; tags: string[]; colors: string[]
  surfaces?: MaterialRef['applicableSurfaces']; visualBoundsMm?: BoundsMm; footprintMm?: { width: number; height: number }
  footprintOffsetMm?: PointMm; blocksMovement?: boolean; blocksSight?: boolean
  renderLayer?: PropDefinition['defaultRenderLayer']; shadowClass?: PropDefinition['defaultShadowClass']
  refines?: { catalogId: string; version: number; assetSha256: string }
}
export const THEMED_CATALOG_ENTRIES: readonly ThemedCatalogEntry[] = freezeOwnedData(structuredClone(content.assets)) as ThemedCatalogEntry[]
export const THEMED_CATALOG = freezeOwnedData({
  assets: Object.fromEntries(THEMED_CATALOG_ENTRIES.map(entry => [entry.key, `content-a-${entry.key}`])) as Record<string, string>,
  props: Object.fromEntries(THEMED_CATALOG_ENTRIES.filter(entry => entry.kind === 'prop').map(entry => [entry.key, `content-p-${entry.key}`])) as Record<string, string>,
  materials: Object.fromEntries(THEMED_CATALOG_ENTRIES.filter(entry => entry.kind === 'material').map(entry => [entry.key, `content-m-${entry.key}`])) as Record<string, string>,
  prefabs: { graveyard: 'content-pf-graveyard', volcano: 'content-pf-volcano' },
} as const)
const TOPIC_LABELS: Record<ContentTopic, string> = { graveyard: '墓地', volcano: '火山', refined: '精修版', interior: '室内布景' }
const fixedRef = (id: string) => ({ id, version: 1 })
function appendFixed<T>(target: Record<string, T>, id: string, value: T): void {
  if (Object.hasOwn(target, id)) {
    if (canonicalJsonV6(target[id]) !== canonicalJsonV6(value)) throw new Error(`题材目录固定身份冲突：${id}。`)
  } else target[id] = value
}
export function contentPropDefinition(scene: SceneDocumentV3, key: string): PropDefinition {
  const definition = scene.propDefinitions[THEMED_CATALOG.props[key]]
  if (!definition) throw new Error(`题材目录缺少物件：${key}。`)
  return definition
}
export function contentMaterialDefinition(scene: SceneDocumentV3, key: string): MaterialRef {
  const definition = scene.materials[THEMED_CATALOG.materials[key]]
  if (!definition) throw new Error(`题材目录缺少材质：${key}。`)
  return definition
}

/** Adds new fixed identities to a detached provider. Existing source versions and themes are never retagged or rewritten. */
export function appendThemedCatalogDocument(scene: SceneDocumentV3): void {
  for (const entry of THEMED_CATALOG_ENTRIES) {
    const imageId = THEMED_CATALOG.assets[entry.key], tags = ['墨绘原野', '原创', TOPIC_LABELS[entry.topic], ...entry.tags]
    const origin: AssetRef['origin'] = { ...outpostOrigin }
    appendFixed(scene.assets, imageId, { id: imageId, sha256: entry.sha256, mimeType: 'image/png', pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight,
      logicalSizeMm: { ...entry.logicalSizeMm }, licenseRef: 'MIT', origin })
    if (entry.kind === 'material') {
      const id = THEMED_CATALOG.materials[entry.key]
      appendFixed(scene.materials, id, { id, catalogId: entry.catalogId, version: entry.version, name: entry.name, tags: [...new Set(tags)], licenseRef: 'MIT', origin: { ...origin },
        textureAssetId: imageId, defaultTileSizeMm: { ...entry.logicalSizeMm }, applicableSurfaces: [...entry.surfaces!] })
    } else {
      const id = THEMED_CATALOG.props[entry.key]
      appendFixed(scene.propDefinitions, id, { id, catalogId: entry.catalogId, version: entry.version, name: entry.name, tags: [...new Set(tags)], licenseRef: 'MIT', origin: { ...origin },
        defaultAppearance: { kind: 'image', assetId: imageId, tint: null, opacity: 1 }, defaultVisualBoundsMm: { ...entry.visualBoundsMm! },
        defaultFootprintMm: { ...entry.footprintMm! }, defaultFootprintOffsetMm: { ...entry.footprintOffsetMm! }, defaultBlocksMovement: entry.blocksMovement!,
        defaultBlocksSight: entry.blocksSight!, defaultRenderLayer: entry.renderLayer!, defaultShadowClass: entry.shadowClass! })
    }
  }
  const member = (key: string, definitionKey: string, x: number, y: number, rotation = 0, order = 0) => ({ key, propTemplate: outpostPropTemplate(contentPropDefinition(scene, definitionKey), x, y, rotation, order) })
  const definitions: PrefabDefinition[] = [
    { id: THEMED_CATALOG.prefabs.graveyard, catalogId: 'prefab.sw.graveyard-memorial', version: 1, name: '墓地纪念小组', tags: ['墨绘原野', '墓地', '纪念', '石质'],
      licenseRef: 'MIT', origin: { ...outpostOrigin }, members: [member('headstone', 'headstone', 0, -1600), member('sarcophagus', 'sarcophagus', 0, 250), member('fence', 'iron-fence', -1400, 0, 90)] },
    { id: THEMED_CATALOG.prefabs.volcano, catalogId: 'prefab.sw.volcanic-rock-cluster', version: 1, name: '火山岩缝三件组', tags: ['墨绘原野', '火山', '岩石', '熔岩'],
      licenseRef: 'MIT', origin: { ...outpostOrigin }, members: [member('boulder-west', 'basalt-boulder', -1100, 0), member('boulder-east', 'basalt-boulder', 1100, 350, 125), member('crack', 'volcanic-crack', 0, -1000, 20, 10)] },
  ]
  for (const definition of definitions) appendFixed(scene.prefabDefinitions, definition.id, definition)
}

/** Resource provider only: no project save, scene revision or installation occurs here. */
export async function extendBuiltinCatalogProject(input: CompleteProjectV6, signal?: AbortSignal): Promise<CompleteProjectV6> {
  signal?.throwIfAborted()
  const captured = captureCompleteProjectV6(input)
  await validateCompleteProjectV6(captured, { signal })
  const project: CompleteProjectV6 = { ...captured, document: structuredClone(captured.document), historyIdentity: structuredClone(captured.historyIdentity),
    appearance: structuredClone(captured.appearance), assets: { ...captured.assets }, licenses: { ...captured.licenses }, licenseBindings: structuredClone(captured.licenseBindings) }
  appendThemedCatalogDocument(project.document)
  const synced = syncAppearanceGraphV6(project)
  project.document = synced.document; project.historyIdentity = synced.historyIdentity; project.appearance = synced.appearance
  const licenseHash = await sha256Bytes(new TextEncoder().encode(contentLicense)), licensePath = `licenses/${licenseHash}.txt`
  appendFixed(project.licenses, licenseHash, { sha256: licenseHash, text: contentLicense })
  const bind = (subjectKind: LicenseBinding['subjectKind'], subjectId: string) => {
    const value: LicenseBinding = { subjectKind, subjectId, licenseRef: 'MIT', licensePath, embedding: 'allowed' }
    const existing = project.licenseBindings.find(binding => binding.subjectKind === subjectKind && binding.subjectId === subjectId)
    if (existing && canonicalJsonV6(existing) !== canonicalJsonV6(value)) throw new Error(`题材目录许可绑定冲突：${subjectId}。`)
    if (!existing) project.licenseBindings.push(value)
  }
  for (const entry of THEMED_CATALOG_ENTRIES) {
    signal?.throwIfAborted()
    const existing = project.assets[entry.sha256]
    if (!existing) {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/sceneweave-handdrawn-content/${entry.file}`, { signal })
      if (!response.ok) throw new Error(`题材素材读取失败：${entry.file} (${response.status})。`)
      const blob = new Blob([await response.arrayBuffer()], { type: 'image/png' })
      signal?.throwIfAborted()
      project.assets[entry.sha256] = { sha256: entry.sha256, mimeType: 'image/png', pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight, sizeBytes: entry.sizeBytes, blob }
    }
    bind('asset', THEMED_CATALOG.assets[entry.key]); bind(entry.kind === 'material' ? 'material' : 'propDefinition', entry.kind === 'material' ? THEMED_CATALOG.materials[entry.key] : THEMED_CATALOG.props[entry.key])
  }
  for (const id of Object.values(THEMED_CATALOG.prefabs)) bind('prefabDefinition', id)
  assertFixedCompositionCompatibleV6(captured, project)
  await validateCompleteProjectV6(project, { signal })
  signal?.throwIfAborted()
  return project
}
