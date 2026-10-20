import { unzlibSync } from 'fflate'
import studyLicense from '../../../assets/sceneweave-handdrawn/LICENSE.txt?raw'
import studyManifest from '../../../assets/sceneweave-handdrawn/manifest.json'
import islandLicense from '../../../assets/sceneweave-handdrawn-outdoor/LICENSE.txt?raw'
import islandManifest from '../../../assets/sceneweave-handdrawn-outdoor/manifest.json'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import { corridor, openingEndpointsV2, polygonsOverlapV2, propFootprintV2, supportedPolygon, supportSurfaceAtV2 } from '../../core/v2/geometry'
import { validateSceneV2 } from '../../core/v2/schema'
import type { BoundsMm, PointMm, PropDefinition, PropV2, SceneDocumentV2, SurfaceRef } from '../../core/v2/types'
import { validateCompleteProjectV2 } from '../../io/v2/project-file'
import { inspectImageBytes, sha256Bytes } from '../../io/v2/resources'
import type { AssetBlobRecord, CompleteProjectV2 } from '../../io/v2/types'
import { orderedPropsV2, projectSceneV2 } from '../../render/v2/projection'
import { ISLAND_CONNECTIONS, validateIslandEditsV2 } from './island-constraints'
import { createIslandDocument, ISLAND_IDS } from './island-sample'
import { STUDY_DOORWAYS, validateStudyEditsV2 } from './study-constraints'
import { createStudyDocument, STUDY_IDS } from './study-sample'

export type PerformanceSampleV2 = 'study' | 'island'
export type PerformancePropCountV2 = 500 | 2000
export type PerformanceAssetFetcherV2 = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'arrayBuffer'>>
export interface AssetAlphaStatisticsV2 {
  sha256: string; file: string; kind: 'material' | 'prop'; width: number; height: number; encodedBytes: number
  zeroAlphaPixels: number; partialAlphaPixels: number; opaquePixels: number; alphaWeightedPixels: number
}
export interface PerformanceFixtureSummaryV2 {
  fixtureVersion: 'b5-real-assets-v1'; sample: PerformanceSampleV2; propCount: PerformancePropCountV2
  originalPropCount: number; addedPropCount: number; worldBoundsMm: BoundsMm
  assetReferenceCount: number; uniqueImageCount: number; uniqueImagePixels: number; uniqueImageEncodedBytes: number
  materialDefinitionCount: number; propDefinitionCount: number; prefabDefinitionCount: number; prefabInstanceCount: number; scatterGroupCount: number
  originalScatterMemberCount: number; propInstanceCountsByCatalogId: Record<string, number>; renderLayerCounts: Record<string, number>
  /** Audience admission and geometric inclusion are not post-occlusion visible pixels. */
  projectedPropCounts: { gm: number; player: number }; propsWhollyInsideExport: number; projectedAssetCounts: { gm: number; player: number }
  projectedUniqueImagePixels: { gm: number; player: number }; postOcclusionVisiblePropCount: null
  editablePropId: string; selectionPointMm: PointMm
  contourEditTarget: { kind: 'vertex'; id: string; positionMm: PointMm } | { kind: 'terrainPoint'; areaId: string; pointId: string; positionMm: PointMm }
  alphaStatistics: AssetAlphaStatisticsV2[]
  transparency: {
    /** Instance sums count overlaps repeatedly, retain default size/rotation/opacity, and exclude decorative shadows. */
    instanceVisualRectangleAreaMm2: number; instanceZeroAlphaAreaMm2: number; instancePartialAlphaAreaMm2: number; instanceAlphaWeightedAreaMm2: number
    visualRectangleAreaToExportRatio: number
    /** Cell centres sample rotated image rectangles, ignore source alpha, and are not final opaque or visible coverage. */
    rectangleGrid: { columns: number; rows: number; unionFraction: number; multipleCoverageFraction: number; maximumRectanglesAtCell: number }
  }
  limitations: string[]
}

const stamp = '2026-10-20T00:00:00.000Z'
const fixtureVersion = 'b5-real-assets-v1' as const
const palette = {
  study: ['book-stack', 'papers', 'envelope', 'lamp-table', 'book-stack', 'papers', 'envelope', 'flowerpot', 'chair-worn', 'lamp-table'],
  island: ['rock-small', 'rock-small-worn', 'shrub-round', 'rock-small', 'shrub-dry', 'rock-small-worn'],
} as const
const rectPolygon = (bounds: BoundsMm): PointMm[] => [
  { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
]
function visualPolygon(prop: PropV2): PointMm[] {
  const angle = prop.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  return rectPolygon(prop.visualBoundsMm).map(point => ({ x: prop.positionMm.x + point.x * cos - point.y * sin, y: prop.positionMm.y + point.x * sin + point.y * cos }))
}
const insideBounds = (polygon: PointMm[], bounds: BoundsMm) => polygon.every(point => point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height)
function halton(index: number, base: number): number {
  let result = 0, scale = 1
  while (index > 0) { scale /= base; result += scale * (index % base); index = Math.floor(index / base) }
  return result
}
function definitionByKey(document: SceneDocumentV2, key: string): PropDefinition {
  const definition = Object.values(document.propDefinitions).find(item => item.catalogId === `prop.sw.${key}`)
  if (!definition) throw new Error(`B5 负载缺少原样板组件定义：${key}`)
  return definition
}
function propFromDefinition(document: SceneDocumentV2, definition: PropDefinition, id: string, positionMm: PointMm, supportRef: SurfaceRef, rotationDeg: number, renderOrder = 0): PropV2 {
  return { id, floorId: Object.keys(document.floors)[0], editLocked: false, visibility: 'public',
    definitionRef: { id: definition.id, version: definition.version }, appearance: structuredClone(definition.defaultAppearance),
    visualBoundsMm: { ...definition.defaultVisualBoundsMm }, positionMm, rotationDeg,
    footprintMm: { ...definition.defaultFootprintMm }, footprintOffsetMm: { ...definition.defaultFootprintOffsetMm },
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight,
    supportRef, ...(supportRef.kind === 'room' ? { roomId: supportRef.id } : {}), renderLayer: definition.defaultRenderLayer,
    renderOrder, shadowClass: definition.defaultShadowClass, shadowOverride: null }
}
function reservedPassages(document: SceneDocumentV2, sample: PerformanceSampleV2): PointMm[][] {
  if (sample === 'study') return STUDY_DOORWAYS.map(fixture => corridor(...openingEndpointsV2(document, document.openings[fixture.openingId]), fixture.approachDepthMm * 2))
  return ISLAND_CONNECTIONS.map(fixture => {
    const connection = document.terrainConnections[fixture.connectionId], a = connection.from.positionMm, b = connection.to.positionMm
    const length = Math.hypot(b.x - a.x, b.y - a.y), dx = (b.x - a.x) / length * fixture.approachDepthMm, dy = (b.y - a.y) / length * fixture.approachDepthMm
    return corridor({ x: a.x - dx, y: a.y - dy }, { x: b.x + dx, y: b.y + dy }, connection.widthMm)
  })
}
/** Deterministic dense measurement copy. Original instances, definitions, groups, physics and passages are retained. */
export function createPerformanceDocumentV2(sample: PerformanceSampleV2, count: PerformancePropCountV2): SceneDocumentV2 {
  if (!['study', 'island'].includes(sample) || ![500, 2000].includes(count)) throw new Error('B5 负载只接受 study/island 与 500/2000 个物件。')
  const options = { sceneId: `b5-${sample}-${count}`, now: stamp }
  const document = sample === 'study' ? createStudyDocument(options) : createIslandDocument(options)
  document.title = `${document.title} · B5 ${count} 物件测量副本`
  const markerPosition = sample === 'study' ? { x: 7800, y: 1700 } : { x: 6500, y: 15000 }
  const markerSupport: SurfaceRef = sample === 'study' ? { kind: 'room', id: STUDY_IDS.room } : { kind: 'terrainArea', id: ISLAND_IDS.low }
  const marker = propFromDefinition(document, definitionByKey(document, sample === 'study' ? 'envelope' : 'rock-small'), `b5-${sample}-editable`, markerPosition, markerSupport, 0, 10000)
  const exclusions = [...reservedPassages(document, sample), rectPolygon({ x: markerPosition.x - 1100, y: markerPosition.y - 1100, width: 2200, height: 2200 })]
  const originalCount = Object.keys(document.props).length
  let added = 0, attempt = 1
  while (originalCount + added + 1 < count) {
    if (attempt > count * 100) throw new Error('B5 确定性候选空间不足；不得以离屏、隐藏或无支撑物件补数。')
    const definition = definitionByKey(document, palette[sample][added % palette[sample].length])
    const terrace = sample === 'study' && added % 5 === 4
    const box = sample === 'island' ? { x: 4000, y: 4500, width: 20000, height: 19000 }
      : terrace ? { x: 9700, y: 3000, width: 2700, height: 3400 } : { x: 1600, y: 1700, width: 6500, height: 4700 }
    const positionMm = { x: Math.round(box.x + halton(attempt, 2) * box.width), y: Math.round(box.y + halton(attempt, 3) * box.height) }
    const rotationDeg = (attempt * 137) % 360
    attempt++
    const supportRef: SurfaceRef | null = sample === 'study' ? { kind: terrace ? 'terrainArea' : 'room', id: terrace ? STUDY_IDS.terrace : STUDY_IDS.room }
      : supportSurfaceAtV2(document, positionMm, marker.floorId)
    if (!supportRef || sample === 'island' && supportRef.id === ISLAND_IDS.water) continue
    const prop = propFromDefinition(document, definition, `b5-${sample}-${String(added + 1).padStart(4, '0')}`, positionMm, supportRef, rotationDeg)
    const visual = visualPolygon(prop)
    if (!insideBounds(visual, document.exportBoundsMm) || !supportedPolygon(document, propFootprintV2(prop), supportRef, prop.floorId)
      || exclusions.some(exclusion => polygonsOverlapV2(visual, exclusion))) continue
    document.props[prop.id] = prop; added++
  }
  document.props[marker.id] = marker
  const checked = validateSceneV2(document)
  if (!checked.ok) throw new Error(`B5 负载严格校验失败：${checked.errors.map(issue => `${issue.code}: ${issue.entityId ?? ''} ${issue.message}`).join('；')}`)
  validateStudyEditsV2(checked.document); validateIslandEditsV2(checked.document)
  return checked.document
}

/** This fixture-only audit supports the authored static 8-bit, non-interlaced RGBA PNGs; it is not an import decoder. */
function alphaStatistics(bytes: Uint8Array, file: string, kind: 'material' | 'prop'): Omit<AssetAlphaStatisticsV2, 'sha256'> {
  const header = inspectImageBytes(bytes), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (header.mimeType !== 'image/png' || bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) throw new Error(`B5 alpha 审计仅接受原素材非交错 8-bit RGBA PNG：${file}`)
  const parts: Uint8Array[] = []
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'IDAT') parts.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const compressed = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let cursor = 0
  for (const part of parts) { compressed.set(part, cursor); cursor += part.length }
  const raw = unzlibSync(compressed), stride = header.width * 4
  if (raw.length !== (stride + 1) * header.height) throw new Error(`B5 alpha 审计行长度错误：${file}`)
  let prior = new Uint8Array(stride), zeroAlphaPixels = 0, partialAlphaPixels = 0, opaquePixels = 0, alphaSum = 0
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
  for (let y = 0; y < header.height; y++) {
    const row = new Uint8Array(stride), filter = raw[y * (stride + 1)]
    if (filter > 4) throw new Error(`B5 alpha 审计 PNG filter 错误：${file}`)
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0, up = prior[x], upLeft = x >= 4 ? prior[x - 4] : 0
      row[x] = raw[y * (stride + 1) + 1 + x] + (filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upLeft))
      if (x % 4 === 3) { const alpha = row[x]; alphaSum += alpha; if (alpha === 0) zeroAlphaPixels++; else if (alpha === 255) opaquePixels++; else partialAlphaPixels++ }
    }
    prior = row
  }
  return { file, kind, width: header.width, height: header.height, encodedBytes: bytes.length, zeroAlphaPixels, partialAlphaPixels, opaquePixels, alphaWeightedPixels: alphaSum / 255 }
}

function rectangleGrid(document: SceneDocumentV2): PerformanceFixtureSummaryV2['transparency']['rectangleGrid'] {
  const bounds = document.exportBoundsMm, columns = 128, rows = Math.ceil(columns * bounds.height / bounds.width), cells = new Uint16Array(columns * rows)
  const cellWidth = bounds.width / columns, cellHeight = bounds.height / rows
  for (const prop of Object.values(document.props)) {
    const visual = visualPolygon(prop), minColumn = Math.max(0, Math.floor((Math.min(...visual.map(point => point.x)) - bounds.x) / cellWidth)), maxColumn = Math.min(columns - 1, Math.floor((Math.max(...visual.map(point => point.x)) - bounds.x) / cellWidth))
    const minRow = Math.max(0, Math.floor((Math.min(...visual.map(point => point.y)) - bounds.y) / cellHeight)), maxRow = Math.min(rows - 1, Math.floor((Math.max(...visual.map(point => point.y)) - bounds.y) / cellHeight))
    const angle = -prop.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), v = prop.visualBoundsMm
    for (let y = minRow; y <= maxRow; y++) for (let x = minColumn; x <= maxColumn; x++) {
      const dx = bounds.x + (x + .5) * cellWidth - prop.positionMm.x, dy = bounds.y + (y + .5) * cellHeight - prop.positionMm.y
      const localX = dx * cos - dy * sin, localY = dx * sin + dy * cos
      if (localX >= v.x && localX <= v.x + v.width && localY >= v.y && localY <= v.y + v.height) cells[y * columns + x]++
    }
  }
  let union = 0, multiple = 0, maximum = 0
  for (const count of cells) { if (count > 0) union++; if (count > 1) multiple++; maximum = Math.max(maximum, count) }
  return { columns, rows, unionFraction: union / cells.length, multipleCoverageFraction: multiple / cells.length, maximumRectanglesAtCell: maximum }
}

function summarize(project: CompleteProjectV2, sample: PerformanceSampleV2, count: PerformancePropCountV2, alpha: AssetAlphaStatisticsV2[]): PerformanceFixtureSummaryV2 {
  const document = project.document, props = Object.values(document.props), marker = document.props[`b5-${sample}-editable`]
  const alphaByHash = new Map(alpha.map(value => [value.sha256, value])), byCatalog: Record<string, number> = {}, renderLayers: Record<string, number> = {}
  let rectangleArea = 0, zeroArea = 0, partialArea = 0, alphaArea = 0
  for (const prop of props) {
    const key = prop.definitionRef ? document.propDefinitions[prop.definitionRef.id].catalogId : 'no-definition'
    byCatalog[key] = (byCatalog[key] ?? 0) + 1; renderLayers[prop.renderLayer] = (renderLayers[prop.renderLayer] ?? 0) + 1
    if (prop.appearance.kind !== 'image') continue
    const statistics = alphaByHash.get(document.assets[prop.appearance.assetId].sha256)!, area = prop.visualBoundsMm.width * prop.visualBoundsMm.height, pixels = statistics.width * statistics.height
    rectangleArea += area; zeroArea += area * statistics.zeroAlphaPixels / pixels; partialArea += area * statistics.partialAlphaPixels / pixels
    alphaArea += area * statistics.alphaWeightedPixels / pixels * prop.appearance.opacity
  }
  const gm = projectSceneV2(document, 'gm'), player = projectSceneV2(document, 'player')
  const projectedPixels = (assetIds: string[]) => [...new Set(assetIds.map(id => document.assets[id].sha256))].reduce((sum, sha) => sum + project.assets[sha].pixelWidth * project.assets[sha].pixelHeight, 0)
  const originalPropCount = sample === 'study' ? 13 : 39
  // A high object render order and reserved empty neighbourhood make the marker an actual workbench hit-test target.
  const lastAtMarker = orderedPropsV2(props).filter(prop => {
    const angle = -prop.rotationDeg * Math.PI / 180, dx = marker.positionMm.x - prop.positionMm.x, dy = marker.positionMm.y - prop.positionMm.y
    const x = dx * Math.cos(angle) - dy * Math.sin(angle), y = dx * Math.sin(angle) + dy * Math.cos(angle), bounds = prop.visualBoundsMm
    return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  }).at(-1)
  if (lastAtMarker?.id !== marker.id) throw new Error('B5 选择点被其他渲染层遮盖。')
  return { fixtureVersion, sample, propCount: count, originalPropCount, addedPropCount: props.length - originalPropCount,
    worldBoundsMm: { ...document.exportBoundsMm }, assetReferenceCount: Object.keys(document.assets).length,
    uniqueImageCount: Object.keys(project.assets).length, uniqueImagePixels: Object.values(project.assets).reduce((sum, asset) => sum + asset.pixelWidth * asset.pixelHeight, 0),
    uniqueImageEncodedBytes: Object.values(project.assets).reduce((sum, asset) => sum + asset.sizeBytes, 0),
    materialDefinitionCount: Object.keys(document.materials).length, propDefinitionCount: Object.keys(document.propDefinitions).length,
    prefabDefinitionCount: Object.keys(document.prefabDefinitions).length, prefabInstanceCount: Object.keys(document.prefabInstances).length,
    scatterGroupCount: Object.keys(document.scatterGroups).length, originalScatterMemberCount: Object.values(document.scatterGroups).reduce((sum, group) => sum + Object.values(group.members).filter(member => member.propId !== null).length, 0),
    propInstanceCountsByCatalogId: byCatalog, renderLayerCounts: renderLayers,
    projectedPropCounts: { gm: gm.props.length, player: player.props.length }, propsWhollyInsideExport: props.filter(prop => insideBounds(visualPolygon(prop), document.exportBoundsMm)).length,
    projectedAssetCounts: { gm: gm.assetIds.length, player: player.assetIds.length }, projectedUniqueImagePixels: { gm: projectedPixels(gm.assetIds), player: projectedPixels(player.assetIds) }, postOcclusionVisiblePropCount: null,
    editablePropId: marker.id, selectionPointMm: { ...marker.positionMm },
    contourEditTarget: sample === 'study' ? { kind: 'vertex', id: 'study-v0', positionMm: { x: document.vertices['study-v0'].xMm, y: document.vertices['study-v0'].yMm } }
      : { kind: 'terrainPoint', areaId: ISLAND_IDS.low, pointId: `${ISLAND_IDS.low}-v0`, positionMm: { ...document.terrainAreas[ISLAND_IDS.low].boundaryMm[0].positionMm } },
    alphaStatistics: alpha, transparency: { instanceVisualRectangleAreaMm2: rectangleArea, instanceZeroAlphaAreaMm2: zeroArea, instancePartialAlphaAreaMm2: partialArea,
      instanceAlphaWeightedAreaMm2: alphaArea, visualRectangleAreaToExportRatio: rectangleArea / (document.exportBoundsMm.width * document.exportBoundsMm.height), rectangleGrid: rectangleGrid(document) },
    limitations: ['高密度测量副本有大量真实尺寸物件相互覆盖，不是可玩地图布局或美术验收。',
      'projectedPropCounts 是受众投影纳入数，propsWhollyInsideExport 是几何范围数；遮挡后的实际可见物件数未测。',
      '源 PNG alpha 计数为实际文件像素；实例 alpha 面积按图像矩形缩放且重复计入交叠，不含阴影与合成后的可见覆盖。',
      'rectangleGrid 以网格中心抽样旋转图像矩形，忽略源 alpha；不是精确并集，也不是内存或资源峰值。',
      '保留原样板公开性；普通样板没有新增 GM 秘密，秘密差分回归另用 B4 配对夹具。'] }
}

/** Creates a complete, independently validated real-art workload; fetch URLs never enter its saved document. */
export async function createPerformanceFixtureV2(sample: PerformanceSampleV2, count: PerformancePropCountV2, fetcher: PerformanceAssetFetcherV2 = fetch, signal?: AbortSignal): Promise<{ project: CompleteProjectV2; summary: PerformanceFixtureSummaryV2 }> {
  signal?.throwIfAborted()
  const document = createPerformanceDocumentV2(sample, count), source = sample === 'study' ? studyManifest : islandManifest
  const directory = sample === 'study' ? 'sceneweave-handdrawn' : 'sceneweave-handdrawn-outdoor', licenseText = sample === 'study' ? studyLicense : islandLicense
  const assets: Record<string, AssetBlobRecord> = {}, alpha: AssetAlphaStatisticsV2[] = []
  for (const entry of source.assets) {
    signal?.throwIfAborted()
    const response = await fetcher(`${import.meta.env.BASE_URL}assets/${directory}/${entry.file}`, { signal })
    if (!response.ok) throw new Error(`B5 原创素材读取失败：${entry.file} (${response.status})`)
    const buffer = await response.arrayBuffer(), bytes = new Uint8Array(buffer), blob = new Blob([buffer], { type: 'image/png' })
    assets[entry.sha256] = { sha256: entry.sha256, blob, mimeType: 'image/png', sizeBytes: entry.sizeBytes, pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight }
    alpha.push({ sha256: entry.sha256, ...alphaStatistics(bytes, entry.file, entry.kind as 'material' | 'prop') })
  }
  const licenseHash = await sha256Bytes(new TextEncoder().encode(licenseText))
  const project: CompleteProjectV2 = { document, assets, licenses: { [licenseHash]: { sha256: licenseHash, text: licenseText } },
    licenseBindings: collectDependenciesV2(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })) }
  await validateCompleteProjectV2(project, { signal }); signal?.throwIfAborted()
  return { project, summary: summarize(project, sample, count, alpha) }
}
