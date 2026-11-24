import type { PropDefinition, SceneDocument, VersionRef } from '../model/scene.js'
import type { SceneArtStyle } from '../visual/art-style.js'
import type { Projection } from './types.js'

export type MaterialBrush = 'wood' | 'stone' | 'earth' | 'grass' | 'foliage' | 'metal' | 'plaster' | 'cloth'

/** Use the material vocabulary of the visible definition, including future
 * catalogue entries. A replacement image keeps its own appearance. */
function brushFor(tags: string[], name: string, surface: boolean): MaterialBrush | undefined {
  const words = tags.filter(tag => tag.length <= 16 && !/^(无|不|非)|[、，；]/.test(tag)).join(' ') + ' ' + name
  if (/水面|海水|海面|浅水|玻璃|熔岩|岩浆|\b(?:water|glass|lava)\b/i.test(words)) return
  if (/抹灰|灰泥|\bplaster\b/i.test(words)) return 'plaster'
  if (/苔草|草地|草缘|苔地|\b(?:grass|moss|meadow|sedge)\b/i.test(words)) return surface ? 'grass' : 'foliage'
  if (/灌木|灌丛|树|蕨|树冠|\b(?:shrub|tree|canopy|fern|vegetation)\b/i.test(words)) return 'foliage'
  if (/金属|矿货|矿石手车|\b(?:metal|iron|steel|copper)\b/i.test(words)) return 'metal'
  if (/布草柜|书柜|书架|\b(?:cupboard|shelf|bookcase)\b/i.test(words)) return 'wood'
  if (/织物|床垫|地毯|靠垫|\b(?:cloth|fabric|rug|bed|cushion)\b/i.test(words)) return 'cloth'
  if (/木|橡|漂木|\b(?:wood|plank|timber|oak|driftwood)\b/i.test(words)) return 'wood'
  if (/砖|岩|石|\b(?:stone|rock|brick|basalt|flagstone|scree)\b/i.test(words)) return 'stone'
  if (/泥|土|沙|砂|火山灰|\b(?:earth|soil|sand|ash|dirt)\b/i.test(words)) return 'earth'
  if (/铁|钢|铜/.test(words)) return 'metal'
  if (/布|地毯|床|\b(?:cloth|fabric|rug|bed)\b/i.test(words)) return 'cloth'
  if (/桌|椅|柜|木箱|\b(?:chair|table|stool|shelf|crate)\b/i.test(words)) return 'wood'
}

export function projectMaterialBrushes(scene: SceneDocument, projection: Projection, style: SceneArtStyle | undefined = scene.artStyle): Projection['materialBrushes'] {
  if (style?.version !== 2 || !style.materialDrawing) return
  const brushes = new Map<string, MaterialBrush | undefined>()
  const record = (assetId: string, brush: MaterialBrush | undefined) => {
    // An aliased bitmap with incompatible uses cannot take either brush globally.
    if (!brushes.has(assetId)) brushes.set(assetId, brush)
    else if (brushes.get(assetId) !== brush) brushes.set(assetId, undefined)
  }
  const add = (assetId: string, definition: Pick<PropDefinition, 'tags' | 'name' | 'origin'>, surface: boolean) => {
    const source = scene.assets[assetId]
    const eligible = source?.origin.kind === 'original' && definition.origin.kind === 'original' && !source.imageEnhancement && !source.imageRefinement
    record(assetId, eligible ? brushFor(definition.tags, definition.name, surface) : undefined)
  }
  for (const material of Object.values(projection.materials)) add(material.textureAssetId, scene.materials[material.id], true)
  const addProp = (ref: VersionRef | null, assetId: string) => {
    const definition = ref && scene.propDefinitions[ref.id]
    if (ref && definition?.version === ref.version && definition.defaultAppearance.kind === 'image'
      && definition.defaultAppearance.assetId === assetId) add(assetId, definition, false)
    else record(assetId, undefined)
  }
  for (const prop of projection.props) if (prop.appearance.kind === 'image') addProp(prop.definitionRef, prop.appearance.assetId)
  for (const row of projection.decorations ?? []) addProp(scene.decorations[row.id].definitionRef, row.assetId)
  return Object.fromEntries([...brushes].filter((e): e is [string, MaterialBrush] => !!e[1]))
}
