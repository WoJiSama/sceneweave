import type { CompositionCommand } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import { MANUAL_TRANSACTION_BUDGET, assertCommandBudget, measureCommandBudget, type CommandBudgetMetadata, type CommandBudgetUsage } from '../budget/command-budget.js'
import { BUDGET_DIMENSIONS, emptyBudgetUsage, type BudgetUsage } from '../budget/task-budget.js'
import { canonicalJson } from '../validation/json.js'

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
export const pathAttachmentRowsChanged = (before: SceneDocument, after: SceneDocument): boolean => !same(before.pathAttachments ?? {}, after.pathAttachments ?? {})

/** Shared-owner coverage is deliberately broader than the UI's direct request
 * estimate. Only commands whose native meaning cannot write a relation are
 * exempt; unknown/derived geometry commands keep the actual-step meter. */
export function mayMutatePathAttachments(scene: SceneDocument, commands: readonly CompositionCommand[]): boolean {
  if (!Object.keys(scene.pathAttachments ?? {}).length) return commands.some(command => command.type === 'bindPathAttachment')
  return commands.some(command => {
    switch (command.type) {
      case 'updateProp': case 'addProp': case 'copyProp': case 'deleteProp': case 'replacePropAppearance':
      case 'setVisualSurface': case 'setSurfacePaint': case 'setSurfaceMaterial':
      case 'setAppearanceAdjustment': case 'toggleAppearanceAdjustment': case 'removeAppearanceAdjustment': case 'setAppearanceSource':
      case 'setSceneDisplay': case 'setSceneBackground': case 'renameScene': case 'setFloorEnvironment': case 'setFloorOutputBounds': case 'renameFloor':
      case 'setVisualEnvironment': return false
      case 'setEditLock': return command.kind === 'pathAttachment'
      case 'updatePath': return !Object.keys(command.changes).every(key => ['surfaceStyle', 'renderOrder', 'movementCostMultiplier'].includes(key))
      case 'updateOpening': return !Object.keys(command.changes).every(key => ['state', 'locked'].includes(key))
      default: return true
    }
  })
}

/** Conservative UI admission only. Actual step deltas remain authoritative. */
export function requestsPathAttachmentTransaction(scene: SceneDocument, commands: readonly CompositionCommand[]): boolean {
  const rows = Object.values(scene.pathAttachments ?? {})
  const paths = new Set(rows.map(row => row.pathId)), openings = new Set(rows.map(row => row.openingId))
  const walls = new Set(rows.map(row => row.anchor.wallId)), rooms = new Set(rows.map(row => row.anchor.roomId))
  const vertices = new Set(rows.flatMap(row => [...row.anchor.wallVertexIds, ...row.anchor.roomBoundaryVertexIds]))
  const supports = new Set(rows.flatMap(row => scene.paths[row.pathId]?.supportRefs.map(ref => ref.id) ?? []))
  return commands.some(command => {
    if (command.type === 'bindPathAttachment' || command.type === 'detachPathAttachment') return true
    if (command.type === 'setEditLock') return command.kind === 'pathAttachment'
    if (!rows.length) return false
    switch (command.type) {
      case 'deleteOutdoorEntity': return command.kind === 'path' && paths.has(command.id)
      case 'updatePath': return paths.has(command.id) && ['floorId', 'centerlineMm', 'widthMm', 'supportRefs', 'visibility'].some(key => Object.hasOwn(command.changes, key))
      case 'updateOpening': return openings.has(command.id) && ['wallId', 'offsetReferenceVertexId', 'offsetMm', 'widthMm', 'kind', 'secret', 'revealed'].some(key => Object.hasOwn(command.changes, key))
      case 'setWallThickness': case 'reverseWall': case 'splitWall': case 'deleteWall': return walls.has(command.id)
      case 'moveVertex': return vertices.has(command.id)
      case 'updateRoom': case 'deleteRoom': return rooms.has(command.id)
      case 'updateTerrainArea': case 'setTerrainElevation': return supports.has(command.id)
      case 'moveTerrainPoint': return supports.has(command.areaId)
      case 'transformBuilding': case 'transformAggregateBuilding': case 'transformAggregateNatural': return true
      default: return mayMutatePathAttachments(scene, [command])
    }
  })
}

/** Private transaction meter. Real relation changes activate the fixed policy;
 * every earlier/later step remains charged even if the final delta is empty. */
export function createPathAttachmentTransactionBudget() {
  const work = emptyBudgetUsage(), retained = emptyBudgetUsage(), observed = emptyBudgetUsage()
  let active = false, groupMembers = 0, externalDependencies = 0
  const add = (a: number, b: number): number => {
    if (!Number.isSafeInteger(b) || b < 0 || !Number.isSafeInteger(a + b)) throw new Error('门路事务累计计量无效。')
    return a + b
  }
  const usage = (): CommandBudgetUsage => {
    const result = { ...work }
    for (const key of ['assetBytes', 'decodePixels', 'dependencyRefs'] as const) result[key] = retained[key]
    for (const key of BUDGET_DIMENSIONS) {
      if (key === 'dependencyRefs') result[key] = Math.max(result[key], observed[key])
      else result[key] = add(result[key], observed[key])
    }
    return { ...result, groupMembers, externalDependencies }
  }
  const check = () => { if (active) assertCommandBudget(MANUAL_TRANSACTION_BUDGET, usage()) }
  return {
    get active() { return active },
    activate(changed: boolean) { active ||= changed; check() },
    observeExecution(delta: Partial<BudgetUsage>) {
      for (const [key, value] of Object.entries(delta) as [keyof BudgetUsage, number][]) {
        if (!BUDGET_DIMENSIONS.includes(key)) throw new Error('门路事务执行计量维度无效。')
        observed[key] = add(observed[key], value)
      }
      check()
    },
    step(before: SceneDocument, after: SceneDocument, metadata?: CommandBudgetMetadata) {
      active ||= pathAttachmentRowsChanged(before, after)
      const delta = measureCommandBudget(before, after, metadata, undefined, MANUAL_TRANSACTION_BUDGET)
      for (const key of BUDGET_DIMENSIONS) {
        if (key === 'assetBytes' || key === 'decodePixels' || key === 'dependencyRefs') retained[key] = Math.max(retained[key], delta[key])
        else work[key] = add(work[key], delta[key])
      }
      groupMembers = Math.max(groupMembers, delta.groupMembers ?? 0)
      externalDependencies = Math.max(externalDependencies, delta.externalDependencies ?? 0)
      check()
    },
    finish() { check(); return usage() },
  }
}
export type PathAttachmentTransactionBudget = ReturnType<typeof createPathAttachmentTransactionBudget>
