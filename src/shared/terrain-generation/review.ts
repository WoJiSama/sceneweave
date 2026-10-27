import type { SceneDocument } from '../model/scene.js'
import type { GenerationSystem3, GenerationSystem4 } from './contracts.js'
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
  const collections: { collection: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = [
    ...generationCollections.map(key => ({ collection: `generation.${key}`, before: before.generation?.[key] ?? {}, after: after.generation?.[key] ?? {} })),
    { collection: 'generation.strokes', before: before.generation && before.generation.version !== 1 ? before.generation.strokes : {}, after: after.generation && after.generation.version !== 1 ? after.generation.strokes : {} },
    { collection: 'generation.surroundings', before: before.generation && before.generation.version >= 3 ? (before.generation as GenerationSystem3|GenerationSystem4).surroundings : {}, after: after.generation && after.generation.version >= 3 ? (after.generation as GenerationSystem3|GenerationSystem4).surroundings : {} },
    { collection: 'generation.topology', before: before.generation?.version === 4 ? before.generation.topology : {}, after: after.generation?.version === 4 ? after.generation.topology : {} },
    { collection: 'generation.version', before: before.generation ? { 'generation-version': { version: before.generation.version } } : {}, after: after.generation ? { 'generation-version': { version: after.generation.version } } : {} },
    ...regionalCollections.map(key => ({ collection: `regional.${key}`, before: before.regional?.[key] ?? {}, after: after.regional?.[key] ?? {} })),
    { collection: 'regional.profile', before: before.regional ? { [before.regional.profile.id]: before.regional.profile } : {},
      after: after.regional ? { [after.regional.profile.id]: after.regional.profile } : {} },
    { collection: 'visual.materializedEdges', before: before.visual?.version === 2 ? before.visual.materializedEdges : {},
      after: after.visual?.version === 2 ? after.visual.materializedEdges : {} },
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
