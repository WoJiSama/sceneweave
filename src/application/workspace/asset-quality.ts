import type { AssetRecord } from '../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import { assessAssetQuality, type AssetQualityContext } from '../../shared/assets/quality.js'
import { createAssetQualityAssessment, assertAssetQualityAccepted, type AssetQualityAssessment } from '../../shared/assets/quality-review.js'
import { freezeJson } from '../../shared/validation/json.js'
import type { EditableProject } from './project.js'

/** Always analyzes real decoded pixels. Reports grant no resource-validation exemption. */
export async function assessImportedAssetQuality(name: string, bytes: Uint8Array, record: AssetRecord, context: AssetQualityContext,
  validation: CompleteValidationOptions): Promise<AssetQualityAssessment> {
  checkCancelled(validation.signal)
  const pixels = await validation.images.decode(bytes, record, validation)
  checkCancelled(validation.signal)
  const assessment = createAssetQualityAssessment(name, record.sha256, assessAssetQuality(pixels, context, validation))
  if (assessment.report.status === 'blocked') assertAssetQualityAccepted([assessment])
  return assessment
}

/** New catalog definitions, including reused images at a different physical scale.
 * Existing project/backup content is preserved and never retroactively rejected. */
export async function assessAddedCatalogQuality(before: EditableProject, after: EditableProject, validation: CompleteValidationOptions): Promise<readonly AssetQualityAssessment[]> {
  const result: AssetQualityAssessment[] = []
  const inspect = async (name: string, assetId: string, context: AssetQualityContext) => {
    checkCancelled(validation.signal)
    const asset = after.document.assets[assetId], record = asset && after.assets[asset.sha256]
    if (!record) throw new Error('素材初筛的实际图片资源缺失。')
    const bytes = await after.resources.read(record.sha256)
    result.push(await assessImportedAssetQuality(name, bytes, record, context, validation))
  }
  for (const definition of Object.values(after.document.propDefinitions)) {
    if (before.document.propDefinitions[definition.id] || definition.defaultAppearance.kind !== 'image') continue
    await inspect(definition.name, definition.defaultAppearance.assetId, { kind: 'prop', widthMm: definition.defaultVisualBoundsMm.width, heightMm: definition.defaultVisualBoundsMm.height })
  }
  for (const material of Object.values(after.document.materials)) {
    if (before.document.materials[material.id]) continue
    await inspect(material.name, material.textureAssetId, { kind: 'material', widthMm: material.defaultTileSizeMm.width, heightMm: material.defaultTileSizeMm.height })
  }
  checkCancelled(validation.signal)
  return freezeJson(result)
}
