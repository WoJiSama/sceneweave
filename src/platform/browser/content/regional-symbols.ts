import type { EditableProject } from '../../../application/workspace/project.js'
import { fromBundle } from '../../../application/workspace/project.js'
import type { AssetRecord, ProjectData, SvgAuthoringSource } from '../../../shared/model/project.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { inspectDependencies } from '../../../shared/commands/dependencies.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { createEmptyGeneration, createEmptyRegional } from '../../../shared/terrain-generation/contracts.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { rasterizeNormalizedSvg } from '../ai/svg-raster.js'
import { runtime, validation } from '../runtime.js'

export const REGIONAL_SYMBOL_LICENSE_REF = 'sceneweave-original-regional-symbols-1'
export const REGIONAL_SYMBOL_LICENSE = 'Sceneweave Original Regional Symbols v1\nCopyright 2026 Sceneweave contributors.\nThese three SVG artworks were created for Sceneweave without third-party image content. Permission is granted to use, copy, modify, embed and redistribute these artworks, their normalized SVG sources and raster derivatives, with or without attribution, for any purpose. No warranty is provided.'
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${body}</svg>`
export const REGIONAL_SYMBOL_ART = [
  { key: 'woodland', name: '林丛图符', sourceSvg: svg('<path d="M26 111V79M62 113V69M99 112V81" stroke="#6B533B" stroke-width="7" stroke-linecap="round"/><path d="M7 82L26 35L46 82ZM37 79L62 15L88 79ZM81 86L100 39L120 86Z" fill="#637F5D" stroke="#354C3C" stroke-width="4" stroke-linejoin="round"/><path d="M15 74L26 48M48 67L62 31M91 76L100 52" stroke="#AAB67B" stroke-width="3" stroke-linecap="round"/><path d="M9 115Q61 105 119 116" fill="none" stroke="#687650" stroke-width="3"/>') },
  { key: 'ridge', name: '山岭图符', sourceSvg: svg('<path d="M6 111L41 38L61 72L83 19L123 111Z" fill="#A39779" stroke="#5B5949" stroke-width="4" stroke-linejoin="round"/><path d="M41 38L48 81L34 102M83 19L90 73L75 108" fill="none" stroke="#746F58" stroke-width="4"/><path d="M30 61L41 38L51 56L46 59L40 53L35 64ZM72 44L83 19L96 47L89 42L83 34L78 46Z" fill="#E3D9B8"/><path d="M16 105L26 86M102 88L112 106" stroke="#D0C3A0" stroke-width="3" stroke-linecap="round"/>') },
  { key: 'landmark', name: '古迹图符', sourceSvg: svg('<path d="M23 111V57H106V111Z" fill="#B2A17A" stroke="#5D5846" stroke-width="4"/><path d="M17 57L64 25L112 57Z" fill="#82765C" stroke="#4E4D40" stroke-width="4" stroke-linejoin="round"/><path d="M50 111V77Q64 64 78 77V111M34 66V100M93 66V100" fill="#5A5E4C" stroke="#5D5846" stroke-width="3"/><path d="M16 116H114M28 49L47 36" stroke="#D1C49C" stroke-width="4" stroke-linecap="round"/>') },
] as const
export const REGIONAL_SYMBOL_IDS = Object.fromEntries(REGIONAL_SYMBOL_ART.map(art => [art.key, `regional-symbol-${art.key}-v1`])) as Record<typeof REGIONAL_SYMBOL_ART[number]['key'], string>

/** New regional-only source palette. Returns actual SVG, normalized SVG and PNG bytes. */
export async function createRegionalBlankProject(options: { sceneId?: string; title?: string; now?: string } = {}, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const now = options.now ?? runtime.clock.now(), bounds = { x: 0, y: 0, width: 10_000_000, height: 8_000_000 }
  const document: SceneDocument = { format: 'sceneweave-scene', schemaVersion: 3, sceneId: options.sceneId ?? runtime.ids.nextId(), revision: 0, title: options.title ?? '区域地图', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 100_000, snapMm: 1000, gridVisible: false }, exportBoundsMm: bounds, floors: { 'regional-floor': { id: 'regional-floor', name: '区域地貌', boundsMm: { ...bounds } } },
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { 'regional-layer': { id: 'regional-layer', floorId: 'regional-floor', name: '区域地貌与图符', order: 0, editLocked: false } }, entityLayers: {}, presetSnapshot: { presetId: 'regional-cartographic-v1', presetVersion: 1, distanceMode: 'abstract', source: 'Sceneweave original regional cartography', gridSizeMm: 100_000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] },
    mapMode: 'regional', generation: createEmptyGeneration(), regional: createEmptyRegional(), visual: { version: 2, base: emptyVisualSystem(), materializedEdges: {} } }
  const resources = new Map<string, Uint8Array>(), assets: Record<string, AssetRecord> = {}, authoringSources: Record<string, SvgAuthoringSource> = {}
  for (const art of REGIONAL_SYMBOL_ART) {
    signal?.throwIfAborted()
    const normalized = normalizeStaticSvg(art.sourceSvg), raster = await rasterizeNormalizedSvg(normalized, { longEdgePx: 256, signal }), assetId = `regional-art-${art.key}-v1`, definitionId = REGIONAL_SYMBOL_IDS[art.key]
    const origin = { kind: 'original' as const, attribution: 'Sceneweave original regional symbols v1', canEmbed: true }
    document.assets[assetId] = { id: assetId, sha256: raster.sha256, mimeType: raster.mimeType, pixelWidth: raster.pixelWidth, pixelHeight: raster.pixelHeight, logicalSizeMm: { width: 120_000, height: 120_000 }, licenseRef: REGIONAL_SYMBOL_LICENSE_REF, origin }
    document.regional!.symbolDefinitions[definitionId] = { id: definitionId, catalogId: `sceneweave.regional.${art.key}`, version: 1, name: art.name, assetId, licenseRef: REGIONAL_SYMBOL_LICENSE_REF, origin, visualBoundsMm: { x: -60_000, y: -112_000, width: 120_000, height: 120_000 }, rootAnchorMm: { x: 0, y: 0 }, orientation: 'upright' }
    assets[raster.sha256] = { sha256: raster.sha256, mimeType: raster.mimeType, sizeBytes: raster.pngBytes.length, pixelWidth: raster.pixelWidth, pixelHeight: raster.pixelHeight }
    authoringSources[assetId] = { kind: 'svg', sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256, sourceSizeBytes: normalized.sourceSizeBytes, normalizedSizeBytes: normalized.normalizedSizeBytes, rasterSha256: raster.sha256, processorId: raster.processorId, processorVersion: raster.processorVersion }
    resources.set(raster.sha256, raster.pngBytes); resources.set(normalized.sourceSha256, encodeUtf8(normalized.sourceSvg)); resources.set(normalized.normalizedSha256, encodeUtf8(normalized.normalizedSource))
  }
  const content = createCompositionContent(document, runtime), licenseHash = sha256Bytes(encodeUtf8(REGIONAL_SYMBOL_LICENSE))
  const project: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 3, ...content, assets, licenses: { [licenseHash]: { sha256: licenseHash, text: REGIONAL_SYMBOL_LICENSE } }, licenseBindings: inspectDependencies(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })), authoringSources }
  return fromBundle({ project, resources: createMemoryResources(resources) }, { ...validation, signal })
}
