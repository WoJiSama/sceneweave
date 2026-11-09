import type { AggregateChunkManifest, AggregateChunkLoadPlan } from '../../../shared/aggregates/chunks.js'
import { aggregateChunkAddress, planAggregateChunks } from '../../../shared/aggregates/chunks.js'
import type { AggregateChunkResidency } from '../../../shared/model/aggregate.js'
import type { Projection } from '../../../shared/projection/types.js'
import type { EditorRenderPlan } from './editor-render-plan.js'
import { projectionAssetConsumers } from '../../../shared/projection/presentation-contract.js'

/** Disposable derived data only. The complete document stays resident and all
 * persistence/geometry/resource checks remain with their existing owners.
 */
export function createAggregateDerivedResidency<T>(manifest: AggregateChunkManifest, derive: (id: string) => T) {
  const values = new Map<string, T>(), known = new Set(manifest.entries.map(entry => entry.id))
  const states = new Map(manifest.chunks.map(chunk => [aggregateChunkAddress(chunk.key), { key: chunk.key, state: 'unloaded' as const } as AggregateChunkResidency]))
  const ensure = (plan: AggregateChunkLoadPlan): void => {
    if (plan.sourceHash !== manifest.sourceHash) throw new Error('区块派生计划与当前清单不一致。')
    for (const id of plan.entityIds) if (!known.has(id)) throw new Error(`区块派生实体缺失：${id}。`)
    for (const key of plan.keys) if (!states.has(aggregateChunkAddress(key))) throw new Error('实际区块缺失，不能当作空白。')
    const pending = new Map<string, T>()
    for (const key of plan.keys) states.set(aggregateChunkAddress(key), { key, state: 'loading' })
    try {
      for (const id of plan.entityIds) if (!values.has(id)) pending.set(id, derive(id))
      for (const [id, value] of pending) values.set(id, value)
      // A cell may hold other derived entries not requested by this plan.
      // Mark it resident only after every listed entity has materialized.
      for (const key of plan.keys) {
        const chunk = manifest.chunks.find(chunk => aggregateChunkAddress(chunk.key) === aggregateChunkAddress(key))!
        states.set(aggregateChunkAddress(key), { key, state: chunk.entityIds.every(id => values.has(id)) ? 'resident' : 'unloaded' })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      for (const key of plan.keys) states.set(aggregateChunkAddress(key), { key, state: 'failed', reason })
      throw new Error(`区块派生失败：${reason}`)
    }
  }
  return {
    ensure,
    materialize(id: string): T {
      if (!values.has(id)) ensure(planAggregateChunks(manifest, { selectedIds: [id] }))
      return values.get(id)!
    },
    residency(): AggregateChunkResidency[] { return [...states.values()].map(state => ({ ...state, key: { ...state.key } })) },
    /** Eviction never unloads source JSON, dirty edits or resource bytes. */
    clear(): void { values.clear(); for (const chunk of manifest.chunks) states.set(aggregateChunkAddress(chunk.key), { key: chunk.key, state: 'unloaded' }) },
  }
}

/** Retain non-sprite images and visible sprites. Images used exclusively by
 * omitted props/decorations avoid this render's bitmap decode.
 * All projected resource records and bytes are still verified by the renderer.
 * Formal PNG output continues to decode the complete projected asset closure.
 */
export function editorResidentAssetIds(projection: Projection, plan: EditorRenderPlan): ReadonlySet<string> {
  const closure = projectionAssetConsumers(projection)
  if (!closure.complete) return new Set(projection.assetIds)
  const required = new Set(closure.consumers.flatMap(consumer => consumer.kind === 'always' ? [...consumer.assetIds] : []))
  // Paint envelopes are the actual retained consumers. The complete registered
  // closure above proves that omitted sprites have no other unknown consumer.
  for (const envelope of plan.presentations) {
    if (envelope.audience !== projection.audience) throw new Error('表现资源与当前受众不一致。')
    for (const id of envelope.assetIds) required.add(id)
  }
  return required
}
