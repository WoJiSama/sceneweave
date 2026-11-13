import { createVisualBlankDocument } from '../../src/platform/browser/content/visual-samples.js'
import type { PointMm, SceneDocument, SurfaceStyle, TerrainArea, TerrainConnection } from '../../src/shared/model/scene.js'
import { validateSceneDocument } from '../../src/shared/validation/scene.js'
import { visualBase } from '../../src/shared/visual/base.js'
import { sampleVisualBoundary } from '../../src/shared/visual/geometry.js'
import { sampleConnectionRoute } from '../../src/shared/geometry/connection-route.js'
import type { VisualBoundary, VisualEdgeLook } from '../../src/shared/visual/types.js'

const FLOOR = 'visual-floor', GROUND = 'visual-layer-ground', DETAILS = 'visual-layer-details'
const p = (x: number, y: number): PointMm => ({ x, y })
const rect = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]

/** Independent native scene, with no reference-island coordinates, resources,
 * recipe IDs or source artwork. Private variants share one fixed mask. */
export function terrainCliffFixture(privateVariant: 0 | 1 = 0, mode: 'height' | 'natural' | 'layered' | 'sculpted' = 'height', outline: 'coastal' | 'headland' = 'coastal'): SceneDocument {
  const scene = createVisualBlankDocument({ title: '独立检查 · 海岸多级岩台与弯曲岩阶', widthMm: 30000, heightMm: 24000,
    preset: 'narrative', sceneId: 'independent-coastal-terraces', now: '2026-11-12T00:00:00.000Z', gridVisible: false })
  scene.units.gridSizeMm = 1500
  const visual = visualBase(scene)!
  visual.environment = { ambientColor: '#FFFFFF', ambientOpacity: 0, exposure: 1, lightDirectionDeg: 225, contactShadowMm: 0, contactShadowOpacity: 0 }
  const style = (key: string): SurfaceStyle => {
    const material = scene.materials[`visual-material-${key}`]
    return { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm },
      rotationDeg: 0, alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] }
  }
  const area = (id: string, points: PointMm[], elevation: number, priority: number, material: string, visibility: 'public' | 'gm' = 'public'): TerrainArea => {
    const value: TerrainArea = { id, floorId: FLOOR, visibility, editLocked: false, groundElevationMm: elevation, coveragePriority: priority,
      boundaryMm: points.map((positionMm, i) => ({ id: `${id}-point-${i}`, segmentId: `${id}-edge-${i}`, positionMm })),
      surfaceStyle: style(material), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.terrainAreas[id] = value; scene.entityLayers[id] = GROUND; return value
  }
  const cliff = (id: string, area: TerrainArea) => {
    const points = area.boundaryMm.map(a => a.positionMm)
    const boundary: VisualBoundary = { id, floorId: FLOOR, layerId: DETAILS, visibility: area.visibility, editLocked: false,
      closed: true, segments: points.map((start, i) => { const end = points[(i + 1) % points.length]
        return { id: `${id}-control-${i}`, start: { ...start }, control1: { ...start }, control2: { ...end }, end: { ...end } } }),
      sampleSpacingMm: 20000, toleranceMm: 20, binding: { kind: 'decoration' } }
    const sampled = sampleVisualBoundary(boundary)
    area.boundaryMm = sampled.points.map((positionMm, i) => ({ id: `${area.id}-point-${i}`, segmentId: `${area.id}-edge-${i}`, positionMm }))
    boundary.binding = { kind: 'terrain', sides: [{ areaId: area.id, startPointId: area.boundaryMm[0].id, endPointId: area.boundaryMm[0].id, reverse: false }] }
    visual.boundaries[id] = boundary
    const look: VisualEdgeLook = { id: `${id}-look`, floorId: FLOOR, layerId: DETAILS, visibility: area.visibility, editLocked: false,
      boundaryId: id, kind: 'cliff', side: 'both', widthMm: 1800, color: '#66747C', accentColor: '#D3C5A6',
      opacity: 1, intensity: .9, repeatMm: 430, seed: 'independent-strata-field', renderProfile: mode === 'sculpted' ? 'rockRelief9' : mode === 'layered' ? 'rockRelief8' : mode === 'natural' ? 'rockRelief7' : 'rockRelief6', enabled: true }
    visual.edgeLooks[look.id] = look
  }
  const stairs = (id: string, from: TerrainArea, to: TerrainArea, points: [PointMm, PointMm, PointMm, PointMm], visibility: 'public' | 'gm', widthMm: number) => {
    const [start, control1, control2, end] = points
    const source = { version: 1 as const, kind: 'cubic' as const, segments: [{ id: `${id}-source`, start, control1, control2, end }],
      sampleSpacingMm: 220, toleranceMm: 8, stairStyle: 'naturalRock' as const, treadDepthMm: 320, renderProfile: mode === 'sculpted' ? 'naturalRockSteps8' as const : mode === 'layered' ? 'naturalRockSteps7' as const : mode === 'natural' ? 'naturalRockSteps6' as const : 'naturalRockSteps5' as const }
    const value: TerrainConnection = { id, floorId: FLOOR, visibility, editLocked: false, kind: 'stairs',
      from: { surfaceRef: { kind: 'terrainArea', id: from.id }, positionMm: { ...start } },
      to: { surfaceRef: { kind: 'terrainArea', id: to.id }, positionMm: { ...end } }, widthMm,
      openingId: null, blocksMovement: false, movementCostMultiplier: 1.2, surfaceStyle: style('rockfloor'),
      route: { ...source, centerlineMm: sampleConnectionRoute(source) } }
    scene.terrainConnections[id] = value; scene.entityLayers[id] = DETAILS
  }
  area('independent-sea', rect(0, 0, 30000, 24000), 0, 0, 'water')
  // Shared coastline endpoints are explicitly split in both native rings.
  const westCoast = outline === 'headland'
    ? [p(6000, 21000), p(2800, 18000), p(3300, 15500), p(7000, 15500), p(7200, 12000), p(3300, 11500), p(2200, 7800), p(4500, 6500)]
    : [p(3000, 21000)]
  const main = area('independent-main', [p(3000, 3000), p(15000, 3000), p(25000, 3000), p(25000, 12000), p(25000, 21000), p(19000, 21000),
    p(19000, 17000), p(16000, 17000), p(16000, 21000), ...westCoast], outline === 'headland' ? 3100 : 2200, 1, 'rockfloor')
  const upper = area('independent-upper', rect(15000, 3000, 10000, 9000), outline === 'headland' ? 5600 : 4200, 2, 'grass')
  cliff('independent-main-coast', main); cliff('independent-upper-coast', upper)
  stairs('independent-public-climb', main, upper, [p(10000, 14000), p(10000, 8000), p(14000, 7000), p(18000, 7000)], 'public', 1500)
  // Broad, explicit privacy protection is invariant between the variants. The
  // private shapes and stair really change, but cannot change public pixels.
  const hidden = area('independent-private-terrace', rect(6000 + privateVariant * 300, 18500, 4000, 2000),
    privateVariant ? 5000 : 3400, 3, 'grass', 'gm')
  cliff('independent-private-boundary', hidden)
  stairs('independent-private-climb', main, hidden,
    privateVariant ? [p(12500, 20000), p(11000, 18000), p(9300, 18800), p(8500, 19500)]
      : [p(12000, 20000), p(11000, 18500), p(9600, 19000), p(8500, 19500)], 'gm', 900)
  scene.regions['independent-private-mask'] = { id: 'independent-private-mask', floorId: FLOOR, visibility: 'gm', editLocked: false,
    kind: 'manualMask', boundaryMm: rect(0, 15000, 14500, 9000), blocksMovement: false, movementCostMultiplier: 1 }
  scene.entityLayers['independent-private-mask'] = DETAILS
  const result = validateSceneDocument(scene)
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.document
}
