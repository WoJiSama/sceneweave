import { visualBase } from '../../../shared/visual/base.js'
import type { PointMm, Prop, SceneDocument, SurfaceStyle, TerrainArea } from '../../../shared/model/scene.js'
import { emptyVisualSystem, type CubicSegment, type VisualBoundary, type VisualEdgeLook } from '../../../shared/visual/types.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import { VISUAL_SAMPLE_ART, VISUAL_SAMPLE_LICENSE } from '../../../shared/visual/sample-art.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import type { EditableProject } from '../../../application/workspace/project.js'
import { materializeVisualArt } from './visual-art-project.js'
import { runtime } from '../runtime.js'
import { z } from 'zod'
import { captureJson } from '../../../shared/validation/json.js'
import { BLANK_PRESETS, type BlankOptions } from './factories.js'

export type VisualSampleKind = 'beach' | 'island' | 'interior'
export const VISUAL_SAMPLE_NAMES: Record<VisualSampleKind, string> = { beach: '潮声浅湾', island: '苔冠岩岛', interior: '灯下旅舍' }
const FLOOR = 'visual-floor', GROUND = 'visual-layer-ground', DETAILS = 'visual-layer-details', PROPS = 'visual-layer-props', EFFECTS = 'visual-layer-effects'
const origin = { kind: 'original' as const, attribution: 'Sceneweave原创视觉素材与地图；确定性SVG源及MIT许可完整保存；未嵌入参考图像', canEmbed: true }
const ref = (id: string) => ({ id, version: 1 })
const p = (x: number, y: number): PointMm => ({ x, y })
const hexZero = '0'.repeat(64)
const cubic = (id: string, points: number[][]): CubicSegment => ({ id, start: p(...points[0] as [number, number]), control1: p(...points[1] as [number, number]), control2: p(...points[2] as [number, number]), end: p(...points[3] as [number, number]) })
const rectangle = (left: number, top: number, right: number, bottom: number) => [p(left, top), p(right, top), p(right, bottom), p(left, bottom)]
const entity = (id: string, layerId = EFFECTS) => ({ id, floorId: FLOOR, layerId, visibility: 'public' as const, editLocked: false })
const materialId = (key: string) => `visual-material-${key}`
const propId = (key: string) => `visual-prop-${key}`
const assetId = (key: string) => `visual-art-${key}`
function style(scene: SceneDocument, key: string, rotationDeg = 0): SurfaceStyle { const id = materialId(key); return { base: { materialRef: ref(id), tileSizeMm: { ...scene.materials[id].defaultTileSizeMm }, rotationDeg, alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] } }
function terrain(scene: SceneDocument, id: string, points: PointMm[], key: string, priority: number, elevationMm = 0, blocked = false): TerrainArea {
  const area: TerrainArea = { id, floorId: FLOOR, editLocked: false, visibility: 'public', boundaryMm: points.map((positionMm, i) => ({ id: `${id}-point-${i}`, segmentId: `${id}-segment-${i}`, positionMm: { ...positionMm } })), groundElevationMm: elevationMm, coveragePriority: priority,
    surfaceStyle: style(scene, key), blocksMovement: blocked, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainAreas[id] = area; scene.entityLayers[id] = GROUND; return area
}
function place(scene: SceneDocument, key: string, x: number, y: number, rotationDeg = 0, supportId?: string, roomId?: string, scale = 1): string {
  const definition = scene.propDefinitions[propId(key)], id = `${key}-${Object.keys(scene.props).length + 1}`
  const v = definition.defaultVisualBoundsMm, f = definition.defaultFootprintMm
  const value: Prop = { id, floorId: FLOOR, editLocked: false, visibility: 'public', definitionRef: ref(definition.id), appearance: { ...definition.defaultAppearance }, visualBoundsMm: { x: Math.round(v.x * scale), y: Math.round(v.y * scale), width: Math.round(v.width * scale), height: Math.round(v.height * scale) },
    positionMm: p(x, y), rotationDeg, footprintMm: { width: Math.round(f.width * scale), height: Math.round(f.height * scale) }, footprintOffsetMm: p(0, 0), blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, supportRef: roomId ? { kind: 'room', id: roomId } : supportId ? { kind: 'terrainArea', id: supportId } : { kind: 'floor', id: FLOOR },
    ...(roomId ? { roomId } : {}), renderLayer: definition.defaultRenderLayer, renderOrder: key === 'clutter' || key === 'lantern' ? 20 : 0, shadowClass: definition.defaultShadowClass, shadowOverride: null }
  scene.props[id] = value; scene.entityLayers[id] = key === 'shell' ? DETAILS : PROPS; return id
}
function addLook(scene: SceneDocument, boundaryId: string, kind: VisualEdgeLook['kind'], options: Partial<VisualEdgeLook> = {}): void {
  const id = `${boundaryId}-${kind}`
  visualBase(scene)!.edgeLooks[id] = { ...entity(id, DETAILS), boundaryId, kind, side: 'right', widthMm: 600, color: '#9DB4A0', accentColor: '#F1E8CB', opacity: .8, intensity: 1, seed: `${id}-v1`, repeatMm: 300, enabled: true, ...options }
}
function curve(scene: SceneDocument, id: string, segments: CubicSegment[], closed = false): VisualBoundary {
  const boundary: VisualBoundary = { ...entity(id, GROUND), closed, segments, sampleSpacingMm: 650, toleranceMm: 35, binding: { kind: 'decoration' } }
  visualBase(scene)!.boundaries[id] = boundary; return boundary
}
function bindWhole(scene: SceneDocument, boundary: VisualBoundary, id: string, key: string, priority: number, elevationMm = 0): TerrainArea {
  const sampled = sampleVisualBoundary(boundary), area = terrain(scene, id, sampled.points, key, priority, elevationMm)
  boundary.binding = { kind: 'terrain', sides: [{ areaId: id, startPointId: area.boundaryMm[0].id, endPointId: area.boundaryMm[0].id, reverse: false }] }; return area
}
function baseScene(kind: VisualSampleKind, sceneId: string, now: string): SceneDocument {
  const bounds = kind === 'interior' ? { x: 0, y: 0, width: 20000, height: 15000 } : { x: 0, y: 0, width: 24000, height: 18000 }
  const scene: SceneDocument = { format: 'sceneweave-scene', schemaVersion: 2, sceneId, revision: 0, title: VISUAL_SAMPLE_NAMES[kind], createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { [FLOOR]: { id: FLOOR, name: '原创视觉场景', boundsMm: { ...bounds } } }, vertices: {}, walls: {}, openings: {}, rooms: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: Object.fromEntries([[GROUND, '地形与结构'], [DETAILS, '边缘与细节'], [PROPS, '家具与植被'], [EFFECTS, '光照与气氛']].map(([id, name], order) => [id, { id, floorId: FLOOR, name, order, editLocked: false }])), entityLayers: {},
    presetSnapshot: { presetId: `sceneweave-visual-${kind}`, presetVersion: 1, distanceMode: 'metric', source: 'Sceneweave原创视觉创作样例；共享曲线、完整可编辑成员及本地确定性效果；非参考图复制', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] }, visual: emptyVisualSystem() }
  for (const art of VISUAL_SAMPLE_ART) {
    const id = assetId(art.key)
    scene.assets[id] = { id, sha256: hexZero, mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512, logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: 'MIT', origin: { ...origin } }
    if (art.kind === 'material') {
      const id = materialId(art.key)
      scene.materials[id] = { id, catalogId: `material.sceneweave.visual.${art.key}`, version: 1, licenseRef: 'MIT', origin: { ...origin }, name: art.name, tags: ['原创', '视觉创作', '潮苔墨绘', ...(art.tags ?? [])], textureAssetId: assetId(art.key), defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
    } else {
      const id = propId(art.key)
      scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.visual.${art.key}`, version: 1, licenseRef: 'MIT', origin: { ...origin }, name: art.name, tags: ['原创', '视觉创作', '潮苔墨绘', ...(art.tags ?? [])], defaultAppearance: { kind: 'image', assetId: assetId(art.key), tint: null, opacity: 1 },
        defaultVisualBoundsMm: { x: -Math.round(art.widthMm / 2), y: -Math.round(art.heightMm / 2), width: art.widthMm, height: art.heightMm }, defaultFootprintMm: art.footprintMm!, defaultFootprintOffsetMm: p(0, 0), defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
    }
  }
  const shadow = (offsetMm: number, blurMm: number, opacity: number) => ({ directionDeg: 50, offsetMm, blurMm, opacity, color: '#243931' })
  const theme = { id: 'visual-theme', catalogId: 'theme.sceneweave.visual.coastal-ink', version: 1, licenseRef: 'MIT', origin: { ...origin }, name: '潮苔墨绘', materialSuggestions: Object.keys(scene.materials).map(ref), propSuggestions: Object.keys(scene.propDefinitions).map(ref), prefabSuggestions: [],
    outline: { widthMm: 26, color: '#35483F' }, openingStyle: { doorStrokeWidthMm: 22, windowStrokeWidthMm: 16, frameWidthMm: 65, doorFill: '#A58458', windowFill: '#A5B7A7' },
    edgeStyles: { shore: { strokeWidthMm: 0, color: '#E9DFC3', bandWidthMm: 0 }, cliff: { strokeWidthMm: 15, color: '#47594A', bandWidthMm: 350 }, materialTransition: { strokeWidthMm: 0, color: '#889165', bandWidthMm: 100 }, path: { strokeWidthMm: 8, color: '#7C7C5C', bandWidthMm: 100 } },
    shadowPresets: { none: shadow(0, 0, 0), furniture: shadow(180, 85, .25), vegetation: shadow(350, 130, .25), wall: shadow(250, 90, .3) }, terrainCliff: { directionDeg: 50, offsetFactor: .18, maxOffsetMm: 600, blurMm: 100, opacity: .22, color: '#253A35' } }
  scene.styleThemes[theme.id] = theme; scene.activeStyleThemeRef = ref(theme.id)
  visualBase(scene)!.environment = { ambientColor: '#DCE2C8', ambientOpacity: .08, exposure: 1, lightDirectionDeg: 50, contactShadowMm: 50, contactShadowOpacity: .18 }
  return scene
}
function beach(scene: SceneDocument): void {
  const coast = curve(scene, 'beach-coast', [cubic('beach-west', [[0, 5200], [3900, 3500], [4800, 9100], [10100, 8900]]), cubic('beach-east', [[10100, 8900], [15900, 8700], [18000, 12600], [24000, 10700]])])
  const samples = sampleVisualBoundary(coast).points, sand = terrain(scene, 'beach-sand', [...samples, p(24000, 18000), p(0, 18000)], 'sand', 1)
  const water = terrain(scene, 'beach-water', [p(0, 0), p(24000, 0), ...[...samples].reverse()], 'water', 1, 0, true)
  coast.binding = { kind: 'terrain', sides: [{ areaId: sand.id, startPointId: sand.boundaryMm[0].id, endPointId: sand.boundaryMm[samples.length - 1].id, reverse: false }, { areaId: water.id, startPointId: water.boundaryMm[2].id, endPointId: water.boundaryMm.at(-1)!.id, reverse: true }] }
  addLook(scene, coast.id, 'shore', { widthMm: 950, color: '#A7B9A2', accentColor: '#F6EACB', repeatMm: 260, opacity: .85 })
  const bank = curve(scene, 'beach-bank', [cubic('beach-bank-west', [[1500, 15000], [4800, 12300], [6000, 16800], [11000, 14300]]), cubic('beach-bank-east', [[11000, 14300], [15300, 12200], [17800, 15100], [22400, 15100]])])
  addLook(scene, bank.id, 'grass', { side: 'left', widthMm: 700, color: '#879363', accentColor: '#B8BD7B', repeatMm: 210, opacity: .8 })
  for (const [i, [x, y, rotation]] of [[1700, 6700, 16], [3300, 7100, 115], [8200, 10400, 52], [11300, 9900, 207], [15000, 11900, 74], [18200, 13200, 142], [21700, 12500, 46]].entries()) place(scene, 'rock', x, y, rotation, sand.id, undefined, i % 3 ? .72 : 1)
  for (const [x, y, rotation] of [[2700, 14500, 36], [6200, 15300, 132], [14300, 14600, 25], [17700, 15700, 73], [21400, 15900, 191]]) place(scene, 'tree', x, y, rotation, sand.id)
  for (const [x, y] of [[1800, 15700], [4200, 14300], [8700, 15500], [12500, 15700], [15100, 13700], [19800, 14800], [22200, 16200]]) place(scene, 'shrub', x, y, 25, sand.id)
  for (const [i, [x, y]] of [[2900, 10000], [4200, 9400], [6800, 12200], [9000, 11400], [11900, 12900], [13400, 11700], [17100, 13900], [19900, 14000], [22100, 14600], [10700, 14300], [5300, 13600], [16700, 15300]].entries()) place(scene, 'shell', x, y, (i * 53) % 360, sand.id)
  visualBase(scene)!.filters['beach-tone'] = { ...entity('beach-tone'), target: { kind: 'scene' }, preset: 'warm', exposure: 1.02, saturation: .9, contrast: 1.02, vignette: .08, grain: .025, seed: 'beach-paper-v1', enabled: true }
}
function island(scene: SceneDocument): void {
  terrain(scene, 'island-water', rectangle(0, 0, 24000, 18000), 'water', 0, 0, true)
  const outline = curve(scene, 'island-shore', [cubic('island-nw', [[3200, 8800], [3300, 4700], [6400, 2600], [10300, 3100]]), cubic('island-ne', [[10300, 3100], [13200, 1300], [18700, 3500], [19800, 7100]]), cubic('island-se', [[19800, 7100], [22800, 9900], [18800, 14200], [15400, 14600]]), cubic('island-sw', [[15400, 14600], [10600, 17200], [3800, 14600], [3200, 8800]])], true)
  const low = bindWhole(scene, outline, 'island-low', 'rockfloor', 1, 800)
  const highBoundary = curve(scene, 'island-crown', [cubic('crown-nw', [[9100, 5700], [11100, 4200], [14500, 4200], [16600, 6100]]), cubic('crown-ne', [[16600, 6100], [18300, 8500], [17500, 10400], [15100, 11100]]), cubic('crown-sw', [[15100, 11100], [13000, 12400], [10300, 11100], [9100, 9200]]), cubic('crown-west', [[9100, 9200], [8200, 8000], [8100, 6900], [9100, 5700]])], true)
  const high = bindWhole(scene, highBoundary, 'island-high', 'grass', 2, 2600)
  addLook(scene, outline.id, 'cliff', { widthMm: 650, color: '#686E62', accentColor: '#C4C4A4', repeatMm: 220, opacity: 1 })
  addLook(scene, outline.id, 'shore', { widthMm: 450, color: '#85A9A0', accentColor: '#E4E6C5', repeatMm: 220, opacity: .7 })
  addLook(scene, highBoundary.id, 'cliff', { widthMm: 1000, color: '#5E6859', accentColor: '#BABE96', repeatMm: 190, opacity: 1 })
  addLook(scene, highBoundary.id, 'grass', { side: 'left', widthMm: 350, color: '#7B8D5D', accentColor: '#B6BD7E', repeatMm: 180, opacity: .85 })
  scene.terrainConnections['island-stairs'] = { id: 'island-stairs', floorId: FLOOR, editLocked: false, visibility: 'public', kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: low.id }, positionMm: p(7100, 8200) }, to: { surfaceRef: { kind: 'terrainArea', id: high.id }, positionMm: p(10400, 8200) }, widthMm: 1300, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: style(scene, 'stone') }; scene.entityLayers['island-stairs'] = GROUND
  for (const [x, y, rotation] of [[11100, 6500, 10], [13800, 5700, 78], [15700, 7400, 132], [13200, 9300, 41], [10700, 9200, 194]]) place(scene, 'tree', x, y, rotation, high.id, undefined, .8)
  for (const [i, [x, y]] of [[5200, 8100], [7000, 5000], [17200, 5400], [19100, 9200], [17100, 13200], [11800, 14000], [7200, 12100], [5300, 10100]].entries()) { place(scene, 'rock', x, y, i * 42, low.id, undefined, .7); if (i % 2) place(scene, 'shrub', x + 600, y + 800, i * 21, low.id, undefined, .9) }
  for (const [x, y] of [[1200, 11300], [21900, 13400], [16000, 16400]]) place(scene, 'rock', x, y, 35, 'island-water', undefined, .65)
  visualBase(scene)!.fogs['island-mist'] = { ...entity('island-mist'), boundaryMm: rectangle(1200, 11200, 22600, 17300), color: '#D6DFCA', opacity: .12, directionDeg: 15, scaleMm: 1700, seed: 'island-mist-v1', enabled: true }
  visualBase(scene)!.filters['island-tone'] = { ...entity('island-tone'), target: { kind: 'scene' }, preset: 'cool', exposure: 1.03, saturation: .82, contrast: 1.05, vignette: .12, grain: .02, seed: 'island-paper-v1', enabled: true }
}
function interior(scene: SceneDocument): void {
  terrain(scene, 'interior-earth', rectangle(0, 0, 20000, 15000), 'earth', 0)
  // Two rooms share one real wall and stable split vertices. No doubled wall geometry.
  const coords: Record<string, [number, number]> = { nw: [1900, 1900], nt: [11900, 1900], ne: [18100, 1900], east: [18100, 13100], south: [11900, 13100], sw: [1900, 13100] }
  for (const [key, [xMm, yMm]] of Object.entries(coords)) { const id = `inn-${key}`; scene.vertices[id] = { id, floorId: FLOOR, editLocked: false, xMm, yMm }; scene.entityLayers[id] = GROUND }
  const wall = (id: string, start: string, end: string) => { scene.walls[id] = { id, floorId: FLOOR, editLocked: false, startVertexId: `inn-${start}`, endVertexId: `inn-${end}`, thicknessMm: 350, blocksMovement: true, blocksSight: true, topStyle: style(scene, 'stone') }; scene.entityLayers[id] = GROUND }
  wall('inn-wall-nw', 'nw', 'nt'); wall('inn-wall-ne', 'nt', 'ne'); wall('inn-wall-east', 'ne', 'east'); wall('inn-wall-se', 'east', 'south'); wall('inn-wall-sw', 'south', 'sw'); wall('inn-wall-west', 'sw', 'nw'); wall('inn-wall-divider', 'nt', 'south')
  const room = (id: string, vertices: string[], purpose: string) => { scene.rooms[id] = { id, floorId: FLOOR, editLocked: false, boundaryVertexIds: vertices.map(key => `inn-${key}`), purpose, visibility: 'public', accessExpectation: 'required', supportRef: { kind: 'terrainArea', id: 'interior-earth' }, groundElevationMm: 0, floorStyle: style(scene, 'wood', id === 'inn-bedroom' ? 90 : 0) }; scene.entityLayers[id] = GROUND }
  room('inn-common', ['nw', 'nt', 'south', 'sw'], '临海旅舍的共用会客厅'); room('inn-bedroom', ['nt', 'ne', 'east', 'south'], '客房与书卷储藏')
  scene.openings['inn-door-entry'] = { id: 'inn-door-entry', floorId: FLOOR, editLocked: false, wallId: 'inn-wall-sw', offsetReferenceVertexId: 'inn-sw', offsetMm: 3900, widthMm: 1300, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }; scene.entityLayers['inn-door-entry'] = GROUND
  scene.openings['inn-door-inner'] = { id: 'inn-door-inner', floorId: FLOOR, editLocked: false, wallId: 'inn-wall-divider', offsetReferenceVertexId: 'inn-nt', offsetMm: 5200, widthMm: 1200, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }; scene.entityLayers['inn-door-inner'] = GROUND
  scene.openings['inn-window'] = { id: 'inn-window', floorId: FLOOR, editLocked: false, wallId: 'inn-wall-west', offsetReferenceVertexId: 'inn-nw', offsetMm: 2200, widthMm: 1800, kind: 'window', state: 'closed', locked: false, secret: false, revealed: false }; scene.entityLayers['inn-window'] = GROUND
  scene.constraints.entranceOpeningIds = ['inn-door-entry']
  place(scene, 'rug', 7000, 7400, 0, undefined, 'inn-common', 1.3)
  place(scene, 'table', 7000, 7100, 0, undefined, 'inn-common', 1.2)
  for (const [x, y, rotation] of [[5300, 7100, 90], [8700, 7100, 270], [6400, 8800, 180], [7800, 8800, 180], [6400, 5500, 0], [7800, 5500, 0]]) place(scene, 'chair', x, y, rotation, undefined, 'inn-common')
  place(scene, 'clutter', 6900, 7000, 25, undefined, 'inn-common', 1.1)
  place(scene, 'lantern', 7800, 6900, 0, undefined, 'inn-common')
  place(scene, 'stove', 3300, 3300, 0, undefined, 'inn-common')
  place(scene, 'counter', 6000, 3000, 0, undefined, 'inn-common')
  place(scene, 'cupboard', 9100, 3000, 0, undefined, 'inn-common')
  place(scene, 'shelf', 10600, 4300, 90, undefined, 'inn-common', .8)
  place(scene, 'barrel', 3100, 5400, 13, undefined, 'inn-common')
  place(scene, 'basket', 10500, 11600, 336, undefined, 'inn-common')
  place(scene, 'crate', 3200, 10800, 7, undefined, 'inn-common'); place(scene, 'crate', 4400, 11100, 352, undefined, 'inn-common')
  place(scene, 'bed', 15000, 4400, 0, undefined, 'inn-bedroom', 1.1)
  place(scene, 'rug', 15100, 9200, 0, undefined, 'inn-bedroom', .8)
  place(scene, 'table', 15100, 9500, 90, undefined, 'inn-bedroom', .65)
  place(scene, 'chair', 16500, 9500, 270, undefined, 'inn-bedroom')
  place(scene, 'clutter', 15100, 9500, 72, undefined, 'inn-bedroom', .8)
  place(scene, 'shelf', 16500, 11900, 0, undefined, 'inn-bedroom', .8)
  place(scene, 'lantern', 14400, 9700, 0, undefined, 'inn-bedroom')
  visualBase(scene)!.environment = { ambientColor: '#46584D', ambientOpacity: .46, exposure: .88, lightDirectionDeg: 55, contactShadowMm: 85, contactShadowOpacity: .28 }
  visualBase(scene)!.lights['inn-light-common'] = { ...entity('inn-light-common'), positionMm: p(7800, 6900), radiusMm: 5000, color: '#E9BC70', intensity: .75, wallOcclusion: true, enabled: true }
  visualBase(scene)!.lights['inn-light-bedroom'] = { ...entity('inn-light-bedroom'), positionMm: p(14400, 9700), radiusMm: 3600, color: '#E9B36B', intensity: .7, wallOcclusion: true, enabled: true }
  visualBase(scene)!.lights['inn-light-window'] = { ...entity('inn-light-window'), positionMm: p(2700, 4900), radiusMm: 3000, color: '#A9C4B1', intensity: .22, wallOcclusion: true, enabled: true }
  visualBase(scene)!.lights['inn-light-stove'] = { ...entity('inn-light-stove'), positionMm: p(3300, 3500), radiusMm: 2100, color: '#E6AB64', intensity: .5, wallOcclusion: true, enabled: true }
  visualBase(scene)!.filters['inn-tone'] = { ...entity('inn-tone'), target: { kind: 'scene' }, preset: 'aged', exposure: 1, saturation: .88, contrast: 1.08, vignette: .14, grain: .03, seed: 'inn-paper-v1', enabled: true }
}

/** Pure scene composition for tests and browser materialization; placeholder hashes are replaced before publication. */
export function createVisualSampleDocument(kind: VisualSampleKind, options: { sceneId?: string; now?: string } = {}): SceneDocument {
  if (!Object.hasOwn(VISUAL_SAMPLE_NAMES, kind)) throw new Error('未知视觉样例。')
  const scene = baseScene(kind, options.sceneId ?? `visual-sample-${kind}`, options.now ?? '2026-10-25T00:00:00.000Z')
  if (kind === 'beach') beach(scene); else if (kind === 'island') island(scene); else interior(scene)
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`视觉样例结构无效：${checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  return checked.document
}

/** Actual SVG source, normalized source, PNG bytes, pixels and licences are independently checked before returning. */
async function materialize(scene: SceneDocument, signal?: AbortSignal): Promise<EditableProject> {
  return materializeVisualArt(scene, VISUAL_SAMPLE_ART, VISUAL_SAMPLE_LICENSE, assetId, signal)
}

export async function createVisualSampleProject(kind: VisualSampleKind, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materialize(createVisualSampleDocument(kind, { sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), signal)
}

const blankSide = z.number().int().min(1000).max(200000)
const visualBlankOptions = z.object({ title: z.string().trim().min(1).max(120), widthMm: blankSide, heightMm: blankSide,
  preset: z.enum(['investigation', 'tactical', 'narrative']), gridVisible: z.boolean().optional(), sceneId: z.string().min(1).max(256).refine(value => value !== '__proto__').optional(), now: z.string().datetime().optional(),
}).strict().refine(value => Math.max(value.widthMm, value.heightMm) / Math.min(value.widthMm, value.heightMm) <= 20, '画布长宽比最多为20:1。')

/** Empty scene-v2 with the original fixed visual palette; no sample placement or atmosphere is copied. */
export function createVisualBlankDocument(input: BlankOptions): SceneDocument {
  const options = visualBlankOptions.parse(captureJson(input)), preset = BLANK_PRESETS.find(value => value.id === options.preset)!, now = options.now ?? runtime.clock.now()
  const scene = baseScene('beach', options.sceneId ?? runtime.ids.nextId(), now), bounds = { x: 0, y: 0, width: options.widthMm, height: options.heightMm }
  scene.title = options.title; scene.exportBoundsMm = { ...bounds }; scene.floors[FLOOR].boundsMm = { ...bounds }
  scene.units = { world: 'mm', display: preset.display, gridSizeMm: preset.gridSizeMm, snapMm: preset.snapMm, gridVisible: options.gridVisible ?? preset.gridVisible }
  scene.presetSnapshot = { presetId: `visual-${preset.id}`, presetVersion: 1, distanceMode: preset.distanceMode, source: `Sceneweave 通用${preset.name}偏好与24项原创视觉素材；非官方规则`, gridSizeMm: preset.gridSizeMm }
  scene.visual = emptyVisualSystem()
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`视觉空白工程无效：${checked.errors.map(issue => issue.message).join('；')}`)
  return checked.document
}

export async function createVisualBlankProject(options: BlankOptions, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materialize(createVisualBlankDocument(options), signal)
}
