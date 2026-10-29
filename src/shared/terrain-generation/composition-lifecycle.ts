import type { SceneDocument } from '../model/scene.js'
import type { CompositionContent } from '../model/appearance.js'
import { canonicalJson } from '../validation/json.js'
import { effectiveAdjustments, equalCompositionValue } from '../appearance/graph.js'
import type { TerrainCompositionReference } from './composition-integrity.js'
import { compositionInputHash, compositionOutputHash, resolveCompositionEntity, resolveCompositionTarget, terrainRequirementInputHash } from './composition-integrity.js'

const same = (a: unknown, b: unknown): boolean => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const targetId = (ref: TerrainCompositionReference): string => ref.kind === 'surfaceOverlay' ? ref.parentId! : ref.entityId
const sameTarget = (a: TerrainCompositionReference, b: TerrainCompositionReference): boolean => a.kind === b.kind && a.entityId === b.entityId && a.parentId === b.parentId

/** Stop affected generation without rewriting its frozen inputs or receipts.
 * The return value counts changed metadata rows, not the expanded command cost.
 * Callers still charge terrainCommandCost for every individual command. */
export function pauseChangedCompositions(before: Readonly<SceneDocument>, next: SceneDocument, appearanceChanges: readonly TerrainCompositionReference[] = []): number {
  if (before.schemaVersion !== 4 || next.schemaVersion !== 4 || before.generation?.version !== 5 || next.generation?.version !== 5 || before.sceneId !== next.sceneId) return 0
  const previous = before.generation, current = next.generation
  const pause = new Set<string>(), invalidate = new Set<string>(), owners = new Set<string>()
  for (const row of Object.values(current.compositions)) {
    const prior = previous.compositions[row.id]
    // New candidates and explicit detachments are owned by their own operation.
    if (!prior || prior.state === 'detached' || row.state === 'detached') continue
    const dependencies = Object.values(current.dependencies).filter(dependency => dependency.compositionId === row.id)
    const preservedChanged = dependencies.some(dependency => dependency.reads.some(read => read.role === 'preserve'
      && (!same(resolveCompositionTarget(before, read.target), resolveCompositionTarget(next, read.target))
        || appearanceChanges.some(ref => sameTarget(ref, read.target)))))
    const outputChanged = !same(prior.outputRefs, row.outputRefs)
      || row.outputRefs.some(ref => !same(resolveCompositionEntity(before, ref), resolveCompositionEntity(next, ref)))
      || compositionOutputHash(before, prior) !== compositionOutputHash(next, row)
      || appearanceChanges.some(ref => row.outputRefs.some(output => sameTarget(ref, output)))
    const inputChanged = compositionInputHash(before, prior) !== compositionInputHash(next, row)
    let requirementsChanged = false
    for (const check of Object.values(current.checks)) {
      if (!row.requirementIds.includes(check.requirementId)) continue
      const requirement = current.requirements[check.requirementId], priorRequirement = previous.requirements[check.requirementId]
      if (requirement && (!priorRequirement || terrainRequirementInputHash(before, priorRequirement) !== terrainRequirementInputHash(next, requirement))) {
        requirementsChanged = true
        if (check.state !== 'unchecked') invalidate.add(check.id)
      }
    }
    if (outputChanged || inputChanged || preservedChanged || requirementsChanged) {
      if (row.state === 'active') pause.add(row.id)
      // A changed managed field also invalidates the existing checks even if
      // its geometry hash does not include that appearance/source parameter.
      for (const check of Object.values(current.checks)) if (row.requirementIds.includes(check.requirementId) && check.state !== 'unchecked') invalidate.add(check.id)
      if (pause.has(row.id) || [...invalidate].some(id => row.requirementIds.includes(current.checks[id].requirementId))) owners.add(row.id)
    }
  }
  // Check the complete implicit metadata write set before installing any row.
  for (const id of owners) {
    const row = previous.compositions[id]
    if (row.editLocked || before.userLayers[row.layerId]?.editLocked) throw new Error(`地貌组合或其图层已锁定，不能隐式暂停生成：${id}。`)
  }
  if (!pause.size && !invalidate.size) return 0
  next.generation = { ...current,
    compositions: Object.fromEntries(Object.entries(current.compositions).map(([id, row]) => [id, pause.has(id) ? { ...row, state: 'paused' as const } : row])),
    checks: Object.fromEntries(Object.entries(current.checks).map(([id, row]) => [id, invalidate.has(id) ? { ...row, state: 'unchecked' as const } : row])),
  }
  return pause.size + invalidate.size
}

/** Graph edits happen before bitmap materialization; compare their real
 * effective target values now, then compare resolved document fields later. */
export function pauseChangedCompositionAppearance(before: CompositionContent, next: CompositionContent): number {
  if (before.document.schemaVersion !== 4 || next.document.generation?.version !== 5) return 0
  const changes: TerrainCompositionReference[] = []
  const references = Object.values(next.document.generation.compositions).flatMap(row => row.outputRefs)
    .concat(Object.values(next.document.generation.dependencies).flatMap(dependency => dependency.reads
      .filter(read => read.role === 'preserve' && ['appearance', 'surface'].includes(read.target.fieldGroup)).map(read => read.target)))
  const seen = new Set<string>()
  for (const ref of references) {
    const id = targetId(ref), prop = ref.kind === 'prop', surface = ['room', 'wall', 'terrainArea', 'terrainEdge', 'terrainConnection', 'path', 'surfaceOverlay'].includes(ref.kind)
    if ((!prop && !surface) || seen.has(id)) continue
    seen.add(id)
    const key = prop ? 'propSources' : 'surfaceSources', previousSource = before.appearance[key][id], nextSource = next.appearance[key][id]
    if (previousSource !== nextSource || !equalCompositionValue(effectiveAdjustments(before, id), effectiveAdjustments(next, id))) changes.push({ ...ref, fieldGroup: prop ? 'appearance' : 'surface' })
  }
  return pauseChangedCompositions(before.document, next.document, changes)
}
