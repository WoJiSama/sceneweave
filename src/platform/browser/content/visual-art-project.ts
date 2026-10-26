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

/** A complete original-art batch. Sources, real PNG pixels and licences all pass the public resource boundary. */
export async function materializeVisualArt(scene: SceneDocument, artwork: readonly VisualSampleArt[], licenseText: string,
  assetId: (key: string) => string, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const bytes = new Map<string, Uint8Array>(), assets: Record<string, AssetRecord> = {}, authoringSources: Record<string, SvgAuthoringSource> = {}
  for (const art of artwork) {
    signal?.throwIfAborted()
    const normalized = normalizeStaticSvg(art.sourceSvg), output = await rasterizeNormalizedSvg(normalized, { longEdgePx: 512, signal }), id = assetId(art.key)
    if (!scene.assets[id]) throw new Error(`原创素材缺少固定定义：${id}`)
    Object.assign(scene.assets[id], { sha256: output.sha256, pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight })
    assets[output.sha256] = { sha256: output.sha256, mimeType: output.mimeType, sizeBytes: output.pngBytes.length, pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight }
    authoringSources[id] = { kind: 'svg', sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256, sourceSizeBytes: normalized.sourceSizeBytes, normalizedSizeBytes: normalized.normalizedSizeBytes, rasterSha256: output.sha256, processorId: output.processorId, processorVersion: output.processorVersion }
    bytes.set(output.sha256, output.pngBytes); bytes.set(normalized.sourceSha256, encodeUtf8(normalized.sourceSvg)); bytes.set(normalized.normalizedSha256, encodeUtf8(normalized.normalizedSource))
  }
  const content = createCompositionContent(scene, runtime), licenseHash = sha256Bytes(encodeUtf8(licenseText))
  const project: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 2, ...content, assets,
    licenses: { [licenseHash]: { sha256: licenseHash, text: licenseText } }, licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })), authoringSources }
  const resources = createMemoryResources(bytes)
  // A surface tint is a real fixed derivative, including its pixels and source chain.
  if (listRequiredVariants(content).length) return materializeProject({ ...project, resources }, { runtime, validation, signal })
  return fromBundle({ project, resources }, { ...validation, signal })
}
