import type { SceneDocument } from '../model/scene.js'


export const STRUCTURE_COLLECTIONS = {
  vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', note: 'notes',
} as const
export type StructureKind = keyof typeof STRUCTURE_COLLECTIONS

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined

/** Topology is deliberately stricter than the fields restored by C2. */
export function structureTopology(scene: SceneDocument): Map<string, string> {
  const result = new Map<string, string>()
  for (const [kind, collection] of Object.entries(STRUCTURE_COLLECTIONS)) for (const entity of Object.values(scene[collection])) {
    const topology = kind === 'wall' ? (() => { const wall = scene.walls[entity.id]; return [wall.startVertexId, wall.endVertexId] })()
      : kind === 'room' ? (() => { const room = scene.rooms[entity.id]; return [room.boundaryVertexIds, room.supportRef] })()
      : kind === 'opening' ? (() => { const opening = scene.openings[entity.id]; return [opening.wallId, opening.offsetReferenceVertexId] })()
      : kind === 'note' ? (() => { const anchor = scene.notes[entity.id].anchor; return anchor.type === 'entity' ? anchor : { type: 'point' } })()
      : null
    result.set(entity.id, canonical([kind, entity.floorId, topology]))
  }
  return result
}

/** Opaque runtime evidence: JSON, Object.freeze and a matching ID cannot mint it. */
export interface StructureContinuity { readonly snapshotId: string }
interface Evidence {
  current: string
  historic: string
  continuousIds: Set<string>
  active: () => boolean
}
const evidence = new WeakMap<StructureContinuity, Evidence>()

export function assertStructureContinuity(proof: StructureContinuity, current: SceneDocument, historic: SceneDocument, ids: readonly string[]): void {
  const known = proof && typeof proof === 'object' ? evidence.get(proof) : undefined
  if (!known || !known.active() || known.current !== canonical(current) || known.historic !== canonical(historic)) {
    throw new Error('缺少本会话可验证的结构连续性证据；重开、导入或切换工程后不能恢复旧结构，请在本会话重新建立命名快照。')
  }
  const invalid = ids.filter(id => !known.continuousIds.has(id))
  if (invalid.length) throw new Error(`结构在快照后曾删除、重建或改变拓扑，不能按同 ID 恢复：${invalid.join('、')}。`)
}

interface CapturedStructure {
  sceneId: string
  contentHash: string
  document: string
  versions: Map<string, number>
  topology: Map<string, string>
}

/** Session-only witness. It is never serialized into the complete project. */
export class StructureContinuitySession {
  private current: SceneDocument | null = null
  private versions = new Map<string, number>()
  private topology = new Map<string, string>()
  private snapshots = new Map<string, CapturedStructure>()
  private epoch = 0

  reset(document: SceneDocument): void {
    this.current = document
    this.topology = structureTopology(document)
    this.versions = new Map([...this.topology.keys()].map(id => [id, 0]))
    this.snapshots.clear()
    this.epoch++
  }

  /** Includes explicit destructive intent even if a batch returns equal final JSON. */
  advance(previous: SceneDocument, next: SceneDocument, invalidatedIds: readonly string[] = []): void {
    if (this.current !== previous) throw new Error('结构连续性基线已变化。')
    const topology = structureTopology(next), invalid = new Set(invalidatedIds)
    for (const id of new Set([...this.topology.keys(), ...topology.keys()])) {
      if (this.topology.get(id) !== topology.get(id) || invalid.has(id)) this.versions.set(id, (this.versions.get(id) ?? 0) + 1)
    }
    this.topology = topology
    this.current = next
    this.epoch++
  }

  recordSnapshot(snapshotId: string, contentHash: string, document: SceneDocument): void {
    if (document !== this.current) throw new Error('命名快照的结构连续性基线已变化。')
    this.snapshots.set(snapshotId, { sceneId: document.sceneId, contentHash, document: canonical(document),
      versions: new Map(this.versions), topology: new Map(this.topology) })
  }

  prove(snapshotId: string, contentHash: string, current: SceneDocument, historic: SceneDocument): StructureContinuity {
    const source = this.snapshots.get(snapshotId)
    if (!source || this.current !== current || source.sceneId !== current.sceneId || source.contentHash !== contentHash || source.document !== canonical(historic)) {
      throw new Error('此快照缺少本会话的结构连续性记录；重开、导入或切换工程后不能恢复旧结构，请在本会话重新建立命名快照。')
    }
    const continuousIds = new Set([...source.topology.keys()].filter(id => this.topology.has(id)
      && source.versions.get(id) === this.versions.get(id) && source.topology.get(id) === this.topology.get(id)))
    const epoch = this.epoch, proof = Object.freeze({ snapshotId })
    evidence.set(proof, { current: canonical(current), historic: source.document, continuousIds,
      active: () => this.current === current && this.epoch === epoch })
    return proof
  }
}

export function structureKind(scene: SceneDocument, id: string): StructureKind | null {
  for (const [kind, collection] of Object.entries(STRUCTURE_COLLECTIONS)) if (own(scene[collection] as Record<string, unknown>, id)) return kind as StructureKind
  return null
}
