import type { SceneCommand } from '../../shared/commands/commands'
import type { PointMm, SceneDocument, ScatterGroup } from '../../shared/model/scene'
import { islandShallowWaterBoundaryMm } from './island-geometry'

export function terrainName(id: string): string {
  return ({ 'island-water': '海水基底', 'island-low': '低台地', 'island-high': '高台地', 'terrace-area': '露台铺装' } as Record<string, string>)[id] ?? '地形表面'
}

export function scatterName(scene: SceneDocument, group: ScatterGroup): string {
  const names = group.palette.map(item => scene.propDefinitions[item.propDefinitionRef.id]?.name ?? '').join(' / ')
  const kind = /树|tree/i.test(names) ? '树木散布' : /灌|shrub/i.test(names) ? '灌木散布' : /石|rock/i.test(names) ? '碎石散布' : '物件散布'
  const areaId = group.domain.kind === 'area' ? group.domain.areaId : group.domain.kind === 'edgeBand' ? scene.terrainEdges[group.domain.edgeId]?.source.areaId : undefined
  return areaId ? `${terrainName(areaId)} · ${kind}` : kind
}

/** An explicit VIS-02 edit keeps shared vertices and its stored shallow-water paint together. */
export function terrainPointCommands(scene: SceneDocument, areaId: string, pointId: string, positionMm: PointMm): SceneCommand[] {
  const area = scene.terrainAreas[areaId], point = area?.boundaryMm.find(point => point.id === pointId)
  if (!point) throw new Error('地形轮廓点不存在。')
  const commands: SceneCommand[] = []
  const island = scene.presetSnapshot.presetId === 'sceneweave-vis02' && scene.presetSnapshot.presetVersion === 1
  const candidate = structuredClone(scene)
  for (const other of Object.values(candidate.terrainAreas)) {
    if (other.floorId !== area.floorId || (!island && other.id !== area.id)) continue
    for (const vertex of other.boundaryMm) {
      if (island ? vertex.positionMm.x === point.positionMm.x && vertex.positionMm.y === point.positionMm.y : vertex.id === point.id) {
        commands.push({ type: 'moveTerrainPoint', areaId: other.id, pointId: vertex.id, positionMm })
        vertex.positionMm = { ...positionMm }
      }
    }
  }
  if (island && candidate.terrainAreas['island-water']?.surfaceStyle?.overlays.some(overlay => overlay.id === 'island-shallow-water')) {
    commands.push({ type: 'setOverlayBoundary', kind: 'terrainArea', id: 'island-water', overlayId: 'island-shallow-water', boundaryMm: islandShallowWaterBoundaryMm(candidate) })
  }
  return commands
}
