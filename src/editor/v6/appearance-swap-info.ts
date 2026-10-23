import type { BoundsMm, PropDefinition, PropV2 } from '../../core/v2/types'

/** Source dimensions describe the artwork. Replacing artwork retains the live
 * instance's visual mapping and physical semantics until a separate edit exists. */
export function appearanceSwapInfoV6(prop: PropV2, definition: PropDefinition) {
  const rotated = (bounds: BoundsMm) => {
    const radians = prop.rotationDeg * Math.PI / 180, c = Math.abs(Math.cos(radians)), s = Math.abs(Math.sin(radians))
    return { width: Math.round(bounds.width * c + bounds.height * s), height: Math.round(bounds.width * s + bounds.height * c) }
  }
  const current = prop.visualBoundsMm, source = definition.defaultVisualBoundsMm
  const visualDiffers = (['x', 'y', 'width', 'height'] as const).some(key => current[key] !== source[key])
  const footprintDiffers = prop.footprintMm.width !== definition.defaultFootprintMm.width
    || prop.footprintMm.height !== definition.defaultFootprintMm.height
    || prop.footprintOffsetMm.x !== definition.defaultFootprintOffsetMm.x
    || prop.footprintOffsetMm.y !== definition.defaultFootprintOffsetMm.y
  return { visualDiffers, footprintDiffers, sourceVisualBoundsMm: { ...source }, currentVisualBoundsMm: { ...current },
    sourceRotatedSizeMm: rotated(source), currentRotatedSizeMm: rotated(current),
    message: visualDiffers
      ? `新素材原始图像范围为 ${source.width} × ${source.height} mm；当前实例仍映射到 ${current.width} × ${current.height} mm，图片比例可能变化。物理占地、阻挡、支撑、公开状态和已声明通行保持。`
      : '只替换固定外观。当前图像范围、物理占地、阻挡、支撑、公开状态和已声明通行保持。' }
}
