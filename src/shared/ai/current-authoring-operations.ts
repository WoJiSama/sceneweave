import { applyCompositionCommands } from '../appearance/commands.js'
import { inspectOutdoorChanges } from '../commands/outdoor.js'
import { inspectDecorationChanges } from '../decorations/commands.js'
import { LAYER_ENTITY_COLLECTIONS, type Editable, type SceneDocument } from '../model/scene.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { ProjectData } from '../model/project.js'
import type { PreparationContext } from '../ports/runtime.js'
import type { TaskBudgetProfile } from '../budget/task-budget.js'
import { validateProjectData } from '../project/validate.js'
import { canonicalJson, captureJson } from '../validation/json.js'
import { assertPublicSceneEntity, currentSceneDependencyIds } from './scene-authoring.js'
import { CurrentExtraOperationSchema, type CurrentExtraOperation, type CurrentSceneAuthoringScope } from './authoring-protocol-v4.js'
import { CURRENT_AUTHORING_CAPABILITY, currentAuthoringOperationSupported } from './current-authoring-capability.js'

export const isCurrentExtraOperation = (value: { kind: string }): value is CurrentExtraOperation =>
  ['connectionRoute', 'connectionRouteUpdate', 'decorationCluster', 'decorationRegenerate', 'decorationUpdate', 'decorationDelete', 'decorationDetach', 'decorationClusterDelete'].includes(value.kind)
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort()
const entities = (scene: SceneDocument): Map<string, Editable> => new Map([
  ...LAYER_ENTITY_COLLECTIONS.flatMap(key => Object.values(scene[key]) as Editable[]), ...Object.values(scene.decorations ?? {}), ...Object.values(scene.decorationClusters ?? {}),
].map(row => [row.id, row]))
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const deny = (): never => { throw new Error('当前场景候选涉及未授权、私密、锁定或无效依赖，此步骤未采用。') }
/** New protocol only: same manual commands, with a frozen public grant around every real dependency. */
export function applyCurrentAuthoringOperation(project: ProjectData, scope: CurrentSceneAuthoringScope, raw: CurrentExtraOperation,
  context: PreparationContext, allowedIds: ReadonlySet<string>, budget?: TaskBudgetProfile) {
  const operation = CurrentExtraOperationSchema.parse(captureJson(raw))
  if (!scope.operations.includes(operation.kind) || !currentAuthoringOperationSupported(project, operation.kind)) deny()
  const before = project.document, allowed = new Set([...scope.entityIds, ...allowedIds]), old = entities(before)
  let command: CompositionCommand
  switch (operation.kind) {
    case 'connectionRoute': { const { kind: _kind, connectionKind, ...fields } = operation; command = { type: 'createTerrainConnection', ...fields, kind: connectionKind, floorId: scope.floorId, layerId: scope.layerId, visibility: 'public' }; break }
    case 'connectionRouteUpdate': command = { type: 'updateTerrainConnection', id: operation.id, changes: { route: operation.route } }; break
    case 'decorationCluster': {
      if (operation.palette.some(row => !scope.definitionIds.includes(row.definitionRef.id)
        || before.propDefinitions[row.definitionRef.id]?.version !== row.definitionRef.version)) deny()
      const { kind: _kind, ...fields } = operation
      command = { type: 'createDecorationCluster', ...fields, floorId: scope.floorId, layerId: scope.layerId, visibility: 'public' }; break
    }
    case 'decorationRegenerate': {
      const cluster = before.decorationClusters?.[operation.id]
      if (!cluster || cluster.palette.some(row => !scope.definitionIds.includes(row.definitionRef.id)
        || before.propDefinitions[row.definitionRef.id]?.version !== row.definitionRef.version)) deny()
      command = { type: 'regenerateDecorationCluster', id: operation.id }; break
    }
    case 'decorationUpdate': command = { type: 'updateDecoration', id: operation.id, changes: operation.changes }; break
    case 'decorationDelete': command = { type: 'deleteDecoration', id: operation.id }; break
    case 'decorationDetach': command = { type: 'detachDecorationMember', clusterId: operation.clusterId, entityId: operation.entityId }; break
    case 'decorationClusterDelete': command = { type: 'deleteDecorationCluster', id: operation.id }; break
  }
  const explicit = operation.kind === 'decorationDetach' ? [operation.clusterId, operation.entityId]
    : operation.kind === 'decorationCluster' || operation.kind === 'connectionRoute' ? [] : [operation.id]
  for (const id of explicit) if (!allowed.has(id) || !old.has(id)) deny()
  let next: ProjectData
  try {
    const content = applyCompositionCommands({ document: before, appearance: project.appearance, historyIdentity: project.historyIdentity }, [command], context, { budget })
    next = validateProjectData({ ...project, ...content, document: { ...content.document, revision: before.revision, updatedAt: before.updatedAt } })
  } catch { return deny() }
  const after = entities(next.document), createdIds = sorted([...after.keys()].filter(id => !old.has(id)))
  const writeIds = sorted([...new Set([...old.keys(), ...after.keys()])].filter(id => !same(old.get(id), after.get(id)) || before.entityLayers[id] !== next.document.entityLayers[id]))
  const impact = operation.kind.startsWith('decoration') ? inspectDecorationChanges(before, next.document)
    : inspectOutdoorChanges(before, next.document, writeIds)
  const affected = sorted([...impact.affectedIds, ...writeIds,
    ...currentSceneDependencyIds(before, [...impact.affectedIds, ...explicit]), ...currentSceneDependencyIds(next.document, [...impact.affectedIds, ...writeIds])])
  const read = new Set([scope.floorId, scope.layerId, ...scope.definitionIds])
  for (const id of affected) {
    if (old.has(id)) {
      if (!allowed.has(id)) deny()
      try { assertPublicSceneEntity(project, scope, id, CURRENT_AUTHORING_CAPABILITY).forEach(value => read.add(value)) } catch { deny() }
    }
    if (after.has(id)) {
      if (!old.has(id) && next.document.entityLayers[id] !== scope.layerId) deny()
      try { assertPublicSceneEntity(next, scope, id, CURRENT_AUTHORING_CAPABILITY).forEach(value => read.add(value)) } catch { deny() }
    }
  }
  // Every source stays frozen; no resource construction endpoint exists here.
  for (const key of ['assets', 'licenses', 'licenseBindings', 'authoringSources'] as const) if (!same(project[key], next[key])) deny()
  for (const key of ['assets', 'propDefinitions', 'prefabDefinitions', 'materials', 'styleThemes'] as const) if (!same(before[key], next.document[key])) deny()
  return { project: next, readIds: sorted(read), writeIds, createdIds, cost: Math.max(1, impact.commandCost) }
}
