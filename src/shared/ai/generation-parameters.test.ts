import { describe, expect, it } from 'vitest'
import { semanticGenerationExample } from '../generation/semantic-request.js'
import { generationParameterPrompt, generationParameterBaseline, parseGenerationParameterResponse } from './generation-parameters.js'

describe('natural language generation parameter drafts', () => {
  const current = semanticGenerationExample().parameters
  it('uses the same strict supported parameters and discloses retained form values', () => {
    const draft = parseGenerationParameterResponse(JSON.stringify({ parameters: { roomCount: 3, furniture: false }, ambiguities: ['具体房间用途待确认'], unsupported: ['不支持帐篷'] }), current)
    expect(draft.parameters).toEqual({ ...current, roomCount: 3, furniture: false })
    expect(draft.defaults).toContain('widthMm'); expect(draft.defaults).not.toContain('roomCount')
    expect(draft.unsupported).toEqual(['不支持帐篷'])
    expect(generationParameterBaseline(draft.parameters)).not.toBe(generationParameterBaseline(current))
  })
  it.each(['', '{"parameters":', '```json\n{}\n```', JSON.stringify({ parameters: { roomCount: 5 }, ambiguities: [], unsupported: [] }),
    JSON.stringify({ parameters: {}, ambiguities: [], unsupported: [] }),
    JSON.stringify({ parameters: { environment: 'volcano' }, ambiguities: [], unsupported: [] }),
    JSON.stringify({ parameters: { widthMm: 30000.5 }, ambiguities: [], unsupported: [] }),
    JSON.stringify({ parameters: { endpoint: 'https://example.invalid' }, ambiguities: [], unsupported: [] }),
    JSON.stringify({ parameters: {}, ambiguities: [], unsupported: [], execute: true }), ' '.repeat(8193)])('refuses malformed or unsupported model text without changing the form: %s', text => {
    expect(() => parseGenerationParameterResponse(text, current)).toThrow()
    expect(current).toEqual(semanticGenerationExample().parameters)
  })
  it('builds a bounded data-only prompt and validates the captured current form', () => {
    const prompt = generationParameterPrompt('三间房，40×32米，需要帐篷', current)
    expect(prompt).toContain('三间房'); expect(prompt).toContain('currentParameters')
    expect(prompt).toContain('不能缩减原要求后声称完成')
    expect(() => generationParameterPrompt('a'.repeat(6001), current)).toThrow()
    expect(() => generationParameterPrompt('需求', { ...current, roomCount: 0 })).toThrow()
  })
})
