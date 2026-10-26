import { z } from 'zod'
import type { EditableProject } from '../../../application/workspace/project.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE } from '../../../shared/visual/island-art.js'
import { REFINED_COAST_ART, REFINED_COAST_LICENSE } from '../../../shared/visual/coast-art.js'
import { REFINED_INTERIOR_ART, REFINED_INTERIOR_LICENSE } from '../../../shared/visual/interior-art.js'
import type { BlankOptions } from './factories.js'
import { createRefinedIslandDocument } from './refined-island.js'
import { createRefinedCoastDocument } from './refined-coast.js'
import { createRefinedInteriorDocument } from './refined-interior.js'
import { createVisualBlankDocument } from './visual-samples.js'
import { materializeVisualArt } from './visual-art-project.js'

const paletteSchema = z.enum(['island', 'coast', 'interior'])
export type RefinedVisualPalette = z.infer<typeof paletteSchema>
const palettes = {
  island: { document: createRefinedIslandDocument, art: REFINED_ISLAND_ART, license: REFINED_ISLAND_LICENSE },
  coast: { document: createRefinedCoastDocument, art: REFINED_COAST_ART, license: REFINED_COAST_LICENSE },
  interior: { document: createRefinedInteriorDocument, art: REFINED_INTERIOR_ART, license: REFINED_INTERIOR_LICENSE },
} as const

/** A genuinely empty scene with the exact fixed refined palette, not a template copy. */
export function createRefinedBlankDocument(palette: RefinedVisualPalette, options: BlankOptions): SceneDocument {
  const selected = palettes[paletteSchema.parse(palette)], scene = createVisualBlankDocument(options)
  // These factories create synchronous original metadata only. No template
  // scene entities, history, images or instance records are copied to the blank.
  const source = selected.document({ sceneId: 'refined-palette-source', now: scene.createdAt })
  scene.assets = cloneJson(source.assets)
  scene.materials = cloneJson(source.materials)
  scene.propDefinitions = cloneJson(source.propDefinitions)
  scene.styleThemes = cloneJson(source.styleThemes)
  scene.activeStyleThemeRef = cloneJson(source.activeStyleThemeRef)
  // Interior themes reference fixed furniture recipes. Keep those exact
  // definitions while creating zero actual groups, props or manual overrides.
  scene.prefabDefinitions = cloneJson(source.prefabDefinitions)
  scene.presetSnapshot = { ...scene.presetSnapshot, presetId: `${scene.presetSnapshot.presetId}-refined-${palette}`,
    source: `${scene.presetSnapshot.source}；独立精修${palette}固定素材库，未复制样板结构/物件/光雾/滤镜，风格签收仍需人工审阅` }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error('精修素材空白工程未通过完整场景校验。')
  return checked.document
}

export async function createRefinedBlankProject(palette: RefinedVisualPalette, options: BlankOptions, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const key = paletteSchema.parse(palette), selected = palettes[key], scene = createRefinedBlankDocument(key, options)
  return materializeVisualArt(scene, selected.art, selected.license, key => `refined-art-${key}`, signal)
}
