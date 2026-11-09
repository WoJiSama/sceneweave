import { z } from 'zod'
import { validateCatalogKey } from '../library/metadata.js'
import { canonicalJson, captureJson, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { themePackRegistrationSchema } from './theme-packs.js'

const exactKey = z.string().max(4096).refine(value => {
  try { validateCatalogKey(value); return true } catch { return false }
}, '审核须绑定算法1/2/3的确切目录身份。')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const text = z.string().min(1).max(2000).refine(value => value.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(value))
const unique = <T>(values: T[]) => new Set(values).size === values.length
export const assetReviewContentSchema = z.object({
  catalogKey: exactKey, resourceHashes: z.array(hash).max(1024).refine(unique), dependencyKeys: z.array(exactKey).max(1024).refine(unique),
}).strict().refine(value => !value.dependencyKeys.includes(value.catalogKey), '审核依赖集合不能含自身。')
export type AssetReviewContent = z.infer<typeof assetReviewContentSchema>
const evidence = z.object({ label: text, reference: text }).strict()
const attribution = { reviewer: text.nullable(), reviewedAt: z.string().datetime({ offset: false }).nullable(), evidence: z.array(evidence).max(64) }
const dimensionSchema = z.object({ status: z.enum(['not-checked', 'passed', 'changes-required']), ...attribution }).strict()
  .refine(value => value.status === 'not-checked'
    ? value.reviewer === null && value.reviewedAt === null && value.evidence.length === 0
    : value.reviewer !== null && value.reviewedAt !== null && value.evidence.length > 0,
  '已审核结论须有评审者、日期与证据，未检查不得伪造评审资料。')
const signoffSchema = z.object({ status: z.enum(['not-requested', 'accepted', 'changes-requested']), ...attribution }).strict()
  .refine(value => value.status === 'not-requested'
    ? value.reviewer === null && value.reviewedAt === null && value.evidence.length === 0
    : value.reviewer !== null && value.reviewedAt !== null && value.evidence.length > 0,
  '用户签收结论须有签收者、日期与证据。')
export const ASSET_REVIEW_DIMENSIONS = ['rights', 'technical', 'art', 'scene'] as const
export type AssetReviewDimension = typeof ASSET_REVIEW_DIMENSIONS[number]
export const assetReviewDeclarationSchema = z.object({
  format: z.literal('sceneweave-asset-review'), version: z.literal(1), recordId: text,
  content: assetReviewContentSchema,
  checks: z.object({ rights: dimensionSchema, technical: dimensionSchema, art: dimensionSchema, scene: dimensionSchema }).strict(),
  userSignoff: signoffSchema,
}).strict()
export type AssetReviewDeclaration = z.infer<typeof assetReviewDeclarationSchema>
declare const controlledReviewBrand: unique symbol
export type ControlledAssetReview = AssetReviewDeclaration & { readonly [controlledReviewBrand]: true }
const controlled = new WeakSet<object>()

/** Foreign JSON is a declaration only. In particular, a publisher's P3/approved flag cannot create application trust. */
export function parseAssetReviewDeclaration(input: unknown): AssetReviewDeclaration {
  return freezeJson(assetReviewDeclarationSchema.parse(captureJson(input)))
}

/**
 * Called by the application's explicit review/signoff action or its controlled
 * review-record loader, never by a user package importer. The private reference
 * records that administrative boundary only: it is neither a cryptographic
 * signature nor a certificate for image bytes, licenses, geometry or human identity.
 */
export function recordControlledAssetReview(input: unknown): ControlledAssetReview {
  const record = parseAssetReviewDeclaration(input)
  controlled.add(record)
  return record as ControlledAssetReview
}
export function isControlledAssetReview(input: unknown): input is ControlledAssetReview {
  return input !== null && typeof input === 'object' && controlled.has(input)
}

function captureContent(input: unknown): AssetReviewContent {
  const value = assetReviewContentSchema.parse(captureJson(input))
  value.resourceHashes.sort(); value.dependencyKeys.sort()
  return freezeJson(value)
}
const sameSet = (left: readonly string[], right: readonly string[]) => {
  const ordered = [...right].sort()
  return left.length === right.length && [...left].sort().every((value, index) => value === ordered[index])
}
export interface AssetPublicationAssessment {
  mode: 'public-default' | 'personal'
  reviewReady: boolean
  issues: string[]
  /** Always required even after complete review: this result grants no save/import/render validation exemption. */
  requiresFullValidation: true
}

/** Compares complete supplied descriptors, not bytes. Full resource/permission validation remains a separate mandatory boundary. */
export function assessAssetPublication(contentInput: unknown, reviewInput: unknown, mode: 'public-default' | 'personal' = 'public-default'): AssetPublicationAssessment {
  const content = captureContent(contentInput), issues: string[] = []
  if (mode !== 'public-default' && mode !== 'personal') throw new Error('未知素材发布范围。')
  if (mode === 'personal') return freezeJson({ mode, reviewReady: true, issues, requiresFullValidation: true })
  if (!isControlledAssetReview(reviewInput)) issues.push('缺少应用明确记录的审核；外来声明不能授予P3或公开发布资格。')
  else {
    if (content.catalogKey !== reviewInput.content.catalogKey) issues.push('审核不属于当前确切目录身份。')
    if (!sameSet(content.resourceHashes, reviewInput.content.resourceHashes)) issues.push('审核资源hash集合与当前内容不一致。')
    if (!sameSet(content.dependencyKeys, reviewInput.content.dependencyKeys)) issues.push('审核依赖集合与当前内容不一致。')
    for (const dimension of ASSET_REVIEW_DIMENSIONS) if (reviewInput.checks[dimension].status !== 'passed') issues.push(`${dimension}审核未通过。`)
    if (reviewInput.userSignoff.status !== 'accepted') issues.push('缺少当前确切内容的用户签收。')
  }
  return freezeJson({ mode, reviewReady: issues.length === 0, issues, requiresFullValidation: true })
}

export interface ThemePackPublicationAssessment {
  reviewReady: boolean
  issues: string[]
  members: { catalogKey: string; assessment: AssetPublicationAssessment }[]
  requiresFullValidation: true
}
export const themePackReviewContentSchema = z.object({
  packId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), fixedVersion: z.number().int().safe().positive(),
  registrationHash: hash, theme: themePackRegistrationSchema.shape.theme,
  members: z.array(assetReviewContentSchema).min(1).max(512),
}).strict().refine(value => new Set(value.members.map(member => member.catalogKey)).size === value.members.length,
'整包审核成员身份不能重复。')
export const themePackReviewDeclarationSchema = z.object({
  format: z.literal('sceneweave-theme-pack-review'), version: z.literal(1), recordId: text,
  content: themePackReviewContentSchema,
  checks: z.object({ rights: dimensionSchema, technical: dimensionSchema, art: dimensionSchema, scene: dimensionSchema }).strict(),
  userSignoff: signoffSchema,
}).strict()
export type ThemePackReviewDeclaration = z.infer<typeof themePackReviewDeclarationSchema>
declare const controlledPackReviewBrand: unique symbol
export type ControlledThemePackReview = ThemePackReviewDeclaration & { readonly [controlledPackReviewBrand]: true }
const controlledPacks = new WeakSet<object>()
export function parseThemePackReviewDeclaration(input: unknown): ThemePackReviewDeclaration {
  return freezeJson(themePackReviewDeclarationSchema.parse(captureJson(input)))
}
/** Application-controlled whole-map review; a package declaration cannot call itself accepted. No cryptographic proof is asserted. */
export function recordControlledThemePackReview(input: unknown): ControlledThemePackReview {
  const record = parseThemePackReviewDeclaration(input)
  controlledPacks.add(record)
  return record as ControlledThemePackReview
}
function normalizedMembers(values: readonly AssetReviewContent[]): AssetReviewContent[] {
  return values.map(captureContent).sort((a, b) => a.catalogKey < b.catalogKey ? -1 : a.catalogKey > b.catalogKey ? 1 : 0)
}
/** A metadata descriptor for an explicit whole-pack review. Availability/discovery are lifecycle state, not fixed artwork. */
export function createThemePackReviewContent(packInput: unknown, contentInputs: unknown): z.infer<typeof themePackReviewContentSchema> {
  const pack = themePackRegistrationSchema.parse(captureJson(packInput))
  const members = normalizedMembers(z.array(assetReviewContentSchema).min(1).max(512).parse(captureJson(contentInputs)))
  if (new Set(members.map(member => member.catalogKey)).size !== members.length
    || !sameSet(members.map(member => member.catalogKey), pack.catalogKeys)) throw new Error('整包审核须明确全部且不重复的确切成员。')
  const registrationHash = sha256Text(canonicalJson({ id: pack.id, fixedVersion: pack.fixedVersion, name: pack.name,
    axes: pack.axes, planId: pack.planId, catalogKeys: [...pack.catalogKeys].sort(), theme: pack.theme, coverage: pack.coverage }))
  return freezeJson({ packId: pack.id, fixedVersion: pack.fixedVersion, registrationHash, theme: pack.theme, members })
}
/** Withdrawal affects discovery only. This function never deletes project/history resources or changes the pack. */
export function assessThemePackPublication(packInput: unknown, contentInputs: unknown, reviewInputs: readonly unknown[], packReviewInput?: unknown): ThemePackPublicationAssessment {
  const pack = themePackRegistrationSchema.parse(captureJson(packInput))
  const contents = z.array(assetReviewContentSchema).max(512).parse(captureJson(contentInputs)), issues: string[] = []
  const keys = contents.map(content => content.catalogKey)
  if (new Set(keys).size !== keys.length) issues.push('发布内容包含重复目录身份。')
  if (!sameSet(keys, pack.catalogKeys)) issues.push('发布内容未精确覆盖注册包的全部成员。')
  if (pack.availability === 'planned') issues.push('计划包没有已制作的发布内容。')
  if (pack.theme === null) issues.push('完整主题包缺少确切主题表现快照。')
  if (pack.coverage === null) issues.push('完整主题包缺少绑定完整必需项的两份实际样板布局与实体摘要。')
  if (pack.discovery === 'withdrawn') issues.push('主题包已撤下发现列表，不能作为新公开默认包发布。')
  const records = new Map<string, ControlledAssetReview>()
  for (const record of reviewInputs) if (isControlledAssetReview(record)) {
    if (records.has(record.content.catalogKey)) issues.push('同一目录身份有多份审核，须明确选择本次发布记录。')
    records.set(record.content.catalogKey, record)
  }
  const members = contents.map(content => ({ catalogKey: content.catalogKey,
    assessment: assessAssetPublication(content, records.get(content.catalogKey)) }))
  for (const member of members) if (!member.assessment.reviewReady) issues.push(`${member.catalogKey}：${member.assessment.issues.join('；')}`)
  if (packReviewInput === null || typeof packReviewInput !== 'object' || !controlledPacks.has(packReviewInput)) {
    issues.push('缺少应用明确记录的完整主题包审核与用户签收，单件通过不能代替整图。')
  } else {
    const review = packReviewInput as ControlledThemePackReview
    const registrationHash = sha256Text(canonicalJson({ id: pack.id, fixedVersion: pack.fixedVersion, name: pack.name,
      axes: pack.axes, planId: pack.planId, catalogKeys: [...pack.catalogKeys].sort(), theme: pack.theme, coverage: pack.coverage }))
    if (review.content.packId !== pack.id || review.content.fixedVersion !== pack.fixedVersion
      || review.content.registrationHash !== registrationHash
      || canonicalJson(review.content.theme) !== canonicalJson(pack.theme)
      || canonicalJson(normalizedMembers(review.content.members)) !== canonicalJson(normalizedMembers(contents))) {
      issues.push('整包审核未绑定当前确切包版本、主题快照或完整成员资源/依赖。')
    }
    for (const dimension of ASSET_REVIEW_DIMENSIONS) if (review.checks[dimension].status !== 'passed') issues.push(`整包${dimension}审核未通过。`)
    if (review.userSignoff.status !== 'accepted') issues.push('缺少当前完整主题包的用户签收。')
  }
  return freezeJson({ reviewReady: issues.length === 0, issues, members, requiresFullValidation: true })
}
