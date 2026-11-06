import { z } from 'zod'
import { AGGREGATE_ENTITY_COLLECTIONS, AGGREGATE_LIMITS } from '../model/aggregate.js'
import type { EntityKind } from '../model/scene.js'
import { id, point } from '../validation/primitives.js'

export const aggregateFrameSchema = z.object({ translationMm: point,
  quarterTurns: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
}).strict()
export const aggregateEntityRefSchema = z.object({ kind: z.enum(Object.keys(AGGREGATE_ENTITY_COLLECTIONS) as EntityKind[]), id }).strict()
export const aggregateGroupSchema = z.object({ id, floorId: id, parentId: id.nullable(), frame: aggregateFrameSchema,
  members: z.array(aggregateEntityRefSchema).max(AGGREGATE_LIMITS.references), editLocked: z.boolean(),
}).strict()
/** The encoding is an I/O boundary, never two independently editable geometries. */
export const aggregateCoordinatesSchema = z.object({ encoding: z.enum(['world', 'local']), groups: z.record(id, aggregateGroupSchema) }).strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value.groups).length > AGGREGATE_LIMITS.groups
      || Object.values(value.groups).reduce((count, group) => count + group.members.length, 0) > AGGREGATE_LIMITS.references) ctx.addIssue({ code: 'custom', message: '聚合体数量或成员引用超过保护限制。' })
    // Aggregate editing/locks arrive with the boundary-aware commands in c/d.
    if (Object.values(value.groups).some(group => group.editLocked)) ctx.addIssue({ code: 'custom', message: '当前坐标表示尚不支持组锁；请继续使用成员及图层锁。' })
  })
