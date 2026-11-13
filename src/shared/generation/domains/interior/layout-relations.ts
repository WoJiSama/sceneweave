import type { InteriorGenerationInput, InteriorRectangle, InteriorRoomRequirement } from './contracts.js'
import { sharedWallLength } from './layout.js'

export interface InteriorPartitionGroup { rooms: readonly InteriorRoomRequirement[]; bounds: InteriorRectangle }

/** A required contact cannot exceed the boundary shared by its current parent
 * groups. This rejects only provably impossible partial partitions; every full
 * arrangement still reaches the caller's metered independent layout check. */
export function partialInteriorRelationsPossible(groups: readonly InteriorPartitionGroup[], relations: InteriorGenerationInput['parameters']['relations'],
  checkCancelled: () => void, charge: () => void): boolean {
  // Complete geometric candidates belong to the existing four-attempt gate.
  if (groups.every(group => group.rooms.length === 1)) return true
  for (const relation of relations) {
    checkCancelled(); charge()
    const a = groups.find(group => group.rooms.some(room => room.id === relation.a))
    const b = groups.find(group => group.rooms.some(room => room.id === relation.b))
    if (!a || !b || relation.kind === 'no-direct-connection') continue
    if (a === b) {
      // Two rooms must share a cut when they tile their sole parent rectangle.
      if (relation.kind === 'separate' && a.rooms.length === 2) return false
      continue
    }
    const shared = sharedWallLength(a.bounds, b.bounds)
    if (relation.kind === 'adjacent' && shared < Math.max(1, relation.minimumSharedWallMm)) return false
    if (relation.kind === 'separate' && a.rooms.length === 1 && b.rooms.length === 1 && shared > 0) return false
  }
  return true
}
