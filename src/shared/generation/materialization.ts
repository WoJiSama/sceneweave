import type { SceneDocument } from '../model/scene.js'
import { canonicalJson } from '../validation/json.js'
import { generationWriteCollectionSchema, type DeepReadonly, type GenerationPhase, type GenerationWriteCollection, type GenerationWriteGrant } from './contracts.js'

// A phase owns finite scene domains, not an unrestricted replacement document.
// Extend these scopes with the owning domain when a later recipe needs more.
const entities = {
  structure: ['vertices', 'rooms', 'walls', 'terrainAreas', 'terrainEdges', 'regions'],
  connectivity: ['openings', 'terrainConnections', 'paths'],
  content: ['props', 'prefabInstances', 'scatterGroups', 'decorations', 'decorationClusters', 'surfaceRules'],
  presentation: [],
} as const
const styled = ['rooms', 'walls', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths'] as const
const definitions = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
const equal = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b)
const withoutStyle = (entity: object) => Object.fromEntries(Object.entries(entity).filter(([key]) => !['floorStyle', 'topStyle', 'surfaceStyle'].includes(key)))

/** Return the first unauthorized write, independently of declared artifacts.
 * Presentation can change styles of existing physical entities, never their
 * identity, geometry, support, collision, visibility or layer membership. */
export function materializationViolation(before: DeepReadonly<SceneDocument>, after: SceneDocument, phase: GenerationPhase): string | undefined {
  const owned = new Set<string>(entities[phase])
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const field = key as keyof SceneDocument
    if (equal(before[field], after[field])) continue
    if (owned.has(key) || key === 'updatedAt' || key === 'visual') continue
    if (phase !== 'presentation' && (key === 'generation' || key === 'generationMetadata')) continue
    if (phase === 'connectivity' && key === 'constraints') continue
    if (phase === 'presentation' && key === 'activeStyleThemeRef') continue
    if ((definitions as readonly string[]).includes(key)) {
      const a = before[field] as Record<string, unknown>, b = after[field] as Record<string, unknown>
      // Fixed resource definitions can be added, never reinterpreted or removed.
      if (Object.keys(a).every(id => Object.hasOwn(b, id) && equal(a[id], b[id]))) continue
    }
    if (key === 'entityLayers' && phase !== 'presentation') {
      const ids = new Set(entities[phase].flatMap(collection => [...Object.keys(before[collection]), ...Object.keys(after[collection])]))
      if ([...new Set([...Object.keys(before.entityLayers), ...Object.keys(after.entityLayers)])].every(id => equal(before.entityLayers[id], after.entityLayers[id]) || ids.has(id))) continue
    }
    if (phase === 'presentation' && (styled as readonly string[]).includes(key)) {
      const a = before[field] as Record<string, object>, b = after[field] as Record<string, object>
      if (Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(id => Object.hasOwn(b, id) && equal(withoutStyle(a[id]), withoutStyle(b[id])))) continue
    }
    return key
  }
  return undefined
}

export type MaterializationWrite =
  | { readonly kind: 'create' | 'delete'; readonly collection: GenerationWriteCollection; readonly id: string }
  | { readonly kind: 'update'; readonly collection: GenerationWriteCollection; readonly id: string; readonly fields: readonly string[] }
  | { readonly kind: 'field'; readonly path: string }
const collections = new Set<string>(generationWriteCollectionSchema.options)
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const fieldBoundaries = new Set(['updatedAt', 'activeStyleThemeRef', 'generationMetadata', 'constraints.entranceOpeningIds', 'constraints.pathChecks', 'constraints.wallEndClearanceMm', 'constraints.minDoorWidthMm', 'constraints.minPathWidthMm'])

/** Derive the write set from captured materialization, never from artifacts or
 * an operator-provided change list. Arrays are indivisible field values. */
export function materializationWriteSet(before: DeepReadonly<SceneDocument>, after: SceneDocument): readonly MaterializationWrite[] {
  const writes: MaterializationWrite[] = []
  const visit = (left: unknown, right: unknown, path: string): void => {
    if (equal(left, right)) return
    if (collections.has(path)) {
      const a = record(left) ?? {}, b = record(right) ?? {}, collection = path as GenerationWriteCollection
      for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (Object.hasOwn(a, id) && Object.hasOwn(b, id) && equal(a[id], b[id])) continue
        if (!Object.hasOwn(a, id)) writes.push({ kind: 'create', collection, id })
        else if (!Object.hasOwn(b, id)) writes.push({ kind: 'delete', collection, id })
        else {
          const previous = record(a[id]), next = record(b[id])
          const fields = previous && next ? [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(key => !equal(previous[key], next[key])) : ['$value']
          writes.push({ kind: 'update', collection, id, fields })
        }
      }
      // Replacing a collection with a non-record must not appear to be no work.
      if (!record(left) || !record(right)) writes.push({ kind: 'field', path })
      return
    }
    const a = record(left), b = record(right)
    if (fieldBoundaries.has(path) || !a || !b) { writes.push({ kind: 'field', path }); return }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], path ? `${path}.${key}` : key)
  }
  visit(before, after, '')
  return writes
}

/** The phase ceiling and the operator's narrower declaration both apply. */
export function declaredMaterializationViolation(before: DeepReadonly<SceneDocument>, after: SceneDocument, grants: readonly GenerationWriteGrant[]): string | undefined {
  for (const write of materializationWriteSet(before, after)) {
    if (write.kind === 'field') {
      if (!grants.some(grant => grant.kind === 'field' && grant.path === write.path)) return write.path
    } else if (write.kind === 'update') {
      const fields = new Set(grants.flatMap(grant => grant.kind === 'update' && grant.collection === write.collection && grant.ids.includes(write.id) ? [...grant.fields] : []))
      const denied = write.fields.find(field => !fields.has(field))
      if (denied) return `${write.collection}.${write.id}.${denied}`
    } else if (!grants.some(grant => grant.kind === write.kind && grant.collection === write.collection && (grant.kind === 'create' || grant.kind === 'delete' && grant.ids.includes(write.id)))) return `${write.collection}.${write.id}`
  }
  return undefined
}

/** Exact metadata fields invalidated by native physical commands. The IDs are
 * captured before execution; this grants no physical entity or recipe writes. */
export function generationInvalidationWrites(document: DeepReadonly<SceneDocument>): GenerationWriteGrant[] {
  const legacy = document.generation.legacy
  return [
    { kind: 'field', path: 'updatedAt' },
    { kind: 'update', collection: 'generation.legacy.rules', ids: Object.keys(legacy.rules), fields: ['inputHash', 'managedOutputHash', 'state'] },
    { kind: 'update', collection: 'generation.legacy.checks', ids: Object.keys(legacy.checks), fields: ['state'] },
    { kind: 'update', collection: 'generation.legacy.surroundings', ids: 'surroundings' in legacy ? Object.keys(legacy.surroundings) : [], fields: ['state'] },
    { kind: 'update', collection: 'generation.legacy.topology', ids: 'topology' in legacy ? Object.keys(legacy.topology) : [], fields: ['state'] },
    { kind: 'update', collection: 'generation.compositions', ids: Object.keys(document.generation.compositions), fields: ['state'] },
    { kind: 'update', collection: 'generation.checks', ids: Object.keys(document.generation.checks), fields: ['state'] },
    { kind: 'update', collection: 'visual.transitions', ids: Object.keys(document.visual.transitions), fields: ['leftSurface', 'rightSurface', 'leftElevationMm', 'rightElevationMm', 'distanceSource', 'polygons', 'strokes', 'inputHash', 'outputHash'] },
  ]
}

/** Domains explicitly select their physical collections. The shared portion
 * owns only newly added provenance records and native invalidation fields. */
export function generationCreationWrites(document: DeepReadonly<SceneDocument>, created: readonly GenerationWriteCollection[]): GenerationWriteGrant[] {
  return [
    ...created.map(collection => ({ kind: 'create' as const, collection })),
    ...(['entityLayers', 'generation.legacy.recipes', 'generation.legacy.rules', 'generation.legacy.ownership'] as const).map(collection => ({ kind: 'create' as const, collection })),
    ...generationInvalidationWrites(document),
  ]
}
