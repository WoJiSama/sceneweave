import { z } from 'zod'
import type { Appearance, DefinitionIdentity, PropTemplate, SceneDocument } from '../model/scene.js'
import type { ProjectBundle, ProjectData } from '../model/project.js'
import type { CompleteValidationOptions } from '../ports/resources.js'
import { checkCancelled } from '../ports/resources.js'
import { sha256Text } from '../geometry/scatter.js'
import { bitmapVariant } from '../appearance/graph.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8 } from '../validation/json.js'
import { captureBytes, sha256Bytes } from '../project/binary.js'
import { captureProjectBundleInput, createMemoryResources, validateProjectBundle } from '../project/resources.js'
import { projectResourceHashes, projectSourceRecords } from '../project/source-resources.js'
import { PROJECT_DATA_LIMITS } from '../project/validate.js'
import { assertFixedProjectCompatible } from '../project/history.js'
import { exportProject, importProject } from '../project/file.js'
import { validateCatalogItem } from './metadata.js'
import { LIBRARY_LIMITS, type CatalogItem, type CatalogSelector, type PreparedLibraryEntry } from './types.js'

const fixedCollections = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
const appearanceCollections = ['sources', 'variants', 'prefabAppearanceTemplates'] as const
const selectorSchema = z.object({ kind: z.enum(['prop', 'material', 'prefab']), definitionId: z.string().min(1).max(256).refine(value => value !== '__proto__') }).strict()
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const own = <T>(record: Record<string, T>, id: string): T => { if (!Object.hasOwn(record, id)) throw new Error(`素材闭包缺少固定内容：${id}。`); return record[id] }
const sorted = (values: Iterable<string>) => [...values].sort()
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const stamp = '1970-01-01T00:00:00.000Z', sceneId = 'sceneweave-catalog-capsule-v1', floorId = 'sceneweave-catalog-floor-v1', layerId = 'sceneweave-catalog-layer-v1'

/** All incidental map metadata is a constant, so a capsule cannot smuggle a project or its identity into a library. */
function neutralProject(): ProjectData {
  const bounds = { x: 0, y: 0, width: 1000, height: 1000 }
  const document: SceneDocument = {
    format: 'sceneweave-scene', schemaVersion: 1, sceneId, revision: 0, title: '素材目录载体', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '目录', boundsMm: { ...bounds } } },
    userLayers: { [layerId]: { id: layerId, floorId, name: '目录', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {},
    terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'catalog-v1', presetVersion: 1, distanceMode: 'metric', source: 'Sceneweave 素材目录', gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] },
  }
  return { format: 'sceneweave-complete-project', schemaVersion: 1, authoringSources: {}, document, historyIdentity: { version: 1, lineageId: 'sceneweave-catalog-lineage-v1', rootSceneId: sceneId, propTokens: {}, prefabTokens: {}, outdoorTokens: {} },
    appearance: { version: 1, sources: {}, propSources: {}, surfaceSources: {}, instanceAdjustments: {}, layerAdjustments: {}, variants: {}, prefabAppearanceTemplates: {} }, assets: {}, licenses: {}, licenseBindings: [] }
}

function definitionFor(project: ProjectData, selector: CatalogSelector): DefinitionIdentity & { name: string; tags: string[] } {
  if (selector.kind === 'prop') return own(project.document.propDefinitions, selector.definitionId)
  if (selector.kind === 'material') return own(project.document.materials, selector.definitionId)
  return own(project.document.prefabDefinitions, selector.definitionId)
}
function fixedAssetRoots(document: SceneDocument): Set<string> {
  return new Set([
    ...Object.values(document.propDefinitions).flatMap(value => value.defaultAppearance.kind === 'image' ? [value.defaultAppearance.assetId] : []),
    ...Object.values(document.materials).map(value => value.textureAssetId),
    ...Object.values(document.prefabDefinitions).flatMap(value => value.members.flatMap(member => member.propTemplate.appearance.kind === 'image' ? [member.propTemplate.appearance.assetId] : [])),
  ])
}

/** Only fixed roots participate. Live instance/layer mappings are deliberately never traversed. */
function extractClosure(source: ProjectData, selectorInput: CatalogSelector): ProjectData {
  const selector = selectorSchema.parse(selectorInput), result = neutralProject(), document = result.document, graph = result.appearance
  const addAsset = (id: string): void => {
    if (Object.hasOwn(document.assets, id)) return
    document.assets[id] = cloneJson(own(source.document.assets, id))
    if (Object.hasOwn(source.authoringSources, id)) result.authoringSources[id] = cloneJson(source.authoringSources[id])
    for (const variant of Object.values(source.appearance.variants)) if (variant.outputAssetId === id) {
      graph.variants[variant.id] = cloneJson(variant); addAsset(variant.sourceAssetId)
    }
  }
  const addAppearance = (appearance: Appearance) => { if (appearance.kind === 'image') addAsset(appearance.assetId) }
  const addProp = (id: string): void => {
    if (Object.hasOwn(document.propDefinitions, id)) return
    const definition = own(source.document.propDefinitions, id)
    document.propDefinitions[id] = cloneJson(definition); addAppearance(definition.defaultAppearance)
  }
  const addMaterial = (id: string): void => {
    if (Object.hasOwn(document.materials, id)) return
    const definition = own(source.document.materials, id)
    document.materials[id] = cloneJson(definition); addAsset(definition.textureAssetId)
  }
  const addSource = (id: string): void => {
    if (Object.hasOwn(graph.sources, id)) return
    const record = own(source.appearance.sources, id)
    graph.sources[id] = cloneJson(record)
    if (record.parentSourceId !== null) addSource(record.parentSourceId)
    if (record.kind === 'prop') {
      if (record.snapshot.definitionRef) addProp(record.snapshot.definitionRef.id)
      addAppearance(record.snapshot.appearance)
    } else for (const paint of [record.snapshot.base, ...record.snapshot.overlays.map(value => value.paint)]) addMaterial(paint.materialRef.id)
  }
  const addPrefab = (id: string): void => {
    if (Object.hasOwn(document.prefabDefinitions, id)) return
    const definition = own(source.document.prefabDefinitions, id), template = own(source.appearance.prefabAppearanceTemplates, id)
    document.prefabDefinitions[id] = cloneJson(definition)
    graph.prefabAppearanceTemplates[id] = cloneJson(template)
    for (const member of definition.members) {
      if (member.propTemplate.definitionRef) addProp(member.propTemplate.definitionRef.id)
      addAppearance(member.propTemplate.appearance)
    }
    for (const member of Object.values(template.members)) {
      addSource(member.sourceId)
      const record = own(graph.sources, member.sourceId)
      if (record.kind === 'prop' && record.snapshot.appearance.kind === 'image') {
        const appearance = record.snapshot.appearance, enabled = member.adjustments.filter(value => value.enabled)
        const tint = enabled.find(value => value.kind === 'tint'), brightness = enabled.find(value => value.kind === 'brightness')
        const variant = bitmapVariant(appearance.assetId, tint?.kind === 'tint' ? tint.value : appearance.tint, brightness?.kind === 'brightness' ? brightness.value : 1)
        if (variant && Object.hasOwn(source.appearance.variants, variant.id)) addAsset(source.appearance.variants[variant.id].outputAssetId)
      }
    }
  }
  if (selector.kind === 'prop') addProp(selector.definitionId)
  else if (selector.kind === 'material') addMaterial(selector.definitionId)
  else addPrefab(selector.definitionId)
  // Ancestor and non-active variant bytes must retain real native-v3 editing roots, not temporary image caches.
  for (;;) {
    const roots = fixedAssetRoots(document), missing = sorted(Object.keys(document.assets).filter(id => !roots.has(id)))
    if (!missing.length) break
    for (const id of missing) {
      const props = Object.values(source.document.propDefinitions).filter(value => value.defaultAppearance.kind === 'image' && value.defaultAppearance.assetId === id)
        .sort((a, b) => Number(!a.tags.includes('sceneweave:retained-appearance')) - Number(!b.tags.includes('sceneweave:retained-appearance')) || compare(a.id, b.id))
      const materials = Object.values(source.document.materials).filter(value => value.textureAssetId === id).sort((a, b) => compare(a.id, b.id))
      const prefabs = Object.values(source.document.prefabDefinitions).filter(value => value.members.some(member => member.propTemplate.appearance.kind === 'image' && member.propTemplate.appearance.assetId === id)).sort((a, b) => compare(a.id, b.id))
      if (props.length) addProp(props[0].id)
      else if (materials.length) addMaterial(materials[0].id)
      else if (prefabs.length) addPrefab(prefabs[0].id)
      else throw new Error(`素材闭包缺少非活动位图的固定保全定义：${id}。`)
    }
  }
  const subjects = new Map<string, string>()
  for (const [collection, kind] of [['assets', 'asset'], ['materials', 'material'], ['propDefinitions', 'propDefinition'], ['prefabDefinitions', 'prefabDefinition']] as const) {
    for (const value of Object.values(document[collection])) subjects.set(`${kind}\0${value.id}`, value.licenseRef)
  }
  for (const [subject, licenseRef] of subjects) {
    const separator = subject.indexOf('\0'), kind = subject.slice(0, separator), id = subject.slice(separator + 1)
    const bindings = source.licenseBindings.filter(value => value.subjectKind === kind && value.subjectId === id && value.licenseRef === licenseRef)
    if (bindings.length !== 1) throw new Error(`素材许可绑定缺失或重复：${id}。`)
    const binding = cloneJson(bindings[0]), match = /^licenses\/([a-f0-9]{64})\.txt$/.exec(binding.licensePath)
    if (!match) throw new Error('素材许可路径无效。')
    result.licenseBindings.push(binding); result.licenses[match[1]] = cloneJson(own(source.licenses, match[1]))
  }
  result.licenseBindings.sort((a, b) => compare(canonicalJson(a), canonicalJson(b)))
  for (const asset of Object.values(document.assets)) result.assets[asset.sha256] = own(source.assets, asset.sha256)
  return result
}

function resourceMetadata(project: ProjectData) {
  return Object.fromEntries(Object.entries(project.assets).map(([hash, record]) => [hash, { sha256: record.sha256, mimeType: record.mimeType, sizeBytes: record.sizeBytes, pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight }]))
}
function fixedHash(project: ProjectData): string {
  const base = { definitions: Object.fromEntries(fixedCollections.map(key => [key, project.document[key]])),
    appearance: Object.fromEntries(appearanceCollections.map(key => [key, project.appearance[key]])), assets: resourceMetadata(project),
    licenseHashes: sorted(Object.keys(project.licenses)), licenseBindings: project.licenseBindings }
  return sha256Text(canonicalJson(Object.keys(project.authoringSources).length
    ? { domain: 'sceneweave-svg-fixed', version: 1, base, authoringSources: project.authoringSources } : base))
}
function checkCombinedResourceBudgets(project: ProjectData): void {
  const assets = Object.values(project.assets), licenses = Object.values(project.licenses), sources = projectSourceRecords(project)
  if (assets.length > PROJECT_DATA_LIMITS.images || assets.reduce((sum, record) => sum + record.pixelWidth * record.pixelHeight, 0) > PROJECT_DATA_LIMITS.totalImagePixels
    || [...sources.values()].reduce((a, b) => a + b, 0) + assets.reduce((sum, record) => sum + record.sizeBytes, 0) + licenses.reduce((sum, record) => sum + encodeUtf8(record.text).length, 0) > PROJECT_DATA_LIMITS.expandedBytes) throw new Error('采用后的联合资源数量、像素或展开字节超过原生工程预算。')
}
function prefabBounds(members: readonly { propTemplate: PropTemplate }[]): { width: number; height: number } {
  const points = members.flatMap(({ propTemplate: prop }) => {
    const bounds = prop.visualBoundsMm, angle = prop.rotationDeg * Math.PI / 180
    return [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]].map(([x, y]) => ({ x: prop.positionMm.x + x * Math.cos(angle) - y * Math.sin(angle), y: prop.positionMm.y + x * Math.sin(angle) + y * Math.cos(angle) }))
  })
  return points.length ? { width: Math.ceil(Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x))), height: Math.ceil(Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))) } : { width: 0, height: 0 }
}
function describeItem(project: ProjectData, selector: CatalogSelector): CatalogItem {
  const capsule = extractClosure(project, selector), definition = definitionFor(capsule, selector), namespace = sha256Text(canonicalJson(definition.origin)), contentHash = fixedHash(capsule)
  const algorithm = Object.keys(capsule.authoringSources).length ? 2 : 1
  const logicalKey = JSON.stringify([algorithm, namespace, selector.kind, definition.catalogId, definition.version]), key = JSON.stringify([algorithm, namespace, selector.kind, definition.catalogId, definition.version, contentHash])
  const dimension = selector.kind === 'prop' ? own(capsule.document.propDefinitions, selector.definitionId).defaultVisualBoundsMm : selector.kind === 'material' ? own(capsule.document.materials, selector.definitionId).defaultTileSizeMm : prefabBounds(own(capsule.document.prefabDefinitions, selector.definitionId).members)
  const thumbnailAssetIds = selector.kind === 'prop' ? (() => { const image = capsule.document.propDefinitions[selector.definitionId].defaultAppearance; return image.kind === 'image' ? [image.assetId] : [] })()
    : selector.kind === 'material' ? [capsule.document.materials[selector.definitionId].textureAssetId]
      : [...new Set(Object.values(capsule.appearance.prefabAppearanceTemplates[selector.definitionId].members).flatMap(member => { const record = capsule.appearance.sources[member.sourceId]; return record.kind === 'prop' && record.snapshot.appearance.kind === 'image' ? [record.snapshot.appearance.assetId] : [] }))]
  return { identity: { namespace, kind: selector.kind, catalogId: definition.catalogId, fixedVersion: definition.version, contentHash, logicalKey, key }, selector: { ...selector },
    name: definition.name, publisherTags: definition.tags.filter(tag => !tag.startsWith('sceneweave:')), widthMm: dimension.width, heightMm: dimension.height,
    originLabel: `${{ original: '原创', imported: '导入', generated: '生成' }[definition.origin.kind]} · ${definition.origin.attribution}`,
    licenseRefs: [...new Set(capsule.licenseBindings.map(value => value.licenseRef))].sort(), thumbnailAssetIds,
    visibility: selector.kind === 'prefab' ? capsule.appearance.prefabAppearanceTemplates[selector.definitionId].visibility : 'public' }
}

/** Synchronous display metadata is an index only; preparation and every external read validate actual complete bytes. */
export function listCatalogItems(bundle: ProjectBundle): CatalogItem[] {
  const project = captureProjectBundleInput(bundle).project
  const selectors: CatalogSelector[] = [
    ...Object.values(project.document.propDefinitions).filter(value => !value.tags.some(tag => tag.startsWith('sceneweave:'))).map(value => ({ kind: 'prop' as const, definitionId: value.id })),
    ...Object.values(project.document.materials).filter(value => !value.tags.some(tag => tag.startsWith('sceneweave:'))).map(value => ({ kind: 'material' as const, definitionId: value.id })),
    ...Object.values(project.document.prefabDefinitions).filter(value => !value.tags.some(tag => tag.startsWith('sceneweave:'))).map(value => ({ kind: 'prefab' as const, definitionId: value.id })),
  ]
  return selectors.map(selector => describeItem(project, selector))
}

/** Captures metadata and native bytes before any asynchronous validation. */
export function captureLibraryEntry(input: PreparedLibraryEntry): PreparedLibraryEntry {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('素材条目必须是普通数据对象。')
  const fields = Object.getOwnPropertyDescriptors(input), keys = ['item', 'capsule', 'capsuleSha256']
  if (Reflect.ownKeys(input).length !== keys.length || !keys.every(key => fields[key]?.enumerable && 'value' in fields[key])) throw new Error('素材条目含未知、访问器、隐藏或Symbol字段。')
  const item = validateCatalogItem(fields.item.value), capsule = captureBytes(fields.capsule.value!, LIBRARY_LIMITS.capsuleBytes)
  const capsuleSha256 = sha.parse(fields.capsuleSha256.value)
  if (sha256Bytes(capsule) !== capsuleSha256) throw new Error('素材完整载体摘要不符。')
  return { item, capsule, capsuleSha256 }
}

export function captureLibraryEntries(input: PreparedLibraryEntry[], maximum: number = LIBRARY_LIMITS.batch, maximumBytes: number = LIBRARY_LIMITS.storedCapsuleBytes): PreparedLibraryEntry[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum) throw new Error('素材数组超过单批保护限额。')
  if (Reflect.ownKeys(input).length !== input.length + 1) throw new Error('素材数组不能含空洞或额外字段。')
  const values = Array.from({ length: input.length }, (_, index) => {
    const field = Object.getOwnPropertyDescriptor(input, String(index))
    if (!field?.enumerable || !('value' in field)) throw new Error('素材数组不能含访问器或空洞。')
    return field.value as PreparedLibraryEntry
  })
  let total = 0
  // Bound the whole byte closure before copying even the first capsule.
  const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object
  const byteLength = Object.getOwnPropertyDescriptor(typedPrototype, 'byteLength')!.get!
  for (const value of values) {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('素材条目必须是普通数据对象。')
    const field = Object.getOwnPropertyDescriptor(value, 'capsule')
    if (!field?.enumerable || !('value' in field) || !(field.value instanceof Uint8Array) || Object.getPrototypeOf(field.value) !== Uint8Array.prototype) throw new Error('素材载体必须是原生字节且不能含访问器。')
    const size = byteLength.call(field.value) as number
    if (size > LIBRARY_LIMITS.capsuleBytes || (total += size) > maximumBytes) throw new Error('素材完整载体联合字节超过保护预算。')
  }
  return values.map(captureLibraryEntry)
}

async function checkedCapsule(entry: PreparedLibraryEntry, validation: CompleteValidationOptions): Promise<ProjectBundle> {
  checkCancelled(validation?.signal)
  const bundle = await importProject(entry.capsule, validation), project = bundle.project
  const closure = extractClosure(project, entry.item.selector)
  if (canonicalJson(project) !== canonicalJson(closure)) throw new Error('素材载体含场景信息或超出所选固定闭包。')
  if (canonicalJson(entry.item) !== canonicalJson(describeItem(project, entry.item.selector))) throw new Error('素材身份、摘要或元数据与完整内容不一致。')
  checkCancelled(validation?.signal)
  return bundle
}

export async function prepareLibraryEntry(input: ProjectBundle, selectorInput: CatalogSelector, validation: CompleteValidationOptions): Promise<PreparedLibraryEntry> {
  const bundle = captureProjectBundleInput(input), selector = selectorSchema.parse(captureJson(selectorInput))
  checkCancelled(validation?.signal)
  const verified = await validateProjectBundle(bundle, validation), project = extractClosure(verified.project, selector)
  const item = describeItem(project, selector), capsule = await exportProject({ project, resources: verified.resources }, validation)
  if (capsule.length > LIBRARY_LIMITS.capsuleBytes) throw new Error('素材完整载体超过32MiB。')
  checkCancelled(validation?.signal)
  return { item, capsule, capsuleSha256: sha256Bytes(capsule) }
}

/** Every external installation/read checks bytes, native ZIP, exact neutral metadata and root closure. */
export async function validateLibraryEntry(input: PreparedLibraryEntry, validation: CompleteValidationOptions): Promise<PreparedLibraryEntry> {
  const entry = captureLibraryEntry(input)
  await checkedCapsule(entry, validation)
  return entry
}

export async function loadLibraryCapsule(input: PreparedLibraryEntry, validation: CompleteValidationOptions): Promise<ProjectBundle> {
  return checkedCapsule(captureLibraryEntry(input), validation)
}

/** Append-only candidate; the editor still owns preview, revision, undo and persistence CAS. */
export async function adoptLibraryEntries(input: ProjectBundle, entriesInput: PreparedLibraryEntry[], validation: CompleteValidationOptions): Promise<{ bundle: ProjectBundle; addedDefinitionIds: string[]; operationCost: number }> {
  const currentInput = captureProjectBundleInput(input), entries = captureLibraryEntries(entriesInput)
  if (!entries.length || new Set(entries.map(entry => entry.item.identity.key)).size !== entries.length) throw new Error('请选择1–64个不同素材进行采用。')
  checkCancelled(validation?.signal)
  const current = await validateProjectBundle(currentInput, validation), project = cloneJson(current.project)
  const bytes = new Map<string, Uint8Array>()
  for (const hash of projectResourceHashes(current.project)) bytes.set(hash, await current.resources.read(hash))
  let operationCost = 0
  const addedDefinitionIds: string[] = [], logical = new Map<string, string>()
  const copyFixed = (target: Record<string, unknown>, incoming: Record<string, unknown>, definitions = false) => {
    for (const [id, value] of Object.entries(incoming)) if (!Object.hasOwn(target, id)) {
      target[id] = cloneJson(value); operationCost++; if (definitions) addedDefinitionIds.push(id)
    }
  }
  for (const entry of entries) {
    const incomingBundle = await checkedCapsule(entry, validation), incoming = incomingBundle.project, identity = entry.item.identity
    if (logical.has(identity.logicalKey) && logical.get(identity.logicalKey) !== identity.contentHash) throw new Error('相同逻辑素材身份对应不同固定内容。')
    logical.set(identity.logicalKey, identity.contentHash)
    const existingDefinitions = identity.kind === 'prop' ? project.document.propDefinitions : identity.kind === 'material' ? project.document.materials : project.document.prefabDefinitions
    for (const definition of Object.values(existingDefinitions)) if (definition.catalogId === identity.catalogId && definition.version === identity.fixedVersion
      && sha256Text(canonicalJson(definition.origin)) === identity.namespace
      && describeItem(project, { kind: identity.kind, definitionId: definition.id }).identity.contentHash !== identity.contentHash) throw new Error('相同逻辑素材身份对应不同固定内容。')
    assertFixedProjectCompatible(project, incoming)
    for (const key of fixedCollections) copyFixed(project.document[key], incoming.document[key], key !== 'assets')
    for (const key of appearanceCollections) copyFixed(project.appearance[key], incoming.appearance[key])
    for (const [hash, record] of Object.entries(incoming.assets)) {
      if (Object.hasOwn(project.assets, hash)) {
        if (canonicalJson(project.assets[hash]) !== canonicalJson(record)) throw new Error('相同资源摘要对应不同元数据。')
      } else { project.assets[hash] = cloneJson(record); bytes.set(hash, await incomingBundle.resources.read(hash)); operationCost++ }
    }
    for (const [id, source] of Object.entries(incoming.authoringSources)) {
      if (Object.hasOwn(project.authoringSources, id) && canonicalJson(project.authoringSources[id]) !== canonicalJson(source)) throw new Error('固定SVG来源记录冲突。')
      if (!Object.hasOwn(project.authoringSources, id)) { project.authoringSources[id] = cloneJson(source); operationCost++ }
    }
    for (const hash of projectSourceRecords(incoming).keys()) if (!bytes.has(hash)) bytes.set(hash, await incomingBundle.resources.read(hash))
    for (const [hash, record] of Object.entries(incoming.licenses)) {
      if (Object.hasOwn(project.licenses, hash)) {
        if (canonicalJson(project.licenses[hash]) !== canonicalJson(record)) throw new Error('相同许可摘要对应不同正文。')
      } else { project.licenses[hash] = cloneJson(record); operationCost++ }
    }
    for (const binding of incoming.licenseBindings) {
      const existing = project.licenseBindings.find(value => binding.subjectKind === value.subjectKind && binding.subjectId === value.subjectId)
      if (existing) { if (canonicalJson(existing) !== canonicalJson(binding)) throw new Error('固定素材许可绑定冲突。') }
      else { project.licenseBindings.push(cloneJson(binding)); operationCost++ }
    }
    checkCombinedResourceBudgets(project)
    if (operationCost > LIBRARY_LIMITS.adoptionOperations) throw new Error(`素材采用实际展开为${operationCost}项，超过256预算。`)
  }
  const bundle = await validateProjectBundle({ project, resources: createMemoryResources(bytes) }, validation)
  checkCancelled(validation?.signal)
  return { bundle, operationCost, addedDefinitionIds }
}
