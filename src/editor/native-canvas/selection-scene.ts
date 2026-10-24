import type { SceneDocument } from '../../shared/model/scene.js'
import { geometryDocumentForValidation } from '../../shared/commands/domain.js'
import { isCertifiedSceneSnapshot, validateSceneSnapshot } from '../../shared/validation/snapshots.js'

const views = new WeakMap<SceneDocument, Map<number, SceneDocument>>()
/** Native format retained; this disposable inspector view is never a save or renderer input. */
export function selectionScene(scene: SceneDocument, options: { effectiveLocks?: boolean; layerOrder?: boolean } = {}): SceneDocument {
  const certified = isCertifiedSceneSnapshot(scene), key = Number(!!options.effectiveLocks) + Number(!!options.layerOrder) * 2
  const cached = certified ? views.get(scene) : undefined
  if (cached?.has(key)) return cached.get(key)!
  const checked = validateSceneSnapshot(scene)
  if (!checked.ok) throw new Error(checked.errors.map(issue => issue.message).join('；'))
  let view = geometryDocumentForValidation(checked.document, options.effectiveLocks)
  if (options.layerOrder) {
    const source = checked.document, bands = { ground: 0, object: 1, canopy: 2 }
    const ordered = Object.values(view.props).sort((a, b) => bands[a.renderLayer] - bands[b.renderLayer]
      || source.userLayers[source.entityLayers[a.id]].order - source.userLayers[source.entityLayers[b.id]].order
      || a.renderOrder - b.renderOrder || a.id.localeCompare(b.id))
    view = { ...view, props: Object.fromEntries(ordered.map((prop, renderOrder) => [prop.id, { ...prop, renderOrder }])) }
  }
  const result = validateSceneSnapshot(view)
  if (!result.ok) throw new Error(result.errors.map(issue => issue.message).join('；'))
  if (certified) { const entry = cached ?? new Map(); entry.set(key, result.document); views.set(scene, entry) }
  return result.document
}
