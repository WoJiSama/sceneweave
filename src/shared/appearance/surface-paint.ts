import type { MaterialPaint, MaterialRef } from '../model/scene.js'

export function defaultMaterialPaint(material: MaterialRef, kind?: 'path' | 'terrain'): MaterialPaint {
  const route = kind === 'path' ? material.defaultPathPaint : undefined
  return {
    materialRef: { id: material.id, version: material.version },
    tileSizeMm: { ...material.defaultTileSizeMm },
    rotationDeg: route?.rotationDeg ?? 0,
    alignment: route?.alignment ?? 'world',
    originMm: { x: 0, y: 0 },
    tint: null,
    opacity: 1,
  }
}
