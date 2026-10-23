import type { SceneDocumentV3, SurfaceStyle } from '../../core/v3/types'

/** Changing the base material does not change its placement or any local overlays. */
export function outdoorInspectorStyle(scene: SceneDocumentV3, materialId: string, prior: SurfaceStyle | null): SurfaceStyle | null {
  if (!materialId) return null
  const material = scene.materials[materialId]
  if (!material) throw new Error('所选材质不存在。')
  if (prior) {
    const next = structuredClone(prior)
    next.base.materialRef = { id: materialId, version: material.version }
    return next
  }
  return { base: { materialRef: { id: materialId, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
}
