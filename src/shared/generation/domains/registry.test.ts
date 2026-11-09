import { describe, expect, it } from 'vitest'
import { domainExecutionFixture } from '../../../../tools/testing/domain-execution-fixtures.js'
import { cloneJson } from '../../validation/json.js'
import { createDomainExecutionRequest, domainGenerationCapabilities, executeDomainExecutionRequest, parseDomainExecutionResponse } from '../execution.js'
import { domainGenerationKinds, generationDomains } from './registry.js'

describe('static domain registration and exact response contracts', () => {
  it('keeps transport algorithms and local capability order derived from the registered domain owners', () => {
    const capabilities = domainGenerationCapabilities('direct')
    expect(capabilities.domains).toEqual(domainGenerationKinds.map(domain => ({ domain, algorithm: generationDomains[domain].algorithm, target: 'new-project' })))
    expect(capabilities.localOperations).toEqual(domainGenerationKinds.flatMap(domain => [...generationDomains[domain].localOperations]))
    expect(new Set(capabilities.localOperations).size).toBe(capabilities.localOperations.length)
    expect(domainGenerationCapabilities('worker').localOperations).toEqual([])
  })

  it.each(domainGenerationKinds)('binds the %s schema to its own normalized input and rejects another domain report', domain => {
    const fixture = domainExecutionFixture(domain), registration = generationDomains[domain]
    const request = createDomainExecutionRequest({ requestId: `registry-${domain}`, context: { workspaceId: 'registry', checkpoint: 0, epoch: 1 }, domain, ...fixture })
    expect(request.input).toEqual(registration.normalize(fixture.input))
    expect(request.input.algorithmVersion).toBe(registration.algorithm.version)
    const response = executeDomainExecutionRequest(request, { nowMilliseconds: () => 0 })
    expect(registration.resultSchema.safeParse(response.result).success).toBe(true)
    for (const other of domainGenerationKinds.filter(other => other !== domain)) expect(generationDomains[other].resultSchema.safeParse(response.result).success, `${domain} must not match ${other}`).toBe(false)
    const altered = cloneJson(response)
    Object.assign(altered.result.report, { unknownField: 'must be rejected' })
    expect(() => parseDomainExecutionResponse(altered, request)).toThrow()
  }, 30000)
})
