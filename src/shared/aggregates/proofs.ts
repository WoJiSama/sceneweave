import type { AggregateContract, AggregateDependency, AggregateEntityRef, AggregateRelationRef, AggregateSceneSource } from '../model/aggregate.js'
import type { ProjectData } from '../model/project.js'
import type { SceneDocument } from '../model/scene.js'
import { aggregateEntityKey, inspectAggregateContract, type AggregateInspection } from './contracts.js'
import { aggregateEntityRelations } from './relations.js'
import { canonicalJson, freezeJson, inspectJsonInput } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { validateSceneDocument } from '../validation/scene.js'
import { validateProjectData } from '../project/validate.js'

export interface AggregateInternalProof {
  readonly kind: 'sceneweave-aggregate-internal-proof@1'
  readonly source: AggregateSceneSource
  readonly projectHash: string
  readonly groupId: string
  readonly proofHash: string
  readonly constraintsHash: string
  readonly algorithmContract: string
  readonly memberCount: number
  readonly dependencyCount: number
}

interface ProofRecord { readonly canonical: string }
const ISSUED_PROOFS = new WeakMap<object, ProofRecord>()

function checkedScene(input: unknown): SceneDocument {
  const result = validateSceneDocument(input)
  if (!result.ok) throw new Error(`内部证明拒绝无效场景：${result.errors[0]?.message ?? '完整场景校验失败。'}`)
  if (result.document.aggregateCoordinates?.encoding === 'local') throw new Error('内部证明只接受已解码的world场景视图。')
  return result.document
}

function descendants(contract: AggregateContract, rootId: string): Set<string> {
  const result = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const group of Object.values(contract.groups)) if (group.parentId !== null && result.has(group.parentId) && !result.has(group.id)) {
      result.add(group.id); changed = true
    }
  }
  return result
}

function ownerIdOf(inspection: AggregateInspection, ref: AggregateRelationRef): string | null {
  if (ref.kind === 'floor') return null
  const key = aggregateEntityKey(ref)
  return inspection.members.find(member => aggregateEntityKey(member.entity) === key)?.ownerId ?? null
}

function proofBody(scene: SceneDocument, projectHash: string, inspection: AggregateInspection, groupId: string, constraints: unknown, algorithmContract: string) {
  const contract = inspection.contract
  if (!Object.hasOwn(contract.groups, groupId)) throw new Error('内部证明目标聚合体不存在。')
  const includedGroups = descendants(contract, groupId)
  const members = inspection.members.filter(member => member.ownerId !== null && includedGroups.has(member.ownerId))
  const memberKeys = new Set(members.map(member => aggregateEntityKey(member.entity)))
  const relations = aggregateEntityRelations(scene).filter(edge => memberKeys.has(aggregateEntityKey(edge.from))
    || edge.to.kind !== 'floor' && memberKeys.has(aggregateEntityKey(edge.to)))
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))
  const dependencies: AggregateDependency[] = relations.map(edge => ({
    ...edge,
    fromOwnerId: ownerIdOf(inspection, edge.from),
    toOwnerId: ownerIdOf(inspection, edge.to),
  }))
  const memberChunkRefs = new Set(memberKeys)
  const chunks = contract.chunks.filter(chunk => chunk.entities.some(ref => memberChunkRefs.has(aggregateEntityKey(ref))))
    .map(chunk => ({ key: chunk.key, contentState: chunk.contentState, entities: chunk.entities.filter(ref => memberChunkRefs.has(aggregateEntityKey(ref))) }))
    .sort((a, b) => canonicalJson(a.key).localeCompare(canonicalJson(b.key)))
  const ports = inspection.ports.filter(item => includedGroups.has(item.port.groupId)).sort((a, b) => a.port.id.localeCompare(b.port.id))
  const groups = [...includedGroups].map(id => contract.groups[id]).sort((a, b) => a.id.localeCompare(b.id))
  const relevantMembers = members.sort((a, b) => aggregateEntityKey(a.entity).localeCompare(aggregateEntityKey(b.entity)))
  const constraintJson = canonicalJson(constraints)
  return {
    source: contract.source,
    projectHash,
    groupId,
    groups,
    members: relevantMembers,
    dependencies,
    ports,
    chunks,
    constraintsHash: sha256Text(constraintJson),
    algorithmContract,
  }
}

function inspectForProof(projectInput: unknown, contractInput: unknown): { scene: SceneDocument; projectHash: string; inspection: AggregateInspection } {
  const project: ProjectData = validateProjectData(projectInput), scene = checkedScene(project.document)
  const projectHash = sha256Text(canonicalJson(project)), result = inspectAggregateContract(scene, contractInput)
  if (!result.ok) throw new Error(`内部证明拒绝无效或过期聚合合同：${result.errors[0]?.message ?? '来源验证失败。'}`)
  return { scene, projectHash, inspection: result.inspection }
}

/** Issues an opaque immutable witness after full project and aggregate-contract validation. */
export function createAggregateInternalProof(
  projectInput: unknown,
  contractInput: unknown,
  groupId: string,
  constraints: unknown,
  algorithmContract: string,
): AggregateInternalProof {
  const constraintsIssue = inspectJsonInput(constraints)
  if (constraintsIssue) throw new Error(`约束不能绑定到内部证明：${constraintsIssue.message}`)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/.test(algorithmContract)) throw new Error('算法合同须为有界的稳定标识。')
  const { scene, projectHash, inspection } = inspectForProof(projectInput, contractInput)
  const body = proofBody(scene, projectHash, inspection, groupId, constraints, algorithmContract)
  const proof: AggregateInternalProof = freezeJson({
    kind: 'sceneweave-aggregate-internal-proof@1',
    source: body.source,
    projectHash,
    groupId,
    proofHash: sha256Text(canonicalJson(body)),
    constraintsHash: body.constraintsHash,
    algorithmContract,
    memberCount: body.members.length,
    dependencyCount: body.dependencies.length,
  })
  ISSUED_PROOFS.set(proof, Object.freeze({ canonical: canonicalJson(proof) }))
  return proof
}

/** Only the exact object issued here can pass. A clone, stale scene, edited
 * contract, changed constraint, or different algorithm contract returns false. */
export function isAggregateInternalProofValid(
  projectInput: unknown,
  contractInput: unknown,
  proofInput: unknown,
  constraints: unknown,
  algorithmContract: string,
): proofInput is AggregateInternalProof {
  if (!proofInput || typeof proofInput !== 'object') return false
  const issued = ISSUED_PROOFS.get(proofInput)
  if (!issued) return false
  try {
    const constraintsIssue = inspectJsonInput(constraints)
    if (constraintsIssue || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/.test(algorithmContract)) return false
    const { scene, projectHash, inspection } = inspectForProof(projectInput, contractInput)
    const candidate = proofInput as AggregateInternalProof
    const body = proofBody(scene, projectHash, inspection, candidate.groupId, constraints, algorithmContract)
    const expected = {
      kind: 'sceneweave-aggregate-internal-proof@1' as const,
      source: body.source,
      projectHash,
      groupId: candidate.groupId,
      proofHash: sha256Text(canonicalJson(body)),
      constraintsHash: body.constraintsHash,
      algorithmContract,
      memberCount: body.members.length,
      dependencyCount: body.dependencies.length,
    }
    const canonical = canonicalJson(expected)
    return canonical === issued.canonical && canonicalJson(candidate) === issued.canonical
  } catch {
    return false
  }
}
