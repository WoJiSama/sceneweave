import { z } from 'zod'
import { id, int, positive, point, bounds, versionRef, surfaceRef, editable, visibility, angle, rank } from '../validation/primitives.js'
export type { Decoration, DecorationCluster } from '../model/scene.js'

export const DECORATION_LIMITS = Object.freeze({ instances: 4096, clusters: 64, palette: 12, membersPerCluster: 64 })
const common = { ...editable, visibility }
export const decorationSchema = z.object({ ...common, definitionRef: versionRef, supportRef: surfaceRef,
  positionMm: point, rotationDeg: angle,
  scalePpm: int.min(500_000).max(1_500_000), renderOrder: rank,
}).strict()
export const decorationClusterSchema = z.object({ ...common, supportRef: surfaceRef, boundsMm: bounds,
  seed: z.string().min(1).max(128), algorithmVersion: z.literal('cluster-v1'),
  palette: z.array(z.object({ key: id, definitionRef: versionRef, kind: z.enum(['prop', 'decoration']), weight: positive }).strict()).min(1).max(DECORATION_LIMITS.palette)
    .refine(rows => new Set(rows.map(row => row.key)).size === rows.length, '簇状布景palette key必须唯一。')
    .refine(rows => new Set(rows.map(row => `${row.kind}/${row.definitionRef.id}@${row.definitionRef.version}`)).size === rows.length, '簇状布景来源及职责不能重复。'),
  maxInstances: positive.max(DECORATION_LIMITS.membersPerCluster), spacingMm: positive, clusterRadiusMm: positive, clearanceMm: positive,
  members: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.object({ kind: z.enum(['prop', 'decoration']), entityId: id.nullable(), state: z.enum(['managed', 'manual', 'deleted', 'detached']) }).strict())
    .refine(rows => Object.keys(rows).length <= DECORATION_LIMITS.membersPerCluster, '簇状布景实际成员/删除记录超限。'),
}).strict()
export const canopyRuleSchema = z.object({ regionsMm: z.array(z.array(point).min(3).max(512)).min(1).max(128), channel: z.literal('trees'),
  paintOrder: positive, mode: z.enum(['plant', 'erase']), canopyCoveragePpm: int.min(0).max(1_000_000),
}).strict()
export const decorationCluster7Schema = decorationClusterSchema.extend({ canopyRule: canopyRuleSchema.optional() }).strict().superRefine((cluster, ctx) => {
  if (cluster.canopyRule && (cluster.supportRef.kind !== 'terrainArea' || cluster.palette.length !== 1 || cluster.palette[0].kind !== 'prop')) {
    ctx.addIssue({ code: 'custom', message: '树木区域规则须使用单一完整物件素材和明确地形面支撑。' })
  }
})
