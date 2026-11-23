import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'

export interface ObliqueCamera {
  azimuthDeg: number
  elevationDeg: number
  zoom: number
  targetMm?: PointMm
  fadeCanopy?: boolean
}
export const DEFAULT_OBLIQUE_CAMERA: ObliqueCamera = { azimuthDeg: -13, elevationDeg: 55, zoom: 1 }

/** The frame and export agree on the world centre associated with a zoom. */
export function zoomOblique(camera: ObliqueCamera, bounds: BoundsMm, zoom: number, toward?: PointMm): ObliqueCamera {
  const scale = Math.max(.65, Math.min(4, zoom))
  if (!toward || scale <= 1) return { ...camera, zoom: scale, ...(scale <= 1 ? { targetMm: undefined } : {}) }
  const center = camera.targetMm ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  return { ...camera, zoom: scale, targetMm: {
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width, center.x + toward.x * bounds.width * .26)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height, center.y + toward.y * bounds.height * .26)),
  } }
}
