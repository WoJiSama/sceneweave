import type { ProjectData } from '../../../shared/model/project.js'
import type { VersionRef } from '../../../shared/model/scene.js'

export const mixedInteriorId = (id: string): string => `mixed-interior-v1-${id}`

/** A new fixed catalogue identity for composition, never a rewrite of the
 * original refined palette. Exact license bodies and image/SVG bytes remain
 * unchanged; generic labels such as MIT are scoped to their real text hash. */
export function namespaceMixedInteriorCatalogue(project: ProjectData): void {
  const scene = project.document
  const rename = (ref: VersionRef): VersionRef => ({ ...ref, id: mixedInteriorId(ref.id) })
  const bindings = new Map(project.licenseBindings.map(row => [`${row.subjectKind}:${row.subjectId}`, row]))
  for (const [kind, collection] of [
    ['asset', scene.assets], ['material', scene.materials], ['propDefinition', scene.propDefinitions],
    ['prefabDefinition', scene.prefabDefinitions], ['styleTheme', scene.styleThemes],
  ] as const) {
    for (const [id, value] of Object.entries(collection)) {
      const binding = bindings.get(`${kind}:${id}`)
      if (!binding) throw new Error('混合室内固定副本缺少确切许可绑定。')
      value.id = mixedInteriorId(id)
      value.licenseRef = `license-${binding.licensePath.slice(9, -4)}`
      value.origin = { ...value.origin, attribution: `${value.origin.attribution}；混合室内固定副本v1，来源快照${id}` }
      if ('catalogId' in value) value.catalogId = `mixed-interior-v1:${value.catalogId}`
      binding.subjectId = value.id; binding.licenseRef = value.licenseRef
      delete collection[id]
      Object.assign(collection, { [value.id]: value })
    }
  }
  for (const material of Object.values(scene.materials)) material.textureAssetId = mixedInteriorId(material.textureAssetId)
  for (const prop of Object.values(scene.propDefinitions)) if (prop.defaultAppearance.kind === 'image') prop.defaultAppearance.assetId = mixedInteriorId(prop.defaultAppearance.assetId)
  for (const prefab of Object.values(scene.prefabDefinitions)) for (const member of prefab.members) {
    const template = member.propTemplate
    if (template.definitionRef) template.definitionRef = rename(template.definitionRef)
    if (template.appearance.kind === 'image') template.appearance.assetId = mixedInteriorId(template.appearance.assetId)
  }
  for (const theme of Object.values(scene.styleThemes)) {
    theme.materialSuggestions = theme.materialSuggestions.map(rename)
    theme.propSuggestions = theme.propSuggestions.map(rename)
    theme.prefabSuggestions = theme.prefabSuggestions.map(rename)
  }
  if (scene.activeStyleThemeRef) scene.activeStyleThemeRef = rename(scene.activeStyleThemeRef)
  project.authoringSources = Object.fromEntries(Object.entries(project.authoringSources).map(([id, source]) => [mixedInteriorId(id), source]))
}
