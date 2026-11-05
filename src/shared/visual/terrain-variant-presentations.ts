import { addPropAppearanceSource } from '../appearance/graph.js'
import type { CompositionContent } from '../model/appearance.js'
import { cloneJson } from '../validation/json.js'
import { TERRAIN_VARIANT_ART } from './terrain-variant-art.js'
import { terrainVariantDefinitionId } from './terrain-variant-specs.js'
import { TERRAIN_VARIANT_V2_ART } from './terrain-variant-v2-art.js'
import { terrainVariantV2DefinitionId } from './terrain-variant-v2-specs.js'

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

/** v7's independent compact tree source is bound only by the v7 materializer. */
export function bindTerrainVariantV2Presentations(content: CompositionContent): CompositionContent {
  for (const art of TERRAIN_VARIANT_V2_ART) {
    const definition = content.document.propDefinitions[terrainVariantV2DefinitionId(art.key)]
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
