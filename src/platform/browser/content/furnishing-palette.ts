import type { FurnishingPalette } from '../../../shared/furnishing/palette.js'
import { furnishingPaletteSchema } from '../../../shared/furnishing/palette.js'
import { createInnFunctionCatalogDocument, createInnFunctionCatalogProject } from './inn-functions.js'
import { createFurnitureCollectionDocument, createFurnitureCollectionProject } from './furniture-collection-catalog.js'

/** Metadata is for selection only. Actual adoption always materializes and
 * validates the selected fixed entries with their exact bytes and licenses. */
export function furnishingPaletteDocument(raw: FurnishingPalette) {
  const palette = furnishingPaletteSchema.parse(raw)
  return palette.source === 'inn' ? createInnFunctionCatalogDocument() : palette.source === 'collection'
    ? createFurnitureCollectionDocument({ styleId: palette.styleId }) : null
}
export async function furnishingPaletteProject(raw: FurnishingPalette, signal: AbortSignal) {
  const palette = furnishingPaletteSchema.parse(raw)
  signal.throwIfAborted()
  if (palette.source === 'current') throw new Error('当前工程选材不包含外部素材。')
  return palette.source === 'inn' ? createInnFunctionCatalogProject(signal) : createFurnitureCollectionProject({ styleId: palette.styleId }, signal)
}
