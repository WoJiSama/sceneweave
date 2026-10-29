import { z } from 'zod'
import { applyAuthoringStep, publicAuthoringContext, replayAuthoring } from '../../src/shared/ai/authoring.js'
import { AUTHORING_LIMITS } from '../../src/shared/ai/authoring-protocol.js'
import { TerrainAuthoringOperationSchema, TerrainCandidatesArgumentsSchema, TerrainApplyArgumentsSchema, RegionSceneCandidateArgumentsSchema } from '../../src/shared/ai/terrain-protocol.js'
import { regionalSceneCandidate, TerrainAuthoringRestrictedError } from '../../src/shared/ai/terrain-authoring.js'
import { utf8Size } from '../../src/shared/ai/protocol.js'
import { sha256Text } from '../../src/shared/validation/hash.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import type { ProviderToolCall } from './provider-types.js'
import type { StoredTask, StoredTerrainCandidate } from './store.js'
import { selectNewTerrainGenerationVersion } from './terrain-generation-version.js'

const TerrainRegionOperationSchema = z.discriminatedUnion('kind', [TerrainAuthoringOperationSchema.options[1], TerrainAuthoringOperationSchema.options[2]])

/** Prepares detached output and a deferred installation; caller checks the final wrapper first. */
export function prepareTerrainTool(task: StoredTask, call: ProviderToolCall, args: unknown): { output: unknown; install?: () => void } {
  const authoring = task.authoring!, scope = authoring.start.scope.scene
  if (!scope) throw new TerrainAuthoringRestrictedError()
  if (call.name === 'sceneweave_terrain_plan' || call.name === 'sceneweave_terrain_diagnose') {
    z.object({}).strict().parse(args)
    const replayed = replayAuthoring(authoring.start, authoring.state.steps), scene = replayed.project.document
    const context = (publicAuthoringContext(authoring.start, authoring.state) as { scene?: { entities?: { id: string; entityKind?: string }[] } }).scene
    return { output: { mapMode: scene.mapMode ?? 'scene', completeVersion: replayed.project.schemaVersion,
      allowedOperations: scope.operations.filter(kind => ['terrainGenerate', 'terrainEdit', 'terrainLocal', 'regionalGenerate', 'regionalEdit'].includes(kind)),
      boundsMm: scope.boundsMm, floorId: scope.floorId, layerIds: [...new Set([scope.layerId, ...(scope.generationLayerIds ?? [])])],
      publicTargets: context?.entities?.map(({ id, entityKind }) => ({ id, entityKind })).slice(0, 16) ?? [],
      readMore: 'Use bounded scene pages for actual authorized entities. Candidate preparation enforces the complete dependency closure.',
      prerequisites: ['Complete v3/v4 project prepared locally', 'Explicit scene operation, Floor, bounds, layers and fixed palette', 'Public complete dependency closure; restricted inputs produce a fixed rejection'],
      remainingOperations: AUTHORING_LIMITS.operations - authoring.state.operationCost, appearance: 'unconfirmed', reachability: 'not_proven',
      disposition: 'task completion is not local adoption, save, publication or P3 acceptance' } }
  }
  if (call.name === 'sceneweave_terrain_candidates' || call.name === 'sceneweave_terrain_regenerate_region') {
    const operations = (call.name === 'sceneweave_terrain_candidates' ? TerrainCandidatesArgumentsSchema.parse(args).operations : [TerrainRegionOperationSchema.parse(args)])
      .map(selectNewTerrainGenerationVersion)
    const candidates: StoredTerrainCandidate[] = []
    for (const [index, operation] of operations.entries()) {
      // A fixed private replay step makes deterministic births independent of
      // provider call IDs and later apply-call identifiers.
      const stepId = `terrain-preview-${sha256Text(canonicalJson([authoring.state.contentHash, operation]))}`
      const preview = applyAuthoringStep(authoring.start, authoring.state, [operation], stepId)
      const hash = sha256Text(canonicalJson({ operation, atContentHash: authoring.state.contentHash, contentHash: preview.state.contentHash }))
      candidates.push({ id: `terrain-candidate-${hash}`, hash, atContentHash: authoring.state.contentHash, atDraftRevision: authoring.state.draftRevision,
        operation, contentHash: preview.state.contentHash, operationCost: preview.state.operationCost - authoring.state.operationCost })
      void index
    }
    if (utf8Size(JSON.stringify(candidates)) > 196608) throw new Error('操作预算上限')
    return { output: { candidates: candidates.map(candidate => ({ candidateId: candidate.id, candidateHash: candidate.hash, kind: candidate.operation.kind, atContentHash: candidate.atContentHash, atDraftRevision: candidate.atDraftRevision,
      actualOperationCost: candidate.operationCost, remainingOperationsAfterEdit: AUTHORING_LIMITS.operations - authoring.state.operationCost - candidate.operationCost })),
      appearance: 'unconfirmed', disposition: 'private bounded replay recipes; no draft step adopted; apply one exact candidate on this baseline' },
      install: () => { authoring.terrainCandidates = candidates } }
  }
  if (call.name === 'sceneweave_terrain_apply_candidate') {
    const parsed = TerrainApplyArgumentsSchema.parse(args), candidate = authoring.terrainCandidates?.find(value => value.id === parsed.candidateId)
    if (!candidate || candidate.hash !== parsed.candidateHash || candidate.atContentHash !== parsed.atContentHash || candidate.atDraftRevision !== parsed.atDraftRevision
      || authoring.state.contentHash !== parsed.atContentHash || authoring.state.draftRevision !== parsed.atDraftRevision) throw new TerrainAuthoringRestrictedError()
    const result = applyAuthoringStep(authoring.start, authoring.state, [candidate.operation], call.id)
    if (result.state.contentHash !== candidate.contentHash || result.state.operationCost - authoring.state.operationCost !== candidate.operationCost
      || sha256Text(canonicalJson({ operation: candidate.operation, atContentHash: candidate.atContentHash, contentHash: result.state.contentHash })) !== candidate.hash) throw new TerrainAuthoringRestrictedError()
    return { output: { draftRevision: result.state.draftRevision, contentHash: result.state.contentHash, operationCost: result.state.operationCost,
      changedCount: result.state.changedIds.length, remainingOperations: AUTHORING_LIMITS.operations - result.state.operationCost, disposition: 'isolated draft only; local replay, review, protected adoption and save remain required' },
      install: () => { authoring.state = result.state; authoring.terrainCandidates = [] } }
  }
  if (call.name === 'sceneweave_region_scene_candidate') {
    const parsed = RegionSceneCandidateArgumentsSchema.parse(args), replayed = replayAuthoring(authoring.start, authoring.state.steps), allowed = new Set([...scope.entityIds, ...authoring.state.changedIds])
    const result = regionalSceneCandidate(replayed.project, scope, allowed, parsed.request)
    if (utf8Size(JSON.stringify(result)) > 524288) throw new Error('操作预算上限')
    const candidateHash = result.hash, candidateId = `regional-scene-${candidateHash}`
    return { output: { candidateId, candidateHash, atContentHash: authoring.state.contentHash, atDraftRevision: authoring.state.draftRevision,
      scopeHash: sha256Text(canonicalJson(scope)), sourceSceneId: parsed.request.sourceSceneId, sceneId: result.document.sceneId, selectionMm: parsed.request.selectionMm, actualOperationCost: result.cost.total,
      publicInputHash: result.sourceLink.publicInputHash, appearance: 'unconfirmed', disposition: 'independent private candidate only; local create/switch, resource validation, protected preservation and save are still required' },
      install: () => { authoring.regionSceneCandidate = { id: candidateId, hash: candidateHash, atContentHash: authoring.state.contentHash,
        atDraftRevision: authoring.state.draftRevision, scopeHash: sha256Text(canonicalJson(scope)), result } } }
  }
  throw new Error('未授权工具')
}
