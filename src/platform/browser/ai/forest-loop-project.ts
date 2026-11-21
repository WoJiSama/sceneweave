import { fromVerifiedBundle, toBundle } from '../../../application/workspace/project.js'
import { forestFurnitureNotes, prepareSemanticGenerationIntent, semanticGenerationRequestHash } from '../../../application/workspace/semantic-generation.js'
import type { GenerationPreviewOptions, MixedPreview, Workspace } from '../../../application/workspace/workspace.js'
import type { ForestLoopState } from '../../../shared/ai/forest-loop.js'
import { taskBudgetProfile } from '../../../shared/budget/task-budget.js'
import type { GenerationContentPort } from '../../../application/workspace/generation-intent.js'
import { defaultMixedInputV19 } from '../../../shared/generation/domains/mixed/index.js'
import { semanticGenerationRequestSchema, type SemanticGenerationRequest } from '../../../shared/generation/semantic-request.js'
import { exportProject, importProject } from '../../../shared/project/file.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { browserGenerationContent } from '../content/generation-intent.js'
import { exportPng } from '../render/renderer.js'
import { runtime, validation } from '../runtime.js'
import type { ForestLoopCandidate } from './forest-loop.js'
import type { ForestCandidateFile, ForestLoopStore } from './forest-loop-store.js'

export function forestLoopProjects(workspace: Workspace, options: Pick<GenerationPreviewOptions, 'execute' | 'epoch'>, assertCurrent: () => void) {
  const previews = new Set<MixedPreview>()
  const files = new WeakMap<MixedPreview, ForestCandidateFile>()
  const hold = (preview: MixedPreview) => { previews.add(preview); return preview }
  const fileFor = (preview: MixedPreview) => {
    const file = files.get(preview)
    if (!file) throw new Error('缺少候选的完整保存资料。')
    return file
  }
  const read = (archive: Uint8Array, signal: AbortSignal) => importProject(archive, { ...validation, signal })
  const write = (project: MixedPreview['project'], signal: AbortSignal) => exportProject(toBundle(project), { ...validation, signal })
  const candidate = async (preview: MixedPreview, cold: ProjectBundle, archive: Uint8Array, seed: string, requestHash: string,
    signal: AbortSignal, parent?: { candidateId: string; roomId: string }): Promise<ForestLoopCandidate<MixedPreview>> => {
    const candidateId = projectContentHash(cold.project), diagnostics = preview.furnitureDiagnostics
    if (projectContentHash(toBundle(preview.project).project) !== candidateId || !diagnostics) throw new Error('候选冷读工程或家具诊断不一致。')
    const image = await exportPng(cold, { audience: 'player', longEdgePx: 2048 })
    signal.throwIfAborted(); assertCurrent()
    return { preview, archive, image, receipt: { candidateId, seed, requestHash, diagnostics,
      ...(parent ? { parentCandidateId: parent.candidateId, repairRoomId: parent.roomId } : {}),
      entities: { rooms: Object.keys(cold.project.document.rooms).length, props: Object.keys(cold.project.document.props).length },
      notes: forestFurnitureNotes(diagnostics, preview.report.notes).slice(0, 16).map(note => note.slice(0, 512)) } }
  }
  const prepare = (semantic: SemanticGenerationRequest, signal: AbortSignal, content: GenerationContentPort = browserGenerationContent) =>
    prepareSemanticGenerationIntent(semantic, { runtime, content,
      authorization: { capabilityId: semantic.capabilityId, contentId: 'builtin-mixed-forest@1', requestHash: semanticGenerationRequestHash(semantic) },
      profile: taskBudgetProfile('standard'), signal })
  const deliver = async (preview: MixedPreview, seed: string, requestHash: string, signal: AbortSignal, parent?: { candidateId: string; roomId: string }) => {
    const archive = await write(preview.project, signal)
    const result = await candidate(preview, await read(archive, signal), archive, seed, requestHash, signal, parent)
    const file: ForestCandidateFile = { archive, usage: preview.usage }
    if (!parent) {
      const { base, ...replay } = workspace.captureForestGenerationReplay(preview)
      file.replay = { ...replay, identityAllocation: [...replay.identityAllocation], baseArchive: await write(base, signal),
        profileHash: preview.profile.profileHash, input: preview.input }
    }
    files.set(preview, file)
    return result
  }
  const restore = async (store: ForestLoopStore, state: ForestLoopState, signal: AbortSignal) => {
    const candidates: ForestLoopCandidate<MixedPreview>[] = []
    for (const receipt of state.receipts) {
      signal.throwIfAborted(); assertCurrent()
      const file = await store.candidate(state.runId, receipt.candidateId)
      const cold = await read(file.archive, signal)
      if (projectContentHash(cold.project) !== receipt.candidateId) throw new Error('保存的完整工程与候选身份不符。')
      const archived = fromVerifiedBundle(cold, { signal })
      const parent = receipt.parentCandidateId ? { candidateId: receipt.parentCandidateId, roomId: receipt.repairRoomId! } : undefined
      const parentPreview = parent && candidates.find(row => row.receipt.candidateId === parent.candidateId)?.preview
      let preview: MixedPreview
      if (parent && parentPreview && !file.replay) {
        preview = await workspace.restoreForestLoopPreview(archived, file.usage, { kind: 'repair-furniture', parent: parentPreview, roomId: parent.roomId }, { signal })
      } else if (!parent && file.replay) {
        const { baseArchive, profileHash, input, ...replay } = file.replay
        const base = fromVerifiedBundle(await read(baseArchive, signal), { signal })
        const semantic = semanticGenerationRequestSchema.parse({ ...state.request, parameters: { ...state.request.parameters, seed: receipt.seed } })
        const layer = base.document.userLayers[input.parameters.building.layerId]
        if (!layer || layer.editLocked || layer.floorId !== input.parameters.building.floorId) throw new Error('原生成图层缺失或已变化。')
        const request = await prepare(semantic, signal, { ...browserGenerationContent, mixed: async ({ environment, seed }) => ({
          // ZIP JSON keys are sorted. Recover the layer selected by the original
          // intent before deriving the same defaults.
          base, defaults: defaultMixedInputV19({ ...base.document, userLayers: {
            [layer.id]: layer,
            ...base.document.userLayers,
          } }, environment, seed),
        }) })
        if (request.profile.profileHash !== profileHash || base.document.title !== semantic.parameters.title
          || canonicalJson(request.input) !== canonicalJson(input)) {
          throw new Error('候选固定需求或生成预算已变化。')
        }
        preview = await workspace.restoreForestLoopPreview(archived, file.usage, { kind: 'generate', request, replay }, { signal })
      } else throw new Error('候选保存资料与生成或修正动作不符。')
      hold(preview)
      const restored = await candidate(preview, cold, file.archive, receipt.seed, receipt.requestHash, signal, parent)
      if (canonicalJson(restored.receipt) !== canonicalJson(receipt)) throw new Error('候选诊断或修正记录与保存断点不符。')
      candidates.push(restored)
    }
    return candidates
  }
  return {
    restore, fileFor,
    async generate(semantic: SemanticGenerationRequest, signal: AbortSignal) {
      const request = await prepare(semantic, signal)
      assertCurrent(); signal.throwIfAborted()
      const preview = hold(await workspace.previewForestLoopGeneration(request, { ...options, signal }))
      return deliver(preview, semantic.parameters.seed, request.requestHash, signal)
    },
    async repair(parent: ForestLoopCandidate<MixedPreview>, roomId: string, signal: AbortSignal) {
      const preview = hold(await workspace.previewForestFurnitureRepair(parent.preview, roomId, { signal }))
      return deliver(preview, parent.receipt.seed, parent.receipt.requestHash, signal, { candidateId: parent.receipt.candidateId, roomId })
    },
    releaseExcept(selected?: MixedPreview) {
      for (const preview of previews) if (preview !== selected) workspace.cancelGeneration({ kind: 'new-project', domain: 'mixed', preview })
    },
  }
}
