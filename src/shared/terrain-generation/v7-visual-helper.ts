import type { PointMm, SceneDocument } from '../model/scene.js'
import { getLegacyGeneration } from './composition-contracts.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { visualBase } from '../visual/base.js'
import { connectionFootprint } from '../geometry/geometry.js'
import { geometryIdentityIds } from '../commands/domain.js'

/** The v7 visual pass is deliberately separate from the v6 generator. It only
 * changes persisted edge-look presentation; physical terrain, connections and
 * their support contracts remain byte-for-byte identical. */
export const TERRAIN_VISUAL_V7_PRESET = 'terrain-visual-v7@1' as const

export function isTerrainVisualV7Applicable(scene: SceneDocument): boolean {
  const generation = getLegacyGeneration(scene)
  return Object.values(generation?.rules ?? {}).some(rule => {
    const recipe = generation?.recipes[rule.recipeRef.id]
    return rule.kind === 'terrain' && rule.state === 'active' && rule.visibility === 'public'
      && rule.recipeRef.version === 7 && recipe?.algorithmId === 'terrain-scene'
      && recipe.algorithmVersion === 7 && recipe.recipeVersion === 7
      && !('domain' in recipe) && recipe.parameters.terrainKind === 'island'
  })
}
function sameBand(first: PointMm[], second: PointMm[]): boolean {
  if (first.length !== second.length) return false
  return [second, [...second].reverse()].some(candidate => first.some((_point, offset) =>
    first.every((value, index) => value.x === candidate[(index + offset) % candidate.length].x && value.y === candidate[(index + offset) % candidate.length].y)))
}

function routeSegmentId(scene: SceneDocument, connectionId: string): string {
  const reserved = geometryIdentityIds(scene)
  for (const id of Object.keys(scene.userLayers)) reserved.add(id)
  const base = `${connectionId}-terrain-route-v7`
  let id = base, suffix = 1
  while (reserved.has(id)) id = `${base}-${suffix++}`
  return id
}

/**
 * Apply the v7 target-island visual closure without changing physical meaning.
 *
 * The result narrows cliff paint, softens the highland grass edge, and gives a
 * straight stair a natural-rock visual route. That route uses the same two
 * endpoints and width, and is accepted only when its derived band is exactly
 * equal to the existing rectangular corridor.
 */
export function refineTerrainVisualV7(scene: SceneDocument): SceneDocument {
  if (!isTerrainVisualV7Applicable(scene)) throw new Error('地形视觉v7只接受已完成的普通算法7岩岛结果。')
  const result = cloneJson(scene), visual = visualBase(result)
  if (!visual) throw new Error('地形视觉v7结果缺少可编辑视觉系统。')
  for (const look of Object.values(visual.edgeLooks)) {
    if (look.kind === 'cliff') {
      // Keep the saved boundary and its side; only reduce the painted face.
      look.widthMm = Math.max(420, Math.min(560, Math.round(look.widthMm * .72)))
      look.opacity = Math.max(.5, Math.min(1, look.opacity * .9))
    } else if (look.kind === 'grass' && look.boundaryId.includes('terrain-high')) {
      look.widthMm = Math.max(520, Math.min(700, Math.round(look.widthMm * 1.35)))
      look.opacity = Math.max(.45, Math.min(1, look.opacity * .82))
    }
  }
  for (const connection of Object.values(result.terrainConnections)) if (connection.kind === 'stairs' && !connection.route) {
    const from = connection.from.positionMm, to = connection.to.positionMm
    const before = connectionFootprint(connection)
    const route = { version: 1 as const, kind: 'polyline' as const,
      segments: [{ id: routeSegmentId(result, connection.id), start: cloneJson(from), control1: cloneJson(from), control2: cloneJson(to), end: cloneJson(to) }],
      sampleSpacingMm: 20_000, toleranceMm: 20, centerlineMm: [cloneJson(from), cloneJson(to)], stairStyle: 'naturalRock' as const, treadDepthMm: 420 }
    const candidate = { ...connection, route }
    if (!sameBand(connectionFootprint(candidate), before)) throw new Error('地形视觉v7自然岩阶必须保持真实净宽带完全不变。')
    connection.route = route
  }
  return result
}

/** Physical fields used by the helper's regression tests and callers. */
export function terrainVisualPhysicalFingerprint(scene: SceneDocument): string {
  return canonicalJson({
    exportBoundsMm: scene.exportBoundsMm, floors: scene.floors, terrainAreas: scene.terrainAreas,
    terrainEdges: scene.terrainEdges, terrainConnections: Object.fromEntries(Object.entries(scene.terrainConnections).map(([id, connection]) => [id, {
      id: connection.id, floorId: connection.floorId, from: connection.from, to: connection.to, widthMm: connection.widthMm,
      openingId: connection.openingId, kind: connection.kind, blocksMovement: connection.blocksMovement, movementCostMultiplier: connection.movementCostMultiplier,
    }])),
    paths: scene.paths ?? {}, props: scene.props ?? {}, regions: scene.regions ?? {},
  })
}
