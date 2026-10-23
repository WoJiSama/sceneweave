import { z } from 'zod'
import { sha256TextV2 } from '../core/v2/scatter'
import type { Appearance, DefinitionIdentity, PropTemplate, SceneDocumentV3 } from '../core/v3/types'
import { bitmapVariantV6 } from '../core/v6/graph'
import { captureOwnedData } from '../io/v3/owned-data'
import { checkCancelled, PROJECT_LIMITS_V6 } from '../io/v6/limits'
import { assertFixedCompositionCompatibleV6, canonicalJsonV6, captureCompleteProjectV6, exportProjectV6, importProjectV6, validateCompleteProjectV6 } from '../io/v6/project-file'
import { sha256Bytes } from '../io/v6/resources'
import type { CompleteProjectV6 } from '../io/v6/types'
import { validateCatalogItemV1 } from './metadata'
import { CATALOG_LIMITS_V1, type CatalogAdoptionV1, type CatalogItemV1, type CatalogSelectorV1, type PreparedCatalogEntryV1 } from './types'

const fixedCollections = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
const appearanceCollections = ['sources', 'variants', 'prefabAppearanceTemplates'] as const
const selectorSchema = z.object({ kind: z.enum(['prop', 'material', 'prefab']), definitionId: z.string().min(1).max(256).refine(value => value !== '__proto__') }).strict()
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const own = <T>(record: Record<string, T>, id: string): T => { if (!Object.hasOwn(record, id)) throw new Error(`素材闭包缺少固定内容：${id}。`); return record[id] }
const sorted = (values: Iterable<string>) => [...values].sort()
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const stamp = '1970-01-01T00:00:00.000Z', sceneId = 'sceneweave-catalog-capsule-v1', floorId = 'sceneweave-catalog-floor-v1', layerId = 'sceneweave-catalog-layer-v1'

/** All incidental map metadata is a constant, so a capsule cannot smuggle a project or its identity into a library. */
function neutralProject(): CompleteProjectV6 {
  const bounds = { x: 0, y: 0, width: 1000, height: 1000 }
  const document: SceneDocumentV3 = {
    format: 'sceneweave', schemaVersion: 3, sceneId, revision: 0, title: '素材目录载体', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '目录', boundsMm: { ...bounds } } },
    userLayers: { [layerId]: { id: layerId, floorId, name: '目录', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {},
    terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'catalog-v1', presetVersion: 1, distanceMode: 'metric', source: 'Sceneweave 素材目录', gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] },
  }
  return { document, historyIdentity: { version: 3, lineageId: 'sceneweave-catalog-lineage-v1', rootSceneId: sceneId, propTokens: {}, prefabTokens: {}, outdoorTokens: {} },
    appearance: { version: 1, sources: {}, propSources: {}, surfaceSources: {}, instanceAdjustments: {}, layerAdjustments: {}, variants: {}, prefabAppearanceTemplates: {} }, assets: {}, licenses: {}, licenseBindings: [] }
}

function definitionFor(project: CompleteProjectV6, selector: CatalogSelectorV1): DefinitionIdentity & { name: string; tags: string[] } {
  if (selector.kind === 'prop') return own(project.document.propDefinitions, selector.definitionId)
  if (selector.kind === 'material') return own(project.document.materials, selector.definitionId)
  return own(project.document.prefabDefinitions, selector.definitionId)
}
function fixedAssetRoots(document: SceneDocumentV3): Set<string> {
  return new Set([
    ...Object.values(document.propDefinitions).flatMap(value => value.defaultAppearance.kind === 'image' ? [value.defaultAppearance.assetId] : []),
    ...Object.values(document.materials).map(value => value.textureAssetId),
    ...Object.values(document.prefabDefinitions).flatMap(value => value.members.flatMap(member => member.propTemplate.appearance.kind === 'image' ? [member.propTemplate.appearance.assetId] : [])),
  ])
}

/** Only fixed roots participate. Live instance/layer mappings are deliberately never traversed. */
function extractClosure(source: CompleteProjectV6, selectorInput: CatalogSelectorV1): CompleteProjectV6 {
  const selector = selectorSchema.parse(selectorInput), result = neutralProject(), document = result.document, graph = result.appearance
  const addAsset = (id: string): void => {
    if (Object.hasOwn(document.assets, id)) return
    document.assets[id] = structuredClone(own(source.document.assets, id))
    for (const variant of Object.values(source.appearance.variants)) if (variant.outputAssetId === id) {
      graph.variants[variant.id] = structuredClone(variant); addAsset(variant.sourceAssetId)
    }
  }
  const addAppearance = (appearance: Appearance) => { if (appearance.kind === 'image') addAsset(appearance.assetId) }
  const addProp = (id: string): void => {
    if (Object.hasOwn(document.propDefinitions, id)) return
    const definition = own(source.document.propDefinitions, id)
    document.propDefinitions[id] = structuredClone(definition); addAppearance(definition.defaultAppearance)
  }
  const addMaterial = (id: string): void => {
    if (Object.hasOwn(document.materials, id)) return
    const definition = own(source.document.materials, id)
    document.materials[id] = structuredClone(definition); addAsset(definition.textureAssetId)
  }
  const addSource = (id: string): void => {
    if (Object.hasOwn(graph.sources, id)) return
    const record = own(source.appearance.sources, id)
    graph.sources[id] = structuredClone(record)
    if (record.parentSourceId !== null) addSource(record.parentSourceId)
    if (record.kind === 'prop') {
      if (record.snapshot.definitionRef) addProp(record.snapshot.definitionRef.id)
      addAppearance(record.snapshot.appearance)
    } else for (const paint of [record.snapshot.base, ...record.snapshot.overlays.map(value => value.paint)]) addMaterial(paint.materialRef.id)
  }
  const addPrefab = (id: string): void => {
    if (Object.hasOwn(document.prefabDefinitions, id)) return
    const definition = own(source.document.prefabDefinitions, id), template = own(source.appearance.prefabAppearanceTemplates, id)
    document.prefabDefinitions[id] = structuredClone(definition)
    graph.prefabAppearanceTemplates[id] = structuredClone(template)
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
        const variant = bitmapVariantV6(appearance.assetId, tint?.kind === 'tint' ? tint.value : appearance.tint, brightness?.kind === 'brightness' ? brightness.value : 1)
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
    const binding = structuredClone(bindings[0]), match = /^licenses\/([a-f0-9]{64})\.txt$/.exec(binding.licensePath)
    if (!match) throw new Error('素材许可路径无效。')
    result.licenseBindings.push(binding); result.licenses[match[1]] = structuredClone(own(source.licenses, match[1]))
  }
  result.licenseBindings.sort((a, b) => compare(canonicalJsonV6(a), canonicalJsonV6(b)))
  for (const asset of Object.values(document.assets)) result.assets[asset.sha256] = own(source.assets, asset.sha256)
  return result
}

function resourceMetadata(project: CompleteProjectV6) {
  return Object.fromEntries(Object.entries(project.assets).map(([hash, record]) => [hash, { sha256: record.sha256, mimeType: record.mimeType, sizeBytes: record.sizeBytes, pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight }]))
}
function fixedHash(project: CompleteProjectV6): string {
  return sha256TextV2(canonicalJsonV6({ definitions: Object.fromEntries(fixedCollections.map(key => [key, project.document[key]])),
    appearance: Object.fromEntries(appearanceCollections.map(key => [key, project.appearance[key]])), assets: resourceMetadata(project),
    licenseHashes: sorted(Object.keys(project.licenses)), licenseBindings: project.licenseBindings }))
}
function checkCombinedResourceBudgets(project: CompleteProjectV6): void {
  const assets = Object.values(project.assets), licenses = Object.values(project.licenses)
  if (assets.length > PROJECT_LIMITS_V6.uniqueImages || assets.reduce((sum, record) => sum + record.pixelWidth * record.pixelHeight, 0) > PROJECT_LIMITS_V6.totalImagePixels
    || assets.reduce((sum, record) => sum + record.sizeBytes, 0) + licenses.reduce((sum, record) => sum + new TextEncoder().encode(record.text).length, 0) > PROJECT_LIMITS_V6.expandedBytes) throw new Error('采用后的联合资源数量、像素或展开字节超过原生工程预算。')
}
function prefabBounds(members: readonly { propTemplate: PropTemplate }[]): { width: number; height: number } {
  const points = members.flatMap(({ propTemplate: prop }) => {
    const bounds = prop.visualBoundsMm, angle = prop.rotationDeg * Math.PI / 180
    return [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]].map(([x, y]) => ({ x: prop.positionMm.x + x * Math.cos(angle) - y * Math.sin(angle), y: prop.positionMm.y + x * Math.sin(angle) + y * Math.cos(angle) }))
  })
  return points.length ? { width: Math.ceil(Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x))), height: Math.ceil(Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))) } : { width: 0, height: 0 }
}
function describeItem(project: CompleteProjectV6, selector: CatalogSelectorV1): CatalogItemV1 {
  const capsule = extractClosure(project, selector), definition = definitionFor(capsule, selector), namespace = sha256TextV2(canonicalJsonV6(definition.origin)), contentHash = fixedHash(capsule)
  const logicalKey = JSON.stringify([1, namespace, selector.kind, definition.catalogId, definition.version]), key = JSON.stringify([1, namespace, selector.kind, definition.catalogId, definition.version, contentHash])
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
export function describeCatalogItems(project: CompleteProjectV6): CatalogItemV1[] {
  const selectors: CatalogSelectorV1[] = [
    ...Object.values(project.document.propDefinitions).filter(value => !value.tags.some(tag => tag.startsWith('sceneweave:'))).map(value => ({ kind: 'prop' as const, definitionId: value.id })),
    ...Object.values(project.document.materials).filter(value => !value.tags.some(tag => tag.startsWith('sceneweave:'))).map(value => ({ kind: 'material' as const, definitionId: value.id })),
    ...Object.values(project.document.prefabDefinitions).filter(value => !value.tags.some(tag => tag.startsWith('sceneweave:'))).map(value => ({ kind: 'prefab' as const, definitionId: value.id })),
  ]
  return selectors.map(selector => describeItem(project, selector))
}

export async function prepareCatalogEntry(projectInput: CompleteProjectV6, selectorInput: CatalogSelectorV1, signal?: AbortSignal): Promise<PreparedCatalogEntryV1> {
  const project = captureCompleteProjectV6(projectInput), selector = selectorSchema.parse(captureOwnedData(selectorInput))
  checkCancelled(signal)
  await validateCompleteProjectV6(project, { signal })
  const capsuleProject = extractClosure(project, selector), item = describeItem(capsuleProject, selector)
  const capsule = await exportProjectV6(capsuleProject, { signal })
  if (capsule.size > CATALOG_LIMITS_V1.capsuleBytes) throw new Error('素材完整载体超过32 MiB。')
  const capsuleSha256 = await sha256Bytes(new Uint8Array(await capsule.arrayBuffer()))
  checkCancelled(signal)
  return { item, capsule, capsuleSha256 }
}

export async function readCatalogEntry(entryInput: PreparedCatalogEntryV1, signal?: AbortSignal): Promise<CompleteProjectV6> {
  const entry = captureOwnedData(entryInput)
  if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join(',') !== 'capsule,capsuleSha256,item') throw new Error('素材条目字段缺失或未知。')
  const item = validateCatalogItemV1(entry.item)
  if (!(entry.capsule instanceof Blob) || entry.capsule.size > CATALOG_LIMITS_V1.capsuleBytes || !sha.safeParse(entry.capsuleSha256).success) throw new Error('素材完整载体或摘要无效。')
  checkCancelled(signal)
  if (await sha256Bytes(new Uint8Array(await entry.capsule.arrayBuffer())) !== entry.capsuleSha256) throw new Error('素材完整载体摘要不符。')
  const project = await importProjectV6(entry.capsule, { signal }), closure = extractClosure(project, item.selector)
  if (canonicalJsonV6({ document: project.document, appearance: project.appearance, historyIdentity: project.historyIdentity, assets: resourceMetadata(project), licenses: project.licenses, licenseBindings: project.licenseBindings }) !== canonicalJsonV6({ document: closure.document, appearance: closure.appearance, historyIdentity: closure.historyIdentity, assets: resourceMetadata(closure), licenses: closure.licenses, licenseBindings: closure.licenseBindings })) throw new Error('素材载体包含场景信息或超出所选固定闭包。')
  if (canonicalJsonV6(item) !== canonicalJsonV6(describeItem(project, item.selector))) throw new Error('素材摘要、固定身份或元数据与完整内容不一致。')
  checkCancelled(signal)
  return project
}

/** Produces only an append-only candidate. The workspace owns preview, adoption, undo, revision and persistence CAS. */
export async function prepareCatalogAdoption(currentInput: CompleteProjectV6, entriesInput: PreparedCatalogEntryV1[], signal?: AbortSignal): Promise<CatalogAdoptionV1> {
  const current = captureCompleteProjectV6(currentInput), entries = captureOwnedData(entriesInput)
  if (!Array.isArray(entries) || !entries.length || entries.length > CATALOG_LIMITS_V1.batch) throw new Error('请选择1–64个素材进行采用。')
  if (new Set(entries.map(entry => entry.item?.identity?.key)).size !== entries.length) throw new Error('采用条目不能重复。')
  checkCancelled(signal)
  await validateCompleteProjectV6(current, { signal })
  const project = { ...current, document: structuredClone(current.document), historyIdentity: structuredClone(current.historyIdentity), appearance: structuredClone(current.appearance), assets: { ...current.assets }, licenses: { ...current.licenses }, licenseBindings: structuredClone(current.licenseBindings) }
  let operationCost = 0
  const addedDefinitionIds: string[] = [], logical = new Map<string, string>()
  const copyFixed = (target: Record<string, unknown>, incoming: Record<string, unknown>, definitions = false) => {
    for (const [id, value] of Object.entries(incoming)) if (!Object.hasOwn(target, id)) { target[id] = structuredClone(value); operationCost++; if (definitions) addedDefinitionIds.push(id) }
  }
  for (const entry of entries) {
    const incoming = await readCatalogEntry(entry, signal), identity = entry.item.identity
    if (logical.has(identity.logicalKey) && logical.get(identity.logicalKey) !== identity.contentHash) throw new Error('相同逻辑素材身份对应不同固定内容。')
    logical.set(identity.logicalKey, identity.contentHash)
    const existingDefinitions = identity.kind === 'prop' ? project.document.propDefinitions : identity.kind === 'material' ? project.document.materials : project.document.prefabDefinitions
    for (const definition of Object.values(existingDefinitions)) if (definition.catalogId === identity.catalogId && definition.version === identity.fixedVersion
      && sha256TextV2(canonicalJsonV6(definition.origin)) === identity.namespace) {
      if (describeItem(project, { kind: identity.kind, definitionId: definition.id }).identity.contentHash !== identity.contentHash) throw new Error('相同逻辑素材身份对应不同固定内容。')
    }
    assertFixedCompositionCompatibleV6(project, incoming)
    for (const key of fixedCollections) copyFixed(project.document[key], incoming.document[key], key !== 'assets')
    for (const key of appearanceCollections) copyFixed(project.appearance[key], incoming.appearance[key])
    for (const [hash, record] of Object.entries(incoming.assets)) {
      if (Object.hasOwn(project.assets, hash)) { if (canonicalJsonV6(resourceMetadata(project)[hash]) !== canonicalJsonV6(resourceMetadata(incoming)[hash])) throw new Error('相同资源摘要对应不同元数据。') }
      else { project.assets[hash] = record; operationCost++ }
    }
    for (const [hash, record] of Object.entries(incoming.licenses)) {
      if (Object.hasOwn(project.licenses, hash)) { if (canonicalJsonV6(project.licenses[hash]) !== canonicalJsonV6(record)) throw new Error('相同许可摘要对应不同正文。') }
      else { project.licenses[hash] = structuredClone(record); operationCost++ }
    }
    for (const binding of incoming.licenseBindings) {
      const existing = project.licenseBindings.find(value => binding.subjectKind === value.subjectKind && binding.subjectId === value.subjectId)
      if (existing) { if (canonicalJsonV6(existing) !== canonicalJsonV6(binding)) throw new Error('固定素材许可绑定冲突。') }
      else { project.licenseBindings.push(structuredClone(binding)); operationCost++ }
    }
    checkCombinedResourceBudgets(project)
    if (operationCost > CATALOG_LIMITS_V1.adoptionOperations) throw new Error(`素材采用实际展开为${operationCost}项，超过256预算。`)
  }
  await validateCompleteProjectV6(project, { signal })
  checkCancelled(signal)
  return { project, operationCost, addedDefinitionIds }
}
