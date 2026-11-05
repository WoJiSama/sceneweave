import type { SceneDocument } from '../model/scene.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { executeBaseMapRequestV3, parseBaseMapRequestV3, type BaseMapRequestV3, type BaseMapResponseV3 } from '../terrain-generation/base-map-v3.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { generationArtifactSchema, type ArtifactInput, type ArtifactKind, type GenerationCandidate, type GenerationPhase, type GenerationRequest } from './contracts.js'
import { GenerationRegistry, runGeneration, type GenerationExecutionOptions } from './orchestrator.js'
import { createSpaceContext } from './space.js'

/** First domain bridge: execute the existing exact natural algorithm, then
 * expose typed temporary facts by phase. The original full protocol response
 * remains the materialization input; this bridge cannot install an engineer's
 * scene, resources, history or workspace state. It preserves the old seed. */
export function runNaturalGeneration(raw: BaseMapRequestV3, options: Pick<GenerationExecutionOptions, 'signal' | 'nowMilliseconds'>): { readonly candidate: GenerationCandidate; readonly response: BaseMapResponseV3 } {
  const domain = parseBaseMapRequestV3(raw), registry = new GenerationRegistry()
  const replayVersion = domain.generation.kind === 'terrain' ? domain.generation.input.algorithmVersion : domain.generation.input.recipeVersion
  let response: BaseMapResponseV3 | undefined, complete: SceneDocument | undefined, facts: readonly ArtifactInput[] = []
  const phaseKinds: Record<GenerationPhase, readonly ArtifactKind[]> = { structure: ['support-surface', 'wall', 'reserved-zone', 'plan-region'], connectivity: ['opening', 'port', 'connection', 'access-zone'], content: ['footprint', 'prop-placement'], presentation: ['material-binding'] }
  const phaseOrder = ['structure', 'connectivity', 'content', 'presentation'] as const
  const operatorId = (phase: GenerationPhase) => `natural-base-map3:${domain.algorithm.id}:${phase}`
  for (let index = 0; index < phaseOrder.length; index++) {
    const phase = phaseOrder[index]
    const register = phase === 'structure' ? registry.registerNaturalReplayBridge.bind(registry) : registry.register.bind(registry)
    register({ id: operatorId(phase), version: replayVersion, phase, owner: phase, consumes: phase === 'structure' ? [] : ['support-surface'], produces: phaseKinds[phase], requires: index ? [{ id: operatorId(phaseOrder[index - 1]), version: replayVersion }] : [],
      determinism: { replayVersion, seedDerivation: 'request/recipe/step/operator/key' },
      parseParameters(input) { if (Object.keys(input).length) throw new Error('自然适配器没有任意参数入口。'); return {} },
      ...(phase === 'structure' ? { materialize() { if (!complete) throw new Error('自然算法未生成完整候选。'); return complete } } : {}),
      run(context) {
        context.checkCancelled()
        if (phase === 'structure') {
          // Existing domain ownership: no algorithm fallback and no seed rewrite.
          response = executeBaseMapRequestV3(domain)
          if (response.result.kind === 'composition') complete = response.result.document
          else if ('document' in response.result.terrain) complete = response.result.terrain.document
          else complete = composeTerrainDocument(domain.base, response.result.terrain, `base-map3-${domain.inputHash}`, domain.profile).document
          context.checkCancelled()
          facts = createSpaceContext(complete, 'candidate').artifacts.map(fact => {
            const { contentHash: _hash, ...input } = fact
            return generationArtifactSchema.parse(captureJson(input))
          })
        }
        if (phase !== 'structure') facts = context.space.artifacts.map(fact => { const { contentHash: _hash, ...input } = fact; return generationArtifactSchema.parse(captureJson(input)) })
        return { outputs: facts.filter(fact => phaseKinds[phase].includes(fact.kind)) }
      },
    })
  }
  const recipe = registry.registerRecipe({ id: `natural-base-map3:${domain.algorithm.id}`, version: replayVersion, steps: phaseOrder.map((phase, index) => ({ id: phase, operator: { id: operatorId(phase), version: replayVersion }, required: true, parameters: {},
    dependsOn: index ? [...new Set(['structure', phaseOrder[index - 1]])] : [], inputs: phase === 'structure' ? [] : [{ id: 'supports', kind: 'support-surface', from: { kind: 'step', stepId: 'structure', operator: { id: operatorId('structure'), version: replayVersion } }, cardinality: { min: 1, max: 8192 }, coordinateFrame: 'scene-mm' }],
  })) })
  const request: GenerationRequest = { requestVersion: 1, target: { kind: 'new-project' }, coordinateFrame: 'scene-mm', intent: { environment: domain.generation.kind === 'terrain' ? domain.generation.input.kind : domain.generation.input.preset, structures: [], purposes: [], tags: [] }, intentSource: { kind: 'manual', contentHash: domain.inputHash }, normalizationVersion: 1, hardConstraints: [], softGoals: [], seed: domain.generation.input.seed, budgetProfile: domain.profile, recipe }
  const candidate = runGeneration(request, registry, { ...options, source: domain.base })
  if (!response) throw new Error('自然算法没有协议结果。')
  return freezeJson({ candidate, response })
}
