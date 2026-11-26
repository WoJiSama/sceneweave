import type { PointMm, ShadowStyle } from '../model/scene.js'
import type { DirectionalLight, VisualEnvironment } from './types.js'

/** Saved angles follow the direction in which the shadow travels in world XY. */
export function shadowDirection(directionDeg: number): PointMm {
  const angle = directionDeg * Math.PI / 180
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

export function horizontalDirectionToLight(directionDeg: number): PointMm {
  const { x, y } = shadowDirection(directionDeg)
  return { x: -x, y: -y }
}

export function directionToLight(environment?: Pick<VisualEnvironment, 'lightDirectionDeg' | 'directionalLight'>): [number, number, number] {
  const { x, y } = horizontalDirectionToLight(environment?.lightDirectionDeg ?? 135)
  const elevation = (environment?.directionalLight?.elevationDeg ?? 35) * Math.PI / 180
  const horizontal = Math.cos(elevation)
  return [x * horizontal, y * horizontal, Math.sin(elevation)]
}

/** Top-down objects have no saved height. The renderer supplies a nominal
 * caster height, while stacked floors use the actual elevation difference. */
export function directionalShadowReach(light: DirectionalLight, heightMm: number, limitMm: number): number {
  return Math.max(0, Math.min(limitMm, heightMm / Math.tan(light.elevationDeg * Math.PI / 180)))
}

export function directionalShadowStyle(environment: VisualEnvironment, heightMm: number, limitMm: number): ShadowStyle | null {
  const light = environment.directionalLight
  if (!light?.intensity) return null
  const offsetMm = directionalShadowReach(light, heightMm, limitMm)
  return { directionDeg: environment.lightDirectionDeg, offsetMm, blurMm: 18 + light.softness * (64 + offsetMm * .13),
    opacity: Math.min(.72, light.intensity * (light.kind === 'sun' ? .48 : .43)),
    color: light.kind === 'sun' ? '#273436' : '#141F39' }
}

export function wallShadowStyle(themed: ShadowStyle | null | undefined, environment?: VisualEnvironment): ShadowStyle | null {
  return (environment && directionalShadowStyle(environment, 1100, 5600))
    || (themed ? { ...themed, directionDeg: environment?.lightDirectionDeg ?? themed.directionDeg } : null)
}
