import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { z } from 'zod'
import type { AssetRecord, ProjectBundle, ProjectData, SnapshotSummary } from '../model/project.js'
import type { CompleteValidationOptions } from '../ports/resources.js'
import { checkCancelled } from '../ports/resources.js'
import { mergeIdentityRecords, validateHistoryIdentity } from '../history/identity.js'
import { canonicalJson, encodeUtf8, inspectJsonInput } from '../validation/json.js'
import { projectContentHash } from './validate.js'
import { captureProjectBundleInput, validateProjectBundles } from './resources.js'
import { projectSourceRecords } from './source-resources.js'

export interface SnapshotBundle extends SnapshotSummary { bundle: ProjectBundle }
export interface HistoryArchive { current: ProjectBundle; snapshots: SnapshotBundle[] }
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
export const snapshotSummarySchema = z.object({ id, ownerSceneId: id, lineageId: id, sourceRevision: z.number().finite().refine(value => Number.isSafeInteger(value) && value >= 0),
  name: z.string().refine(value => !!value.trim() && Array.from(value).length <= 80), kind: z.enum(['named', 'protection', 'imported-auto']),
  createdAt: z.string().datetime(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export function validateSnapshotSummary(input: unknown): SnapshotSummary {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(issue.message)
  return snapshotSummarySchema.parse(input)
}
function fields(input: unknown, required: readonly string[]): Record<string, PropertyDescriptor> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('历史包须为普通数据对象。')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(input).length !== required.length || !required.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('历史包包含未知、访问器、隐藏或Symbol字段。')
  return descriptors
}
/** No async gaps while capturing summaries and every mutable metadata branch. */
function captureArchive(input: HistoryArchive): HistoryArchive {
  const top = fields(input, ['current', 'snapshots']), values = top.snapshots.value
  if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || values.length > 64) throw new Error('历史包最多64个显式快照。')
  const ownKeys = Reflect.ownKeys(values)
  if (ownKeys.length !== values.length + 1 || ownKeys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)))) throw new Error('历史数组不能含空洞或额外字段。')
  const current = captureProjectBundleInput(top.current.value), snapshots: SnapshotBundle[] = []
  for (let i = 0; i < values.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(i))
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('历史数组不能包含访问器。')
    const row = fields(descriptor.value, ['id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash', 'bundle'])
    const summary = validateSnapshotSummary(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'bundle').map(([key, value]) => [key, value.value])))
    snapshots.push({ ...summary, bundle: captureProjectBundleInput(row.bundle.value) })
  }
  return { current, snapshots }
}
/** One fixed source/version has exactly one meaning throughout selected history. */
export function assertFixedProjectCompatible(left: ProjectData, right: ProjectData): void {
  assertFixedProjectFamilyCompatible([left, right])
}
type FixedDefinition = { namespace: string; id: string; value: unknown; message?: string }
function* fixedProjectDefinitions(project: ProjectData): Generator<FixedDefinition> {
  function* records(namespace: string, rows: Record<string, unknown>): Generator<FixedDefinition> {
    for (const [id, value] of Object.entries(rows)) yield { namespace, id, value }
  }
  for (const key of ['sources', 'variants', 'prefabAppearanceTemplates'] as const) yield* records(`appearance.${key}`, project.appearance[key])
  yield* records('appearance.presentations', project.appearance.presentations ?? {})
  // Older envelopes do not assert whether a v2 presentation is present.
  if (project.appearance.version === 2) for (const id of Object.keys(project.appearance.sources)) yield {
    namespace: 'appearance.presentationPresence', id, value: Object.hasOwn(project.appearance.presentations ?? {}, id),
    message: `固定来源的表现记录不可添加或移除：${id}。`,
  }
  for (const key of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) yield* records(`document.${key}`, project.document[key])
  yield* records('generation.recipes', getLegacyGeneration(project.document)?.recipes ?? {})
  yield* records('regional.symbolDefinitions', project.document.regional?.symbolDefinitions ?? {})
  const profile = project.document.regional?.profile
  if (profile) yield { namespace: 'regional.profile', id: JSON.stringify([profile.id, profile.version]), value: profile,
    message: `固定制图样式版本冲突：${profile.id}@${profile.version}。` }
  yield* records('authoringSources', project.authoringSources)
}
/** A newly visible identity may have existed on a retained branch before it was removed. */
export function hasAddedFixedProjectDefinitions(previous: ProjectData, candidate: ProjectData): boolean {
  const identities = new Map<string, Set<string>>()
  for (const { namespace, id } of fixedProjectDefinitions(previous)) {
    let ids = identities.get(namespace)
    if (!ids) { ids = new Set(); identities.set(namespace, ids) }
    ids.add(id)
  }
  for (const { namespace, id } of fixedProjectDefinitions(candidate)) if (!identities.get(namespace)?.has(id)) return true
  return false
}
/** Keeps only fixed meanings, never a synthetic project or complete historical state. */
export function createFixedProjectFamilyCheck(): (project: ProjectData) => void {
  const meanings = new Map<string, Map<string, string>>()
  const observe = (namespace: string, id: string, value: unknown, message = `固定来源或定义冲突：${id}。`) => {
    let rows = meanings.get(namespace)
    if (!rows) { rows = new Map(); meanings.set(namespace, rows) }
    const meaning = canonicalJson(value), previous = rows.get(id)
    if (previous !== undefined && previous !== meaning) throw new Error(message)
    rows.set(id, meaning)
  }
  return project => {
    for (const { namespace, id, value, message } of fixedProjectDefinitions(project)) observe(namespace, id, value, message)
  }
}
/** Linear in the fixed definitions across every retained branch, even when current content removed an old ID. */
export function assertFixedProjectFamilyCompatible(projects: Iterable<ProjectData>): void {
  const include = createFixedProjectFamilyCheck()
  for (const project of projects) include(project)
}

export async function validateHistoryArchive(input: HistoryArchive, options: CompleteValidationOptions): Promise<HistoryArchive> {
  const archive = captureArchive(input), ids = new Set<string>()
  let named = 0, protections = 0, bytes = 0
  checkCancelled(options?.signal)
  for (const snapshot of archive.snapshots) {
    if (snapshot.kind === 'named') named++
    else if (snapshot.kind === 'protection') protections++
    else throw new Error('便携历史包只接受显式命名/保护快照，不包含imported-auto。')
    if (named > 32 || protections > 32 || ids.has(snapshot.id) || snapshot.ownerSceneId !== archive.current.project.document.sceneId) throw new Error('快照数量/ID/归属无效。')
    ids.add(snapshot.id)
    if (snapshot.sourceRevision !== snapshot.bundle.project.document.revision || snapshot.lineageId !== snapshot.bundle.project.historyIdentity.lineageId) throw new Error('快照修订或lineage与内容不一致。')
    if (projectContentHash(snapshot.bundle.project) !== snapshot.contentHash) throw new Error('快照内容hash不匹配。')
  }
  const identity = mergeIdentityRecords(archive.current.project.historyIdentity, archive.snapshots.map(snapshot => snapshot.bundle.project.historyIdentity))
  validateHistoryIdentity(identity, archive.current.project.document)
  archive.current = { project: { ...archive.current.project, historyIdentity: identity }, resources: archive.current.resources }
  const projects = [archive.current.project, ...archive.snapshots.map(snapshot => snapshot.bundle.project)]
  assertFixedProjectFamilyCompatible(projects)
  const imageRecords = new Map<string, AssetRecord>(), licenses = new Map<string, string>(), sources = new Map<string, number>()
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i]
    for (const value of [project.document, project.historyIdentity, project.appearance, project.authoringSources]) bytes += encodeUtf8(canonicalJson(value)).length
    for (const [hash, record] of Object.entries(project.assets)) {
      const existing = imageRecords.get(hash)
      if (existing && canonicalJson(existing) !== canonicalJson(record)) throw new Error('同hash图片元数据冲突。')
      imageRecords.set(hash, record)
    }
    for (const [hash, record] of Object.entries(project.licenses)) {
      if (licenses.has(hash) && licenses.get(hash) !== record.text) throw new Error('同hash许可正文冲突。')
      licenses.set(hash, record.text)
    }
    for (const [hash, size] of projectSourceRecords(project)) {
      if (sources.has(hash) && sources.get(hash) !== size) throw new Error('历史同hash SVG源字节声明冲突。')
      sources.set(hash, size)
    }
  }
  // Prevent repeated-snapshot memory growth before calling a real decoder.
  if (bytes > 128 * 1024 * 1024) throw new Error('历史文档累计超出128MiB保护预算。')
  const union = [...imageRecords.values()]
  if (union.length > 256 || union.reduce((sum, record) => sum + record.pixelWidth * record.pixelHeight, 0) > 64_000_000) throw new Error('历史联合图片数量或像素超限。')
  const sourceBytes = [...sources.values()].reduce((sum, size) => sum + size, 0)
  if (sourceBytes > 32 * 1024 * 1024 || sources.size > 512) throw new Error('历史联合SVG源超过保护预算。')
  if (bytes + sourceBytes + union.reduce((sum, record) => sum + record.sizeBytes, 0) + [...licenses.values()].reduce((sum, text) => sum + encodeUtf8(text).length, 0) > 300 * 1024 * 1024) throw new Error('历史联合展开字节超过300MiB。')
  const verified = await validateProjectBundles([archive.current, ...archive.snapshots.map(snapshot => snapshot.bundle)], options)
  archive.current = verified[0]
  archive.snapshots.forEach((snapshot, index) => { snapshot.bundle = verified[index + 1] })
  checkCancelled(options?.signal)
  return archive
}
