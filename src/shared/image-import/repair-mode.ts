export const IMAGE_REPAIR_MODES = ['tile', 'seamless', 'aligned', 'texture', 'context', 'context-blend', 'context-blend-v2', 'structure', 'surfaces'] as const
export type ImageRepairMode = typeof IMAGE_REPAIR_MODES[number]

export function isContextBlendRepair(mode?: ImageRepairMode): boolean {
  return mode === 'context-blend' || mode === 'context-blend-v2'
}
