import type { SceneDocument } from '../model/scene.js'
import { getLegacyGeneration, getLegacyVisual } from './composition-contracts.js'
import { canonicalJson } from '../validation/json.js'

export interface TerrainRecordChange {
  id: string
  collection: string
  before: unknown
  after: unknown
  fields: string[]
}

const generationCollections = ['recipes', 'intents', 'rules', 'ownership', 'exclusions', 'constraints', 'checks', 'sourceLinks'] as const
const regionalCollections = ['areas', 'lines', 'landmarks', 'symbols', 'symbolDefinitions'] as const
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)

/** Review only persisted differences. This helper grants no editing or AI authority. */
export function terrainRecordChanges(before: SceneDocument, after: SceneDocument): TerrainRecordChange[] {
  const oldGeneration = getLegacyGeneration(before), newGeneration = getLegacyGeneration(after)
  const oldComposition = before.generation?.version === 5 ? before.generation : undefined
  const newComposition = after.generation?.version === 5 ? after.generation : undefined
  const oldVisual = getLegacyVisual(before), newVisual = getLegacyVisual(after)
  const collections: { collection: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = [
    ...generationCollections.map(key => ({ collection: `generation.${key}`, before: oldGeneration?.[key] ?? {}, after: newGeneration?.[key] ?? {} })),
    { collection: 'generation.strokes', before: oldGeneration && oldGeneration.version !== 1 ? oldGeneration.strokes : {}, after: newGeneration && newGeneration.version !== 1 ? newGeneration.strokes : {} },
    { collection: 'generation.surroundings', before: oldGeneration?.version === 3 || oldGeneration?.version === 4 ? oldGeneration.surroundings : {}, after: newGeneration?.version === 3 || newGeneration?.version === 4 ? newGeneration.surroundings : {} },
    { collection: 'generation.topology', before: oldGeneration?.version === 4 ? oldGeneration.topology : {}, after: newGeneration?.version === 4 ? newGeneration.topology : {} },
    ...(['features', 'compositions', 'requirements', 'checks', 'thresholds', 'dependencies'] as const).map(key => ({ collection: `generation5.${key}`, before: oldComposition?.[key] ?? {}, after: newComposition?.[key] ?? {} })),
    { collection: 'generation.version', before: before.generation ? { 'generation-version': { version: before.generation.version } } : {}, after: after.generation ? { 'generation-version': { version: after.generation.version } } : {} },
    ...regionalCollections.map(key => ({ collection: `regional.${key}`, before: before.regional?.[key] ?? {}, after: after.regional?.[key] ?? {} })),
    { collection: 'regional.profile', before: before.regional ? { [before.regional.profile.id]: before.regional.profile } : {},
      after: after.regional ? { [after.regional.profile.id]: after.regional.profile } : {} },
    { collection: 'visual.materializedEdges', before: oldVisual?.materializedEdges ?? {}, after: newVisual?.materializedEdges ?? {} },
    { collection: 'visual3.transitions', before: before.visual?.version === 3 ? before.visual.transitions : {}, after: after.visual?.version === 3 ? after.visual.transitions : {} },
  ]
  return collections.flatMap(({ collection, before: oldRows, after: newRows }) =>
    [...new Set([...Object.keys(oldRows), ...Object.keys(newRows)])].sort().flatMap(id => {
      const previous = Object.hasOwn(oldRows, id) ? oldRows[id] : null
      const next = Object.hasOwn(newRows, id) ? newRows[id] : null
      if (same(previous, next)) return []
      const a = previous && typeof previous === 'object' ? previous as Record<string, unknown> : {}
      const b = next && typeof next === 'object' ? next as Record<string, unknown> : {}
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter(key => !same(a[key], b[key]))
      return [{ id, collection, before: previous, after: next, fields }]
    }))
}
