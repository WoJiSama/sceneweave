import { copyScenePresentations, comparePresentationDepth } from '../../shared/appearance/presentation.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { geometryDocumentForValidation } from '../../shared/commands/domain.js'
import { isCertifiedSceneSnapshot, validateSceneSnapshot } from '../../shared/validation/snapshots.js'
import { freezeJson } from '../../shared/validation/json.js'

const views = new WeakMap<SceneDocument, Map<number, SceneDocument>>()
/** Native format retained; this disposable inspector view is never a save or renderer input. */
export function selectionScene(scene: SceneDocument, options: { effectiveLocks?: boolean; layerOrder?: boolean } = {}): SceneDocument {
  const certified = isCertifiedSceneSnapshot(scene), key = Number(!!options.effectiveLocks) + Number(!!options.layerOrder) * 2
  const cached = certified ? views.get(scene) : undefined
  if (cached?.has(key)) return cached.get(key)!
  const checked = validateSceneSnapshot(scene)
  if (!checked.ok) throw new Error(checked.errors.map(issue => issue.message).join('；'))
  copyScenePresentations(scene, checked.document)
  let view = geometryDocumentForValidation(checked.document, options.effectiveLocks)
  if (options.layerOrder) {
    const source = checked.document, bands = { ground: 0, object: 1, canopy: 2 }
    const ordered = Object.values(view.props).sort((a, b) => bands[a.renderLayer] - bands[b.renderLayer]
      || source.userLayers[source.entityLayers[a.id]].order - source.userLayers[source.entityLayers[b.id]].order
      || a.renderOrder - b.renderOrder || comparePresentationDepth(source, a, b) || a.id.localeCompare(b.id))
    view = { ...view, props: Object.fromEntries(ordered.map((prop, renderOrder) => [prop.id, { ...prop, renderOrder }])) }
  }
  // Locks and order below are inspector state. In v3 their persisted counterparts
  // are hashed by generation ownership; never certify this temporary projection
  // as a complete document or rewrite its generation metadata to match the UI.
  if (checked.document.schemaVersion === 3) {
    copyScenePresentations(scene, view)
    const result = freezeJson(view)
    if (certified) { const entry = cached ?? new Map(); entry.set(key, result); views.set(scene, entry) }
    return result
  }
  const result = validateSceneSnapshot(view)
  if (!result.ok) throw new Error(result.errors.map(issue => issue.message).join('；'))
  if (certified) { const entry = cached ?? new Map(); entry.set(key, result.document); views.set(scene, entry) }
  return result.document
}
