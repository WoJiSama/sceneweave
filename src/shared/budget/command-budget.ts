import { z } from 'zod'
import type { AppearanceGraph, CompositionContent } from '../model/appearance.js'
import { LAYER_ENTITY_COLLECTIONS, type SceneDocument } from '../model/scene.js'
import { AGGREGATE_ENTITY_COLLECTIONS, type AggregateEntityRef, type AggregateFrame } from '../model/aggregate.js'
import { encodeSceneCoordinates } from '../aggregates/scene-coordinates.js'
import { aggregateWorldFrames } from '../aggregates/state.js'
import { worldToLocalPoint } from '../aggregates/coordinates.js'
import { aggregateEntityRelations } from '../aggregates/relations.js'
import { definitionPresentation, propPresentation } from '../appearance/presentation.js'
import { visualBase } from '../visual/base.js'
import { canonicalJson, captureJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { getCertifiedCompositionContent, getPropUpdateCompositionTransaction, getCompositionRevisionTransaction } from '../validation/content.js'
import { BUDGET_DIMENSIONS, BudgetUsageSchema, TASK_BUDGET_PROFILES, assertTaskBudget, measureTaskBudget,
  measureBudgetGeometry, measuredRetainedSegments, parseTaskBudgetProfile, semanticTargetEntries, type BudgetUsage, type TaskBudgetMetadata, type TaskBudgetProfile } from './task-budget.js'

/** Runtime admission policy only; never changes a saved document or an AI ledger. */
export const MANUAL_TRANSACTION_BUDGET = freezeJson({
  profileId: 'manual' as const, profileVersion: 3 as const, countingVersion: 2 as const,
  semanticTargets: 256 as const, groupMemberLimit: 4096 as const,
  limits: { ...TASK_BUDGET_PROFILES.small.limits, semanticTargets: 256,
    // Retained resources use the existing complete-project ceilings. A small
    // edit must not make an already valid bitmap closure ineligible to edit.
    assetBytes: 300 * 1024 * 1024, decodePixels: 64_000_000 },
})
export type ManualBudgetTier = 'compact' | 'standard' | 'expanded'
export interface ManualTransactionBudget {
  readonly profileId: 'manual'
  readonly profileVersion: 3
  readonly countingVersion: 2
  readonly tierId?: 'standard' | 'expanded'
  readonly semanticTargets: 256 | 512 | 1024
  readonly groupMemberLimit: 4096 | 16384 | 65536
  readonly limits: Readonly<BudgetUsage>
}
const manualTier = (tierId: 'standard' | 'expanded', semanticTargets: 512 | 1024, multiplier: number): ManualTransactionBudget => freezeJson({
  profileId: 'manual', profileVersion: 3, countingVersion: 2, tierId, semanticTargets,
  groupMemberLimit: tierId === 'standard' ? 16384 : 65536,
  limits: { ...MANUAL_TRANSACTION_BUDGET.limits, semanticTargets,
    geometryPoints: 4096 * multiplier, geometrySegments: 4096 * multiplier, curveSegments: Math.min(256, 128 * multiplier),
    gridNodes: Math.min(65536, 24576 * multiplier), fieldEvaluations: 196608 * multiplier,
    intersectionPairs: 2_000_000 * multiplier * 4, dependencyRefs: 4096 * multiplier * 2,
    metadataRecords: 8192 * multiplier, metadataBytes: 2 * 1024 * 1024 * multiplier },
})
/** Ordinary transactions have a separate registry from immutable AI task policies. */
export const MANUAL_TRANSACTION_BUDGETS = freezeJson({ compact: MANUAL_TRANSACTION_BUDGET,
  standard: manualTier('standard', 512, 4), expanded: manualTier('expanded', 1024, 16) })
export const manualTransactionBudget = (tier: ManualBudgetTier): ManualTransactionBudget => {
  if (!Object.hasOwn(MANUAL_TRANSACTION_BUDGETS, tier)) throw new Error('普通事务档位不存在。')
  return MANUAL_TRANSACTION_BUDGETS[tier]
}
export function selectManualTransactionBudget(document: SceneDocument, requestedTargets = 0, groupMembers = 0): ManualTransactionBudget {
  if (![requestedTargets, groupMembers].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('普通事务请求范围无效。')
  const retained = LAYER_ENTITY_COLLECTIONS.reduce((count, key) => count + Object.keys(document[key]).length, 0)
    + Object.keys(document.decorations).length + Object.keys(document.decorationClusters).length
    + Object.keys(document.surfaceRules).length
  return manualTransactionBudget(requestedTargets > 512 || retained > 1024 || groupMembers > 16384 ? 'expanded'
    : requestedTargets > 256 || retained > 256 || groupMembers > 4096 ? 'standard' : 'compact')
}
/** Manual-only counters; immutable AI/task schemas and ledgers remain unchanged. */
export type CommandBudgetUsage = BudgetUsage & { groupMembers?: number; externalDependencies?: number }
export type CommandBudgetProfile = TaskBudgetProfile | ManualTransactionBudget
export interface CommandBudgetMetadata {
  before: Partial<Pick<CompositionContent, 'historyIdentity' | 'appearance'>>
  after: Partial<Pick<CompositionContent, 'historyIdentity' | 'appearance'>> & { assets?: TaskBudgetMetadata['after']['assets'] }
}
export const isManualTransactionBudget = (input: CommandBudgetProfile | undefined): input is ManualTransactionBudget => input?.profileId === 'manual'
export const commandSelectionLimit = (profile?: CommandBudgetProfile): number => isManualTransactionBudget(profile) ? profile.semanticTargets : 256

export function parseCommandBudgetProfile(input: CommandBudgetProfile): CommandBudgetProfile {
  const captured = captureJson(input)
  if (captured.profileId !== 'manual') return parseTaskBudgetProfile(captured)
  const registered = Object.values(MANUAL_TRANSACTION_BUDGETS).find(profile => canonicalJson(captured) === canonicalJson(profile))
  if (!registered) throw new Error('普通事务预算须使用完整固定策略。')
  return registered
}

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const effectiveAdjustments = (graph: AppearanceGraph, layerId: string | undefined, id: string) => {
  const result: Record<string, unknown> = {}
  for (const adjustment of [...(layerId ? graph.layerAdjustments[layerId] ?? [] : []), ...(graph.instanceAdjustments[id] ?? [])]) {
    if (adjustment.enabled) result[adjustment.kind] = adjustment.value
  }
  return result
}

function manualEntries(document: SceneDocument, graph?: AppearanceGraph) {
  const entries = semanticTargetEntries(document)
  for (const [id, edge] of Object.entries(document.visual.base.materializedEdges)) entries.set(`visual.materializedEdge:${id}`, { id, value: edge })
  const coordinates = (ids: readonly string[]) => ids.map(id => {
    const vertex = document.vertices[id]
    return vertex ? { x: vertex.xMm, y: vertex.yMm } : null
  })
  const edgeKey = (a: string, b: string) => canonicalJson([a, b].sort())
  const wallsByEdge = new Map(Object.values(document.walls).map(wall => [edgeKey(wall.startVertexId, wall.endVertexId), wall.id]))
  const wallGeometry = (id: string) => {
    const wall = document.walls[id]
    return wall ? { thicknessMm: wall.thicknessMm, coordinates: coordinates([wall.startVertexId, wall.endVertexId]) } : null
  }
  const vertexOwners = new Set(Object.values(document.walls).flatMap(wall => [wall.startVertexId, wall.endVertexId]))
  for (const [key, row] of entries) {
    if (key.startsWith('vertex:') && vertexOwners.has(row.id)) { entries.delete(key); continue }
    const room = document.rooms[row.id], wall = document.walls[row.id], opening = document.openings[row.id]
    const physical = room ? { coordinates: coordinates(room.boundaryVertexIds), walls: room.boundaryVertexIds.map((id, index, ids) => wallGeometry(wallsByEdge.get(edgeKey(id, ids[(index + 1) % ids.length])) ?? '')) }
      : wall ? wallGeometry(wall.id) : opening ? wallGeometry(opening.wallId) : undefined
    const layerId = document.entityLayers[row.id]
    const source = graph?.propSources[row.id] ?? graph?.surfaceSources[row.id]
    entries.set(key, { ...row, value: { value: row.value, ...(physical ? { physical } : {}),
      ...(layerId ? { layerOrder: document.userLayers[layerId]?.order } : {}),
      ...(source && graph ? { source, adjustments: effectiveAdjustments(graph, layerId, row.id) } : {}) } })
  }
  for (const [id, floor] of Object.entries(document.floors)) entries.set(`floor:${id}`, { id, value: floor })
  // Scene-level settings are editable too, but receipts, fixed sources and
  // identity records are independently bounded metadata rather than user edits.
  const { schemaVersion: _version, sceneId: _id, revision: _revision, vertices: _vertices, rooms: _rooms,
    walls: _walls, openings: _openings, props: _props, regions: _regions, notes: _notes, floors: _floors,
    terrainAreas: _areas, terrainEdges: _edges, terrainConnections: _connections, paths: _paths,
    prefabInstances: _prefabs, scatterGroups: _scatters, userLayers: _layers, entityLayers: _membership,
    assets: _assets, materials: _materials, propDefinitions: _propDefinitions, prefabDefinitions: _prefabDefinitions,
    styleThemes: _themes, generation: _generation, visual: _visual, regional: _regional,
    decorations: _decorations, decorationClusters: _clusters, surfaceRules: _rules, aggregateCoordinates: _coordinates, ...settings } = document
  entries.set('scene:settings', { id: document.sceneId, value: settings })
  if (graph) for (const [id, layer] of Object.entries(document.userLayers)) {
    entries.set(`layer:${id}`, { id, value: { layer, adjustments: graph.layerAdjustments[id] ?? [] } })
  }
  return entries
}

/** Complete physical/effective appearance changes, with container/member deduplication. */
export function manualChangedTargets(before: SceneDocument, after: SceneDocument, metadata?: CommandBudgetMetadata): string[] {
  const a = manualEntries(before, metadata?.before.appearance), b = manualEntries(after, metadata?.after.appearance)
  const changed = new Set([...a.keys(), ...b.keys()].filter(key => !same(a.get(key)?.value, b.get(key)?.value)))
  const oldGroups = before.aggregateCoordinates?.groups ?? {}, newGroups = after.aggregateCoordinates?.groups ?? {}
  const changedGroups = new Set([...Object.keys(oldGroups), ...Object.keys(newGroups)].filter(id => !same(oldGroups[id], newGroups[id])))
  const targetKeys = new Map([...a, ...b].map(([key, row]) => [row.id, key]))
  // Reparenting changes descendant storage frames and permissions too. Charge
  // their actual members even when their world JSON is unchanged.
  for (const groups of [oldGroups, newGroups]) {
    let added = true
    while (added) { added = false; for (const group of Object.values(groups)) if (group.parentId !== null && changedGroups.has(group.parentId) && !changedGroups.has(group.id)) { changedGroups.add(group.id); added = true } }
  }
  for (const id of changedGroups) {
    changed.add(`aggregate:${id}`)
    for (const group of [oldGroups[id], newGroups[id]]) for (const ref of group?.members ?? []) {
      const key = targetKeys.get(ref.id)
      changed.add(key ?? `${ref.kind}:${ref.id}`)
    }
  }
  for (const key of [...changed]) {
    const separator = key.indexOf(':'), kind = key.slice(0, separator), id = key.slice(separator + 1)
    if (kind === 'visual.filters') {
      const first = visualBase(before)?.filters[id], second = visualBase(after)?.filters[id]
      if (first?.target.kind === 'entities' || second?.target.kind === 'entities') changed.delete(key)
    }
    if (kind === 'layer') {
      const memberChanged = [...changed].some(target => {
        const memberId = (b.get(target) ?? a.get(target))?.id
        return memberId && target !== key && (before.entityLayers[memberId] === id || after.entityLayers[memberId] === id)
      })
      const business = (document: SceneDocument) => {
        const layer = document.userLayers[id]
        if (!layer) return null
        const { order: _order, ...rest } = layer
        return rest
      }
      if (memberChanged && same(business(before), business(after))) changed.delete(key)
    }
    const collection = kind === 'prefab' ? 'prefabInstances' : kind === 'scatter' ? 'scatterGroups'
      : kind === 'decorationCluster' ? 'decorationClusters' : undefined
    if (!collection) continue
    const first = before[collection]?.[id], second = after[collection]?.[id]
    const memberIds = [first, second].flatMap(group => Object.values(group?.members ?? {}).flatMap(member => 'propId' in member ? member.propId ?? [] : member.entityId ?? []))
    if (!memberIds.some(memberId => changed.has(`prop:${memberId}`) || changed.has(`decoration:${memberId}`))) continue
    const business = (group: unknown) => {
      if (!group) return null
      const { members: _members, anchorMm: _anchor, rotationDeg: _rotation, densityFactor: _density, exclusions: _exclusions, ...rest } = group as Record<string, unknown>
      return rest
    }
    if (first && second && same(business(first), business(second))) changed.delete(key)
  }
  return [...changed].sort()
}

const memberKey = (ref: AggregateEntityRef) => `${ref.kind}:${ref.id}`
const groupBusiness = (group: NonNullable<SceneDocument['aggregateCoordinates']>['groups'][string]) => {
  const { frame: _frame, ...business } = group
  return business
}
function localSurface(snapshot: Extract<AppearanceGraph['sources'][string], { kind: 'surface' }>['snapshot'], frame: AggregateFrame) {
  const style = captureJson(snapshot)
  for (const paint of [style.base, ...style.overlays.map(row => row.paint)]) if (paint.alignment === 'surface') {
    paint.originMm = worldToLocalPoint(frame, paint.originMm)
    paint.rotationDeg = ((paint.rotationDeg - frame.quarterTurns * 90) % 360 + 360) % 360
  }
  for (const overlay of style.overlays) overlay.boundaryMm = overlay.boundaryMm.map(point => worldToLocalPoint(frame, point))
  return style
}
/** Exact immutable sources may gain a transformed surface descendant; its
 * parameters must still be identical in the owning local coordinate system.
 * Source IDs or the caller's declaration alone never authorize compression. */
function unchangedMemberAppearance(ref: AggregateEntityRef, before: SceneDocument, after: SceneDocument,
  first: AppearanceGraph | undefined, second: AppearanceGraph | undefined, oldFrame: AggregateFrame, newFrame: AggregateFrame): boolean {
  if (!first || !second) return first === second
  const aLayer = before.entityLayers[ref.id], bLayer = after.entityLayers[ref.id]
  if (!same(effectiveAdjustments(first, aLayer, ref.id), effectiveAdjustments(second, bLayer, ref.id))) return false
  const aId = first.propSources[ref.id] ?? first.surfaceSources[ref.id], bId = second.propSources[ref.id] ?? second.surfaceSources[ref.id]
  if (!aId || !bId) return aId === bId
  const a = first.sources[aId], b = second.sources[bId]
  if (!a || !b || a.kind !== b.kind || !same(a, second.sources[aId])) return false
  if (a.kind === 'prop' || b.kind === 'prop') return aId === bId && same(a, b) && same(first.presentations?.[aId], second.presentations?.[bId])
  if (!same(localSurface(a.snapshot, oldFrame), localSurface(b.snapshot, newFrame))) return false
  if (aId === bId) return true
  let parent = b.parentSourceId
  for (let depth = 0; parent !== null && depth < 16; depth++) {
    if (parent === aId) return true
    parent = second.sources[parent]?.parentSourceId ?? null
  }
  return false
}

/** An admission classification only: locks, geometry, resources, secrecy,
 * identities and CAS continue through their full existing owning validators.
 * Any local/member/ownership change disables this whole subtree's exemption. */
function manualCoreImpact(before: SceneDocument, after: SceneDocument, metadata: CommandBudgetMetadata | undefined, targets: readonly string[]) {
  const oldGroups = before.aggregateCoordinates?.groups, newGroups = after.aggregateCoordinates?.groups
  const ordinary = { semanticTargets: targets.length, groupMembers: 0, externalDependencies: 0 }
  if (!oldGroups || !newGroups || before.aggregateCoordinates?.encoding !== 'world' || after.aggregateCoordinates?.encoding !== 'world') return ordinary
  const ownChanges = new Set([...Object.keys(oldGroups), ...Object.keys(newGroups)].filter(id => !same(oldGroups[id], newGroups[id])))
  if (!ownChanges.size) return ordinary
  const roots = [...ownChanges].filter(id => {
    const a = oldGroups[id], b = newGroups[id]
    if (!a || !b || same(a.frame, b.frame) || !same(groupBusiness(a), groupBusiness(b))) return false
    for (const groups of [oldGroups, newGroups]) {
      let parent = groups[id].parentId, remaining = Object.keys(groups).length
      while (parent !== null && remaining-- > 0) {
        if (ownChanges.has(parent)) return false
        parent = groups[parent]?.parentId ?? null
      }
      if (remaining < 0) return false
    }
    return true
  })
  if (!roots.length) return ordinary
  try {
    const oldLocal = encodeSceneCoordinates(before), newLocal = encodeSceneCoordinates(after)
    const aGraph = metadata?.before.appearance, bGraph = metadata?.after.appearance
    if (aGraph && bGraph) {
      for (const id of Object.keys(before.props)) if (after.props[id]
        && propPresentation(aGraph, id)?.mode === 'nearSide' && propPresentation(bGraph, id)?.mode === 'nearSide'
        && same(propPresentation(aGraph, id), propPresentation(bGraph, id))) {
        oldLocal.props[id].rotationDeg = before.props[id].rotationDeg
        newLocal.props[id].rotationDeg = after.props[id].rotationDeg
      }
      for (const id of Object.keys(before.decorations)) if (after.decorations[id]
        && definitionPresentation(aGraph, before.decorations[id].definitionRef)?.mode === 'nearSide'
        && same(definitionPresentation(aGraph, before.decorations[id].definitionRef), definitionPresentation(bGraph, after.decorations[id].definitionRef))) {
        oldLocal.decorations[id].rotationDeg = before.decorations[id].rotationDeg
        newLocal.decorations[id].rotationDeg = after.decorations[id].rotationDeg
      }
    }
    const oldEntries = manualEntries(oldLocal), newEntries = manualEntries(newLocal)
    const oldKeys = new Map([...oldEntries].map(([key, row]) => [row.id, key])), newKeys = new Map([...newEntries].map(([key, row]) => [row.id, key]))
    const oldFrames = aggregateWorldFrames(before.aggregateCoordinates!), newFrames = aggregateWorldFrames(after.aggregateCoordinates!)
    const edits = new Set(targets), affected = new Set<string>(), ownedRefs = new Set<string>()
    for (const root of roots) {
      const subtree = new Set([root])
      for (let added = true; added;) {
        added = false
        for (const row of Object.values(oldGroups)) if (row.parentId !== null && subtree.has(row.parentId) && !subtree.has(row.id)) { subtree.add(row.id); added = true }
      }
      const members = [...subtree].flatMap(id => oldGroups[id].members)
      const owners = new Map([...subtree].flatMap(id => oldGroups[id].members.map(ref => [memberKey(ref), id] as const)))
      if ([...subtree].some(id => !newGroups[id] || id !== root && !same(oldGroups[id], newGroups[id]))
        || Object.values(newGroups).some(row => row.parentId !== null && subtree.has(row.parentId) && !subtree.has(row.id))) continue
      const unchanged = members.every(ref => {
        const owner = owners.get(memberKey(ref))!
        const collection = AGGREGATE_ENTITY_COLLECTIONS[ref.kind]
        const first = oldLocal[collection][ref.id], second = newLocal[collection][ref.id]
        if (!same(first, second) || before.entityLayers[ref.id] !== after.entityLayers[ref.id]) return false
        const aKey = oldKeys.get(ref.id), bKey = newKeys.get(ref.id)
        if (aKey !== bKey) return false
        // Raw rows above include every member field. Entries additionally
        // include actual wall/room support geometry, layer order and filters.
        if (aKey && !same(oldEntries.get(aKey)?.value, newEntries.get(aKey)?.value)) return false
        return unchangedMemberAppearance(ref, before, after, aGraph, bGraph, oldFrames.get(owner)!, newFrames.get(owner)!)
      })
      if (!unchanged) continue
      edits.add(`aggregate:${root}`)
      for (const id of subtree) if (id !== root) { edits.delete(`aggregate:${id}`); affected.add(`aggregate:${id}`) }
      for (const ref of members) {
        const key = oldKeys.get(ref.id) ?? memberKey(ref)
        edits.delete(key); affected.add(memberKey(ref)); ownedRefs.add(memberKey(ref))
      }
    }
    const external = new Set<string>()
    if (ownedRefs.size) for (const document of [before, after]) for (const relation of aggregateEntityRelations(document)) {
      const from = memberKey(relation.from), to = `${relation.to.kind}:${relation.to.id}`
      if (ownedRefs.has(from) && !ownedRefs.has(to)) external.add(to)
      if (ownedRefs.has(to) && !ownedRefs.has(from)) external.add(from)
    }
    return { semanticTargets: edits.size, groupMembers: affected.size, externalDependencies: external.size }
  } catch {
    // A partial/unproven representation receives ordinary actual-target
    // counting; this function never repairs or certifies caller documents.
    return ordinary
  }
}

interface RetainedPropBudget {
  identity: CompositionContent['historyIdentity']
  appearance: CompositionContent['appearance']
  usage: BudgetUsage
  segments: number
}
const retainedPropBudgets = new WeakMap<SceneDocument, RetainedPropBudget>()
function retainedPropBudget(content: CompositionContent): RetainedPropBudget {
  const known = retainedPropBudgets.get(content.document)
  if (known?.identity === content.historyIdentity && known.appearance === content.appearance) return known
  const parent = getPropUpdateCompositionTransaction(content)?.baseline ?? getCompositionRevisionTransaction(content)?.baseline
  const prior = parent && parent.document !== content.document ? retainedPropBudget(parent) : undefined
  const usage = prior?.usage ?? measureTaskBudget(content.document, content.document, { before: content, after: content })
  const result = { identity: content.historyIdentity, appearance: content.appearance, usage,
    segments: prior?.segments ?? measuredRetainedSegments(content.document)! }
  retainedPropBudgets.set(content.document, result)
  return result
}

/** Convert a short-lived executor/revision proof into retained counters before
 * releasing its intermediate snapshots. No caller data can seed this cache. */
export function retainLocalCommandBudget(input: CompositionContent): void {
  const content = getCertifiedCompositionContent(input)
  if (content && (getPropUpdateCompositionTransaction(content) || getCompositionRevisionTransaction(content))) retainedPropBudget(content)
}

/** A private executor witness proves that only Prop position/angle changed.
 * Retained geometry/references are inherited through that exact immutable chain;
 * resource counters are still read from this call's actual metadata closure. */
function measureProvenPropBudget(before: SceneDocument, after: SceneDocument, metadata: CommandBudgetMetadata | undefined,
  execution: Partial<BudgetUsage>): CommandBudgetUsage | undefined {
  if (!metadata) return
  const first = { document: before, historyIdentity: metadata.before.historyIdentity, appearance: metadata.before.appearance } as CompositionContent
  const second = { document: after, historyIdentity: metadata.after.historyIdentity, appearance: metadata.after.appearance }
  const unchanged = before === after && first.historyIdentity === second.historyIdentity && first.appearance === second.appearance
    ? getCertifiedCompositionContent(second) : undefined
  const witness = getPropUpdateCompositionTransaction(second, first)
    ?? (unchanged ? { baseline: unchanged, result: unchanged, changes: [] } : undefined)
  if (!witness) return
  const retained = retainedPropBudget(witness.baseline)
  const usage = { ...retained.usage, semanticTargets: witness.changes.length, metadataRecords: 0, metadataBytes: 0,
    geometryPoints: 0, geometrySegments: 0, curveSegments: 0, assetBytes: 0 }
  for (const change of witness.changes) {
    const first = measureBudgetGeometry(change.before), second = measureBudgetGeometry(change.after)
    for (const key of ['geometryPoints', 'geometrySegments', 'curveSegments'] as const) usage[key] += Math.max(first[key], second[key])
  }
  usage.intersectionPairs = usage.geometrySegments * (retained.segments + usage.geometrySegments)
  if (metadata.after.assets) {
    usage.decodePixels = 0
    for (const record of Object.values(metadata.after.assets)) {
      usage.assetBytes += record.sizeBytes; usage.decodePixels += record.pixelWidth * record.pixelHeight
    }
  }
  for (const [key, value] of Object.entries(execution) as [keyof BudgetUsage, number][]) {
    if (!BUDGET_DIMENSIONS.includes(key) || !Number.isSafeInteger(value) || value < 0) throw new Error('任务执行计量无效。')
    usage[key] = ['gridNodes', 'fieldEvaluations', 'intersectionPairs', 'candidateAttempts', 'activeExecutionMs'].includes(key)
      ? usage[key] + value : Math.max(usage[key], value)
  }
  retainedPropBudgets.set(after, { ...retained, identity: witness.result.historyIdentity, appearance: witness.result.appearance })
  return freezeJson({ ...BudgetUsageSchema.parse(usage), groupMembers: 0, externalDependencies: 0 })
}

export function measureCommandBudget(before: SceneDocument, after: SceneDocument, metadata?: CommandBudgetMetadata, execution: Partial<BudgetUsage> = {}, profile: CommandBudgetProfile = MANUAL_TRANSACTION_BUDGET): CommandBudgetUsage {
  if (isManualTransactionBudget(profile)) {
    const proven = measureProvenPropBudget(before, after, metadata, execution)
    if (proven) return proven
  }
  // The task meter reads absent identity/appearance branches as empty metadata.
  const measuredExecution = isManualTransactionBudget(profile) ? { ...execution, geometryPoints: 0, geometrySegments: 0 } : execution
  const usage = measureTaskBudget(before, after, metadata as TaskBudgetMetadata | undefined, measuredExecution)
  if (!isManualTransactionBudget(profile)) return usage
  const targets = manualChangedTargets(before, after, metadata)
  const impact = manualCoreImpact(before, after, metadata, targets)
  const recordData = (document: SceneDocument, identity?: CommandBudgetMetadata['before']) => ({
    generation: document.generation ?? null, identity: identity?.historyIdentity ?? null, appearance: identity?.appearance ?? null,
    assets: document.assets, materials: document.materials, propDefinitions: document.propDefinitions,
    prefabDefinitions: document.prefabDefinitions, styleThemes: document.styleThemes,
    regionalSymbolDefinitions: document.regional?.symbolDefinitions ?? null,
    ...(document.aggregateCoordinates ? { aggregateCoordinates: document.aggregateCoordinates } : {}),
  })
  let metadataRecords = 0, metadataBytes = 0
  const recordDelta = (first: unknown, second: unknown) => {
    if (same(first, second)) return
    const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
    if (record(first) && record(second)) {
      metadataRecords++
      metadataBytes += 2 // Changed record braces; unchanged children cost no delta bytes.
      for (const key of new Set([...Object.keys(first), ...Object.keys(second)])) {
        if (same(first[key], second[key])) continue
        metadataBytes += encodeUtf8(canonicalJson(key)).length + 2 // Key, colon and separator.
        recordDelta(first[key], second[key])
      }
    } else {
      const countRecords = (value: unknown): number => !value || typeof value !== 'object' ? 0
        : (Array.isArray(value) ? 0 : 1) + Object.values(value).reduce<number>((sum, row) => sum + countRecords(row), 0)
      metadataRecords += Math.max(countRecords(first), countRecords(second))
      metadataBytes += Math.max(encodeUtf8(canonicalJson(first ?? null)).length, encodeUtf8(canonicalJson(second ?? null)).length)
    }
  }
  recordDelta(recordData(before, metadata?.before), recordData(after, metadata?.after))
  let implicitPoints = 0, implicitSegments = 0
  for (const target of targets) {
    const separator = target.indexOf(':'), kind = target.slice(0, separator), id = target.slice(separator + 1)
    if (kind === 'wall' && same(before.walls[id], after.walls[id])) { implicitPoints += 2; implicitSegments++ }
    if (kind === 'opening' && same(before.openings[id], after.openings[id])) { implicitPoints += 2; implicitSegments++ }
    if (kind === 'room' && same(before.rooms[id], after.rooms[id])) {
      const count = after.rooms[id]?.boundaryVertexIds.length ?? before.rooms[id]?.boundaryVertexIds.length ?? 0
      implicitPoints += count; implicitSegments += count
    }
  }
  const retainedSegments = Object.keys(after.walls).length + Object.values(after.rooms).reduce((sum, room) => sum + room.boundaryVertexIds.length, 0)
    + Object.values(after.terrainAreas).reduce((sum, area) => sum + area.boundaryMm.length, 0)
    + Object.values(after.paths).reduce((sum, path) => sum + Math.max(0, path.centerlineMm.length - 1), 0)
  return freezeJson({ ...usage, semanticTargets: Math.max(impact.semanticTargets, execution.semanticTargets ?? 0),
    groupMembers: impact.groupMembers, externalDependencies: impact.externalDependencies,
    metadataRecords: Math.max(metadataRecords, execution.metadataRecords ?? 0), metadataBytes: Math.max(metadataBytes, execution.metadataBytes ?? 0),
    geometryPoints: Math.max(usage.geometryPoints + implicitPoints, execution.geometryPoints ?? 0),
    geometrySegments: Math.max(usage.geometrySegments + implicitSegments, execution.geometrySegments ?? 0),
    intersectionPairs: usage.intersectionPairs + implicitSegments * (retainedSegments + usage.geometrySegments + implicitSegments) })
}

export function assertCommandBudget(input: CommandBudgetProfile, raw: CommandBudgetUsage): CommandBudgetUsage {
  const profile = parseCommandBudgetProfile(input)
  if (!isManualTransactionBudget(profile)) return assertTaskBudget(profile, raw)
  const captured = captureJson(raw)
  const { groupMembers, externalDependencies, ...base } = captured
  const extra = z.object({ groupMembers: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    externalDependencies: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict().parse({ groupMembers, externalDependencies })
  const usage = BudgetUsageSchema.parse(base)
  if ((extra.groupMembers ?? 0) > profile.groupMemberLimit) throw new Error(`普通事务预算超限[groupMembers]：${extra.groupMembers}/${profile.groupMemberLimit}，保留当前成果。`)
  for (const key of BUDGET_DIMENSIONS) if (usage[key] > profile.limits[key]) {
    throw new Error(`普通事务预算超限[${key}]：${usage[key]}/${profile.limits[key]}，保留当前成果。`)
  }
  return freezeJson({ ...usage, ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)) })
}
