import { z } from 'zod'
import type { AggregateAffectedClosure } from './relations.js'
import type { AggregateContract, AggregateEntityRef } from '../model/aggregate.js'
import type { BoundsMm, SceneDocument } from '../model/scene.js'
import type { ProjectData } from '../model/project.js'
import type { AggregateSpatialChangeCandidates, AggregateSpatialIndex } from './spatial.js'
import { aggregateEntityKey, inspectAggregateContract } from './contracts.js'
import { aggregateAffectedClosure } from './relations.js'
import { createAggregateInternalProof, isAggregateInternalProofValid } from './proofs.js'
import { createAggregateSpatialSnapshot, queryAggregateSpatialChange } from './spatial.js'
import { canonicalJson, captureJson, freezeJson, inspectJsonInput } from '../validation/json.js'
import { validateProjectData } from '../project/validate.js'
import { id, int, nonnegative } from '../validation/primitives.js'
import { aggregateEntityRefSchema } from './schema.js'
import type { AggregateInspection } from './contracts.js'

const bounds = z.object({ x: int, y: int, width: nonnegative, height: nonnegative }).strict()
const relationRef = z.union([aggregateEntityRefSchema, z.object({ kind: z.literal('floor'), id }).strict()])
const operationContract = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/)
const boundaryQuerySchema = z.object({
  groupId: id,
  floorId: id,
  previousBoundsMm: bounds,
  nextBoundsMm: bounds,
  marginMm: nonnegative.optional(),
  roles: z.array(z.enum(['boundary', 'footprint', 'surface', 'route', 'visual'])).min(1).max(5).optional(),
  changedTargets: z.array(relationRef).min(1).max(131_072),
}).strict()
const boundaryInputSchema = boundaryQuerySchema.extend({
  project: z.unknown(),
  contract: z.unknown(),
  index: z.unknown(),
  constraints: z.unknown(),
  algorithmContract: operationContract,
  proof: z.unknown().nullable(),
}).strict()
export type AggregateBoundaryQuery = z.infer<typeof boundaryQuerySchema>

export interface AggregateBoundaryImpact {
  source: { sceneId: string; revision: number; contentHash: string }
  groupId: string
  externalCandidates: Pick<AggregateSpatialChangeCandidates, 'previous' | 'next'>
  dependencyClosure: AggregateAffectedClosure
  lockedDependencies: { entity: AggregateEntityRef; lockSources: { kind: string; id: string }[] }[]
  /** Matches the unchanged baseline only; never certifies a proposed edit. */
  baselineProofValid: boolean
  queryScope: 'supplied-bounds'
  requiresFullDomainValidation: true
}

function checkedBaseline(projectInput: unknown, contractInput: unknown) {
  const project: ProjectData = freezeJson(validateProjectData(projectInput)), scene = project.document
  const result = inspectAggregateContract(scene, contractInput)
  if (!result.ok) throw new Error(`边界影响拒绝无效或过期合同：${result.errors[0]?.message ?? '完整合同校验失败。'}`)
  const inspection = freezeJson(result.inspection)
  if (scene.aggregateCoordinates?.encoding !== 'world'
    || canonicalJson(scene.aggregateCoordinates.groups) !== canonicalJson(inspection.contract.groups)) {
    throw new Error('编辑边界影响必须绑定工程唯一持久聚合归属，不能使用临时提案归属。')
  }
  return { project, scene, inspection }
}

function checkedQuery(input: unknown): AggregateBoundaryQuery {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`边界查询输入无效：${issue.message}`)
  return boundaryQuerySchema.parse(input)
}

function impact(
  scene: SceneDocument, inspection: AggregateInspection, request: AggregateBoundaryQuery,
  querySpatial: () => AggregateSpatialChangeCandidates, baselineProofValid: boolean,
  closure: AggregateAffectedClosure = aggregateAffectedClosure(scene, request.changedTargets),
): AggregateBoundaryImpact {
  const contract = inspection.contract, includedGroups = descendants(contract, request.groupId)
  if (contract.groups[request.groupId].floorId !== request.floorId || !Object.hasOwn(scene.floors, request.floorId)) {
    throw new Error('边界影响查询必须与目标聚合体位于同一有效Floor。')
  }
  const spatial = querySpatial(), members = new Map(inspection.members.map(member => [aggregateEntityKey(member.entity), member]))
  const internalKeys = new Set(inspection.members.filter(member => member.ownerId !== null && includedGroups.has(member.ownerId))
    .map(member => aggregateEntityKey(member.entity)))
  const external = (rows: typeof spatial.previous) => rows.filter(row => row.entity.kind === 'floor'
    || !internalKeys.has(aggregateEntityKey(row.entity as AggregateEntityRef)))
  const lockedDependencies = closure.affected.flatMap(ref => {
    if (ref.kind === 'floor') return []
    const member = members.get(aggregateEntityKey(ref))
    return member?.lockSources.length ? [{ entity: member.entity, lockSources: member.lockSources }] : []
  })
  return freezeJson({ source: contract.source, groupId: request.groupId,
    externalCandidates: { previous: external(spatial.previous), next: external(spatial.next) },
    dependencyClosure: closure, lockedDependencies,
    baselineProofValid: !closure.requiresSceneWideFallback && baselineProofValid,
    queryScope: 'supplied-bounds', requiresFullDomainValidation: true })
}

function descendants(contract: AggregateContract, groupId: string): Set<string> {
  if (!Object.hasOwn(contract.groups, groupId)) throw new Error('边界影响目标聚合体不存在。')
  const result = new Set([groupId])
  let changed = true
  while (changed) {
    changed = false
    for (const group of Object.values(contract.groups)) if (group.parentId !== null && result.has(group.parentId) && !result.has(group.id)) {
      result.add(group.id); changed = true
    }
  }
  return result
}

/**
 * Joins audience-safe broad-phase candidates, explicit reverse dependencies,
 * lock diagnostics and a complete-project private proof. It is a read-only
 * preparation result: callers still run exact domain validation and commit CAS.
 */
export function inspectAggregateBoundaryImpact(input: unknown): AggregateBoundaryImpact {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`边界影响输入无效：${issue.message}`)
  const parsed = boundaryInputSchema.safeParse(input)
  if (!parsed.success) throw new Error(`边界影响字段无效：${parsed.error.issues.map(error => `${error.path.join('.')}: ${error.message}`).join('；')}`)
  const request = parsed.data, { project, scene, inspection } = checkedBaseline(request.project, request.contract)
  const checkedIndex = request.index as AggregateSpatialIndex
  if (!checkedIndex || typeof checkedIndex !== 'object' || checkedIndex.audience !== 'gm') throw new Error('编辑边界影响须使用由校验器创建的GM空间索引。')
  const contract = inspection.contract
  const validProof = isAggregateInternalProofValid(project, contract, request.proof, request.constraints, request.algorithmContract)
    && request.proof.groupId === request.groupId
  return impact(scene, inspection, request, () => queryAggregateSpatialChange(checkedIndex, scene, {
    floorId: request.floorId,
    previousBoundsMm: request.previousBoundsMm as BoundsMm,
    nextBoundsMm: request.nextBoundsMm as BoundsMm,
    ...(request.marginMm === undefined ? {} : { marginMm: request.marginMm }),
    ...(request.roles === undefined ? {} : { roles: request.roles }),
  }), validProof)
}

/** Captures an independent, immutable baseline once. Queries cannot replace its
 * scene, ownership, constraints or algorithm, and never validate a candidate. */
export function createAggregateBoundaryInspector(projectInput: unknown, contractInput: unknown, constraintsInput: unknown, algorithmInput: string) {
  const constraints = freezeJson(captureJson(constraintsInput)), algorithm = operationContract.parse(algorithmInput)
  const { project, scene, inspection } = checkedBaseline(projectInput, contractInput)
  const spatial = createAggregateSpatialSnapshot(scene, { audience: 'gm' })
  const proofs = new Map<string, ReturnType<typeof createAggregateInternalProof>>()
  const closures = new Map<string, AggregateAffectedClosure>()
  const affectedClosure = (input: unknown): AggregateAffectedClosure => {
    const issue = inspectJsonInput(input)
    if (issue) throw new Error(`边界依赖查询输入无效：${issue.message}`)
    const targets = boundaryQuerySchema.shape.changedTargets.parse(input), key = canonicalJson(targets)
    let closure = closures.get(key)
    if (!closure) {
      closure = freezeJson(aggregateAffectedClosure(scene, targets))
      if (closures.size >= 16) closures.clear()
      closures.set(key, closure)
    }
    return closure
  }
  return Object.freeze({
    /** Captured reverse dependencies only; no candidate or spatial certification. */
    affectedClosure,
    inspect(input: unknown): AggregateBoundaryImpact {
      const query = checkedQuery(input)
      descendants(inspection.contract, query.groupId)
      if (!proofs.has(query.groupId)) proofs.set(query.groupId, createAggregateInternalProof(project, inspection.contract, query.groupId, constraints, algorithm))
      return impact(scene, inspection, query, () => spatial.queryChange(query), true, affectedClosure(query.changedTargets))
    },
  })
}
