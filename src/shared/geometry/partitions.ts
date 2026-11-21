import type { PointMm, Region, SceneDocument } from '../model/scene.js'
import { pointInPolygon } from './geometry.js'
import { pointsBounds } from '../projection/projection.js'
import { resolveFloorOutput } from '../floors/output.js'

export function partitionAt(scene: SceneDocument, floorId: string, positionMm: PointMm): Region | undefined {
  return Object.values(scene.regions).find(region => region.kind === 'partition' && region.floorId === floorId
    && pointInPolygon(positionMm, region.boundaryMm, false))
}

export function partitionDecorationIds(scene: SceneDocument, partition: Region): string[] {
  return [...Object.values(scene.props), ...Object.values(scene.decorations ?? {})]
    .filter(item => item.floorId === partition.floorId && pointInPolygon(item.positionMm, partition.boundaryMm, false))
    .map(item => item.id)
}

export function resolvePartitionOutput(scene: SceneDocument, id: string, audience: 'gm' | 'player') {
  const region = Object.hasOwn(scene.regions, id) ? scene.regions[id] : undefined
  if (!region || region.kind !== 'partition' || audience === 'player' && region.visibility !== 'public') throw new Error('此受众没有可导出的分区。')
  const floor = resolveFloorOutput(scene, region.floorId).boundsMm, bounds = pointsBounds(region.boundaryMm)
  if (bounds.x < floor.x || bounds.y < floor.y || bounds.x + bounds.width > floor.x + floor.width || bounds.y + bounds.height > floor.y + floor.height) {
    throw new Error('分区超出楼层的固定导出范围。请调整分区或楼层范围。')
  }
  return { region, bounds }
}
