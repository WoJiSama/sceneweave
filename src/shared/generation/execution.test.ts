import { describe, expect, expectTypeOf, it } from 'vitest'
import { domainExecutionFixture } from '../../../tools/testing/domain-execution-fixtures.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { runInteriorGeneration } from './domains/interior/index.js'
import { runForestGeneration } from './domains/forest/index.js'
import { runVolcanoGeneration } from './domains/volcano/index.js'
import {
  createDomainExecutionRequest, parseDomainExecutionRequest, executeDomainExecutionRequest, parseDomainExecutionResponse,
  domainGenerationCapabilities, parseDomainGenerationCapabilities, DOMAIN_GENERATION_LIMITS,
  type DomainExecutionResponse, type DomainGenerationKind,
} from './execution.js'

const context = { workspaceId: 'd7-workspace', checkpoint: 3, epoch: 2 }
function request(domain: Exclude<DomainGenerationKind, 'mixed'>) {
  return createDomainExecutionRequest({ requestId: `request-${domain}`, context, domain, ...domainExecutionFixture(domain) })
}
const direct = (domain: Exclude<DomainGenerationKind, 'mixed'>) => {
  const { base, input, profile } = domainExecutionFixture(domain), options = { profile, nowMilliseconds: () => 0 }
  if (domain === 'interior') return runInteriorGeneration(base, input, options)
  if (domain === 'forest') return runForestGeneration(base, input, options)
  return runVolcanoGeneration(base, input, options)
}

describe('strict common domain execution', () => {
  it('retains the exact domain response type for a typed request and keeps unknown transport input broad', () => {
    const prepared = createDomainExecutionRequest({ requestId: 'typed-interior', context, domain: 'interior', ...domainExecutionFixture('interior') })
    const typed = () => executeDomainExecutionRequest(prepared, { nowMilliseconds: () => 0 })
    const transport: unknown = prepared, untyped = () => executeDomainExecutionRequest(transport, { nowMilliseconds: () => 0 })
    expectTypeOf<ReturnType<typeof typed>>().toEqualTypeOf<DomainExecutionResponse<'interior'>>()
    expectTypeOf<ReturnType<typeof untyped>>().toEqualTypeOf<DomainExecutionResponse>()
  })

  it.each(['interior', 'forest', 'volcano'] as const)('executes the exact shared %s implementation and preserves its spatial handoff', domain => {
    const prepared = request(domain), before = canonicalJson(prepared)
    const response = executeDomainExecutionRequest(prepared, { nowMilliseconds: () => 0 })
    const result = direct(domain)
    expect(response.result.resultHash).toBe(result.resultHash)
    expect(response.result.candidate.document).toEqual(result.candidate.document)
    expect(response.result.report).toEqual(result.report)
    expect(response.result.candidate.outputs).toEqual(result.candidate.outputs)
    expect(response.result.candidate.stages).toEqual(result.candidate.stages)
    expect(parseDomainExecutionResponse(response, prepared)).toEqual(response)
    expect(canonicalJson(prepared)).toBe(before)
    expect(Object.isFrozen(response.result.candidate.document)).toBe(true)
  }, 30000)

  it('normalizes demand ordering before binding one exact request and refuses hash or version repairs', () => {
    const fixture = domainExecutionFixture('interior')
    const first = createDomainExecutionRequest({ requestId: 'normalized', context, domain: 'interior', ...fixture })
    fixture.input.parameters.rooms.reverse()
    const second = createDomainExecutionRequest({ requestId: 'normalized', context, domain: 'interior', ...fixture })
    expect(first).toEqual(second)
    expect(parseDomainExecutionRequest(first)).toEqual(first)
    for (const mutate of [
      (value: Record<string, unknown>) => { value.requestHash = 'f'.repeat(64) },
      (value: Record<string, unknown>) => { value.protocolVersion = 2 },
      (value: Record<string, unknown>) => { value.domain = 'cave' },
      (value: Record<string, unknown>) => { value.unregistered = true },
      (value: Record<string, unknown>) => { (value.context as typeof context).epoch++ },
      (value: Record<string, unknown>) => { (value.base as { title: string }).title = 'tampered' },
      (value: Record<string, unknown>) => { (value.input as { seed: string }).seed = 'tampered' },
      (value: Record<string, unknown>) => { (value.profile as { profileHash: string }).profileHash = 'f'.repeat(64) },
    ]) {
      const changed = cloneJson(first) as unknown as Record<string, unknown>
      mutate(changed)
      expect(() => parseDomainExecutionRequest(changed)).toThrow()
    }
    let accesses = 0
    const accessor = { ...cloneJson(first) }
    Object.defineProperty(accessor, 'input', { enumerable: true, get() { accesses++; return fixture.input } })
    expect(() => parseDomainExecutionRequest(accessor)).toThrow()
    expect(accesses).toBe(0)
  })

  it('bounds a request before execution and observes cancellation without publishing a response', () => {
    const first = request('interior'), oversized = cloneJson(first) as unknown as Record<string, unknown>
    oversized.unregistered = 'x'.repeat(DOMAIN_GENERATION_LIMITS.requestBytes + 1)
    expect(() => parseDomainExecutionRequest(oversized)).toThrow()
    expect(() => executeDomainExecutionRequest(first, { nowMilliseconds: () => 0, signal: { aborted: true } })).toThrow()
  })

  it('binds results to their exact context and validates typed scene, stage and output hashes', () => {
    const prepared = request('interior'), response = executeDomainExecutionRequest(prepared, { nowMilliseconds: () => 0 })
    for (const mutate of [
      (value: Record<string, unknown>) => { value.requestId = 'another-request' },
      (value: Record<string, unknown>) => { (value.context as typeof context).checkpoint++ },
      (value: Record<string, unknown>) => { value.domain = 'forest' },
      (value: Record<string, unknown>) => { value.unregistered = true },
      (value: Record<string, unknown>) => { (value.result as { resultHash: string }).resultHash = 'f'.repeat(64) },
      (value: Record<string, unknown>) => { ((value.result as { candidate: { sourceHash: string } }).candidate).sourceHash = 'f'.repeat(64) },
      (value: Record<string, unknown>) => { ((value.result as { candidate: { outputHash: string } }).candidate).outputHash = 'f'.repeat(64) },
      (value: Record<string, unknown>) => { ((value.result as { candidate: { document: { title: string } } }).candidate).document.title = 'tampered' },
      (value: Record<string, unknown>) => { ((value.result as { candidate: { unregistered?: boolean } }).candidate).unregistered = true },
    ]) {
      const changed = cloneJson(response) as unknown as Record<string, unknown>
      mutate(changed)
      expect(() => parseDomainExecutionResponse(changed, prepared)).toThrow()
    }
    const elapsed = cloneJson(response)
    ;(elapsed.result.candidate.usage as { activeExecutionMs: number }).activeExecutionMs += 1
    expect(parseDomainExecutionResponse(elapsed, prepared).result.resultHash).toBe(response.result.resultHash)
  }, 30000)

  it.each(['direct', 'worker', 'server'] as const)('strictly negotiates the actual %s domain capability envelope', executor => {
    const capabilities = domainGenerationCapabilities(executor)
    expect(parseDomainGenerationCapabilities(capabilities, executor)).toEqual(capabilities)
    expect(() => parseDomainGenerationCapabilities({ ...cloneJson(capabilities), aiAuthority: true }, executor)).toThrow()
    expect(() => parseDomainGenerationCapabilities(capabilities, executor === 'server' ? 'worker' : 'server')).toThrow()
  })
})
