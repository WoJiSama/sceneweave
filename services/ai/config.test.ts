import { describe, expect, it } from 'vitest'
import { loadAiConfig } from './config.js'
import { AI_LIMITS } from '../../src/shared/ai/protocol.js'

const environment = () => ({
  SCENEWEAVE_AI_ACCESS_TOKEN: 'local-test-access-token-12345678901234567890',
  SCENEWEAVE_AI_PROVIDER_BASE_URL: 'https://example.test/api/coding/paas/v4',
  SCENEWEAVE_AI_PROVIDER_API_KEY: 'PRIVATE_CONFIG_TEST_PROVIDER_KEY',
  SCENEWEAVE_AI_PROVIDER_MODEL: 'glm-5.3',
  SCENEWEAVE_AI_PROVIDER_VISION_MODEL: 'glm-5.3-flash',
})

describe('explicit provider reasoning effort configuration', () => {
  it('keeps reasoning effort absent by default and preserves independent provider and output defaults', () => {
    const config = loadAiConfig(environment())
    expect(config.provider).not.toHaveProperty('reasoningEffort')
    expect(config.provider).toMatchObject({ model: 'glm-5.3', visionModel: 'glm-5.3-flash', preserveReasoning: 'disabled', vision: 'unverified' })
    expect(config.authoringOutputTokens).toBe(AI_LIMITS.maxOutputTokensPerRequest)
  })
  it.each(['low', 'high', 'max'] as const)('loads the explicit %s level without mutating input or changing the separate reasoning-preservation and output options', reasoningEffort => {
    const env = Object.freeze({ ...environment(), SCENEWEAVE_AI_PROVIDER_REASONING_EFFORT: reasoningEffort,
      SCENEWEAVE_AI_PROVIDER_PRESERVE_REASONING: 'enabled', SCENEWEAVE_AI_AUTHORING_OUTPUT_TOKENS: '8192' })
    const before = JSON.stringify(env), config = loadAiConfig(env)
    expect(config.provider).toMatchObject({ reasoningEffort, preserveReasoning: 'enabled', model: 'glm-5.3', visionModel: 'glm-5.3-flash' })
    expect(config.authoringOutputTokens).toBe(8192)
    expect(JSON.stringify(env)).toBe(before)
  })
  it.each(['', ' low', 'low ', 'low\n', 'LOW', 'medium', 'xhigh', 'none', 'minimal', 'disabled', 'PRIVATE_INVALID_CONFIG_VALUE'])('rejects invalid effort %j without echoing credentials or submitted values', reasoningEffort => {
    let error: unknown
    try { loadAiConfig({ ...environment(), SCENEWEAVE_AI_PROVIDER_REASONING_EFFORT: reasoningEffort }) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Invalid server configuration: PROVIDER_REASONING_EFFORT')
    expect(String(error)).not.toContain('PRIVATE_')
  })
})
