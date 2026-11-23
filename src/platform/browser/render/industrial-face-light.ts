import type { VisualEnvironment } from '../../../shared/visual/types.js'

export type IndustrialFaceEnvironment = Pick<VisualEnvironment, 'lightDirectionDeg' | 'directionalLight'>

/** The world edge gives the vertical face normal, independent of its drawn depth. */
export function industrialFaceLight(dx: number, dy: number, winding: number, environment?: IndustrialFaceEnvironment): number {
  if (!environment || !winding) return 1
  const length = Math.hypot(dx, dy)
  if (!length) return 1
  const shadowAngle = environment.lightDirectionDeg * Math.PI / 180
  const normalX = winding * dy / length, normalY = -winding * dx / length
  // The Floor angle points along the cast shadow. The light arrives from the opposite side.
  const diffuse = Math.max(0, -normalX * Math.cos(shadowAngle) - normalY * Math.sin(shadowAngle))
  // A Floor direction gives the material a baseline relief when sun or moon is unset.
  const direct = environment.directionalLight
  const elevation = (direct?.elevationDeg ?? 35) * Math.PI / 180
  const strength = (direct?.intensity ?? .8) * Math.cos(elevation)
  return 1 + strength * (.76 * diffuse - .24)
}

/** Shade an opaque material swatch. Emission uses its authored color directly. */
export function shadeIndustrialFace(color: string, light: number, response = 1): string {
  if (light === 1) return color
  const gain = 1 + (light - 1) * response
  const channel = (start: number) => {
    const value = Math.min(255, Math.round(parseInt(color.slice(start, start + 2), 16) * gain))
    return value.toString(16).padStart(2, '0').toUpperCase()
  }
  return `#${channel(1)}${channel(3)}${channel(5)}`
}
