import { copyScenePresentations, comparePresentationDepth, scenePresentation } from '../../shared/appearance/presentation.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { geometryDocumentForValidation } from '../../shared/commands/domain.js'
import { isCertifiedSceneSnapshot, validateSceneSnapshot } from '../../shared/validation/snapshots.js'
import { freezeJson } from '../../shared/validation/json.js'
import { decorationPaintGeometry } from '../../shared/decorations/presentation.js'

const views = new WeakMap<SceneDocument, Map<number, SceneDocument>>()
const viewSources = new WeakMap<SceneDocument, Readonly<{ source: SceneDocument; options: number }>>()
/** Selection-owned provenance only. This never certifies a document for editing,
 * rendering, persistence or validation, and caller-owned sources cannot issue it. */
export function ownedSelectionViewSource(view: SceneDocument): Readonly<{ source: SceneDocument; options: number }> | undefined {
  return viewSources.get(view)
}
/** Native format retained; this disposable inspector view is never a save or renderer input. */
export function selectionScene(scene: SceneDocument, options: { effectiveLocks?: boolean; layerOrder?: boolean } = {}): SceneDocument {
  const effectiveLocks = !!options.effectiveLocks, layerOrder = !!options.layerOrder
  const certified = isCertifiedSceneSnapshot(scene), key = Number(effectiveLocks) + Number(layerOrder) * 2
  const cached = certified ? views.get(scene) : undefined
  if (cached?.has(key)) return cached.get(key)!
  const checked = validateSceneSnapshot(scene)
  if (!checked.ok) throw new Error(checked.errors.map(issue => issue.message).join('；'))
  copyScenePresentations(scene, checked.document)
  let view = geometryDocumentForValidation(checked.document, effectiveLocks)
  if (layerOrder) {
    const source = checked.document, bands = { ground: 0, object: 1, canopy: 2 }
    const ordered = Object.values(view.props).sort((a, b) => bands[a.renderLayer] - bands[b.renderLayer]
      || source.userLayers[source.entityLayers[a.id]].order - source.userLayers[source.entityLayers[b.id]].order
      || a.renderOrder - b.renderOrder || comparePresentationDepth(source, a, b) || a.id.localeCompare(b.id))
    view = { ...view, props: Object.fromEntries(ordered.map((prop, renderOrder) => [prop.id, { ...prop, renderOrder }])) }
    if (Object.keys(source.decorations ?? {}).length) {
      const sprites = [...Object.values(source.props), ...Object.values(source.decorations ?? {}).map(value => decorationPaintGeometry(source, value))]
        .sort((a, b) => bands[a.renderLayer] - bands[b.renderLayer] || source.userLayers[source.entityLayers[a.id]].order - source.userLayers[source.entityLayers[b.id]].order
          || a.renderOrder - b.renderOrder || (scenePresentation(source, a.id)?.mode === 'nearSide' && scenePresentation(source, b.id)?.mode === 'nearSide' ? a.positionMm.y - b.positionMm.y : 0) || a.id.localeCompare(b.id))
      const rank = new Map(sprites.map((value, index) => [value.id, index]))
      view = { ...view, props: Object.fromEntries(Object.values(view.props).map(value => [value.id, { ...value, renderOrder: rank.get(value.id)! }])),
        decorations: Object.fromEntries(Object.values(view.decorations ?? {}).map(value => [value.id, { ...value, renderOrder: rank.get(value.id)! }])) }
    }
  }
  // Locks and order below are inspector state. In terrain versions their persisted counterparts
  // are hashed by generation ownership; never certify this temporary projection
  // as a complete document or rewrite its generation metadata to match the UI.
  if (checked.document.generation.version === 5) {
    copyScenePresentations(scene, view)
    const result = freezeJson(view)
    if (certified) {
      const entry = cached ?? new Map(); entry.set(key, result); views.set(scene, entry)
      viewSources.set(result, Object.freeze({ source: scene, options: key }))
    }
    return result
  }
  const result = validateSceneSnapshot(view)
  if (!result.ok) throw new Error(result.errors.map(issue => issue.message).join('；'))
  if (certified) { const entry = cached ?? new Map(); entry.set(key, result.document); views.set(scene, entry) }
  return result.document
}
