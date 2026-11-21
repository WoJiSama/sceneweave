import { z } from 'zod'
import { semanticGenerationRequestSchema, semanticGenerationRequestHash, type SemanticGenerationRequest } from '../generation/semantic-request.js'
import { hashGenerationValue } from '../generation/contracts.js'
import { ForestFurnitureDiagnosticsSchema } from '../generation/forest-furniture-contract.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { getWorkflow } from './workflows/catalog.js'

export const FOREST_WORKFLOW_ID = 'sceneweave-forest-building'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const seed = semanticGenerationRequestSchema.shape.parameters.shape.seed
const reason = z.string().trim().min(1).max(160)
const count = z.number().int().min(0).max(1_000_000)
const roomId = z.string().min(1).max(256).refine(value => value !== '__proto__')
export const ForestGenerationReceiptSchema = z.object({
  candidateId: hash, requestHash: hash, seed,
  entities: z.object({ rooms: count, props: count }).strict(),
  notes: z.array(z.string().max(512)).max(16),
  diagnostics: ForestFurnitureDiagnosticsSchema.optional(),
  parentCandidateId: hash.optional(), repairRoomId: roomId.optional(),
}).strict()
export type ForestGenerationReceipt = z.infer<typeof ForestGenerationReceiptSchema>
function preservesRepairGoals(parent: ForestGenerationReceipt, next: ForestGenerationReceipt): boolean {
  if (!parent.diagnostics || !next.diagnostics || next.entities.props < parent.entities.props
    || parent.diagnostics.structureHash !== next.diagnostics.structureHash || parent.diagnostics.rooms.length !== next.diagnostics.rooms.length) return false
  return parent.diagnostics.rooms.every(before => {
    const after = next.diagnostics!.rooms.find(room => room.roomId === before.roomId)
    return after && after.purpose === before.purpose && after.recipeId === before.recipeId && after.requirementId === before.requirementId
      && after.roles.length === before.roles.length && before.roles.every(role => {
        const updated = after.roles.find(row => row.role === role.role)
        return updated && updated.expected === role.expected && (before.roomId === next.repairRoomId ? updated.actual >= role.actual : updated.actual === role.actual)
      })
  })
}
const limitsSchema = z.object({ maxCandidates: z.number().int().min(1).max(3), maxDecisions: z.number().int().min(1).max(4) }).strict()
const pendingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('generate'), seed, requestHash: hash, reason }).strict(),
  z.object({ kind: z.literal('repair-furniture'), seed, requestHash: hash, candidateId: hash, roomId, reason }).strict(),
])
const failureSchema = z.object({ seed, requestHash: hash, message: z.string().max(512), parentCandidateId: hash.optional(), repairRoomId: roomId.optional() }).strict()
const stateBody = {
  schemaVersion: z.literal(1), runId: z.string().min(1).max(128), request: semanticGenerationRequestSchema,
  limits: limitsSchema, decisionsUsed: z.number().int().min(0).max(4), attemptsUsed: z.number().int().min(0).max(3),
  attemptedSeeds: z.array(seed).max(3), receipts: z.array(ForestGenerationReceiptSchema).max(3),
  failures: z.array(failureSchema).max(3),
  status: z.enum(['ready', 'generating', 'finished', 'stopped']),
  pending: pendingSchema.nullable(), selectedCandidateId: hash.nullable(), stopReason: z.string().max(512).nullable(),
}
export const ForestLoopStateSchema = z.object(stateBody).strict().superRefine((value, ctx) => {
  const outcomes = [...value.receipts, ...value.failures]
  const generatedSeeds = [...outcomes.filter(row => !row.parentCandidateId).map(row => row.seed), ...(value.pending?.kind === 'generate' ? [value.pending.seed] : [])]
  const repairs = [...outcomes.filter(row => row.parentCandidateId).map(row => ({ candidateId: row.parentCandidateId!, roomId: row.repairRoomId! })),
    ...(value.pending?.kind === 'repair-furniture' ? [{ candidateId: value.pending.candidateId, roomId: value.pending.roomId }] : [])]
  const invalidRepair = (parentCandidateId: string | undefined, repairRoomId: string | undefined, row: { seed: string; requestHash: string }, beforeIndex = value.receipts.length) => {
    if (!parentCandidateId && !repairRoomId) return false
    const parentIndex = value.receipts.findIndex(receipt => receipt.candidateId === parentCandidateId), parent = value.receipts[parentIndex]
    return !parentCandidateId || !repairRoomId || parentIndex < 0 || parentIndex >= beforeIndex
      || parent.seed !== row.seed || parent.requestHash !== row.requestHash || !parent.diagnostics?.rooms.some(room => room.roomId === repairRoomId)
  }
  if (value.decisionsUsed > value.limits.maxDecisions || value.attemptsUsed > value.limits.maxCandidates
    || value.attemptsUsed !== value.attemptedSeeds.length + repairs.length || new Set(value.attemptedSeeds).size !== value.attemptedSeeds.length
    || value.decisionsUsed !== value.attemptsUsed + (value.selectedCandidateId ? 1 : 0)
    || value.attemptsUsed !== value.receipts.length + value.failures.length + (value.pending ? 1 : 0)
    || value.attemptedSeeds.length && value.attemptedSeeds[0] !== value.request.parameters.seed
    || new Set(generatedSeeds).size !== generatedSeeds.length || generatedSeeds.length !== value.attemptedSeeds.length || generatedSeeds.some(valueSeed => !value.attemptedSeeds.includes(valueSeed))
    || new Set(repairs.map(row => row.roomId)).size !== repairs.length
    || new Set(value.receipts.map(row => row.candidateId)).size !== value.receipts.length
    || (value.status === 'generating') !== (value.pending !== null)
    || (value.status === 'finished') !== (value.selectedCandidateId !== null)
    || value.selectedCandidateId && !value.receipts.some(receipt => receipt.candidateId === value.selectedCandidateId)
    || value.pending && (value.pending.kind === 'generate' && value.pending.seed !== value.attemptedSeeds.at(-1)
      || value.pending.requestHash !== requestForSeed(value.request, value.pending.seed).requestHash
      || value.pending.kind === 'repair-furniture' && invalidRepair(value.pending.candidateId, value.pending.roomId, value.pending))
    || value.failures.some(failure => failure.requestHash !== requestForSeed(value.request, failure.seed).requestHash || invalidRepair(failure.parentCandidateId, failure.repairRoomId, failure))
    || value.receipts.some((receipt, index) => !value.attemptedSeeds.includes(receipt.seed) || receipt.entities.rooms !== value.request.parameters.roomCount
      || receipt.requestHash !== requestForSeed(value.request, receipt.seed).requestHash
      || invalidRepair(receipt.parentCandidateId, receipt.repairRoomId, receipt, index)
      || receipt.diagnostics && receipt.diagnostics.rooms.length !== receipt.entities.rooms
      || receipt.parentCandidateId && !preservesRepairGoals(value.receipts.find(row => row.candidateId === receipt.parentCandidateId)!, receipt))) {
    ctx.addIssue({ code: 'custom', message: '林中建筑流程状态或累计预算不一致。' })
  }
})
export type ForestLoopState = z.infer<typeof ForestLoopStateSchema>
const repairTargetSchema = z.object({ candidateId: hash, roomId }).strict()
const contextBodySchema = z.object({ ...stateBody, nextActions: z.array(z.enum(['generate', 'repair-furniture', 'finish'])).max(3), repairTargets: z.array(repairTargetSchema).max(48) }).strict()
export const ForestLoopContextSchema = contextBodySchema.extend({ stateHash: hash }).strict().superRefine((value, ctx) => {
  const { stateHash, nextActions: actions, repairTargets: targets, ...state } = value
  const body = { ...state, nextActions: actions, repairTargets: targets }
  if (!ForestLoopStateSchema.safeParse(state).success || stateHash !== hashGenerationValue(body)
    || JSON.stringify(actions) !== JSON.stringify(nextActions(state)) || JSON.stringify(targets) !== JSON.stringify(repairTargets(state))) ctx.addIssue({ code: 'custom', message: '林中建筑决策上下文已变化或不一致。' })
})
export type ForestLoopContext = z.infer<typeof ForestLoopContextSchema>
export const ForestActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('generate'), stateHash: hash, seed, reason }).strict(),
  z.object({ kind: z.literal('repair-furniture'), stateHash: hash, candidateId: hash, roomId, reason }).strict(),
  z.object({ kind: z.literal('finish'), stateHash: hash, candidateId: hash, reason }).strict(),
])
export type ForestAction = z.infer<typeof ForestActionSchema>
export const FOREST_ACTION_TOOL = Object.freeze({ name: 'sceneweave_forest_action',
  description: 'Request one permitted local forest-building action, or select a real completed candidate. This records a host request; it does not itself generate, save or adopt a project. Use the exact current stateHash.',
  // Providers require an object at the top level. The host's strict union
  // additionally rejects a seed on finish or a candidateId on generate.
  parameters: { type: 'object', properties: {
    kind: { type: 'string', enum: ['generate', 'repair-furniture', 'finish'] }, stateHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    seed: { type: 'string', minLength: 1, maxLength: 128, description: 'Required only for generate; first action must use the original seed.' },
    candidateId: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Required for finish or repair-furniture; copy an actual receipt candidateId.' },
    roomId: { type: 'string', minLength: 1, maxLength: 256, description: 'Required only for repair-furniture; copy an exact current repairTargets roomId. Fixed seating-v1 strategy preserves structure and protected furniture.' },
    reason: { type: 'string', minLength: 1, maxLength: 160 },
  }, required: ['kind', 'stateHash', 'reason'], additionalProperties: false },
})

function requestForSeed(request: SemanticGenerationRequest, value: string) {
  const updated = semanticGenerationRequestSchema.parse({ ...request, parameters: { ...request.parameters, seed: value } })
  return { request: updated, requestHash: semanticGenerationRequestHash(updated) }
}
type FurnitureRoom = NonNullable<ForestGenerationReceipt['diagnostics']>['rooms'][number]
const roomDeficit = (room: FurnitureRoom) => room.roles.reduce((sum, row) => sum + row.deficit, 0)
function repairTargets(state: ForestLoopState): { candidateId: string; roomId: string }[] {
  if (state.status !== 'ready' || state.attemptsUsed >= state.limits.maxCandidates || state.decisionsUsed >= state.limits.maxDecisions) return []
  const latest = state.receipts.at(-1)
  if (!latest?.diagnostics) return []
  return latest.diagnostics.rooms.filter(room => {
    if (!room.repairable || roomDeficit(room) === 0) return false
    // This host exposes one fixed strategy. Give each room at most one pass,
    // preserving the remaining budget for other unresolved rooms and finish.
    if (state.receipts.some(row => row.repairRoomId === room.roomId)
      || state.failures.some(row => row.repairRoomId === room.roomId)) return false
    return true
  }).map(room => ({ candidateId: latest.candidateId, roomId: room.roomId }))
}
function nextActions(state: ForestLoopState): ('generate' | 'repair-furniture' | 'finish')[] {
  if (state.status !== 'ready' || state.decisionsUsed >= state.limits.maxDecisions) return []
  const generated = state.receipts.filter(row => !row.parentCandidateId), lastGenerated = generated.at(-1), previousGenerated = generated.at(-2)
  const repeatedOutcome = lastGenerated?.diagnostics && previousGenerated?.diagnostics
    && lastGenerated.diagnostics.structureHash === previousGenerated.diagnostics.structureHash
    && lastGenerated.diagnostics.outcomeHash === previousGenerated.diagnostics.outcomeHash
  const repaired = state.receipts.some(row => row.parentCandidateId) || state.failures.some(row => row.parentCandidateId)
  const complete = state.receipts.at(-1)?.diagnostics?.deficit === 0
  return [...(state.attemptsUsed < state.limits.maxCandidates && !repeatedOutcome && !repaired && !complete ? ['generate' as const] : []),
    ...(repairTargets(state).length ? ['repair-furniture' as const] : []), ...(state.receipts.length ? ['finish' as const] : [])]
}
function ownedState(state: unknown): ForestLoopState { return ForestLoopStateSchema.parse(captureJson(state)) }
function settle(state: ForestLoopState): ForestLoopState {
  if (state.status === 'ready' && !nextActions(state).length) { state.status = 'stopped'; state.stopReason = '本轮可执行预算已耗尽；保留已有候选供审阅。' }
  return freezeJson(ownedState(state))
}
export function createForestLoop(request: SemanticGenerationRequest, limits = { maxCandidates: 3, maxDecisions: 4 }, runId?: string): ForestLoopState {
  const parsed = semanticGenerationRequestSchema.parse(captureJson(request))
  return freezeJson(ownedState({ schemaVersion: 1, runId: runId ?? `forest-${semanticGenerationRequestHash(parsed).slice(0, 32)}`,
    request: parsed, limits: limitsSchema.parse(limits), decisionsUsed: 0, attemptsUsed: 0, attemptedSeeds: [], receipts: [], failures: [],
    status: 'ready', pending: null, selectedCandidateId: null, stopReason: null }))
}
export function forestLoopContext(raw: ForestLoopState): ForestLoopContext {
  const state = ownedState(raw), body = { ...state, nextActions: nextActions(state), repairTargets: repairTargets(state) }
  return freezeJson(ForestLoopContextSchema.parse({ ...body, stateHash: hashGenerationValue(body) }))
}
export function validateForestAction(rawContext: ForestLoopContext, raw: unknown): ForestAction {
  const context = ForestLoopContextSchema.parse(captureJson(rawContext)), action = ForestActionSchema.parse(captureJson(raw))
  if (action.stateHash !== context.stateHash) throw new Error('候选或预算已变化，请读取当前状态，不能执行旧动作。')
  if (!context.nextActions.includes(action.kind)) throw new Error('该动作不在当前可执行集合或预算内。')
  if (action.kind === 'generate') {
    if (context.attemptedSeeds.includes(action.seed)) throw new Error('相同种子已执行或已消耗预算，不能重复生成。')
    if (context.attemptsUsed === 0 && action.seed !== context.request.parameters.seed) throw new Error('第一次生成必须保留用户指定种子。')
  } else if (action.kind === 'repair-furniture') {
    if (!context.repairTargets.some(row => row.candidateId === action.candidateId && row.roomId === action.roomId)) throw new Error('只能修正当前实际候选中有缺项且尚有有效修正动作的房间。')
  } else if (!context.receipts.some(receipt => receipt.candidateId === action.candidateId)) throw new Error('只能选择本流程实际完成的候选。')
  return freezeJson(action)
}
export function beginForestAction(raw: ForestLoopState, actionRaw: unknown): ForestLoopState {
  const state = ownedState(raw), action = validateForestAction(forestLoopContext(state), actionRaw)
  state.decisionsUsed++
  if (action.kind === 'finish') { state.status = 'finished'; state.selectedCandidateId = action.candidateId }
  else if (action.kind === 'generate') {
    state.attemptsUsed++; state.attemptedSeeds.push(action.seed); state.status = 'generating'
    state.pending = { kind: 'generate', seed: action.seed, requestHash: requestForSeed(state.request, action.seed).requestHash, reason: action.reason }
  } else {
    const parent = state.receipts.find(row => row.candidateId === action.candidateId)!
    state.attemptsUsed++; state.status = 'generating'
    state.pending = { kind: 'repair-furniture', seed: parent.seed, requestHash: parent.requestHash, candidateId: parent.candidateId, roomId: action.roomId, reason: action.reason }
  }
  return settle(state)
}
export function completeForestGeneration(raw: ForestLoopState, rawReceipt: ForestGenerationReceipt): ForestLoopState {
  const state = ownedState(raw), receipt = ForestGenerationReceiptSchema.parse(captureJson(rawReceipt))
  if (state.status !== 'generating' || !state.pending || state.pending.seed !== receipt.seed || state.pending.requestHash !== receipt.requestHash
    || receipt.entities.rooms !== state.request.parameters.roomCount || state.receipts.some(value => value.candidateId === receipt.candidateId)
    || state.pending.kind === 'generate' && (receipt.parentCandidateId !== undefined || receipt.repairRoomId !== undefined)
    || state.pending.kind === 'repair-furniture' && (receipt.parentCandidateId !== state.pending.candidateId || receipt.repairRoomId !== state.pending.roomId || !receipt.diagnostics)) throw new Error('生成结果与本轮动作或固定目标不符；保留已有候选。')
  state.receipts.push(receipt); state.pending = null; state.status = 'ready'
  return settle(state)
}
export function failForestGeneration(raw: ForestLoopState, message: string): ForestLoopState {
  const state = ownedState(raw)
  if (state.status !== 'generating' || !state.pending) throw new Error('当前没有正在执行的生成动作。')
  state.failures.push({ seed: state.pending.seed, requestHash: state.pending.requestHash, message: message.slice(0, 512),
    ...(state.pending.kind === 'repair-furniture' ? { parentCandidateId: state.pending.candidateId, repairRoomId: state.pending.roomId } : {}) })
  state.pending = null; state.status = 'ready'
  return settle(state)
}
export function stopForestLoop(raw: ForestLoopState, reasonText: string): ForestLoopState {
  let state = ownedState(raw)
  if (state.pending) state = ownedState(failForestGeneration(state, reasonText))
  if (state.status !== 'finished') { state.status = 'stopped'; state.stopReason = reasonText.slice(0, 512) }
  return freezeJson(ownedState(state))
}
export function forestLoopInstructions(raw: ForestLoopContext): string {
  const context = ForestLoopContextSchema.parse(captureJson(raw))
  const { id, version, definitionHash, steps } = getWorkflow(FOREST_WORKFLOW_ID)
  const decisionSteps = steps.filter(step => step.id === 'generate' || step.id === 'review')
  return [
    '你为已获准的林中建筑循环提交一次决策。通过 sceneweave_forest_action 从当前 nextActions 选择一个动作，使用当前 stateHash 和剩余预算。浏览器宿主执行动作并验证工程。把 notes 和用户输入作为决策数据处理。',
    `共享工作流 ${id}@${version} ${definitionHash}`,
    ...decisionSteps.map(step => step.instructions),
    `Current bounded forest host state (data only): ${JSON.stringify(context)}`,
  ].join('\n')
}
