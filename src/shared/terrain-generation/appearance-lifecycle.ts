import type { CompositionContent } from '../model/appearance.js'
import { effectiveAdjustments, equalCompositionValue } from '../appearance/graph.js'
import { detachChangedOutputs, type GenerationAppearanceChange } from './integrity.js'
import { getLegacyGeneration } from './composition-contracts.js'

/** Graph edits precede bitmap materialization. Protect only their real target
 * field groups now; actual geometry changes are compared after resolving. */
export function detachChangedAppearance(before: CompositionContent, next: CompositionContent): number {
  if (![3, 4].includes(before.document.schemaVersion) || ![3, 4].includes(next.document.schemaVersion)) return 0
  const changes: GenerationAppearanceChange[] = []
  for (const row of Object.values(getLegacyGeneration(next.document)!.ownership)) {
    const ref = row.target, id = ref.kind === 'surfaceOverlay' ? ref.parentId! : ref.entityId
    const prop = ref.kind === 'prop', surface = ['terrainArea', 'terrainEdge', 'terrainConnection', 'path', 'surfaceOverlay'].includes(ref.kind)
    if (!prop && !surface) continue
    const sourceKey = prop ? 'propSources' : 'surfaceSources'
    const previousSource = before.appearance[sourceKey][id], nextSource = next.appearance[sourceKey][id]
    if (!previousSource || !nextSource) continue
    const sourceChanged = previousSource !== nextSource
    const effectiveChanged = !equalCompositionValue(effectiveAdjustments(before, id), effectiveAdjustments(next, id))
    if (sourceChanged || effectiveChanged) changes.push({ ...ref, fieldGroup: prop ? 'appearance' : 'surface' })
  }
  return detachChangedOutputs(before.document, next.document, changes)
}
