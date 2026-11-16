import type { SurfaceStyle, Wall } from '../model/scene.js'

/** Fixed source contract; visual reach never changes movement, sight or light blockers. */
export const WALL_RELIEF_LIMIT_MM = 45
export const WALL_RELIEF_ADDITION_LIMIT = 32768
export const WALL_RELIEF_NETWORK_LIMIT = 512
export const WALL_RELIEF_MATERIAL_ID = 'architectural-walls-v1-material-ruins-fractured-limestone'
export function supportsWallReliefStyle(style: SurfaceStyle | null | undefined): boolean {
  return style?.base.materialRef.id === WALL_RELIEF_MATERIAL_ID && style.base.materialRef.version === 1
}
export function wallSupportsRelief(wall: Pick<Wall, 'edgeProfile'> & { style: SurfaceStyle | null }): boolean {
  return wall.edgeProfile === 'stone-blocks-v1' && supportsWallReliefStyle(wall.style)
}
