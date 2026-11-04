import { addPropAppearanceSource } from '../appearance/graph.js'
import type { CompositionContent } from '../model/appearance.js'
import { cloneJson } from '../validation/json.js'
import { TERRAIN_VARIANT_ART } from './terrain-variant-art.js'
import { terrainVariantDefinitionId } from './terrain-variant-specs.js'

/** Attach each catalogue definition's exact fixed-presentation witness to a
 * fresh generated candidate. Existing projects are never rewritten. */
export function bindTerrainVariantPresentations(content: CompositionContent): CompositionContent {
  for (const art of TERRAIN_VARIANT_ART) {
    const definition = content.document.propDefinitions[terrainVariantDefinitionId(art.key)]
    if (!definition) continue
    const sourceId = addPropAppearanceSource(content.appearance, {
      definitionRef: { id: definition.id, version: definition.version },
      appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
      shadowClass: definition.defaultShadowClass, shadowOverride: null,
    }, null, art.presentation)
    for (const prop of Object.values(content.document.props)) if (prop.definitionRef?.id === definition.id) content.appearance.propSources[prop.id] = sourceId
  }
  return content
}
