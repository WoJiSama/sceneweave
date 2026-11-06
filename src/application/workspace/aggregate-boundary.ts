import type { CompositionCommand } from '../../shared/model/appearance.js'
import { AGGREGATE_CONTRACT, AGGREGATE_ENTITY_COLLECTIONS, type AggregateContract, type AggregateEntityRef } from '../../shared/model/aggregate.js'
import type { BoundsMm, SceneDocument } from '../../shared/model/scene.js'
import { createAggregateBoundaryInspector, type AggregateBoundaryImpact } from '../../shared/aggregates/boundary.js'
import { aggregateEntityKey, aggregateSceneSource } from '../../shared/aggregates/contracts.js'
import { aggregateAffectedClosure, type AggregateAffectedClosure } from '../../shared/aggregates/relations.js'
import { deriveAggregateEntityEnvelopes, type AggregateSpatialEnvelope } from '../../shared/aggregates/spatial.js'
import { inspectBuildingChanges, isBuildingCommand } from '../../shared/commands/building.js'
import { canonicalJson, freezeJson } from '../../shared/validation/json.js'
import { getVerifiedEditableProject, toBundle, type EditableProject } from './project.js'

/** Session-only GM diagnostics. Neither baseline proofs nor spatial envelopes
 * certify candidate invariants or permit skipping the command validators. */
export interface AggregateEditBoundaryImpact {
  groups: readonly AggregateBoundaryImpact[]
  dependencyClosure: AggregateAffectedClosure
  /** Missing envelopes are explicit, never interpreted as empty geometry. */
  unboundedTargets: readonly AggregateEntityRef[]
  requiresSceneWideFallback: boolean
  requiresFullDomainValidation: true
}
type Inspector = ReturnType<typeof createAggregateBoundaryInspector>
interface Baseline { inspector: Inspector; owners: Map<string, string>; descendants: Map<string, Set<string>> }
const baselines = new WeakMap<EditableProject, Baseline>()
// History may retain old wrappers. Only the latest inspected baseline retains
// its spatial snapshot; revisiting an undo wrapper rebuilds the context.
let latestBaseline: EditableProject | undefined
const key = aggregateEntityKey
const exists = (scene: SceneDocument, ref: AggregateEntityRef) => Object.hasOwn(scene[AGGREGATE_ENTITY_COLLECTIONS[ref.kind]] ?? {}, ref.id)
const unique = (refs: readonly AggregateEntityRef[]) => [...new Map(refs.map(ref => [key(ref), ref])).values()]
const overlaps = (a: BoundsMm, b: BoundsMm) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
function boundsOf(rows: readonly AggregateSpatialEnvelope[]): BoundsMm | undefined {
  if (!rows.length) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { boundsMm: bounds } of rows) {
    minX = Math.min(minX, bounds.x); minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width); maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  const x = Math.floor(minX), y = Math.floor(minY), right = Math.ceil(maxX), bottom = Math.ceil(maxY)
  const width = right - x, height = bottom - y
  return [x, y, right, bottom, width, height].every(Number.isSafeInteger) && width >= 0 && height >= 0 ? { x, y, width, height } : undefined
}
function baselineFor(project: EditableProject): Baseline {
  const cached = baselines.get(project)
  if (cached) return cached
  const scene = project.document, groups = scene.aggregateCoordinates!.groups
  const owners = new Map<string, string>(), descendants = new Map<string, Set<string>>()
  for (const group of Object.values(groups)) {
    for (const ref of group.members) owners.set(key(ref), group.id)
    descendants.set(group.id, new Set([group.id]))
  }
  for (const child of Object.values(groups)) {
    let parent = child.parentId
    while (parent !== null) { descendants.get(parent)!.add(child.id); parent = groups[parent].parentId }
  }
  const contract: AggregateContract = { contract: AGGREGATE_CONTRACT, source: aggregateSceneSource(scene),
    groups, ports: {}, chunkSizeMm: 10000, chunks: [] }
  const baseline = { owners, descendants, inspector: createAggregateBoundaryInspector(toBundle(project).project, contract,
    { operation: 'ordinary-aggregate-edit', bounds: 'physical-and-visual' }, 'workspace-edit-boundary@1') }
  if (latestBaseline) baselines.delete(latestBaseline)
  baselines.set(project, baseline); latestBaseline = project
  return baseline
}
function supported(command: CompositionCommand): boolean {
  if (command.type === 'updateProp') {
    const fields = Object.keys(command.changes)
    return fields.length > 0 && fields.every(field => field === 'positionMm' || field === 'rotationDeg')
  }
  return isBuildingCommand(command) || ['moveVertex', 'setWallThickness', 'reverseWall', 'splitWall'].includes(command.type)
}

/** Called only after complete candidate materialization. Ownership comes from
 * the verified persisted baseline; proposals cannot create diagnostic authority. */
export function inspectAggregateEdit(
  project: EditableProject, draft: SceneDocument, commands: readonly CompositionCommand[],
): AggregateEditBoundaryImpact | undefined {
  if (!getVerifiedEditableProject(project) || !commands.length || !commands.every(supported)) return
  const scene = project.document, coordinates = scene.aggregateCoordinates
  if (!coordinates || coordinates.encoding !== 'world' || draft.sceneId !== scene.sceneId) return
  const roots: AggregateEntityRef[] = [], refsById = new Map<string, AggregateEntityRef[]>()
  for (const [kind, collection] of Object.entries(AGGREGATE_ENTITY_COLLECTIONS)) {
    const before: Record<string, unknown> = scene[collection] ?? {}, after: Record<string, unknown> = draft[collection] ?? {}
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const ref = { kind: kind as AggregateEntityRef['kind'], id }
      refsById.set(id, [...(refsById.get(id) ?? []), ref])
      if (canonicalJson(before[id] ?? null) !== canonicalJson(after[id] ?? null)) roots.push(ref)
    }
  }
  // Entrance edits live in constraints, outside the entity records.
  if (commands.some(command => command.type === 'setEntranceOpenings')) {
    const before = scene.constraints.entranceOpeningIds, after = draft.constraints.entranceOpeningIds
    for (const id of new Set([...before, ...after])) if (before.includes(id) !== after.includes(id)) roots.push({ kind: 'opening', id })
  }
  if (!roots.length) return
  const actualRoots = unique(roots), structural = commands.some(command => command.type !== 'updateProp')
  // Forward attachment/support context is essential for newly added openings
  // and reattachments; a reverse-only graph cannot discover their owning wall.
  const scope = structural ? unique([...actualRoots, ...inspectBuildingChanges(scene, draft, actualRoots.map(ref => ref.id)).affectedIds.flatMap(id => refsById.get(id) ?? [])]) : actualRoots
  const afterClosure = aggregateAffectedClosure(draft, scope)
  const baseline = baselineFor(project), beforeClosure = baseline.inspector.affectedClosure(scope)
  const groupIds = [...new Set([...scope, ...beforeClosure.affected, ...afterClosure.affected]
    .filter((ref): ref is AggregateEntityRef => ref.kind !== 'floor')
    .flatMap(ref => baseline.owners.get(key(ref)) ?? []))].sort()
  if (!groupIds.length) return
  const affected = unique([...beforeClosure.affected, ...afterClosure.affected].filter((ref): ref is AggregateEntityRef => ref.kind !== 'floor'))
  const invalidated = new Set(affected.map(key))
  const previousRows = deriveAggregateEntityEnvelopes(scene, affected), nextRows = deriveAggregateEntityEnvelopes(draft, affected)
  const previousKeys = new Set(previousRows.map(row => key(row.entity as AggregateEntityRef)))
  const nextKeys = new Set(nextRows.map(row => key(row.entity as AggregateEntityRef)))
  const unboundedTargets = affected.filter(ref => ref.kind === 'decoration' || exists(scene, ref) && !previousKeys.has(key(ref)) || exists(draft, ref) && !nextKeys.has(key(ref)))
  const unknownTargets = unique([...beforeClosure.unknownTargets, ...afterClosure.unknownTargets]
    .filter((ref): ref is AggregateEntityRef => ref.kind !== 'floor' && !exists(scene, ref) && !exists(draft, ref)))
  const unresolvedReferences = [...new Map([...beforeClosure.unresolvedReferences, ...afterClosure.unresolvedReferences].map(row => [canonicalJson(row), row])).values()]
  const requiresSceneWideFallback = unboundedTargets.length > 0 || unknownTargets.length > 0 || unresolvedReferences.length > 0
  const mergedClosure: AggregateAffectedClosure = { ...beforeClosure, roots: actualRoots, affected,
    spatialReviewFloors: [...new Set([...beforeClosure.spatialReviewFloors, ...afterClosure.spatialReviewFloors])].sort(),
    unknownTargets, unresolvedReferences, requiresSceneWideFallback }
  // Keep the baseline's exact cached closure when the candidate graph is equal.
  const dependencyClosure = canonicalJson(mergedClosure) === canonicalJson(beforeClosure) ? beforeClosure : freezeJson(mergedClosure)
  const groups = groupIds.map(groupId => {
    const group = coordinates.groups[groupId], included = baseline.descendants.get(groupId)!
    const internal = (ref: AggregateEntityRef) => included.has(baseline.owners.get(key(ref)) ?? '')
    const ownBefore = previousRows.filter(row => row.entity.kind !== 'floor' && internal(row.entity))
    const ownAfter = nextRows.filter(row => row.entity.kind !== 'floor' && internal(row.entity))
    // Missing envelopes or unsafe rounded ranges conservatively widen to the
    // Floor. Full validators still cover non-indexed geometry and other domains.
    const fallback = unboundedTargets.some(internal)
    const previousBoundsMm = !fallback && boundsOf(ownBefore) || scene.floors[group.floorId].boundsMm
    const nextBoundsMm = !fallback && boundsOf(ownAfter) || draft.floors[group.floorId].boundsMm
    const impact = baseline.inspector.inspect({ groupId, floorId: group.floorId, previousBoundsMm, nextBoundsMm, changedTargets: scope })
    const next = [...impact.externalCandidates.next.filter(row => row.entity.kind === 'floor' || !invalidated.has(key(row.entity))),
      ...nextRows.filter(row => row.floorId === group.floorId && row.entity.kind !== 'floor' && !internal(row.entity) && overlaps(row.boundsMm, nextBoundsMm))]
    return freezeJson({ ...impact, externalCandidates: { previous: impact.externalCandidates.previous, next } })
  })
  return freezeJson({ groups, dependencyClosure, unboundedTargets, requiresSceneWideFallback, requiresFullDomainValidation: true })
}
