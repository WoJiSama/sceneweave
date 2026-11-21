import type { EditableProject } from '../../../application/workspace/project.js'
import { toBundle } from '../../../application/workspace/project.js'
import { prepareLibraryEntries } from '../../../shared/library/content.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { PropGlow, PropTemplate, SceneDocument, VersionRef } from '../../../shared/model/scene.js'
import { DEFAULT_BRIDGE_STRUCTURE, DEFAULT_FIXTURE_GLOW, type PathStyleDefaults } from '../../../shared/path-assembly/contracts.js'
import { profilePathSection, propDefinitionSection } from '../../../shared/path-assembly/layout.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { INDUSTRIAL_ART } from '../../../shared/visual/industrial-art.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { runtime, validation } from '../runtime.js'
import { materializeVisualArtBatches } from './visual-art-project.js'

const origin = { kind: 'original' as const, attribution: 'Sceneweave original industrial cyberpunk artwork, v1', canEmbed: true }
const licenseRef = 'MIT-Sceneweave-Industrial-1'
const licenseText = `Sceneweave Industrial Cyberpunk Artwork, version 1
Copyright (c) 2026 Sceneweave contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const assetId = (key: string) => `industrial-cyberpunk-art-${key}-v1`
const lampGlows: Readonly<Record<string, PropGlow>> = {
  'pole-lamp': { anchor: { u: 122 / 180, v: 32 / 112 }, color: '#FFD081', radiusMm: 2020, intensity: .65 },
  'cyan-tube': { anchor: { u: .50, v: .50 }, color: '#47FFD0', radiusMm: 1330, intensity: .43 },
  'pink-tube': { anchor: { u: .50, v: .50 }, color: '#FF79BD', radiusMm: 1580, intensity: .51 },
  'coolant-tank': { anchor: { u: .50, v: .50 }, color: '#4EDCB6', radiusMm: 1960, intensity: .34 },
}
/** Keep artwork bytes and existing fixed IDs available in already saved projects. */
export function industrialDefinitionRef(kind: 'prop' | 'material' | 'prefab', key: string): VersionRef {
  const hasNewVersion = kind === 'prop' && Object.hasOwn(lampGlows, key)
    || kind === 'prefab' && ['ember-bridge', 'ion-bridge', 'cable-run', 'pump-bank'].includes(key)
  const version = hasNewVersion ? 2 : 1
  return { id: `industrial-cyberpunk-${kind}-${key}-v${version}`, version }
}
const member = (scene: SceneDocument, key: string, x: number, y: number, rotationDeg = 0): PropTemplate => ({
  ...propDefinitionSection(scene.propDefinitions[industrialDefinitionRef('prop', key).id]), positionMm: { x, y }, rotationDeg,
})

function createIndustrialCatalogDocument(): SceneDocument {
  const floorId = 'industrial-catalog-floor', layerId = 'industrial-catalog-layer', now = runtime.clock.now()
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  const scene = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1,
    sceneId: runtime.ids.nextId(), revision: 0, title: '工业赛博朋克 · 构件库', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { [floorId]: { id: floorId, name: '工业构件库', boundsMm: bounds } },
    userLayers: { [layerId]: { id: layerId, floorId, name: '工业构件', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'industrial-cyberpunk-catalog', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] }, visual: emptyVisualSystem() })
  function identity(kind: 'material' | 'prop' | 'prefab', key: string, name: string, tags: string[]) {
    return { ...industrialDefinitionRef(kind, key), catalogId: `${kind}.sceneweave.industrial-cyberpunk.${key}`,
      name, tags, origin: { ...origin }, licenseRef }
  }
  for (const art of INDUSTRIAL_ART) {
    const image = assetId(art.key), size = { width: art.widthMm, height: art.heightMm }
    scene.assets[image] = { id: image, sha256: '0'.repeat(64), pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: size, mimeType: 'image/png', origin: { ...origin }, licenseRef }
    const item = identity(art.kind, art.key, art.name, [...(art.tags ?? [])])
    if (art.kind === 'material') scene.materials[item.id] = { ...item, textureAssetId: image,
      defaultTileSizeMm: size, applicableSurfaces: ['path', 'terrain', 'room', 'wall'] }
    else scene.propDefinitions[item.id] = { ...item, defaultAppearance: { kind: 'image', assetId: image, tint: null, opacity: 1,
      ...(Object.hasOwn(lampGlows, art.key) && { glow: cloneJson(lampGlows[art.key]) }) },
      defaultVisualBoundsMm: { x: -Math.floor(size.width / 2), y: -Math.floor(size.height / 2), ...size },
      defaultFootprintMm: { ...art.footprintMm! }, defaultFootprintOffsetMm: { x: 0, y: 0 },
      defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!,
      defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
  }
  function style(key: string, name: string, section: PropTemplate, defaults: PathStyleDefaults) {
    const item = identity('prefab', key, name, ['工业赛博朋克', '沿线样式'])
    scene.prefabDefinitions[item.id] = { ...item, pathStyle: cloneJson(defaults),
      members: [{ key: 'body', propTemplate: section }] }
  }
  const lamps = { every: 2, ref: industrialDefinitionRef('prop', 'pole-lamp'), glow: { ...DEFAULT_FIXTURE_GLOW } }
  style('ember-bridge', '琥珀铆接边梁', member(scene, 'amber-guard', 0, 0), {
    lengthMm: 2400, fit: true, lamps, dimensions: { visualWidthMm: 460, footprintWidthMm: 280 }, structure: DEFAULT_BRIDGE_STRUCTURE,
  })
  style('ion-bridge', '青绿合金边梁', member(scene, 'cyan-guard', 0, 0), {
    lengthMm: 2400, fit: true, lamps, dimensions: { visualWidthMm: 540, footprintWidthMm: 300 },
    structure: { ...DEFAULT_BRIDGE_STRUCTURE, palette: 'alloy', support: { ...DEFAULT_BRIDGE_STRUCTURE.support, spacingMm: 4200 } },
  })
  style('service-fence', '带铆柱检修围栏', member(scene, 'mesh-fence', 0, 0), {
    lengthMm: 2400, fit: true, dimensions: { visualWidthMm: 420, footprintWidthMm: 220 },
  })
  style('cable-run', '双道冷却管沿线铺设', profilePathSection('coolantPipe', 3400),
    { lengthMm: 3400, fit: true, dimensions: { visualWidthMm: 980, footprintWidthMm: 420 } })
  const pump = identity('prefab', 'pump-bank', '冷却与整流设备组', ['工业赛博朋克', '设备', '可拆组合'])
  scene.prefabDefinitions[pump.id] = { ...pump, members: [
    { key: 'tank', propTemplate: member(scene, 'coolant-tank', -1600, 0) },
    { key: 'switch', propTemplate: member(scene, 'transformer', 1700, 0) },
    { key: 'pipe', propTemplate: member(scene, 'pipe-straight', 0, 1500) },
  ] }
  return scene
}

export function createIndustrialCatalogProject(signal?: AbortSignal): Promise<EditableProject> {
  const large = INDUSTRIAL_ART.filter(art => Math.max(art.widthMm, art.heightMm) >= 7000)
  return materializeVisualArtBatches(createIndustrialCatalogDocument(), [
    { artwork: INDUSTRIAL_ART.filter(art => !large.includes(art)), licenseText, assetId, rasterLongEdgePx: 1024 },
    { artwork: large, licenseText, assetId, rasterLongEdgePx: 2048 },
  ], signal)
}

export async function prepareIndustrialCatalog(signal?: AbortSignal) {
  const source = await createIndustrialCatalogProject(signal)
  const definitionLists = [source.document.materials, source.document.propDefinitions, source.document.prefabDefinitions] as const
  const kinds = ['material', 'prop', 'prefab'] as const
  const selectors = definitionLists.flatMap((definitions, index) => Object.keys(definitions).map(definitionId => ({ kind: kinds[index], definitionId })))
  return prepareLibraryEntries(toBundle(source), selectors, { ...validation, signal })
}
