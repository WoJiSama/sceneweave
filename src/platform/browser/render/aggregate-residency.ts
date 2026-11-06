import type { AggregateChunkManifest, AggregateChunkLoadPlan } from '../../../shared/aggregates/chunks.js'
import { aggregateChunkAddress, planAggregateChunks } from '../../../shared/aggregates/chunks.js'
import type { AggregateChunkResidency } from '../../../shared/model/aggregate.js'
import type { Projection } from '../../../shared/projection/types.js'
import type { EditorRenderPlan } from './editor-render-plan.js'

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

/** Retain every non-prop image and every visible prop image. Only images used
 * exclusively by omitted editor props avoid this render's bitmap decode.
 * All projected resource records and bytes are still verified by the renderer.
 * Formal PNG output continues to decode the complete projected asset closure.
 */
export function editorResidentAssetIds(projection: Projection, plan: EditorRenderPlan): ReadonlySet<string> {
  const required = new Set<string>()
  const styles = [...projection.rooms.map(value => value.style), ...projection.terrain.map(value => value.style), ...projection.walls.map(value => value.style),
    ...projection.edges.map(value => value.surfaceStyle), ...projection.paths.map(value => value.style), ...projection.connections.map(value => value.style)]
  const paints = styles.flatMap(style => style ? [style.base, ...style.overlays.map(overlay => overlay.paint)] : [])
    .concat(projection.terrain.flatMap(value => (value.materialPatches ?? []).map(patch => patch.paint)))
  for (const paint of paints) {
    const material = projection.materials[paint.materialRef.id]
    if (!material || material.version !== paint.materialRef.version) throw new Error('区块绘制所需材质缺失或版本不符。')
    required.add(material.textureAssetId)
  }
  for (const value of plan.props) if (value.prop.appearance.kind === 'image') required.add(value.prop.appearance.assetId)
  for (const value of projection.decorations ?? []) required.add(value.assetId)
  for (const value of [...(projection.regional?.landmarks ?? []), ...(projection.regional?.symbols ?? [])]) required.add(value.assetId)
  // Unknown future consumers conservatively retain their assets.
  const propImages = new Set(projection.props.flatMap(prop => prop.appearance.kind === 'image' ? [prop.appearance.assetId] : []))
  for (const id of projection.assetIds) if (!propImages.has(id)) required.add(id)
  return required
}
