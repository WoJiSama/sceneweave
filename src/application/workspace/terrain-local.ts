import type { CompleteValidationOptions, ResourceOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import { syncAppearanceGraph } from '../../shared/appearance/graph.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import { sha256Text } from '../../shared/geometry/scatter.js'
import { terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { prepareTerrainLocalRefresh, type TerrainLocalRefreshRequest, type TerrainLocalRefreshResult } from '../../shared/terrain-generation/local.js'
import { materializeProject } from './prepare.js'
import { getVerifiedEditableProject, validateEditableProject, type EditableProject } from './project.js'

export interface TerrainLocalPreview {
  project: EditableProject
  document: SceneDocument
  result: TerrainLocalRefreshResult
  input: TerrainLocalRefreshRequest
  cost: ReturnType<typeof terrainCommandCost>
  checkpoint: number
  currentSceneId: string
  currentRevision: number
  baseContentHash: string
}

const allIds = (value: unknown, ids = new Set<string>()): Set<string> => {
  if (!value || typeof value !== 'object') return ids
  if (Array.isArray(value)) { value.forEach(item => allIds(item, ids)); return ids }
  const row = value as Record<string, unknown>
  if (typeof row.id === 'string') ids.add(row.id)
  Object.values(row).forEach(item => allIds(item, ids)); return ids
}

/** Replay-safe identity allocation for a candidate and its adoption. */
function deterministicRuntime(base: SceneDocument, request: TerrainLocalRefreshRequest, runtime: PreparationContext): PreparationContext {
  const used = allIds(base), prefix = `terrain-local-${sha256Text(canonicalJson({ sceneId: base.sceneId, request })).slice(0, 20)}`
  let sequence = 0
  return { clock: runtime.clock, ids: { nextId: () => { let id = `${prefix}-${sequence++}`; while (used.has(id)) id = `${prefix}-${sequence++}`; used.add(id); return id } } }
}

export interface TerrainLocalPrepareOptions {
  runtime: PreparationContext
  validation: CompleteValidationOptions
  signal?: ResourceOptions['signal']
  result?: TerrainLocalRefreshResult
}

export async function prepareTerrainLocalRefreshProject(base: EditableProject, input: TerrainLocalRefreshRequest, options: TerrainLocalPrepareOptions): Promise<{
  project: EditableProject
  document: SceneDocument
  result: TerrainLocalRefreshResult
  input: TerrainLocalRefreshRequest
  cost: ReturnType<typeof terrainCommandCost>
}> {
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  checkCancelled(validation.signal)
  const owned = getVerifiedEditableProject(base) ?? await validateEditableProject(base, validation)
  if (owned.document.schemaVersion !== 4) throw new Error('局部地形联动需要完整v4工程。')
  const result = prepareTerrainLocalRefresh(owned.document, captureJson(input))
  if (options.result && canonicalJson(result) !== canonicalJson(captureJson(options.result))) throw new Error('局部联动结果与确定性重放不符。')
  checkCancelled(validation.signal)
  const identity = advanceHistoryIdentity(owned.historyIdentity, owned.document, result.document, deterministicRuntime(owned.document, result.request, options.runtime))
  const content = syncAppearanceGraph({ document: result.document, historyIdentity: identity, appearance: owned.appearance }, owned.document)
  const project = await materializeProject({ ...owned, ...content, schemaVersion: 4 }, { runtime: deterministicRuntime(owned.document, result.request, options.runtime), validation, signal: validation.signal, baseline: owned })
  checkCancelled(validation.signal)
  const cost = terrainCommandCost(owned.document, project.document, { before: owned, after: project })
  if (cost.total > 256) throw new Error(`局部联动实际展开${cost.total}，超过256；请缩小范围。`)
  return { project, document: project.document, result, input: result.request, cost }
}
