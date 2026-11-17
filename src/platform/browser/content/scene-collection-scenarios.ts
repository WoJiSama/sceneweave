import { SCENE_COLLECTION_SCENARIOS } from '../../../shared/assets/scene-collection-plan.js'

/** Authored candidates only. Availability is independent from the visual review
 * and user acceptance recorded with the delivered projects. */
export const SCENE_COLLECTION_AUTHORED_SCENARIOS = SCENE_COLLECTION_SCENARIOS

export async function createSceneCollectionRepresentativeProject(id: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const layout = SCENE_COLLECTION_AUTHORED_SCENARIOS.find(row => row.id === id)
  if (!layout) throw new Error('该用途场景尚未提供可加载候选。')
  if (layout.era === 'medieval') {
    const { createSceneCollectionMedievalScenarioProject } = await import('./scene-collection-medieval-scenarios.js')
    return createSceneCollectionMedievalScenarioProject(id, signal)
  }
  if (layout.era === 'fantasy') {
    const { createSceneCollectionFantasyScenarioProject } = await import('./scene-collection-fantasy-scenarios.js')
    return createSceneCollectionFantasyScenarioProject(id, signal)
  }
  const { createSceneCollectionPeriodScenarioProject } = await import('./scene-collection-period-scenarios.js')
  return createSceneCollectionPeriodScenarioProject(id, signal)
}
