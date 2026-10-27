import type { SceneDocument } from '../model/scene.js'
import type { VisualSystem } from './types.js'
/** Reuse visual1 leaves within a native visual2 document; never strip the enclosing document. */
export function visualBase(scene: Pick<SceneDocument, 'visual'>): VisualSystem | undefined {
  return scene.visual?.version === 2 ? scene.visual.base : scene.visual
}
