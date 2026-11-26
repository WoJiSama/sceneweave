import { z } from 'zod'
import type { SceneDocument } from '../model/scene.js'
import { COASTAL_ASCENT_VERSION, WEATHERED_COAST_VERSION, NATURAL_STONE_COAST_VERSION, ERODED_COAST_VERSION,
  generateCoastalGeometryV10, generateCoastalGeometryV11, generateCoastalGeometryV12, generateCoastalGeometryV13,
  terrainGenerationInputV10Schema, terrainGenerationInputV11Schema, terrainGenerationInputV12Schema, terrainGenerationInputV13Schema,
  type CoastalAscentVersion, type TerrainGenerationResult } from './generate.js'
import { styleTerrainGeometryV5, terrainGenerationResultV5Schema, type TerrainGenerationInputV5 } from './surface-generation.js'
import type { ShoreSurfaceOptions } from '../visual/shore-surfaces.js'
import { coastalEdgeDetailScale } from './coastal-ascent.js'
import { isCoastalAscentVersion } from './recipe-capabilities.js'

export { COASTAL_ASCENT_VERSION, WEATHERED_COAST_VERSION, NATURAL_STONE_COAST_VERSION, ERODED_COAST_VERSION,
  terrainGenerationInputV10Schema, terrainGenerationInputV11Schema, terrainGenerationInputV12Schema, terrainGenerationInputV13Schema }

function checkCoastalResult(result: { input: object }, context: z.RefinementCtx) {
  const checked = terrainGenerationResultV5Schema.safeParse({ ...result, input: { ...result.input, algorithmVersion: 5 } })
  if (!checked.success) for (const issue of checked.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
}

export const terrainGenerationResultV10Schema = z.object({ ...terrainGenerationResultV5Schema.shape, input: terrainGenerationInputV10Schema }).strict().superRefine(checkCoastalResult)
export const terrainGenerationResultV11Schema = z.object({ ...terrainGenerationResultV5Schema.shape, input: terrainGenerationInputV11Schema }).strict().superRefine(checkCoastalResult)
export const terrainGenerationResultV12Schema = z.object({ ...terrainGenerationResultV5Schema.shape, input: terrainGenerationInputV12Schema }).strict().superRefine(checkCoastalResult)
export const terrainGenerationResultV13Schema = z.object({ ...terrainGenerationResultV5Schema.shape, input: terrainGenerationInputV13Schema }).strict().superRefine(checkCoastalResult)

function styleCoastalTerrain<Input extends Omit<TerrainGenerationInputV5, 'algorithmVersion'> & { algorithmVersion: CoastalAscentVersion }>(
  base: SceneDocument, physical: TerrainGenerationResult, input: Input, profile: ShoreSurfaceOptions['shoreProfile']) {
  const scale = Math.min(input.widthMm / 24000, input.heightMm / 18000)
  const edgeDetailScale = coastalEdgeDetailScale(scale, input.quality)
  const styled = styleTerrainGeometryV5(base, physical, { ...input, algorithmVersion: 5 }, edgeDetailScale, profile)
  return { ...styled, input }
}

export function generateTerrainDocumentV10(base: SceneDocument, raw: unknown) {
  const physical = generateCoastalGeometryV10(base, raw)
  const input = terrainGenerationInputV10Schema.parse({ ...physical.input, algorithmVersion: COASTAL_ASCENT_VERSION })
  return styleCoastalTerrain(base, physical, input, 'terraces')
}

export function generateTerrainDocumentV11(base: SceneDocument, raw: unknown) {
  const physical = generateCoastalGeometryV11(base, raw)
  const input = terrainGenerationInputV11Schema.parse({ ...physical.input, algorithmVersion: WEATHERED_COAST_VERSION })
  return styleCoastalTerrain(base, physical, input, 'weatheredTerraces')
}

export function generateTerrainDocumentV12(base: SceneDocument, raw: unknown) {
  const physical = generateCoastalGeometryV12(base, raw)
  const input = terrainGenerationInputV12Schema.parse({ ...physical.input, algorithmVersion: NATURAL_STONE_COAST_VERSION })
  return styleCoastalTerrain(base, physical, input, 'naturalStone')
}
export function generateTerrainDocumentV13(base: SceneDocument, raw: unknown) {
  const physical = generateCoastalGeometryV13(base, raw)
  const input = terrainGenerationInputV13Schema.parse({ ...physical.input, algorithmVersion: ERODED_COAST_VERSION })
  return styleCoastalTerrain(base, physical, input, 'erodedCoast')
}

const recipes = {
  [COASTAL_ASCENT_VERSION]: { input: terrainGenerationInputV10Schema, result: terrainGenerationResultV10Schema, generate: generateTerrainDocumentV10 },
  [WEATHERED_COAST_VERSION]: { input: terrainGenerationInputV11Schema, result: terrainGenerationResultV11Schema, generate: generateTerrainDocumentV11 },
  [NATURAL_STONE_COAST_VERSION]: { input: terrainGenerationInputV12Schema, result: terrainGenerationResultV12Schema, generate: generateTerrainDocumentV12 },
  [ERODED_COAST_VERSION]: { input: terrainGenerationInputV13Schema, result: terrainGenerationResultV13Schema, generate: generateTerrainDocumentV13 },
} satisfies Record<CoastalAscentVersion, unknown>

export function coastalGenerationRecipe(version: unknown) {
  return isCoastalAscentVersion(version) ? recipes[version] : undefined
}
