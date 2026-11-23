import { z } from 'zod'
import { bridgeSideOffset } from '../path-assembly/profiles.js'

/** Persisted construction parameters for an oblique view of the actual outline. */
export const terrainFacadeSchema = z.object({
  profile: z.enum(['glazed-v1', 'ribbed-v1', 'girder-v1']),
  depthMm: z.number().int().min(250).max(16000),
  pitchMm: z.number().int().min(500).max(8000),
  frameMm: z.number().int().min(40).max(1400),
  facing: z.enum(['left', 'front', 'right']),
  lightColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  lightIntensity: z.number().min(0).max(1),
}).strict()

export type TerrainFacade = z.infer<typeof terrainFacadeSchema>

export const TERRAIN_FACADES = {
  'glazed-v1': { profile: 'glazed-v1', depthMm: 6900, pitchMm: 2280, frameMm: 240, facing: 'front', lightColor: '#58EAC3', lightIntensity: .8 },
  'ribbed-v1': { profile: 'ribbed-v1', depthMm: 4750, pitchMm: 1550, frameMm: 210, facing: 'front', lightColor: '#FFC678', lightIntensity: .68 },
  'girder-v1': { profile: 'girder-v1', depthMm: 1200, pitchMm: 1960, frameMm: 170, facing: 'right', lightColor: '#58EAC3', lightIntensity: 0 },
} as const satisfies Record<TerrainFacade['profile'], TerrainFacade>

const bridgeSide = bridgeSideOffset(1)

export function terrainFacadeOffset(facade: TerrainFacade): { x: number; y: number } {
  const shear = facade.profile === 'girder-v1' ? bridgeSide.x / bridgeSide.y : .42
  return { x: facade.depthMm * shear * { left: -1, front: 0, right: 1 }[facade.facing], y: facade.depthMm }
}
