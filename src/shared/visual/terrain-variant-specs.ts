import type { FixedPresentation } from '../terrain-generation/contracts.js'
import { cloneJson, freezeJson } from '../validation/json.js'
import { TERRAIN_VARIANT_ART } from './terrain-variant-art.js'

/** Immutable catalogue metadata, shared by pure presets and browser materialization. */
export const terrainVariantAssetId = (key: string): string => `terrain-variants-v1-art-${key}`
export const terrainVariantDefinitionId = (key: string): string => `terrain-variants-v1-prop-${key}`
export const TERRAIN_VARIANT_DEFINITION_IDS: readonly string[] = freezeJson(TERRAIN_VARIANT_ART.map(art => terrainVariantDefinitionId(art.key)))
export const TERRAIN_VARIANT_PRESENTATIONS: Readonly<Record<string, FixedPresentation>> = freezeJson(Object.fromEntries(
  TERRAIN_VARIANT_ART.map(art => [terrainVariantDefinitionId(art.key), cloneJson(art.presentation)])))
export const TERRAIN_VARIANT_SPECS = freezeJson(TERRAIN_VARIANT_ART.map(art => ({
  key: art.key, role: art.role, name: art.name, assetId: terrainVariantAssetId(art.key), definitionId: terrainVariantDefinitionId(art.key),
  widthMm: art.widthMm, heightMm: art.heightMm, footprintMm: cloneJson(art.footprintMm!),
  blocksMovement: art.blocksMovement!, blocksSight: art.blocksSight!, renderLayer: art.renderLayer!, shadowClass: art.shadowClass!,
  presentation: cloneJson(art.presentation),
})))
