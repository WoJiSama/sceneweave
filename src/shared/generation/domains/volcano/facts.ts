import type { SceneDocument } from '../../../model/scene.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { hashGenerationValue, type ArtifactInput } from '../../contracts.js'
import { supportedPolygon } from '../../../geometry/geometry.js'
import type { BoundsMm, PointMm } from '../../../model/scene.js'
const boundsPolygon = (bounds: BoundsMm): PointMm[] => [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]

/** Exact saved-recipe replay knowledge belongs to this domain adapter. */
export function volcanoSpaceFacts(scene: SceneDocument, key: (kind: string, id: string) => string): ArtifactInput[] {
  const facts: ArtifactInput[] = [], add = (input: ArtifactInput) => { facts.push(input) }
  // Volcano recipes expose their saved ground entrance without inferring a
  // port from texture, bounds or seed alone.
  for (const recipe of Object.values(getLegacyGeneration(scene)?.recipes ?? {})) if ('domain' in recipe && recipe.domain === 'volcano') {
    const identity = (name: string) => `volcano-${hashGenerationValue([scene.sceneId, recipe.seed, name]).slice(0, 32)}`
    const port = getLegacyGeneration(scene)!.constraints[identity('entrance')], surface = scene.terrainAreas[identity('ground')]
    if (port?.kind !== 'port' || !surface || surface.floorId !== port.floorId) continue
    const r = Math.ceil(port.widthMm / 2), e = port.positionMm
    // Soft reservations may outlive manual geometry edits. Publish only an
    // entrance whose complete width still has its exact current support.
    if (!supportedPolygon(scene, boundsPolygon({ x: e.x - r, y: e.y - r, width: r * 2, height: r * 2 }), { kind: 'terrainArea', id: surface.id }, port.floorId)) continue
    add({ kind: 'port', id: key('port', port.id), owner: 'connectivity', payload: {
      coordinateFrame: 'scene-mm', floorId: port.floorId, visibility: port.visibility, positionMm: port.positionMm, directionDeg: port.directionDeg,
      widthMm: port.widthMm, elevationMm: surface.groundElevationMm, supportRef: { kind: 'terrainArea', id: surface.id }, role: 'entrance',
    } })
  }
  return facts
}
