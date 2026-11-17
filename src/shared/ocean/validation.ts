import type { Issue, SceneDocument } from '../model/scene.js'
import { OCEAN_LIMITS } from './contracts.js'
import { waveGrid } from './waves.js'

export function validateOcean(scene: SceneDocument): Issue[] {
  const errors: Issue[] = []
  const error = (entityId: string, message: string) => errors.push({ code: 'OCEAN', entityId, message })
  let total = 0
  for (const area of Object.values(scene.terrainAreas)) if (area.waterSurface) {
    if (scene.mapMode !== 'scene' || area.rockBody) error(area.id, '水面外观只支持普通场景的平面地形，不能覆盖实体岩体。')
    const cells = waveGrid(area.boundaryMm.map(p => p.positionMm), area.waterSurface).cells
    total += cells
    if (!Number.isFinite(cells) || cells > OCEAN_LIMITS.cellsPerSurface) error(area.id, '浪纹超过单面4096采样格，请增大浪间距。')
  }
  if (total > OCEAN_LIMITS.cellsPerScene) error(scene.sceneId, '整图浪纹超过16384采样格。')
  for (const prop of Object.values(scene.props)) if (prop.waterAppearance) {
    const area = prop.supportRef.kind === 'terrainArea' ? scene.terrainAreas[prop.supportRef.id] : undefined
    if (!area?.waterSurface || area.floorId !== prop.floorId) error(prop.id, '水中物件必须明确支撑于同楼层的现存水面；移除水面前请先移除物件水中效果。')
    if (prop.appearance.kind !== 'image' || prop.renderLayer !== 'object') error(prop.id, '水中效果只支持图片物件的物件绘制带。')
    if (prop.waterAppearance.mode !== 'surface' && (prop.blocksMovement || prop.blocksSight)) error(prop.id, '水下及半出水效果当前只支持不阻挡移动或视线的布景物件。')
    if (Object.values(scene.attachments ?? {}).some(row => row.child.id === prop.id || row.mode !== 'embed' && scene.attachmentSurfaces?.[row.surfaceId]?.owner.id === prop.id)) error(prop.id, '水中效果暂不支持承托或悬挂关系中的物件。')
  }
  return errors
}
