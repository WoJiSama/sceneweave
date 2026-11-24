import { OperationRejected } from '../validation/operation-rejection.js'
import { z } from 'zod'
import type { SceneDocument } from '../model/scene.js'
import type { CompositionContent } from '../model/appearance.js'
import { LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS } from '../model/scene.js'
import { visualBase } from '../visual/base.js'
import { canonicalJson, captureJson, encodeUtf8, equalCheckedJson, equalOwnedJson, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { isCertifiedSceneSnapshot } from '../validation/snapshots.js'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const BudgetUsageSchema = z.object({ semanticTargets: count, geometryPoints: count, geometrySegments: count,
  curveSegments: count, gridNodes: count, fieldEvaluations: count, intersectionPairs: count, dependencyRefs: count,
  metadataRecords: count, metadataBytes: count, assetBytes: count, decodePixels: count, candidateAttempts: count,
  activeExecutionMs: count }).strict()
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>
export const BUDGET_DIMENSIONS = Object.freeze(Object.keys(BudgetUsageSchema.shape) as (keyof BudgetUsage)[])
export const emptyBudgetUsage = (): BudgetUsage => Object.fromEntries(BUDGET_DIMENSIONS.map(key => [key, 0])) as BudgetUsage
const rawProfileSchema = z.object({ profileId: z.enum(['small', 'standard', 'expanded']), profileVersion: z.literal(1),
  countingVersion: z.literal(2), semanticTargets: z.union([z.literal(512), z.literal(1024), z.literal(2048)]),
  limits: BudgetUsageSchema, profileHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export type TaskBudgetProfile = z.infer<typeof rawProfileSchema>
export type TaskBudgetProfileId = TaskBudgetProfile['profileId']
function profile(profileId: TaskBudgetProfileId, semanticTargets: 512 | 1024 | 2048, multiplier: number): TaskBudgetProfile {
  const body = { profileId, profileVersion: 1 as const, countingVersion: 2 as const, semanticTargets,
    limits: { semanticTargets, geometryPoints: 4096 * multiplier, geometrySegments: 4096 * multiplier,
      curveSegments: Math.min(256, 128 * multiplier), gridNodes: Math.min(65536, 24576 * multiplier),
      fieldEvaluations: 196608 * multiplier, intersectionPairs: 2_000_000 * multiplier,
      dependencyRefs: 4096 * multiplier, metadataRecords: 8192 * multiplier, metadataBytes: 2 * 1024 * 1024 * multiplier,
      assetBytes: Math.min(256, 64 * multiplier) * 1024 * 1024, decodePixels: Math.min(64_000_000, 16_000_000 * multiplier),
      candidateAttempts: 4, activeExecutionMs: 300000 } }
  return freezeJson({ ...body, profileHash: sha256Text(canonicalJson(body)) })
}
/** Registered admission envelopes; counts are protection, not measured product capacity. */
export const TASK_BUDGET_PROFILES = freezeJson({ small: profile('small', 512, 1), standard: profile('standard', 1024, 2),
  expanded: profile('expanded', 2048, 4) })
export const TaskBudgetProfileSchema = rawProfileSchema.superRefine((value, context) => {
  if (canonicalJson(value) !== canonicalJson(TASK_BUDGET_PROFILES[value.profileId])) context.addIssue({ code: 'custom', message: '任务预算必须与注册档位及hash完全一致。' })
})
export const parseTaskBudgetProfile = (input: unknown): TaskBudgetProfile => freezeJson(TaskBudgetProfileSchema.parse(captureJson(input)))
export const taskBudgetProfile = (id: TaskBudgetProfileId): TaskBudgetProfile => parseTaskBudgetProfile(TASK_BUDGET_PROFILES[id])
export const selectTaskBudget = (input: { task: 'generation' | 'local-edit' | 'authoring'; widthMm: number; heightMm: number;
  quality: 'standard' | 'detailed'; device: 'constrained' | 'standard' | 'expanded' }): TaskBudgetProfile => {
  if (!['generation','local-edit','authoring'].includes(input.task) || !['standard','detailed'].includes(input.quality)
    || !['constrained','standard','expanded'].includes(input.device) || ![input.widthMm,input.heightMm].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error('任务预算选择输入无效。')
  const area = input.widthMm * input.heightMm
  if (!Number.isSafeInteger(area)) throw new Error('任务范围乘积无效。')
  const wanted = input.quality === 'detailed' || area > 48000 * 36000 ? 'expanded' : area > 24000 * 18000 || input.task === 'authoring' ? 'standard' : 'small'
  const rank = { small: 0, standard: 1, expanded: 2 }, ceiling = { constrained: 0, standard: 1, expanded: 2 }
  return taskBudgetProfile((['small','standard','expanded'] as const)[Math.min(rank[wanted], ceiling[input.device])])
}
export function assertTaskBudget(profileInput: TaskBudgetProfile, raw: BudgetUsage): BudgetUsage {
  const profile = parseTaskBudgetProfile(profileInput), usage = BudgetUsageSchema.parse(captureJson(raw))
  for (const key of BUDGET_DIMENSIONS) if (usage[key] > profile.limits[key]) throw new OperationRejected('operation_budget', `任务预算超限[${key}]：${usage[key]}/${profile.limits[key]}，保留当前成果。`)
  return freezeJson(usage)
}
const observedWorkDimensions = ['gridNodes','fieldEvaluations','intersectionPairs','dependencyRefs','candidateAttempts'] as const
let executionWorkObserver: ((delta:Partial<BudgetUsage>)=>void)|undefined
/** A synchronous executor-local observation scope. The observer receives raw
 * work charges once, including successful work before a later failure. It is
 * never installed across an await or retained by a meter snapshot. */
export function withExecutionWorkObserver<T>(observer:(delta:Partial<BudgetUsage>)=>void,callback:()=>T):T {
  if(typeof observer!=='function'||typeof callback!=='function')throw new Error('任务工作观察范围需要同步函数。')
  const previous=executionWorkObserver;executionWorkObserver=observer
  try {
    const result=callback()
    if(result!==null&&(typeof result==='object'||typeof result==='function')&&typeof(result as {then?:unknown}).then==='function')throw new Error('任务工作观察范围不能跨Promise或await。')
    return result
  } finally {executionWorkObserver=previous}
}
/** Add one synchronous accounting owner without hiding an enclosing owner. */
export function withAdditionalExecutionWorkObserver<T>(observer:(delta:Partial<BudgetUsage>)=>void,callback:()=>T):T {
  if(typeof observer!=='function'||typeof callback!=='function')throw new Error('任务工作观察范围需要同步函数。')
  const previous=executionWorkObserver
  return withExecutionWorkObserver(delta=>{previous?.(delta);observer(delta)},callback)
}
export function captureExecutionBudget(profileInput: TaskBudgetProfile) {
  const profile = parseTaskBudgetProfile(profileInput), usage = emptyBudgetUsage()
  return Object.freeze({ charge(delta: Partial<BudgetUsage>) {
    const next = { ...usage }
    for (const [key, amount] of Object.entries(delta) as [keyof BudgetUsage, number][]) {
      if (!BUDGET_DIMENSIONS.includes(key) || !Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(next[key] + amount)) throw new Error('任务工作计量无效。')
      next[key] += amount
    }
    for(const key of BUDGET_DIMENSIONS)if(next[key]>profile.limits[key])throw new OperationRejected('operation_budget', `任务预算超限[${key}]：${next[key]}/${profile.limits[key]}，保留当前成果。`)
    Object.assign(usage, next)
    if(executionWorkObserver){
      const work=Object.fromEntries(observedWorkDimensions.filter(key=>(delta[key]??0)>0).map(key=>[key,delta[key]])) as Partial<BudgetUsage>
      if(Object.keys(work).length)executionWorkObserver(freezeJson(work))
    }
  }, snapshot: () => freezeJson({ ...usage }) })
}
export type ExecutionBudget = ReturnType<typeof captureExecutionBudget>
const same = (a: unknown, b: unknown) => equalCheckedJson(a ?? null, b ?? null)
const sorted = (values: Iterable<string>) => [...new Set(values)].sort()
const kindFor = { vertices: 'vertex', rooms: 'room', walls: 'wall', openings: 'opening', props: 'prop', regions: 'region', notes: 'note',
  terrainAreas: 'terrainArea', terrainEdges: 'terrainEdge', terrainConnections: 'terrainConnection', paths: 'path', prefabInstances: 'prefab', scatterGroups: 'scatter' } as const

/** Editable targets only. Points, birth records, fixed sources and generated
 * receipts remain fully validated complexity, never extra user edit targets. */
export function semanticTargetEntries(document: SceneDocument): Map<string, { id: string; value: unknown }> {
  const rows = new Map<string, { id: string; value: unknown }>()
  const memberships = new Map<string, unknown[]>(), decorationMemberships = new Map<string, unknown[]>()
  for (const kind of ['prefabInstances', 'scatterGroups'] as const) for (const group of Object.values(document[kind])) {
    for (const [key, member] of Object.entries(group.members) as [string, { propId: string | null }][]) if (member.propId) {
      const list = memberships.get(member.propId) ?? []
      list.push({ kind, groupId: group.id, key, member }); memberships.set(member.propId, list)
    }
  }
  for (const group of Object.values(document.decorationClusters ?? {})) for (const [key, member] of Object.entries(group.members)) if (member.entityId) {
    const list = memberships.get(member.entityId) ?? []
    list.push({ kind: 'decorationClusters', groupId: group.id, key, member }); memberships.set(member.entityId, list)
    const placements = decorationMemberships.get(member.entityId) ?? []
    placements.push({ clusterId: group.id, candidateKey: key, member }); decorationMemberships.set(member.entityId, placements)
  }
  for (const list of memberships.values()) list.sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0)
  for (const key of LAYER_ENTITY_COLLECTIONS) for (const [id, row] of Object.entries(document[key])) {
    let value: unknown = row
    if (key === 'prefabInstances' || key === 'scatterGroups') {
      const { members: _members, ...properties } = row as unknown as Record<string, unknown>
      value = properties
    }
    rows.set(`${kindFor[key]}:${id}`, { id, value: { row: value, layerId: document.entityLayers[id], ...(key === 'props' ? { memberships: memberships.get(id) ?? [] } : {}) } })
  }
  for (const area of Object.values(document.terrainAreas)) if (area.rockBody?.shell) {
    const shell = area.rockBody.shell
    for (const [id, row] of Object.entries(shell.verticesMm)) rows.set(`rockShellVertex:${id}`, { id: area.id, value: row })
    for (const [id, row] of Object.entries(shell.faces)) rows.set(`rockShellFace:${id}`, { id: area.id, value: row })
    for (const row of shell.sections) rows.set(`rockShellSection:${row.id}`, { id: area.id, value: row })
  }
  for (const key of DECORATION_COLLECTIONS) for (const [id, row] of Object.entries(document[key] ?? {})) {
    if (key === 'decorationClusters') { const { members: _members, ...properties } = row as unknown as Record<string, unknown>; rows.set(`decorationCluster:${id}`, { id, value: { row: properties, layerId: document.entityLayers[id] } }) }
    else rows.set(`decoration:${id}`, { id, value: { row, layerId: document.entityLayers[id], memberships: decorationMemberships.get(id) ?? [] } })
  }
  for (const key of SURFACE_RULE_COLLECTIONS) for (const [id, row] of Object.entries(document[key] ?? {})) rows.set(`surfaceRule:${id}`, { id, value: { row, layerId: document.entityLayers[id] } })
  for (const [id, row] of Object.entries(document.floors)) rows.set(`floor:${id}`, { id, value: row })
  for (const [id, row] of Object.entries(document.pathAttachments ?? {})) rows.set(`pathAttachment:${id}`, { id, value: row })
  for (const [id, row] of Object.entries(document.attachmentSurfaces ?? {})) rows.set(`attachmentSurface:${id}`, { id, value: row })
  for (const [id, row] of Object.entries(document.attachments ?? {})) rows.set(`attachment:${id}`, { id, value: row })
  for (const [id, row] of Object.entries(document.userLayers)) rows.set(`layer:${id}`, { id, value: row })
  const visual = visualBase(document)
  for (const key of ['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const) for (const [id, row] of Object.entries(visual?.[key] ?? {})) rows.set(`visual.${key}:${id}`, { id, value: row })
  if (visual) rows.set('visual.environment:environment', { id: 'environment', value: visual.environment })
  if (document.visual?.version === 3) for (const [id, row] of Object.entries(document.visual.transitions)) rows.set(`visual.transition:${id}`, { id, value: row })
  for (const key of ['areas', 'lines', 'landmarks', 'symbols'] as const) for (const [id, row] of Object.entries(document.regional?.[key] ?? {})) rows.set(`regional.${key}:${id}`, { id, value: row })
  const filtersByTarget = new Map<string, unknown[]>()
  for (const filter of Object.values(visual?.filters ?? {})) {
    if (filter.target.kind !== 'entities' || !filter.enabled) continue
    const { target: _target, ...effect } = filter
    for (const id of filter.target.ids) {
      const list = filtersByTarget.get(id) ?? []
      list.push(effect); filtersByTarget.set(id, list)
    }
  }
  for (const list of filtersByTarget.values()) list.sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0)
  for (const [key, row] of rows) if (filtersByTarget.has(row.id)) rows.set(key, { ...row, value: { target: row.value, filters: filtersByTarget.get(row.id) } })
  return rows
}
export function semanticChangedDocumentTargets(before: SceneDocument, after: SceneDocument): string[] {
  const a = semanticTargetEntries(before), b = semanticTargetEntries(after)
  const keys = new Set([...a.keys(), ...b.keys()])
  const equal = isCertifiedSceneSnapshot(before) && isCertifiedSceneSnapshot(after)
    ? (first: unknown, second: unknown) => equalOwnedJson(first ?? null, second ?? null) : same
  const changed = new Set([...keys].filter(key => !equal(a.get(key)?.value, b.get(key)?.value)).sort())
  return [...changed].filter(key => {
    if (key.startsWith('visual.filters:')) {
      const id = key.slice('visual.filters:'.length), first = visualBase(before)?.filters[id], second = visualBase(after)?.filters[id]
      // A finite filter changes its actual targets. Its bookkeeping row does
      // not add one more edit on top of the same expanded appearance update.
      if (first?.target.kind === 'entities' || second?.target.kind === 'entities') return false
    }
    const members = groupMemberIds(before, after, key)
    if (!members.some(id => changed.has(`prop:${id}`))) return true
    const [kind, id] = splitTarget(key), collection = kind === 'prefab' ? 'prefabInstances' : 'scatterGroups'
    const first = before[collection][id], second = after[collection][id]
    if (!first || !second) return false
    const business = (row: unknown) => {
      const { members: _members, anchorMm: _anchor, rotationDeg: _rotation, densityFactor: _density, exclusions: _exclusions, ...value } = row as Record<string, unknown>
      return value
    }
    return !equal(business(first), business(second))
  })
}
const splitTarget = (target: string): [string, string] => [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)]
export function groupMemberIds(before: SceneDocument, after: SceneDocument, target: string): string[] {
  const [kind, id] = splitTarget(target)
  if (kind !== 'prefab' && kind !== 'scatter') return []
  const key = kind === 'prefab' ? 'prefabInstances' : 'scatterGroups'
  return sorted([before, after].flatMap(document => Object.values(document[key][id]?.members ?? {}).flatMap(member => member.propId ?? [])))
}

export const taskSemanticTargets = semanticChangedDocumentTargets
export interface TaskBudgetMetadata {
  before: Pick<CompositionContent,'historyIdentity'|'appearance'>
  after: Pick<CompositionContent,'historyIdentity'|'appearance'> & { assets?: Record<string,{sizeBytes:number;pixelWidth:number;pixelHeight:number}> }
}
export const measureBudgetGeometry = (value: unknown): Pick<BudgetUsage,'geometryPoints'|'geometrySegments'|'curveSegments'> => {
    const result={geometryPoints:0,geometrySegments:0,curveSegments:0}
    const row=value as Record<string,unknown> | undefined
    if (!row || typeof row !== 'object') return result
    const add=(item:unknown)=>{const next=measureBudgetGeometry(item);for(const key of ['geometryPoints','geometrySegments','curveSegments'] as const)result[key]+=next[key]}
    const ring=row.boundaryMm as unknown[] | undefined, path=(row.centerlineMm ?? row.pointsMm) as unknown[] | undefined
    if (Array.isArray(ring)) { result.geometryPoints+=ring.length; result.geometrySegments+=ring.length }
    if (Array.isArray(path)) { result.geometryPoints+=path.length; result.geometrySegments+=Math.max(0,path.length-1) }
    const sightLine = (row.sightOccluder as { pointsLocalMm?: unknown[] } | undefined)?.pointsLocalMm
    if (Array.isArray(sightLine)) { result.geometryPoints += sightLine.length; result.geometrySegments += sightLine.length - 1 }
    if (Array.isArray(row.widthSections)) {
      const additionalOutlinePoints = row.widthSections.length * 8
      result.geometryPoints += additionalOutlinePoints
      result.geometrySegments += additionalOutlinePoints
    }
    if (typeof row.xMm==='number'&&typeof row.yMm==='number') result.geometryPoints++
    if (Array.isArray(row.boundaryVertexIds)) {result.geometryPoints+=row.boundaryVertexIds.length;result.geometrySegments+=row.boundaryVertexIds.length}
    if (row.positionMm && !ring && !path) result.geometryPoints++
    if (row.startVertexId && row.endVertexId) result.geometrySegments++
    if (row.wallId && typeof row.widthMm==='number') {result.geometryPoints+=2;result.geometrySegments++}
    if (row.footprintMm || row.from && row.to && row.widthMm) {result.geometryPoints+=4;result.geometrySegments+=4}
    if (row.segments && Array.isArray(row.segments)) { result.curveSegments+=row.segments.length; result.geometryPoints+=row.segments.length*4;result.geometrySegments+=row.segments.length }
    if (row.route && typeof row.route === 'object') add(row.route)
    if (row.terrainInlay && typeof row.terrainInlay === 'object') {
      const inlay = row.terrainInlay as { geometry: { verticesMm: Record<string, unknown>; faces: Record<string, unknown>; sources: unknown[] }; originalConnection: unknown }
      result.geometryPoints += Object.keys(inlay.geometry.verticesMm).length
      result.geometrySegments += Object.keys(inlay.geometry.faces).length * 3
      for (const source of inlay.geometry.sources) add(source)
      add(inlay.originalConnection)
    }
    if (row.carvedStrip && typeof row.carvedStrip === 'object') {
      const strip = row.carvedStrip as { verticesMm: Record<string, unknown>; faces: Record<string, unknown> }
      result.geometryPoints += Object.keys(strip.verticesMm).length
      result.geometrySegments += Object.keys(strip.faces).length * 3
    }
    const shell = (row.rockBody as { shell?: { verticesMm: Record<string, unknown>; faces: Record<string, unknown> } } | undefined)?.shell
    if (shell) { result.geometryPoints += Object.keys(shell.verticesMm).length; result.geometrySegments += Object.keys(shell.faces).length * 3 }
    if (row.feature && typeof row.feature === 'object') {
      const feature = row.feature as { polygonLocalMm?: unknown[] }
      if (feature.polygonLocalMm) add({ boundaryMm: feature.polygonLocalMm })
    }
    if (row.polygons && Array.isArray(row.polygons)) for (const polygon of row.polygons) add({boundaryMm: polygon.pointsMm ?? polygon})
    if (row.strokes && Array.isArray(row.strokes)) for (const stroke of row.strokes) add({pointsMm: stroke.pointsMm})
    if(row.target&&typeof row.target==='object'&&Array.isArray((row.target as {boundaryMm?:unknown}).boundaryMm))add(row.target)
    for(const key of ['surfaceStyle','floorStyle','topStyle']) {
      const style=row[key] as {overlays?:{boundaryMm:unknown[]}[]}|null|undefined
      for(const overlay of style?.overlays??[])add(overlay)
    }
    return result
  }

const retainedGeometry = new WeakMap<SceneDocument, number>()
const referenceArrayFields = new Set(['inputs', 'outputs', 'outputRefs', 'reads', 'writes', 'supportRefs'])
/** Measured by the full meter; consumers must additionally require a private domain witness. */
export const measuredRetainedSegments = (document: SceneDocument): number | undefined => retainedGeometry.get(document)

/** The same retained-reference accounting is used before selecting a manual
 * envelope and by the final meter. It does not validate or authorize a write. */
export function measureBudgetDependencies(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  let count = 0
  if (Array.isArray(value)) {
    for (const row of value) count += measureBudgetDependencies(row)
    return count
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const row = record[key]
    if (key.endsWith('Ref') && row && typeof row === 'object') count++
    if (key !== 'id' && key.endsWith('Id') && typeof row === 'string') count++
    if (Array.isArray(row) && (referenceArrayFields.has(key) || key.endsWith('Ids'))) count += row.length
    if (row && typeof row === 'object') count += measureBudgetDependencies(row)
  }
  return count
}

/** Geometry delta, retained references and resources shared by both budget policies. */
export function measureDocumentBudget(before: SceneDocument, after: SceneDocument, metadata?: Partial<TaskBudgetMetadata['after']>): BudgetUsage {
  const usage = emptyBudgetUsage()
  const equal = isCertifiedSceneSnapshot(before) && isCertifiedSceneSnapshot(after)
    ? (first: unknown, second: unknown) => equalOwnedJson(first ?? null, second ?? null) : same

  const addChanged=(first:unknown,second:unknown)=>{
    if(equal(first,second))return
    const a=measureBudgetGeometry(first),b=measureBudgetGeometry(second)
    // Removing or simplifying complex geometry still checks its old closure.
    for(const key of ['geometryPoints','geometrySegments','curveSegments'] as const)usage[key]+=Math.max(a[key],b[key])
    const oldGrid = (first as { relief?: { offsetsMm: number[] } } | undefined)?.relief
    const newGrid = (second as { relief?: { offsetsMm: number[] } } | undefined)?.relief
    if ((oldGrid || newGrid) && !equal(oldGrid, newGrid)) usage.gridNodes += Math.max(oldGrid?.offsetsMm.length ?? 0, newGrid?.offsetsMm.length ?? 0)
  }
  let retainedSegments=0
  for (const collection of LAYER_ENTITY_COLLECTIONS) for (const id of new Set([...Object.keys(before[collection]),...Object.keys(after[collection])])) {
    addChanged(before[collection][id],after[collection][id]);retainedSegments+=measureBudgetGeometry(after[collection][id]).geometrySegments
  }
  for (const collection of DECORATION_COLLECTIONS) for (const id of new Set([...Object.keys(before[collection] ?? {}), ...Object.keys(after[collection] ?? {})])) {
    addChanged(before[collection]?.[id], after[collection]?.[id]); retainedSegments += measureBudgetGeometry(after[collection]?.[id]).geometrySegments
  }
  for (const collection of SURFACE_RULE_COLLECTIONS) for (const id of new Set([...Object.keys(before[collection] ?? {}), ...Object.keys(after[collection] ?? {})])) {
    addChanged(before[collection]?.[id], after[collection]?.[id]); retainedSegments += measureBudgetGeometry(after[collection]?.[id]).geometrySegments
  }
  const av=visualBase(before),bv=visualBase(after)
  for (const collection of ['attachmentSurfaces', 'attachments'] as const) for (const id of new Set([...Object.keys(before[collection] ?? {}), ...Object.keys(after[collection] ?? {})])) {
    addChanged(before[collection]?.[id], after[collection]?.[id]); retainedSegments += measureBudgetGeometry(after[collection]?.[id]).geometrySegments
  }
  for(const collection of ['boundaries','edgeLooks','lights','fogs','filters'] as const)
    for (const id of new Set([...Object.keys(av?.[collection]??{}),...Object.keys(bv?.[collection]??{})])) {
      addChanged(av?.[collection][id],bv?.[collection][id]);retainedSegments+=measureBudgetGeometry(bv?.[collection][id]).geometrySegments
    }
  const materialized=(document:SceneDocument)=>document.visual.base.materializedEdges
  const am=materialized(before),bm=materialized(after)
  for(const id of new Set([...Object.keys(am),...Object.keys(bm)])){
    addChanged(am[id],bm[id]);retainedSegments+=measureBudgetGeometry(bm[id]).geometrySegments
  }
  const transitions=(document:SceneDocument)=>document.visual?.version===3?document.visual.transitions:{}
  const at=transitions(before),bt=transitions(after)
  for(const id of new Set([...Object.keys(at),...Object.keys(bt)])){
    addChanged(at[id],bt[id]);retainedSegments+=measureBudgetGeometry(bt[id]).geometrySegments
  }
  for(const collection of ['areas','lines','landmarks','symbols'] as const)
    for(const id of new Set([...Object.keys(before.regional?.[collection]??{}),...Object.keys(after.regional?.[collection]??{})])){
      addChanged(before.regional?.[collection][id],after.regional?.[collection][id]);retainedSegments+=measureBudgetGeometry(after.regional?.[collection][id]).geometrySegments
    }
  retainedGeometry.set(after, retainedSegments)
  // Conservative edge-pair admission for a changed closure against retained
  // geometry. Executors add repeated clipping/search/validation work through
  // executionUsage; this bound is independent of the editable target count.
  usage.intersectionPairs=usage.geometrySegments*(retainedSegments+usage.geometrySegments)
  usage.dependencyRefs = measureBudgetDependencies(after) + measureBudgetDependencies(metadata?.historyIdentity)
    + measureBudgetDependencies(metadata?.appearance)
  const assets=metadata?.assets
  if(assets){for(const record of Object.values(assets)){usage.assetBytes+=record.sizeBytes;usage.decodePixels+=record.pixelWidth*record.pixelHeight}}
  else{const unique=new Map(Object.values(after.assets).map(record=>[record.sha256,record]));for(const record of unique.values())usage.decodePixels+=record.pixelWidth*record.pixelHeight}
  return usage
}

export function accountBudgetExecution(usage: BudgetUsage, execution: Partial<BudgetUsage>): BudgetUsage {
  for(const [key,value] of Object.entries(execution) as [keyof BudgetUsage,number][]) {
    if(!BUDGET_DIMENSIONS.includes(key)||!Number.isSafeInteger(value)||value<0)throw new Error('任务执行计量无效。')
    usage[key]=(['gridNodes','fieldEvaluations','intersectionPairs','candidateAttempts','activeExecutionMs'] as string[]).includes(key)
      ?usage[key]+value:Math.max(usage[key],value)
  }
  return freezeJson(BudgetUsageSchema.parse(usage))
}
/** Task policy counts all retained metadata and its own semantic targets. */
export function measureTaskBudget(before: SceneDocument, after: SceneDocument, metadata?: TaskBudgetMetadata, execution: Partial<BudgetUsage> = {}): BudgetUsage {
  const usage = measureDocumentBudget(before, after, metadata?.after)
  usage.semanticTargets = taskSemanticTargets(before, after).length
  const tree = (value:unknown) => {
    if(!value||typeof value!=='object')return
    if(Array.isArray(value)){for(const row of value)tree(row);return}
    usage.metadataRecords++
    for (const row of Object.values(value)) tree(row)
  }
  const data={generation:after.generation??null,historyIdentity:metadata?.after.historyIdentity??null,appearance:metadata?.after.appearance??null,
    attachmentSurfaces: after.attachmentSurfaces ?? null, attachments: after.attachments ?? null,
    ...(after.aggregateCoordinates ? { aggregateCoordinates: after.aggregateCoordinates } : {}),
    sources:{materials:after.materials,propDefinitions:after.propDefinitions,prefabDefinitions:after.prefabDefinitions,assets:after.assets,styleThemes:after.styleThemes,
      regionalSymbolDefinitions:after.regional?.symbolDefinitions??{}}}
  tree(data);usage.metadataBytes=encodeUtf8(canonicalJson(data)).length
  return accountBudgetExecution(usage, execution)
}
/** Explicit selection never applies automatic device/area downshifting. */
export const getTaskBudgetProfile = taskBudgetProfile
