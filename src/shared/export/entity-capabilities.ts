import { collectionFor, type Opening, type Prop, type SceneDocument, type Wall } from '../model/scene.js'
import type { Projection } from '../projection/types.js'

type EntityKind = keyof typeof collectionFor
interface EntityDeliveryCapability {
  readonly privacy: 'dependency-filtered'
  readonly png: 'paint' | 'through-members' | 'anchor-only'
  readonly uvtt: 'native-wall' | 'native-opening' | 'physical-footprint' | 'baked' | 'omitted' | 'through-members'
  readonly movement: 'native-conservative' | 'unmapped' | 'none'
  readonly unmappedBlocker: 'none' | 'movement' | 'movement-or-sight' | 'movement-or-sight-or-cliff'
}
/** Adding a native entity requires an explicit output/privacy decision. These
 * declarations certify no input and do not replace UVTT safety checks or target
 * import acceptance. Dependency filtering remains owned by the projection. */
export const entityDeliveryCapabilities = {
  vertex: { privacy: 'dependency-filtered', png: 'anchor-only', uvtt: 'through-members', movement: 'none', unmappedBlocker: 'none' },
  room: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'baked', movement: 'none', unmappedBlocker: 'none' },
  wall: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'native-wall', movement: 'native-conservative', unmappedBlocker: 'none' },
  opening: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'native-opening', movement: 'native-conservative', unmappedBlocker: 'none' },
  prop: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'physical-footprint', movement: 'native-conservative', unmappedBlocker: 'none' },
  region: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'omitted', movement: 'unmapped', unmappedBlocker: 'movement' },
  note: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'omitted', movement: 'none', unmappedBlocker: 'none' },
  terrainArea: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'baked', movement: 'unmapped', unmappedBlocker: 'movement-or-sight' },
  terrainEdge: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'baked', movement: 'unmapped', unmappedBlocker: 'movement-or-sight-or-cliff' },
  terrainConnection: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'baked', movement: 'unmapped', unmappedBlocker: 'movement' },
  path: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'baked', movement: 'unmapped', unmappedBlocker: 'none' },
  prefabInstance: { privacy: 'dependency-filtered', png: 'through-members', uvtt: 'through-members', movement: 'none', unmappedBlocker: 'none' },
  scatterGroup: { privacy: 'dependency-filtered', png: 'through-members', uvtt: 'through-members', movement: 'none', unmappedBlocker: 'none' },
  decoration: { privacy: 'dependency-filtered', png: 'paint', uvtt: 'baked', movement: 'none', unmappedBlocker: 'none' },
  decorationCluster: { privacy: 'dependency-filtered', png: 'through-members', uvtt: 'through-members', movement: 'none', unmappedBlocker: 'none' },
  surfaceRule: { privacy: 'dependency-filtered', png: 'through-members', uvtt: 'through-members', movement: 'none', unmappedBlocker: 'none' },
} as const satisfies Record<EntityKind, EntityDeliveryCapability>

export function unmappedUvttBlockers(scene: SceneDocument): number {
  let count = 0
  for (const kind of Object.keys(entityDeliveryCapabilities) as EntityKind[]) {
    const policy = entityDeliveryCapabilities[kind].unmappedBlocker
    if (policy === 'none') continue
    for (const value of Object.values(scene[collectionFor[kind]] ?? {})) {
      const movement = 'blocksMovement' in value && value.blocksMovement
      const sight = policy !== 'movement' && 'blocksSight' in value && value.blocksSight
      const cliff = policy === 'movement-or-sight-or-cliff' && 'kind' in value && value.kind === 'cliff'
      if (movement || sight || cliff) count++
    }
  }
  return count
}

/** Dispatch decisions only. The export owner must first validate the complete
 * source and build its player projection; this function grants no privacy or
 * resource proof. A new native mapping must supply its actual adapter here. */
export function collectUvttNativeEntities(scene: SceneDocument, projection: Projection): { walls: Wall[]; openings: Opening[]; props: Prop[] } {
  if (projection.audience !== 'player') throw new Error('UVTT结构映射需要玩家投影。')
  const result: { walls: Wall[]; openings: Opening[]; props: Prop[] } = { walls: [], openings: [], props: [] }
  for (const kind of Object.keys(entityDeliveryCapabilities) as EntityKind[]) {
    const route = entityDeliveryCapabilities[kind].uvtt
    switch (route) {
      case 'native-wall':
        if (kind !== 'wall') throw new Error('实体尚未实现UVTT原生墙适配。')
        result.walls.push(...Object.values(scene.walls)); break
      case 'native-opening':
        if (kind !== 'opening') throw new Error('实体尚未实现UVTT原生开口适配。')
        result.openings.push(...Object.values(scene.openings)); break
      case 'physical-footprint':
        if (kind !== 'prop') throw new Error('实体尚未实现UVTT物理占地适配。')
        result.props.push(...projection.props); break
      case 'baked': case 'omitted': case 'through-members': break
      default: {
        const unsupported: never = route
        throw new Error(`未支持的UVTT实体映射：${unsupported}`)
      }
    }
  }
  return result
}
