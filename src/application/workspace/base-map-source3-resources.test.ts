import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { TASK_BUDGET_PROFILES } from '../../shared/budget/task-budget.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { prepareBaseMapRequestV3, executeBaseMapRequestV3 } from '../../shared/terrain-generation/base-map-v3.js'
import { canonicalJson, encodeUtf8 } from '../../shared/validation/json.js'
import { prepareBaseMapProject } from './base-map.js'
import { fromBundle } from './project.js'
import { NOW, pixelPng, runtime, validation } from './test-fixtures.js'

describe('source3 complete distinct resource replay', () => {
  it.each((['original','reversed','canonical'] as const).flatMap(ordering => (['structured','canonical'] as const).map(transport => ({ordering,transport}))))('replays distinct real PNG sources with $ordering maps over $transport transport', async ({ordering,transport}) => {
    const document = createRefinedBlankDocument('island', { title: 'distinct PNG closure', sceneId: runtime.ids.nextId(), now: NOW, widthMm: 24000, heightMm: 18000, preset: 'narrative' })
    const resources = new Map<string,Uint8Array>(), records: Record<string,{sha256:string;mimeType:'image/png';sizeBytes:number;pixelWidth:number;pixelHeight:number}> = {}
    for (const [i, asset] of Object.values(document.assets).entries()) {
      const bytes = pixelPng([i + 1, 108, 61, 255]), sha256 = sha256Bytes(bytes)
      Object.assign(asset, { sha256, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1 }); resources.set(sha256, bytes)
      records[sha256] = { sha256, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 }
    }
    if (ordering === 'reversed') document.materials = Object.fromEntries(Object.entries(document.materials).reverse())
    if (ordering === 'canonical') document.materials = Object.fromEntries(Object.entries(document.materials).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0))
    const content = createCompositionContent(document, runtime), text = 'Original unique PNG fixture', licenseHash = sha256Bytes(encodeUtf8(text))
    const base = await fromBundle({ project: { format: 'sceneweave-complete-project', schemaVersion: 2, ...content, assets: records,
      licenses: { [licenseHash]: { sha256: licenseHash, text } }, licenseBindings: inspectDependencies(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })), authoringSources: {} }, resources: createMemoryResources(resources) }, validation)
    const profile = TASK_BUDGET_PROFILES.small, request = prepareBaseMapRequestV3({ requestId: 'distinct-png-replay', workspaceSceneId: 'empty-workspace', checkpoint: 0, operationEpoch: 0,
      flowId: 'distinct-png-flow', profile, base: base.document, generation: { kind: 'terrain', input: { sceneId: base.document.sceneId, kind: 'island', seed: 'terrain-v1-0', algorithmVersion: 4, budgetProfileId: 'small', quality: 'standard' } } })
    const response = executeBaseMapRequestV3(request)
    const prepared = await prepareBaseMapProject(base, request, transport === 'canonical' ? JSON.parse(canonicalJson(response)) : response, { runtime, validation, source: 'worker',
      preservation: { sceneId: null, revision: null, contentHash: null, checkpoint: 0 }, generationExecution: { startedAt: NOW, activeRuntimeMs: 1, generationCalls: 1 } })
    expect(prepared.continuationError).toBeUndefined()
    expect(prepared.continuationSource?.version).toBe(3)
  }, 120000)
})
