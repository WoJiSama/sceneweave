import type { GenerationRecipe } from './contracts.js'

export const COASTAL_ASCENT_VERSION = 10
export const WEATHERED_COAST_VERSION = 11
export const NATURAL_STONE_COAST_VERSION = 12
export const ERODED_COAST_VERSION = 13
export const COASTAL_ASCENT_VERSIONS = Object.freeze([
  COASTAL_ASCENT_VERSION, WEATHERED_COAST_VERSION, NATURAL_STONE_COAST_VERSION, ERODED_COAST_VERSION,
] as const)
export type CoastalAscentVersion = typeof COASTAL_ASCENT_VERSIONS[number]

export function isCoastalAscentVersion(version: unknown): version is CoastalAscentVersion {
  return COASTAL_ASCENT_VERSIONS.some(value => value === version)
}

/** Local edits of managed output require the exact stored algorithm, recipe and terrain kind. */
export function supportsProfiledTerrainEdit(recipe: GenerationRecipe): boolean {
  const { algorithmId, algorithmVersion, recipeVersion, parameters } = recipe
  if (algorithmVersion !== recipeVersion) return false
  if (algorithmVersion === 4 || algorithmVersion === 5) return algorithmId === 'terrain-scene' || algorithmId === 'terrain-scene-t3'
  if (algorithmVersion === 8) return algorithmId === 'terrain-scene-t3' && parameters.terrainKind === 'forest'
  if (algorithmVersion === 9) return algorithmId === 'terrain-scene' && parameters.terrainKind === 'coast'
  return isCoastalAscentVersion(algorithmVersion) && algorithmId === 'terrain-scene' && (parameters.terrainKind === 'island' || parameters.terrainKind === 'coast')
}
