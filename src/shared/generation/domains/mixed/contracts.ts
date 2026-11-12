import { z } from 'zod'
import { interiorLayoutParametersSchema } from '../interior/contracts.js'
import { forestParametersSchema } from '../forest/contracts.js'
import { volcanoParametersSchema } from '../volcano/contracts.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'

const mm = z.number().int().safe(), id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const point = z.object({ x: mm, y: mm }).strict()
const ref = z.object({ id, version: mm.positive() }).strict()
/** One building module and one outdoor module, on one explicit real support.
 * Coordinates, dimensions and fixed references remain user parameters. */
export const mixedParametersSchema = z.object({
  outdoor: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('forest'), parameters: forestParametersSchema }).strict(),
    z.object({ kind: z.literal('volcano'), parameters: volcanoParametersSchema }).strict(),
  ]),
  building: interiorLayoutParametersSchema,
  approach: z.object({ fromMm: point, viaMm: z.array(point).max(16), widthMm: mm.positive().max(5000), materialRef: ref.nullable() }).strict(),
}).strict()
export const mixedGenerationInputSchema = z.object({ version: z.literal(1), algorithmVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9)]), seed: z.string().min(1).max(128), parameters: mixedParametersSchema }).strict()
export type MixedGenerationInput = z.infer<typeof mixedGenerationInputSchema>
export type MixedParameters = z.infer<typeof mixedParametersSchema>
export const mixedMaterialRoleSchema = z.enum(['ground', 'path', 'mountain', 'crater', 'platform', 'flow', 'route', 'floor', 'wall', 'approach'])
export const mixedPropRoleSchema = z.enum(['tree', 'shrub', 'grass', 'bed', 'seat', 'table', 'storage', 'work', 'hearth', 'shelf'])
export function mixedFixedBindings(p: MixedParameters) {
  const materials: { role: z.infer<typeof mixedMaterialRoleSchema>; ref: z.infer<typeof ref> }[] = []
  const props: { role: z.infer<typeof mixedPropRoleSchema>; ref: z.infer<typeof ref> }[] = [...p.building.arrangement.palette]
  for (const role of ['floor', 'wall'] as const) if (p.building.materials[role]) materials.push({ role, ref: p.building.materials[role]! })
  if (p.outdoor.kind === 'forest') {
    const f = p.outdoor.parameters
    if (f.ground.kind === 'new' && f.ground.materialRef) materials.push({ role: 'ground', ref: f.ground.materialRef })
    for (const route of f.routes) if (route.materialRef) materials.push({ role: 'path', ref: route.materialRef })
    for (const zone of f.zones) for (const row of zone.vegetation) for (const item of row.palette) props.push({ role: row.role, ref: item.definitionRef })
  } else for (const role of ['ground', 'mountain', 'crater', 'platform', 'flow', 'route'] as const) materials.push({ role, ref: p.outdoor.parameters.materials[role] })
  if (p.approach.materialRef) materials.push({ role: 'approach', ref: p.approach.materialRef })
  const ordered = <T>(rows: T[]) => [...new Map(rows.map(row => [canonicalJson(row), row])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => cloneJson(row))
  return { materials: ordered(materials), props: ordered(props) }
}
const ids = z.array(id).max(8192)
export const mixedReportSchema = z.object({ environment: z.enum(['forest', 'volcano']), supportAreaId: id, buildingRecipeId: id, outdoorRecipeId: id,
  roomIds: ids, openingIds: ids, propIds: ids, entranceOpeningId: id, approachPathId: id, notes: z.array(z.string().max(5000)).max(8192) }).strict()
export type MixedReport = z.infer<typeof mixedReportSchema>
