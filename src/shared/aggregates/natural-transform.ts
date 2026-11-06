import { z } from 'zod'
import { effectiveEditLocked } from '../commands/layers.js'
import { outdoorDependencies } from '../commands/outdoor.js'
import { pathPolygon, polygonsOverlap, terrainPoints } from '../geometry/geometry.js'
import type { AggregateFrame } from '../model/aggregate.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { getLegacyGeneration, getLegacyVisual } from '../terrain-generation/composition-contracts.js'
import { materializedBoundaryHash } from '../terrain-generation/integrity.js'
import { captureJson } from '../validation/json.js'
import { id, point } from '../validation/primitives.js'
import { visualBase } from '../visual/base.js'
import { refreshScene5TransitionsAfterPhysicalEdit } from '../visual/derived-transitions.js'
import { assertAggregateBuildingClearance } from './building-clearance.js'
import { composeAggregateFrames, localToWorldBounds, localToWorldPoint, reparentAggregateFrame } from './coordinates.js'
import { inspectAggregateDomain } from './domain-adapters.js'
import { decodeSceneCoordinates, encodeSceneCoordinates } from './scene-coordinates.js'
import { aggregateWorldFrames, WORLD_FRAME } from './state.js'
export { naturalTransformSurfaceIds } from './domain-adapters.js'

export const naturalAggregateCommandSchema = z.object({ type: z.literal('transformAggregateNatural'), id, offsetMm: point, pivotMm: point,
  quarterTurns: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
}).strict()
export type NaturalAggregateCommand = z.infer<typeof naturalAggregateCommandSchema>
export const isNaturalAggregateCommand = (command: { type: string }): command is NaturalAggregateCommand => command.type === 'transformAggregateNatural'

/** A world rigid transform around a named pivot. BigInt composition retains
 * exact integer coordinates and refuses overflow before any candidate write. */
function transformFrame(command: NaturalAggregateCommand): AggregateFrame {
  const rotation: AggregateFrame = { translationMm: { x: 0, y: 0 }, quarterTurns: command.quarterTurns }
  const rotatedPivot = localToWorldPoint(rotation, command.pivotMm)
  const safe = (value: bigint) => {
    const result = Number(value)
    if (!Number.isSafeInteger(result) || BigInt(result) !== value) throw new Error('自然组变换超出安全整数毫米范围。')
    return result
  }
  return { translationMm: { x: safe(BigInt(command.pivotMm.x) + BigInt(command.offsetMm.x) - BigInt(rotatedPivot.x)),
    y: safe(BigInt(command.pivotMm.y) + BigInt(command.offsetMm.y) - BigInt(rotatedPivot.y)) }, quarterTurns: command.quarterTurns }
}

/** Detached command operation. The caller retains complete scene/domain,
 * identity/appearance/resources, lifecycle, budget and final CAS validation.
 * No scene certificate or retained internal-geometry proof is issued here. */
export function applyNaturalAggregateCommand(scene: SceneDocument, input: NaturalAggregateCommand,
  options: { fixedUprightIds?: ReadonlySet<string> } = {}): { commandCost: number; affectedIds: string[] } {
  const command = naturalAggregateCommandSchema.parse(captureJson(input)), scope = inspectAggregateDomain(scene, command.id, 'natural')
  const state = scene.aggregateCoordinates!, groupIds = new Set(scope.groupIds)
  let parentId = state.groups[command.id].parentId
  while (parentId !== null) { groupIds.add(parentId); parentId = state.groups[parentId].parentId }
  if ([...groupIds].some(id => state.groups[id].editLocked)) throw new Error('自然组、子组或祖先组已锁定。')
  if (command.quarterTurns === 0 && command.offsetMm.x === 0 && command.offsetMm.y === 0) return { commandCost: 0, affectedIds: [] }
  if (scope.readDependencies.some(ref => ref.kind !== 'floor')) throw new Error('自然组仍引用未随动的地形、房间或附着对象；请显式合并完整支撑范围。')
  const affected = new Set([...scope.members.map(ref => ref.id), ...scope.readDependencies.map(ref => ref.id)])
  for (const id of affected) if (effectiveEditLocked(scene, id)) throw new Error(`自然组涉及锁定成员、图层或外部依赖：${id}。`)
  const owned = new Set(scope.members.map(ref => ref.id)), originalVisual = visualBase(scene)!
  const boundaryIds = new Set(Object.values(originalVisual.boundaries).filter(boundary =>
    boundary.binding.kind === 'path' && owned.has(boundary.binding.pathId)
    || boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => owned.has(side.areaId))).map(row => row.id))
  for (const id of boundaryIds) {
    const boundary = originalVisual.boundaries[id]
    if (boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => !owned.has(side.areaId))) {
      throw new Error(`自然组曲线 ${id} 跨越未选地形面，不能半移共享来源。`)
    }
  }
  const visualRows = [...Object.values(originalVisual.boundaries).filter(row => boundaryIds.has(row.id)),
    ...Object.values(originalVisual.edgeLooks).filter(row => boundaryIds.has(row.boundaryId)),
    ...Object.values(getLegacyVisual(scene)?.materializedEdges ?? {}).filter(row => boundaryIds.has(row.boundaryId)),
    ...Object.values(scene.visual.transitions).filter(row => boundaryIds.has(row.boundaryId))]
  for (const row of visualRows) {
    affected.add(row.id)
    if (row.editLocked || scene.userLayers[row.layerId]?.editLocked) throw new Error(`自然组视觉来源、派生结果或图层已锁定：${row.id}。`)
  }
  const frame = transformFrame(command), point = (value: PointMm) => ({ ...localToWorldPoint(frame, value) })
  // This is the sole persisted coordinate representation, not a seed replay or
  // a second geometry copy. Descendant local frames and manual member records
  // retain their exact values while the root's world frame changes.
  const local = encodeSceneCoordinates(scene), localState = local.aggregateCoordinates!, root = localState.groups[command.id]
  const frames = aggregateWorldFrames(state), world = composeAggregateFrames(frame, scope.frame)
  root.frame = reparentAggregateFrame(world, root.parentId === null ? WORLD_FRAME : frames.get(root.parentId)!)
  const next = decodeSceneCoordinates(local), nextVisual = visualBase(next)!, legacy = getLegacyVisual(next)
  const generation = getLegacyGeneration(scene)!, nextGeneration = getLegacyGeneration(next)!
  const owners = Object.values(generation.ownership), recipeIds = new Set(owners.filter(owner => owner.target.kind === 'terrainArea' && owned.has(owner.target.entityId))
    .flatMap(owner => generation.rules[owner.ruleId]?.recipeRef.id ?? []))
  for (const exclusion of Object.values(generation.exclusions)) {
    const owner = owners.find(owner => owner.outputKey === exclusion.key || owner.outputKey === exclusion.candidateKey
      || exclusion.birthToken !== null && owner.birthToken === exclusion.birthToken)
    if (owner && recipeIds.has(generation.rules[owner.ruleId]?.recipeRef.id ?? '')) {
      // An unpartitioned source exclusion can only move with the complete
      // terrain output set of that exact recipe, including deleted members.
      const recipeId = generation.rules[owner.ruleId].recipeRef.id
      if (owners.some(row => row.target.kind === 'terrainArea' && generation.rules[row.ruleId]?.recipeRef.id === recipeId
        && Object.hasOwn(scene.terrainAreas, row.target.entityId) && !owned.has(row.target.entityId))) {
        throw new Error('自然组的生成排除记录仍跨未选地形；请显式选择完整来源范围。')
      }
      nextGeneration.exclusions[exclusion.id].boundaryMm = exclusion.boundaryMm.map(point)
      affected.add(exclusion.id)
    } else if (scope.members.some(ref => ref.kind === 'terrainArea' && scene.terrainAreas[ref.id].floorId === exclusion.floorId
      && polygonsOverlap(terrainPoints(scene.terrainAreas[ref.id]), exclusion.boundaryMm))) {
      throw new Error(`自然组遇到没有确切随动归属的世界排除区：${exclusion.id}；请先明确处理其来源。`)
    }
  }
  for (const ref of scope.members) if (options.fixedUprightIds?.has(ref.id)) {
    if (ref.kind === 'prop') next.props[ref.id].rotationDeg = scene.props[ref.id].rotationDeg
    if (ref.kind === 'decoration') next.decorations[ref.id].rotationDeg = scene.decorations[ref.id].rotationDeg
  }
  for (const id of boundaryIds) {
    for (const segment of nextVisual.boundaries[id].segments) for (const key of ['start', 'control1', 'control2', 'end'] as const) segment[key] = point(segment[key])
    for (const edge of Object.values(legacy?.materializedEdges ?? {})) if (edge.boundaryId === id) {
      if (edge.inputHash !== materializedBoundaryHash(originalVisual.boundaries[id])) throw new Error(`自然组物化边缘来源已过期：${edge.id}。`)
      edge.polygons = edge.polygons.map(ring => ring.map(point))
      edge.strokes = edge.strokes.map(stroke => ({ ...stroke, pointsMm: stroke.pointsMm.map(point) }))
      edge.inputHash = materializedBoundaryHash(nextVisual.boundaries[id])
    }
    for (const transition of Object.values(next.visual.transitions)) if (transition.boundaryId === id) {
      transition.distanceSource.clipMm = { ...localToWorldBounds(frame, transition.distanceSource.clipMm) }
    }
  }
  // Recompute actual masks/source hashes through the existing transition owner.
  // An external locked transition affected by the new physical masks also
  // refuses the entire detached operation.
  const derived = refreshScene5TransitionsAfterPhysicalEdit(scene, next)
  // Moving a surface can affect external Floor-supported content even when
  // no transition exists. Both the old and new physical neighborhoods remain
  // read dependencies; discovering them never expands movable ownership.
  const physicalRoots = [...scope.members.map(ref => ref.id), ...derived.affectedIds]
  for (const id of [...outdoorDependencies(scene, physicalRoots), ...outdoorDependencies(next, physicalRoots)]) {
    affected.add(id)
    if (effectiveEditLocked(scene, id)) throw new Error(`自然组物理变化涉及锁定依赖：${id}。`)
  }
  assertAggregateBuildingClearance(next, scope.members)
  const movedBlockingRegions = scope.members.filter(ref => ref.kind === 'region').map(ref => next.regions[ref.id]).filter(region => region.blocksMovement)
  for (const path of Object.values(next.paths).filter(path => !owned.has(path.id))) for (const region of movedBlockingRegions) {
    if (path.floorId === region.floorId && polygonsOverlap(pathPolygon(path), region.boundaryMm)) throw new Error(`自然组区域 ${region.id} 与外部路线 ${path.id} 的完整净宽冲突。`)
  }
  const commandCost = Math.max(1, terrainCommandCost(scene, next).total)
  Object.assign(scene, next)
  return { commandCost, affectedIds: [...affected].sort() }
}
