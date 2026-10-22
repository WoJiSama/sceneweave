import { validateSceneSnapshotV2 } from '../v2/snapshots'
import type { SceneDocumentV2 } from '../v2/types'
import { geometryDocumentForValidationV3 } from './domain'
import { isCertifiedSceneSnapshotV3, validateSceneSnapshotV3 } from './snapshots'
import type { SceneDocumentV3 } from './types'

const views = new WeakMap<SceneDocumentV3, Map<number, SceneDocumentV2>>()

/**
 * Explicit domain-only compatibility view for existing selection, panels and
 * geometry guards. Never pass this to v2 rendering, export or persistence.
 * Only truly certified v3 identities can cache a separately validated v2 view.
 */
export function toGeometryDocumentV2(scene: SceneDocumentV3, options: { effectiveLocks?: boolean; layerOrder?: boolean } = {}): SceneDocumentV2 {
  const certified = isCertifiedSceneSnapshotV3(scene), key = Number(!!options.effectiveLocks) + Number(!!options.layerOrder) * 2
  const cached = certified ? views.get(scene) : undefined
  if (cached?.has(key)) return cached.get(key)!
  const checked = validateSceneSnapshotV3(scene)
  if (!checked.ok) throw new Error(`v3 领域视图无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const view = geometryDocumentForValidationV3(checked.document, options.effectiveLocks)
  if (options.layerOrder) {
    // Selection consumes canonical renderOrder. Keep the persisted order intact
    // while expressing the native v3 layer/order/id order in this disposable view.
    const source = checked.document, bands = { ground: 0, object: 1, canopy: 2 }
    const ordered = Object.values(view.props).sort((a, b) => bands[a.renderLayer] - bands[b.renderLayer]
      || source.userLayers[source.entityLayers[a.id]].order - source.userLayers[source.entityLayers[b.id]].order
      || a.renderOrder - b.renderOrder || a.id.localeCompare(b.id))
    view.props = Object.fromEntries(ordered.map((prop, renderOrder) => [prop.id, { ...prop, renderOrder }]))
  }
  const domain = validateSceneSnapshotV2(view)
  if (!domain.ok) throw new Error(`领域视图无效：${domain.errors.map(issue => issue.message).join('；')}`)
  if (certified) { const entry = cached ?? new Map(); entry.set(key, domain.document); views.set(scene, entry) }
  return domain.document
}
