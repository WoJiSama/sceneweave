import { connectionFootprint } from '../geometry/geometry.js'
import { projectPropVolumes } from './spatial-props.js'
import { connectionCenterline } from '../geometry/connection-route.js'
import { carvedStripCenterline } from '../carved-rock/index.js'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import { planTerrainInlay } from '../terrain-inlay/geometry.js'
import { terrainInlayCenterline, terrainInlayFootprint } from '../terrain-inlay/scene.js'
import { captureCarvedRockHost, carvedRockFaces } from '../carved-rock/index.js'
import { createCarvedRockPaintPlan } from '../carved-rock/paint-plan.js'
import { createRockShellPaintPlan } from '../rock-shell/index.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { associateScenePresentations, copyScenePresentations, effectivePropShadow, scenePresentation } from '../appearance/presentation.js'
import { visualBase } from '../visual/base.js'
import { projectVisualSystem } from '../visual/projection.js'
import { wallShadowStyle } from '../visual/directional-light.js'
import { activeArtStyles } from '../visual/art-style.js'
import { isShoreWaterTerrain } from '../visual/shore-surfaces.js'
import { shorelinePaintPadding } from './shorelines.js'
import { cloneJson } from '../validation/json.js'
import { WALL_RELIEF_LIMIT_MM } from '../appearance/wall-edge-profile.js'
import type { BoundsMm, EdgeStyle, Note, PointMm, Prop, ShadowStyle, SurfaceRef, SurfaceStyle, TerrainArea, TerrainEdge } from '../model/scene.js'
import type { SceneDocument } from '../model/scene.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import { openingEndpoints, pointInPolygon, roomPoints, terrainPoints } from '../geometry/geometry.js'
import { fitSteelLandingFacades, planBridgeEntrances } from './bridge-entrances.js'
import { pathAnchorPosition, pathDecorationPadding, pathEdgeStyle, projectDoorThreshold, projectPath } from './paths.js'
import { roadEffectsPolygon } from '../geometry/road-domain.js'
import { roadBankMaterial } from './road-material.js'
import { projectMaterialBrushes } from './material-drawing.js'
import { regionalEntityVisibility } from '../terrain-generation/integrity.js'
import { decorationPaintGeometry, decorationPaintBounds } from '../decorations/presentation.js'
import { resolveSurfaceRules } from '../surface-rules/resolve.js'
import { propPaintEnvelope } from './presentation-contract.js'
import { resolveFloorOutput, type FloorOutput } from '../floors/output.js'
import { collectPlayerCoverageIssues, PlayerCoverageError, type PlayerCoverageIssue, type PlayerCoverageRequirement } from './privacy-coverage.js'
import { playerMaskContains } from './player-mask.js'
import { terrainFacadeOffset } from '../appearance/terrain-facade.js'
import type { PathAssembly } from '../path-assembly/contracts.js'
export { PlayerCoverageError, type PlayerCoverageIssue } from './privacy-coverage.js'

import type { Audience, ProjectedSurface, ProjectedTerrainEdge, ProjectedConnection, ProjectedWall, ProjectedNote, Projection } from './types.js'
export type { Audience, ProjectedSurface, ProjectedMaterialPatch, ProjectedTerrainEdge, ProjectedConnection, ProjectedPath, ProjectedOpening, ProjectedWall, ProjectedNote, ProjectedRegion, ProjectedRegionalArea, ProjectedRegionalLine, ProjectedRegionalLandmark, ProjectedRegionalSymbol, Projection } from './types.js'
const EPS = 1e-6
const clone = <T>(value: T): T => cloneJson(value)
const point = (x: number, y: number): PointMm => ({ x, y })
const midpoint = (a: PointMm, b: PointMm): PointMm => point((a.x + b.x) / 2, (a.y + b.y) / 2)
const center = (points: PointMm[]): PointMm => point(points.reduce((sum, p) => sum + p.x, 0) / points.length, points.reduce((sum, p) => sum + p.y, 0) / points.length)
export const pointsBounds = (points: PointMm[]): BoundsMm => ({ x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) })
const inflate = (b: BoundsMm, padding: number): BoundsMm => ({ x: b.x - padding, y: b.y - padding, width: b.width + padding * 2, height: b.height + padding * 2 })
const includesPoint = (r: BoundsMm, p: PointMm) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height
const intersects = (a: BoundsMm, b: BoundsMm): BoundsMm | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}
function simplify(points: PointMm[]): PointMm[] {
  return points.filter((p, i) => {
    const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length]
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > EPS
  }).map(p => ({ ...p }))
}
function maskRectangle(points: PointMm[]): BoundsMm {
  const ring = simplify(points)
  if (ring.length !== 4 || ring.some((p, i) => p.x !== ring[(i + 1) % ring.length].x && p.y !== ring[(i + 1) % ring.length].y)) throw new Error('玩家输出不安全：遮罩须为固定的轴对齐矩形。')
  const box = pointsBounds(ring)
  if (!(box.width > 0 && box.height > 0)) throw new Error('玩家输出不安全：遮罩须有面积。')
  return box
}
/** A union of rectangles can cover a private object without one rectangle covering it alone. */
export function boundsCovered(bounds: BoundsMm, rectangles: BoundsMm[]): boolean {
  const cuts = [...new Set([bounds.x, bounds.x + bounds.width, ...rectangles.flatMap(r => [r.x, r.x + r.width])])].filter(x => x >= bounds.x && x <= bounds.x + bounds.width).sort((a, b) => a - b)
  for (let i = 1; i < cuts.length; i++) {
    const x = (cuts[i - 1] + cuts[i]) / 2
    const intervals = rectangles.filter(r => x >= r.x && x <= r.x + r.width).map(r => [r.y, r.y + r.height]).sort((a, b) => a[0] - b[0])
    let to = bounds.y
    for (const [start, end] of intervals) { if (start > to + EPS) break; to = Math.max(to, end) }
    if (to < bounds.y + bounds.height - EPS) return false
  }
  return cuts.length > 1
}

export function transformedVisualBounds(prop: Prop): BoundsMm {
  const v = prop.visualBoundsMm, a = prop.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return pointsBounds([[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]].map(([x, y]) => point(prop.positionMm.x + x * c - y * s, prop.positionMm.y + x * s + y * c)))
}
export const shadowPadding = (shadow: ShadowStyle | null | undefined) => shadow && shadow.opacity ? shadow.offsetMm + shadow.blurMm * 4 : 0
const styleKey = (style: SurfaceStyle | null) => JSON.stringify(style)
const wallOrder = (a: ProjectedWall, b: ProjectedWall) => a.start.y - b.start.y || a.start.x - b.start.x || a.end.y - b.end.y || a.end.x - b.end.x || a.thicknessMm - b.thicknessMm || styleKey(a.style).localeCompare(styleKey(b.style))
export { wallOrder }
const close = (a: PointMm, b: PointMm) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** Canonical collinear merges prevent private split vertices creating public seams or joins. */
function canonicalWalls(walls: ProjectedWall[], compareLayer: (a: { id: string }, b: { id: string }) => number, openingRanks: Map<string, number>, projectedOpeningRanks: Map<string, number>): ProjectedWall[] {
  for (const wall of walls) if (wall.start.x > wall.end.x || wall.start.x === wall.end.x && wall.start.y > wall.end.y) [wall.start, wall.end] = [wall.end, wall.start]
  // Endpoints are oriented along +x (or +y for vertical walls); merge in that
  // same direction so negative slopes cannot put a successor before its join.
  walls.sort((a, b) => a.start.x - b.start.x || a.start.y - b.start.y || a.end.x - b.end.x || a.end.y - b.end.y || wallOrder(a, b))
  const result: ProjectedWall[] = []
  for (const wall of walls) {
    const previous = result.find(item => {
      const dx = item.end.x - item.start.x, dy = item.end.y - item.start.y
      return compareLayer(item, wall) === 0 && item.thicknessMm === wall.thicknessMm && item.edgeProfile === wall.edgeProfile && styleKey(item.style) === styleKey(wall.style) && item.blocksLight === wall.blocksLight && close(item.end, wall.start) && Math.abs(dx * (wall.end.y - wall.start.y) - dy * (wall.end.x - wall.start.x)) < EPS * Math.hypot(dx, dy)
    })
    if (previous) { previous.end = wall.end; previous.sourceIds.push(...wall.sourceIds); previous.openings.push(...wall.openings) }
    else result.push(wall)
  }
  return result.sort((a, b) => compareLayer(a, b) || wallOrder(a, b)).map((wall, i) => ({ ...wall, id: `wall-${i}`, sourceIds: [], openings: wall.openings.sort((a, b) => a.start.y - b.start.y || a.start.x - b.start.x).map((o, j) => {
    const id = `opening-${i}-${j}`
    projectedOpeningRanks.set(id, openingRanks.get(o.id) ?? 0)
    return { ...o, id }
  }) }))
}

export const propLayer = { ground: 0, object: 1, canopy: 2 }
export const orderedProps = (props: Prop[]) => [...props].sort((a, b) => propLayer[a.renderLayer] - propLayer[b.renderLayer] || a.renderOrder - b.renderOrder || a.id.localeCompare(b.id))

const defaultEdgeStyles: Record<TerrainEdge['kind'], EdgeStyle> = {
  shore: { strokeWidthMm: 12, color: '#D9D4B4', bandWidthMm: 180 },
  cliff: { strokeWidthMm: 24, color: '#39443E', bandWidthMm: 450 },
  materialTransition: { strokeWidthMm: 0, color: '#71865A', bandWidthMm: 250 },
}
/** Shared by fixed-mask creation and the player projection safety check. */
export function terrainDecorationPadding(scene: SceneDocument, theme: Projection['theme'], floorId?: string): number {
  const cliff = theme?.terrainCliff, shore = theme?.edgeStyles.shore ?? defaultEdgeStyles.shore
  const styles = [...Object.values(theme?.edgeStyles ?? defaultEdgeStyles), ...Object.values(scene.terrainEdges).filter(edge => floorId === undefined || edge.floorId === floorId).flatMap(edge => edge.styleOverride ? [edge.styleOverride] : [])]
  return Math.max(cliff?.maxOffsetMm ?? 600, shore.bandWidthMm * .65 + shore.strokeWidthMm / 2,
    ...styles.map(style => Math.max(style.bandWidthMm * 1.7, style.strokeWidthMm / 2))) + (cliff?.opacity ? cliff.blurMm * 4 : 0)
}
/** Only this audience's surfaces enter coverage resolution. No GM hole/edge cache is reused. */
function deriveTerrainEdges(scene: SceneDocument, areas: TerrainArea[], declarations: TerrainEdge[], theme: Projection['theme']) {
  const water = new Set(areas.filter(area => isShoreWaterTerrain(scene, area)).map(area => area.id))
  // This local index is built only after audience filtering and never survives the projection.
  const byPriority = [...areas].sort((a, b) => b.coveragePriority - a.coveragePriority || a.id.localeCompare(b.id)).map(area => ({ area, points: terrainPoints(area) }))
  const support = (p: PointMm) => byPriority.find(item => pointInPolygon(p, item.points, false))?.area
  const declared = new Map(declarations.map(e => [`${e.source.areaId}\0${e.source.segmentId}`, e]))
  const result = new Map<string, ProjectedTerrainEdge>()
  const shores = new Map<string, { points: [PointMm, PointMm]; areaIds: [string, string] }>()
  for (const area of [...areas].sort((a, b) => a.id.localeCompare(b.id))) for (let i = 0; i < area.boundaryMm.length; i++) {
    const vertex = area.boundaryMm[i], a = vertex.positionMm, b = area.boundaryMm[(i + 1) % area.boundaryMm.length].positionMm
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (!length) continue
    const mid = midpoint(a, b), step = Math.min(.01, length / 100), inward = point(-dy / length * step, dx / length * step)
    const inside = support(point(mid.x + inward.x, mid.y + inward.y)), outside = support(point(mid.x - inward.x, mid.y - inward.y))
    if (inside?.id !== area.id || outside?.id === area.id) continue
    const declaration = declared.get(`${area.id}\0${vertex.segmentId}`), neighborElevationMm = outside?.groundElevationMm ?? 0
    const level = area.groundElevationMm === neighborElevationMm
    const unpaintedShore = outside && level && water.has(area.id) !== water.has(outside.id)
      && !declaration?.shoreline && declaration?.kind !== 'shore'
    if (level && !declaration && !unpaintedShore) continue
    const key = [a, b].map(p => `${p.x},${p.y}`).sort().join('|')
    // A water material can define a shore even when the project has no painted edge.
    if (unpaintedShore && !shores.has(key)) {
      shores.set(key, { points: [clone(a), clone(b)], areaIds: [area.id, outside.id] })
    }
    if (level && !declaration) continue
    const kind = level ? declaration?.kind ?? 'materialTransition' : 'cliff'
    if (result.has(key)) continue
    const shoreline = !!declaration?.shoreline || declaration?.kind === 'shore'
    const shoreStyle = shoreline && declaration?.shoreStyle
    const waterSide = water.has(area.id) && (!outside || !water.has(outside.id)) ? 'source' : 'neighbor'
    const surfaceStyle = clone(declaration?.surfaceStyle ?? null)
    if (surfaceStyle?.base.alignment === 'surface') {
      const paint = surfaceStyle.base, { x, y } = paint.originMm
      paint.originMm = point(a.x + (x * dx - y * dy) / length, a.y + (x * dy + y * dx) / length)
      paint.rotationDeg += Math.atan2(dy, dx) * 180 / Math.PI
    }
    result.set(key, { id: declaration?.id ?? `derived-${area.id}-${vertex.segmentId}`, start: clone(a), end: clone(b), sourceAreaId: area.id, neighborAreaId: outside?.id ?? null, elevationMm: area.groundElevationMm, neighborElevationMm, kind, shoreline,
      style: clone(declaration?.styleOverride ?? theme?.edgeStyles[kind] ?? defaultEdgeStyles[kind]), surfaceStyle,
      ...(declaration?.styleOverride ? { customFinish: true } : {}),
      ...(shoreStyle ? { shorePaint: { style: clone(shoreStyle), waterSide } } : {}) })
  }
  const edges = [...result.values()].sort((a, b) => Math.max(a.elevationMm, a.neighborElevationMm) - Math.max(b.elevationMm, b.neighborElevationMm) || a.start.y - b.start.y || a.start.x - b.start.x || a.end.y - b.end.y || a.end.x - b.end.x)
  return { edges, shores }
}

const polygonRegion = (points: PointMm[]): MultiPolygon => [[points.map(p => [p.x, p.y])]]
const projectedRegions = (regions: MultiPolygon): NonNullable<ProjectedSurface['regionsMm']> => regions.map(poly => ({
  outerMm: poly[0].map(([x, y]) => ({ x, y })), holesMm: poly.slice(1).map(ring => ring.map(([x, y]) => ({ x, y }))),
}))
/** Preserve every untouched raw edge. Only disposable children of a genuinely
 * changed original carrier replace their original whole projected segment. */
function splitInlaySourceEdges(edges: ProjectedTerrainEdge[], scene: SceneDocument,
  intervals: import('../terrain-inlay/contracts.js').TerrainInlaySourceInterval[]): ProjectedTerrainEdge[] {
  return edges.flatMap(edge => {
    const source = scene.terrainAreas[edge.sourceAreaId]
    const index = source.boundaryMm.findIndex((row, i) => close(row.positionMm, edge.start) && close(source.boundaryMm[(i + 1) % source.boundaryMm.length].positionMm, edge.end))
    if (index < 0) return [edge]
    const changed = intervals.filter(row => row.sourceAreaId === source.id && row.sourceSegmentId === source.boundaryMm[index].segmentId)
    if (!changed.length) return [edge]
    const dx = edge.end.x - edge.start.x, dy = edge.end.y - edge.start.y, square = dx * dx + dy * dy
    const at = (p: PointMm) => ((p.x - edge.start.x) * dx + (p.y - edge.start.y) * dy) / square
    const ranges = changed.map(row => [Math.max(0, Math.min(at(row.a), at(row.b))), Math.min(1, Math.max(at(row.a), at(row.b)))])
    const cuts = [...new Set([0, 1, ...ranges.flat()])].sort((a, b) => a - b)
    return cuts.slice(1).flatMap((end, i) => {
      const start = cuts[i], mid = (start + end) / 2
      if ((end - start) * Math.sqrt(square) <= EPS || ranges.some(([a, b]) => mid >= a && mid <= b)) return []
      const p = (t: number) => ({ x: edge.start.x + dx * t, y: edge.start.y + dy * t })
      return [{ ...edge, id: `${edge.id}:inlay-remainder:${i}`, start: p(start), end: p(end) }]
    })
  })
}

export interface EditorProjectionOptions {
  spatial?: boolean
  /** Current GM editor session only. Never used for either published audience. */
  hiddenLayerIds?: ReadonlySet<string>
  floorId?: string
}
export interface ProjectSceneOptions { floorId?: string; spatial?: boolean }

function checkedScene(input: SceneDocument): SceneDocument {
  const result = validateSceneSnapshot(input)
  if (!result.ok) throw new Error(`场景不能绘制：${result.errors[0]?.message ?? '结构不合法。'}`)
  return result.document
}

/** Strict v3 audience filtering precedes textures, joins, shadows and resources. */
export function projectScene(scene: SceneDocument, audience: Audience, appearance?: import('../model/appearance.js').AppearanceGraph, options: ProjectSceneOptions = {}): Projection {
  const checked = checkedScene(scene); copyScenePresentations(scene, checked); if (appearance) associateScenePresentations(checked, appearance)
  const projection = projectSceneInternal(checked, audience, selectedFloorOutput(checked, options.floorId), undefined, options.floorId !== undefined)
  if (options.spatial) projection.propVolumes = projectPropVolumes(checked, projection)
  return projection
}

/** Authoring-only diagnosis: uses the exact published player projection checks.
 * Invalid geometry/resources and missing explicit Floor selection still throw. */
export function getPlayerCoverageDiagnostics(scene: SceneDocument, appearance?: import('../model/appearance.js').AppearanceGraph, options: ProjectSceneOptions = {}): PlayerCoverageIssue[] {
  try { projectScene(scene, 'player', appearance, options); return [] }
  catch (error) {
    if (error instanceof PlayerCoverageError) return error.issues
    throw error
  }
}

/** GM session hiding uses the intact source; no support or stored relationship is removed. */
export function projectEditorScene(scene: SceneDocument, options: EditorProjectionOptions = {}, appearance?: import('../model/appearance.js').AppearanceGraph): Projection {
  const checked = checkedScene(scene); copyScenePresentations(scene, checked); if (appearance) associateScenePresentations(checked, appearance)
  const projection = projectSceneInternal(checked, 'gm', selectedFloorOutput(checked, options.floorId), options.hiddenLayerIds?.size ? options.hiddenLayerIds : undefined, options.floorId !== undefined)
  if (options.spatial) projection.propVolumes = projectPropVolumes(checked, projection)
  return projection
}

function selectedFloorOutput(scene: SceneDocument, floorId?: string): FloorOutput {
  const ids = Object.keys(scene.floors)
  if (floorId === undefined && ids.length !== 1) throw new Error('多楼层投影必须明确选择目标Floor，不能自动选择第一层。')
  return resolveFloorOutput(scene, floorId ?? ids[0])
}

/** Full-scene validation runs once; every Floor then proves its own player
 * safety independently of the current editor target, masks or viewport. */
export function assertAllFloorPlayerProjections(scene: SceneDocument, appearance?: import('../model/appearance.js').AppearanceGraph): void {
  const checked = checkedScene(scene); copyScenePresentations(scene, checked); if (appearance) associateScenePresentations(checked, appearance)
  for (const floorId of Object.keys(checked.floors).sort()) projectSceneInternal(checked, 'player', resolveFloorOutput(checked, floorId), undefined, true)
}

function projectSceneInternal(scene: SceneDocument, audience: Audience, floorOutput: FloorOutput, hiddenLayerIds?: ReadonlySet<string>, explicitFloor = false): Projection {
  const targetFloorId = floorOutput.floorId
  const floorValues = <T extends { floorId: string }>(record: Record<string, T>): T[] => Object.values(record).filter(row => row.floorId === targetFloorId)
  const regional = scene.mapMode==='regional' && scene.regional ? {
    areas: floorValues(scene.regional.areas).filter(row => (audience === 'gm' || regionalEntityVisibility(scene, 'area', row.id) === 'public') && !hiddenLayerIds?.has(row.layerId)).map(row => ({ id: row.id, points: clone(row.boundaryMm), kind: row.kind, style: clone(row.style), relativeElevationMm: row.relativeElevationMm })),
    lines: floorValues(scene.regional.lines).filter(row => (audience === 'gm' || regionalEntityVisibility(scene, 'line', row.id) === 'public') && !hiddenLayerIds?.has(row.layerId)).map(row => ({ id: row.id, points: row.pointsMm.map(point => clone(point.positionMm)), kind: row.kind, displayWidthMm: row.displayWidthMm, actualWidthMm: row.actualWidthMm, style: clone(row.style) })),
    landmarks: floorValues(scene.regional.landmarks).filter(row => (audience === 'gm' || regionalEntityVisibility(scene, 'landmark', row.id) === 'public') && !hiddenLayerIds?.has(row.layerId)).map(row => ({ id: row.id, positionMm: clone(row.positionMm), purpose: row.purpose, name: row.name, description: row.description, assetId: scene.regional!.symbolDefinitions[row.definitionRef.id].assetId, visualBoundsMm: clone(scene.regional!.symbolDefinitions[row.definitionRef.id].visualBoundsMm), rootAnchorMm: clone(scene.regional!.symbolDefinitions[row.definitionRef.id].rootAnchorMm) })),
    symbols: floorValues(scene.regional.symbols).filter(row => (audience === 'gm' || regionalEntityVisibility(scene, 'symbol', row.id) === 'public') && !hiddenLayerIds?.has(row.layerId)).map(row => ({ id: row.id, positionMm: clone(row.positionMm), visualBoundsMm: clone(row.visualBoundsMm), assetId: scene.regional!.symbolDefinitions[row.definitionRef.id].assetId, rootAnchorMm: clone(scene.regional!.symbolDefinitions[row.definitionRef.id].rootAnchorMm), renderOrder: row.renderOrder, sourceRef: audience === 'gm' ? clone(row.sourceRef) : null })),
  } : undefined
  const deckOwners = new Map(floorValues(scene.paths).flatMap(path => path.assembly?.bridge ? [[path.assembly.bridge.deckId, path.id] as const] : []))
  const layerShown = (id: string) => !hiddenLayerIds?.has(scene.entityLayers[id])
  const entityShown = (id: string): boolean => {
    const bridgeId = deckOwners.get(id)
    return (id === targetFloorId || scene.userLayers[scene.entityLayers[id]]?.floorId === targetFloorId) && layerShown(id) && (!bridgeId || layerShown(bridgeId))
  }
  const layerOrder = (id: string) => scene.userLayers[scene.entityLayers[id]]?.order ?? 0
  const compareLayer = (a: { id: string }, b: { id: string }) => layerOrder(a.id) - layerOrder(b.id)
  // v2 dictionaries have no paint order: canonical file serialization reorders
  // their keys. Use stable IDs within each user layer, retaining v1 behavior.
  const localOrder = (items: { id: string }[]) => new Map([...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((item, index) => [item.id, index]))
  const roomOrder = localOrder(floorValues(scene.rooms)), noteOrder = localOrder(floorValues(scene.notes)), regionOrder = localOrder(floorValues(scene.regions))
  if (audience !== 'gm' && audience !== 'player') throw new Error('必须明确选择主持人或玩家输出。')
  const bounds = clone(floorOutput.boundsMm)
  if (Object.values(bounds).some(v => !Number.isFinite(v)) || bounds.width <= 0 || bounds.height <= 0) throw new Error('导出边界必须是有效固定矩形。')
  const themeDefinition = scene.activeStyleThemeRef ? scene.styleThemes[scene.activeStyleThemeRef.id] : null
  if (scene.activeStyleThemeRef && (!themeDefinition || themeDefinition.version !== scene.activeStyleThemeRef.version)) throw new Error('主题快照缺失或版本不匹配。')
  const theme = themeDefinition ? clone({ outline: themeDefinition.outline, openingStyle: themeDefinition.openingStyle, shadowPresets: themeDefinition.shadowPresets, edgeStyles: themeDefinition.edgeStyles, terrainCliff: themeDefinition.terrainCliff }) : null
  const maskRegions = floorValues(scene.regions).filter(r => r.kind === 'manualMask').sort((a, b) => a.id.localeCompare(b.id))
  const masks = maskRegions.map(r => clone(r.boundaryMm))
  const rectangles = audience === 'player' ? masks.map(maskRectangle) : []
  const areaPublic = (id: string) => scene.terrainAreas[id]?.floorId === targetFloorId && scene.terrainAreas[id]?.visibility === 'public'
  const roomPublic = (id: string): boolean => scene.rooms[id]?.floorId === targetFloorId && scene.rooms[id].visibility === 'public' && (scene.rooms[id].supportRef.kind === 'floor' || areaPublic(scene.rooms[id].supportRef.id))
  const publicRoomRings = audience === 'player' && maskRegions.some(mask => mask.preservePublicRooms)
    ? floorValues(scene.rooms).filter(room => roomPublic(room.id)).sort((a, b) => a.id.localeCompare(b.id)).map(room => simplify(roomPoints(scene, room))) : []
  const maskPublicRooms = maskRegions.map(mask => mask.preservePublicRooms ? publicRoomRings.filter(ring => !!intersects(pointsBounds(ring), pointsBounds(mask.boundaryMm))).map(clone) : [])
  const maskedPoint = (p: PointMm) => playerMaskContains(p, audience === 'player' ? masks : [], maskPublicRooms)
  const surfacePublic = (ref: SurfaceRef): boolean => ref.kind === 'floor' ? ref.id === targetFloorId : ref.kind === 'room' ? roomPublic(ref.id) : areaPublic(ref.id)
  const surfaceShown = (ref: SurfaceRef): boolean => ref.kind === 'floor' ? ref.id === targetFloorId : entityShown(ref.id) && (ref.kind !== 'room' || scene.rooms[ref.id]?.supportRef.kind !== 'terrainArea' || entityShown(scene.rooms[ref.id].supportRef.id))
  const pathPublic = (id: string) => scene.paths[id]?.visibility === 'public' && scene.paths[id].supportRefs.every(surfacePublic)
  const edgePublic = (id: string) => scene.terrainEdges[id]?.visibility === 'public' && areaPublic(scene.terrainEdges[id].source.areaId) && (!scene.terrainEdges[id].neighborAreaId || areaPublic(scene.terrainEdges[id].neighborAreaId!))
  const groupHiddenProps = new Set<string>()
  const hiddenAssemblyProps = new Set<string>()
  const hideMembers = (members: PathAssembly['members']) => {
    for (const member of Object.values(members)) if (member.state === 'placed') {
      hiddenAssemblyProps.add(member.propId)
      if (audience === 'player') groupHiddenProps.add(member.propId)
    }
  }
  for (const path of floorValues(scene.paths)) if (path.assembly) {
    const shown = entityShown(path.id) && path.supportRefs.every(surfaceShown)
    if (shown && (audience === 'gm' || pathPublic(path.id))) continue
    hideMembers(path.assembly.members)
  }
  for (const boundary of floorValues(visualBase(scene)?.boundaries ?? {})) if (boundary.fence) {
    if (hiddenLayerIds?.has(boundary.layerId) || (audience === 'player' && boundary.visibility !== 'public')) hideMembers(boundary.fence.members)
  }
  const groupHiddenDecorations = new Set<string>()
  const clusterForEntity = new Map<string, NonNullable<SceneDocument['decorationClusters']>[string]>()
  for (const group of floorValues(scene.decorationClusters ?? {})) for (const member of Object.values(group.members)) {
    if (member.entityId && member.state !== 'detached' && member.state !== 'deleted') clusterForEntity.set(member.entityId, group)
  }
  const clusterMemberShown = (id: string) => {
    const group = clusterForEntity.get(id)
    return !group || entityShown(group.id) && surfaceShown(group.supportRef)
  }
  if (audience === 'player') {
    for (const group of floorValues(scene.prefabInstances)) if (group.visibility !== 'public') for (const member of Object.values(group.members)) if (member.propId) groupHiddenProps.add(member.propId)
    for (const group of floorValues(scene.scatterGroups)) {
      const visibleDomain = group.domain.kind === 'area' ? areaPublic(group.domain.areaId) : group.domain.kind === 'path' ? pathPublic(group.domain.pathId) : edgePublic(group.domain.edgeId)
      if (group.visibility !== 'public' || !visibleDomain) for (const member of Object.values(group.members)) if (member.propId && member.state !== 'detached') groupHiddenProps.add(member.propId)
    }
    for (const group of floorValues(scene.decorationClusters ?? {})) if (group.visibility !== 'public' || !surfacePublic(group.supportRef)) {
      for (const member of Object.values(group.members)) if (member.entityId && member.state !== 'detached' && member.state !== 'deleted') {
        (member.kind === 'prop' ? groupHiddenProps : groupHiddenDecorations).add(member.entityId)
      }
    }
  }
  const publicVisibility = createPublicVisibility(scene)
  const attachmentVisible = (id: string, player: boolean, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    const row = Object.values(scene.attachments ?? {}).find(row => row.child.id === id)
    if (!row) return true
    return (row.mode === 'embed' ? row.surfaceIds : [row.surfaceId]).every(surfaceId => {
      const surface = scene.attachmentSurfaces?.[surfaceId]
      if (!surface || !entityShown(surface.owner.id)) return false
      const owner = surface.owner
      if (owner.kind === 'prop') {
        const host = scene.props[owner.id]
        return !!host && !hiddenAssemblyProps.has(host.id) && !groupHiddenProps.has(host.id) && (!player || host.visibility === 'public' && surfacePublic(host.supportRef) && (!host.roomId || roomPublic(host.roomId))) && attachmentVisible(host.id, player, new Set(seen))
      }
      return !player || (owner.kind === 'wall' ? publicVisibility.wall(owner.id) : owner.kind === 'terrainArea' ? areaPublic(owner.id) : publicVisibility.terrainConnection(owner.id))
    })
  }
  const propPublic = (prop: Prop) => prop.visibility === 'public' && !groupHiddenProps.has(prop.id) && surfacePublic(prop.supportRef) && (!prop.roomId || roomPublic(prop.roomId)) && attachmentVisible(prop.id, true)
  const visibleRooms = floorValues(scene.rooms).filter(r => entityShown(r.id) && (audience === 'gm' || roomPublic(r.id)))
  const audienceTerrain = floorValues(scene.terrainAreas).filter(a => audience === 'gm' || areaPublic(a.id))
  const visibleTerrain = audienceTerrain.filter(a => entityShown(a.id))
  const rooms = visibleRooms.map(r => ({ id: r.id, points: simplify(roomPoints(scene, r)), style: clone(r.floorStyle), elevationMm: r.groundElevationMm, priority: 0 })).sort((a, b) => compareLayer(a, b) || roomOrder.get(a.id)! - roomOrder.get(b.id)! || a.id.localeCompare(b.id))
  const terrain: ProjectedSurface[] = visibleTerrain.map(a => ({ id: a.id, points: simplify(terrainPoints(a)), style: clone(a.surfaceStyle), elevationMm: a.groundElevationMm, priority: a.coveragePriority, ...(deckOwners.has(a.id) && { bridgeSupport: true as const }), ...(a.boundaryBlendMm ? { boundaryBlendMm: a.boundaryBlendMm } : {}), ...(a.waterSurface ? { waterSurface: clone(a.waterSurface) } : {}), ...(a.facade ? { facade: clone(a.facade) } : {}), ...(a.relief ? { relief: clone(a.relief) } : {}) })).sort((a, b) => a.priority - b.priority || compareLayer(a, b) || a.id.localeCompare(b.id))
  {
    const byId = new Map(terrain.map(area => [area.id, area]))
    for (const { rule, regionsMm } of resolveSurfaceRules(scene, floorValues(scene.surfaceRules), { audience, hiddenLayerIds })) {
      if (rule.field !== 'material') continue
      const area = byId.get(rule.supportRef.id)
      if (area) (area.materialPatches ??= []).push({ regionsMm, paint: clone(rule.paint), blendWidthMm: rule.blendWidthMm })
    }
  }
  // Coverage/elevation resolution uses the audience's intact physical surfaces.
  // Hiding a source omits its decoration instead of inventing replacement cliffs.
  const physicalEdges = deriveTerrainEdges(scene, audienceTerrain.filter(area => !deckOwners.has(area.id)), floorValues(scene.terrainEdges).filter(e => audience === 'gm' || edgePublic(e.id)), theme)
  const lineArtShorelines = Array.from(physicalEdges.shores.values()).flatMap(({ points, areaIds }) => areaIds.every(id => entityShown(id)) ? [points] : [])
  const edges = physicalEdges.edges
    .filter(e => entityShown(e.sourceAreaId) && (!e.neighborAreaId || entityShown(e.neighborAreaId)) && (!scene.terrainEdges[e.id] || entityShown(e.id)))
    .sort((a, b) => Math.max(a.elevationMm, a.neighborElevationMm) - Math.max(b.elevationMm, b.neighborElevationMm) || layerOrder(scene.terrainEdges[a.id] ? a.id : a.sourceAreaId) - layerOrder(scene.terrainEdges[b.id] ? b.id : b.sourceAreaId) || a.start.y - b.start.y || a.start.x - b.start.x || a.end.y - b.end.y || a.end.x - b.end.x)

  const connectionPublic = (id: string) => {
    const c = scene.terrainConnections[id], opening = c?.openingId ? scene.openings[c.openingId] : undefined
    return c?.visibility === 'public' && surfacePublic(c.from.surfaceRef) && surfacePublic(c.to.surfaceRef) && (!c.carvedStrip || areaPublic(c.carvedStrip.hostAreaId)) && (!c.terrainInlay || publicVisibility.terrainConnection(id))
      && (!c.openingId || !!opening && (!opening.secret || opening.revealed))
  }
  const surfaceElevation = (ref: SurfaceRef) => ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id]?.groundElevationMm ?? 0 : ref.kind === 'room' ? scene.rooms[ref.id]?.groundElevationMm ?? 0 : 0
  const connections: ProjectedConnection[] = floorValues(scene.terrainConnections).filter(c => entityShown(c.id) && entityShown(c.from.surfaceRef.id) && entityShown(c.to.surfaceRef.id) && (!c.terrainInlay || c.terrainInlay.geometry.sources.every(source => entityShown(source.id))) && (!c.openingId || entityShown(c.openingId) && entityShown(scene.openings[c.openingId].wallId)) && (audience === 'gm' || connectionPublic(c.id))).map(c => ({ id: c.id, kind: c.kind, start: clone(c.from.positionMm), end: clone(c.to.positionMm), widthMm: c.widthMm, fromElevationMm: surfaceElevation(c.from.surfaceRef), toElevationMm: surfaceElevation(c.to.surfaceRef), blocksMovement: c.blocksMovement, style: clone(c.surfaceStyle), ...(c.staircase ? { staircase: clone(c.staircase), staircaseCenterlineMm: c.carvedStrip ? carvedStripCenterline(c.carvedStrip) : connectionCenterline(c) } : {}), surfaceIds: [c.from.surfaceRef.id, c.to.surfaceRef.id] as [string, string], ...(c.terrainInlay ? { inlayFootprintMm: terrainInlayFootprint(c, true), inlayCenterlineMm: terrainInlayCenterline(c), ...(c.terrainInlay.appearance ? { inlayAppearance: c.terrainInlay.appearance } : {}) } : {}), ...(c.route ? { route: { centerlineMm: clone(c.route.centerlineMm), stairStyle: c.route.stairStyle, treadDepthMm: c.route.treadDepthMm, ...(c.route.renderProfile ? { renderProfile: c.route.renderProfile } : {}) } } : {}) })).sort((a, b) => compareLayer(a, b) || a.id.localeCompare(b.id))
  const paths = floorValues(scene.paths).filter(path => entityShown(path.id) && path.supportRefs.every(surfaceShown) && (audience === 'gm' || pathPublic(path.id))).sort((a, b) => compareLayer(a, b) || a.renderOrder - b.renderOrder || a.id.localeCompare(b.id)).map(path => projectPath(path, theme, audience === 'player' ? masks : undefined))
  const visibleConnectionIds = new Set(connections.map(row => row.id))
  const rocks: NonNullable<Projection['rocks']> = []
  for (const host of visibleTerrain) if (host.rockBody) {
    const actual = floorValues(scene.terrainConnections).filter(row => visibleConnectionIds.has(row.id) && row.carvedStrip?.hostAreaId === host.id)
    const plan = carvedRockFaces(captureCarvedRockHost({ ...host, rockBody: host.rockBody }), actual.map(row => row.carvedStrip!))
    const top = terrain.find(row => row.id === host.id)!
    top.regionsMm = plan.topRegionsMm.map(polygon => ({ outerMm: polygon[0].map(([x, y]) => ({ x, y })), holesMm: polygon.slice(1).map(ring => ring.map(([x, y]) => ({ x, y }))) }))
    const shell = host.rockBody.shell
    const verticalPlan = shell ? { ...plan, walls: plan.walls.filter(wall => {
      if (wall.lowSurfaceId !== null) return true
      const p = midpoint(wall.a, wall.b)
      return host.boundaryMm.some((row, i) => {
        if (!shell.recipe.excludedSegmentIds.includes(row.segmentId)) return false
        const a = row.positionMm, b = host.boundaryMm[(i + 1) % host.boundaryMm.length].positionMm
        return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < EPS
          && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
      })
    }) } : plan
    const paint = createCarvedRockPaintPlan(verticalPlan, { seed: host.id })
    const lightAngle = (visualBase(scene)?.environment.lightDirectionDeg ?? 315) * Math.PI / 180
    const shellPaint = shell && createRockShellPaintPlan(shell, { lightDirection: { x: Math.cos(lightAngle), y: Math.sin(lightAngle), z: 1 } })
    rocks.push({ id: host.id, patches: plan.patches.map(row => ({ kind: row.kind, pointsMm: row.verticesMm.map(({ x, y }) => ({ x, y })), elevationsMm: row.verticesMm.map(row => row.z) })),
      facets: [...clone(paint.facets), ...(shellPaint ? shellPaint.facets.map(row => ({ id: row.id, pointsMm: row.pointsMm, fill: row.fill, opacity: row.opacity, kind: 'wall' as const })) : [])],
      strokes: [...clone(paint.strokes), ...(shellPaint ? clone(shellPaint.strokes) : [])] })
    for (const row of actual) {
      const projected = connections.find(item => item.id === row.id)!
      projected.carvedFootprintMm = connectionFootprint(row)
    }
  }
  // Whole source-cliff bands cannot survive a physical cut. The shared rock
  // plan supplies exterior and cut walls after the same audience filtering.
  for (let index = edges.length - 1; index >= 0; index--) if (rocks.some(rock => rock.id === edges[index].sourceAreaId || rock.id === edges[index].neighborAreaId)) edges.splice(index, 1)
  const inlays: NonNullable<Projection['inlays']> = []
  const changedIntervals: import('../terrain-inlay/contracts.js').TerrainInlaySourceInterval[] = []
  for (const connection of floorValues(scene.terrainConnections)) if (connection.terrainInlay && visibleConnectionIds.has(connection.id)) {
    const geometry = connection.terrainInlay.geometry, plan = planTerrainInlay(geometry), footprintMm = terrainInlayFootprint(connection)
    const cut = polygonRegion(footprintMm)
    for (const source of geometry.sources) {
      const top = terrain.find(row => row.id === source.id)
      if (!top) throw Error('跨台实际面缺少受众可见的完整源顶面。')
      const current = top.regionsMm ? top.regionsMm.map(region => [region.outerMm.map(p => [p.x, p.y] as [number, number]), ...region.holesMm.map(ring => ring.map(p => [p.x, p.y] as [number, number]))]) : polygonRegion(top.points)
      top.regionsMm = projectedRegions(polygonClipping.difference(current, cut))
    }
    changedIntervals.push(...plan.sourceIntervals)
    const walls = plan.exposedWalls.map(wall => ({ a: clone(wall.a), b: clone(wall.b), highMm: clone(wall.highMm), lowMm: clone(wall.lowMm), normal: clone(wall.normal), lowSourceAreaId: wall.low.kind === 'source' ? wall.low.areaId : null }))
    // Paint reaches only the lower side of each real wall, by at most 600mm.
    // The view envelope includes the full actual apron and every such endpoint.
    const paintPoints = [...footprintMm, ...walls.flatMap(wall => [wall.a, wall.b].map((p, i) => {
      const depth = Math.min(600, Math.max(0, wall.highMm[i] - wall.lowMm[i]) * .18)
      return { x: p.x + wall.normal.x * depth, y: p.y + wall.normal.y * depth }
    }))]
    inlays.push({ id: connection.id, footprintMm, walkFootprintMm: terrainInlayFootprint(connection, true),
      ...(connection.terrainInlay.finish ? { finish: clone(connection.terrainInlay.finish), finishRoute: { centerlineMm: terrainInlayCenterline(connection), widthMm: connection.widthMm } } : {}),
      patches: Object.values(geometry.faces).sort((a, b) => a.id.localeCompare(b.id)).map(face => ({ kind: face.kind, pointsMm: face.vertexIds.map(id => ({ x: geometry.verticesMm[id].x, y: geometry.verticesMm[id].y })), elevationsMm: face.vertexIds.map(id => geometry.verticesMm[id].z) })),
      apronSurfaces: geometry.sources.map(source => {
        const cells = plan.cells.filter(cell => cell.kind === 'apron' && cell.sourceAreaId === source.id).map(cell => polygonRegion(cell.ringMm))
        return { sourceAreaId: source.id, regionsMm: cells.length ? projectedRegions(polygonClipping.union(cells[0], ...cells.slice(1))) : [] }
      }),
      ...(connection.terrainInlay.appearance === 'source-ground' ? { groundSurfaces: geometry.sources.map(source => {
        const cells = plan.cells.filter(cell => cell.sourceAreaId === source.id).map(cell => polygonRegion(cell.ringMm))
        return { sourceAreaId: source.id, regionsMm: cells.length ? projectedRegions(polygonClipping.union(cells[0], ...cells.slice(1))) : [] }
      }) } : {}),
      walls, changedCarriers: plan.sourceIntervals.map(row => ({ a: clone(row.a), b: clone(row.b) })), paintBoundsMm: inflate(pointsBounds(paintPoints), 24) })
  }
  if (changedIntervals.length) edges.splice(0, edges.length, ...splitInlaySourceEdges(edges, scene, changedIntervals))
  const pathGroups = new Map<string, string[]>()
  for (const projected of paths) {
    const path = scene.paths[projected.id]
    // A GM-only path or one depending on a private surface never changes the
    // silhouette of public paint, even in the GM preview. Multi-height paths
    // retain their own boundary because their local crossing height is unknown.
    if (!pathPublic(path.id)) continue
    const heights = new Set(path.supportRefs.map(surfaceElevation))
    if (heights.size !== 1) continue
    // Layer order controls editing and paint order; it does not turn a shared
    // public road junction into two separate surfaces. Hidden layers and private
    // supports were filtered above; incompatible/graded paints stay independent.
    const key = JSON.stringify([path.floorId, [...heights][0]])
    const group = pathGroups.get(key) ?? []; group.push(path.id); pathGroups.set(key, group)
  }
  const pathJoinGroups = [...pathGroups.values()].filter(group => group.length > 1)
  const pathJoinPaintOrder = paths.filter(path => pathPublic(path.id)).map(path => path.id)
  // Finite paint-only relationships. Public roads never consume a GM-only
  // surface, even in the GM view; hidden editor layers have already been removed.
  // Over budget, keep all independent outlines rather than sampling the scene.
  let pathTerrainJoins: Projection['pathTerrainJoins']
  const publicJoinPaths = paths.filter(path => pathPublic(path.id)), publicJoinTerrain = terrain.filter(area => areaPublic(area.id))
  const publicJoinRooms = rooms.filter(room => roomPublic(room.id))
  const bridgeJoinPaths = audience === 'gm' ? paths : publicJoinPaths
  const bridgeJoinTerrain = audience === 'gm' ? terrain : publicJoinTerrain
  if (publicJoinPaths.length <= 128 && publicJoinTerrain.length <= 256 && publicJoinRooms.length <= 256) {
    const joins = publicJoinPaths.flatMap(projected => {
      const path = scene.paths[projected.id]
      const heights = new Set(path.supportRefs.map(surfaceElevation))
      if (heights.size !== 1) return []
      const box = pointsBounds(projected.points), elevation = [...heights][0]
      const terrainIds = publicJoinTerrain.filter(area => scene.terrainAreas[area.id].floorId === path.floorId
        && scene.entityLayers[area.id] === scene.entityLayers[path.id] && area.elevationMm === elevation
        && !!intersects(box, pointsBounds(area.points))).map(area => area.id)
      return terrainIds.length ? [{ pathId: path.id, terrainIds }] : []
    })
    if (joins.length) pathTerrainJoins = { terrainPaintOrder: publicJoinTerrain.map(area => area.id),
      roomIds: publicJoinRooms.map(room => room.id), paths: joins }
  }
  const visibleProps = floorValues(scene.props).filter(p => entityShown(p.id) && !hiddenAssemblyProps.has(p.id) && (!(p.waterAppearance || deckOwners.has(p.supportRef.id)) || entityShown(p.supportRef.id)) && clusterMemberShown(p.id) && attachmentVisible(p.id, audience === 'player') && (audience === 'gm' || propPublic(p) && !maskedPoint(p.positionMm)))
  const props = visibleProps.map(p => {
    const prop = clone(p)
    if (audience === 'player') {
      if (prop.sightOccluder?.visibility === 'gm') delete prop.sightOccluder
      delete prop.pipePorts
    }
    return prop
  }).sort((a, b) => propLayer[a.renderLayer] - propLayer[b.renderLayer] || compareLayer(a, b) || a.renderOrder - b.renderOrder || (scenePresentation(scene, a.id)?.mode === 'nearSide' && scenePresentation(scene, b.id)?.mode === 'nearSide' ? a.positionMm.y - b.positionMm.y : 0) || a.id.localeCompare(b.id))
  const visiblePropIds = new Set(props.map(p => p.id))
  const decorationPublic = (value: NonNullable<SceneDocument['decorations']>[string]) => value.visibility === 'public' && surfacePublic(value.supportRef) && !groupHiddenDecorations.has(value.id)
  const decorations = floorValues(scene.decorations ?? {}).filter(value => entityShown(value.id) && clusterMemberShown(value.id)
    && surfaceShown(value.supportRef) && (audience === 'gm' || decorationPublic(value) && !maskedPoint(value.positionMm)))
    .map(value => decorationPaintGeometry(scene, value))
    .sort((a, b) => propLayer[a.renderLayer] - propLayer[b.renderLayer] || compareLayer(a, b) || a.renderOrder - b.renderOrder || (scenePresentation(scene, a.id)?.mode === 'nearSide' && scenePresentation(scene, b.id)?.mode === 'nearSide' ? a.positionMm.y - b.positionMm.y : 0) || a.id.localeCompare(b.id))
  const diagnostics: string[] = []
  const allRoomEdges = new Map<string, string[]>()
  const edgeKey = (a: string, b: string) => [a, b].sort().join('\0')
  for (const room of floorValues(scene.rooms)) for (let i = 0; i < room.boundaryVertexIds.length; i++) {
    const key = edgeKey(room.boundaryVertexIds[i], room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length])
    allRoomEdges.set(key, [...allRoomEdges.get(key) ?? [], room.id])
  }
  const floorWalls = floorValues(scene.walls)
  const visibleWallIds = new Set<string>(), visibleOpeningIds = new Set<string>()
  const openingsByWall = new Map<string, SceneDocument['openings'][string][]>()
  for (const opening of floorValues(scene.openings)) {
    if (audience === 'player' && opening.secret && !opening.revealed) continue
    const group = openingsByWall.get(opening.wallId)
    if (group) group.push(opening)
    else openingsByWall.set(opening.wallId, [opening])
  }
  const walls: ProjectedWall[] = [], wallCoverage: PlayerCoverageRequirement[] = []
  const wallShadowPadding = shadowPadding(wallShadowStyle(theme?.shadowPresets.wall, floorOutput.environment))
  for (const wall of floorWalls) {
    if (!entityShown(wall.id)) continue
    const av = scene.vertices[wall.startVertexId], bv = scene.vertices[wall.endVertexId]
    if (!av || !bv) throw new Error('墙的顶点缺失。')
    const start = point(av.xMm, av.yMm), end = point(bv.xMm, bv.yMm)
    if (audience === 'player') {
      const neighbors = allRoomEdges.get(edgeKey(wall.startVertexId, wall.endVertexId)) ?? []
      if (neighbors.length && !neighbors.some(roomPublic)) continue
      if (!neighbors.length) {
        const bodyPadding = wall.thicknessMm / 2 + shadowPadding(theme?.shadowPresets.wall)
        // Standalone walls have no visibility field or public room ownership.
        // A nearby public-room hole cannot grant them public authority.
        if (boundsCovered(inflate(pointsBounds([start, end]), bodyPadding), rectangles)) {
          if (wall.edgeProfile && !boundsCovered(inflate(pointsBounds([start, end]), bodyPadding + WALL_RELIEF_LIMIT_MM), rectangles)) wallCoverage.push({ entityKind: 'wall', entityId: wall.id, boundsMm: inflate(pointsBounds([start, end]), bodyPadding + WALL_RELIEF_LIMIT_MM), reason: 'wall-relief' })
          if (wallShadowPadding > shadowPadding(theme?.shadowPresets.wall)) {
            wallCoverage.push({ entityKind: 'wall', entityId: wall.id,
              boundsMm: inflate(pointsBounds([start, end]), wall.thicknessMm / 2 + wallShadowPadding + (wall.edgeProfile ? WALL_RELIEF_LIMIT_MM : 0)) })
          }
          continue
        }
      }
    }
    visibleWallIds.add(wall.id)
    const openings = (openingsByWall.get(wall.id) ?? []).map(o => {
      if (entityShown(o.id)) visibleOpeningIds.add(o.id)
      const [a, b] = openingEndpoints(scene, o)
      return { id: o.id, start: { ...a }, end: { ...b }, widthMm: o.widthMm, kind: o.kind, state: o.state, secret: audience === 'gm' && o.secret, ...(!entityShown(o.id) ? { paintSymbol: false } : {}) }
    })
    walls.push({ id: wall.id, sourceIds: [wall.id], blocksLight: wall.blocksSight, start, end, thicknessMm: wall.thicknessMm, ...(wall.edgeProfile ? { edgeProfile: wall.edgeProfile } : {}), style: clone(wall.topStyle), openings })
  }
  const regionVisible = (id: string) => (scene.regions[id]?.kind === 'terrain' || scene.regions[id]?.kind === 'hazard') && scene.regions[id].visibility === 'public'
  const visibleWallVertices = new Set([...visibleWallIds].flatMap(id => [scene.walls[id].startVertexId, scene.walls[id].endVertexId]))
  const visibleIds: Partial<Record<string, Set<string>>> = { path: new Set(paths.map(path => path.id)), terrainEdge: new Set(edges.map(e => e.id)), terrainConnection: new Set(connections.map(c => c.id)), room: new Set(rooms.map(r => r.id)), terrainArea: new Set(terrain.map(a => a.id)), wall: visibleWallIds, opening: visibleOpeningIds, prop: visiblePropIds, region: new Set(floorValues(scene.regions).filter(r => entityShown(r.id) && (audience === 'gm' || regionVisible(r.id))).map(r => r.id)), vertex: new Set(floorValues(scene.vertices).filter(v => entityShown(v.id) && (audience === 'gm' || visibleWallVertices.has(v.id))).map(v => v.id)), prefabInstance: new Set(floorValues(scene.prefabInstances).filter(g => entityShown(g.id) && (audience === 'gm' || g.visibility === 'public' && Object.values(g.members).some(m => !!m.propId && visiblePropIds.has(m.propId)))).map(g => g.id)), scatterGroup: new Set(floorValues(scene.scatterGroups).filter(g => entityShown(g.id) && (audience === 'gm' || g.visibility === 'public') && Object.values(g.members).some(m => !!m.propId && m.state !== 'detached' && visiblePropIds.has(m.propId))).map(g => g.id)) }
  function anchorPosition(note: Note, seen = new Set<string>()): PointMm | null {
    if (seen.has(note.id) || !entityShown(note.id)) return null
    seen.add(note.id)
    if (note.anchor.type === 'point') return clone(note.anchor.positionMm)
    const { entityKind: kind, entityId: id } = note.anchor
    if (kind === 'note') {
      const parent = scene.notes[id]
      if (!parent || audience === 'player' && parent.visibility !== 'public') return null
      const p = anchorPosition(parent, seen)
      return audience === 'player' && p && maskedPoint(p) ? null : p
    }
    if (!entityShown(id) || (audience === 'player' || hiddenLayerIds) && !visibleIds[kind]?.has(id)) return null
    if (kind === 'vertex') { const v = scene.vertices[id]; return v ? point(v.xMm, v.yMm) : null }
    if (kind === 'prop') return scene.props[id] ? clone(scene.props[id].positionMm) : null
    if (kind === 'room') return scene.rooms[id] ? center(audience === 'player' ? simplify(roomPoints(scene, scene.rooms[id])) : roomPoints(scene, scene.rooms[id])) : null
    if (kind === 'terrainArea') return scene.terrainAreas[id] ? center(terrainPoints(scene.terrainAreas[id])) : null
    if (kind === 'wall') { const w = scene.walls[id]; return w ? midpoint(point(scene.vertices[w.startVertexId].xMm, scene.vertices[w.startVertexId].yMm), point(scene.vertices[w.endVertexId].xMm, scene.vertices[w.endVertexId].yMm)) : null }
    if (kind === 'opening') { const o = scene.openings[id]; return o ? midpoint(...openingEndpoints(scene, o)) : null }
    if (kind === 'terrainEdge') { const e = edges.find(e => e.id === id); return e ? midpoint(e.start, e.end) : null }
    if (kind === 'terrainConnection') { const c = connections.find(c => c.id === id); return c ? midpoint(c.start, c.end) : null }
    if (kind === 'path') return paths.some(path => path.id === id) ? pathAnchorPosition(scene.paths[id]) : null
    if (kind === 'region') return scene.regions[id] ? center(scene.regions[id].boundaryMm) : null
    if (kind === 'prefabInstance') return scene.prefabInstances[id] ? clone(scene.prefabInstances[id].anchorMm) : null
    if (kind === 'scatterGroup') { const g = scene.scatterGroups[id], first = g && Object.values(g.members).find(m => m.propId && (audience === 'gm' || visibleIds.prop?.has(m.propId))); return first?.propId ? clone(scene.props[first.propId].positionMm) : null }
    return null
  }
  const notes: ProjectedNote[] = []
  for (const note of floorValues(scene.notes)) {
    const position = anchorPosition(note)
    if (!entityShown(note.id) || audience === 'player' && note.visibility !== 'public') continue
    if (!position || audience === 'player' && maskedPoint(position)) { if (audience === 'gm') diagnostics.push(`注记 ${note.id} 的锚点尚不支持。`); continue }
    // Titles/text are plain Canvas text; no IDs, purpose or source metadata become labels.
    notes.push({ id: note.id, positionMm: position, text: note.kind === 'label' ? note.text : note.title || note.text, kind: note.kind, visibility: note.visibility })
  }
  if (audience === 'player') {
    const privateBounds: PlayerCoverageRequirement[] = [...wallCoverage]
    const privateRooms = floorValues(scene.rooms).filter(room => !roomPublic(room.id))
    if (privateRooms.length) {
      const wallsByEdge = new Map(floorWalls.map(wall => [edgeKey(wall.startVertexId, wall.endVertexId), wall]))
      for (const room of privateRooms) {
        const ring = simplify(roomPoints(scene, room)), roomBounds = pointsBounds(ring)
        const adjacent = room.boundaryVertexIds.flatMap((id, index, ids) => {
          const wall = wallsByEdge.get(edgeKey(id, ids[(index + 1) % ids.length]))
          return wall ? [wall] : []
        })
        const privateWalls = adjacent.filter(wall => !allRoomEdges.get(edgeKey(wall.startVertexId, wall.endVertexId))!.some(roomPublic))
        const thickness = Math.max(0, ...adjacent.map(wall => wall.thicknessMm))
        const hasRelief = adjacent.some(wall => wall.edgeProfile)
        const padding = thickness + (hasRelief ? WALL_RELIEF_LIMIT_MM : 0) + wallShadowPadding
        const rectangular = ring.length === 4 && ring.every((p, i) => p.x === ring[(i + 1) % ring.length].x || p.y === ring[(i + 1) % ring.length].y)
        const privateEnds = new Set(privateWalls.flatMap(wall => [wall.startVertexId, wall.endVertexId]))
        const complexJoin = floorWalls.some(wall => (wall.thicknessMm > thickness || wall.edgeProfile)
          && (privateEnds.has(wall.startVertexId) || privateEnds.has(wall.endVertexId)))
        // A standalone interior wall still relies on the original full mask
        // envelope to disappear before shadows and light blockers are derived.
        const standaloneInterior = rectangular && floorWalls.some(wall => {
          if (allRoomEdges.has(edgeKey(wall.startVertexId, wall.endVertexId))) return false
          const body = inflate(pointsBounds([wall.startVertexId, wall.endVertexId].map(id => point(scene.vertices[id].xMm, scene.vertices[id].yMm))), wall.thicknessMm / 2)
          return body.x >= roomBounds.x && body.y >= roomBounds.y && body.x + body.width <= roomBounds.x + roomBounds.width && body.y + body.height <= roomBounds.y + roomBounds.height
        })
        const separateSharedWalls = rectangular && !hasRelief && !complexJoin && !standaloneInterior && privateWalls.length < adjacent.length
        privateBounds.push({ entityKind: 'room', entityId: room.id, boundsMm: separateSharedWalls ? roomBounds : inflate(roomBounds, padding) })
        if (separateSharedWalls) for (const wall of privateWalls) {
          // Shared walls are retained in the player projection. At the ends of any
          // removed wall, keep the full miter and shadow allowance for the join.
          const points = [wall.startVertexId, wall.endVertexId].map(id => point(scene.vertices[id].xMm, scene.vertices[id].yMm))
          privateBounds.push({ entityKind: 'wall', entityId: wall.id, boundsMm: inflate(pointsBounds(points), padding) })
        }
      }
    }
    for (const prop of floorValues(scene.props)) if (!propPublic(prop)) {
      const presentation = scenePresentation(scene, prop.id), shadow = effectivePropShadow(prop, presentation, theme?.shadowPresets[prop.shadowClass], floorOutput.environment)
      privateBounds.push({ entityKind: 'prop', entityId: prop.id, boundsMm: propPaintEnvelope(prop, presentation, shadow, floorOutput.environment) })
    }
    for (const value of floorValues(scene.decorations ?? {})) if (!decorationPublic(value)) privateBounds.push({ entityKind: 'decoration', entityId: value.id, boundsMm: decorationPaintBounds(decorationPaintGeometry(scene, value)) })
    // Face and shadow extents are bounded by one controlled displacement, not stacked offsets.
    const edgePadding = terrainDecorationPadding(scene, theme, targetFloorId)
    for (const area of floorValues(scene.terrainAreas)) if (!areaPublic(area.id)) {
      const outline = terrainPoints(area)
      const existing = inflate(pointsBounds([...outline, ...Object.values(area.rockBody?.shell?.verticesMm ?? {}).map(({ x, y }) => ({ x, y }))]), Math.max(edgePadding, area.rockBody ? 1100 : 0))
      const footprint = [point(existing.x, existing.y), point(existing.x + existing.width, existing.y + existing.height)]
      if (area.facade) {
        const offset = terrainFacadeOffset(area.facade)
        for (const p of outline) footprint.push(point(p.x + offset.x, p.y + offset.y))
      }
      privateBounds.push({ entityKind: 'terrainArea', entityId: area.id, boundsMm: pointsBounds(footprint) })
    }
    for (const edge of floorValues(scene.terrainEdges)) if (!edgePublic(edge.id)) {
      const area = scene.terrainAreas[edge.source.areaId], index = area?.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId) ?? -1
      const shorePadding = (edge.shoreline || edge.kind === 'shore') && edge.shoreStyle ? shorelinePaintPadding(edge.shoreStyle) : 0
      if (area && index >= 0) privateBounds.push({ entityKind: 'terrainEdge', entityId: edge.id, boundsMm: inflate(pointsBounds([area.boundaryMm[index].positionMm, area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm]), Math.max(edgePadding, shorePadding)) })
    }
    for (const connection of floorValues(scene.terrainConnections)) if (!connectionPublic(connection.id) && !(connection.carvedStrip && areaPublic(connection.carvedStrip.hostAreaId))) privateBounds.push({ entityKind: 'terrainConnection', entityId: connection.id, boundsMm: connection.terrainInlay ? inflate(pointsBounds(terrainInlayFootprint(connection)), 624) : connection.route ? inflate(pointsBounds(connectionFootprint(connection)), 24) : inflate(pointsBounds([connection.from.positionMm, connection.to.positionMm]), connection.widthMm / 2 + 24) })
    for (const path of floorValues(scene.paths)) if (!pathPublic(path.id)) privateBounds.push({ entityKind: 'path', entityId: path.id, boundsMm: inflate(pointsBounds(roadEffectsPolygon(path)), pathDecorationPadding(pathEdgeStyle(theme))) })
    for (const region of floorValues(scene.regions)) if ((region.kind === 'terrain' || region.kind === 'hazard') && region.visibility !== 'public') privateBounds.push({ entityKind: 'region', entityId: region.id, boundsMm: pointsBounds(region.boundaryMm) })
    const issues = collectPlayerCoverageIssues(privateBounds, rectangles, bounds, targetFloorId)
    if (issues.length) throw new PlayerCoverageError(issues)
  }
  const limitations: string[] = []
  if (props.some(p => p.appearance.tint)) limitations.push('B3 暂不绘制物件着色。')
  const styles = [...rooms, ...terrain].map(s => s.style).concat(walls.map(w => w.style), edges.map(e => e.surfaceStyle), connections.map(c => c.style), paths.map(path => path.style))
  const materials: Projection['materials'] = {}, assetIds = new Set<string>()
  const floorArtwork = scene.floors[targetFloorId].artwork
  if (floorArtwork) assetIds.add(floorArtwork.assetId)
  const surfacePaints = styles.flatMap(style => style ? [style.base, ...style.overlays.map(o => o.paint)] : []).concat(terrain.flatMap(area => (area.materialPatches ?? []).map(patch => patch.paint)))
  const gradedRoads = paths.some(path => path.gradedSurface)
  for (const paint of surfacePaints) {
    const material = scene.materials[paint.materialRef.id]
    if (!material || material.version !== paint.materialRef.version) throw new Error('绘制需要的材质快照缺失或版本不符。')
    materials[material.id] = { id: material.id, version: material.version, textureAssetId: material.textureAssetId,
      ...(gradedRoads ? { bankMaterial: roadBankMaterial(material) } : {}) }
    assetIds.add(material.textureAssetId)
  }
  for (const prop of props) if (prop.appearance.kind === 'image') assetIds.add(prop.appearance.assetId)
  for (const value of decorations) assetIds.add(value.assetId)
  for (const row of [...(regional?.landmarks ?? []), ...(regional?.symbols ?? [])]) assetIds.add(row.assetId)
  const regions = floorValues(scene.regions).filter(r => (r.kind === 'terrain' || r.kind === 'hazard') && entityShown(r.id) && (audience === 'gm' || regionVisible(r.id))).map(r => ({ id: r.id, points: clone(r.boundaryMm), kind: r.kind as 'terrain' | 'hazard' })).sort((a, b) => compareLayer(a, b) || regionOrder.get(a.id)! - regionOrder.get(b.id)! || a.id.localeCompare(b.id))
  const openingRanks = new Map(walls.flatMap(wall => wall.openings).map(opening => [opening.id, layerOrder(opening.id)]))
  const projectedOpeningRanks = new Map<string, number>()
  const bindings = floorValues(scene.pathAttachments ?? {})
  if (bindings.length) {
    const attachedPaths = new Map(publicJoinPaths.map(path => [path.id, path]))
    const attachedRooms = new Set(publicJoinRooms.map(room => room.id))
    const wallsById = new Map(walls.map(wall => [wall.id, wall]))
    for (const binding of bindings) {
      const path = attachedPaths.get(binding.pathId), wall = wallsById.get(binding.anchor.wallId)
      if (!path || !wall || !attachedRooms.has(binding.anchor.roomId) || !visibleOpeningIds.has(binding.openingId)
        || !publicVisibility.opening(binding.openingId)) continue
      const opening = wall.openings.find(opening => opening.id === binding.openingId)
      if (!opening) continue
      const threshold = projectDoorThreshold(path, binding, wall, opening, audience === 'player' ? masks : [])
      if (threshold) (path.doorThresholds ??= []).push(threshold)
    }
  }
  const orderedWalls = audience === 'player' ? canonicalWalls(walls, compareLayer, openingRanks, projectedOpeningRanks) : walls.sort((a, b) => compareLayer(a, b) || wallOrder(a, b))
  const symbolRanks = audience === 'player' ? projectedOpeningRanks : openingRanks
  const openingPaintOrder = new Set(symbolRanks.values()).size > 1 ? orderedWalls.flatMap(wall => wall.openings.map(opening => opening.id)).sort((a, b) => symbolRanks.get(a)! - symbolRanks.get(b)!) : undefined
  const pathPaintOrder = floorValues(scene.paths).some(path => audience === 'gm' || pathPublic(path.id)) ? 'over-room-before-connection' as const : undefined
  const propPresentations = Object.fromEntries(props.flatMap(prop => {
    const value = scenePresentation(scene, prop.id)
    return value?.mode === 'nearSide' ? [[prop.id, { mode: value.mode, rootAnchorMm: clone(value.rootAnchorMm), groundShadowMm: clone(value.groundShadowMm) }]] : []
  }))
  const result: Projection = { ...(explicitFloor ? { floorId: targetFloorId } : {}), ...(Object.keys(propPresentations).length ? { propPresentations } : {}), ...(regional ? { regional } : {}), audience, sourceRevision: scene.revision, bounds, gridSizeMm: scene.units.gridVisible ? scene.units.gridSizeMm : null, rooms, terrain, walls: orderedWalls, ...(openingPaintOrder ? { openingPaintOrder } : {}), props, edges, paths, ...(pathJoinGroups.length ? { pathJoinGroups } : {}), ...(pathPaintOrder ? { pathPaintOrder } : {}), connections, notes: notes.sort((a, b) => compareLayer(a, b) || noteOrder.get(a.id)! - noteOrder.get(b.id)! || a.id.localeCompare(b.id)), regions, masks, theme, materials, assetIds: [...assetIds].sort(), limitations, diagnostics }
  if (scene.outputBackground) result.outputBackground = clone(scene.outputBackground)
  if (floorArtwork) result.floorArtwork = clone(floorArtwork)
  if (lineArtShorelines.length) result.lineArtShorelines = lineArtShorelines
  const artStyles = activeArtStyles(scene.artStyle)
  if (artStyles) result.artStyles = artStyles
  if (audience === 'player' && maskPublicRooms.some(rings => rings.length)) result.maskPublicRooms = maskPublicRooms
  if (rocks.length) result.rocks = rocks
  if (inlays.length) result.inlays = inlays
  if (decorations.length) {
    result.decorations = decorations
    result.spritePaintOrder = [...props, ...decorations].sort((a, b) => propLayer[a.renderLayer] - propLayer[b.renderLayer] || compareLayer(a, b) || a.renderOrder - b.renderOrder
      || (scenePresentation(scene, a.id)?.mode === 'nearSide' && scenePresentation(scene, b.id)?.mode === 'nearSide' ? a.positionMm.y - b.positionMm.y : 0) || a.id.localeCompare(b.id)).map(value => value.id)
  }
  if (scene.visual) result.visual = projectVisualSystem(scene, visualBase(scene)!, result, audience, hiddenLayerIds, visibleWallIds, floorOutput, walls)
  if (bridgeJoinPaths.some(path => path.bridge)) {
    const filtered = new Set(result.visual?.filters.flatMap(filter => filter.sourceEntityIds ?? []))
    const rows = bridgeJoinPaths.flatMap(projected => {
      if (filtered.has(projected.id)) return []
      const source = scene.paths[projected.id], elevations = new Set(source.supportRefs.map(surfaceElevation))
      return elevations.size === 1 ? [{ projected, source, elevationMm: [...elevations][0] }] : []
    })
    const entrances = planBridgeEntrances(rows, bridgeJoinTerrain, audience === 'gm' ? rooms : publicJoinRooms, scene.floors[targetFloorId])
    if (entrances.length) result.bridgeEntrances = entrances
    fitSteelLandingFacades(bridgeJoinTerrain, bridgeJoinPaths, entrances, audience === 'player' ? masks : [])
  }
  if (pathTerrainJoins) result.pathTerrainJoins = pathTerrainJoins
  if (pathJoinGroups.length || pathTerrainJoins) result.pathJoinPaintOrder = pathJoinPaintOrder
  if (scene.artStyle?.version === 2 && scene.artStyle.materialDrawing) result.materialBrushes = projectMaterialBrushes(scene, result)
  return result
}
