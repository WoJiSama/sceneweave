import { addPropAppearanceSource } from '../appearance/graph.js'
import type { CompositionContent } from '../model/appearance.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import type { PublishPathStyleCommand } from './contracts.js'
import { fitSectionParts, sizeSection } from './fitted-layout.js'
import { minimumPathSectionLength } from './layout.js'
import { resolvePathProp, resolvePathSection } from './sources.js'
import { LINE_STYLE_LICENSE_REF } from './style-license.js'

const styleOrigin = { kind: 'original' as const, attribution: 'Sceneweave line style; each fixed member retains its original source and license.', canEmbed: true }

export function publishPathStyle(content: CompositionContent, command: PublishPathStyleCommand): number {
  const { document, appearance: graph } = content
  const { source, defaults, previousRef } = command
  const previous = previousRef && document.prefabDefinitions[previousRef.id]
  if (previousRef && (!previous?.pathStyle || previous.version !== previousRef.version)) throw new Error('请选择工程内的确切样式版本。')
  const sourceDefinition = source.kind === 'prefab' ? document.prefabDefinitions[source.ref.id]
    : source.kind === 'prop' ? document.propDefinitions[source.ref.id] : undefined
  const sourceTemplate = source.kind === 'prefab' ? graph.prefabAppearanceTemplates[source.ref.id] : undefined
  const parts = resolvePathSection(document, graph, source, false)
  if (parts.length > 128) throw new Error('沿线源节最多包含 128 个部件。')
  const sized = sizeSection(parts, defaults.dimensions)
  const fit = !!defaults.fit || !!defaults.structure
  if (!fit && defaults.lengthMm < minimumPathSectionLength(sized.map(part => part.propTemplate))) throw new Error('默认节距短于源节的实际占地或外观。')
  if (defaults.lamps?.ref) resolvePathProp(document, graph, defaults.lamps.ref)
  const catalogId = previous?.catalogId ?? command.id, origin = previous?.origin ?? styleOrigin
  const version = 1 + Math.max(0, ...Object.values(document.prefabDefinitions).filter(item => item.catalogId === catalogId
    && canonicalJson(item.origin) === canonicalJson(origin)).map(item => item.version))
  if (!Number.isSafeInteger(version)) throw new Error('样式版本已达上限。')
  const tags = [...new Set(['沿线样式', ...(sourceDefinition?.tags ?? []).filter(tag => !tag.startsWith('sceneweave:')).slice(0, 63)])]
  const members = fit ? fitSectionParts(sized, defaults.lengthMm) : sized
  const definitionRef = { id: command.id, version }
  document.prefabDefinitions[command.id] = { ...definitionRef, catalogId, name: command.name, origin: cloneJson(origin), tags,
    licenseRef: sourceDefinition?.licenseRef ?? LINE_STYLE_LICENSE_REF,
    members: cloneJson([...members]), pathStyle: cloneJson(defaults) }
  graph.prefabAppearanceTemplates[command.id] = { definitionRef, visibility: sourceTemplate?.visibility ?? 'public',
    members: Object.fromEntries(members.map(({ key, propTemplate }) => {
      const inherited = sourceTemplate?.members[key], parent = inherited ? graph.sources[inherited.sourceId] : undefined
      return [key, { sourceId: addPropAppearanceSource(graph, propTemplate, parent?.parentSourceId ?? null),
        adjustments: cloneJson(inherited?.adjustments ?? []) }]
    })) }
  return parts.length + 1
}
