import { z } from 'zod'
import { id } from '../validation/primitives.js'

export const furnishingRoles = ['bed', 'storage', 'table', 'seat', 'work', 'hearth', 'shelf'] as const
export const furnishingRoleSchema = z.enum(furnishingRoles)
export type FurnishingRole = z.infer<typeof furnishingRoleSchema>
export const furnishingRoleNames: Record<FurnishingRole, string> = { bed: '床', storage: '储物柜', table: '桌子', seat: '座椅', work: '工作台', hearth: '炉台', shelf: '搁架' }
/** Advisory slot memory confers no ownership or permission to edit a prop. */
export const roomFurnishingPlanSchema = z.object({
  algorithmId: z.literal('room-furnishing'), algorithmVersion: z.literal(1), purpose: z.string().trim().min(1).max(80),
  slots: z.array(z.object({ key: id, role: furnishingRoleSchema, propId: id }).strict()).max(64),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.slots.map(slot => slot.key)).size !== value.slots.length || new Set(value.slots.map(slot => slot.propId)).size !== value.slots.length)
    ctx.addIssue({ code: 'custom', message: '布置槽位及物件引用不能重复。' })
  if (value.slots.some(slot => !new RegExp(`^${slot.role}:(?:[0-9]|1[01])$`).test(slot.key))) ctx.addIssue({ code: 'custom', message: '布置槽位须绑定真实功能及0–11的序号。' })
})
export type RoomFurnishingPlan = z.infer<typeof roomFurnishingPlanSchema>
export const roomFurnishingRequestSchema = z.object({
  roomId: id, layerId: id, purpose: z.string().trim().min(1).max(80), variation: z.string().trim().min(1).max(80),
  functions: z.array(z.object({ role: furnishingRoleSchema, count: z.number().int().min(0).max(12),
    definitionRef: z.object({ id, version: z.number().int().positive() }).strict() }).strict()).min(1).max(7)
    .refine(rows => new Set(rows.map(row => row.role)).size === rows.length && rows.reduce((sum, row) => sum + row.count, 0) <= 32, '功能不能重复，每次最多32件。'),
  movableIds: z.array(id).max(32).refine(values => new Set(values).size === values.length),
  restoreDeletedKeys: z.array(id).max(64).refine(values => new Set(values).size === values.length),
}).strict()
export type RoomFurnishingRequest = z.infer<typeof roomFurnishingRequestSchema>

/** Session-only review of a candidate; never a saved authority or geometry proof. */
export interface RoomFurnishingReview {
  summary: string
  added: number; moved: number; preserved: number
  missing: string[]; notes: string[]
  routes: { clear: number; total: number }
  furnitureAccess: { clear: number; total: number }
  hasCandidate: boolean
  rooms?: (Omit<RoomFurnishingReview, 'rooms'> & { roomId: string; purpose: string; style: string })[]
}
