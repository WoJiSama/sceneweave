import type { SceneDocument } from './scene.js'
import type { GenerationSystem1, RegionalModel1, VisualSystem2 } from '../terrain-generation/contracts.js'
import { createEmptyGeneration5, type GenerationSystem5, type VisualSystem3 } from '../terrain-generation/composition-contracts.js'
import { emptyVisualSystem, type VisualSystem } from '../visual/types.js'
import { captureJson } from '../validation/json.js'

type CurrentField = 'schemaVersion' | 'mapMode' | 'generation' | 'regional' | 'visual' | 'decorations' | 'decorationClusters' | 'surfaceRules' | 'constraints'
/** Known internal algorithm DTOs and checked-in templates only. This is not an import parser. */
export type InternalSceneInput = Omit<SceneDocument, CurrentField> & {
  schemaVersion: number
  constraints: Omit<SceneDocument['constraints'], 'pathChecks'> & {
    pathChecks: (Omit<SceneDocument['constraints']['pathChecks'][number], 'floorId'> & { floorId?: string })[]
  }
  mapMode?: 'scene' | 'regional'
  generation?: GenerationSystem1 | GenerationSystem5
  regional?: RegionalModel1 | null
  visual?: VisualSystem | VisualSystem2<VisualSystem> | VisualSystem3
  decorations?: SceneDocument['decorations']
  decorationClusters?: SceneDocument['decorationClusters']
  surfaceRules?: SceneDocument['surfaceRules']
}

/** Construct the full current shape without generating geometry, members or identities.
 * Public readers must strictly validate their input before reaching this boundary.
 * Current authoring represents continuous vegetation with surface rules.
 */
export function toCurrentSceneDocument(input: InternalSceneInput): SceneDocument {
  const scene = captureJson(input)
  // Old native algorithms only accepted empty path declarations. Never infer a
  // Floor for an unsupported historical declaration or silently drop it.
  const pathChecks = scene.constraints.pathChecks.map(check => {
    if (!check.floorId) throw new Error('旧通路声明缺少明确Floor，不能作为当前工程直接构造。')
    return { ...check, floorId: check.floorId }
  })
  if (Object.values(scene.decorationClusters ?? {}).some(cluster => Object.hasOwn(cluster, 'canopyRule'))) {
    throw new Error('当前工程使用地表规则表示连续植被。')
  }
  const generation = scene.generation?.version === 5 ? scene.generation : createEmptyGeneration5(scene.generation)
  const base = scene.visual?.version === 3 ? scene.visual.base : scene.visual?.version === 2 ? scene.visual
    : { version: 2 as const, base: scene.visual ?? emptyVisualSystem(), materializedEdges: {} }
  return { ...scene, constraints: { ...scene.constraints, pathChecks }, schemaVersion: 1, mapMode: scene.mapMode ?? 'scene', generation,
    regional: scene.regional ?? null,
    visual: scene.visual?.version === 3 ? scene.visual : { version: 3, base, transitions: {} },
    decorations: scene.decorations ?? {}, decorationClusters: scene.decorationClusters ?? {}, surfaceRules: scene.surfaceRules ?? {} }
}
