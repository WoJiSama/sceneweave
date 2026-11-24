import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { requiredBaseMapSelector } from '../ai/protocol.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { supportedPolygon } from '../geometry/geometry.js'
import { assertTerrainConnectionClearances } from '../geometry/terrain-travel.js'
import { canonicalJson } from '../validation/json.js'
import { SHORE_MATERIAL_IDS } from '../visual/shore-art.js'
import { executeBaseMapRequestV3, parseBaseMapResponseV3, prepareBaseMapRequestV3 } from './base-map-v3.js'
import { generateTerrainDocumentV9, terrainGenerationInputV9Schema, terrainGenerationResultV9Schema } from './coast-generation-v9.js'
import { composeTerrainDocument } from './compose.js'
import { getLegacyGeneration } from './composition-contracts.js'

function fixture(seed: string, widthMm: number, heightMm: number, quality: 'standard' | 'detailed' = 'standard') {
  const profile = taskBudgetProfile(quality === 'detailed' ? 'expanded' : 'standard')
  const input = { sceneId: 'coast-v9-test', kind: 'coast', algorithmVersion: 9, seed, widthMm, heightMm,
    quality, budgetProfileId: profile.profileId } as const
  const base = createShoreBlankDocument('coast', { title: '海岸生成', sceneId: input.sceneId, widthMm, heightMm,
    now: '2026-11-24T00:00:00.000Z', preset: 'narrative' })
  return { base, input, profile }
}

describe('coastal headland generation', () => {
  it.each([
    ['tideline-headland-65', 48000, 36000, 'standard'], ['terrain-v1-0', 24000, 18000, 'standard'],
    ['coast-independent-west', 24000, 18000, 'standard'], ['coast-independent-east', 36000, 20000, 'standard'],
    ['coast-independent-large', 120000, 90000, 'standard'], ['coast-detailed-square', 36000, 36000, 'detailed'],
  ] as const)('keeps the shoreline, ridge, landing and inland cover for %s', (seed, widthMm, heightMm, quality) => {
    const { base, input } = fixture(seed, widthMm, heightMm, quality)
    const { document, activity } = generateTerrainDocumentV9(base, input)
    const coast = document.terrainAreas['terrain-low'], ridge = document.terrainAreas['terrain-high']
    const shoreline = coast.boundaryMm.slice(0, -2).map(row => row.positionMm.y)
    expect(Math.max(...shoreline) - Math.min(...shoreline)).toBeGreaterThan(heightMm * .33)
    expect(ridge.relief?.offsetsMm.some(offset => offset > 0)).toBe(true)
    expect(ridge.surfaceStyle?.base.materialRef.id).toBe(SHORE_MATERIAL_IDS.rockDry)
    expect(coast.surfaceStyle?.overlays.some(row => row.paint.materialRef.id === SHORE_MATERIAL_IDS.grass)).toBe(true)
    expect(supportedPolygon(document, activity.boundaryMm, activity.supportRef, 'visual-floor')).toBe(true)
    expect(document.terrainConnections['terrain-stairs']).toMatchObject({ widthMm: 1500, route: { stairStyle: 'naturalRock' } })
    expect(() => assertTerrainConnectionClearances(document, [{ connectionId: 'terrain-stairs', minWidthMm: 1500, approachDepthMm: 500 }])).not.toThrow()
    expect(Object.keys(document.props).length).toBeGreaterThanOrEqual(4)
  }, 30000)

  it('replays the exact coastal selector and persists its algorithm with the complete result', () => {
    const { base, input, profile } = fixture('tideline-headland-65', 48000, 36000)
    expect(terrainGenerationInputV9Schema.safeParse({ ...input, kind: 'island' }).success).toBe(false)
    const request = prepareBaseMapRequestV3({ requestId: 'coast-request', flowId: 'coast-flow', workspaceSceneId: 'empty',
      checkpoint: 0, operationEpoch: 0, profile, base, generation: { kind: 'terrain', input } })
    expect(request.algorithm).toEqual({ id: 'terrain-scene', version: 9, recipeVersion: 9 })
    expect(requiredBaseMapSelector(request.generation)).toBe('terrain-scene-v9')
    const response = executeBaseMapRequestV3(request)
    expect(parseBaseMapResponseV3(request, JSON.parse(canonicalJson(response)))).toEqual(response)
    if (response.result.kind !== 'terrain') throw Error('Expected coastal terrain')
    const result = terrainGenerationResultV9Schema.parse(response.result.terrain)
    const { document } = composeTerrainDocument(base, result, 'coast-birth', profile)
    expect(getLegacyGeneration(document)?.recipes['terrain-recipe']).toMatchObject({ algorithmVersion: 9, recipeVersion: 9, seed: input.seed })
  }, 60000)
})
