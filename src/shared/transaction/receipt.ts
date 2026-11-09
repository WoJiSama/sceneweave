import type { CompositionContent, CompositionCommand } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import { AGGREGATE_ENTITY_COLLECTIONS } from '../model/aggregate.js'
import { structureTopology } from '../history/structure-continuity.js'
import { visualTopology } from '../history/visual-continuity.js'
import { cloneJson, freezeJson } from '../validation/json.js'

/** Session-only descriptions. These types and helpers cannot issue validation,
 * edit authority or a trusted receipt; issuance belongs to the command owner. */
export type TransactionSlot = { readonly present: false } | { readonly present: true; readonly value: unknown }
export interface TransactionWrite { readonly path: readonly string[]; readonly before: TransactionSlot; readonly after: TransactionSlot }
export interface TransactionTarget { readonly collection: string; readonly id: string }
export interface TransactionDependency {
  readonly owner: 'building' | 'outdoor' | 'prop' | 'entity-relations'
  readonly kind: 'domain-scope' | 'support' | 'attachment' | 'geometry' | 'layer-lock' | 'entity-lock' | 'fixed-definition'
  readonly from: TransactionTarget
  readonly to: TransactionTarget
  readonly field: string
}
export interface TransactionIdentityEvent {
  readonly kind: 'created' | 'removed' | 'topology' | 'identity-record'
  readonly target: TransactionTarget
  readonly before: TransactionSlot
  readonly after: TransactionSlot
}
export interface TransactionInvalidation {
  readonly structureIds: readonly string[]
  readonly visualIds: readonly string[]
  readonly changedTargets: readonly TransactionTarget[]
  /** Explicit edges do not cover spatial contact, appearance or generation. */
  readonly requiresFullProjection: boolean
}
export interface TransactionExecutionScope {
  readonly owner: 'building' | 'outdoor' | 'prop' | 'unknown'
  readonly affectedIds: readonly string[]
}
export interface TransactionStep {
  readonly phase: 'command' | 'reconcile' | 'materialize' | 'revision'
  readonly command?: Readonly<CompositionCommand>
  readonly before: CompositionContent
  readonly after: CompositionContent
  readonly writes: readonly TransactionWrite[]
  readonly dependencies: readonly TransactionDependency[]
  readonly identityEvents: readonly TransactionIdentityEvent[]
  readonly invalidation: TransactionInvalidation
  readonly commandCost: number
}
export interface TransactionReceipt {
  readonly baseline: CompositionContent
  readonly result: CompositionContent
  readonly steps: readonly TransactionStep[]
  /** Net writes are separate from the ordered work, including reverted edits. */
  readonly changes: readonly TransactionWrite[]
  readonly dependencies: readonly TransactionDependency[]
  readonly identityEvents: readonly TransactionIdentityEvent[]
  readonly invalidation: TransactionInvalidation
  readonly resources: { readonly status: 'unchanged' | 'changed'; readonly writes: readonly TransactionWrite[]; readonly requiresByteValidation: true }
  /** Actual expanded work, including reverted/no-op steps. Manual semantic
   * admission remains the owning budget meter's separately checked usage. */
  readonly budget: { readonly operationCost: number; readonly commandCosts: readonly number[] }
  readonly validation: { readonly mode: 'prop-proof' | 'full'; readonly dependencyCoverage: 'explicit' | 'full-fallback' }
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export function equalTransactionValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, index) => equalTransactionValue(value, right[index]))
  if (!record(left) || !record(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalTransactionValue(left[key], right[key]))
}
export function transactionSlot(value: unknown, path: readonly string[]): TransactionSlot {
  let current = value
  for (const key of path) {
    if (!record(current) || !Object.hasOwn(current, key)) return { present: false }
    current = current[key]
  }
  return { present: true, value: current }
}
const equalSlot = (left: TransactionSlot, right: TransactionSlot) => left.present === right.present && (!left.present || right.present && equalTransactionValue(left.value, right.value))

/** One comparison at the executor observation boundary. This is deliberately
 * the full-validation fallback, not an incremental-validation claim. Arrays
 * remain atomic, matching the persistent delta contract. */
export function describeTransactionWrites(before: unknown, after: unknown, prefix: readonly string[] = []): TransactionWrite[] {
  const result: TransactionWrite[] = []
  const visit = (left: unknown, right: unknown, path: readonly string[]) => {
    if (left === right) return
    if (record(left) && record(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        const a = Object.hasOwn(left, key), b = Object.hasOwn(right, key), child = [...path, key]
        if (a && b) visit(left[key], right[key], child)
        else result.push({ path: child, before: a ? { present: true, value: left[key] } : { present: false }, after: b ? { present: true, value: right[key] } : { present: false } })
      }
    } else if (!equalTransactionValue(left, right)) result.push({ path, before: { present: true, value: left }, after: { present: true, value: right } })
  }
  visit(before, after, prefix)
  return result
}

/** Collapse the already observed path union, never rediscover the whole delta. */
export function netTransactionWrites(before: unknown, after: unknown, writes: readonly TransactionWrite[]): TransactionWrite[] {
  const paths = [...new Map(writes.map(write => [JSON.stringify(write.path), write.path])).values()].sort((a, b) => a.length - b.length)
  const roots: (readonly string[])[] = []
  for (const path of paths) if (!roots.some(root => root.every((part, i) => path[i] === part))) roots.push(path)
  return roots.flatMap(path => {
    const left = transactionSlot(before, path), right = transactionSlot(after, path)
    return equalSlot(left, right) ? [] : [{ path, before: left, after: right }]
  })
}

const entityCollections = new Set<string>(Object.values(AGGREGATE_ENTITY_COLLECTIONS))
const structureCollections = new Set(['vertices', 'rooms', 'walls', 'openings', 'notes'])
const structures = new WeakMap<SceneDocument, Map<string, string>>()
const visuals = new WeakMap<SceneDocument, Map<string, string>>()
const topology = (scene: SceneDocument, cache: WeakMap<SceneDocument, Map<string, string>>, read: typeof structureTopology) => {
  let result = cache.get(scene)
  if (!result) { result = read(scene); cache.set(scene, result) }
  return result
}
const targetKey = (target: TransactionTarget) => JSON.stringify([target.collection, target.id])
const uniqueTargets = (targets: readonly TransactionTarget[]) => [...new Map(targets.map(target => [targetKey(target), target])).values()]
function changedTargets(writes: readonly TransactionWrite[]): TransactionTarget[] {
  return uniqueTargets(writes.flatMap(write => write.path[0] === 'document' && entityCollections.has(write.path[1]) && write.path.length >= 3
    ? [{ collection: write.path[1], id: write.path[2] }] : []))
}
function findTarget(scene: SceneDocument, id: string): TransactionTarget | undefined {
  for (const collection of entityCollections) if (Object.hasOwn((scene as unknown as Record<string, Record<string, unknown>>)[collection] ?? {}, id)) return { collection, id }
}
function explicitDependencies(scene: SceneDocument, target: TransactionTarget): TransactionDependency[] {
  const entity = transactionSlot(scene, [target.collection, target.id])
  if (!entity.present || !record(entity.value)) return []
  const value = entity.value, result: TransactionDependency[] = []
  const add = (kind: TransactionDependency['kind'], collection: string, id: unknown, field: string) => {
    if (typeof id === 'string') result.push({ owner: 'entity-relations', kind, from: target, to: { collection, id }, field })
  }
  const support = (ref: unknown, field: string) => {
    if (record(ref)) add('support', ref.kind === 'room' ? 'rooms' : ref.kind === 'terrainArea' ? 'terrainAreas' : 'floors', ref.id, field)
  }
  support(value.supportRef, 'supportRef')
  if (Array.isArray(value.supportRefs)) value.supportRefs.forEach(ref => support(ref, 'supportRefs'))
  if (record(value.from)) support(value.from.surfaceRef, 'from.surfaceRef')
  if (record(value.to)) support(value.to.surfaceRef, 'to.surfaceRef')
  add('support', 'rooms', value.roomId, 'roomId')
  add('attachment', 'walls', value.wallId, 'wallId')
  add('attachment', 'openings', value.openingId, 'openingId')
  for (const field of ['startVertexId', 'endVertexId', 'offsetReferenceVertexId']) add('geometry', 'vertices', value[field], field)
  if (Array.isArray(value.boundaryVertexIds)) value.boundaryVertexIds.forEach(id => add('geometry', 'vertices', id, 'boundaryVertexIds'))
  if (record(value.source)) add('attachment', 'terrainAreas', value.source.areaId, 'source.areaId')
  add('attachment', 'terrainAreas', value.neighborAreaId, 'neighborAreaId')
  if (record(value.definitionRef) && ['props', 'decorations', 'prefabInstances'].includes(target.collection))
    add('fixed-definition', target.collection === 'prefabInstances' ? 'prefabDefinitions' : 'propDefinitions', value.definitionRef.id, 'definitionRef')
  if (record(value.anchor) && value.anchor.type === 'entity' && typeof value.anchor.entityKind === 'string') {
    const collection = (AGGREGATE_ENTITY_COLLECTIONS as Record<string, string>)[value.anchor.entityKind]
    if (collection) add('attachment', collection, value.anchor.entityId, 'anchor')
  }
  const layer = scene.entityLayers[target.id]
  add('layer-lock', 'userLayers', layer, 'entityLayers')
  add('entity-lock', target.collection, target.id, 'editLocked')
  return result
}

/** Inputs are owned executor snapshots. Scope comes from the actual domain
 * command result, including unchanged read dependencies, never caller IDs. */
export function describeTransactionStep(before: CompositionContent, after: CompositionContent, phase: TransactionStep['phase'], command: Readonly<CompositionCommand> | undefined,
  commandCost: number, scope: TransactionExecutionScope = { owner: 'unknown', affectedIds: [] }, observedWrites?: readonly TransactionWrite[]): TransactionStep {
  const writes = observedWrites ?? describeTransactionWrites(before, after), targets = changedTargets(writes)
  const dependencies: TransactionDependency[] = []
  for (const scene of [before.document, after.document]) {
    const reads = uniqueTargets([...targets, ...scope.affectedIds.map(id => findTarget(scene, id) ?? { collection: 'unresolved', id })])
    for (const target of reads) dependencies.push(...explicitDependencies(scene, target))
    if (scope.owner !== 'unknown') for (const target of reads) dependencies.push({ owner: scope.owner, kind: 'domain-scope', from: targets[0] ?? target, to: target, field: '*' })
  }
  const identityEvents: TransactionIdentityEvent[] = []
  for (const write of writes) {
    const [root, collection, id] = write.path
    if (root === 'historyIdentity' && id) identityEvents.push({ kind: 'identity-record', target: { collection, id }, before: write.before, after: write.after })
    else if (root === 'document' && entityCollections.has(collection) && id && write.path.length === 3 && write.before.present !== write.after.present)
      identityEvents.push({ kind: write.after.present ? 'created' : 'removed', target: { collection, id }, before: write.before, after: write.after })
  }
  const structureIds: string[] = [], visualIds: string[] = []
  const inspectTopology = (cache: WeakMap<SceneDocument, Map<string, string>>, read: typeof structureTopology, ids: string[], collection: string) => {
    const left = topology(before.document, cache, read), right = topology(after.document, cache, read)
    for (const id of new Set([...left.keys(), ...right.keys()])) if (left.get(id) !== right.get(id)) {
      ids.push(id)
      identityEvents.push({ kind: 'topology', target: { collection, id }, before: left.has(id) ? { present: true, value: left.get(id) } : { present: false }, after: right.has(id) ? { present: true, value: right.get(id) } : { present: false } })
    }
  }
  if (writes.some(write => write.path[0] === 'document' && structureCollections.has(write.path[1]))) inspectTopology(structures, structureTopology, structureIds, 'structure')
  if (writes.some(write => write.path[0] === 'document' && write.path[1] === 'visual')) inspectTopology(visuals, visualTopology, visualIds, 'visual')
  return freezeJson({ phase, ...(command ? { command } : {}), before, after, writes, dependencies: [...new Map(dependencies.map(edge => [JSON.stringify(edge), edge])).values()], identityEvents,
    invalidation: { structureIds, visualIds, changedTargets: targets, requiresFullProjection: true }, commandCost })
}

const resourceWrite = (write: TransactionWrite) => write.path[0] === 'appearance' || write.path[0] === 'document'
  && ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes', 'regionalSymbolDefinitions'].includes(write.path[1])
/** Pure description assembly. Trust is held separately by the executor's
 * private registry, so copying this object never creates a credential. */
export function describeTransactionReceipt(baseline: CompositionContent, result: CompositionContent, steps: readonly TransactionStep[],
  operationCost: number, mode: TransactionReceipt['validation']['mode']): TransactionReceipt {
  const changes = netTransactionWrites(baseline, result, steps.flatMap(step => step.writes)), resources = changes.filter(resourceWrite)
  const commandCosts = steps.filter(step => step.phase === 'command').map(step => step.commandCost)
  return freezeJson({ baseline, result, steps, changes,
    dependencies: [...new Map(steps.flatMap(step => step.dependencies).map(edge => [JSON.stringify(edge), edge])).values()],
    identityEvents: steps.flatMap(step => step.identityEvents),
    invalidation: { structureIds: [...new Set(steps.flatMap(step => step.invalidation.structureIds))], visualIds: [...new Set(steps.flatMap(step => step.invalidation.visualIds))],
      changedTargets: uniqueTargets(steps.flatMap(step => step.invalidation.changedTargets)), requiresFullProjection: true },
    resources: { status: resources.length ? 'changed' : 'unchanged', writes: resources, requiresByteValidation: true },
    budget: { operationCost: Math.max(operationCost, commandCosts.reduce((sum, cost) => sum + cost, 0)), commandCosts },
    validation: { mode, dependencyCoverage: mode === 'prop-proof' ? 'explicit' : 'full-fallback' } })
}

/** Detach a mutable observation only when the executor cannot retain its own
 * immutable snapshot. This helper does not certify domain validity. */
export const captureTransactionContent = (input: CompositionContent): CompositionContent => freezeJson(cloneJson(input))
