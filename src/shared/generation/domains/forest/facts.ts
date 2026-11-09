import type { SceneDocument } from '../../../model/scene.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { hashGenerationValue, type ArtifactInput } from '../../contracts.js'

/** Exact saved-recipe replay knowledge belongs to this domain adapter. */
export function forestSpaceFacts(scene: SceneDocument, key: (kind: string, id: string) => string): ArtifactInput[] {
  const facts: ArtifactInput[] = [], add = (input: ArtifactInput) => { facts.push(input) }
  // Forest entrances bind a saved explicit port to a saved explicit surface.
  // Old untyped natural port records retain their existing fact projection.
  const generation = getLegacyGeneration(scene)
  for (const recipe of Object.values(generation?.recipes ?? {})) if ('domain' in recipe && recipe.domain === 'forest') {
    const identity = (name: string) => `forest-${hashGenerationValue([scene.sceneId, recipe.seed, name]).slice(0, 32)}`
    for (const entrance of recipe.parameters.entrances) {
      const port = generation!.constraints[identity(`entrance:${entrance.id}`)]
      const supportRef = { kind: 'terrainArea' as const, id: entrance.supportRef.kind === 'generated-ground' ? identity('ground') : entrance.supportRef.id }
      const surface = scene.terrainAreas[supportRef.id]
      if (!port || port.kind !== 'port' || !surface || surface.floorId !== port.floorId) continue
      add({ kind: 'port', id: key('port', port.id), owner: 'connectivity', payload: { coordinateFrame: 'scene-mm', floorId: port.floorId, visibility: port.visibility,
        positionMm: port.positionMm, directionDeg: port.directionDeg, widthMm: port.widthMm, elevationMm: surface.groundElevationMm, supportRef, role: 'entrance' } })
    }
  }
  return facts
}
