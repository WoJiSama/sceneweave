import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { executeBaseMapWorkerRequest } from '../../platform/browser/terrain-generation/base-map-worker.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { executeBaseMapRequestV3, prepareBaseMapRequestV3 } from '../terrain-generation/base-map-v3.js'
import { runNaturalGeneration } from './natural-adapter.js'
function request() {
 const base = createShoreBlankDocument('island', { sceneId: 'natural-adapter6', title: '通用自然适配器', now: '2026-11-04T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' }, true)
 return prepareBaseMapRequestV3({ requestId: 'natural', flowId: 'flow', workspaceSceneId: base.sceneId, checkpoint: 0, operationEpoch: 1, profile: taskBudgetProfile('standard'), base,
 generation: { kind: 'terrain', input: { sceneId: base.sceneId, seed: 'terrain-v1-0', kind: 'island', widthMm: 24000, heightMm: 18000, algorithmVersion: 6, budgetProfileId: 'standard', quality: 'standard' } } })
}
describe('existing natural domain orchestration adapter', () => {
 it('preserves exact algorithm6 response and seed while extracting real typed facts', () => {
   const input = request(), direct = executeBaseMapRequestV3(input), adapted = runNaturalGeneration(input, { nowMilliseconds: () => 0 })
   expect(adapted.response).toEqual(direct)
   expect(executeBaseMapWorkerRequest(input)).toEqual(direct)
   expect(adapted.response.generation.input.seed).toBe('terrain-v1-0')
   expect(adapted.candidate.status).toBe('prepared'); expect(adapted.candidate.materializationRequired).toBe(true)
   for (const kind of ['support-surface', 'connection', 'prop-placement', 'material-binding']) expect(adapted.candidate.outputs.some(item => item.kind === kind), kind).toBe(true)
   expect(adapted.candidate.usage.fieldEvaluations).toBeGreaterThan(0)
   expect(adapted.candidate.usage.geometryPoints).toBeGreaterThan(0)
   expect(adapted.candidate.stages.map(stage => stage.stepId)).toEqual(['structure', 'connectivity', 'content', 'presentation'])
   expect(adapted.candidate.stages[1].beforeHash).toBe(adapted.candidate.stages[0].afterHash)
   expect(adapted.candidate.documentHash).toBe(adapted.candidate.stages[3].afterHash)
   expect(Object.isFrozen(adapted.response)).toBe(true)
 }, 30000)
 it('does not execute or publish when already cancelled', () => { expect(() => runNaturalGeneration(request(), { signal: { aborted: true }, nowMilliseconds: () => 0 })).toThrow(/取消/) })
})
