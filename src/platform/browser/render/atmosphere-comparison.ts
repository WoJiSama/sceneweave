import type { Projection } from '../../../shared/projection/types.js'

/** Disposable GM drawing view. The validated audience/resource closure stays intact. */
export function atmosphereComparison(projection: Projection): Projection {
  if (!projection.visual || projection.audience !== 'gm') return projection
  const terrain = projection.terrain.some(area => area.facade?.lightIntensity)
    ? projection.terrain.map(area => area.facade?.lightIntensity ? { ...area, facade: { ...area.facade, lightIntensity: 0 } } : area)
    : projection.terrain
  const { directionalLight: _directionalLight, ...environment } = projection.visual.environment
  return { ...projection, terrain, visual: { ...projection.visual,
    environment: { ...environment, ambientOpacity: 0, exposure: 1 },
    lights: [], fixtureGlows: undefined, fogs: [], filters: [],
  }, ...(projection.artStyles ? { artStyles: undefined } : {}) }
}
