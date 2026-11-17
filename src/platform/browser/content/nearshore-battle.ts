import type { MaterialPaint, SceneDocument } from '../../../shared/model/scene.js'
import { createOceanDocument } from './ocean-sample.js'
import { materializeSceneCollectionDocument } from './scene-collection-catalog.js'
import { createShoreBlankDocument } from './shore-blank.js'
import { SHORE_ART, SHORE_LICENSE, SHORE_MATERIAL_IDS, shoreAssetId } from '../../../shared/visual/shore-art.js'
import { applyShoreSurfaceRecipe } from '../../../shared/visual/shore-surfaces.js'
import { visualBase } from '../../../shared/visual/base.js'
import { sampleVisualBoundary } from '../../../shared/visual/geometry.js'
import type { VisualBoundary } from '../../../shared/visual/types.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { runtime } from '../runtime.js'
import { naturalContourSegments } from '../../../shared/visual/natural-contours.js'

export const NEARSHORE_BATTLE_NAME = '碎潮礁湾 · 近岸海战'

/** Existing terrain/material/shore recipe; there is no separate ocean coast model. */
export function createNearshoreBattleDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  let scene = createOceanDocument(options)
  scene.title = NEARSHORE_BATTLE_NAME
  const floorId = 'collection-floor', layerId = 'collection-structure'
  const palette = createShoreBlankDocument('coast', { sceneId: 'nearshore-palette', title: '岸线材质来源', widthMm: 40000, heightMm: 30000, preset: 'tactical', now: scene.updatedAt })
  for (const id of Object.values(SHORE_MATERIAL_IDS)) {
    const material = cloneJson(palette.materials[id])
    scene.materials[id] = material; scene.assets[material.textureAssetId] = cloneJson(palette.assets[material.textureAssetId])
  }
  const paint = (materialId: string): MaterialPaint => ({ materialRef: { id: materialId, version: 1 },
    tileSizeMm: { ...scene.materials[materialId].defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 })
  scene.terrainAreas['ocean-open-water'].surfaceStyle = { base: paint(SHORE_MATERIAL_IDS.waterDeep), overlays: [] }
  scene.terrainAreas['ocean-shallows'].surfaceStyle = { base: paint(SHORE_MATERIAL_IDS.waterShallow), overlays: [] }
  scene.terrainAreas['ocean-shallows'].boundaryBlendMm = 1100
  const shallow = scene.terrainAreas['ocean-shallows'], shallowId = 'battle-shallow-transition'
  const shallowBoundary: VisualBoundary = {
    id: shallowId, floorId, layerId, visibility: 'public', editLocked: false, closed: false,
    segments: naturalContourSegments(shallow.boundaryMm.slice(1).map(point => point.positionMm), {
      closed: false, kind: 'natural', strength: .88, variationMm: 480, seed: 'nearshore-shallows2', idPrefix: shallowId }),
    sampleSpacingMm: 650, toleranceMm: 20,
    binding: { kind: 'terrain', sides: [{ areaId: shallow.id, startPointId: shallow.boundaryMm[1].id, endPointId: shallow.boundaryMm.at(-1)!.id, reverse: false }] },
  }
  // New authored construction, using the same saved curve samples as the tool.
  // It is not a command applied to an existing user's scene.
  shallow.boundaryMm = [{ x: 0, y: 0 }, ...sampleVisualBoundary(shallowBoundary).points].map((positionMm, i) => ({
    id: `${shallow.id}-p${i}`, segmentId: `${shallow.id}-s${i}`, positionMm }))
  shallowBoundary.binding = { kind: 'terrain', sides: [{ areaId: shallow.id, startPointId: shallow.boundaryMm[1].id,
    endPointId: shallow.boundaryMm.at(-1)!.id, reverse: false }] }
  visualBase(scene)!.boundaries[shallowId] = shallowBoundary
  // Explicit authored cubic controls, sampled by the normal terrain curve tool.
  // Each row is startX/startY/control1X/control1Y/control2X/control2Y.
  const land = (id: string, curves: [number, number, number, number, number, number][], material: string, elevation: number, priority: number, blend: number) => {
    const boundaryId = `${id}-coast`
    const boundary: VisualBoundary = { id: boundaryId, floorId, layerId, editLocked: false, visibility: 'public', closed: true,
      segments: curves.map(([x, y, c1x, c1y, c2x, c2y], i) => ({ id: `${boundaryId}-s${i}`, start: { x, y },
        control1: { x: c1x, y: c1y }, control2: { x: c2x, y: c2y }, end: { x: curves[(i + 1) % curves.length][0], y: curves[(i + 1) % curves.length][1] } })),
      sampleSpacingMm: 650, toleranceMm: 20, binding: { kind: 'terrain', sides: [{ areaId: id, startPointId: `${id}-p0`, endPointId: `${id}-p0`, reverse: false }] } }
    boundary.segments = naturalContourSegments(boundary.segments.map(segment => segment.start), { closed: true,
      kind: 'natural', strength: .86, variationMm: 250, seed: id, idPrefix: boundaryId })
    const points = sampleVisualBoundary(boundary).points
    scene.terrainAreas[id] = { id, floorId, editLocked: false, visibility: 'public',
      boundaryMm: points.map((positionMm, i) => ({ id: `${id}-p${i}`, segmentId: `${id}-s${i}`, positionMm })),
      coveragePriority: priority, groundElevationMm: elevation, surfaceStyle: { base: paint(material), overlays: [] },
      blocksMovement: false, blocksSight: false, movementCostMultiplier: 1, boundaryBlendMm: blend }
    scene.entityLayers[id] = layerId
    visualBase(scene)!.boundaries[boundaryId] = boundary
  }
  land('battle-sandy-islet', [
    [2300, 1600, 3200, 1000, 5300, 1300], [6000, 2000, 6900, 2700, 7900, 3700],
    [7600, 4500, 7400, 5600, 6500, 7200], [6200, 7800, 5700, 8500, 4400, 8800],
    [4600, 9600, 4700, 10800, 6500, 11300], [6200, 12800, 6000, 13800, 6400, 14500],
    [5700, 15500, 5000, 16900, 3700, 18300], [3000, 17800, 2100, 17000, 1500, 14300],
    [1500, 13000, 1200, 10800, 2000, 8400], [1700, 6500, 1500, 4200, 1400, 2500],
  ], SHORE_MATERIAL_IDS.sandDry, 0, 4, 180)
  land('battle-north-reef', [
    [25100, 1800, 25900, 1500, 26700, 1100], [27200, 1400, 27900, 1800, 28800, 2200],
    [28500, 2900, 28200, 3500, 28100, 4000], [27800, 4400, 27100, 4800, 26200, 5100],
    [25600, 4800, 25000, 4300, 24200, 4200], [24500, 3400, 24800, 2800, 24500, 2100],
  ], SHORE_MATERIAL_IDS.rockDry, 350, 5, 100)
  land('battle-south-reef', [
    [19600, 25400, 20200, 25100, 20600, 24200], [21300, 24500, 22100, 24800, 22900, 25000],
    [22900, 25700, 23200, 26400, 23000, 27100], [22400, 27600, 21700, 27900, 21000, 28400],
    [20200, 27900, 19400, 27700, 18800, 27300], [19000, 26600, 19100, 26100, 19200, 25600],
  ], SHORE_MATERIAL_IDS.rockDry, 250, 5, 100)
  scene.props['ocean-manta'].positionMm = { x: 5000, y: 21000 }
  scene.props['ocean-school'].positionMm = { x: 3500, y: 24200 }
  for (const id of ['ocean-cutter', 'ocean-dinghy']) scene.props[id].waterAppearance = { mode: 'surface', surfaceEffects: { ripples: .7, wakeLengthMm: id === 'ocean-cutter' ? 4200 : 1800 } }
  scene.props['ocean-kraken'].waterAppearance = { mode: 'partial', depth: .3, submergedFraction: .5, surfaceEffects: { ripples: .75, wakeLengthMm: 0 } }
  scene = applyShoreSurfaceRecipe(scene, 'nearshore-battle-v2', { shoreProfile: 'natural2' })
  // Keep the recipe's opaque, world-phase shore overlays so overlapping chunk
  // caps remain idempotent. Adjust only the normal edge looks for this scale.
  for (const look of Object.values(visualBase(scene)!.edgeLooks)) {
    if (look.kind === 'shore') { look.widthMm = 240; look.opacity = .36 }
    if (look.kind === 'cliff') look.widthMm = 220
  }
  scene.presetSnapshot = { ...scene.presetSnapshot, presetId: 'sceneweave-nearshore-battle', presetVersion: 2,
    source: '原创近岸海战；复用地形羽化、岸崖材质与边带；静态尾流不表示船体运动或航行通路' }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`近岸海战样图无效：${checked.errors.map(row => `${row.entityId ?? ''}:${row.message}`).join('；')}`)
  return checked.document
}

export function createNearshoreBattleProject(signal?: AbortSignal) {
  signal?.throwIfAborted()
  const scene = createNearshoreBattleDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  return materializeSceneCollectionDocument(scene, [{ artwork: SHORE_ART, assetId: shoreAssetId, licenseText: SHORE_LICENSE }], signal)
}
