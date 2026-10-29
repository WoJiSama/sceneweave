import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import type { EditableProject } from './project.js'
import { captureEditableDraft, validateEditableProject } from './project.js'
import { materializeProject } from './prepare.js'
import type { BoundsMm, PointMm, Prop, SceneDocument, SurfaceStyle, TerrainArea } from '../../shared/model/scene.js'
import type { AssetRecord, LicenseBinding, ProjectData, SvgAuthoringSource } from '../../shared/model/project.js'
import type { CompleteValidationOptions, CancellationSignal } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { createCompositionContent, syncAppearanceGraph } from '../../shared/appearance/graph.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import { effectivePropShadow } from '../../shared/appearance/presentation.js'
import { shadowPadding, terrainDecorationPadding } from '../../shared/projection/projection.js'
import { pathDecorationPadding, pathEdgeStyle } from '../../shared/projection/paths.js'
import { canonicalJson, captureJson, cloneJson } from '../../shared/validation/json.js'
import { sha256Text } from '../../shared/validation/hash.js'
import { polygonBoolean } from '../../shared/geometry/polygon-boolean.js'
import { coveredEverywhere, pathPolygon, pointInPolygon, pointOnSurface, propFootprint, polygonsOverlap, supportedPolygon, terrainPoints } from '../../shared/geometry/geometry.js'
import { emptyTerrainDocument } from '../../shared/terrain-generation/compose.js'
import { validateSceneDocument } from '../../shared/validation/scene.js'
import { assertTerrainBudget, type terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { RegionSceneCandidateResultSchema } from '../../shared/ai/region-candidate-protocol.js'
import { createRegionalDocument, prepareRegionalEdit as prepareEdit, prepareRegionalDrillDown as prepareDrillDown,
  regionalAuthorizedSubsetHash,
  regionalCreateRequestSchema, regionalDrillDownRequestSchema, type RegionalAuthoringRequest, type RegionalAuthoringResult,
  type RegionalEditRequest, type RegionalEditResult, type RegionalDrillDownRequest, type RegionalDrillDownResult } from '../../shared/terrain-generation/regional-authoring.js'

export interface RegionalCreateUiRequest { preset: 'riverlands' | 'lakewood' | 'highlands'; seed: string; widthMm?: number; heightMm?: number; title?: string }
export interface RegionalDrillDownUiRequest { selectionMm: BoundsMm; title?: string; includePrivate?: false }
export type RegionalCandidateInput = RegionalAuthoringRequest | RegionalEditRequest | RegionalDrillDownRequest
export interface RegionalMaterializationEntry { sourceFeatureId: string; kind: string; label: string; status: 'materialized' | 'partial' | 'sourceOnly'; reason: string | null }
export interface RegionalMaterializationReport { entries: RegionalMaterializationEntry[]; materializedCount: number; partialCount: number; sourceOnlyCount: number }
export interface RegionalCandidate {
  kind: 'create' | 'edit' | 'drillDown'; project: EditableProject; document: SceneDocument
  cost: ReturnType<typeof terrainCommandCost>; label: string; input: RegionalCandidateInput
  result: RegionalAuthoringResult | RegionalEditResult | RegionalDrillDownResult; resultHash: string; materialization?: RegionalMaterializationReport
}
interface RegionalOptions {
  runtime: PreparationContext
  validation: CompleteValidationOptions
  signal?: CancellationSignal
  yieldToEventLoop?: () => Promise<void>
}
const point = (x: number, y: number): PointMm => ({ x: Math.round(x), y: Math.round(y) })
const rectangle = (box: BoundsMm): PointMm[] => [point(box.x, box.y), point(box.x + box.width, box.y), point(box.x + box.width, box.y + box.height), point(box.x, box.y + box.height)]
const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const between = (value: number, a: number, b: number) => value >= Math.min(a, b) && value <= Math.max(a, b)
const onSegment = (p: PointMm, a: PointMm, b: PointMm) => cross(a, b, p) === 0 && between(p.x, a.x, b.x) && between(p.y, a.y, b.y)
const sharedPoint = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
function polygonBoundariesCross(a: PointMm[], b: PointMm[]): boolean {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length], b1 = b[j], b2 = b[(j + 1) % b.length]
    const c1 = cross(a1, a2, b1), c2 = cross(a1, a2, b2), c3 = cross(b1, b2, a1), c4 = cross(b1, b2, a2)
    const proper = (c1 < 0) !== (c2 < 0) && (c3 < 0) !== (c4 < 0) && c1 !== 0 && c2 !== 0 && c3 !== 0 && c4 !== 0
    if (proper) return true
  }
  return false
}
function polygonBoundariesRequireSplit(a: PointMm[], b: PointMm[]): boolean {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length], b1 = b[j], b2 = b[(j + 1) % b.length]
    const c1 = cross(a1, a2, b1), c2 = cross(a1, a2, b2), c3 = cross(b1, b2, a1), c4 = cross(b1, b2, a2)
    const proper = (c1 < 0) !== (c2 < 0) && (c3 < 0) !== (c4 < 0) && c1 !== 0 && c2 !== 0 && c3 !== 0 && c4 !== 0
    if (proper || c1 === 0 && onSegment(b1, a1, a2) && !sharedPoint(b1, a1) && !sharedPoint(b1, a2)
      || c2 === 0 && onSegment(b2, a1, a2) && !sharedPoint(b2, a1) && !sharedPoint(b2, a2)
      || c3 === 0 && onSegment(a1, b1, b2) && !sharedPoint(a1, b1) && !sharedPoint(a1, b2)
      || c4 === 0 && onSegment(a2, b1, b2) && !sharedPoint(a2, b1) && !sharedPoint(a2, b2)) return true
  }
  return false
}
function regionalCheckpoint(signal: CancellationSignal | undefined, yieldToEventLoop: () => Promise<void>) {
  let pending = 32
  return async (force = false) => {
    checkCancelled(signal)
    if (force || --pending === 0) {
      pending = 32
      await yieldToEventLoop()
      checkCancelled(signal)
    }
  }
}

async function splitBoundaryVertices(polygons: PointMm[][], checkpoint: (force?: boolean) => Promise<void>): Promise<PointMm[][]> {
  const vertices = polygons.flat()
  const result: PointMm[][] = []
  for (const polygon of polygons) {
    await checkpoint()
    const output: PointMm[] = []
    const append = (value: PointMm) => { if (!output.length || !sharedPoint(output.at(-1)!, value)) output.push(value) }
    for (const [index, start] of polygon.entries()) {
      await checkpoint()
      const end = polygon[(index + 1) % polygon.length], dx = end.x - start.x, dy = end.y - start.y, length2 = dx * dx + dy * dy
      const points = vertices.filter(value => onSegment(value, start, end)).sort((a, b) => {
        const at = ((a.x - start.x) * dx + (a.y - start.y) * dy) / length2
        const bt = ((b.x - start.x) * dx + (b.y - start.y) * dy) / length2
        return at - bt
      })
      points.forEach(append)
    }
    if (output.length > 1 && sharedPoint(output[0], output.at(-1)!)) output.pop()
    result.push(output)
  }
  return result
}
const fitSegment = (a: PointMm, b: PointMm, box: BoundsMm): [PointMm, PointMm] | null => {
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y
  for (const [p, q] of [[-dx, a.x - box.x], [dx, box.x + box.width - a.x], [-dy, a.y - box.y], [dy, box.y + box.height - a.y]] as [number, number][]) {
    if (p === 0) { if (q < 0) return null; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t } else { if (t < t0) return null; if (t < t1) t1 = t }
  }
  const first = point(a.x + dx * t0, a.y + dy * t0), last = point(a.x + dx * t1, a.y + dy * t1)
  return first.x === last.x && first.y === last.y ? null : [first, last]
}
const childAssetId = (sourceAssetId: string) => `regional-child-asset-${sha256Text(sourceAssetId).slice(0, 24)}`
const childDefinitionId = (sourceDefinitionId: string, version: number) => `regional-child-prop-${sha256Text(`${sourceDefinitionId}@${version}`).slice(0, 24)}`
const sourceFeatureDefinition = (feature: RegionalDrillDownResult['sourceLink']['inherited'][number]) => {
  if (feature.kind === 'landmark' && 'landmark' in feature) return feature.landmark.definition
  if (feature.kind === 'symbol' && 'symbol' in feature) return feature.symbol.definition
  return null
}
interface RegionalResourceClosure {
  assets: Record<string, AssetRecord>
  licenses: ProjectData['licenses']
  licenseBindings: LicenseBinding[]
  authoringSources: Record<string, SvgAuthoringSource>
  sourceHashes: Set<string>
}
const labels = { riverlands: '河谷古道', lakewood: '林间湖区', highlands: '群山隘口' } as const

function createRequest(base: EditableProject, input: RegionalCreateUiRequest, runtime: PreparationContext): RegionalAuthoringRequest {
  if (!Object.hasOwn(labels, input.preset)) throw new Error('请选择受支持的区域配方。')
  const width = input.widthMm ?? 10_000_000, height = input.heightMm ?? 8_000_000, operationId = runtime.ids.nextId()
  const definitions = Object.values(base.document.regional?.symbolDefinitions ?? {})
  const definition = (name: string) => { const row = definitions.find(row => row.catalogId.endsWith(name)); if (!row) throw new Error('区域配方缺少实际原创图符资源。'); return row }
  const woodland = definition('woodland'), ridge = definition('ridge'), landmark = definition('landmark')
  const areaId = `regional-${operationId}-feature`, roadId = `regional-${operationId}-road`
  const forest = input.preset === 'lakewood', high = input.preset === 'highlands'
  const areas = [{ id: areaId, visibility: 'public' as const, editLocked: false, kind: forest ? 'water' as const : high ? 'hill' as const : 'forest' as const,
    boundaryMm: [point(width * .39, height * .32), point(width * .58, height * .28), point(width * .62, height * .5), point(width * .44, height * .56)], relativeElevationMm: high ? 180_000 : 0 }]
  const routeY = high ? .64 : forest ? .7 : .56
  const lines = [{ id: roadId, visibility: 'public' as const, editLocked: false, kind: 'road' as const, displayWidthMm: 25_000, actualWidthMm: 5000,
    pointsMm: [point(width * .1, height * routeY), point(width * .48, height * (routeY + .03)), point(width * .9, height * routeY)].map((positionMm, i) => ({ id: `${roadId}-point-${i}`, positionMm })) }]
  const landmarkId = `regional-${operationId}-landmark`
  const landmarks = [{ id: landmarkId, visibility: 'public' as const, editLocked: false, positionMm: point(width * .48, height * .62), purpose: high ? 'camp' as const : 'ruin' as const,
    name: high ? '石门营地' : forest ? '湖畔古迹' : '古道驿站', description: '区域地标仅说明位置与用途；人物活动范围与实际通行需在场景地图中确认。', definitionRef: { id: landmark.id, version: landmark.version }, areaId: null }]
  const symbols = [woodland, ridge].map((row, index) => ({ id: `regional-${operationId}-symbol-${index}`, visibility: 'public' as const, editLocked: false, definitionRef: { id: row.id, version: row.version },
    positionMm: point(width * (index ? .74 : .25), height * (index ? .42 : .52)), visualBoundsMm: captureJson(row.visualBoundsMm), renderOrder: index, managementKey: null, sourceRef: null }))
  return regionalCreateRequestSchema.parse({ kind: 'regional', sceneId: runtime.ids.nextId(), operationId, title: input.title ?? labels[input.preset], seed: input.seed, widthMm: width, heightMm: height, areas, lines, landmarks, symbols })
}

/** Preparation only. The workspace owns protection, durable save and the final switch. */
export async function prepareRegionalCreate(base: EditableProject, input: RegionalCreateUiRequest | RegionalAuthoringRequest, options: RegionalOptions): Promise<RegionalCandidate> {
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  checkCancelled(validation.signal)
  const owned = await validateEditableProject(captureEditableDraft(base), validation)
  const request = 'kind' in input ? regionalCreateRequestSchema.parse(captureJson(input)) : createRequest(owned, captureJson(input), options.runtime)
  const result = createRegionalDocument(owned.document, request), document = captureJson(result.document)
  document.revision = 0
  const project = await validateEditableProject({ ...owned, schemaVersion: 3, ...createCompositionContent(document, options.runtime) }, validation)
  return { kind: 'create', project, document: project.document, input: result.request, result, resultHash: result.hash, cost: result.cost, label: document.title }
}

/** Same-scene edits retain the existing immutable resources and advance persistent identity. */
export async function prepareRegionalEdit(base: EditableProject, input: RegionalEditRequest, options: RegionalOptions): Promise<RegionalCandidate> {
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  checkCancelled(validation.signal)
  const owned = await validateEditableProject(captureEditableDraft(base), validation), result = prepareEdit(owned.document, captureJson(input))
  const content = syncAppearanceGraph({ document: result.document, historyIdentity: advanceHistoryIdentity(owned.historyIdentity, owned.document, result.document, options.runtime), appearance: captureJson(owned.appearance) })
  const project = await materializeProject({ ...owned, ...content }, { runtime: options.runtime, validation, signal: validation.signal, baseline: owned })
  if (canonicalJson(project.document) !== canonicalJson(result.document)) throw new Error('区域编辑物化改变了已审阅结果。')
  return { kind: 'edit', project, document: project.document, input: result.request, result, resultHash: result.hash, cost: result.cost, label: '区域实体修改' }
}

async function materializeInherited(result: RegionalDrillDownResult, base: SceneDocument, source: EditableProject, signal: CancellationSignal | undefined,
  yieldToEventLoop: () => Promise<void>): Promise<{ document: SceneDocument; closure: RegionalResourceClosure; materialization: RegionalMaterializationReport }> {
  checkCancelled(signal)
  const checkpoint = regionalCheckpoint(signal, yieldToEventLoop)
  await checkpoint(true)
  const document = base.schemaVersion === 2 ? emptyTerrainDocument(base) : captureJson(base)
  if (Object.values(document.rooms).length || Object.values(document.terrainAreas).length || Object.values(document.props).length || Object.values(document.paths).length) throw new Error('下钻材质基线必须是独立空白场景。')
  document.sceneId = result.document.sceneId; document.title = result.document.title; document.revision = 0
  document.exportBoundsMm = captureJson(result.document.exportBoundsMm); document.generation = captureJson(result.document.generation!)
  document.units = { ...document.units, gridSizeMm: 1000, snapMm: 100, gridVisible: false }
  for (const floor of Object.values(document.floors)) floor.boundsMm = captureJson(document.exportBoundsMm)
  const floorId = Object.keys(document.floors)[0], layerId = Object.keys(document.userLayers).find(id => document.userLayers[id].floorId === floorId)!
  const closure: RegionalResourceClosure = { assets: {}, licenses: {}, licenseBindings: [], authoringSources: {}, sourceHashes: new Set() }
  const materializedSourceIds = new Set<string>(), auxiliarySourceIds = new Set<string>(), sourceOnlyReasons = new Map<string, string>()
  const candidateParts = new Map<string, number>(), materializedParts = new Map<string, number>()
  const theme = document.activeStyleThemeRef ? document.styleThemes[document.activeStyleThemeRef.id] : null
  const notePart = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1)
  const retainSourceOnly = (id: string, reason: string) => { if (!materializedSourceIds.has(id) || !sourceOnlyReasons.has(id)) sourceOnlyReasons.set(id, reason) }
  const addPrivateMask = (id: string, points: PointMm[], padding: number) => {
    const bounds = points.reduce<BoundsMm>((result, value) => ({
      x: Math.min(result.x, value.x), y: Math.min(result.y, value.y),
      width: Math.max(result.x + result.width, value.x) - Math.min(result.x, value.x),
      height: Math.max(result.y + result.height, value.y) - Math.min(result.y, value.y),
    }), { x: points[0].x, y: points[0].y, width: 0, height: 0 })
    // Round outwards so an integer-mm rectangle covers fractional path joins
    // and theme decoration extents without relying on a fixed-size margin.
    const x = Math.max(document.exportBoundsMm.x, Math.floor(bounds.x - padding)), y = Math.max(document.exportBoundsMm.y, Math.floor(bounds.y - padding))
    const right = Math.min(document.exportBoundsMm.x + document.exportBoundsMm.width, Math.ceil(bounds.x + bounds.width + padding))
    const bottom = Math.min(document.exportBoundsMm.y + document.exportBoundsMm.height, Math.ceil(bounds.y + bounds.height + padding))
    const maskId = `child-private-mask-${sha256Text(id).slice(0, 16)}`
    document.regions[maskId] = { id: maskId, floorId, editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: rectangle({ x, y, width: right - x, height: bottom - y }), blocksMovement: false, movementCostMultiplier: 1 }
    document.entityLayers[maskId] = layerId
  }
  const bindingFor = (subjectKind: LicenseBinding['subjectKind'], subjectId: string) => {
    const binding = source.licenseBindings.find(row => row.subjectKind === subjectKind && row.subjectId === subjectId)
    if (!binding || binding.embedding !== 'allowed') throw new Error(`下钻图符缺少可嵌入许可绑定：${subjectKind}/${subjectId}。`)
    const hash = binding.licensePath.slice('licenses/'.length, -'.txt'.length), license = source.licenses[hash]
    if (!license || license.sha256 !== hash || sha256Text(license.text) !== hash) throw new Error(`下钻图符许可正文缺失或hash不匹配：${subjectId}。`)
    closure.licenses[hash] = cloneJson(license)
    return { binding, hash }
  }
  const copiedDefinitions = new Map<string, { id: string; assetId: string }>()
  for (const feature of result.sourceLink.inherited) {
    await checkpoint()
    const definition = sourceFeatureDefinition(feature)
    if (!definition) continue
    const sourceDefinition = source.document.regional?.symbolDefinitions[definition.id]
    if (!sourceDefinition || canonicalJson(sourceDefinition) !== canonicalJson(definition)) throw new Error(`区域来源固定图符已改变：${definition.id}。`)
    if (!definition.origin.canEmbed) throw new Error(`区域来源图符不允许嵌入：${definition.id}。`)
    const refKey = `${definition.id}@${definition.version}`
    if (copiedDefinitions.has(refKey)) continue
    const originalAsset = source.document.assets[definition.assetId]
    if (!originalAsset || originalAsset.licenseRef !== definition.licenseRef || canonicalJson(originalAsset.origin) !== canonicalJson(definition.origin)) throw new Error(`区域图符真实资源与固定定义不匹配：${definition.id}。`)
    const assetBinding = bindingFor('asset', originalAsset.id), definitionBinding = bindingFor('regionalSymbolDefinition', definition.id)
    if (assetBinding.binding.licenseRef !== definition.licenseRef || definitionBinding.binding.licenseRef !== definition.licenseRef) throw new Error(`区域图符许可主体与固定定义不匹配：${definition.id}。`)
    const sourceRecord = source.assets[originalAsset.sha256]
    if (!sourceRecord || sourceRecord.sha256 !== originalAsset.sha256 || sourceRecord.mimeType !== originalAsset.mimeType || sourceRecord.pixelWidth !== originalAsset.pixelWidth || sourceRecord.pixelHeight !== originalAsset.pixelHeight) throw new Error(`区域图符位图元数据不匹配：${definition.id}。`)
    const assetId = childAssetId(originalAsset.id), propDefinitionId = childDefinitionId(definition.id, definition.version)
    if (document.propDefinitions[propDefinitionId]) throw new Error(`子图固定图符身份冲突：${definition.id}。`)
    if (document.assets[assetId] && canonicalJson(document.assets[assetId]) !== canonicalJson({ ...originalAsset, id: assetId })) throw new Error(`子图固定资源身份冲突：${definition.id}。`)
    document.assets[assetId] ??= { ...cloneJson(originalAsset), id: assetId }
    const visualBoundsMm = { ...cloneJson(definition.visualBoundsMm), x: definition.visualBoundsMm.x - definition.rootAnchorMm.x, y: definition.visualBoundsMm.y - definition.rootAnchorMm.y }
    document.propDefinitions[propDefinitionId] = { id: propDefinitionId, catalogId: `regional-child.${definition.catalogId}`, version: 1,
      licenseRef: definition.licenseRef, origin: cloneJson(definition.origin), name: definition.name, tags: ['regional-source'],
      defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 }, defaultVisualBoundsMm: visualBoundsMm,
      defaultFootprintMm: { width: 1, height: 1 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: false, defaultBlocksSight: false,
      defaultRenderLayer: 'object', defaultShadowClass: 'none' }
    const record = closure.assets[originalAsset.sha256]
    if (record && canonicalJson(record) !== canonicalJson(sourceRecord)) throw new Error(`子图同hash资源元数据冲突：${originalAsset.sha256}。`)
    closure.assets[originalAsset.sha256] = cloneJson(sourceRecord); closure.sourceHashes.add(originalAsset.sha256)
    const assetLicenseHash = assetBinding.hash, definitionLicenseHash = definitionBinding.hash
    if (assetLicenseHash !== definitionLicenseHash) throw new Error(`同一固定图符不能引用不同许可文本：${definition.id}。`)
    closure.licenseBindings.push({ ...cloneJson(assetBinding.binding), subjectId: assetId })
    closure.licenseBindings.push({ ...cloneJson(definitionBinding.binding), subjectKind: 'propDefinition', subjectId: propDefinitionId })
    const authoring = source.authoringSources[originalAsset.id]
    if (authoring) {
      closure.authoringSources[assetId] = cloneJson(authoring)
      closure.sourceHashes.add(authoring.sourceSha256); closure.sourceHashes.add(authoring.normalizedSha256)
    }
    copiedDefinitions.set(refKey, { id: propDefinitionId, assetId })
  }
  const materials = Object.values(document.materials)
  const paint = (kind: string): SurfaceStyle => {
    const key = kind === 'water' || kind === 'river' ? 'deep-water' : kind === 'road' ? 'sand' : kind === 'hill' || kind === 'ridge' ? 'stone' : 'grass'
    const material = materials.find(row => row.id.endsWith(key) && row.applicableSurfaces.includes('terrain')) ?? materials.find(row => row.id.includes(key) && row.applicableSurfaces.includes('terrain'))
      ?? materials.find(row => (key === 'stone' ? row.id.includes('grass') || row.id.includes('moss') : key === 'grass' ? row.id.includes('sand') : false) && row.applicableSurfaces.includes('terrain'))
      ?? materials.find(row => row.applicableSurfaces.includes('terrain'))
    if (!material) throw new Error(`下钻缺少真实${kind}材质。`)
    return { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: point(0, 0), tint: null, opacity: 1 }, overlays: [] }
  }
  const addArea = (id: string, points: PointMm[], kind: string, elevationMm: number | null, priority: number, visibility: 'public' | 'gm') => {
    const area: TerrainArea = { id, floorId, visibility, editLocked: false, boundaryMm: points.map((positionMm, i) => ({ id: `${id}-point-${i}`, segmentId: `${id}-segment-${i}`, positionMm: { ...positionMm } })), groundElevationMm: elevationMm ?? 0, coveragePriority: priority, surfaceStyle: paint(kind), blocksMovement: kind === 'water' || kind === 'river', blocksSight: false, movementCostMultiplier: 1 }
    document.terrainAreas[id] = area; document.entityLayers[id] = layerId
  }
  const boundsPolygon = rectangle(document.exportBoundsMm)
  const surfaceCandidates: { key: string; sourceFeatureId: string; kind: string; elevationMm: number | null; visibility: 'public' | 'gm'; rank: number; polygon: PointMm[] }[] = []
  for (const feature of result.sourceLink.inherited) {
    await checkpoint()
    if (feature.kind === 'area') {
      const clipped = polygonBoolean({ operation: 'intersection', subject: [feature.pointsMm], clip: [boundsPolygon] })
      if (!clipped.polygons.length) { retainSourceOnly(feature.id, '区域面与子图边界没有可物化面积。'); continue }
      const rank = feature.terrainKind === 'water' ? 25 : feature.terrainKind === 'hill' ? 20 : feature.terrainKind === 'forest' ? 15 : 10
      for (const [index, polygon] of clipped.polygons.entries()) {
        if (polygon.holes.length) { retainSourceOnly(feature.id, '区域面裁切产生当前场景不能表达的孔洞。'); continue }
        notePart(candidateParts, feature.id)
        surfaceCandidates.push({ key: `${feature.id}-${index}`, sourceFeatureId: feature.id, kind: feature.terrainKind, elevationMm: feature.elevationMm, visibility: feature.visibility, rank, polygon: polygon.outer })
      }
    } else if (feature.kind === 'line' && (feature.terrainKind === 'river' || feature.terrainKind === 'ridge') && feature.pointsMm.length >= 2) {
      const width = feature.widthMm
      if (width <= 0) { retainSourceOnly(feature.id, '继承线缺少可物化的实际或明确估算宽度。'); continue }
      const band = pathPolygon({ centerlineMm: feature.pointsMm, widthMm: width } as SceneDocument['paths'][string]).map(p => point(p.x, p.y))
      const clipped = polygonBoolean({ operation: 'intersection', subject: [band], clip: [boundsPolygon] })
      if (!clipped.polygons.length) { retainSourceOnly(feature.id, '水系/山脊带与子图边界没有可物化面积。'); continue }
      for (const [index, polygon] of clipped.polygons.entries()) {
        if (polygon.holes.length) { retainSourceOnly(feature.id, '水系/山脊带裁切产生当前场景不能表达的孔洞。'); continue }
        notePart(candidateParts, feature.id)
        surfaceCandidates.push({ key: `${feature.id}-${index}`, sourceFeatureId: feature.id, kind: feature.terrainKind === 'river' ? 'water' : 'hill', elevationMm: feature.elevationMm, visibility: feature.visibility, rank: feature.terrainKind === 'river' ? 30 : 20, polygon: polygon.outer })
      }
    }
  }
  // Resolve each audience independently. GM-only source geometry can overlay
  // public terrain for the host, but must never cut holes from the player's
  // public surface when that private overlay is filtered out. Different
  // coverage priorities are represented as overlapping terrain areas; the
  // scene resolver already selects the highest-priority surface at a point.
  // Contained surfaces can remain overlapped and are resolved by priority.
  // Proper boundary crossings remain rejected because they cannot be
  // represented by strict terrain-area topology without invented vertices.
  const orderedSurfaces = surfaceCandidates.slice().sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key))
  const resolvedByVisibility = new Map<'gm' | 'public', { candidate: typeof surfaceCandidates[number]; polygon: PointMm[]; component: number; coveragePriority: number }[]>([['gm', []], ['public', []]])
  for (const visibility of ['public', 'gm'] as const) {
    await checkpoint()
    const resolved = resolvedByVisibility.get(visibility)!
    for (const candidate of orderedSurfaces.filter(row => row.visibility === visibility)) {
      await checkpoint()
      if (visibility === 'gm' && resolvedByVisibility.get('public')!.some(row => polygonBoundariesRequireSplit(candidate.polygon, row.polygon))) {
        retainSourceOnly(candidate.sourceFeatureId, '物化会改变公开地形边界，私密表面仅保留来源。')
        continue
      }
      const overlapping = resolved.filter(existing => polygonsOverlap(candidate.polygon, existing.polygon))
      const crossing = overlapping.filter(existing => polygonBoundariesCross(candidate.polygon, existing.polygon)).map(existing => existing.polygon)
      if (crossing.length) {
        retainSourceOnly(candidate.sourceFeatureId, '边界交叉需要新的显式整数交点，当前子图只保留来源。')
        continue
      }
      resolved.push({ candidate, polygon: candidate.polygon, component: 0, coveragePriority: 0 })
    }
  }
  // GM overlays receive the higher priorities; public-only projection then
  // reveals the untouched public partition beneath them.
  const materializedSurfaces = [...resolvedByVisibility.get('gm')!, ...resolvedByVisibility.get('public')!]
  for (const visibility of ['gm', 'public'] as const) {
    await checkpoint()
    const surfaces = resolvedByVisibility.get(visibility)!
    if (surfaces.length > 10_000) throw new Error(`下钻${visibility === 'gm' ? '主持人' : '公开'}地形超过可表达的覆盖优先级范围。`)
    for (const [index, row] of surfaces.entries()) {
      await checkpoint()
      row.coveragePriority = (visibility === 'gm' ? 10_000 : 0) - index
    }
  }
  const splitPolygons = await splitBoundaryVertices(materializedSurfaces.map(row => row.polygon), checkpoint)
  for (const [index, row] of materializedSurfaces.entries()) {
    await checkpoint()
    const { candidate } = row, id = `child-surface-${sha256Text(candidate.key).slice(0, 16)}-${row.component}`
    const priority = row.coveragePriority
    if (splitPolygons[index].length < 3) { retainSourceOnly(candidate.sourceFeatureId, '物化面裁切后不是合法的三点以上多边形。'); continue }
    addArea(id, splitPolygons[index], candidate.kind, candidate.elevationMm, priority, candidate.visibility)
    if (candidate.visibility === 'gm') addPrivateMask(id, splitPolygons[index], terrainDecorationPadding(document, theme))
    materializedSourceIds.add(candidate.sourceFeatureId); notePart(materializedParts, candidate.sourceFeatureId)
  }
  const activeTerrainSupports = async (shape: PointMm[]) => {
    await checkpoint()
    const active: TerrainArea[] = []
    const boundaries = Object.values(document.terrainAreas).map(terrainPoints)
    for (const area of Object.values(document.terrainAreas)) {
      await checkpoint()
      if (area.floorId !== floorId || !polygonsOverlap(shape, area.boundaryMm.map(point => point.positionMm))) continue
      // A narrow intersection can contain none of either polygon's vertices
      // or edge midpoints. Sample every arrangement face, including overlays,
      // using the same complete coverage check that validates path supports.
      if (!coveredEverywhere(shape, boundaries, position => !pointOnSurface(document, position, { kind: 'terrainArea', id: area.id }, floorId))) active.push(area)
    }
    return active
  }
  for (const feature of result.sourceLink.inherited) {
    await checkpoint()
    if ('directionDeg' in feature) {
      const positionMm = feature.pointsMm[0], id = `child-port-${feature.id}`
      getLegacyGeneration(document)!.constraints[id] = { id, floorId, visibility: feature.visibility, strength: 'soft', kind: 'port', positionMm: { ...positionMm }, directionDeg: feature.directionDeg, widthMm: feature.widthMm }
      // A standalone source port is fully represented by this persisted soft
      // constraint. It is not an incomplete fragment of another feature.
      materializedSourceIds.add(feature.id); notePart(candidateParts, feature.id); notePart(materializedParts, feature.id)
      continue
    }
    if (feature.kind !== 'line' || feature.pointsMm.length < 2) continue
    const width = feature.widthMm
    if (width <= 0) { retainSourceOnly(feature.id, '继承线缺少可物化的实际或明确估算宽度。'); continue }
    const a = feature.pointsMm[0], b = feature.pointsMm.at(-1)!, directionDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360
    for (const [index, positionMm] of [a, b].entries()) {
      checkCancelled(signal)
      if (positionMm.x !== 0 && positionMm.y !== 0 && positionMm.x !== document.exportBoundsMm.width && positionMm.y !== document.exportBoundsMm.height) continue
      const id = `child-port-${feature.id}-${index}`
      getLegacyGeneration(document)!.constraints[id] = { id, floorId, visibility: feature.visibility, strength: 'soft', kind: 'port', positionMm: { ...positionMm }, directionDeg, widthMm: width }
      auxiliarySourceIds.add(feature.id)
    }
    if (feature.terrainKind === 'road') {
      const id = `child-${feature.id}`
      notePart(candidateParts, feature.id)
      const inset = Math.ceil(width / Math.SQRT2) + 2, insetBox = { x: inset, y: inset, width: document.exportBoundsMm.width - inset * 2, height: document.exportBoundsMm.height - inset * 2 }
      if (insetBox.width <= 0 || insetBox.height <= 0) {
        retainSourceOnly(feature.id, '子图尺寸不足以容纳完整道路带和安全端帽。')
        continue
      }
      const fitted = feature.pointsMm.length === 2
        ? fitSegment(feature.pointsMm[0], feature.pointsMm[1], insetBox)
        : feature.pointsMm.every(position => position.x >= insetBox.x && position.x <= insetBox.x + insetBox.width
          && position.y >= insetBox.y && position.y <= insetBox.y + insetBox.height) ? feature.pointsMm : null
      if (!fitted || fitted.length < 2) {
        retainSourceOnly(feature.id, '道路带无法在保持完整宽度和安全端帽的前提下放入子图。')
        continue
      }
      const path: SceneDocument['paths'][string] = { id, floorId, visibility: feature.visibility, editLocked: false, centerlineMm: fitted, widthMm: width,
        supportRefs: [{ kind: 'floor', id: floorId }],
        surfaceStyle: paint('road'), movementCostMultiplier: 1, renderOrder: 0 }
      const band = pathPolygon(path), supports = await activeTerrainSupports(band)
      if (feature.visibility === 'public' && supports.some(area => area.visibility === 'gm')) {
        retainSourceOnly(feature.id, '道路带依赖私密地形，公开路径仅保留来源。')
        continue
      }
      path.supportRefs = [...supports.map(area => ({ kind: 'terrainArea' as const, id: area.id })), { kind: 'floor', id: floorId }]
      if (!coveredEverywhere(band, Object.values(document.terrainAreas).map(terrainPoints), position => path.supportRefs.some(ref => pointOnSurface(document, position, ref, floorId)))) {
        retainSourceOnly(feature.id, '道路带完整范围无法由已声明的公开/主持人地形与Floor支撑。')
        continue
      }
      document.paths[id] = path
      document.entityLayers[id] = layerId
      checkCancelled(signal)
      const checkedPath = validateSceneDocument(document)
      checkCancelled(signal)
      const pathIssues = checkedPath.ok ? [] : checkedPath.errors.filter(issue => issue.entityId === id)
      if (pathIssues.length) {
        delete document.paths[id]
        delete document.entityLayers[id]
        retainSourceOnly(feature.id, `道路带完整校验未通过：${pathIssues.map(issue => issue.message).join('；')}`)
        continue
      }
      if (feature.visibility === 'gm') addPrivateMask(id, band, pathDecorationPadding(pathEdgeStyle(theme)))
      materializedSourceIds.add(feature.id); notePart(materializedParts, feature.id)
    }
  }
  for (const feature of result.sourceLink.inherited) {
    await checkpoint()
    const definition = sourceFeatureDefinition(feature)
    if (!definition) continue
    const mapped = copiedDefinitions.get(`${definition.id}@${definition.version}`)!
    const landmark = feature.kind === 'landmark' && 'landmark' in feature ? feature.landmark : null
    const symbol = feature.kind === 'symbol' && 'symbol' in feature ? feature.symbol : null
    if (!landmark && !symbol) throw new Error(`来源图符数据不完整：${feature.id}。`)
    const positionMm = landmark ? landmark.positionMm : symbol!.positionMm
    const visualBoundsMm = landmark
      ? { ...cloneJson(definition.visualBoundsMm), x: definition.visualBoundsMm.x - definition.rootAnchorMm.x, y: definition.visualBoundsMm.y - definition.rootAnchorMm.y }
      : { ...cloneJson(symbol!.visualBoundsMm), x: symbol!.visualBoundsMm.x - definition.rootAnchorMm.x, y: symbol!.visualBoundsMm.y - definition.rootAnchorMm.y }
    const renderOrder = landmark ? 0 : symbol!.renderOrder
    const anchorPosition = { x: positionMm.x, y: positionMm.y }
    const id = `child-${feature.id}-prop`, footprintMm = { width: 1, height: 1 }
    const prop: Prop = { id, floorId, editLocked: false, definitionRef: { id: mapped.id, version: 1 }, appearance: { kind: 'image', assetId: mapped.assetId, tint: null, opacity: 1 },
      visualBoundsMm: cloneJson(visualBoundsMm), positionMm: anchorPosition, rotationDeg: 0, footprintMm, footprintOffsetMm: { x: 0, y: 0 },
      blocksMovement: false, blocksSight: false, visibility: feature.visibility, supportRef: { kind: 'floor', id: floorId }, renderLayer: 'object', renderOrder, shadowClass: 'none', shadowOverride: null }
    // A source symbol may be selected by its anchor while its complete visual
    // bounds extend beyond the child rectangle. Keep that source evidence but
    // omit the scene prop instead of producing an invalid clipped entity.
    const visualPoints = [
      { x: anchorPosition.x + visualBoundsMm.x, y: anchorPosition.y + visualBoundsMm.y },
      { x: anchorPosition.x + visualBoundsMm.x + visualBoundsMm.width, y: anchorPosition.y + visualBoundsMm.y },
      { x: anchorPosition.x + visualBoundsMm.x + visualBoundsMm.width, y: anchorPosition.y + visualBoundsMm.y + visualBoundsMm.height },
      { x: anchorPosition.x + visualBoundsMm.x, y: anchorPosition.y + visualBoundsMm.y + visualBoundsMm.height },
    ]
    if (visualPoints.some(point => !pointInPolygon(point, rectangle(document.exportBoundsMm)))) {
      retainSourceOnly(feature.id, '完整图像范围超出子图边界。')
      continue
    }
    notePart(candidateParts, feature.id)
    const polygon = propFootprint(prop), overlapping = await activeTerrainSupports(polygon)
    if (feature.visibility === 'public' && overlapping.some(area => area.visibility === 'gm')) {
      retainSourceOnly(feature.id, '完整物件占地依赖私密地形，公开物件仅保留来源。')
      continue
    }
    const support = overlapping.sort((a, b) => b.coveragePriority - a.coveragePriority || a.id.localeCompare(b.id)).find(area => supportedPolygon(document, polygon, { kind: 'terrainArea', id: area.id }, floorId))
    const floorSupport = !support && supportedPolygon(document, polygon, { kind: 'floor', id: floorId }, floorId)
    if (!support && !floorSupport) {
      retainSourceOnly(feature.id, '完整物件占地没有合法的地形或Floor支撑。')
      continue
    }
    prop.supportRef = support ? { kind: 'terrainArea', id: support.id } : { kind: 'floor', id: floorId }; document.props[id] = prop; document.entityLayers[id] = layerId
    if (feature.visibility === 'gm') addPrivateMask(id, visualPoints, shadowPadding(effectivePropShadow(prop, undefined, theme?.shadowPresets[prop.shadowClass])))
    if (landmark && landmark.description) {
      const noteId = `child-${feature.id}-label`
      document.notes[noteId] = { id: noteId, floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: id }, kind: 'label',
        title: landmark.name, text: landmark.description, visibility: feature.visibility }
      document.entityLayers[noteId] = layerId
    }
    materializedSourceIds.add(feature.id); notePart(materializedParts, feature.id)
  }
  const featureLabel = (feature: RegionalDrillDownResult['sourceLink']['inherited'][number]) => {
    if (feature.kind === 'landmark' && 'landmark' in feature) return feature.landmark.name
    if (feature.kind === 'symbol' && 'symbol' in feature) return feature.symbol.definition.name
    if (feature.kind === 'port') return '区域进出口'
    return `${feature.kind === 'area' ? '区域面' : '区域线'} · ${feature.terrainKind}`
  }
  const entries: RegionalMaterializationEntry[] = []
  for (const feature of result.sourceLink.inherited) {
    await checkpoint()
    const materialized = materializedSourceIds.has(feature.id), auxiliary = auxiliarySourceIds.has(feature.id)
    const incomplete = (candidateParts.get(feature.id) ?? 0) > (materializedParts.get(feature.id) ?? 0) || sourceOnlyReasons.has(feature.id)
    const status = materialized && incomplete ? 'partial' as const : materialized ? 'materialized' as const : auxiliary ? 'partial' as const : 'sourceOnly' as const
    entries.push({ sourceFeatureId: feature.id, kind: feature.kind, label: featureLabel(feature), status,
      reason: status === 'materialized' ? null : status === 'partial'
        ? [sourceOnlyReasons.get(feature.id), auxiliary && !materialized ? '只物化了辅助进出口约束。' : '仅物化了来源的一部分。'].filter(Boolean).join(' ')
        : sourceOnlyReasons.get(feature.id) ?? (feature.kind === 'line' ? '该线未产生可物化的场景路径或地形面。' : '该来源只保存在完整快照中。') })
  }
  await checkpoint()
  return { document, closure, materialization: { entries, materializedCount: entries.filter(entry => entry.status === 'materialized').length,
    partialCount: entries.filter(entry => entry.status === 'partial').length, sourceOnlyCount: entries.filter(entry => entry.status === 'sourceOnly').length } }
}

async function finishRegionalDrillDown(source: EditableProject, sourceResult: RegionalDrillDownResult, sceneBase: EditableProject, options: RegionalOptions): Promise<RegionalCandidate> {
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  checkCancelled(validation.signal)
  const yieldToEventLoop = options.yieldToEventLoop ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)))
  const materialized = await materializeInherited(sourceResult, sceneBase.document, source, validation.signal, yieldToEventLoop), document = materialized.document
  checkCancelled(validation.signal)
  const sceneCheck = validateSceneDocument(document)
  if (!sceneCheck.ok) throw new Error(`下钻实体未通过完整几何：${sceneCheck.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  const empty = captureJson(document); empty.terrainAreas = {}; empty.paths = {}; empty.entityLayers = {}; empty.generation = { ...captureJson(getLegacyGeneration(document)!), sourceLinks: {}, constraints: {} }
  const cost = assertTerrainBudget(empty, document)
  const result: RegionalDrillDownResult = { ...sourceResult, document, cost, hash: sha256Text(canonicalJson({ request: sourceResult.request, document, cost })) }
  const closure = materialized.closure
  const bindingKeys = new Set<string>(), licenseBindings = [...sceneBase.licenseBindings]
  for (const binding of licenseBindings) bindingKeys.add(`${binding.subjectKind}\0${binding.subjectId}`)
  for (const binding of closure.licenseBindings) if (!bindingKeys.has(`${binding.subjectKind}\0${binding.subjectId}`)) { licenseBindings.push(binding); bindingKeys.add(`${binding.subjectKind}\0${binding.subjectId}`) }
  const readResources = Object.freeze({ read: (hash: string) => materialized.closure.sourceHashes.has(hash) ? source.resources.read(hash) : sceneBase.resources.read(hash) })
  const projectInput: EditableProject = { ...sceneBase, schemaVersion: 3, ...createCompositionContent(document, options.runtime),
    assets: { ...sceneBase.assets, ...closure.assets }, licenses: { ...sceneBase.licenses, ...closure.licenses }, licenseBindings,
    authoringSources: { ...sceneBase.authoringSources, ...closure.authoringSources }, resources: readResources }
  const project = await validateEditableProject(projectInput, validation)
  return { kind: 'drillDown', project, document: project.document, input: result.request, result, resultHash: result.hash, cost, label: document.title, materialization: materialized.materialization }
}

/** A 1:1 independent child; the source link is evidence and never an implicit parent dependency. */
export async function prepareRegionalDrillDown(parent: EditableProject, input: RegionalDrillDownUiRequest | RegionalDrillDownRequest, options: RegionalOptions & { sceneBase: EditableProject }): Promise<RegionalCandidate> {
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  checkCancelled(validation.signal)
  const source = await validateEditableProject(captureEditableDraft(parent), validation)
  const sceneBase = await validateEditableProject(captureEditableDraft(options.sceneBase), validation)
  const request = regionalDrillDownRequestSchema.parse('kind' in input ? captureJson(input) : { kind: 'regionalDrillDown', sourceSceneId: source.document.sceneId, sceneId: options.runtime.ids.nextId(), operationId: options.runtime.ids.nextId(), ...captureJson(input) })
  const sourceResult = prepareDrillDown(source.document, request)
  return finishRegionalDrillDown(source, sourceResult, sceneBase, { ...options, validation })
}

/** Materializes an already locally replayed, explicitly scoped AI result using real source bytes. */
export async function prepareRegionalDrillDownFromResult(parent: EditableProject, rawResult: RegionalDrillDownResult, sceneBaseInput: EditableProject, options: RegionalOptions): Promise<RegionalCandidate> {
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  checkCancelled(validation.signal)
  const source = await validateEditableProject(captureEditableDraft(parent), validation)
  const sceneBase = await validateEditableProject(captureEditableDraft(sceneBaseInput), validation)
  const result = RegionSceneCandidateResultSchema.parse(captureJson(rawResult))
  const linked = getLegacyGeneration(result.document)?.sourceLinks[result.sourceLink.id]
  if (result.request.sourceSceneId !== source.document.sceneId || result.sourceLink.sourceSceneId !== source.document.sceneId
    || result.sourceLink.sourceRevision !== source.document.revision || !linked || canonicalJson(linked) !== canonicalJson(result.sourceLink)
    || result.hash !== sha256Text(canonicalJson({ request: result.request, document: result.document, cost: result.cost }))
    || !validateSceneDocument(result.document).ok) throw new Error('区域候选与本机来源或完整制品校验不符。')
  return finishRegionalDrillDown(source, result, sceneBase, { ...options, validation })
}

/** Caller must supply the actual parent; missing sources never count as a successful comparison. */
export async function compareRegionalSource(child: EditableProject, parent: EditableProject | null, options: RegionalOptions): Promise<string> {
  const source = Object.values(getLegacyGeneration(child.document)?.sourceLinks ?? {})[0]
  if (!source) throw new Error('当前工程没有区域来源。')
  if (!parent) return '本机未找到父区域地图；当前子图资源完整，可独立编辑与导出。'
  const owned = await validateEditableProject(captureEditableDraft(parent), { ...options.validation, signal: options.signal ?? options.validation.signal })
  if (owned.document.sceneId !== source.sourceSceneId) throw new Error('来源比较需要确切父图身份。')
  if (owned.document.revision === source.sourceRevision && sha256Text(canonicalJson(owned.document)) === source.sourceContentHash) return '父区域地图与下钻时的完整来源一致。'
  if (owned.document.regional && owned.document.revision === source.sourceRevision && regionalAuthorizedSubsetHash(owned.document, source) === source.sourceContentHash) return '下钻时获准的区域来源与父图一致；未授权区域内容未纳入本次比较。'
  return `父区域地图已改变（当前版本 ${owned.document.revision}，来源版本 ${source.sourceRevision}）；子图保持独立，没有自动回写。`
}
