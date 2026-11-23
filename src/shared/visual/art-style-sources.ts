import type { SvgAuthoringSource } from '../model/project.js'
import type { AssetRef } from '../model/scene.js'
import type { Projection } from '../projection/types.js'
import type { ArtStyleRecipe } from './art-style.js'

type GuidedArtStyleSource = 'singleBed' | 'strawBed' | 'oakTile' | 'studyTile' | 'tavernTile' | 'roundTable' | 'oakChair' | 'longTable' | 'bench' | 'stool'
export type ArtStyleSource = GuidedArtStyleSource | 'svg'

// Paint guides are registered against exact built-in artwork. Names and user-supplied tags cannot select a guide.
const rasterSources = new Map<string, GuidedArtStyleSource>([
  ['8d21d6c47c63f0e742cf99293f0a3d32ba89c73fd9831ba0554bfd68e95cc3cb', 'singleBed'],
  ['39ee3fb3730cd7e77e10786df15606a011b7a4c286f64745f92f0923f6816886', 'studyTile'],
  ['8159c5e8f3e787c01a93530a911b5c6de7d109968eb8ac071cbdbf46fdc21c5e', 'studyTile'],
  ['82ed098421bdc7a8498e24933766795f867f51016ccd8da05dc419174d52a839', 'roundTable'],
  ['9074593175cf3c30f0c85b54b72c25ad172980c181f92233892cc1196f121c32', 'oakChair'],
])
const vectorSources = new Map<string, GuidedArtStyleSource>([
  ['f4cedb843fb3cbea336673f3cd71c1da04d9975e278909f603e33f70646fffe1', 'strawBed'],
  ['46a65007dfaf4bd5c779cd5062edcc3dd411e5cdc58d57022d8400ae182f6db5', 'oakTile'],
  ['ee38bfcfca8cf4980c048cbb22f790a514994affdd74a0bdf954e81aec93cac8', 'tavernTile'],
  ['fee5bba71526f46d8e679c070ff0f8b188df11b7958ef2df35a8a165242a088b', 'longTable'],
  ['58d71bffb504454fe489c6673fc2dfdf0754f8559928972f82f0f4313dc54354', 'bench'],
  ['16a91cc975a282cc9345110ebf344ee452e50be8bc647200b88b4df2527d7bdd', 'stool'],
])

export function artStyleSource(asset: AssetRef | undefined, source: SvgAuthoringSource | undefined, paintVersion?: ArtStyleRecipe['paintVersion']): ArtStyleSource | undefined {
  if (!asset) return undefined
  const vector = source?.rasterSha256 === asset.sha256 ? source : undefined
  const refinement = asset.imageRefinement
  if (asset.origin.kind === 'original') {
    const guide = (vector && vectorSources.get(vector.normalizedSha256)) ?? rasterSources.get(asset.sha256)
    if (guide) return guide
  }
  if (vector && paintVersion === 3 && (refinement?.kind === 'vector' && refinement.algorithm === 'structure-plan-v1'
    || asset.origin.kind === 'original' && !refinement)) return 'svg'
  return undefined
}

/** Only direct paint consumers receive structural brushwork. */
export function artStyleArtworkIds(projection: Projection): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const prop of projection.props) if (prop.appearance.kind === 'image') ids.add(prop.appearance.assetId)
  for (const decoration of projection.decorations ?? []) ids.add(decoration.assetId)
  for (const material of Object.values(projection.materials)) ids.add(material.textureAssetId)
  return ids
}
