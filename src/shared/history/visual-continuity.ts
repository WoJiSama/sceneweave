import type { SceneDocument } from '../model/scene.js'
import { VISUAL_ENTITY_COLLECTIONS } from '../visual/diagnostics.js'
import type { VisualBoundary } from '../visual/types.js'

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

/** Parameter changes are restorable; bindings, control identities and explicit scopes are not. */
export function visualTopology(scene: SceneDocument): Map<string, string> {
  const result = new Map<string, string>()
  if (!scene.visual) return result
  result.set(scene.sceneId, canonical(['environment', scene.sceneId]))
  for (const collection of VISUAL_ENTITY_COLLECTIONS) for (const item of Object.values(scene.visual[collection])) {
    const topology = 'segments' in item ? [item.closed, item.binding, (item as VisualBoundary).segments.map(segment => segment.id)]
      : 'boundaryId' in item ? item.boundaryId
      : 'target' in item ? item.target.kind === 'entities' ? ['entities', [...item.target.ids].sort()]
        : item.target.kind === 'layer' ? ['layer', item.target.layerId] : item.target.kind
      : null
    result.set(item.id, canonical([collection, item.floorId, topology]))
  }
  return result
}

/** Opaque session evidence. It cannot be minted from JSON or a matching ID. */
export interface VisualContinuity { readonly snapshotId: string }
interface Evidence { current: string; historic: string; continuousIds: Set<string>; active: () => boolean }
const evidence = new WeakMap<VisualContinuity, Evidence>()
export function assertVisualContinuity(proof: VisualContinuity, current: SceneDocument, historic: SceneDocument, ids: readonly string[]): void {
  const known = proof && typeof proof === 'object' ? evidence.get(proof) : undefined
  if (!known || !known.active() || known.current !== canonical(current) || known.historic !== canonical(historic)) {
    throw new Error('缺少本会话可验证的视觉连续性证据；重开、导入或切换工程后，请重新建立命名快照。')
  }
  const invalid = ids.filter(id => !known.continuousIds.has(id))
  if (invalid.length) throw new Error(`视觉对象在快照后曾删除、重建或改变绑定/控制拓扑，不能按同 ID 恢复：${invalid.join('、')}。`)
}
interface CapturedVisual {
  sceneId: string; contentHash: string; document: string; versions: Map<string, number>; topology: Map<string, string>
}
/** Never serialized. Workspace must observe destructive intermediate steps or explicit invalidations. */
export class VisualContinuitySession {
  private current: SceneDocument | null = null
  private versions = new Map<string, number>()
  private topology = new Map<string, string>()
  private snapshots = new Map<string, CapturedVisual>()
  private epoch = 0

  reset(document: SceneDocument): void {
    this.current = document; this.topology = visualTopology(document)
    this.versions = new Map([...this.topology.keys()].map(id => [id, 0]))
    this.snapshots.clear(); this.epoch++
  }

  advance(previous: SceneDocument, next: SceneDocument, invalidatedIds: readonly string[] = []): void {
    if (this.current !== previous || previous.sceneId !== next.sceneId) throw new Error('视觉连续性基线已变化。')
    const topology = visualTopology(next), invalid = new Set(invalidatedIds)
    for (const id of new Set([...this.topology.keys(), ...topology.keys()])) {
      if (this.topology.get(id) !== topology.get(id) || invalid.has(id)) this.versions.set(id, (this.versions.get(id) ?? 0) + 1)
    }
    this.current = next; this.topology = topology; this.epoch++
  }

  recordSnapshot(snapshotId: string, contentHash: string, document: SceneDocument): void {
    if (this.current !== document) throw new Error('命名快照的视觉连续性基线已变化。')
    this.snapshots.set(snapshotId, { sceneId: document.sceneId, contentHash, document: canonical(document), versions: new Map(this.versions), topology: new Map(this.topology) })
  }

  prove(snapshotId: string, contentHash: string, current: SceneDocument, historic: SceneDocument): VisualContinuity {
    const source = this.snapshots.get(snapshotId)
    if (!source || this.current !== current || source.sceneId !== current.sceneId || source.contentHash !== contentHash || source.document !== canonical(historic)) {
      throw new Error('此快照缺少本会话的视觉连续性记录；重开、导入或切换工程后，请重新建立命名快照。')
    }
    const continuousIds = new Set([...source.topology.keys()].filter(id => this.topology.has(id)
      && source.versions.get(id) === this.versions.get(id) && source.topology.get(id) === this.topology.get(id)))
    const epoch = this.epoch, proof = Object.freeze({ snapshotId })
    evidence.set(proof, { current: canonical(current), historic: source.document, continuousIds, active: () => this.current === current && this.epoch === epoch })
    return proof
  }
}
