import { defaultMaterialPaint } from '../../../appearance/surface-paint.js'
import type { SceneDocument, SurfaceStyle } from '../../../model/scene.js'
import type { InteriorLayoutParameters, InteriorRectangle, InteriorRoomRequirement } from './contracts.js'
import { isBedroomPurpose } from './furnishing-bedroom.js'
import { isDiningPurpose, isSeatedGroupPurpose } from './furnishing-composition.js'
import { isKitchenPurpose } from './furnishing-groups.js'

export function interiorFloorFinish(document: SceneDocument, materials: InteriorLayoutParameters['materials'], bounds: InteriorRectangle,
  room?: InteriorRoomRequirement): SurfaceStyle | undefined {
  if (!materials.floorFinish) return
  const purpose = room?.purpose ?? '通道'
  const kitchen = isKitchenPurpose(purpose)
  const service = kitchen || /储藏|库房|仓库|走廊|通道|\b(?:storage|pantry|store|corridor|hallway)\b/i.test(purpose)
  const ref = service ? materials.floorFinish.serviceMaterialRef : materials.floor
  if (!ref) return
  let tint: string | null = null
  if (service) tint = kitchen ? '#E5E8DC' : '#BCBBA5'
  else if (isBedroomPurpose(purpose)) tint = '#D1B78F'
  else if (room?.furnishingFocus === 'fireside-v1' || isDiningPurpose(purpose)) tint = '#F2E1BD'
  else if (room?.furnishingFocus === 'reading-v1' || isSeatedGroupPurpose(purpose)) tint = '#CBD4C3'
  return { base: { ...defaultMaterialPaint(document.materials[ref.id]), tint, alignment: 'surface',
    rotationDeg: !service && bounds.height > bounds.width ? 90 : 0, originMm: { x: bounds.x, y: bounds.y } }, overlays: [] }
}
