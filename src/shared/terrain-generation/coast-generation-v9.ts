import { z } from 'zod'
import type { SceneDocument } from '../model/scene.js'
import { generateCoastGeometryV9, terrainGenerationInputV9Schema } from './generate.js'
import { styleTerrainGeometryV5, terrainGenerationResultV5Schema } from './surface-generation.js'

export { terrainGenerationInputV9Schema }

export const terrainGenerationResultV9Schema = z.object({
  ...terrainGenerationResultV5Schema.shape, input: terrainGenerationInputV9Schema,
}).strict().superRefine((result, context) => {
  const checked = terrainGenerationResultV5Schema.safeParse({ ...result, input: { ...result.input, algorithmVersion: 5 } })
  if (!checked.success) for (const issue of checked.error.issues) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  }
})

export function generateTerrainDocumentV9(base: SceneDocument, raw: unknown): z.infer<typeof terrainGenerationResultV9Schema> {
  const physical = generateCoastGeometryV9(base, raw)
  const input = terrainGenerationInputV9Schema.parse({ ...physical.input, algorithmVersion: 9 })
  const scale = Math.min(input.widthMm / 24000, input.heightMm / 18000)
  const edgeDetailScale = Math.max(1, scale / (input.quality === 'detailed' ? 2 : 1))
  const styled = styleTerrainGeometryV5(base, physical, { ...input, algorithmVersion: 5 }, edgeDetailScale, 'headland')
  return terrainGenerationResultV9Schema.parse({ ...styled, input })
}
