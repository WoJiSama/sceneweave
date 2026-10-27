import { visualBase } from '../../../shared/visual/base.js'
import type { PointMm, Prop, SceneDocument, SurfaceOverlay, SurfaceStyle, TerrainArea } from '../../../shared/model/scene.js'
import type { CubicSegment, VisualBoundary, VisualEdgeLook } from '../../../shared/visual/types.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import { REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE } from '../../../shared/visual/island-art.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import type { EditableProject } from '../../../application/workspace/project.js'
import { createVisualBlankDocument } from './visual-samples.js'
import { materializeVisualArt } from './visual-art-project.js'
import { runtime } from '../runtime.js'

export const REFINED_ISLAND_NAME = '岬湾苔岛 · 精修版'
const FLOOR = 'visual-floor', GROUND = 'visual-layer-ground', DETAILS = 'visual-layer-details', PROPS = 'visual-layer-props', EFFECTS = 'visual-layer-effects'
const point = (x: number, y: number): PointMm => ({ x, y })
const ring = (coords: number[][]) => coords.map(([x, y]) => point(x, y))
const assetId = (key: string) => `refined-art-${key}`
const definitionId = (key: string) => `refined-prop-island-${key}`
const materialId = (key: string) => `refined-material-island-material-${key}`
const ref = (id: string) => ({ id, version: 1 })
const original = { kind: 'original' as const, attribution: 'Sceneweave Q1原创岩岛与独立固定素材第1版；保留SVG/实际PNG/确切MIT许可；未嵌入参考图片', canEmbed: true }
const entity = (id: string, layerId = DETAILS) => ({ id, floorId: FLOOR, layerId, visibility: 'public' as const, editLocked: false })

function paint(scene: SceneDocument, key: string, tileMm?: number): SurfaceStyle {
  const id = materialId(key)
  return { base: { materialRef: ref(id), tileSizeMm: tileMm ? { width: tileMm, height: tileMm } : { ...scene.materials[id].defaultTileSizeMm },
    rotationDeg: 0, alignment: 'world', originMm: point(0, 0), tint: null, opacity: 1 }, overlays: [] }
}
function overlay(scene: SceneDocument, area: TerrainArea, id: string, key: string, coords: number[][], blendWidthMm: number, opacity = 1, tileMm?: number): void {
  const value: SurfaceOverlay = { id, boundaryMm: ring(coords), paint: { ...paint(scene, key, tileMm).base, opacity }, blendWidthMm, renderOrder: area.surfaceStyle!.overlays.length }
  area.surfaceStyle!.overlays.push(value)
}
function terrain(scene: SceneDocument, id: string, points: PointMm[], key: string, priority: number, elevation: number, blocked = false): TerrainArea {
  const area: TerrainArea = { id, floorId: FLOOR, editLocked: false, visibility: 'public',
    boundaryMm: points.map((positionMm, i) => ({ id: `${id}-p-${i}`, segmentId: `${id}-s-${i}`, positionMm: { ...positionMm } })),
    groundElevationMm: elevation, coveragePriority: priority, surfaceStyle: paint(scene, key), blocksMovement: blocked, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainAreas[id] = area; scene.entityLayers[id] = GROUND
  return area
}
function boundary(scene: SceneDocument, id: string, rows: number[][][], areaId: string, key: string, priority: number, elevation: number): { curve: VisualBoundary; area: TerrainArea } {
  const segments: CubicSegment[] = rows.map((row, i) => ({ id: `${id}-cubic-${i}`, start: point(row[0][0], row[0][1]), control1: point(row[1][0], row[1][1]), control2: point(row[2][0], row[2][1]), end: point(row[3][0], row[3][1]) }))
  const curve: VisualBoundary = { ...entity(id, GROUND), closed: true, segments, sampleSpacingMm: 650, toleranceMm: 30, binding: { kind: 'decoration' } }
  const area = terrain(scene, areaId, sampleVisualBoundary(curve).points, key, priority, elevation)
  curve.binding = { kind: 'terrain', sides: [{ areaId, startPointId: area.boundaryMm[0].id, endPointId: area.boundaryMm[0].id, reverse: false }] }
  visualBase(scene)!.boundaries[id] = curve
  return { curve, area }
}
function look(scene: SceneDocument, boundaryId: string, kind: VisualEdgeLook['kind'], options: Partial<VisualEdgeLook>): void {
  const id = `${boundaryId}-${kind}`
  visualBase(scene)!.edgeLooks[id] = { ...entity(id), boundaryId, kind, side: 'right', widthMm: 600, color: '#79664F', accentColor: '#DDCEAD', opacity: 1, intensity: 1,
    seed: `q1-${id}-1`, repeatMm: 260, enabled: true, ...options }
}
function place(scene: SceneDocument, key: string, x: number, y: number, rotationDeg: number, supportId: string, scale = 1): void {
  const definition = scene.propDefinitions[definitionId(key)], id = `q1-${key}-${Object.keys(scene.props).length + 1}`
  const v = definition.defaultVisualBoundsMm, f = definition.defaultFootprintMm
  const prop: Prop = { id, floorId: FLOOR, editLocked: false, visibility: 'public', definitionRef: ref(definition.id), appearance: { ...definition.defaultAppearance }, positionMm: point(x, y), rotationDeg,
    visualBoundsMm: { x: Math.round(v.x * scale), y: Math.round(v.y * scale), width: Math.round(v.width * scale), height: Math.round(v.height * scale) },
    footprintMm: { width: Math.round(f.width * scale), height: Math.round(f.height * scale) }, footprintOffsetMm: point(0, 0),
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, supportRef: { kind: 'terrainArea', id: supportId },
    renderLayer: definition.defaultRenderLayer, renderOrder: 0, shadowClass: definition.defaultShadowClass, shadowOverride: null }
  scene.props[id] = prop; scene.entityLayers[id] = prop.renderLayer === 'ground' ? DETAILS : PROPS
}

/** Independent fixed artwork and composition; the original three sample palettes and recipes remain unchanged. */
export function createRefinedIslandDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const scene = createVisualBlankDocument({ title: REFINED_ISLAND_NAME, widthMm: 24000, heightMm: 18000, preset: 'narrative',
    sceneId: options.sceneId ?? 'refined-island-v1', now: options.now ?? '2026-10-25T00:00:00.000Z', gridVisible: false })
  scene.assets = {}; scene.materials = {}; scene.propDefinitions = {}
  for (const art of REFINED_ISLAND_ART) {
    const id = assetId(art.key)
    scene.assets[id] = { id, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: 'MIT', origin: { ...original } }
    if (art.kind === 'material') {
      const id = `refined-material-${art.key}`
      scene.materials[id] = { id, catalogId: `material.sceneweave.q1.${art.key}`, version: 1, licenseRef: 'MIT', origin: { ...original }, name: art.name,
        tags: ['原创', '岬湾苔岛', ...(art.tags ?? [])], textureAssetId: assetId(art.key), defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, applicableSurfaces: ['terrain', 'path', 'room', 'wall'] }
    } else {
      const id = `refined-prop-${art.key}`
      scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.q1.${art.key}`, version: 1, licenseRef: 'MIT', origin: { ...original }, name: art.name,
        tags: ['原创', '岬湾苔岛', ...(art.tags ?? [])], defaultAppearance: { kind: 'image', assetId: assetId(art.key), tint: null, opacity: 1 },
        defaultVisualBoundsMm: { x: -Math.round(art.widthMm / 2), y: -Math.round(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
        defaultFootprintMm: { ...art.footprintMm! }, defaultFootprintOffsetMm: point(0, 0), defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
    }
  }
  const previousTheme = scene.styleThemes['visual-theme'], themeId = 'refined-island-theme'
  scene.styleThemes = { [themeId]: { ...previousTheme, id: themeId, catalogId: 'theme.sceneweave.q1.cape-moss', name: '岬湾苔墨', origin: { ...original },
    materialSuggestions: Object.keys(scene.materials).map(ref), propSuggestions: Object.keys(scene.propDefinitions).map(ref),
    outline: { widthMm: 20, color: '#4B5141' },
    shadowPresets: { ...previousTheme.shadowPresets,
      furniture: { directionDeg: 50, offsetMm: 150, blurMm: 65, opacity: .24, color: '#314D46' },
      vegetation: { directionDeg: 50, offsetMm: 300, blurMm: 110, opacity: .24, color: '#294D42' } },
    terrainCliff: { ...previousTheme.terrainCliff, opacity: .22, color: '#294D46' } } }
  scene.activeStyleThemeRef = ref(themeId)
  scene.presetSnapshot = { presetId: 'sceneweave-refined-island', presetVersion: 1, distanceMode: 'metric', source: 'Q1岬湾苔岛第1版：13项独立原创素材、非对称海湾/岬角、800/2600mm岩台与真实台阶；完整可编辑，非AI自动生成或参考图复制', gridSizeMm: 1000 }

  const water = terrain(scene, 'q1-water', ring([[0, 0], [24000, 0], [24000, 18000], [0, 18000]]), 'shallows', 0, 0, true)
  water.surfaceStyle = paint(scene, 'shallows', 6400)
  water.surfaceStyle.base.tint = '#B1D2CC'
  overlay(scene, water, 'q1-shallow-halo', 'shallows', [[1700, 7600], [3400, 3000], [7800, 1900], [10500, 3300], [14000, 900], [19600, 2900], [22400, 7400], [21700, 13200], [16700, 16500], [9900, 15500], [4500, 16800], [1500, 12700]], 1100, .95, 6400)
  const low = boundary(scene, 'q1-coast', [
    [[3200, 8600], [3100, 7100], [3500, 5200], [4400, 4600]],
    [[4400, 4600], [5300, 3900], [6500, 3000], [7800, 3400]],
    [[7800, 3400], [8900, 3700], [9000, 5200], [10500, 4900]],
    [[10500, 4900], [11900, 4600], [12400, 2600], [14300, 2400]],
    [[14300, 2400], [15900, 2100], [17900, 3300], [18700, 4300]],
    [[18700, 4300], [19800, 5700], [19300, 7300], [20500, 8200]],
    [[20500, 8200], [21900, 9500], [20700, 11200], [19400, 11700]],
    [[19400, 11700], [18300, 12100], [18000, 14100], [15700, 14600]],
    [[15700, 14600], [13800, 15000], [12700, 13200], [11100, 13400]],
    [[11100, 13400], [9700, 13500], [8900, 15400], [7200, 14800]],
    [[7200, 14800], [5300, 14300], [4000, 13300], [4100, 11900]],
    [[4100, 11900], [4200, 10300], [3300, 10200], [3200, 8600]],
  ], 'q1-low', 'strata', 1, 800).area
  const high = boundary(scene, 'q1-crown', [
    [[9400, 6400], [10100, 5500], [11500, 6000], [12500, 5500]],
    [[12500, 5500], [13800, 4600], [15800, 4800], [16900, 6200]],
    [[16900, 6200], [17700, 7200], [17100, 8000], [17600, 8900]],
    [[17600, 8900], [18300, 10100], [16700, 11400], [15200, 11300]],
    [[15200, 11300], [14000, 11200], [13700, 10400], [12300, 10900]],
    [[12300, 10900], [10800, 11500], [9300, 10200], [9200, 9200]],
    [[9200, 9200], [9100, 8100], [8300, 7600], [9400, 6400]],
  ], 'q1-high', 'moss', 2, 2600).area
  low.surfaceStyle = paint(scene, 'strata', 4200); high.surfaceStyle = paint(scene, 'moss', 3800)
  // Explicit editable patches. They are not a hidden persistent coast-following rule.
  overlay(scene, low, 'q1-west-grass', 'moss', [[3500, 5800], [5900, 4300], [7900, 5200], [8100, 6600], [6500, 7600], [6000, 10400], [4200, 10400]], 380, .92, 3800)
  overlay(scene, low, 'q1-south-grass', 'moss', [[5200, 11800], [7900, 11200], [10200, 12100], [10800, 13600], [8500, 15000], [5800, 14200]], 420, .95, 3800)
  overlay(scene, low, 'q1-north-moss', 'moss', [[12400, 2800], [15000, 2400], [17600, 3900], [16600, 4800], [14000, 4400], [12100, 4700]], 350, .88, 3800)
  overlay(scene, low, 'q1-east-moss', 'moss', [[18300, 7200], [20200, 8200], [20700, 10000], [18900, 11700], [18100, 10400]], 320, .8, 3800)
  overlay(scene, low, 'q1-south-east-moss', 'moss', [[14200, 12400], [16600, 11900], [17900, 13000], [16400, 14500], [14400, 13900]], 330, .88, 3800)
  overlay(scene, high, 'q1-clearing-rock', 'strata', [[10800, 7900], [12000, 7400], [13400, 7800], [13700, 9000], [12500, 9600], [11300, 9200]], 360, .8, 4200)
  overlay(scene, high, 'q1-crown-rock', 'strata', [[14800, 5300], [16200, 5600], [16900, 6500], [16400, 7200], [15100, 6700]], 300, .75, 4200)
  overlay(scene, high, 'q1-eastern-rock', 'strata', [[16400, 8800], [17700, 9000], [17200, 10400], [15600, 11100], [15500, 10300]], 280, .7, 4200)

  look(scene, 'q1-coast', 'cliff', { widthMm: 720, color: '#9A8465', accentColor: '#DFCEA5', repeatMm: 180 })
  look(scene, 'q1-coast', 'shore', { widthMm: 370, color: '#8CBBAA', accentColor: '#E0E5C3', opacity: .83, repeatMm: 210 })
  look(scene, 'q1-crown', 'cliff', { widthMm: 1150, color: '#8A765D', accentColor: '#D0C09B', repeatMm: 165 })
  look(scene, 'q1-crown', 'grass', { side: 'left', widthMm: 260, color: '#718153', accentColor: '#B6BA7D', repeatMm: 190, opacity: .83 })
  scene.terrainConnections['q1-stairs'] = { id: 'q1-stairs', floorId: FLOOR, editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'terrainArea', id: low.id }, positionMm: point(7300, 8400) }, to: { surfaceRef: { kind: 'terrainArea', id: high.id }, positionMm: point(10200, 8400) },
    widthMm: 1500, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: paint(scene, 'strata', 4200) }
  scene.entityLayers['q1-stairs'] = GROUND

  // Three distinct tree silhouettes: open central clearing and an unobstructed stair approach.
  for (const [key, x, y, rotation, scale] of [
    ['tree-north-asym', 11100, 6600, 5, .86], ['tree-windbent', 13900, 6000, 328, .78], ['tree-split-crown', 15400, 8100, 24, .83],
    ['tree-north-asym', 13900, 10000, 115, .7], ['tree-windbent', 10900, 9900, 195, .68],
  ] as const) place(scene, key, x, y, rotation, high.id, scale)
  for (const [key, x, y, rotation, scale] of [
    ['tree-windbent', 6500, 5800, 16, .75], ['tree-split-crown', 6100, 12700, 8, .72], ['tree-north-asym', 8200, 13600, 175, .68],
  ] as const) place(scene, key, x, y, rotation, low.id, scale)
  for (const [key, x, y, rotation, scale, support] of [
    ['rock-north-ridge', 5500, 8100, 16, .75, low.id], ['rock-layered-shelf', 7400, 4400, 34, .7, low.id],
    ['rock-tidepool', 17800, 5600, 81, .72, low.id], ['rock-north-ridge', 19500, 9600, 195, .72, low.id],
    ['rock-layered-shelf', 17100, 13200, 156, .85, low.id], ['rock-tidepool', 11900, 12400, 212, .58, low.id],
    ['rock-layered-shelf', 5100, 11400, 322, .58, low.id], ['rock-north-ridge', 15200, 3900, 64, .72, low.id],
    ['rock-tidepool', 16500, 9900, 304, .55, high.id], ['rock-layered-shelf', 12600, 6200, 177, .45, high.id],
    ['rock-tidepool', 22000, 12600, 32, .9, water.id], ['rock-layered-shelf', 21300, 13700, 162, .6, water.id],
    ['rock-north-ridge', 2100, 12900, 52, .65, water.id],
  ] as const) place(scene, key, x, y, rotation, support, scale)
  for (const [i, [x, y, support]] of [
    [4700, 6500, low.id], [5600, 6900, low.id], [7600, 6600, low.id], [4900, 9600, low.id], [6600, 11300, low.id],
    [7700, 12400, low.id], [9200, 13600, low.id], [15000, 13300, low.id], [18400, 10900, low.id], [14100, 3700, low.id],
    [10400, 7100, high.id], [12000, 6600, high.id], [15900, 7000, high.id], [14700, 10300, high.id], [11500, 9900, high.id],
  ].entries()) place(scene, i % 2 ? 'shrub-scree-sedge' : 'shrub-coastal-heath', x as number, y as number, i * 47 % 360, support as string, i % 3 ? .85 : .65)
  for (const [i, [x, y, support]] of [
    [6400, 9300, low.id], [8100, 10400, low.id], [9700, 11900, low.id], [11700, 12700, low.id], [14400, 12100, low.id],
    [18100, 8000, low.id], [16200, 4400, low.id], [9600, 6800, high.id], [11800, 8800, high.id], [15100, 9300, high.id],
  ].entries()) place(scene, 'debris-scree', x as number, y as number, i * 71 % 360, support as string, .7)
  place(scene, 'debris-driftwood', 7600, 10100, 36, low.id, .85)
  place(scene, 'debris-driftwood', 18400, 11900, 121, low.id, .65)
  visualBase(scene)!.environment = { ambientColor: '#E8E7C9', ambientOpacity: .025, exposure: 1.02, lightDirectionDeg: 50, contactShadowMm: 55, contactShadowOpacity: .2 }
  visualBase(scene)!.filters['q1-paper-tone'] = { ...entity('q1-paper-tone', EFFECTS), target: { kind: 'scene' }, preset: 'warm', exposure: 1.01, saturation: 1.03, contrast: 1.04,
    vignette: .025, grain: .012, seed: 'q1-paper-1', enabled: true }
  // Water haze remains local and faint; land heights must read with this effect disabled.
  visualBase(scene)!.fogs['q1-water-haze'] = { ...entity('q1-water-haze', EFFECTS), boundaryMm: ring([[800, 14900], [6600, 15400], [10800, 16200], [11400, 17700], [800, 17700]]),
    color: '#D9E8CF', opacity: .035, directionDeg: 12, scaleMm: 1900, seed: 'q1-water-haze-1', enabled: true }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`精修岩岛无效：${checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  return checked.document
}

export async function createRefinedIslandProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materializeVisualArt(createRefinedIslandDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE, assetId, signal)
}
