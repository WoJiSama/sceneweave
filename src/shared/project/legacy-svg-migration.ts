import { CANONICAL_SVG_PROCESSOR, LEGACY_SVG_PROCESSOR, normalizeStaticSvg } from '../ai/svg.js'
import { addPropAppearanceSource, addSurfaceAppearanceSource, bitmapVariant, resolveAppearance } from '../appearance/graph.js'
import { inspectDependencies } from '../commands/dependencies.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { createHistoryIdentity } from '../history/identity.js'
import type { AppearanceGraph, PropAppearanceSnapshot } from '../model/appearance.js'
import type { LicenseSubjectKind, ProjectBundle } from '../model/project.js'
import type { Appearance, MaterialPaint, SceneDocument, SurfaceStyle, VersionRef } from '../model/scene.js'
import { checkCancelled, type CompleteValidationOptions, type SvgProcessingPort } from '../ports/resources.js'
import type { PreparationContext } from '../ports/runtime.js'
import { canonicalJson, captureJson, cloneJson, freezeJson } from '../validation/json.js'
import { captureBytes, decodeUtf8, sha256Bytes } from './binary.js'
import { createBitmapPixelPipelineLookup } from './bitmap-pixels.js'
import { exportProject, importHistoryArchive, importProject } from './file.js'
import { PACKAGE_LIMITS } from './limits.js'
import { encodeCanonicalPng } from './png-rgba.js'
import { createMemoryResources, deriveBitmapVariant } from './resources.js'

type FixedKind = Exclude<LicenseSubjectKind, 'regionalSymbolDefinition'>
export interface LegacySvgMigrationMappings {
  scene: { from: string; to: string }
  lineage: { from: string; to: string }
  fixed: Record<FixedKind, Record<string, string>>
  appearanceSources: Record<string, string>
  variants: Record<string, string>
  svgSources: { fromAssetId: string; toAssetId: string; sourceSha256: string; normalizedSha256: string; fromRasterSha256: string; toRasterSha256: string }[]
}
export interface LegacySvgMigrationCandidate {
  /** Independent original archive; all old snapshots and fixed identities stay here. */
  originalArchiveBytes: Uint8Array
  originalArchiveSha256: string
  originalPackageMode: 'complete' | 'history'
  preservedSnapshotIds: string[]
  /** A new project and lineage. Nothing has been saved or published. */
  bundle: ProjectBundle
  archiveBytes: Uint8Array
  archiveSha256: string
  mappings: LegacySvgMigrationMappings
}
export class UnsupportedLegacySvgMigrationError extends Error {
  readonly code = 'legacy-svg-migration-unsupported'
  constructor(readonly paths: readonly string[]) { super(`旧SVG迁入暂不支持以下完整身份转换：${paths.join('、')}。原始归档保持不变。`) }
}

function captureSvg(port: SvgProcessingPort | undefined, expected: typeof CANONICAL_SVG_PROCESSOR | typeof LEGACY_SVG_PROCESSOR): SvgProcessingPort {
  const profile = port && Object.getOwnPropertyDescriptor(port, 'processor'), rasterize = port && Object.getOwnPropertyDescriptor(port, 'rasterize')
  if (!profile || !('value' in profile) || canonicalJson(captureJson(profile.value)) !== canonicalJson(expected)
    || !rasterize || !('value' in rasterize) || typeof rasterize.value !== 'function') throw new Error('旧SVG迁入必须显式提供固定的旧版与canonical SVG能力。')
  return { processor: expected, rasterize: rasterize.value.bind(port) }
}
function captureOptions(options: CompleteValidationOptions): CompleteValidationOptions & { svg: SvgProcessingPort; legacySvg: SvgProcessingPort } {
  const fields = Object.getOwnPropertyDescriptors(options.images)
  for (const name of ['decode', 'transform', 'encodePng']) if (!fields[name] || !('value' in fields[name]) || typeof fields[name].value !== 'function') throw new Error('旧SVG迁入缺少真实图片能力。')
  return { signal: options.signal, svg: captureSvg(options.svg, CANONICAL_SVG_PROCESSOR), legacySvg: captureSvg(options.legacySvg, LEGACY_SVG_PROCESSOR), images: {
    decode: fields.decode.value!.bind(options.images), transform: fields.transform.value!.bind(options.images), encodePng: fields.encodePng.value!.bind(options.images),
  } }
}
function assertSupported(document: SceneDocument): void {
  const paths: string[] = []
  if (document.regional !== null || document.mapMode !== 'scene') paths.push('regional')
  if (document.aggregateCoordinates) paths.push('aggregateCoordinates')
  for (const [key, value] of Object.entries(document.generation)) if (key !== 'version' && key !== 'legacy' && Object.keys(value).length) paths.push(`generation.${key}`)
  for (const [key, value] of Object.entries(document.generation.legacy)) if (key !== 'version' && Object.keys(value).length) paths.push(`generation.legacy.${key}`)
  if (paths.length) throw new UnsupportedLegacySvgMigrationError(paths)
}

/**
 * Explicit recovery boundary, never an ordinary importer or an in-place repair.
 * Fully validates the original in its matching legacy environment, then makes a
 * fresh fixed catalogue and lineage. Old history is preserved only in the exact
 * original archive. The returned target has passed canonical-only cold import.
 */
export async function prepareLegacySvgMigrationCandidate(
  input: Uint8Array,
  packageMode: 'complete' | 'history',
  options: CompleteValidationOptions,
  context: PreparationContext,
): Promise<LegacySvgMigrationCandidate> {
  const originalArchiveBytes = captureBytes(input, PACKAGE_LIMITS.compressedBytes), checked = captureOptions(options)
  if (packageMode !== 'complete' && packageMode !== 'history') throw new Error('旧SVG迁入必须明确原始归档类型。')
  const allocate = context.ids.nextId.bind(context.ids), now = context.clock.now()
  checkCancelled(checked.signal)
  const originalArchiveSha256 = sha256Bytes(originalArchiveBytes)
  const archive = packageMode === 'history' ? await importHistoryArchive(originalArchiveBytes, checked)
    : { current: await importProject(originalArchiveBytes, checked), snapshots: [] }
  const original = archive.current, previous = original.project
  assertSupported(previous.document)
  if (!Object.values(previous.authoringSources).some(source => source.processorVersion === 1)) throw new UnsupportedLegacySvgMigrationError(['current.authoringSources: no processor 1 source'])
  const occupied = geometryIdentityIds(previous.document)
  occupied.add(previous.document.sceneId); occupied.add(previous.historyIdentity.lineageId); occupied.add(previous.historyIdentity.rootSceneId)
  for (const key of Object.keys(previous.document.userLayers)) occupied.add(key)
  for (const key of [...Object.keys(previous.appearance.sources), ...Object.keys(previous.appearance.variants)]) occupied.add(key)
  for (const records of Object.values(previous.historyIdentity)) if (records && typeof records === 'object') for (const token of Object.values(records)) {
    if (typeof token === 'string') occupied.add(token)
    else if (token && typeof token === 'object') for (const [field, value] of Object.entries(token)) if ((field === 'token' || field === 'topologyToken') && typeof value === 'string') occupied.add(value)
  }
  const fresh = () => {
    const id = allocate()
    if (typeof id !== 'string' || !id.length || id.length > 256 || id === '__proto__' || occupied.has(id)) throw new Error('旧SVG迁入的新身份无效或与保留身份重复。')
    occupied.add(id); return id
  }
  const project = cloneJson(previous), scene = project.document, oldGraph = previous.appearance
  const mappings: LegacySvgMigrationMappings = { scene: { from: scene.sceneId, to: fresh() }, lineage: { from: previous.historyIdentity.lineageId, to: '' },
    fixed: { asset: {}, material: {}, propDefinition: {}, prefabDefinition: {}, styleTheme: {} }, appearanceSources: {}, variants: {}, svgSources: [] }
  scene.sceneId = mappings.scene.to; scene.revision = 0; scene.createdAt = now; scene.updatedAt = now
  const assetMap = mappings.fixed.asset, outputVariants = new Map(Object.values(oldGraph.variants).map(variant => [variant.outputAssetId, variant]))
  for (const id of Object.keys(scene.assets)) if (!outputVariants.has(id)) assetMap[id] = fresh()
  const remapAsset = (id: string, visiting = new Set<string>()): string => {
    if (Object.hasOwn(assetMap, id)) return assetMap[id]
    const variant = outputVariants.get(id)
    if (!variant || visiting.has(id)) throw new Error('旧SVG迁入的派生资源源链无效。')
    visiting.add(id)
    const next = bitmapVariant(remapAsset(variant.sourceAssetId, visiting), variant.tint, variant.brightness)!
    if (occupied.has(next.id) || occupied.has(next.outputAssetId)) throw new Error('旧SVG迁入的固定派生身份发生冲突。')
    occupied.add(next.id); occupied.add(next.outputAssetId)
    mappings.variants[variant.id] = next.id; assetMap[id] = next.outputAssetId
    return next.outputAssetId
  }
  for (const id of Object.keys(scene.assets)) remapAsset(id)
  const collections = { asset: scene.assets, material: scene.materials, propDefinition: scene.propDefinitions, prefabDefinition: scene.prefabDefinitions, styleTheme: scene.styleThemes }
  for (const kind of Object.keys(collections) as FixedKind[]) for (const [id, value] of Object.entries(collections[kind])) {
    const next = kind === 'asset' ? assetMap[id] : fresh()
    mappings.fixed[kind][id] = next; value.id = next
    if ('catalogId' in value) value.catalogId = next
    delete collections[kind][id]; Object.assign(collections[kind], { [next]: value })
  }
  const ref = (value: VersionRef, kind: FixedKind): VersionRef => {
    const id = mappings.fixed[kind][value.id]
    if (!id) throw new Error(`旧SVG迁入的固定引用缺少映射：${kind}:${value.id}。`)
    return { ...value, id }
  }
  const appearance = (value: Appearance): void => { if (value.kind === 'image') value.assetId = remapAsset(value.assetId) }
  const propSnapshot = (value: PropAppearanceSnapshot): void => { if (value.definitionRef) value.definitionRef = ref(value.definitionRef, 'propDefinition'); appearance(value.appearance) }
  const paint = (value: MaterialPaint): void => { value.materialRef = ref(value.materialRef, 'material') }
  const style = (value: SurfaceStyle | null): void => { if (value) { paint(value.base); value.overlays.forEach(overlay => paint(overlay.paint)) } }
  for (const value of Object.values(scene.materials)) value.textureAssetId = remapAsset(value.textureAssetId)
  for (const value of Object.values(scene.propDefinitions)) appearance(value.defaultAppearance)
  for (const value of Object.values(scene.prefabDefinitions)) for (const member of value.members) propSnapshot(member.propTemplate)
  for (const value of Object.values(scene.styleThemes)) {
    value.materialSuggestions = value.materialSuggestions.map(value => ref(value, 'material'))
    value.propSuggestions = value.propSuggestions.map(value => ref(value, 'propDefinition'))
    value.prefabSuggestions = value.prefabSuggestions.map(value => ref(value, 'prefabDefinition'))
  }
  if (scene.activeStyleThemeRef) scene.activeStyleThemeRef = ref(scene.activeStyleThemeRef, 'styleTheme')
  for (const value of Object.values(scene.props)) propSnapshot(value)
  for (const value of Object.values(scene.rooms)) style(value.floorStyle)
  for (const value of Object.values(scene.walls)) style(value.topStyle)
  for (const values of [scene.terrainAreas, scene.terrainEdges, scene.terrainConnections, scene.paths]) for (const value of Object.values(values)) style(value.surfaceStyle)
  for (const value of Object.values(scene.prefabInstances)) value.definitionRef = ref(value.definitionRef, 'prefabDefinition')
  for (const value of Object.values(scene.scatterGroups)) for (const member of value.palette) member.propDefinitionRef = ref(member.propDefinitionRef, 'propDefinition')
  for (const value of Object.values(scene.decorations)) value.definitionRef = ref(value.definitionRef, 'propDefinition')
  for (const value of Object.values(scene.decorationClusters)) for (const member of value.palette) member.definitionRef = ref(member.definitionRef, 'propDefinition')
  for (const value of Object.values(scene.surfaceRules)) if (value.field === 'material') paint(value.paint)
  for (const value of Object.values(scene.visual.base.materializedEdges)) if (value.materialRef) value.materialRef = ref(value.materialRef, 'material')

  const graph: AppearanceGraph = { ...cloneJson(oldGraph), sources: {}, presentations: {}, variants: {}, prefabAppearanceTemplates: {} }
  const remapSource = (id: string): string => {
    if (Object.hasOwn(mappings.appearanceSources, id)) return mappings.appearanceSources[id]
    const source = cloneJson(oldGraph.sources[id]), parent = source.parentSourceId === null ? null : remapSource(source.parentSourceId)
    let next: string
    if (source.kind === 'prop') { propSnapshot(source.snapshot); next = addPropAppearanceSource(graph, source.snapshot, parent, oldGraph.presentations?.[id]) }
    else { style(source.snapshot); next = addSurfaceAppearanceSource(graph, source.snapshot, parent) }
    if (Object.hasOwn(oldGraph.sources, next)) throw new UnsupportedLegacySvgMigrationError([`appearance.sources.${id}: no fixed catalogue identity`])
    mappings.appearanceSources[id] = next; return next
  }
  for (const id of Object.keys(oldGraph.sources)) remapSource(id)
  graph.propSources = Object.fromEntries(Object.entries(oldGraph.propSources).map(([id, source]) => [id, remapSource(source)]))
  graph.surfaceSources = Object.fromEntries(Object.entries(oldGraph.surfaceSources).map(([id, source]) => [id, remapSource(source)]))
  for (const [id, template] of Object.entries(oldGraph.prefabAppearanceTemplates)) graph.prefabAppearanceTemplates[mappings.fixed.prefabDefinition[id]] = {
    ...cloneJson(template), definitionRef: ref(template.definitionRef, 'prefabDefinition'),
    members: Object.fromEntries(Object.entries(template.members).map(([key, member]) => [key, { ...cloneJson(member), sourceId: remapSource(member.sourceId) }])),
  }
  for (const variant of Object.values(oldGraph.variants)) {
    const next = bitmapVariant(remapAsset(variant.sourceAssetId), variant.tint, variant.brightness)!
    graph.variants[next.id] = next
  }
  project.appearance = graph; project.authoringSources = {}; project.assets = {}
  const resources = new Map<string, Uint8Array>()
  const canonicalOnly: CompleteValidationOptions = { images: checked.images, svg: checked.svg, signal: checked.signal }
  for (const [id, asset] of Object.entries(previous.document.assets)) {
    if (outputVariants.has(id)) {
      if (previous.authoringSources[id]) throw new UnsupportedLegacySvgMigrationError([`authoringSources.${id}: derivative output has two provenances`])
      continue
    }
    const next = scene.assets[remapAsset(id)], source = previous.authoringSources[id], record = previous.assets[asset.sha256]
    if (source) {
      const sourceBytes = await original.resources.read(source.sourceSha256), normalizedBytes = await original.resources.read(source.normalizedSha256)
      const normalized = normalizeStaticSvg(decodeUtf8(sourceBytes))
      checkCancelled(checked.signal)
      const raster = await checked.svg.rasterize(normalized, { width: asset.pixelWidth, height: asset.pixelHeight }, { signal: checked.signal })
      checkCancelled(checked.signal)
      if (raster.width !== asset.pixelWidth || raster.height !== asset.pixelHeight) throw new Error('旧SVG迁入不能改变固定资源尺寸。')
      const bytes = encodeCanonicalPng(raster), hash = sha256Bytes(bytes)
      next.sha256 = hash; project.assets[hash] = { ...record, sha256: hash, sizeBytes: bytes.length }
      project.authoringSources[next.id] = { ...source, ...CANONICAL_SVG_PROCESSOR, rasterSha256: hash }
      resources.set(hash, bytes); resources.set(source.sourceSha256, sourceBytes); resources.set(source.normalizedSha256, normalizedBytes)
      mappings.svgSources.push({ fromAssetId: id, toAssetId: next.id, sourceSha256: source.sourceSha256, normalizedSha256: source.normalizedSha256, fromRasterSha256: asset.sha256, toRasterSha256: hash })
    } else { project.assets[asset.sha256] = cloneJson(record); resources.set(asset.sha256, await original.resources.read(asset.sha256)) }
  }
  const pixelPipeline = createBitmapPixelPipelineLookup(project), done = new Set<string>()
  const regenerateVariant = async (id: string): Promise<void> => {
    if (done.has(id)) return
    const previousVariant = outputVariants.get(id)!
    if (outputVariants.has(previousVariant.sourceAssetId)) await regenerateVariant(previousVariant.sourceAssetId)
    const variant = graph.variants[mappings.variants[previousVariant.id]], source = scene.assets[variant.sourceAssetId], record = project.assets[source.sha256]
    const output = await deriveBitmapVariant(resources.get(source.sha256)!, record, { tint: variant.tint, brightness: variant.brightness }, canonicalOnly, pixelPipeline(variant.sourceAssetId))
    scene.assets[variant.outputAssetId].sha256 = output.record.sha256
    project.assets[output.record.sha256] = output.record; resources.set(output.record.sha256, output.bytes); done.add(id)
  }
  for (const id of outputVariants.keys()) await regenerateVariant(id)
  project.historyIdentity = createHistoryIdentity(scene, { ids: { nextId: fresh }, clock: { now: () => now } })
  mappings.lineage.to = project.historyIdentity.lineageId
  Object.assign(project, resolveAppearance(project))
  const licensePaths = new Map(previous.licenseBindings.map(binding => [binding.licenseRef, binding.licensePath]))
  project.licenseBindings = inspectDependencies(project.document).subjects.map(subject => {
    const licensePath = licensePaths.get(subject.licenseRef)
    if (!licensePath) throw new Error('旧SVG迁入新增定义缺少确切许可正文。')
    return { ...subject, licensePath, embedding: 'allowed' }
  })
  const archiveBytes = await exportProject({ project, resources: createMemoryResources(resources) }, canonicalOnly)
  const bundle = await importProject(archiveBytes, canonicalOnly)
  checkCancelled(checked.signal)
  return { originalArchiveBytes, originalArchiveSha256, originalPackageMode: packageMode, preservedSnapshotIds: archive.snapshots.map(snapshot => snapshot.id),
    bundle, archiveBytes, archiveSha256: sha256Bytes(archiveBytes), mappings: freezeJson(mappings) }
}
