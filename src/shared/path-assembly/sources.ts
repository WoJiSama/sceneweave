import { definitionPresentation } from '../appearance/presentation.js'
import type { AppearanceGraph } from '../model/appearance.js'
import type { SceneDocument, VersionRef } from '../model/scene.js'
import type { PathAssemblyRecipe } from './contracts.js'
import { profilePathSection, propDefinitionSection, standardPathSection, type SectionPart } from './layout.js'

export function resolvePathProp(scene: SceneDocument, graph: AppearanceGraph | undefined, ref: VersionRef) {
  const definition = scene.propDefinitions[ref.id]
  if (!definition || definition.version !== ref.version) throw new Error('请选择已采用且版本匹配的物件素材。')
  if (graph && definitionPresentation(graph, ref)?.mode === 'nearSide') throw new Error('请选择能沿路线旋转的俯视物件素材。')
  return propDefinitionSection(definition)
}

export function resolvePathSection(scene: SceneDocument, graph: AppearanceGraph | undefined,
  section: PathAssemblyRecipe['section'], publicAssembly: boolean): SectionPart[] {
  switch (section.kind) {
    case 'none': return []
    case 'steel':
    case 'timber': return [{ key: 'body', propTemplate: standardPathSection(section.kind, section.lengthMm) }]
    case 'profile': return [{ key: 'body', propTemplate: profilePathSection(section.profile, section.lengthMm) }]
    case 'prop': return [{ key: 'body', propTemplate: resolvePathProp(scene, graph, section.ref) }]
    case 'prefab': {
      const definition = scene.prefabDefinitions[section.ref.id], template = graph?.prefabAppearanceTemplates[section.ref.id]
      if (!definition || definition.version !== section.ref.version || !template || !graph) throw new Error('请选择已采用且版本匹配的组合素材。')
      if (template.visibility === 'gm' && publicAssembly) throw new Error('主持人专用组合只能用于主持人专用路线。')
      return definition.members.map(member => {
        const sourceId = template.members[member.key]?.sourceId, source = graph.sources[sourceId]
        if (source?.kind !== 'prop') throw new Error('组合缺少固定物件外观源。')
        if (graph.presentations?.[sourceId]?.mode === 'nearSide' || member.propTemplate.waterAppearance) throw new Error('组合源节须使用可旋转的陆上俯视物件。')
        return { key: member.key, propTemplate: { ...member.propTemplate, ...source.snapshot } }
      })
    }
  }
}
