import { validatePathAttachmentProofs } from '../path-attachments/validation.js'
import { associateScenePresentations, inheritPropUpdatePresentations, propPresentation, validatePresentations } from '../appearance/presentation.js'
import { presentationRecordSchema } from '../terrain-generation/contracts.js'
import { validateCompositionIdentityContracts } from '../terrain-generation/composition-integrity.js'
import { z } from 'zod'
import { cloneJson, freezeJson, inspectJsonInput } from './json.js'
import { sceneSchema } from './scene.js'
import { reviseSceneSnapshot, tryApplyPropUpdatesSnapshot, validateSceneDerivationSnapshot, validateSceneSnapshot, validateFreshSceneSnapshot, getPropUpdateTransaction, releasePropUpdateTransaction, type PropUpdateTransaction, type PropUpdateStep } from './snapshots.js'
import { enumerateLayerEntities } from '../commands/layers.js'
import type { MaterialPaint, SceneDocument } from '../model/scene.js'
import { bitmapVariant, equalCompositionValue, propAppearanceSnapshot, resolveAppearance, supportedAppearanceKinds, surfaceStyle } from '../appearance/graph.js'
import { validateHistoryIdentity } from '../history/identity.js'
import { COMPOSITION_LIMITS, type AppearanceGraph, type AppearanceSource, type CompositionContent } from '../model/appearance.js'


export const compositionIdSchema = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留 ID')
const id = compositionIdSchema, color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const appearanceAdjustmentSchema = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('tint'), value: color.nullable(), enabled: z.boolean() }).strict(),
  z.object({ id, kind: z.literal('brightness'), value: z.number().finite().min(.25).max(2), enabled: z.boolean() }).strict(),
  z.object({ id, kind: z.literal('opacity'), value: z.number().finite().min(0).max(1), enabled: z.boolean() }).strict(),
  z.object({ id, kind: z.literal('shadowClass'), value: z.enum(['none', 'furniture', 'vegetation']), enabled: z.boolean() }).strict(),
])
const adjustments = z.array(appearanceAdjustmentSchema).max(COMPOSITION_LIMITS.adjustmentsPerTarget).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: '同一目标的调整记录 ID 不能重复。' })
  const enabled = items.filter(item => item.enabled)
  if (new Set(enabled.map(item => item.kind)).size !== enabled.length) ctx.addIssue({ code: 'custom', message: '同一目标每个属性只能启用一条覆盖。' })
})
const propSnapshot = sceneSchema.shape.props.valueType.pick({ definitionRef: true, appearance: true, visualBoundsMm: true, shadowClass: true, shadowOverride: true }).strict()
const surfaceSnapshot = sceneSchema.shape.rooms.valueType.shape.floorStyle.unwrap()
export const appearanceGraphSchema = z.object({
  version: z.literal(1),
  sources: z.record(id, z.discriminatedUnion('kind', [
    z.object({ id, kind: z.literal('prop'), parentSourceId: id.nullable(), snapshot: propSnapshot }).strict(),
    z.object({ id, kind: z.literal('surface'), parentSourceId: id.nullable(), snapshot: surfaceSnapshot }).strict(),
  ])),
  propSources: z.record(id, id), surfaceSources: z.record(id, id), instanceAdjustments: z.record(id, adjustments), layerAdjustments: z.record(id, adjustments),
  variants: z.record(id, z.object({ id, sourceAssetId: id, tint: color.nullable(), brightness: z.number().finite().min(.25).max(2), outputAssetId: id }).strict()),
  prefabAppearanceTemplates: z.record(id, z.object({ definitionRef: z.object({ id, version: z.number().int().positive() }).strict(), visibility: z.enum(['public', 'gm']),
    members: z.record(id, z.object({ sourceId: id, adjustments }).strict()),
  }).strict()),
}).strict()
export const appearanceGraph2Schema = appearanceGraphSchema.extend({ version: z.literal(2), presentations: presentationRecordSchema }).strict()
export const nativeAppearanceGraphSchema = appearanceGraph2Schema
// The wrapper owns no domain fields. Each strict domain parser below captures
// its branch exactly once instead of parsing the same scene through this
// wrapper, scene validation and the identity check again.
const contentEnvelopeSchema = z.object({ document: z.unknown(), historyIdentity: z.unknown(), appearance: z.unknown() }).strict()

// A certificate belongs to these three owned immutable objects together, never
// to a scene ID/revision, a caller's frozen flag, or a mutable project wrapper.
type ContentRegistry = WeakMap<object, WeakMap<object, WeakMap<object, CompositionContent>>>
const certifiedContents: ContentRegistry = new WeakMap()
// A valid draft may require actual bitmap materialization or appearance resolving.
// It never grants the complete/resolved content or resource certificate.
const certifiedDrafts: ContentRegistry = new WeakMap()
function captureContentFields(input: unknown): CompositionContent | undefined {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return
  const fields = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(fields).length !== 3 || !['document', 'historyIdentity', 'appearance'].every(key => fields[key]?.enumerable && 'value' in fields[key])) return
  // Use only this descriptor snapshot, never re-read caller/Proxy properties.
  const document = fields.document.value, historyIdentity = fields.historyIdentity.value, appearance = fields.appearance.value
  if (!document || !historyIdentity || !appearance || typeof document !== 'object' || typeof historyIdentity !== 'object' || typeof appearance !== 'object') return
  return { document, historyIdentity, appearance }
}
function knownContent(input: unknown, registries: readonly ContentRegistry[]): CompositionContent | undefined {
  const fields = captureContentFields(input)
  if (!fields) return
  for (const registry of registries) {
    const known = registry.get(fields.document)?.get(fields.historyIdentity)?.get(fields.appearance)
    if (known) return known
  }
}
export function getCertifiedCompositionContent(input: unknown): CompositionContent | undefined {
  return knownContent(input, [certifiedContents])
}
/** Internal draft proof only; public validation does not reuse this as full content. */
export function getCertifiedCompositionDraft(input: unknown): CompositionContent | undefined {
  return knownContent(input, [certifiedDrafts])
}
function freezeContent<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeContent(child)
  }
  return value
}
/** Only this strict parser can issue a certificate, on its own detached JSON. */
export function certifyCompositionContent(input: unknown): CompositionContent {
  const known = getCertifiedCompositionContent(input)
  if (known) return known
  return registerContent(readCompositionContent(input, true))
}
/** Independent domain parsing, identity and appearance references, then immutable draft ownership. */
export function certifyCompositionDraft(input: unknown): CompositionContent {
  const known = knownContent(input, [certifiedContents, certifiedDrafts])
  if (known) return known
  return registerOwnedContent(certifiedDrafts, readCompositionDraft(input, true))
}
/** Internal candidate route: the snapshot owner independently checks the full
 * delta. Identity, generation receipts and appearance still validate normally. */
export function certifyDerivedCompositionDraft(input: unknown, baseline: SceneDocument): CompositionContent {
  const known = knownContent(input, [certifiedContents, certifiedDrafts])
  if (known) return known
  return registerOwnedContent(certifiedDrafts, readCompositionDraft(input, true, baseline))
}
function registerContent(content: CompositionContent): CompositionContent {
  return registerOwnedContent(certifiedContents, content)
}
function registerOwnedContent(registry: ContentRegistry, content: CompositionContent, propBaseline?: SceneDocument): CompositionContent {
  if (!propBaseline || !inheritPropUpdatePresentations(propBaseline, content.document, content.appearance)) associateScenePresentations(content.document, content.appearance)
  freezeContent(content)
  let identities = registry.get(content.document)
  if (!identities) { identities = new WeakMap(); registry.set(content.document, identities) }
  let appearances = identities.get(content.historyIdentity)
  if (!appearances) { appearances = new WeakMap(); identities.set(content.historyIdentity, appearances) }
  appearances.set(content.appearance, content)
  return content
}

export interface PropUpdateCompositionStep extends Omit<PropUpdateStep, 'before' | 'after'> {
  readonly before: CompositionContent
  readonly after: CompositionContent
  readonly commandCost: number
}
export interface PropUpdateCompositionTransaction {
  readonly baseline: CompositionContent
  readonly result: CompositionContent
  readonly sceneTransaction: PropUpdateTransaction
  readonly commands: PropUpdateTransaction['commands']
  readonly steps: readonly PropUpdateCompositionStep[]
  readonly changes: PropUpdateTransaction['changes']
}
const issuedPropCompositionTransactions = new WeakSet<object>()
type PropCompositionReceipt = { latest: PropUpdateCompositionTransaction; baselines: WeakMap<SceneDocument, PropUpdateCompositionTransaction> }
const propCompositionTransactions = new WeakMap<SceneDocument, WeakMap<object, WeakMap<object, PropCompositionReceipt>>>()
function registerPropCompositionTransaction(witness: PropUpdateCompositionTransaction): void {
  issuedPropCompositionTransactions.add(witness)
  const { result, baseline } = witness
  if (result.document === baseline.document) return
  let identities = propCompositionTransactions.get(result.document)
  if (!identities) { identities = new WeakMap(); propCompositionTransactions.set(result.document, identities) }
  let appearances = identities.get(result.historyIdentity)
  if (!appearances) { appearances = new WeakMap(); identities.set(result.historyIdentity, appearances) }
  let entry = appearances.get(result.appearance)
  if (!entry) { entry = { latest: witness, baselines: new WeakMap() }; appearances.set(result.appearance, entry) }
  entry.latest = witness; entry.baselines.set(baseline.document, witness)
}
/** Exact document/identity/appearance references, not a caller-owned wrapper. */
export function getPropUpdateCompositionTransaction(input: unknown, baseline?: CompositionContent): PropUpdateCompositionTransaction | undefined {
  const result = getCertifiedCompositionContent(input)
  if (!result) return
  const entry = propCompositionTransactions.get(result.document)?.get(result.historyIdentity)?.get(result.appearance)
  const source = baseline === undefined ? undefined : getCertifiedCompositionContent(baseline)
  if (baseline !== undefined && !source) return
  const witness = source ? entry?.baselines.get(source.document) : entry?.latest
  if (!witness) return
  if (source && (witness.baseline.historyIdentity !== source.historyIdentity || witness.baseline.appearance !== source.appearance)) return
  return witness
}
/** Release consumed write-set evidence without revoking complete validation or
 * transferring proof. The baseline may still serve other pending operations. */
export function releasePropUpdateCompositionTransaction(witness: PropUpdateCompositionTransaction): void {
  if (!issuedPropCompositionTransactions.has(witness)) return
  issuedPropCompositionTransactions.delete(witness)
  const remove = (content: CompositionContent) => {
    if (content.document !== witness.baseline.document) propCompositionTransactions.get(content.document)?.get(content.historyIdentity)?.delete(content.appearance)
  }
  remove(witness.result)
  witness.steps.forEach(step => remove(step.after))
  releasePropUpdateTransaction(witness.sceneTransaction)
}

/** A complete resolved baseline plus the snapshot owner's closed executor proves
 * unchanged births, sources, effective appearance and pixels. Position/angle
 * cannot affect those fields; near-side orientation is the sole extra invariant.
 * No changed-id argument or external registration API exists. */
export function tryApplyPropUpdateCompositionTransaction(input: unknown, commands: unknown): PropUpdateCompositionTransaction | undefined {
  const baseline = getCertifiedCompositionContent(input)
  if (!baseline) return
  const transaction = tryApplyPropUpdatesSnapshot(baseline.document, commands)
  if (!transaction) return
  for (const step of transaction.steps) for (const change of step.changes) {
    if (propPresentation(baseline.appearance, change.id)?.mode === 'nearSide' && change.after.rotationDeg !== 0) return
  }
  const contents = new Map<SceneDocument, CompositionContent>([[baseline.document, baseline]])
  const contentFor = (document: SceneDocument): CompositionContent => {
    let result = contents.get(document)
    if (!result) {
      result = registerOwnedContent(certifiedContents, { document, historyIdentity: baseline.historyIdentity, appearance: baseline.appearance }, baseline.document)
      contents.set(document, result)
    }
    return result
  }
  const steps = transaction.steps.map(step => ({ ...step, before: contentFor(step.before), after: contentFor(step.after), commandCost: 1 }))
  const result = contentFor(transaction.result)
  const witness = freezeJson({ baseline, result, sceneTransaction: transaction, commands: transaction.commands, steps, changes: transaction.changes })
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    if (step.before.document === step.after.document) continue
    const local = getPropUpdateTransaction(step.after.document, step.before.document)!
    registerPropCompositionTransaction(freezeJson({ baseline: step.before, result: step.after, sceneTransaction: local, commands: local.commands, steps: [step], changes: local.changes }))
    const prefix = getPropUpdateTransaction(step.after.document, baseline.document)
    if (prefix) registerPropCompositionTransaction(freezeJson({ baseline, result: step.after, sceneTransaction: prefix, commands: prefix.commands, steps: steps.slice(0, index + 1), changes: prefix.changes }))
  }
  registerPropCompositionTransaction(witness)
  return witness
}

export interface CompositionRevisionTransaction {
  readonly baseline: CompositionContent
  readonly result: CompositionContent
  readonly changes: { readonly revision: { readonly before: number; readonly after: number }; readonly updatedAt: { readonly before: string; readonly after: string } }
}
/** Revision adoption may also preserve older identity tombstones. This proof
 * records the real validated endpoints but does not widen the finite revision
 * metadata fast path above. */
export interface CompositionCommitTransaction {
  readonly baseline: CompositionContent
  readonly result: CompositionContent
}
const compositionCommits = new WeakMap<SceneDocument, CompositionCommitTransaction>()
const issuedCompositionCommits = new WeakSet<CompositionCommitTransaction>()
function registerCompositionCommit(baseline: CompositionContent, result: CompositionContent): void {
  const witness = freezeJson({ baseline, result })
  compositionCommits.set(result.document, witness); issuedCompositionCommits.add(witness)
}
export function getCompositionCommitTransaction(input: unknown): CompositionCommitTransaction | undefined {
  const result = getCertifiedCompositionContent(input)
  if (!result) return
  const witness = compositionCommits.get(result.document)
  return witness?.result.historyIdentity === result.historyIdentity && witness.result.appearance === result.appearance ? witness : undefined
}
export function releaseCompositionCommitTransaction(witness: CompositionCommitTransaction): void {
  if (!issuedCompositionCommits.delete(witness)) return
  if (compositionCommits.get(witness.result.document) === witness) compositionCommits.delete(witness.result.document)
}
const issuedCompositionRevisions = new WeakSet<object>()
const compositionRevisions = new WeakMap<SceneDocument, CompositionRevisionTransaction>()
export function getCompositionRevisionTransaction(input: unknown, baseline?: CompositionContent): CompositionRevisionTransaction | undefined {
  const result = getCertifiedCompositionContent(input)
  if (!result) return
  const witness = compositionRevisions.get(result.document)
  if (!witness || witness.result.historyIdentity !== result.historyIdentity || witness.result.appearance !== result.appearance) return
  const source = baseline === undefined ? undefined : getCertifiedCompositionContent(baseline)
  return baseline === undefined || source?.document === witness.baseline.document && source.historyIdentity === witness.baseline.historyIdentity && source.appearance === witness.baseline.appearance ? witness : undefined
}

export function releaseCompositionRevisionTransaction(witness: CompositionRevisionTransaction): void {
  if (!issuedCompositionRevisions.has(witness)) return
  issuedCompositionRevisions.delete(witness)
  if (compositionRevisions.get(witness.result.document) === witness) compositionRevisions.delete(witness.result.document)
}

/** Revision metadata cannot change geometry or effective appearance. Identity is checked independently. */
export function reviseCompositionContent(input: unknown, revision: number, updatedAt: string, identityInput?: unknown): CompositionContent {
  const current = certifyCompositionContent(input)
  const document = reviseSceneSnapshot(current.document, revision, updatedAt)
  if (identityInput === undefined || identityInput === current.historyIdentity) {
    const result = registerContent({ document, historyIdentity: current.historyIdentity, appearance: current.appearance })
    const witness = freezeJson({ baseline: current, result, changes: {
      revision: { before: current.document.revision, after: revision }, updatedAt: { before: current.document.updatedAt, after: updatedAt },
    } })
    issuedCompositionRevisions.add(witness); compositionRevisions.set(document, witness)
    registerCompositionCommit(current, result)
    return result
  }
  const historyIdentity = validateHistoryIdentity(identityInput, document)
  const issues = [...validateCompositionIdentityContracts(document, historyIdentity), ...validatePathAttachmentProofs(document, historyIdentity)]
  if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
  const result = registerContent({ document, historyIdentity, appearance: current.appearance })
  registerCompositionCommit(current, result)
  return result
}

function checkGraph(graph: AppearanceGraph, document: SceneDocument): void {
  if (Object.keys(graph.sources).length > COMPOSITION_LIMITS.sources || Object.keys(graph.variants).length > COMPOSITION_LIMITS.variants) throw new Error('外观源/派生记录超过预算。')
  const requireAsset = (id: string) => { if (!Object.hasOwn(document.assets, id)) throw new Error(`固定外观资源缺失：${id}。`) }
  const requirePaint = (paint: MaterialPaint) => { const material = document.materials[paint.materialRef.id]; if (!material || material.version !== paint.materialRef.version) throw new Error(`固定外观材质版本缺失：${paint.materialRef.id}。`); requireAsset(material.textureAssetId) }
  for (const [key, source] of Object.entries(graph.sources)) {
    if (key !== source.id) throw new Error('外观源记录键与 ID 不一致。')
    const seen = new Set<string>(); let parent: typeof source | undefined = source
    while (parent) {
      if (seen.has(parent.id)) throw new Error('外观源存在循环。')
      seen.add(parent.id)
      if (seen.size > COMPOSITION_LIMITS.sourceDepth) throw new Error('外观源祖先链超过16层。')
      if (parent.parentSourceId === null) break
      const ancestor: AppearanceSource | undefined = graph.sources[parent.parentSourceId]
      if (!ancestor || ancestor.kind !== source.kind) throw new Error('外观源祖先悬空或类型不同。')
      parent = ancestor
    }
    if (source.kind === 'prop') {
      const ref = source.snapshot.definitionRef
      if (ref && (!Object.hasOwn(document.propDefinitions, ref.id) || document.propDefinitions[ref.id].version !== ref.version)) throw new Error(`固定物件定义版本缺失：${ref.id}。`)
      if (source.snapshot.appearance.kind === 'image') {
        if (!ref) throw new Error('固定图片外观源必须保留固定物件定义。')
        requireAsset(source.snapshot.appearance.assetId)
      }
    } else {
      if (source.snapshot.base.opacity !== 1) throw new Error('固定表面源底材必须完全不透明。')
      requirePaint(source.snapshot.base); source.snapshot.overlays.forEach(overlay => requirePaint(overlay.paint))
    }
  }
  for (const [key, sourceId] of Object.entries(graph.propSources)) if (!Object.hasOwn(document.props, key) || graph.sources[sourceId]?.kind !== 'prop') throw new Error(`物件外观引用悬空：${key}。`)
  for (const key of Object.keys(document.props)) if (!Object.hasOwn(graph.propSources, key)) throw new Error(`当前物件缺少外观源：${key}。`)
  for (const [key, sourceId] of Object.entries(graph.surfaceSources)) if (!surfaceStyle(document, key) || graph.sources[sourceId]?.kind !== 'surface') throw new Error(`表面外观引用悬空：${key}。`)
  for (const entity of enumerateLayerEntities(document)) if (surfaceStyle(document, entity.id) && !Object.hasOwn(graph.surfaceSources, entity.id)) throw new Error(`当前表面缺少外观源：${entity.id}。`)
  const content = { document, appearance: graph } as CompositionContent
  for (const [target, records] of Object.entries(graph.instanceAdjustments)) {
    if (!Object.hasOwn(graph.propSources, target) && !Object.hasOwn(graph.surfaceSources, target)) throw new Error('实例调整目标悬空。')
    const supported = supportedAppearanceKinds(content, target)
    if (records.some(record => !supported.includes(record.kind))) throw new Error(`实例包含不支持的调整：${target}。`)
  }
  for (const key of Object.keys(graph.layerAdjustments)) if (!Object.hasOwn(document.userLayers, key)) throw new Error('图层调整目标悬空。')
  const outputs = new Set<string>()
  for (const [key, variant] of Object.entries(graph.variants)) {
    const expected = bitmapVariant(variant.sourceAssetId, variant.tint, variant.brightness)
    if (key !== variant.id || !expected || !equalCompositionValue(expected, variant)) throw new Error('固定派生位图参数或 ID 不一致。')
    if (outputs.has(variant.outputAssetId)) throw new Error('派生位图输出 ID 不能重用。')
    outputs.add(variant.outputAssetId); requireAsset(variant.sourceAssetId); requireAsset(variant.outputAssetId)
    const source = document.assets[variant.sourceAssetId], output = document.assets[variant.outputAssetId]
    if (source.pixelWidth !== output.pixelWidth || source.pixelHeight !== output.pixelHeight || !equalCompositionValue(source.logicalSizeMm, output.logicalSizeMm) || source.licenseRef !== output.licenseRef || !equalCompositionValue(source.origin, output.origin)) throw new Error('派生位图尺寸/来源/许可与固定源不一致。')
  }
  for (const [key, template] of Object.entries(graph.prefabAppearanceTemplates)) {
    const definition = document.prefabDefinitions[key]
    if (!definition || template.definitionRef.id !== key || template.definitionRef.version !== definition.version) throw new Error('组合外观模板固定定义不存在或版本不符。')
    const keys = definition.members.map(member => member.key)
    if (Object.keys(template.members).length !== keys.length || keys.some(key => !Object.hasOwn(template.members, key))) throw new Error('组合外观模板成员键必须与固定定义一致。')
    for (const member of Object.values(template.members)) {
      const source = graph.sources[member.sourceId]
      if (source?.kind !== 'prop') throw new Error('组合外观模板源不存在或类型不符。')
      if (source.snapshot.appearance.kind === 'symbol' && member.adjustments.some(adjustment => adjustment.kind === 'tint' || adjustment.kind === 'brightness')) throw new Error('符号组合模板不支持位图颜色调整。')
    }
  }
  for (const key of Object.keys(document.prefabDefinitions)) if (!Object.hasOwn(graph.prefabAppearanceTemplates, key)) throw new Error('固定组合定义缺少外观模板。')
}
export function validateAppearanceGraph(input: unknown, document: SceneDocument): AppearanceGraph {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`外观图无效：${issue.message}`)
  const parsed = nativeAppearanceGraphSchema.safeParse(input)
  if (!parsed.success) throw new Error(`外观图无效：${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；')}`)
  if (parsed.data.version !== 2) throw new Error('场景版本与appearance版本不匹配。')
  validatePresentations(parsed.data, document)
  checkGraph(parsed.data, document); return parsed.data
}
function readCompositionDraft(input: unknown, certifyScene: boolean, baseline?: SceneDocument): CompositionContent {
  const known = certifyScene ? getCertifiedCompositionContent(input) : undefined
  if (known) return known
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`组合工程无效：${issue.message}`)
  const parsed = contentEnvelopeSchema.safeParse(input)
  if (!parsed.success) throw new Error(`组合工程无效：${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；')}`)
  const checked = !certifyScene ? validateFreshSceneSnapshot(parsed.data.document) : baseline ? validateSceneDerivationSnapshot(parsed.data.document, baseline) : validateSceneSnapshot(parsed.data.document)
  if (!checked.ok) throw new Error(`组合场景无效：${checked.errors.map(issue => issue.message).join('；')}`)
  // Identity validation may reuse only this exact privately certified scene.
  // Public drafts still receive detached mutable data, never the witness.
  const historyIdentity = validateHistoryIdentity(parsed.data.historyIdentity, checked.document)
  const compositionIssues = [...validateCompositionIdentityContracts(checked.document, historyIdentity), ...validatePathAttachmentProofs(checked.document, historyIdentity)]
  if (compositionIssues.length) throw new Error(`地貌组合回执无效：${compositionIssues.map(issue => issue.message).join('；')}`)
  const appearance = validateAppearanceGraph(parsed.data.appearance, checked.document)
  return { document: certifyScene ? checked.document : cloneJson(checked.document), historyIdentity, appearance }
}
export function validateCompositionDraft(input: unknown): CompositionContent { return readCompositionDraft(input, false) }
function readCompositionContent(input: unknown, certifyScene: boolean): CompositionContent {
  const known = certifyScene ? getCertifiedCompositionContent(input) : undefined
  if (known) return known
  // Only internal complete certification may reuse an exact immutable draft.
  // Public validation still returns the established detached mutable path and
  // every draft must pass the actual resolved-appearance comparisons below.
  const content = (certifyScene ? getCertifiedCompositionDraft(input) : undefined) ?? readCompositionDraft(input, certifyScene)
  const resolved = resolveAppearance(content)
  for (const prop of Object.values(content.document.props)) if (!equalCompositionValue(propAppearanceSnapshot(prop), propAppearanceSnapshot(resolved.document.props[prop.id]))) throw new Error(`完整物件外观与源/覆盖图不一致：${prop.id}。`)
  for (const id of Object.keys(content.appearance.surfaceSources)) if (!equalCompositionValue(surfaceStyle(content.document, id), surfaceStyle(resolved.document, id))) throw new Error(`完整表面外观与源/覆盖图不一致：${id}。`)
  for (const [id, material] of Object.entries(resolved.document.materials)) if (!Object.hasOwn(content.document.materials, id) || !equalCompositionValue(content.document.materials[id], material)) throw new Error(`固定派生材质未实际保存：${id}。`)
  for (const [id, definition] of Object.entries(resolved.document.propDefinitions)) if (!Object.hasOwn(content.document.propDefinitions, id) || !equalCompositionValue(content.document.propDefinitions[id], definition)) throw new Error(`固定外观保全定义未实际保存：${id}。`)
  associateScenePresentations(content.document, content.appearance)
  return content
}
export function validateCompositionContent(input: unknown): CompositionContent { return readCompositionContent(input, false) }
