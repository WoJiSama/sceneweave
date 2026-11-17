import { z } from 'zod'

export const furnitureRejectionReasons = ['protected-slot', 'missing-definition', 'support-or-bounds', 'use-space-outside', 'physical-clearance', 'reserved-use-space', 'painted-overlap', 'seat-group-unavailable', 'bed-access-unavailable', 'native-command', 'circulation', 'furniture-access'] as const
export type FurnitureRejectionReason = typeof furnitureRejectionReasons[number]
const id = z.string().min(1).max(256)
const count = z.number().int().min(0).max(1_000_000_000)
export const ForestFurnitureDiagnosticsSchema = z.object({
  structureHash: z.string().regex(/^[a-f0-9]{64}$/),
  outcomeHash: z.string().regex(/^[a-f0-9]{64}$/),
  deficit: count,
  rooms: z.array(z.object({
    roomId: id, recipeId: id, requirementId: id, purpose: z.string().max(256), repairable: z.boolean(),
    roles: z.array(z.object({
      role: z.enum(['bed', 'seat', 'table', 'storage', 'work', 'hearth', 'shelf']),
      expected: count, actual: count, deficit: count,
      rejections: z.array(z.object({ reason: z.enum(furnitureRejectionReasons), count: count.min(1) }).strict()).max(furnitureRejectionReasons.length),
    }).strict()).max(7),
    notes: z.array(z.string().max(512)).max(16),
  }).strict()).max(24),
}).strict().superRefine((value, context) => {
  if (new Set(value.rooms.map(room => room.roomId)).size !== value.rooms.length
    || new Set(value.rooms.map(room => room.requirementId)).size !== value.rooms.length
    || value.deficit !== value.rooms.reduce((sum, room) => sum + room.roles.reduce((n, role) => n + role.deficit, 0), 0)
    || value.rooms.some(room => new Set(room.roles.map(role => role.role)).size !== room.roles.length
      || room.roles.some(role => role.deficit !== Math.max(0, role.expected - role.actual)
        || new Set(role.rejections.map(row => row.reason)).size !== role.rejections.length))) {
    context.addIssue({ code: 'custom', message: '逐房家具目标、实际数量或拒绝计数不一致。' })
  }
})
export type ForestFurnitureDiagnostics = z.infer<typeof ForestFurnitureDiagnosticsSchema>
