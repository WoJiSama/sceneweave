import { visualBase } from '../../../shared/visual/base.js'
import type { PointMm, Prop, SceneDocument, SurfaceOverlay, SurfaceStyle, TerrainArea } from '../../../shared/model/scene.js'
import type { CubicSegment, VisualBoundary } from '../../../shared/visual/types.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import { REFINED_COAST_ART, REFINED_COAST_LICENSE } from '../../../shared/visual/coast-art.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import type { EditableProject } from '../../../application/workspace/project.js'
import { createVisualBlankDocument } from './visual-samples.js'
import { materializeVisualArt } from './visual-art-project.js'
import { runtime } from '../runtime.js'

export const REFINED_COAST_NAME = '潮痕浅湾 · 精修版'
const FLOOR = 'visual-floor', GROUND = 'visual-layer-ground', DETAILS = 'visual-layer-details', PROPS = 'visual-layer-props', EFFECTS = 'visual-layer-effects'
const point = (x: number, y: number): PointMm => ({ x, y })
const assetId = (key: string) => `refined-art-${key}`
const materialId = (key: string) => `refined-material-coast-material-${key}`
const definitionId = (key: string) => `refined-prop-coast-${key}`
const ref = (id: string) => ({ id, version: 1 })
const original = { kind: 'original' as const, attribution: 'Sceneweave Q2原创海岸与独立固定素材第1版；保留SVG/实际PNG/确切MIT许可；未嵌入参考图片', canEmbed: true }
const entity = (id: string, layerId = DETAILS) => ({ id, floorId: FLOOR, layerId, visibility: 'public' as const, editLocked: false })
function paint(scene: SceneDocument, key: string): SurfaceStyle {
  const id = materialId(key)
  return { base: { materialRef: ref(id), tileSizeMm: { ...scene.materials[id].defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: point(0, 0), tint: null, opacity: 1 }, overlays: [] }
}
function terrain(scene: SceneDocument, id: string, points: PointMm[], key: string, blocked = false): TerrainArea {
  const area: TerrainArea = { id, floorId: FLOOR, editLocked: false, visibility: 'public', boundaryMm: points.map((positionMm, i) => ({ id: `${id}-p-${i}`, segmentId: `${id}-s-${i}`, positionMm: { ...positionMm } })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: paint(scene, key), blocksMovement: blocked, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainAreas[id] = area; scene.entityLayers[id] = GROUND; return area
}
function overlay(scene: SceneDocument, area: TerrainArea, id: string, key: string, points: PointMm[], blendWidthMm: number, opacity = 1): void {
  const value: SurfaceOverlay = { id, boundaryMm: points, paint: { ...paint(scene, key).base, opacity }, blendWidthMm, renderOrder: area.surfaceStyle!.overlays.length }
  area.surfaceStyle!.overlays.push(value)
}
function place(scene: SceneDocument, key: string, x: number, y: number, rotationDeg: number, supportId: string, scale = 1): void {
  const definition = scene.propDefinitions[definitionId(key)], id = `q2-coast-${key}-${Object.keys(scene.props).length + 1}`
  const v = definition.defaultVisualBoundsMm, f = definition.defaultFootprintMm
  const value: Prop = { id, floorId: FLOOR, editLocked: false, visibility: 'public', definitionRef: ref(definition.id), appearance: { ...definition.defaultAppearance }, positionMm: point(x, y), rotationDeg,
    visualBoundsMm: { x: Math.round(v.x * scale), y: Math.round(v.y * scale), width: Math.round(v.width * scale), height: Math.round(v.height * scale) },
    footprintMm: { width: Math.round(f.width * scale), height: Math.round(f.height * scale) }, footprintOffsetMm: point(0, 0), blocksMovement: definition.defaultBlocksMovement, blocksSight: false,
    supportRef: { kind: 'terrainArea', id: supportId }, renderLayer: definition.defaultRenderLayer, renderOrder: 0, shadowClass: definition.defaultShadowClass, shadowOverride: null }
  scene.props[id] = value; scene.entityLayers[id] = value.renderLayer === 'ground' ? DETAILS : PROPS
}

/** Independent editable composition; each shoreline side is the exact same deterministic physical sample chain. */
export function createRefinedCoastDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const scene = createVisualBlankDocument({ title: REFINED_COAST_NAME, widthMm: 24000, heightMm: 18000, preset: 'narrative',
    sceneId: options.sceneId ?? 'refined-coast-v1', now: options.now ?? '2026-10-26T00:00:00.000Z', gridVisible: false })
  scene.assets = {}; scene.materials = {}; scene.propDefinitions = {}
  for (const art of REFINED_COAST_ART) {
    const id = assetId(art.key)
    scene.assets[id] = { id, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512, logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: 'MIT', origin: { ...original } }
    if (art.kind === 'material') {
      const id = `refined-material-${art.key}`
      scene.materials[id] = { id, catalogId: `material.sceneweave.q2.${art.key}`, version: 1, licenseRef: 'MIT', origin: { ...original }, name: art.name, tags: ['原创', '潮痕浅湾', ...(art.tags ?? [])], textureAssetId: assetId(art.key),
        defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, applicableSurfaces: ['terrain', 'path', 'room', 'wall'] }
    } else {
      const id = `refined-prop-${art.key}`
      scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.q2.${art.key}`, version: 1, licenseRef: 'MIT', origin: { ...original }, name: art.name, tags: ['原创', '潮痕浅湾', ...(art.tags ?? [])],
        defaultAppearance: { kind: 'image', assetId: assetId(art.key), tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -Math.round(art.widthMm / 2), y: -Math.round(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
        defaultFootprintMm: { ...art.footprintMm! }, defaultFootprintOffsetMm: point(0, 0), defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
    }
  }
  const base = scene.styleThemes['visual-theme'], themeId = 'refined-coast-theme'
  scene.styleThemes = { [themeId]: { ...base, id: themeId, catalogId: 'theme.sceneweave.q2.tidal-cove', name: '潮痕浅湾', origin: { ...original }, materialSuggestions: Object.keys(scene.materials).map(ref), propSuggestions: Object.keys(scene.propDefinitions).map(ref),
    outline: { widthMm: 24, color: '#4B5C50' }, shadowPresets: { ...base.shadowPresets, furniture: { directionDeg: 50, offsetMm: 160, blurMm: 70, opacity: .25, color: '#3C5C51' }, vegetation: { directionDeg: 50, offsetMm: 110, blurMm: 60, opacity: .17, color: '#4D6350' } } } }
  scene.activeStyleThemeRef = ref(themeId)
  scene.presetSnapshot = { presetId: 'sceneweave-refined-coast', presetVersion: 1, distanceMode: 'metric', source: 'Q2潮痕浅湾第1版：15项独立原创素材、实际双面岸线、干湿沙与浅深水过渡、三组独立礁石布景；非AI生成或参考图复制', gridSizeMm: 1000 }

  const rows = [
    [[0, 6500], [1000, 6500], [1800, 5400], [3100, 5800]],
    [[3100, 5800], [4400, 6200], [4300, 8300], [6200, 8800]],
    [[6200, 8800], [7900, 9300], [8700, 7600], [10000, 7600]],
    [[10000, 7600], [11400, 7500], [11900, 9700], [13500, 9800]],
    [[13500, 9800], [15000, 10000], [16000, 8400], [17400, 8500]],
    [[17400, 8500], [19000, 8700], [19400, 10400], [21100, 10200]],
    [[21100, 10200], [22500, 10000], [22900, 9300], [24000, 9400]],
  ]
  const segments: CubicSegment[] = rows.map((row, i) => ({ id: `q2-coast-cubic-${i}`, start: point(...row[0] as [number, number]), control1: point(...row[1] as [number, number]), control2: point(...row[2] as [number, number]), end: point(...row[3] as [number, number]) }))
  const coast: VisualBoundary = { ...entity('q2-coast-shoreline', GROUND), closed: false, segments, sampleSpacingMm: 600, toleranceMm: 25, binding: { kind: 'decoration' } }
  const samples = sampleVisualBoundary(coast).points
  const sand = terrain(scene, 'q2-coast-sand', [...samples, point(24000, 18000), point(0, 18000)], 'dry-sand')
  const water = terrain(scene, 'q2-coast-water', [point(0, 0), point(24000, 0), ...[...samples].reverse()], 'deep-water', true)
  coast.binding = { kind: 'terrain', sides: [
    { areaId: sand.id, startPointId: sand.boundaryMm[0].id, endPointId: sand.boundaryMm[samples.length - 1].id, reverse: false },
    { areaId: water.id, startPointId: water.boundaryMm[2].id, endPointId: water.boundaryMm.at(-1)!.id, reverse: true },
  ] }
  visualBase(scene)!.boundaries[coast.id] = coast
  // These are explicit editable patches, created with this composition. They are not a persistent coast-following rule.
  overlay(scene, water, 'q2-coast-shallow-belt', 'shallows', [...samples.map(p => point(p.x, p.y - 2500)), ...[...samples].reverse().map(p => ({ ...p }))], 950, 1)
  overlay(scene, sand, 'q2-coast-wet-belt', 'wet-sand', [...samples.map(p => ({ ...p })), ...[...samples].reverse().map(p => point(p.x, p.y + 1650))], 450, .9)
  overlay(scene, sand, 'q2-coast-dune-west', 'wet-sand', [[200, 14700], [2100, 13600], [4700, 14200], [6100, 15800], [5800, 17800], [200, 17800]].map(([x, y]) => point(x, y)), 700, .26)
  overlay(scene, sand, 'q2-coast-dune-east', 'wet-sand', [[17000, 15400], [18700, 14200], [21400, 14700], [23800, 16300], [23800, 17800], [17600, 17800]].map(([x, y]) => point(x, y)), 600, .22)
  visualBase(scene)!.edgeLooks['q2-coast-tide'] = { ...entity('q2-coast-tide'), boundaryId: coast.id, kind: 'shore', side: 'right', widthMm: 540, color: '#97B4A4', accentColor: '#E5E4CB', opacity: .64, intensity: .7, seed: 'q2-coast-tide-1', repeatMm: 290, enabled: true }

  // Western split-ridge group, central page-rock group and eastern tide-pool group differ in actual drawings and arrangements.
  for (const [key, x, y, rotation, support, scale] of [
    ['reef-split', 2450, 4850, 12, water.id, 1], ['reef-shelf', 1100, 4520, 126, water.id, .52], ['reef-pool', 3850, 4550, 218, water.id, .52],
    ['reef-shelf', 10050, 6200, 353, water.id, .85], ['reef-split', 11650, 6600, 104, water.id, .55], ['reef-pool', 8750, 6500, 62, water.id, .5],
    ['reef-pool', 19400, 8250, 19, water.id, .95], ['reef-split', 21000, 8730, 211, water.id, .57], ['reef-shelf', 18000, 7300, 150, water.id, .5],
    ['reef-shelf', 2500, 7650, 17, sand.id, .65], ['reef-pool', 4290, 8620, 173, sand.id, .53], ['reef-split', 18400, 10900, 247, sand.id, .6],
  ] as const) place(scene, key, x, y, rotation, support, scale)
  for (const [i, [x, y, rotation, scale]] of [
    [900, 13800, 28, 1], [1700, 14400, 112, .85], [2900, 13900, 232, 1.1], [3700, 15000, 69, .85], [4800, 15700, 143, .95],
    [750, 15800, 253, 1.15], [2050, 16600, 331, .92], [3400, 17100, 18, 1.08], [5100, 17100, 175, .8],
    [17200, 16400, 22, 1.05], [18400, 15500, 186, .9], [19700, 15000, 264, 1.13], [20900, 15600, 69, .95],
    [22100, 16700, 326, 1.1], [23400, 16100, 127, .78], [20100, 17200, 238, .88], [18300, 17000, 103, .8],
  ].entries()) place(scene, i % 2 ? 'grass-wind' : 'grass-fan', x, y, rotation, sand.id, scale)
  for (const [i, [x, y, rotation, support]] of [
    [1800, 5500, 16, water.id], [3540, 5100, 138, water.id], [9000, 7160, 44, water.id], [10800, 6900, 97, water.id], [18800, 8200, 163, water.id], [20300, 9420, 211, water.id],
    [1420, 7930, 38, sand.id], [3390, 7980, 121, sand.id], [4800, 9450, 259, sand.id], [17600, 10800, 13, sand.id], [19900, 11300, 71, sand.id],
  ].entries()) place(scene, i % 3 === 1 ? 'wrack' : 'pebbles', x as number, y as number, rotation as number, support as string, .7)
  place(scene, 'driftwood', 4900, 13300, 15, sand.id, .95)
  place(scene, 'driftwood', 20000, 13200, 148, sand.id, .75)
  place(scene, 'wrack', 4200, 12700, 8, sand.id, .8)
  place(scene, 'wrack', 20900, 12500, 173, sand.id, .65)
  for (const [i, [x, y]] of [[4020, 13600], [4600, 13860], [5620, 12970], [3490, 12930], [20540, 13600], [19070, 13040], [20900, 12930], [17900, 11600], [3240, 8610], [4650, 9960], [16800, 11300], [18120, 11190]].entries()) {
    place(scene, ['shell-fan', 'shell-spiral', 'starfish'][i % 3], x, y, i * 67 % 360, sand.id, i % 3 ? 1 : .8)
  }
  visualBase(scene)!.environment = { ambientColor: '#E7E6CC', ambientOpacity: .02, exposure: 1.015, lightDirectionDeg: 50, contactShadowMm: 48, contactShadowOpacity: .18 }
  visualBase(scene)!.filters['q2-coast-paper'] = { ...entity('q2-coast-paper', EFFECTS), target: { kind: 'scene' }, preset: 'warm', exposure: 1, saturation: .98, contrast: 1.025, vignette: .02, grain: .01, seed: 'q2-coast-paper-1', enabled: true }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`精修海岸无效：${checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  return checked.document
}

export async function createRefinedCoastProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materializeVisualArt(createRefinedCoastDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), REFINED_COAST_ART, REFINED_COAST_LICENSE, assetId, signal)
}
