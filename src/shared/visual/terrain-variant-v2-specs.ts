import { cloneJson, freezeJson } from '../validation/json.js'
import { TERRAIN_VARIANT_V2_ART } from './terrain-variant-v2-art.js'

export const terrainVariantV2AssetId = (key: string): string => `terrain-variants-v2-art-${key}`
export const terrainVariantV2DefinitionId = (key: string): string => `terrain-variants-v2-prop-${key}`
export const TERRAIN_VARIANT_V2_SPECS = freezeJson(TERRAIN_VARIANT_V2_ART.map(art => ({
  key: art.key, role: art.role, name: art.name,
  assetId: terrainVariantV2AssetId(art.key), definitionId: terrainVariantV2DefinitionId(art.key),
  widthMm: art.widthMm, heightMm: art.heightMm, footprintMm: cloneJson(art.footprintMm!),
  blocksMovement: art.blocksMovement!, blocksSight: art.blocksSight!, renderLayer: art.renderLayer!, shadowClass: art.shadowClass!,
  presentation: cloneJson(art.presentation),
})))
