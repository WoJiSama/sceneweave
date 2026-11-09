import type { AssetRecord, ProjectData, SvgAuthoringSource } from '../../../shared/model/project.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import type { VisualSampleArt } from '../../../shared/visual/sample-art.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { createCompositionContent, listRequiredVariants } from '../../../shared/appearance/graph.js'
import { inspectDependencies } from '../../../shared/commands/dependencies.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { fromBundle, type EditableProject } from '../../../application/workspace/project.js'
import { materializeProject } from '../../../application/workspace/prepare.js'
import { rasterizeNormalizedSvg } from '../ai/svg-raster.js'
import { runtime, validation } from '../runtime.js'

export interface VisualArtBatch {
  artwork: readonly VisualSampleArt[]
  licenseText: string
  assetId: (key: string) => string
}

/** A complete original-art batch. The single-batch call retains its exact
 * source ordering, subject ordering and original licence text. */
export function materializeVisualArt(scene: SceneDocument, artwork: readonly VisualSampleArt[], licenseText: string,
  assetId: (key: string) => string, signal?: AbortSignal): Promise<EditableProject> {
  return materializeVisualArtBatches(scene, [{ artwork, licenseText, assetId }], signal)
}

/** Append independent original batches without rebinding earlier fixed artwork
 * to the new batch's licence. Existing theme/prefab metadata belongs to the
 * first (base palette) batch; image-backed subjects follow their own asset. */
export async function materializeVisualArtBatches(scene: SceneDocument, batches: readonly VisualArtBatch[], signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  if (!batches.length) throw new Error('原创素材需要至少一批固定来源。')
  const bytes = new Map<string, Uint8Array>(), assets: Record<string, AssetRecord> = {}, authoringSources: Record<string, SvgAuthoringSource> = {}
  const licenses: ProjectData['licenses'] = {}, assetLicenses = new Map<string, string>()
  for (const batch of batches) {
    const licenseHash = sha256Bytes(encodeUtf8(batch.licenseText)), licensePath = `licenses/${licenseHash}.txt`
    licenses[licenseHash] = { sha256: licenseHash, text: batch.licenseText }
    for (const art of batch.artwork) {
      signal?.throwIfAborted()
      const id = batch.assetId(art.key)
      if (!scene.assets[id]) throw new Error(`原创素材缺少固定定义：${id}`)
      if (assetLicenses.has(id)) throw new Error(`原创素材固定身份重复：${id}`)
      const normalized = normalizeStaticSvg(art.sourceSvg), output = await rasterizeNormalizedSvg(normalized, { longEdgePx: 512, signal })
      assetLicenses.set(id, licensePath)
      Object.assign(scene.assets[id], { sha256: output.sha256, pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight })
      assets[output.sha256] = { sha256: output.sha256, mimeType: output.mimeType, sizeBytes: output.pngBytes.length, pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight }
      authoringSources[id] = { kind: 'svg', sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256, sourceSizeBytes: normalized.sourceSizeBytes, normalizedSizeBytes: normalized.normalizedSizeBytes, rasterSha256: output.sha256,
        processorId: output.processorId, processorVersion: output.processorVersion, rasterizer: output.rasterizer, pixelFormat: output.pixelFormat }
      bytes.set(output.sha256, output.pngBytes); bytes.set(normalized.sourceSha256, encodeUtf8(normalized.sourceSvg)); bytes.set(normalized.normalizedSha256, encodeUtf8(normalized.normalizedSource))
    }
  }
  const content = createCompositionContent(scene, runtime), baseLicensePath = `licenses/${sha256Bytes(encodeUtf8(batches[0].licenseText))}.txt`
  const licenseBindings = inspectDependencies(content.document).subjects.map(subject => {
    const appearance = subject.subjectKind === 'propDefinition' ? content.document.propDefinitions[subject.subjectId].defaultAppearance : null
    const assetId = subject.subjectKind === 'asset' ? subject.subjectId
      : subject.subjectKind === 'material' ? content.document.materials[subject.subjectId].textureAssetId
      : appearance?.kind === 'image' ? appearance.assetId : null
    const licensePath = assetId ? assetLicenses.get(assetId) : baseLicensePath
    if (!licensePath) throw new Error(`原创素材缺少确切批次许可：${subject.subjectId}`)
    return { ...subject, licensePath, embedding: 'allowed' as const }
  })
  const project: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets,
    licenses, licenseBindings, authoringSources }
  const resources = createMemoryResources(bytes)
  // A surface tint is a real fixed derivative, including its pixels and source chain.
  if (listRequiredVariants(content).length) return materializeProject({ ...project, resources }, { runtime, validation, signal })
  return fromBundle({ project, resources }, { ...validation, signal })
}
