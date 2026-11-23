import type { SceneDocument, SurfaceStyle } from '../../shared/model/scene'
import { defaultMaterialPaint } from '../../shared/appearance/surface-paint'

/** Changing the base material does not change its placement or any local overlays. */
export function outdoorInspectorStyle(scene: SceneDocument, materialId: string, prior: SurfaceStyle | null, kind?: 'path'): SurfaceStyle | null {
  if (!materialId) return null
  const material = scene.materials[materialId]
  if (!material) throw new Error('所选材质不存在。')
  if (prior) {
    const next = structuredClone(prior)
    next.base.materialRef = { id: materialId, version: material.version }
    return next
  }
  return { base: defaultMaterialPaint(material, kind), overlays: [] }
}
