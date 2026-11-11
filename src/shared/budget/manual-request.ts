import type { AdjustmentKind, CompositionCommand } from '../model/appearance.js'
import type { AggregateGroup } from '../model/aggregate.js'
import type { SceneDocument } from '../model/scene.js'
import { layerMoveClosure } from '../commands/layers.js'
import { buildingAggregateMembers } from '../commands/building.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { visualBase } from '../visual/base.js'
import { visualBindingEntityIds } from '../visual/diagnostics.js'
import { MANUAL_TRANSACTION_BUDGET, selectManualTransactionBudget, type ManualTransactionBudget } from './command-budget.js'
import { requestsPathAttachmentTransaction } from '../path-attachments/transaction-budget.js'

export interface ManualCommandWork {
  /** Conservative request expansion, used before preparing any candidate.
   * The actual before/after meter remains the adoption authority. */
  readonly semanticTargets: number
  readonly groupMembers: number
}

/** Plan the requested scope without executing commands, allocating identities,
 * preparing resources, or retrying a refused candidate under a larger tier. */
export function planManualCommandWork(document: SceneDocument, input: readonly CompositionCommand[]): ManualCommandWork {
  const commands = captureJson(input), targets = new Set<string>(), groupImpact = new Set<string>()
  let uncertainExpansion = false, anonymousTargets = 0
  const groups = document.aggregateCoordinates?.groups ?? {}
  const children = new Map<string, AggregateGroup[]>()
  for (const group of Object.values(groups)) if (group.parentId !== null) {
    const rows = children.get(group.parentId) ?? []; rows.push(group); children.set(group.parentId, rows)
  }
  const subtree = (id: string): AggregateGroup[] => {
    // A preceding command may create this group. Its new members are already
    // counted from that request; leave validity and exact sequential ownership
    // to the command owner under the one conservative frozen envelope.
    if (!Object.hasOwn(groups, id)) { uncertainExpansion = true; return [] }
    const pending = [groups[id]], seen = new Set<string>()
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const group = pending[cursor]
      if (seen.has(group.id)) throw new Error('普通事务请求的组父级成环。')
      seen.add(group.id); pending.push(...children.get(group.id) ?? [])
    }
    return pending
  }
  const add = (ids: readonly string[]) => { for (const id of ids) targets.add(id) }
  const prefabMembers = (id: string): string[] => Object.values(document.prefabInstances[id]?.members ?? {}).flatMap(row => row.propId ?? [])
  const appearanceTargets = (ids: readonly string[]) => ids.flatMap(id => Object.hasOwn(document.prefabInstances, id) ? prefabMembers(id) : [id])
  const layerMembers = (id: string) => Object.entries(document.entityLayers).filter(([, layer]) => layer === id).map(([entity]) => entity)
  const supportsAppearance = (id: string, kind?: AdjustmentKind) => {
    const prop = document.props[id]
    if (prop) return kind !== 'tint' && kind !== 'brightness' || prop.appearance.kind === 'image'
    if (kind === 'shadowClass') return false
    return !!(document.rooms[id]?.floorStyle ?? document.walls[id]?.topStyle ?? document.terrainAreas[id]?.surfaceStyle
      ?? document.terrainEdges[id]?.surfaceStyle ?? document.terrainConnections[id]?.surfaceStyle ?? document.paths[id]?.surfaceStyle)
  }
  const representation = (ids: readonly string[]) => {
    for (const id of ids) for (const group of subtree(id)) { targets.add(group.id); add(group.members.map(ref => ref.id)) }
  }
  const transforms: { id: string; affected: string[] }[] = []
  const visual = visualBase(document)
  const finiteFilterTargets = (filter: NonNullable<typeof visual>['filters'][string] | undefined) =>
    filter?.target.kind === 'entities' ? filter.target.ids : filter ? [filter.id] : []
  for (const command of commands) {
    switch (command.type) {
      case 'transformAggregateBuilding': case 'transformAggregateNatural': {
        const rows = subtree(command.id), affected = rows.flatMap(group => [group.id, ...group.members.map(ref => ref.id)])
        transforms.push({ id: command.id, affected }); targets.add(command.id)
        for (const id of affected) if (id !== command.id) groupImpact.add(id)
        break
      }
      case 'createAggregateGroup': targets.add(command.group.id); add(command.group.members.map(ref => ref.id)); break
      case 'reparentAggregateGroup': case 'dissolveAggregateGroup': representation([command.id]); break
      case 'splitAggregateGroup': representation([command.id]); add(command.parts.map(part => part.id)); break
      case 'mergeAggregateGroups': representation(command.ids); targets.add(command.newId); break
      case 'moveEntitiesToLayer': {
        if (command.ids.some(id => !Object.hasOwn(document.entityLayers, id))) { add(command.ids); uncertainExpansion = true }
        else add(layerMoveClosure(document, command.ids))
        break
      }
      case 'removeLayer': {
        targets.add(command.id); add(layerMembers(command.id))
        const removed = document.userLayers[command.id]
        if (removed) for (const layer of Object.values(document.userLayers)) if (layer.floorId === removed.floorId && layer.order > removed.order) add(layerMembers(layer.id))
        break
      }
      case 'reorderLayers': {
        const selected = new Set(command.ids.filter((id, index) => document.userLayers[id]?.order !== index))
        const ids = Object.entries(document.entityLayers).filter(([, layer]) => selected.has(layer)).map(([id]) => id)
        add(ids); if (!ids.length) add(command.ids)
        break
      }
      case 'setAppearanceAdjustment': case 'toggleAppearanceAdjustment': case 'removeAppearanceAdjustment': {
        const ids = command.scope.kind === 'targets' ? appearanceTargets(command.scope.ids) : layerMembers(command.scope.layerId)
          .filter(id => supportsAppearance(id, command.type === 'setAppearanceAdjustment' ? command.adjustment.kind : undefined))
        add(ids); if (!ids.length && command.scope.kind === 'layer') targets.add(command.scope.layerId)
        break
      }
      case 'setAppearanceSource': add(appearanceTargets(command.ids)); break
      case 'createPrefab': targets.add(command.id); add(command.ids); break
      case 'instantiatePrefab': targets.add(command.id); add(Object.values(command.memberIds)); break
      case 'duplicatePrefab': targets.add(command.newId); add(Object.values(command.memberIds)); break
      case 'deletePrefab': targets.add(command.id); add(command.memberIds); break
      case 'transformPrefab': case 'unpackPrefab': targets.add(command.id); add(prefabMembers(command.id)); break
      case 'detachPrefabMember': case 'detachScatterMember': targets.add(command.propId); break
      case 'resetPrefabMember': {
        const memberId = document.prefabInstances[command.groupId]?.members[command.key]?.propId ?? command.newId
        if (memberId) targets.add(memberId)
        break
      }
      case 'copyProp': targets.add(command.newId); break
      case 'transformBuilding': add(buildingAggregateMembers(document, command.id).filter(ref => ref.kind !== 'vertex').map(ref => ref.id)); break
      case 'moveVertex': case 'setWallThickness': case 'reverseWall': case 'splitWall': {
        const vertexIds = command.type === 'moveVertex' ? [command.id] : [document.walls[command.id]?.startVertexId, document.walls[command.id]?.endVertexId]
        const walls = Object.values(document.walls).filter(wall => command.type === 'moveVertex'
          ? vertexIds.includes(wall.startVertexId) || vertexIds.includes(wall.endVertexId) : wall.id === command.id)
        const wallIds = new Set(walls.map(wall => wall.id)); add([...wallIds])
        add(Object.values(document.rooms).filter(room => command.type === 'moveVertex' ? room.boundaryVertexIds.includes(command.id)
          : walls.some(wall => room.boundaryVertexIds.some((id, index, ids) =>
            id === wall.startVertexId && ids[(index + 1) % ids.length] === wall.endVertexId
            || id === wall.endVertexId && ids[(index + 1) % ids.length] === wall.startVertexId))).map(room => room.id))
        add(Object.values(document.openings).filter(opening => wallIds.has(opening.wallId)).map(opening => opening.id))
        if (!walls.length) targets.add(command.id)
        if (command.type === 'splitWall') targets.add(command.newWallId)
        break
      }
      case 'createRoom': targets.add(command.id); anonymousTargets += command.boundaryMm.length; break
      // These operations determine new output populations in their domain
      // solver. Reserve the largest manual envelope once; actual metering can
      // still refuse it and never triggers automatic escalation or replay.
      case 'createScatter': case 'configureScatter': case 'regenerateScatter':
      case 'createDecorationCluster': case 'createCanopyRegion': case 'updateCanopyRegion': case 'regenerateDecorationCluster':
      case 'paintSurfaceVegetation': case 'paintSurfaceMaterial': case 'eraseSurfaceRules': case 'updateSurfaceVegetation':
      case 'deleteSurfaceRule': case 'repairBuildingTopology': uncertainExpansion = true; break
      case 'deleteDecorationCluster': {
        const cluster = document.decorationClusters[command.id]
        targets.add(command.id)
        add(Object.values(cluster?.members ?? {}).flatMap(member => member.entityId && member.state !== 'deleted' && member.state !== 'detached' ? [member.entityId] : []))
        if (cluster?.canopyRule) uncertainExpansion = true
        break
      }
      case 'moveTerrainPoint': targets.add(command.areaId); break
      case 'upsertMaterializedEdge': targets.add(command.edge.id); break
      case 'upsertTerrainTransition': targets.add(command.transition.id); break
      case 'upsertVisualBoundary': {
        targets.add(command.boundary.id); add(visualBindingEntityIds(command.boundary))
        add(Object.values(document.visual.base.materializedEdges).filter(edge => edge.boundaryId === command.boundary.id).map(edge => edge.id))
        break
      }
      case 'upsertVisualEdgeLook': targets.add(command.edgeLook.id); break
      case 'upsertVisualLight': targets.add(command.light.id); break
      case 'upsertVisualFog': targets.add(command.fog.id); break
      case 'upsertVisualFilter': add([...finiteFilterTargets(command.filter), ...finiteFilterTargets(visual?.filters[command.filter.id])]); break
      case 'removeVisualEffect': {
        add(command.kind === 'filter' ? finiteFilterTargets(visual?.filters[command.id]) : [command.id]); break
      }
      case 'detachDecorationMember': targets.add(command.entityId); break
      case 'upsertScatterExclusion': case 'removeScatterExclusion': targets.add(command.groupId); break
      case 'setEntranceOpenings': add(command.ids); break
      default: {
        if ('id' in command) targets.add(command.id)
        else targets.add(`scene:${document.sceneId}`)
      }
    }
  }
  // A member/ownership edit mixed with a transform cannot be admitted as a
  // core-only edit. The actual local-invariance proof remains stricter still.
  const roots = new Set(transforms.map(row => row.id))
  for (const transform of transforms) if (transform.affected.some(id => !roots.has(id) && targets.has(id))) add(transform.affected)
  const semanticTargets = Math.max(commands.length, targets.size + anonymousTargets, uncertainExpansion ? 1024 : 0)
  if (!Number.isSafeInteger(semanticTargets) || !Number.isSafeInteger(groupImpact.size)) throw new Error('普通事务请求范围无效。')
  return freezeJson({ semanticTargets, groupMembers: groupImpact.size })
}

export function selectManualCommandBudget(document: SceneDocument, commands: readonly CompositionCommand[]): ManualTransactionBudget {
  const work = planManualCommandWork(document, commands)
  if (requestsPathAttachmentTransaction(document, commands)) return MANUAL_TRANSACTION_BUDGET
  if (work.semanticTargets > 1024) throw new Error(`普通事务请求展开超限[semanticTargets]：${work.semanticTargets}/1024，保留当前成果。`)
  if (work.groupMembers > 65536) throw new Error(`普通事务请求展开超限[groupMembers]：${work.groupMembers}/65536，保留当前成果。`)
  return selectManualTransactionBudget(document, work.semanticTargets, work.groupMembers)
}
