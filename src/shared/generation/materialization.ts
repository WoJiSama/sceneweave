import type { SceneDocument } from '../model/scene.js'
import { canonicalJson } from '../validation/json.js'
import type { DeepReadonly, GenerationPhase } from './contracts.js'

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
const equal = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
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
