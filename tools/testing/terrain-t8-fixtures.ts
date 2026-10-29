import type { EditableProject } from '../../src/application/workspace/project.js'
import type { PointMm, Prop, SceneDocument, SurfaceStyle, TerrainArea } from '../../src/shared/model/scene.js'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import { emptyTerrainDocument } from '../../src/shared/terrain-generation/compose.js'
import { assertTerrainBudget } from '../../src/shared/terrain-generation/cost.js'
import { createRefinedBlankDocument } from '../../src/platform/browser/content/refined-blank.js'
import { REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE } from '../../src/shared/visual/island-art.js'
import { cloneJson } from '../../src/shared/validation/json.js'
import { validateSceneDocument } from '../../src/shared/validation/scene.js'
import { visualBase } from '../../src/shared/visual/base.js'
import { signedVisualArea } from '../../src/shared/visual/geometry.js'
import type { VisualEdgeLook } from '../../src/shared/visual/types.js'

/** Explicit coordinate references for T8 calibration, not a general T9 generator. */
export type T8SampleKind = 'archipelago-coast' | 'forest-valley' | 'grass-rock-hills'
export type T8SampleMode = 'neutral' | 'effect'
export const T8_SAMPLE_KINDS: readonly T8SampleKind[] = Object.freeze(['archipelago-coast', 'forest-valley', 'grass-rock-hills'])
const NOW = '2026-10-28T00:00:00.000Z', FLOOR = 'visual-floor', GROUND = 'visual-layer-ground', DETAILS = 'visual-layer-details', PROPS = 'visual-layer-props'
const p = (x: number, y: number): PointMm => ({ x, y })
const rectangle = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]

export const T8_SAMPLE_SPECS = Object.freeze({
  'archipelago-coast': { title: 'T8 群岛海岸基线', seed: 't8-reference-archipelago-1', widthMm: 48000, heightMm: 36000, landComponents: 3,
    contourErrorMm: 0, detail: '三个明确坐标多边形陆块，最窄分离水带不少于4000mm；不是通用多岛算法输出。' },
  'forest-valley': { title: 'T8 森林河谷基线', seed: 't8-reference-valley-1', widthMm: 48000, heightMm: 36000, landComponents: 2,
    contourErrorMm: 0, detail: '贯穿南北的真实阻挡河面与两侧独立树石；未声明渡水通行。' },
  'grass-rock-hills': { title: 'T8 草岩丘陵基线', seed: 't8-reference-hills-1', widthMm: 48000, heightMm: 36000, landComponents: 1,
    contourErrorMm: 0, detail: '800mm草地和2600mm岩台；实际1600mm宽坡道连接，不以外观伪造高差通行。' },
})
export const T8_CALIBRATION = Object.freeze({ format: 'sceneweave-complete-project', schemaVersion: 3, sceneSchemaVersion: 3,
  visualVersion: 2, appearanceVersion: 2, worldUnits: 'integer-mm', lightDirectionDeg: 135,
  contourConstruction: 'explicit-straight-segments', sampleSpacingMm: 20000, toleranceMm: 30,
  materialTilesMm: { water: 3200, grass: 2500, rock: 2400 },
  physicalFootprints: 'exact unchanged fixed prop-definition defaults; image bounds do not replace footprints',
  layers: ['ground surfaces', 'edge decoration and ground props', 'object/canopy props', 'bounded environment'],
  neutralVsEffect: 'Identical physical entities, fixed assets, materials, supports and full geometry. Neutral disables edge looks and environment only.',
})

function style(document: SceneDocument, material: 'shallows' | 'moss' | 'strata'): SurfaceStyle {
  const definition = document.materials[`refined-material-island-material-${material}`]
  return { base: { materialRef: { id: definition.id, version: definition.version }, tileSizeMm: { ...definition.defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] }
}
function area(document: SceneDocument, id: string, points: PointMm[], material: 'shallows' | 'moss' | 'strata', priority: number, elevation: number, blocked = false): TerrainArea {
  const ring = signedVisualArea(points) < 0 ? [...points].reverse() : points
  const result: TerrainArea = { id, floorId: FLOOR, editLocked: false, visibility: 'public',
    boundaryMm: ring.map((positionMm, i) => ({ id: `${id}-p${i}`, segmentId: `${id}-s${i}`, positionMm: { ...positionMm } })),
    groundElevationMm: elevation, coveragePriority: priority, surfaceStyle: style(document, material), blocksMovement: blocked, blocksSight: false, movementCostMultiplier: 1 }
  document.terrainAreas[id] = result; document.entityLayers[id] = GROUND
  return result
}
function edge(document: SceneDocument, target: TerrainArea, kind: VisualEdgeLook['kind'], seed: string): void {
  const id = `${target.id}-boundary`, points = target.boundaryMm.map(point => point.positionMm), visual = visualBase(document)!
  visual.boundaries[id] = { id, floorId: FLOOR, layerId: GROUND, editLocked: false, visibility: 'public', closed: true, sampleSpacingMm: 20000, toleranceMm: 30,
    segments: points.map((start, index) => { const end = points[(index + 1) % points.length]; return { id: `${id}-c${index}`, start: { ...start }, control1: { ...start }, control2: { ...end }, end: { ...end } } }),
    binding: { kind: 'terrain', sides: [{ areaId: target.id, startPointId: target.boundaryMm[0].id, endPointId: target.boundaryMm[0].id, reverse: false }] } }
  visual.edgeLooks[`${id}-look`] = { id: `${id}-look`, floorId: FLOOR, layerId: DETAILS, editLocked: false, visibility: 'public',
    boundaryId: id, kind, side: 'right', widthMm: kind === 'cliff' ? 700 : 400, color: kind === 'cliff' ? '#8F8069' : '#83A296', accentColor: '#D7D8B9', opacity: .78, intensity: .8, seed, repeatMm: 350, enabled: true }
}
function prop(document: SceneDocument, key: string, x: number, y: number, support: string, rotationDeg = 0): void {
  const definition = document.propDefinitions[`refined-prop-island-${key}`], id = `t8-prop-${Object.keys(document.props).length + 1}`
  if (!definition) throw new Error(`T8 fixed prop missing: ${key}`)
  const item: Prop = { id, floorId: FLOOR, editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: definition.version },
    appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm), positionMm: p(x, y), rotationDeg,
    footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: cloneJson(definition.defaultFootprintOffsetMm),
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, supportRef: { kind: 'terrainArea', id: support },
    renderLayer: definition.defaultRenderLayer, renderOrder: 0, shadowClass: definition.defaultShadowClass, shadowOverride: null }
  document.props[id] = item; document.entityLayers[id] = item.renderLayer === 'ground' ? DETAILS : PROPS
}
function base(kind: T8SampleKind): SceneDocument {
  const spec = T8_SAMPLE_SPECS[kind]
  if (!spec) throw new Error('Unknown T8 sample kind.')
  const document = emptyTerrainDocument(createRefinedBlankDocument('island', { title: spec.title, sceneId: `t8-sample-${kind}`, now: NOW, widthMm: spec.widthMm, heightMm: spec.heightMm, preset: 'narrative', gridVisible: false }))
  document.units.gridVisible = false
  document.presetSnapshot.source = `T8 explicit-coordinate calibration; ${spec.seed}; current fixed original island assets, not general T9 generation`
  return document
}

/** Pure fixed metadata; raster hashes are replaced by real bytes in createT8Sample. */
export function createT8SampleDocument(kind: T8SampleKind, mode: T8SampleMode = 'effect'): SceneDocument {
  if (mode !== 'neutral' && mode !== 'effect') throw new Error('Unknown T8 sample mode.')
  const document = base(kind), spec = T8_SAMPLE_SPECS[kind], before = cloneJson(document)
  if (kind === 'archipelago-coast') {
    area(document, 't8-water', rectangle(0, 0, 48000, 36000), 'shallows', 0, 0, true)
    const islands = [
      area(document, 't8-island-west', [p(4000, 6000), p(13000, 4000), p(20000, 9000), p(18000, 17000), p(9000, 19000), p(3000, 13000)], 'strata', 1, 800),
      area(document, 't8-island-east', [p(29000, 5000), p(39000, 4000), p(45000, 10000), p(41000, 19000), p(32000, 18000), p(27000, 12000)], 'moss', 1, 800),
      area(document, 't8-island-south', [p(15000, 26000), p(24000, 23000), p(31000, 27000), p(29000, 33000), p(20000, 34000), p(14000, 30000)], 'strata', 1, 800),
    ]
    for (const island of islands) edge(document, island, 'shore', spec.seed)
    prop(document, 'tree-windbent', 10000, 11000, islands[0].id, 20)
    prop(document, 'rock-layered-shelf', 15000, 12000, islands[0].id, 35)
    prop(document, 'tree-north-asym', 34000, 10000, islands[1].id, 10)
    prop(document, 'tree-split-crown', 39000, 13000, islands[1].id, 25)
    prop(document, 'rock-north-ridge', 23000, 28000, islands[2].id, 15)
    prop(document, 'shrub-scree-sedge', 26000, 30000, islands[2].id)
  } else if (kind === 'forest-valley') {
    area(document, 't8-ground', [p(0, 0), p(22000, 0), p(28000, 0), p(48000, 0), p(48000, 36000), p(28000, 36000), p(22000, 36000), p(0, 36000)], 'moss', 0, 800)
    const water = area(document, 't8-river', [p(22000, 0), p(28000, 0), p(30000, 12000), p(26000, 24000), p(28000, 36000), p(22000, 36000), p(20000, 24000), p(24000, 12000)], 'shallows', 1, 0, true)
    edge(document, water, 'shore', spec.seed)
    const trees: [number, number, string][] = [[7000, 6000, 'tree-north-asym'], [12000, 7000, 'tree-windbent'], [6000, 13000, 'tree-split-crown'], [12000, 17000, 'tree-north-asym'], [8000, 27000, 'tree-windbent'], [15000, 30000, 'tree-split-crown'], [35000, 5000, 'tree-split-crown'], [40000, 9000, 'tree-north-asym'], [36000, 16000, 'tree-windbent'], [41000, 24000, 'tree-split-crown'], [35000, 30000, 'tree-north-asym'], [42000, 31000, 'tree-windbent']]
    for (const [x, y, key] of trees) prop(document, key, x, y, 't8-ground', 15)
    prop(document, 'rock-north-ridge', 14000, 22000, 't8-ground', 30)
    prop(document, 'rock-layered-shelf', 34000, 23000, 't8-ground', 10)
  } else {
    area(document, 't8-ground', rectangle(0, 0, 48000, 36000), 'moss', 0, 800)
    const high = area(document, 't8-highland', [p(15000, 10000), p(28000, 7000), p(37000, 14000), p(34000, 24000), p(22000, 28000), p(13000, 21000)], 'strata', 1, 2600)
    edge(document, high, 'cliff', spec.seed)
    const id = 't8-highland-ramp'
    document.terrainConnections[id] = { id, floorId: FLOOR, editLocked: false, visibility: 'public', kind: 'ramp',
      from: { surfaceRef: { kind: 'terrainArea', id: 't8-ground' }, positionMm: p(10000, 18000) },
      to: { surfaceRef: { kind: 'terrainArea', id: high.id }, positionMm: p(18000, 18000) }, widthMm: 1600, openingId: null, blocksMovement: false, movementCostMultiplier: 1.2, surfaceStyle: style(document, 'strata') }
    document.entityLayers[id] = GROUND
    prop(document, 'rock-north-ridge', 24000, 13000, high.id, 10)
    prop(document, 'rock-layered-shelf', 29000, 18000, high.id, 35)
    prop(document, 'rock-tidepool', 23000, 23000, high.id, 20)
    prop(document, 'tree-north-asym', 7000, 8000, 't8-ground', 20)
    prop(document, 'tree-windbent', 42000, 28000, 't8-ground', 5)
    prop(document, 'shrub-scree-sedge', 9000, 27000, 't8-ground')
  }
  const visual = visualBase(document)!
  visual.environment = { ambientColor: '#D8DDC5', ambientOpacity: mode === 'effect' ? .08 : 0, exposure: 1, lightDirectionDeg: 135, contactShadowMm: mode === 'effect' ? 180 : 0, contactShadowOpacity: mode === 'effect' ? .2 : 0 }
  for (const look of Object.values(visual.edgeLooks)) look.enabled = mode === 'effect'
  for (const theme of Object.values(document.styleThemes)) for (const shadow of Object.values(theme.shadowPresets)) if (shadow) shadow.directionDeg = 135
  assertTerrainBudget(before, document)
  const checked = validateSceneDocument(document)
  if (!checked.ok) throw new Error(`T8 ${kind}: ${checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('; ')}`)
  return checked.document
}

/** Browser-only: real SVG/PNG/bytes/licences, deterministic identities, complete strict v3. */
export async function createT8Sample(kind: T8SampleKind, mode: T8SampleMode = 'effect', signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const document = createT8SampleDocument(kind, mode)
  // The existing art materializer owns original-byte/raster and licence checks.
  const { materializeVisualArt } = await import('../../src/platform/browser/content/visual-art-project.js')
  const { materializeProject } = await import('../../src/application/workspace/prepare.js')
  const { validation } = await import('../../src/platform/browser/runtime.js')
  const sourceDocument = createRefinedBlankDocument('island', { title: T8_SAMPLE_SPECS[kind].title, sceneId: document.sceneId, now: NOW, widthMm: 48000, heightMm: 36000, preset: 'narrative', gridVisible: false })
  const source = await materializeVisualArt(sourceDocument, REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE, key => `refined-art-${key}`, signal)
  document.assets = cloneJson(source.document.assets)
  let index = 0
  const runtime = { ids: { nextId: () => `t8-${kind}-${mode}-identity-${++index}` }, clock: { now: () => NOW } }
  const content = createCompositionContent(document, runtime)
  return materializeProject({ ...source, schemaVersion: 3, ...content }, { runtime, validation, signal })
}
