import { z } from 'zod'
import { TaskBudgetProfileSchema, type BudgetUsage } from '../budget/task-budget.js'
import { canonicalJson, captureJson, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import type { SceneDocument } from '../model/scene.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const mm = z.number().int().safe()
const positive = mm.positive()
const point = z.object({ x: mm, y: mm }).strict()
// Derived rotated footprints and curved routes retain exact floating geometry.
const derivedPoint = z.object({ x: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), y: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER) }).strict()
const derivedRing = z.array(derivedPoint).min(3).max(4096)
const bounds = z.object({ x: mm, y: mm, width: positive, height: positive }).strict()
const ring = z.array(point).min(3).max(4096)
const surface = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('floor'), id }).strict(),
  z.object({ kind: z.literal('terrainArea'), id }).strict(),
  z.object({ kind: z.literal('room'), id }).strict(),
])
const ref = z.object({ id, version: positive }).strict()
const visibility = z.enum(['public', 'gm'])
const sceneFact = { coordinateFrame: z.literal('scene-mm'), floorId: id, visibility }
const polygon = { boundaryMm: ring }
const port = z.object({ ...sceneFact, positionMm: derivedPoint, directionDeg: z.number().finite().min(0).max(360), widthMm: positive, elevationMm: mm, supportRef: surface, role: z.enum(['entrance', 'exit', 'connection-end']) }).strict()
const diagnostic = z.object({ code: id, message: z.string().min(1).max(2000), artifactIds: z.array(id).max(4096), hard: z.boolean() }).strict()
const artifactBase = { id, owner: z.enum(['structure', 'connectivity', 'content', 'presentation']) }
/** Disposable facts only. They never replace SceneDocument or grant adoption. */
export const generationArtifactSchema = z.discriminatedUnion('kind', [
  z.object({ ...artifactBase, kind: z.literal('plan-region'), payload: z.object({ coordinateFrame: z.enum(['scene-mm', 'region-mm']), floorId: id, visibility, domain: z.enum(['natural', 'building', 'cave', 'mixed', 'regional']), purpose: z.string().max(120), ...polygon }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('support-surface'), payload: z.object({ ...sceneFact, ...polygon, sourceRef: surface, elevationMm: mm, blocksMovement: z.boolean(), editLocked: z.boolean() }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('wall'), payload: z.object({ ...sceneFact, entityId: id, startMm: point, endMm: point, thicknessMm: positive, blocksMovement: z.boolean(), editLocked: z.boolean() }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('opening'), payload: z.object({ ...sceneFact, entityId: id, wallId: id, startMm: derivedPoint, endMm: derivedPoint, widthMm: positive, openingKind: z.enum(['door', 'window']), state: z.enum(['open', 'closed']), locked: z.boolean(), secret: z.boolean(), revealed: z.boolean(), editLocked: z.boolean() }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('footprint'), payload: z.object({ ...sceneFact, boundaryMm: derivedRing, entityId: id, blocksMovement: z.boolean(), editLocked: z.boolean() }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('clearance-volume'), payload: z.object({ ...sceneFact, ...polygon, clearanceMm: mm.nonnegative(), sourceId: id }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('port'), payload: port }).strict(),
  z.object({ ...artifactBase, kind: z.literal('connection'), payload: z.object({ ...sceneFact, entityId: id, fromPortId: id, toPortId: id, widthMm: positive, pathMm: z.array(derivedPoint).min(2).max(4096), blocksMovement: z.boolean() }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('access-zone'), payload: z.object({ ...sceneFact, boundaryMm: derivedRing, sourceId: id, purpose: z.enum(['activity', 'route']) }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('reserved-zone'), payload: z.object({ ...sceneFact, ...polygon, sourceId: id, reason: z.enum(['manual-mask', 'hazard', 'preserve']) }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('material-binding'), payload: z.object({ coordinateFrame: z.literal('scene-mm'), targetId: id, targetKind: z.enum(['terrainArea', 'terrainEdge', 'terrainConnection', 'path', 'room', 'wall']), materialRef: ref }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('prop-placement'), payload: z.object({ ...sceneFact, entityId: id, definitionRef: ref.nullable(), positionMm: point, rotationDeg: z.number().finite(), footprintMm: z.object({ width: positive, height: positive }).strict(), footprintOffsetMm: point, supportRef: surface, blocksMovement: z.boolean() }).strict() }).strict(),
  z.object({ ...artifactBase, kind: z.literal('diagnostic'), payload: diagnostic }).strict(),
])
export type ArtifactKind = z.infer<typeof generationArtifactSchema>['kind']
export type ArtifactOwner = z.infer<typeof generationArtifactSchema>['owner']
export type ArtifactInput = z.infer<typeof generationArtifactSchema>
export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
export type GenerationArtifact = DeepReadonly<ArtifactInput & { contentHash: string }>
export type CoordinateFrame = 'scene-mm' | 'region-mm'
export type GenerationPhase = 'structure' | 'connectivity' | 'content' | 'presentation'
export type GenerationDiagnostic = z.infer<typeof diagnostic>
export const generationDiagnosticSchema = diagnostic
export type GenerationFailureCode = 'invalid-request' | 'unknown-operator' | 'dependency-cycle' | 'missing-input' | 'ownership-conflict' | 'budget-exceeded' | 'operator-failed' | 'candidate-invalid' | 'cancelled'

/** Hard requirements are a finite, independently checked union. Unsupported
 * requirements cannot be hidden in an opaque operator-owned payload. */
export const generationConstraintSchema = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('bounds'), boundsMm: bounds }).strict(),
  z.object({ id, kind: z.literal('support'), artifactId: id, floorId: id, supportRef: surface }).strict(),
  z.object({ id, kind: z.literal('clearance'), artifactId: id, floorId: id, minimumMm: mm.nonnegative(), ignoreEntityIds: z.array(id).max(4096) }).strict(),
  z.object({ id, kind: z.literal('connection'), connectionId: id, minimumWidthMm: positive }).strict(),
  z.object({ id, kind: z.literal('preserve'), entityIds: z.array(id).min(1).max(4096) }).strict(),
])
export type GenerationConstraint = z.infer<typeof generationConstraintSchema>
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
const json: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]))
export const operatorRefSchema = z.object({ id, version: positive }).strict()
export type OperatorRef = z.infer<typeof operatorRefSchema>
const artifactKind = z.enum(generationArtifactSchema.options.map(option => option.shape.kind.value) as [ArtifactKind, ...ArtifactKind[]])
/** Exact step provenance, with bounded selection. Omitted artifactIds selects
 * all facts of this kind from that one source, never from every operator. */
export const generationInputBindingSchema = z.object({ id, kind: artifactKind,
  from: z.discriminatedUnion('kind', [z.object({ kind: z.literal('source') }).strict(), z.object({ kind: z.literal('step'), stepId: id, operator: operatorRefSchema }).strict()]),
  cardinality: z.object({ min: mm.nonnegative(), max: positive.max(8192) }).strict().refine(value => value.min <= value.max),
  artifactIds: z.array(id).min(1).max(8192).refine(values => new Set(values).size === values.length).optional(),
  floorId: id.optional(), coordinateFrame: z.enum(['scene-mm', 'region-mm']).optional(),
}).strict()
export type GenerationInputBinding = z.infer<typeof generationInputBindingSchema>
export const recipeStepSchema = z.object({ id, operator: operatorRefSchema, required: z.boolean(), parameters: z.record(z.string(), json),
  dependsOn: z.array(id).max(64).refine(values => new Set(values).size === values.length), inputs: z.array(generationInputBindingSchema).max(64),
}).strict()
export type RecipeStep = z.infer<typeof recipeStepSchema>
export const generationRecipeSchema = z.object({ id, version: positive, steps: z.array(recipeStepSchema).min(1).max(64), recipeHash: hash }).strict()
export type GenerationRecipe = z.infer<typeof generationRecipeSchema>
export const generationRequestSchema = z.object({ requestVersion: z.literal(1), target: z.discriminatedUnion('kind', [z.object({ kind: z.literal('new-project') }).strict(), z.object({ kind: z.literal('current-project'), scopeId: id }).strict()]),
  coordinateFrame: z.enum(['scene-mm', 'region-mm']), intent: z.object({ environment: z.string().max(120).optional(), structures: z.array(z.string().max(120)).max(64), purposes: z.array(z.string().max(120)).max(64), tags: z.array(z.string().max(120)).max(64) }).strict(),
  intentSource: z.object({ kind: z.enum(['manual', 'text', 'sketch', 'current-project', 'ai-suggestion']), contentHash: hash }).strict(), normalizationVersion: z.literal(1),
  hardConstraints: z.array(generationConstraintSchema).max(256), softGoals: z.array(generationConstraintSchema).max(256), seed: z.string().min(1).max(128), budgetProfile: TaskBudgetProfileSchema, recipe: generationRecipeSchema,
}).strict()
export type GenerationRequest = z.infer<typeof generationRequestSchema>
export interface ArtifactReader { get(id: string): GenerationArtifact | undefined; values(): readonly GenerationArtifact[]; ofKind(kind: ArtifactKind): readonly GenerationArtifact[] }
export interface SpaceQueries {
  readonly sceneId: string; readonly revision: number; readonly contentHash: string; readonly coordinateFrame: CoordinateFrame; readonly artifacts: readonly GenerationArtifact[]
  /** Full wall/opening geometry for bounds checks, independent of movement and
   * door state. Includes wall thickness and miter/bevel joins; unknown IDs are empty. */
  entityGeometryPoints(entityId: string): readonly { x: number; y: number }[]
  supportsPolygon(boundaryMm: readonly { x: number; y: number }[], supportRef: z.infer<typeof surface>, floorId: string): boolean
  /** Conservative planar reservations on one Floor, without vertical clearance.
   * Blocking terrain remains a planar obstacle; this query grants no travel. */
  conflicts(boundaryMm: readonly { x: number; y: number }[], floorId: string, minimumMm?: number, ignoreEntityIds?: readonly string[]): readonly string[]
  connectionUsable(entityId: string, minimumWidthMm: number): boolean
}
export interface OperatorContext {
  readonly request: DeepReadonly<GenerationRequest>; readonly step: DeepReadonly<RecipeStep>; readonly artifacts: ArtifactReader; readonly space: SpaceQueries
  /** Only explicitly selected input artifacts, grouped by binding ID. */
  readonly inputs: { get(bindingId: string): readonly GenerationArtifact[] }
  readonly deriveSeed: (stableKey: string) => string; readonly checkCancelled: () => void
}
export interface GenerationOperatorDescriptor {
  readonly id: string; readonly version: number; readonly phase: GenerationPhase; readonly consumes: readonly ArtifactKind[]; readonly produces: readonly ArtifactKind[]; readonly requires: readonly OperatorRef[]; readonly owner: ArtifactOwner
  /** Newly created/changed scene facts to extract after trusted materialization. */
  readonly publishFacts?: readonly ArtifactKind[]
  readonly determinism: { readonly replayVersion: number; readonly seedDerivation: 'request/recipe/step/operator/key' }
  readonly parseParameters: (input: Readonly<Record<string, JsonValue>>) => Record<string, JsonValue>
  readonly run: (context: OperatorContext) => OperatorOutput
  /** Trusted pure domain materializer. Receives an owned immutable snapshot;
   * its result is captured and validated before later steps can observe it. */
  readonly materialize?: (input: { readonly document: DeepReadonly<SceneDocument>; readonly context: OperatorContext; readonly outputs: readonly GenerationArtifact[] }) => SceneDocument
}
export interface OperatorOutput { readonly outputs: readonly ArtifactInput[]; readonly diagnostics?: readonly GenerationDiagnostic[] }
/** Typed/spatial proposal checks are separate from full project materialization,
 * resources, permissions, identity, player projection, CAS and adoption. */
export interface GenerationCandidate {
  readonly status: 'prepared'; readonly materializationRequired: true; readonly requestHash: string; readonly sourceHash: string; readonly outputHash: string
  readonly outputs: readonly GenerationArtifact[]; readonly diagnostics: readonly DeepReadonly<GenerationDiagnostic>[]; readonly usage: DeepReadonly<BudgetUsage>
  readonly document: DeepReadonly<SceneDocument>; readonly documentHash: string; readonly stages: readonly GenerationStageReceipt[]
}
export interface GenerationStageReceipt {
  readonly stepId: string; readonly operator: DeepReadonly<OperatorRef>; readonly beforeHash: string; readonly afterHash: string
  readonly inputHash: string; readonly outputHash: string
}
export function hashGenerationValue(value: unknown): string { return sha256Text(canonicalJson(value)) }
export function freezeArtifact(input: ArtifactInput): GenerationArtifact {
  const value = generationArtifactSchema.parse(captureJson(input))
  return freezeJson({ ...value, contentHash: hashGenerationValue(value) })
}
