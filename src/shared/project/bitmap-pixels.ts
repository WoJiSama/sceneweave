import type { ProjectData } from '../model/project.js'

export type BitmapPixelPipeline = 'native' | 'svg-rgba8-v1'
type BitmapProvenance = Pick<ProjectData, 'authoringSources' | 'appearance'>

/** The immutable root source owns pixel semantics for every fixed descendant.
 * Ordinary bitmap and processor-1 roots retain their established native path. */
export function createBitmapPixelPipelineLookup(project: BitmapProvenance): (assetId: string) => BitmapPixelPipeline {
  const roots = new Map(Object.entries(project.authoringSources).map(([id, source]) => [id, source.processorVersion] as const))
  const parents = new Map<string, string>(), known = new Map<string, BitmapPixelPipeline>()
  for (const variant of Object.values(project.appearance.variants)) {
    if (parents.has(variant.outputAssetId)) throw new Error('派生位图输出ID不能重用。')
    parents.set(variant.outputAssetId, variant.sourceAssetId)
  }
  return (assetId: string) => {
    const visited = new Set<string>(), path: string[] = []
    let current = assetId, pipeline: BitmapPixelPipeline
    while (true) {
      if (visited.has(current)) throw new Error('固定派生位图源链存在循环。')
      visited.add(current); path.push(current)
      const cached = known.get(current)
      if (cached) { pipeline = cached; break }
      const root = roots.get(current)
      if (root !== undefined) { pipeline = root === 2 ? 'svg-rgba8-v1' : 'native'; break }
      const parent = parents.get(current)
      if (parent === undefined) { pipeline = 'native'; break }
      current = parent
    }
    for (const id of path) known.set(id, pipeline)
    return pipeline
  }
}
export function bitmapVariantPixelPipeline(project: BitmapProvenance, assetId: string): BitmapPixelPipeline {
  return createBitmapPixelPipelineLookup(project)(assetId)
}
