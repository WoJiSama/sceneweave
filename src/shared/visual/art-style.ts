import { z } from 'zod'
import { cloneJson } from '../validation/json.js'
import { colorFilterChangesPixels, colorFilterSchema, neutralColorFilter, type ColorFilter } from './color-filter.js'

export const ART_STYLE_PRESETS = ['handDrawn', 'tea', 'lineArt'] as const
export type ArtStylePreset = typeof ART_STYLE_PRESETS[number]

// Keep the original modes stable in saved projects. Line art lays down the paper before color washes.
const enabledPresets = {
  original: [],
  handDrawn: ['handDrawn'],
  tea: ['tea'],
  both: ['handDrawn', 'tea'],
  lineArt: ['lineArt'],
  lineArtHandDrawn: ['lineArt', 'handDrawn'],
  lineArtTea: ['lineArt', 'tea'],
  all: ['lineArt', 'handDrawn', 'tea'],
} as const satisfies Record<string, readonly ArtStylePreset[]>
type ArtStyleMode = keyof typeof enabledPresets
const artStyleModes = Object.keys(enabledPresets) as ArtStyleMode[]

const percent = z.int().min(0).max(100)
const signedPercent = z.int().min(-100).max(100)
const artStyleParametersSchema = z.object({
  strength: percent,
  warmth: signedPercent,
  saturation: signedPercent,
  contrast: signedPercent,
  depth: percent,
  ink: percent,
  grain: percent,
  grainSize: percent,
}).strict()

// Recipes without a paint version keep the appearance saved by the first renderer.
export const CURRENT_ART_STYLE_PAINT_VERSION = 3
export const CURRENT_LINE_ART_PAINT_VERSION = 4
const artStyleRecipeSchema = artStyleParametersSchema.extend({ paintVersion: z.union([z.literal(2), z.literal(CURRENT_ART_STYLE_PAINT_VERSION)]).optional() })
const lineArtRecipeSchema = artStyleParametersSchema.extend({
  paintVersion: z.union([z.literal(CURRENT_ART_STYLE_PAINT_VERSION), z.literal(CURRENT_LINE_ART_PAINT_VERSION)]),
})

const legacySceneArtStyleSchema = z.object({
  version: z.literal(1),
  active: z.enum(artStyleModes),
  presets: z.object({
    handDrawn: artStyleRecipeSchema,
    tea: artStyleRecipeSchema,
    lineArt: lineArtRecipeSchema.optional(),
  }).strict(),
}).strict()

const themeEffectsSchema = artStyleParametersSchema.pick({ strength: true, depth: true, ink: true, grain: true, grainSize: true })
  .extend({ enabled: z.boolean(), brushwork: z.boolean() })
export const CURRENT_BITMAP_LINE_VERSION = 2
const themeLineEffectsSchema = themeEffectsSchema.extend({
  edgeDetail: percent,
  lightFade: percent,
  bitmapLineVersion: z.literal(CURRENT_BITMAP_LINE_VERSION).optional(),
})
const themeRecipeSchema = z.object({ filter: colorFilterSchema, effects: themeEffectsSchema }).strict()
const themeLineRecipeSchema = themeRecipeSchema.extend({ effects: themeLineEffectsSchema })
const sceneThemeSchema = z.object({
  version: z.literal(2),
  active: z.enum(artStyleModes),
  original: colorFilterSchema,
  presets: z.object({ handDrawn: themeRecipeSchema, tea: themeRecipeSchema, lineArt: themeLineRecipeSchema }).strict(),
}).strict()

export const sceneArtStyleSchema = z.discriminatedUnion('version', [legacySceneArtStyleSchema, sceneThemeSchema])
  .refine(style => !!style.presets.lineArt || !enabledArtStylePresets(style.active).includes('lineArt'), {
    path: ['presets', 'lineArt'], message: '启用线稿时需要保存线稿参数。',
  })

export type ArtStyleParameters = z.infer<typeof artStyleParametersSchema>
export type ArtStyleRecipe = z.infer<typeof artStyleRecipeSchema> | z.infer<typeof lineArtRecipeSchema>
export type SceneArtStyle = z.infer<typeof sceneArtStyleSchema>
export type LegacySceneArtStyle = z.infer<typeof legacySceneArtStyleSchema>
export type SceneTheme = z.infer<typeof sceneThemeSchema>
export type ThemeRecipe = z.infer<typeof themeRecipeSchema> | z.infer<typeof themeLineRecipeSchema>
export type ThemeEffects = ThemeRecipe['effects']
export type ActiveArtStyle = { preset: ArtStylePreset | 'original'; parameters: ArtStyleRecipe; filter?: ColorFilter; effects?: ThemeEffects }
export type ActiveArtStyles = readonly [ActiveArtStyle, ...ActiveArtStyle[]]

export const ART_STYLE_DEFAULTS = Object.freeze({
  handDrawn: Object.freeze({ paintVersion: CURRENT_ART_STYLE_PAINT_VERSION, strength: 100, warmth: -14, saturation: -49, contrast: 19, depth: 40, ink: 88, grain: 33, grainSize: 27 }),
  tea: Object.freeze({ paintVersion: CURRENT_ART_STYLE_PAINT_VERSION, strength: 100, warmth: 64, saturation: -17, contrast: 42, depth: 88, ink: 68, grain: 33, grainSize: 35 }),
  lineArt: Object.freeze({ paintVersion: CURRENT_LINE_ART_PAINT_VERSION, strength: 100, warmth: 8, saturation: -100, contrast: 36, depth: 17, ink: 98, grain: 9, grainSize: 32 }),
} satisfies Record<ArtStylePreset, ArtStyleRecipe>)

function themeFilter(preset: ArtStylePreset, { strength, warmth, saturation, contrast, paintVersion }: ArtStyleRecipe): ColorFilter {
  const filter = neutralColorFilter()
  const tea = preset === 'tea'
  const curve = filter.curves.rgb
  if (preset !== 'lineArt') {
    // Retain the tonal direction of the old recipes as editable controls.
    curve.splice(1, 0, ...[32, 80, 128, 188, 224].map(input => {
      const t = input / 255
      const wash = paintVersion ? tea ? 32 * t ** 3 - 100 * t * (1 - t) : 84 * t * (1 - t) + 11 * t ** 2
        : tea ? (t - .45) * t * (1 - t) * 20 : (1 - t) * 8
      return { input, output: Math.round(input + (paintVersion === 3 && tea ? wash * (1 - .64 * Math.max(0, 1 - t / .38) ** 2) : wash)) }
    }))
  }
  return { ...filter, strength, warmth, saturation, contrast: preset === 'lineArt' ? 0 : Math.round(contrast * (contrast < 0 ? 8.8 : 6.6)) / 10 }
}

function themeEffects({ strength, depth, ink, grain, grainSize }: ArtStyleRecipe): z.infer<typeof themeEffectsSchema> {
  return { enabled: true, brushwork: true, strength, depth, ink, grain, grainSize }
}

export function upgradeSceneArtStyle(style: LegacySceneArtStyle): SceneTheme {
  const { handDrawn, tea, lineArt = ART_STYLE_DEFAULTS.lineArt } = style.presets
  return { version: 2, active: style.active, original: { ...neutralColorFilter(), enabled: false }, presets: {
    handDrawn: { filter: themeFilter('handDrawn', handDrawn), effects: themeEffects(handDrawn) },
    tea: { filter: themeFilter('tea', tea), effects: themeEffects(tea) },
    lineArt: { filter: themeFilter('lineArt', lineArt), effects: {
      ...themeEffects(lineArt), edgeDetail: Math.round(Math.max(0, Math.min(100, 42 + (lineArt.contrast - 36) / 2))),
      lightFade: 100, bitmapLineVersion: CURRENT_BITMAP_LINE_VERSION,
    } },
  } }
}

export function defaultSceneArtStyle(): SceneTheme {
  const style = upgradeSceneArtStyle({ version: 1, active: 'original', presets: ART_STYLE_DEFAULTS })
  style.presets.tea.effects.grain = 57
  style.presets.tea.effects.grainSize = 44
  return style
}

export function enabledArtStylePresets(active: ArtStyleMode): readonly ArtStylePreset[] {
  return enabledPresets[active]
}

export function setArtStyleEnabled(active: ArtStyleMode, preset: ArtStylePreset, enabled: boolean): ArtStyleMode {
  const selected = new Set(enabledArtStylePresets(active))
  if (enabled) selected.add(preset)
  else selected.delete(preset)
  return artStyleModes.find(mode => {
    const styles = enabledArtStylePresets(mode)
    return styles.length === selected.size && styles.every(style => selected.has(style))
  })!
}

/** Paint order is fixed, independent of the sequence in which the user enabled the presets. */
export function activeArtStyles(style: SceneArtStyle | undefined): ActiveArtStyles | undefined {
  if (!style) return undefined
  if (style.version === 2) {
    const neutralParameters: ArtStyleRecipe = { paintVersion: CURRENT_ART_STYLE_PAINT_VERSION, strength: 0, depth: 0, ink: 0, grain: 0,
      warmth: 0, contrast: 0, saturation: 0, grainSize: 0 }
    const [first, ...rest] = enabledArtStylePresets(style.active).flatMap((preset): ActiveArtStyle[] => {
      const { filter, effects } = style.presets[preset]
      const strength = effects.enabled ? effects.strength : 0
      const brushwork = effects.brushwork && strength > 0
      const parameters = { ...neutralParameters,
        strength, depth: brushwork ? effects.depth : 0, ink: brushwork ? effects.ink : 0, grain: effects.grain, grainSize: effects.grainSize,
        paintVersion: ART_STYLE_DEFAULTS[preset].paintVersion,
      }
      return (strength > 0 && (brushwork || effects.grain > 0)) || colorFilterChangesPixels(filter)
        ? [{ preset, parameters, filter: cloneJson(filter), effects: { ...effects } }] : []
    })
    if (first) return [first, ...rest]
    if (style.active === 'original' && colorFilterChangesPixels(style.original)) {
      return [{ preset: 'original', parameters: neutralParameters, filter: cloneJson(style.original) }]
    }
    return undefined
  }
  const [first, ...remaining] = enabledArtStylePresets(style.active).flatMap(preset => {
    const parameters = style.presets[preset]
    return parameters?.strength ? [{ preset, parameters: { ...parameters } }] : []
  })
  return first ? [first, ...remaining] : undefined
}

export function activeLineArt(looks: ActiveArtStyles | undefined): ActiveArtStyle | undefined {
  return looks?.find(look => look.preset === 'lineArt' && look.parameters.strength > 0 && (!look.effects || look.effects.brushwork))
}

export function preservesBitmapContours(look: ActiveArtStyle | undefined): boolean {
  const effects = look?.effects
  return !!effects && 'edgeDetail' in effects && effects.bitmapLineVersion === CURRENT_BITMAP_LINE_VERSION
}

export function artStyleLightAmount(looks: ActiveArtStyles | undefined): number {
  const line = activeLineArt(looks)
  if (!line) return 1
  const fade = line.effects && 'lightFade' in line.effects ? line.effects.lightFade / 100 : 1
  return 1 - line.parameters.strength / 100 * fade
}

export function usesSeparateArtStyle(looks: ActiveArtStyles | undefined): boolean {
  return looks?.some(look => !!look.filter) ?? false
}

/** Only these fields affect the scene before the post-processing color pass. */
export function artStyleBrushKey(looks: ActiveArtStyles | undefined): string {
  return JSON.stringify(looks?.flatMap<(string | number | undefined)[]>(({ preset, parameters: { paintVersion, strength, depth, ink }, effects, filter }) => {
    if (!filter) return [preset === 'lineArt' ? [1, preset, paintVersion, strength] : [1, preset, paintVersion, strength, depth, ink]]
    if (!effects?.brushwork || !strength) return []
    if ('lightFade' in effects) return [[2, preset, strength, effects.lightFade, effects.bitmapLineVersion]]
    return depth || ink ? [[2, preset, strength, depth, ink]] : []
  }) ?? [])
}
