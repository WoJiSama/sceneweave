import { visualBase } from '../../../shared/visual/base.js'
import type { PointMm, Prop, PropTemplate, SceneDocument, SurfaceStyle } from '../../../shared/model/scene.js'
import { REFINED_INTERIOR_ART, REFINED_INTERIOR_LICENSE } from '../../../shared/visual/interior-art.js'
import { assertDoorwayClearances } from '../../../shared/geometry/doorway-clearance.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import type { EditableProject } from '../../../application/workspace/project.js'
import { createVisualBlankDocument } from './visual-samples.js'
import { materializeVisualArt } from './visual-art-project.js'
import { runtime } from '../runtime.js'

export const REFINED_INTERIOR_NAME = '灯下旅舍 · 精修版'
const FLOOR = 'visual-floor', GROUND = 'visual-layer-ground', PROPS = 'visual-layer-props', EFFECTS = 'visual-layer-effects'
const point = (x: number, y: number): PointMm => ({ x, y })
const ref = (id: string) => ({ id, version: 1 })
const assetId = (key: string) => `refined-art-${key}`
const propId = (key: string) => `refined-prop-interior-${key}`
const materialId = (key: string) => `refined-material-interior-material-${key}`
const origin = { kind: 'original' as const, attribution: 'Sceneweave Q2原创旅舍与独立固定素材第1版；SVG/实际PNG/确切MIT许可完整保存；未嵌入参考图像', canEmbed: true }
const entity = (id: string, layerId = GROUND) => ({ id, floorId: FLOOR, editLocked: false, visibility: 'public' as const, layerId })

function paint(scene: SceneDocument, key: string, rotationDeg = 0): SurfaceStyle {
  const id = materialId(key)
  return { base: { materialRef: ref(id), tileSizeMm: { ...scene.materials[id].defaultTileSizeMm }, rotationDeg, alignment: 'world', originMm: point(0, 0), tint: null, opacity: 1 }, overlays: [] }
}
function place(scene: SceneDocument, key: string, x: number, y: number, rotationDeg: number, roomId: string, scale = 1): string {
  const definition = scene.propDefinitions[propId(key)], id = `q2-${key}-${Object.keys(scene.props).length + 1}`
  const v = definition.defaultVisualBoundsMm, footprint = definition.defaultFootprintMm
  const prop: Prop = { id, floorId: FLOOR, editLocked: false, visibility: 'public', definitionRef: ref(definition.id), appearance: { ...definition.defaultAppearance },
    positionMm: point(x, y), rotationDeg, visualBoundsMm: { x: Math.round(v.x * scale), y: Math.round(v.y * scale), width: Math.round(v.width * scale), height: Math.round(v.height * scale) },
    footprintMm: { width: Math.round(footprint.width * scale), height: Math.round(footprint.height * scale) }, footprintOffsetMm: point(0, 0),
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, supportRef: { kind: 'room', id: roomId }, roomId,
    renderLayer: definition.defaultRenderLayer, renderOrder: ['tableware', 'papers-books', 'lantern-brass'].includes(key) ? 30 : 0,
    shadowClass: definition.defaultShadowClass, shadowOverride: null }
  scene.props[id] = prop; scene.entityLayers[id] = PROPS
  return id
}

/** A fixed version and full expanded members; subsequent member changes remain ordinary editable props. */
function fixedGroup(scene: SceneDocument, role: string, name: string, anchor: PointMm, ids: string[]): void {
  const definitionId = `refined-prefab-interior-${role}`, groupId = `q2-group-${role}`
  const members = ids.map((id, index) => {
    const { definitionRef, appearance, positionMm, rotationDeg, visualBoundsMm, footprintMm, footprintOffsetMm, blocksMovement, blocksSight, renderLayer, renderOrder, shadowClass, shadowOverride } = scene.props[id]
    const propTemplate: PropTemplate = { definitionRef: definitionRef ? { ...definitionRef } : null, appearance: { ...appearance }, positionMm: point(positionMm.x - anchor.x, positionMm.y - anchor.y), rotationDeg,
      visualBoundsMm: { ...visualBoundsMm }, footprintMm: { ...footprintMm }, footprintOffsetMm: { ...footprintOffsetMm }, blocksMovement, blocksSight, renderLayer, renderOrder, shadowClass, shadowOverride }
    return { key: `${role}-member-${index + 1}`, propTemplate }
  })
  scene.prefabDefinitions[definitionId] = { id: definitionId, catalogId: `prefab.sceneweave.q2.interior.${role}`, version: 1, licenseRef: 'MIT', origin: { ...origin }, name, tags: ['原创', '灯下旅舍', role, '固定成员'], members }
  scene.prefabInstances[groupId] = { id: groupId, floorId: FLOOR, editLocked: false, visibility: 'public', definitionRef: ref(definitionId), anchorMm: { ...anchor }, rotationDeg: 0,
    members: Object.fromEntries(members.map((member, index) => [member.key, { propId: ids[index], overrideFields: [] }])) }
  scene.entityLayers[groupId] = PROPS
}

/** Five real, connected uses with explicit door approaches, true footprints and restrained local light. */
export function createRefinedInteriorDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const scene = createVisualBlankDocument({ title: REFINED_INTERIOR_NAME, widthMm: 26000, heightMm: 19000, preset: 'narrative',
    sceneId: options.sceneId ?? 'refined-interior-v1', now: options.now ?? '2026-10-26T00:00:00.000Z', gridVisible: false })
  scene.assets = {}; scene.materials = {}; scene.propDefinitions = {}
  for (const art of REFINED_INTERIOR_ART) {
    const id = assetId(art.key)
    scene.assets[id] = { id, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512, logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: 'MIT', origin: { ...origin } }
    if (art.kind === 'material') {
      const id = `refined-material-${art.key}`
      scene.materials[id] = { id, catalogId: `material.sceneweave.q2.${art.key}`, version: 1, licenseRef: 'MIT', origin: { ...origin }, name: art.name, tags: ['原创', '灯下旅舍', ...(art.tags ?? [])],
        textureAssetId: assetId(art.key), defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
    } else {
      const id = `refined-prop-${art.key}`
      scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.q2.${art.key}`, version: 1, licenseRef: 'MIT', origin: { ...origin }, name: art.name, tags: ['原创', '灯下旅舍', ...(art.tags ?? [])],
        defaultAppearance: { kind: 'image', assetId: assetId(art.key), tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -Math.round(art.widthMm / 2), y: -Math.round(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
        defaultFootprintMm: { ...art.footprintMm! }, defaultFootprintOffsetMm: point(0, 0), defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
    }
  }
  const theme = scene.styleThemes['visual-theme'], themeId = 'refined-interior-theme'
  scene.styleThemes = { [themeId]: { ...theme, id: themeId, catalogId: 'theme.sceneweave.q2.lamplit-oak', name: '灯下灰橡', origin: { ...origin },
    materialSuggestions: Object.keys(scene.materials).map(ref), propSuggestions: Object.keys(scene.propDefinitions).map(ref),
    outline: { widthMm: 37, color: '#414B3E' }, openingStyle: { doorStrokeWidthMm: 26, windowStrokeWidthMm: 18, frameWidthMm: 65, doorFill: '#A79673', windowFill: '#B6C7AF' },
    shadowPresets: { ...theme.shadowPresets,
      furniture: { directionDeg: 50, offsetMm: 115, blurMm: 65, opacity: .2, color: '#43533F' },
      wall: { directionDeg: 50, offsetMm: 180, blurMm: 85, opacity: .22, color: '#40513E' } } } }
  scene.activeStyleThemeRef = ref(themeId)
  scene.presetSnapshot = { presetId: 'sceneweave-refined-interior', presetVersion: 1, distanceMode: 'metric', source: 'Q2原创旅舍第1版：五用途房间、真实共墙门窗与固定家具组；完整可编辑成员和真实PNG；非AI自动生成或参考图复制', gridSizeMm: 1000 }

  const groundId = 'q2-yard'
  scene.terrainAreas[groundId] = { id: groundId, floorId: FLOOR, editLocked: false, visibility: 'public', boundaryMm: [[0, 0], [26000, 0], [26000, 19000], [0, 19000]].map(([x, y], i) => ({ id: `q2-yard-p${i}`, segmentId: `q2-yard-s${i}`, positionMm: point(x, y) })),
    groundElevationMm: 0, coveragePriority: 0, surfaceStyle: paint(scene, 'earth'), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.entityLayers[groundId] = GROUND
  const xs = [2000, 11000, 14500, 24000], ys = [2000, 9500, 17000]
  for (const [r, yMm] of ys.entries()) for (const [c, xMm] of xs.entries()) {
    const id = `q2-v-${c}-${r}`; scene.vertices[id] = { id, floorId: FLOOR, editLocked: false, xMm, yMm }; scene.entityLayers[id] = GROUND
  }
  const vertex = (c: number, r: number) => `q2-v-${c}-${r}`
  const wall = (id: string, start: [number, number], end: [number, number]) => {
    scene.walls[id] = { id, floorId: FLOOR, editLocked: false, startVertexId: vertex(...start), endVertexId: vertex(...end), thicknessMm: 350, blocksMovement: true, blocksSight: true, topStyle: paint(scene, 'plaster') }; scene.entityLayers[id] = GROUND
  }
  for (let c = 0; c < 3; c++) { wall(`q2-wall-north-${c}`, [c, 0], [c + 1, 0]); wall(`q2-wall-south-${c}`, [c, 2], [c + 1, 2]) }
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) wall(`q2-wall-vertical-${c}-${r}`, [c, r], [c, r + 1])
  wall('q2-wall-cross-west', [0, 1], [1, 1]); wall('q2-wall-cross-east', [2, 1], [3, 1])
  const room = (id: string, boundary: [number, number][], purpose: string, material: string, rotation = 0) => {
    scene.rooms[id] = { id, floorId: FLOOR, editLocked: false, boundaryVertexIds: boundary.map(([c, r]) => vertex(c, r)), purpose, visibility: 'public', accessExpectation: 'required', supportRef: { kind: 'terrainArea', id: groundId }, groundElevationMm: 0, floorStyle: paint(scene, material, rotation) }; scene.entityLayers[id] = GROUND
  }
  room('q2-kitchen', [[0, 0], [1, 0], [1, 1], [0, 1]], '厨房：双炉灶、备餐台、食材箱与餐具', 'flags')
  room('q2-dining', [[0, 1], [1, 1], [1, 2], [0, 2]], '餐厅：六席长桌、餐具与布草收纳', 'planks', 0)
  room('q2-hall', [[1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [1, 1]], '门厅：连接四室与南侧正门的连续通路', 'planks', 90)
  room('q2-bedroom', [[2, 0], [3, 0], [3, 1], [2, 1]], '客房：两张床、布草柜与休息小桌', 'planks', 90)
  room('q2-study', [[2, 1], [3, 1], [3, 2], [2, 2]], '书房：书桌、两架书卷与软座阅读角', 'planks', 0)
  const opening = (id: string, wallId: string, offsetMm: number, widthMm: number, kind: 'door' | 'window' = 'door') => {
    const attached = scene.walls[wallId]
    scene.openings[id] = { id, floorId: FLOOR, editLocked: false, wallId, offsetReferenceVertexId: attached.startVertexId, offsetMm, widthMm, kind, state: kind === 'door' ? 'open' : 'closed', locked: false, secret: false, revealed: false }; scene.entityLayers[id] = GROUND
  }
  opening('q2-entry', 'q2-wall-south-1', 950, 1600)
  opening('q2-door-kitchen', 'q2-wall-vertical-1-0', 4800, 1400)
  opening('q2-door-dining', 'q2-wall-vertical-1-1', 2000, 1400)
  opening('q2-door-bedroom', 'q2-wall-vertical-2-0', 4700, 1400)
  opening('q2-door-study', 'q2-wall-vertical-2-1', 2300, 1400)
  opening('q2-door-service', 'q2-wall-cross-west', 2500, 1400)
  opening('q2-window-kitchen', 'q2-wall-vertical-0-0', 1700, 1900, 'window')
  opening('q2-window-kitchen-north', 'q2-wall-north-0', 4500, 1900, 'window')
  opening('q2-window-bedroom', 'q2-wall-north-2', 4000, 2300, 'window')
  opening('q2-window-study', 'q2-wall-vertical-3-1', 3500, 2200, 'window')
  scene.constraints.entranceOpeningIds = ['q2-entry']
  scene.constraints.minDoorWidthMm = 1200

  const kitchen = [
    place(scene, 'stove-masonry', 3800, 3850, 0, 'q2-kitchen'), place(scene, 'counter-kitchen', 7200, 3450, 0, 'q2-kitchen'),
    place(scene, 'cupboard-linen', 9400, 4050, 0, 'q2-kitchen'), place(scene, 'tableware', 7200, 3440, 7, 'q2-kitchen', .7),
    place(scene, 'crate-small', 3500, 6850, 8, 'q2-kitchen'), place(scene, 'basket-linen', 5000, 6900, 343, 'q2-kitchen'),
  ]
  fixedGroup(scene, 'kitchen', '灰石灶与备餐工作带', point(6500, 4000), kitchen)
  place(scene, 'table-round', 7700, 6700, 0, 'q2-kitchen')
  place(scene, 'chair-slat', 6500, 6750, 270, 'q2-kitchen')
  place(scene, 'tableware', 7700, 6700, 18, 'q2-kitchen', .65)
  place(scene, 'lantern-brass', 8100, 6750, 0, 'q2-kitchen')

  const dining = [place(scene, 'rug-geometric', 6500, 13200, 0, 'q2-dining'), place(scene, 'table-long', 6500, 13150, 0, 'q2-dining')]
  for (const [x, y, rotation] of [[5550, 11400, 0], [7450, 11400, 0], [5550, 14900, 180], [7450, 14900, 180], [4050, 13150, 270], [8950, 13150, 90]]) dining.push(place(scene, 'chair-slat', x, y, rotation, 'q2-dining'))
  dining.push(place(scene, 'tableware', 5660, 13100, 3, 'q2-dining', .8), place(scene, 'tableware', 7440, 13200, 183, 'q2-dining', .8), place(scene, 'lantern-brass', 6500, 13150, 0, 'q2-dining'))
  fixedGroup(scene, 'dining', '六席橡木餐桌与青灰织毯', point(6500, 13200), dining)
  place(scene, 'cupboard-linen', 3500, 15800, 0, 'q2-dining')
  place(scene, 'basket-linen', 9400, 15700, 12, 'q2-dining')

  const bedroom = [place(scene, 'bed-indigo', 17000, 4100, 0, 'q2-bedroom'), place(scene, 'bed-sage', 21200, 4100, 0, 'q2-bedroom'),
    place(scene, 'cupboard-linen', 22100, 7450, 0, 'q2-bedroom'), place(scene, 'rug-geometric', 19000, 7350, 0, 'q2-bedroom', .65), place(scene, 'basket-linen', 16250, 8500, 0, 'q2-bedroom', .8)]
  fixedGroup(scene, 'bedroom', '双客床与布草收纳', point(19200, 5500), bedroom)
  place(scene, 'table-round', 18100, 7350, 0, 'q2-bedroom')
  place(scene, 'chair-cushion', 19400, 7350, 90, 'q2-bedroom')
  place(scene, 'lantern-brass', 18100, 7350, 0, 'q2-bedroom')
  place(scene, 'papers-books', 17800, 7450, 16, 'q2-bedroom', .5)

  const study = [place(scene, 'shelf-books', 17800, 10700, 0, 'q2-study'), place(scene, 'shelf-books', 22550, 11250, 90, 'q2-study'),
    place(scene, 'desk-writing', 18000, 14300, 0, 'q2-study'), place(scene, 'chair-cushion', 18000, 15400, 180, 'q2-study'),
    place(scene, 'papers-books', 17850, 14350, 7, 'q2-study', .9), place(scene, 'lantern-brass', 18700, 14300, 0, 'q2-study')]
  fixedGroup(scene, 'study', '书卷架与写作工作位', point(18000, 13700), study)
  const reading = [place(scene, 'rug-geometric', 21300, 14600, 0, 'q2-study', .61), place(scene, 'table-round', 21300, 13150, 0, 'q2-study'),
    place(scene, 'armchair', 20400, 15400, 180, 'q2-study'), place(scene, 'armchair', 22300, 15400, 180, 'q2-study'),
    place(scene, 'papers-books', 21300, 13150, 350, 'q2-study', .7), place(scene, 'lantern-brass', 21620, 13180, 0, 'q2-study')]
  fixedGroup(scene, 'reading', '双软座阅读角', point(21300, 14400), reading)
  place(scene, 'runner', 12750, 10700, 0, 'q2-hall')

  scene.styleThemes[themeId].prefabSuggestions = Object.keys(scene.prefabDefinitions).map(ref)
  visualBase(scene)!.environment = { ambientColor: '#606F5D', ambientOpacity: .11, exposure: 1.01, lightDirectionDeg: 50, contactShadowMm: 50, contactShadowOpacity: .18 }
  const light = (id: string, x: number, y: number, radiusMm: number, intensity: number) => {
    visualBase(scene)!.lights[id] = { ...entity(id, EFFECTS), positionMm: point(x, y), radiusMm, color: '#E9C78D', intensity, wallOcclusion: true, enabled: true }
  }
  light('q2-light-kitchen', 8100, 6750, 2800, .2)
  light('q2-light-dining', 6500, 13150, 4700, .26)
  light('q2-light-bedroom', 18100, 7350, 2500, .18)
  light('q2-light-study', 18700, 14300, 2700, .22)
  light('q2-light-reading', 21620, 13180, 2500, .17)
  visualBase(scene)!.filters['q2-paper-tone'] = { ...entity('q2-paper-tone', EFFECTS), target: { kind: 'scene' }, preset: 'warm', exposure: 1, saturation: .96, contrast: 1.03, vignette: .035, grain: .012, seed: 'q2-inn-paper-1', enabled: true }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`精修旅舍无效：${checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  assertDoorwayClearances(checked.document, Object.values(checked.document.openings).filter(value => value.kind === 'door').map(value => ({ openingId: value.id, minWidthMm: 1200, approachDepthMm: 1200 })))
  return checked.document
}

export async function createRefinedInteriorProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materializeVisualArt(createRefinedInteriorDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), REFINED_INTERIOR_ART, REFINED_INTERIOR_LICENSE, assetId, signal)
}
