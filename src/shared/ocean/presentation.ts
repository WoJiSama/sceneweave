import type { BoundsMm, Prop } from '../model/scene.js'

/** Paint extent only. Physical footprint, selection image and support do not grow. */
export function waterVisualBounds(prop: Prop): BoundsMm {
  const look = prop.waterAppearance, v = prop.visualBoundsMm
  if (!look || look.mode === 'submerged' || !look.surfaceEffects) return v
  const padding = Math.ceil(Math.min(v.width, v.height) * .12 * look.surfaceEffects.ripples)
  return { x: v.x - padding, y: v.y - padding, width: v.width + padding * 2,
    height: v.height + padding * 2 + look.surfaceEffects.wakeLengthMm }
}
