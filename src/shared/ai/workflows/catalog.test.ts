import { describe, expect, it } from 'vitest'
import { assertWorkflowBinding, getWorkflow, listWorkflows, queryWorkflow, workflowBinding, workflowCapabilityHash, WORKFLOW_DISCOVERY_INSTRUCTIONS } from './catalog.js'
import { harnessWorkflowHost, pageWorkflowHost, toolWorkflowHost } from './hosts.js'
import { parseSemanticGenerationRequest } from '../../generation/semantic-request.js'

describe('shared workflow discovery', () => {
  it('exposes actual host operations without inheriting page or another host permissions', () => {
    const chat = toolWorkflowHost('conversation', [])
    const image = listWorkflows(chat, 'image')[0]
    expect(image.capabilities.every(value => value.state === 'not-connected')).toBe(true)
    const forest = listWorkflows(chat, 'forest')[0]
    expect(forest.capabilities.every(value => value.state === 'page-only')).toBe(true)
    const imageHost = toolWorkflowHost('image-mcp', [{ name: 'image_import_workflow', parameters: {} }])
    expect(listWorkflows(imageHost, 'image')[0].capabilities.find(value => value.id === 'image-read')?.state).toBe('available')
    expect(listWorkflows(imageHost, 'image')[0].capabilities.find(value => value.id === 'image-select')?.state).toBe('not-connected')
    expect(workflowCapabilityHash(chat)).not.toBe(workflowCapabilityHash(imageHost))
    const emptyImage = toolWorkflowHost('image-mcp', [{ name: 'image_import_item_preview', parameters: {} }], { hasImageItems: false })
    expect(listWorkflows(emptyImage, 'image')[0].capabilities.find(value => value.id === 'image-preview')?.state).toBe('missing-input')
    expect(listWorkflows(toolWorkflowHost('authoring', [{ name: 'sceneweave_read_scene', parameters: {} }], { remainingToolCalls: 0 }), 'edit')[0].capabilities[0].state).toBe('budget-exhausted')
  })

  it('keeps brief discovery separate from detailed procedures and uses the existing strict semantic schema', () => {
    const host = harnessWorkflowHost(), read = queryWorkflow({ action: 'read', workflowId: 'sceneweave-forest-building' }, host)
    expect(JSON.stringify(read)).not.toContain('工作流发现不授予')
    const step = queryWorkflow({ action: 'step', workflowId: 'sceneweave-forest-building', stepId: 'generate' }, host)
    expect(JSON.stringify(step)).toContain('工作流发现不授予')
    const schema = queryWorkflow({ action: 'schema', workflowId: 'sceneweave-forest-building' }, host)
    expect('example' in schema && parseSemanticGenerationRequest(schema.example)).toBeTruthy()
    expect(JSON.stringify(read).length).toBeLessThan(8192)
    expect(WORKFLOW_DISCOVERY_INSTRUCTIONS).not.toContain('subject-contour-v1')
    expect(listWorkflows(pageWorkflowHost(), 'unavailable-made-up-tool')).toEqual([])
  })

  it('rejects stale definitions, arbitrary authority fields and unknown selectors without reading accessors', () => {
    const binding = workflowBinding('sceneweave-image-items'), host = pageWorkflowHost()
    expect(assertWorkflowBinding(binding)).toEqual(binding)
    expect(() => assertWorkflowBinding({ ...binding, definitionHash: '0'.repeat(64) })).toThrow('定义已变化')
    expect(() => queryWorkflow({ action: 'read', workflowId: binding.id, definitionHash: '0'.repeat(64) }, host)).toThrow('摘要已变化')
    expect(() => queryWorkflow({ action: 'step', workflowId: binding.id, stepId: 'fake' }, host)).toThrow('未知步骤')
    expect(() => queryWorkflow({ action: 'read', workflowId: 'fake' }, host)).toThrow('未知工作流')
    expect(() => queryWorkflow({ action: 'list', capabilities: { edit: true } }, host)).toThrow()
    let reads = 0
    expect(() => queryWorkflow({ get action() { reads++; return 'list' } }, host)).toThrow()
    expect(reads).toBe(0)
    expect(() => { getWorkflow(binding.id).steps.push({} as never) }).toThrow()
  })

  it('reports bounded redacted live checkpoints and keeps historic/unknown quality explicit', () => {
    const host = toolWorkflowHost('conversation', [], { progress: { taskId: 'existing-task', generation: 7, status: 'paused',
      baselineHash: null, draftRevision: null, lastTool: { name: 'sceneweave_workflow', success: false }, unknown: true, remainingToolCalls: 2 } })
    expect(queryWorkflow({ action: 'progress' }, host)).toMatchObject({ progress: { taskId: 'existing-task', generation: 7, unknown: true } })
    const evidence = queryWorkflow({ action: 'effects', workflowId: 'sceneweave-forest-building' }, host)
    expect(evidence).toMatchObject({ timing: null, cost: null, userAcceptance: 'unverified', effects: expect.arrayContaining([
      expect.objectContaining({ status: 'historical', previews: [] }),
      expect.objectContaining({ status: 'partial', previews: [expect.objectContaining({ audience: 'player', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })] }),
    ]) })
  })
})
