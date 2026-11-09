import { BaseMapRequestV3Schema } from '../terrain-generation/base-map-v3.js'
import type { GenerationOperatorDescriptor } from './contracts.js'

/** Compatibility identity only. The native base-map protocol remains the
 * authority for supported algorithm IDs and recipe replay versions. This is
 * not a proof of an arbitrary callback: registry callbacks remain trusted,
 * statically assembled code owned by natural-adapter. */
export function isNaturalReplayBridgeIdentity(operator: Pick<GenerationOperatorDescriptor, 'id' | 'version' | 'phase' | 'owner' | 'determinism'>): boolean {
  const match = /^natural-base-map3:([^:]+):structure$/.exec(operator.id)
  const algorithm = BaseMapRequestV3Schema.shape.algorithm.shape
  return !!match && operator.phase === 'structure' && operator.owner === 'structure'
    && algorithm.id.safeParse(match[1]).success && algorithm.recipeVersion.safeParse(operator.version).success
    && operator.determinism.replayVersion === operator.version
}
