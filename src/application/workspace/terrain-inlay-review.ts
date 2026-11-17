import type { CompositionCommand } from '../../shared/model/appearance.js'
import type { TerrainInlaySourceInterval } from '../../shared/terrain-inlay/contracts.js'
import { attachmentOwnerDependencyIds } from '../../shared/attachments/dependencies.js'
import { planTerrainInlay } from '../../shared/terrain-inlay/geometry.js'
import { inspectTerrainInlayVisualScope } from '../../shared/terrain-inlay/visual-scope.js'
import { visualBase } from '../../shared/visual/base.js'
import type { EditableProject } from './project.js'

export interface TerrainInlayReview {
  connectionId: string
  restoring: boolean
  appearanceOnly?: boolean
  sourceGround?: boolean
  finishOnly?: boolean
  finishKind?: 'slope' | 'steps'
  sourceIds: string[]
  sourceIntervals: TerrainInlaySourceInterval[]
  scopedPaintIds: string[]
  dependencyIds: string[]
  layerIds: string[]
}

/** GM review of the exact prepared owner. Run once during preparation, never
 * from a React render or from a caller-manufactured source proof. */
export function inspectTerrainInlayChanges(before: EditableProject, after: EditableProject, commands: readonly CompositionCommand[]): TerrainInlayReview[] {
  return commands.flatMap(command => {
    if (command.type !== 'adoptTerrainInlay' && command.type !== 'restoreTerrainInlaySource' && command.type !== 'setTerrainInlayAppearance' && command.type !== 'setTerrainInlayFinish') return []
    const restoring = command.type === 'restoreTerrainInlaySource', project = restoring ? before : after
    const scene = project.document, connection = scene.terrainConnections[command.id], inlay = connection?.terrainInlay
    if (!inlay) throw Error('连续山路审阅缺少已校验的实际结果。')
    const plan = planTerrainInlay(inlay.geometry), scope = inspectTerrainInlayVisualScope(scene, connection.id, inlay.geometry, plan)
    const sourceIds = inlay.geometry.sources.map(source => source.id)
    const dependencies = new Set(attachmentOwnerDependencyIds(scene, connection.id))
    for (const id of sourceIds) for (const dependency of attachmentOwnerDependencyIds(scene, id)) dependencies.add(dependency)
    for (const edge of Object.values(scene.terrainEdges)) if (sourceIds.includes(edge.source.areaId) || sourceIds.includes(edge.neighborAreaId ?? '')) dependencies.add(edge.id)
    const scopedPaintIds = scope.scopedPaintIds, visual = visualBase(scene)
    for (const id of [...scope.paintIds, ...scope.boundaryIds]) dependencies.add(id)
    const layerIds = new Set<string>(scope.layerIds)
    for (const id of dependencies) {
      const layer = scene.entityLayers[id] ?? visual?.edgeLooks[id]?.layerId ?? visual?.boundaries[id]?.layerId
      if (layer) layerIds.add(layer)
      if (scene.userLayers[id]) layerIds.add(id)
    }
    return [{ connectionId: connection.id, restoring, sourceIds,
      ...(command.type === 'setTerrainInlayAppearance' ? { appearanceOnly: true, sourceGround: inlay.appearance === 'source-ground' } : {}),
      ...(command.type === 'setTerrainInlayFinish' ? { finishOnly: true } : {}),
      ...(inlay.finish ? { finishKind: inlay.finish.kind } : {}),
      sourceIntervals: plan.sourceIntervals, scopedPaintIds: [...scopedPaintIds].sort(),
      dependencyIds: [...dependencies].filter(id => id !== connection.id && !scene.userLayers[id]).sort(), layerIds: [...layerIds].sort() }]
  })
}
