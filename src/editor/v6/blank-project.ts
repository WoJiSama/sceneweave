import indoor from '../../../assets/sceneweave-handdrawn/manifest.json'
import outdoor from '../../../assets/sceneweave-handdrawn-outdoor/manifest.json'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import type { MaterialRef } from '../../core/v2/types'
import { migrateSceneV2 } from '../../core/v3/migration'
import { createCompositionContentV6 } from '../../core/v6/graph'
import { validateCompleteProjectV2 } from '../../io/v2/project-file'
import { validateCompleteProjectV6 } from '../../io/v6/project-file'
import type { CompleteProjectV6 } from '../../io/v6/types'
import { createBlankProjectV2, type BlankDocumentOptionsV2 } from '../v2/blank-project'

/** Adopt the existing fixed material catalog without bringing sample geometry into a blank scene. */
export async function createOutdoorBlankProject(options: BlankDocumentOptionsV2, signal?: AbortSignal) {
  const project = await createBlankProjectV2(options, signal)
  const bindings = new Map(project.licenseBindings.map(binding => [binding.subjectId.slice(0, 2), binding.licensePath]))
  for (const pack of [{ prefix: 'b2', folder: 'sceneweave-handdrawn', manifest: indoor }, { prefix: 'b3', folder: 'sceneweave-handdrawn-outdoor', manifest: outdoor }]) {
    let number = 0
    for (const [index, entry] of pack.manifest.assets.entries()) {
      if (entry.kind !== 'material') continue
      signal?.throwIfAborted()
      const id = `${pack.prefix}-m-${String(++number).padStart(2, '0')}`, imageId = `${pack.prefix}-a-${String(index + 1).padStart(2, '0')}`
      const origin = { kind: 'original' as const, attribution: 'Sceneweave contributors；项目原创 SVG 绘制，Codex 辅助；源文件及 MIT 记录随仓库保存', canEmbed: true }
      project.document.assets[imageId] = { id: imageId, sha256: entry.sha256, mimeType: 'image/png', pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight, logicalSizeMm: { ...entry.logicalSizeMm }, licenseRef: 'MIT', origin }
      project.document.materials[id] = { id, catalogId: entry.catalogId, version: 1, name: entry.name, tags: ['墨绘原野', '原创', 'P2'], licenseRef: 'MIT', origin, textureAssetId: imageId, defaultTileSizeMm: { ...entry.logicalSizeMm }, applicableSurfaces: entry.surfaces as MaterialRef['applicableSurfaces'] }
      const response = await fetch(`${import.meta.env.BASE_URL}assets/${pack.folder}/${entry.file}`, { signal })
      if (!response.ok) throw new Error(`内置材质读取失败：${entry.file} (${response.status})`)
      const blob = new Blob([await response.arrayBuffer()], { type: 'image/png' })
      project.assets[entry.sha256] = { sha256: entry.sha256, blob, mimeType: 'image/png', sizeBytes: entry.sizeBytes, pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight }
    }
  }
  project.licenseBindings = collectDependenciesV2(project.document).subjects.map(subject => ({ ...subject, licensePath: bindings.get(subject.subjectId.slice(0, 2))!, embedding: 'allowed' }))
  await validateCompleteProjectV2(project, { signal })
  const result: CompleteProjectV6 = { ...createCompositionContentV6(migrateSceneV2(project.document)), assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings }
  await validateCompleteProjectV6(result, { signal })
  return result
}
