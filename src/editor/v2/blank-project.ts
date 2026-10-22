import indoorLicense from '../../../assets/sceneweave-handdrawn/LICENSE.txt?raw'
import indoorManifest from '../../../assets/sceneweave-handdrawn/manifest.json'
import outdoorLicense from '../../../assets/sceneweave-handdrawn-outdoor/LICENSE.txt?raw'
import outdoorManifest from '../../../assets/sceneweave-handdrawn-outdoor/manifest.json'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import { validateSceneV2 } from '../../core/v2/schema'
import type { AssetRef, PropDefinition, SceneDocumentV2 } from '../../core/v2/types'
import { validateCompleteProjectV2 } from '../../io/v2/project-file'
import { sha256Bytes } from '../../io/v2/resources'
import type { AssetBlobRecord, CompleteProjectV2, LicenseTextRecord } from '../../io/v2/types'

import { BLANK_PRESETS_V2, validateBlankOptionsV2, type BlankDocumentOptionsV2 } from './blank-settings'
export { BLANK_PRESETS_V2, BLANK_SCENE_LIMITS_V2 } from './blank-settings'
export type { BlankDocumentOptionsV2, BlankPresetV2 } from './blank-settings'

export { createPlacedPropV2 } from '../../core/v2/commands'
export type { PlacePropOptionsV2 } from '../../core/v2/commands'

const origin: AssetRef['origin'] = { kind: 'original', attribution: 'Sceneweave contributors；项目原创 SVG 绘制，Codex 辅助；源文件及 MIT 记录随仓库保存', canEmbed: true }
const builtInPacks = [
  { prefix: 'b2', folder: 'sceneweave-handdrawn', manifest: indoorManifest, license: indoorLicense, sampleTag: 'VIS-01' },
  { prefix: 'b3', folder: 'sceneweave-handdrawn-outdoor', manifest: outdoorManifest, license: outdoorLicense, sampleTag: 'VIS-02' },
] as const
const assetId = (prefix: string, index: number) => `${prefix}-a-${String(index + 1).padStart(2, '0')}`

/** Empty scene with an adopted, fixed-version object catalog; no sample geometry or resource URLs. */
export function createBlankDocumentV2(options: BlankDocumentOptionsV2): SceneDocumentV2 {
  const value = validateBlankOptionsV2(options), preset = BLANK_PRESETS_V2.find(item => item.id === value.preset)!
  const stamp = value.now ?? new Date().toISOString(), floorId = 'blank-floor'
  const bounds = { x: 0, y: 0, width: value.widthMm, height: value.heightMm }
  const document: SceneDocumentV2 = {
    format: 'sceneweave', schemaVersion: 2, sceneId: value.sceneId ?? crypto.randomUUID(), revision: 0,
    title: value.title, createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: preset.display, gridSizeMm: preset.gridSizeMm, snapMm: preset.snapMm, gridVisible: value.gridVisible ?? preset.gridVisible },
    exportBoundsMm: { ...bounds }, floors: { [floorId]: { id: floorId, name: '一层', boundsMm: { ...bounds } } },
    vertices: {}, walls: {}, openings: {}, rooms: {}, props: {}, regions: {}, notes: {}, assets: {},
    propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: preset.id, presetVersion: 1, distanceMode: preset.distanceMode,
      source: `Sceneweave 通用${preset.name}偏好；非官方规则`, gridSizeMm: preset.gridSizeMm },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] },
  }
  for (const pack of builtInPacks) {
    let propIndex = 0
    for (const [index, entry] of pack.manifest.assets.entries()) {
      if (entry.kind !== 'prop') continue
      // Keep the same snapshot/catalog identities and full defaults as the B2/B3 adopted definitions.
      const imageId = assetId(pack.prefix, index), id = `${pack.prefix}-p-${String(++propIndex).padStart(2, '0')}`
      document.assets[imageId] = { id: imageId, sha256: entry.sha256, mimeType: 'image/png', pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight,
        logicalSizeMm: { ...entry.logicalSizeMm }, licenseRef: 'MIT', origin: { ...origin } }
      document.propDefinitions[id] = { id, catalogId: entry.catalogId, version: 1, name: entry.name, tags: ['墨绘原野', pack.sampleTag, '原创'],
        licenseRef: 'MIT', origin: { ...origin }, defaultAppearance: { kind: 'image', assetId: imageId, tint: null, opacity: 1 },
        defaultVisualBoundsMm: { ...entry.visualBoundsMm! }, defaultFootprintMm: { ...entry.footprintMm! }, defaultFootprintOffsetMm: { ...entry.footprintOffsetMm! },
        defaultBlocksMovement: entry.blocksMovement!, defaultBlocksSight: entry.blocksSight!,
        defaultRenderLayer: entry.renderLayer as PropDefinition['defaultRenderLayer'], defaultShadowClass: entry.shadowClass as PropDefinition['defaultShadowClass'] }
    }
  }
  const result = validateSceneV2(document)
  if (!result.ok) throw new Error(`空白工程校验失败：${result.errors.map(issue => `${issue.code}: ${issue.message}`).join('；')}`)
  return result.document
}

/** Load only placeable object bytes and licenses, then verify the full offline resource closure. */
export async function createBlankProjectV2(options: BlankDocumentOptionsV2, signal?: AbortSignal): Promise<CompleteProjectV2> {
  signal?.throwIfAborted()
  const document = createBlankDocumentV2(options), assets: Record<string, AssetBlobRecord> = {}, licenses: Record<string, LicenseTextRecord> = {}
  const licensePaths = new Map<string, string>()
  for (const pack of builtInPacks) {
    const hash = await sha256Bytes(new TextEncoder().encode(pack.license))
    licenses[hash] = { sha256: hash, text: pack.license }; licensePaths.set(pack.prefix, `licenses/${hash}.txt`)
    for (const entry of pack.manifest.assets) {
      if (entry.kind !== 'prop') continue
      signal?.throwIfAborted()
      const response = await fetch(`${import.meta.env.BASE_URL}assets/${pack.folder}/${entry.file}`, { signal })
      if (!response.ok) throw new Error(`内置素材读取失败：${entry.file} (${response.status})`)
      const blob = new Blob([await response.arrayBuffer()], { type: 'image/png' })
      signal?.throwIfAborted()
      assets[entry.sha256] = { sha256: entry.sha256, blob, mimeType: 'image/png', sizeBytes: entry.sizeBytes, pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight }
    }
  }
  const project: CompleteProjectV2 = { document, assets, licenses,
    licenseBindings: collectDependenciesV2(document).subjects.map(subject => ({ ...subject,
      licensePath: licensePaths.get(subject.subjectId.slice(0, 2))!, embedding: 'allowed' })) }
  // Checks metadata, hashes, actual image decode and the complete license/dependency closure before adoption.
  await validateCompleteProjectV2(project, { signal })
  signal?.throwIfAborted()
  return project
}
