import type { Attachment, AttachmentOwner, AttachmentSurface } from './contracts.js'
import { attachmentDependencyIds } from './dependencies.js'
import type { AttachmentScene } from './topology.js'
import { canonicalJson } from '../validation/json.js'

export interface AttachmentChangeScope {
  affectedIds: string[]
  layerIds: string[]
  /** Actual changed attachment records and their direct physical owners/children. */
  changedIds: string[]
  /** Read-only closure, excluding the actual changed IDs above. */
  dependencyIds: string[]
  /** Top-level changed targets; the transaction budget remains authoritative. */
  commandCost: number
}
const equal = (left: unknown, right: unknown) => canonicalJson(left ?? null) === canonicalJson(right ?? null)
const entity = (scene: AttachmentScene, ref: AttachmentOwner) => ref.kind === 'prop' ? scene.props[ref.id]
  : ref.kind === 'wall' ? scene.walls[ref.id] : ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id] : scene.terrainConnections[ref.id]
function references(scene: AttachmentScene, value: Attachment | AttachmentSurface): AttachmentOwner[] {
  if (!('mode' in value)) return [value.owner]
  return [value.child, ...(value.mode === 'embed' ? value.surfaceIds : [value.surfaceId]).flatMap(id => scene.attachmentSurfaces?.[id]?.owner ?? [])]
}

/** Inspect the exact prepared pair without rebuilding candidates or signing
 * witnesses. Reads never become extra writes, including recursive notes. */
export function inspectAttachmentChanges(before: AttachmentScene, after: AttachmentScene): AttachmentChangeScope {
  const changed = new Set<string>(), dependencies = new Set<string>(), layers = new Set<string>()
  const collections = ['attachmentSurfaces', 'attachments'] as const
  for (const collection of collections) for (const id of new Set([...Object.keys(before[collection] ?? {}), ...Object.keys(after[collection] ?? {})])) {
    const left = before[collection]?.[id], right = after[collection]?.[id]
    let relevant = !equal(left, right)
    if (relevant) changed.add(id)
    const refs = [...(left ? references(before, left) : []), ...(right ? references(after, right) : [])]
    for (const ref of refs) if (!equal(entity(before, ref), entity(after, ref)) || before.entityLayers[ref.id] !== after.entityLayers[ref.id]) {
      changed.add(ref.id); relevant = true
    }
    if (!relevant) continue
    for (const [scene, value] of [[before, left], [after, right]] as const) if (value) {
      for (const dependency of attachmentDependencyIds(scene, value)) dependencies.add(dependency)
    }
  }
  const affected = new Set([...changed, ...dependencies])
  for (const id of affected) for (const scene of [before, after]) {
    if (scene.userLayers[id]) layers.add(id)
    const layerId = scene.entityLayers[id]
    if (layerId) layers.add(layerId)
  }
  return { affectedIds: [...affected].sort(), layerIds: [...layers].sort(), changedIds: [...changed].sort(),
    dependencyIds: [...dependencies].filter(id => !changed.has(id)).sort(), commandCost: changed.size }
}
