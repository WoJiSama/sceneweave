import { enabledArtStylePresets, type ArtStylePreset, type SceneArtStyle } from '../../shared/visual/art-style'
import { colorFilterChangesPixels } from '../../shared/visual/color-filter'

export const artStylePresetLabels = { handDrawn: '手绘', tea: '茶绘', lineArt: '线稿' } satisfies Record<ArtStylePreset, string>
export type ArtStyleSide = 'a' | 'b'
export type ArtStyleAlternatives = Record<ArtStyleSide, SceneArtStyle>

export const artStyleSideLabel = (side: ArtStyleSide, style: SceneArtStyle) =>
  `${side.toUpperCase()} · ${enabledArtStylePresets(style.active).map(preset => artStylePresetLabels[preset]).join(' + ')
    || (style.version === 2 && colorFilterChangesPixels(style.original) ? '原画调色' : '原画')}`
