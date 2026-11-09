import { describe, expect, it, vi } from 'vitest'
import { taskBudgetProfile } from '../../shared/budget/task-budget.js'
import { cloneJson } from '../../shared/validation/json.js'
import { domainExecutionFixture } from '../../../tools/testing/domain-execution-fixtures.js'
import { defaultMixedInput } from '../../shared/generation/domains/mixed/index.js'
import type { GenerationContentPort } from './generation-intent.js'
import type { EditableProject } from './project.js'
import { validation } from './test-fixtures.js'
import { parseSemanticGenerationRequest, semanticGenerationCapabilities, semanticGenerationExample,
  semanticGenerationRequestHash, prepareSemanticGenerationIntent, generateSemanticProject, type SemanticGenerationAuthorization } from './semantic-generation.js'

const authorization = (request: ReturnType<typeof semanticGenerationExample>): SemanticGenerationAuthorization => ({
  capabilityId: 'sceneweave-forest-building@1', contentId: 'builtin-mixed-forest@1', requestHash: semanticGenerationRequestHash(request),
})

function contentPort(): GenerationContentPort {
  const fixture = domainExecutionFixture('mixed'), base = { document: fixture.base } as EditableProject
  Object.values(base.document.floors)[0].boundsMm = { x: 0, y: 0, width: 40000, height: 32000 }
  base.document.exportBoundsMm = { x: 0, y: 0, width: 40000, height: 32000 }
  const defaults = defaultMixedInput(base.document, 'forest', 'semantic-test')
  return {
    interior: async () => { throw new Error('unexpected interior intent') },
    forest: async () => { throw new Error('unexpected forest intent') },
    volcano: async () => { throw new Error('unexpected volcano intent') },
    mixed: vi.fn(async () => ({ base, defaults })),
  }
}

describe('semantic forest-building generation boundary', () => {
  it('publishes one explicit capability, supported sample and honest missing requirements', () => {
    const capability = semanticGenerationCapabilities(), request = semanticGenerationExample()
    expect(capability).toMatchObject({ capabilityId: 'sceneweave-forest-building@1', domain: 'mixed', environment: 'forest',
      target: 'new-project', contentId: 'builtin-mixed-forest@1', delivery: { modelRequests: 0, adoption: 'new-project-import-only' } })
    expect(request.parameters).toMatchObject({ roomCount: 2, purpose: '哨站休息室', furniture: true })
    expect(capability.limitations).toEqual(expect.arrayContaining([expect.stringContaining('不生成帐篷'), expect.stringContaining('不支持逐房间用途')]))
    expect(semanticGenerationCapabilities().delivery).toEqual(capability.delivery)
  })

  it('strictly rejects unknown fields, unsupported environments and invalid values before loading any content', async () => {
    const request = semanticGenerationExample(), content = contentPort(), options = { runtime: { ids: { nextId: () => 'never' }, clock: { now: () => '2026-11-09T00:00:00.000Z' } },
      content, profile: taskBudgetProfile('small'), authorization: authorization(request) }
    const invalid = [
      { ...request, extra: true },
      { ...request, parameters: { ...request.parameters, environment: 'volcano' } },
      { ...request, parameters: { ...request.parameters, roomCount: 0 } },
      { ...request, parameters: { ...request.parameters, vegetationMultiplier: Number.NaN } },
      { ...request, parameters: { ...request.parameters, widthMm: 10001 } },
    ]
    for (const raw of invalid) {
      expect(() => parseSemanticGenerationRequest(raw)).toThrow()
      await expect(prepareSemanticGenerationIntent(raw, options)).rejects.toThrow()
    }
    expect(content.mixed).not.toHaveBeenCalled()
  })

  it('requires host authorization for this exact normalized request and uses the page intent mapper', async () => {
    const request = semanticGenerationExample(), content = contentPort(), calls: unknown[] = []
    const mixed = content.mixed
    content.mixed = async (...args) => { calls.push(args); return mixed(...args) }
    const runtime = { ids: { nextId: () => 'harness-scene' }, clock: { now: () => '2026-11-09T00:00:00.000Z' } }
    const prepared = await prepareSemanticGenerationIntent(request, { runtime, content, profile: taskBudgetProfile('small'), authorization: authorization(request) })
    expect(prepared).toMatchObject({ kind: 'new-project', domain: 'mixed', request, requestHash: semanticGenerationRequestHash(request),
      input: { parameters: { outdoor: { kind: 'forest' }, building: { rooms: [{ id: 'room-1', purpose: '哨站休息室' }, { id: 'room-2', purpose: '哨站休息室' }] } } } })
    expect(calls).toHaveLength(1)
    await expect(prepareSemanticGenerationIntent(request, { runtime, content, profile: taskBudgetProfile('small'), authorization: {
      ...authorization(request), requestHash: '0'.repeat(64),
    } })).rejects.toThrow(/授权/)
    expect(calls).toHaveLength(1)
  })

  it('captures hostile JSON once and preserves the original caller object', () => {
    const request = cloneJson(semanticGenerationExample()), original = cloneJson(request)
    let getterReads = 0
    Object.defineProperty(request.parameters, 'seed', { enumerable: true, configurable: true, get() { getterReads++; return 'changed' } })
    expect(() => parseSemanticGenerationRequest(request)).toThrow()
    expect(getterReads).toBe(0)
    expect(semanticGenerationExample()).toEqual(original)
  })

  it('refuses an unregistered budget and cancellation before any ID or content work, and rejects a late result', async () => {
    const request = semanticGenerationExample(), content = contentPort(), ids = { nextId: vi.fn(() => 'new-scene') }
    const options = { runtime: { ids, clock: { now: () => '2026-11-09T00:00:00.000Z' } }, content,
      profile: taskBudgetProfile('standard'), authorization: authorization(request) }
    await expect(prepareSemanticGenerationIntent(request, { ...options, profile: { ...options.profile, semanticTargets: 2048 } })).rejects.toThrow()
    await expect(prepareSemanticGenerationIntent(request, { ...options, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(ids.nextId).not.toHaveBeenCalled(); expect(content.mixed).not.toHaveBeenCalled()
    const signal = { aborted: false }, original = content.mixed
    content.mixed = async (...args) => { const result = await original(...args); signal.aborted = true; return result }
    await expect(prepareSemanticGenerationIntent(request, { ...options, signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('counts content preparation time against the same execution limit instead of starting a fresh clock for generation', async () => {
    const request = semanticGenerationExample(), content = contentPort()
    let now = 0
    const mixed = content.mixed
    content.mixed = async (...args) => { const result = await mixed(...args); now = 300001; return result }
    await expect(generateSemanticProject(request, { authorization: authorization(request), profile: taskBudgetProfile('small'), content, validation,
      runtime: { ids: { nextId: () => 'clock' }, clock: { now: () => '2026-11-09T00:00:00.000Z' } }, nowMilliseconds: () => now,
    })).rejects.toThrow(/时间|activeExecutionMs/)
  })

  it('rejects a miswired content adapter instead of executing another environment under forest authorization', async () => {
    const request = semanticGenerationExample(), content = contentPort(), original = content.mixed
    content.mixed = async (...args) => {
      const result = await original(...args)
      return { ...result, defaults: defaultMixedInput(domainExecutionFixture('volcano').base, 'volcano') }
    }
    await expect(prepareSemanticGenerationIntent(request, { authorization: authorization(request), profile: taskBudgetProfile('standard'), content,
      runtime: { ids: { nextId: () => 'miswired' }, clock: { now: () => '2026-11-09T00:00:00.000Z' } },
    })).rejects.toThrow(/环境|尺寸/)
  })
})
