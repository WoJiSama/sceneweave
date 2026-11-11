import type { Projection } from '../../../shared/projection/types.js'

/** Disposable GM drawing view. The validated audience/resource closure stays intact. */
export function atmosphereComparison(projection: Projection): Projection {
  if (!projection.visual || projection.audience !== 'gm') return projection
  return { ...projection, visual: { ...projection.visual,
    environment: { ...projection.visual.environment, ambientOpacity: 0, exposure: 1 },
    lights: [], fogs: [], filters: [],
  } }
}
