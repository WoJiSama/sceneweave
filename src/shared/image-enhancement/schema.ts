import { z } from 'zod'
import { captureJson, freezeJson } from '../validation/json.js'

export const imageEnhancementDirectionSchema = z.enum(['clarity', 'edge', 'denoise', 'decontaminate', 'contour'])
export const imageEnhancementStrengthSchema = z.enum(['gentle', 'balanced', 'strong'])
export const imageEnhancementRecipeSchema = z.strictObject({
  version: z.literal(1),
  direction: imageEnhancementDirectionSchema,
  strength: imageEnhancementStrengthSchema,
  scale: z.union([z.literal(1), z.literal(2)]),
})
export type ImageEnhancementDirection = z.infer<typeof imageEnhancementDirectionSchema>
export type ImageEnhancementStrength = z.infer<typeof imageEnhancementStrengthSchema>
export type ImageEnhancementRecipe = z.infer<typeof imageEnhancementRecipeSchema>

/** A recipe names a fixed local algorithm. Source identity and adoption belong to its host. */
export function parseImageEnhancementRecipe(input: unknown): ImageEnhancementRecipe {
  return freezeJson(imageEnhancementRecipeSchema.parse(captureJson(input)))
}
