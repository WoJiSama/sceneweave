import { z } from 'zod'
import type { Issue, SceneDocument } from './types'
import { validateGeometry } from './geometry'

const id = z.string().min(1).max(256)
const integer = z.number().finite().refine(Number.isSafeInteger, '必须是安全整数')
const positive = integer.refine(value => value > 0, '必须大于零')
const nonnegative = integer.refine(value => value >= 0, '不得小于零')
const point = z.object({ x: integer, y: integer }).strict()
const size = z.object({ width: positive, height: positive }).strict()
const bounds = z.object({ x: integer, y: integer, width: positive, height: positive }).strict()
const editable = { id, floorId: id, editLocked: z.boolean() }
const visibility = z.enum(['public', 'gm'])
const entityKind = z.enum(['vertex', 'room', 'wall', 'opening', 'prop', 'region', 'note'])
const anchor = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entity'), entityKind, entityId: id }).strict(),
  z.object({ type: z.literal('point'), positionMm: point }).strict(),
])
const timestamp = z.string().datetime({ offset: false })

/** All nested objects are strict: unknown required semantics may never silently disappear on save. */
export const sceneSchema = z.object({
  format: z.literal('sceneweave'), schemaVersion: z.literal(1), sceneId: id, revision: nonnegative,
  title: z.string().min(1), createdAt: timestamp, updatedAt: timestamp,
  units: z.object({ world: z.literal('mm'), display: z.enum(['m', 'ft']), gridSizeMm: positive, snapMm: positive, gridVisible: z.boolean() }).strict(),
  exportBoundsMm: bounds,
  floors: z.record(z.string(), z.object({ id, name: z.string(), boundsMm: bounds }).strict()),
  vertices: z.record(z.string(), z.object({ ...editable, xMm: integer, yMm: integer }).strict()),
  rooms: z.record(z.string(), z.object({ ...editable, boundaryVertexIds: z.array(id).min(3), purpose: z.string(), visibility,
    accessExpectation: z.enum(['unspecified', 'required', 'intentionalIsolation']) }).strict()),
  walls: z.record(z.string(), z.object({ ...editable, startVertexId: id, endVertexId: id, thicknessMm: positive, blocksMovement: z.boolean(), blocksSight: z.boolean() }).strict()),
  openings: z.record(z.string(), z.object({ ...editable, wallId: id, offsetMm: nonnegative, widthMm: positive,
    kind: z.enum(['door', 'window']), state: z.enum(['open', 'closed']), locked: z.boolean(), secret: z.boolean(), revealed: z.boolean() }).strict()),
  props: z.record(z.string(), z.object({ ...editable, assetId: id.nullable(), symbol: z.enum(['table', 'chair', 'shelf', 'rug', 'crate']), positionMm: point,
    rotationDeg: z.number().finite().min(0).lt(360), footprintMm: size, blocksMovement: z.boolean(), blocksSight: z.boolean(), visibility, roomId: id.optional() }).strict()),
  regions: z.record(z.string(), z.object({ ...editable, boundaryMm: z.array(point).min(3), kind: z.enum(['terrain', 'hazard', 'manualMask']),
    blocksMovement: z.boolean(), movementCostMultiplier: z.number().finite().min(1), visibility }).strict()),
  notes: z.record(z.string(), z.object({ ...editable, anchor, kind: z.enum(['note', 'clue', 'label']), title: z.string().optional(), text: z.string(), visibility, discovered: z.boolean().optional() }).strict()),
  assets: z.record(z.string(), z.object({ id, sha256: z.string().regex(/^[a-f0-9]{64}$/), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    pixelWidth: positive, pixelHeight: positive, logicalSizeMm: size, licenseRef: id,
    origin: z.object({ kind: z.enum(['original', 'imported', 'generated']), attribution: z.string(), canEmbed: z.boolean() }).strict() }).strict()),
  presetSnapshot: z.object({ presetId: id, presetVersion: positive, distanceMode: z.enum(['metric', 'grid', 'abstract']), source: z.string(), gridSizeMm: positive }).strict(),
  constraints: z.object({ entranceOpeningIds: z.array(id), wallEndClearanceMm: nonnegative, minDoorWidthMm: positive.optional(), minPathWidthMm: positive.optional(),
    pathChecks: z.array(z.object({ id, from: anchor, to: anchor, clearanceMm: positive, mode: z.enum(['structural', 'current']), assumedOpenDoorIds: z.array(id) }).strict()) }).strict(),
  generationMetadata: z.object({ generatorVersion: z.string(), seed: z.string(), summary: z.string().optional(), adoptedAt: timestamp }).strict().optional(),
}).strict()

export type ValidationResult = { ok: true; document: SceneDocument; warnings: Issue[] } | { ok: false; errors: Issue[] }
/** Zod deliberately skips __proto__ dictionary keys; detect them before parsing so no entry disappears. */
export function inspectJsonInput(input: unknown): Issue | undefined {
  const ancestors = new WeakSet<object>()
  const visit = (value: unknown, depth: number): Issue | undefined => {
    if (value === null || typeof value !== 'object') return undefined
    if (depth > 128 || ancestors.has(value)) return { code: 'NON_JSON_INPUT', message: '文档不能含循环引用或超过 128 层的嵌套。' }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype && !(Array.isArray(value) && prototype === Array.prototype)) return { code: 'NON_JSON_INPUT', message: '输入只能包含普通 JSON 对象与数组。' }
    ancestors.add(value)
    for (const key of Reflect.ownKeys(value)) {
      if (key === '__proto__' || typeof key !== 'string') return { code: 'UNSAFE_KEY', message: '不能使用被运行时忽略的 __proto__ 键或 Symbol 字段。' }
      if (Array.isArray(value) && key === 'length') continue
      if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return { code: 'NON_JSON_INPUT', message: '数组不能带有 JSON 序列化会忽略的额外属性。' }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (descriptor.get || descriptor.set || !descriptor.enumerable) return { code: 'NON_JSON_INPUT', message: '输入不能含访问器或不参与 JSON 序列化的隐藏字段。' }
      const issue = visit(descriptor.value, depth + 1)
      if (issue) return issue
    }
    ancestors.delete(value)
    return undefined
  }
  return visit(input, 0)
}
export function validateScene(input: unknown): ValidationResult {
  const inputIssue = inspectJsonInput(input)
  if (inputIssue) return { ok: false, errors: [inputIssue] }
  const parsed = sceneSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => ({ code: 'SCHEMA', message: `${issue.path.join('.') || 'document'}: ${issue.message}` })) }
  const document = parsed.data as SceneDocument
  const { errors, warnings } = validateGeometry(document)
  return errors.length ? { ok: false, errors } : { ok: true, document, warnings }
}
