import type { PointMm, SceneDocument, SurfaceStyle, VersionRef } from '../../../model/scene.js'
import type { SceneCommand } from '../../../commands/commands.js'
import { sampleConnectionRoute } from '../../../geometry/connection-route.js'
import { corridor, pathPolygon } from '../../../geometry/geometry.js'
import { polygonBooleanWithHoles } from '../../../geometry/polygon-boolean.js'
import { naturalContourSegments } from '../../../visual/natural-contours.js'
import { sampleVisualBoundary } from '../../../visual/geometry.js'
import type { VisualBoundary } from '../../../visual/types.js'
import { volcanicSurfaceDefinitionId } from '../../../visual/volcanic-surfaces.js'
import type { VolcanoGenerationInput } from './contracts.js'
import type { VolcanoReport } from './index.js'

export interface NaturalVolcanoProfile {
  input: VolcanoGenerationInput
  contours: Record<'mountain' | 'crater' | 'platform' | 'lava', VisualBoundary>
  /** Independent real terrain and matching hazard region, added by the finish transaction. */
  lavaAreaId: string
  lavaRegionId: string
}
/** New authoring template only. Algorithm-1 replay continues using its exact explicit parameters. */
export function createNaturalVolcanoProfile(document: SceneDocument, seed = 'natural-volcano-1'): NaturalVolcanoProfile {
  const floor = Object.values(document.floors)[0]
  const layer = floor && Object.values(document.userLayers).find(row => row.floorId === floor.id && !row.editLocked)
  if (!floor || !layer) throw new Error('自然火山需要现存Floor与未锁定图层。')
  const b = floor.boundsMm
  if (b.width < 30000 || b.height < 24000) throw new Error('自然火山作者模板至少需要30×24米，保留路线净宽。')
  const at = (x: number, y: number): PointMm => ({ x: b.x + Math.round(b.width * x / 50000), y: b.y + Math.round(b.height * y / 38000) })
  const size = Math.min(b.width / 50000, b.height / 38000)
  const prefix = 'natural-volcano'
  const contour = (key: string, anchors: PointMm[]): VisualBoundary => ({ id: `${prefix}-${key}-boundary`, floorId: floor.id,
    layerId: layer.id, visibility: 'public', editLocked: false, closed: true,
    segments: naturalContourSegments(anchors, { closed: true, kind: 'natural', strength: .82, variationMm: 280 * size, seed: `${seed}-${key}`, idPrefix: `${prefix}-${key}` }),
    // The finish transaction stores these exact fine samples as real terrain.
    // Keep the authoring input compact below; the saved natural template uses
    // the finer native curve samples so the rendered boundary does not expose
    // the coarse 14 m tessellation used by the initial candidate.
    sampleSpacingMm: Math.min(1000, Math.max(500, Math.round(900 * size))), toleranceMm: 20, binding: { kind: 'decoration' } })
  const mountain = contour('mountain', [at(15500, 5000), at(21500, 4300), at(25500, 5100), at(30500, 3500),
    at(35500, 4800), at(42000, 6500), at(43400, 10000), at(45600, 15000), at(44200, 21200), at(45000, 26300),
    at(43300, 30000), at(37500, 32700), at(31900, 33900), at(26000, 32100), at(20500, 33400), at(14700, 31000),
    at(12100, 26700), at(10800, 22500), at(11300, 18200), at(10800, 14000), at(12700, 8700)])
  const crater = contour('crater', [at(26200, 13000), at(28500, 9900), at(32100, 10000), at(35600, 8800),
    at(38900, 11000), at(40500, 13400), at(39400, 17200), at(39900, 21700), at(37800, 24000), at(35800, 25700),
    at(32100, 24500), at(28800, 23900), at(26900, 21800), at(26200, 19000), at(26700, 15800)])
  const platform = contour('platform', [at(16000, 24600), at(17100, 23200), at(21000, 23000), at(22500, 24400), at(22600, 27400), at(21300, 28800), at(17800, 28900), at(16300, 27600)])
  // A narrow source neck opens into a wider lower basin, with no square caps.
  const lava = contour('lava', [at(34750, 11200), at(35500, 11500), at(35850, 13450), at(36650, 15300),
    at(37000, 16800), at(36300, 18700), at(36650, 20300), at(37600, 21800), at(36700, 23300),
    at(34800, 23700), at(33100, 22600), at(33650, 20700), at(34650, 19200), at(35150, 17500),
    at(35200, 15900), at(34800, 14100), at(34400, 12500)])
  const sampled = (boundary: VisualBoundary) => {
    const compactBoundary = { ...boundary, sampleSpacingMm: Math.min(20000, Math.round(14000 * size)), toleranceMm: 80 }
    let points = sampleVisualBoundary(compactBoundary).points
    while (points.length > 64 && compactBoundary.toleranceMm < 1000) {
      compactBoundary.toleranceMm = Math.min(1000, Math.ceil(compactBoundary.toleranceMm * 1.15))
      points = sampleVisualBoundary(compactBoundary).points
    }
    if (points.length > 64) throw new Error('自然火山显式作者输入超过64点，请降低作者采样精度。')
    return points
  }
  const ref = (key: string): VersionRef => {
    const id = volcanicSurfaceDefinitionId(key), material = document.materials[id]
    if (!material || material.version !== 1) throw new Error(`自然火山缺少独立固定材质：${id}`)
    return { id, version: 1 }
  }
  return { input: { version: 1, algorithmVersion: 1, seed, parameters: {
    floorId: floor.id, layerId: layer.id, boundsMm: { ...b }, groundElevationMm: 0,
    mountain: { boundaryMm: sampled(mountain), elevationMm: 1800 },
    crater: { boundaryMm: sampled(crater), elevationMm: -400, hazard: true, blocksMovement: false, movementCostMultiplier: 2 },
    // The initial algorithm-1 activity reservation is deliberately inside the
    // final curved platform. A coarse chord can otherwise leave a concave
    // portion of the refined ring even when all sampled vertices are inside.
    platform: { boundaryMm: sampled(platform).map(point => {
      const anchor = at(19300, 26200)
      return { x: Math.round(anchor.x + (point.x - anchor.x) * .94), y: Math.round(anchor.y + (point.y - anchor.y) * .94) }
    }), anchorMm: at(19300, 26200) },
    entrance: { positionMm: at(3300, 26000), directionDeg: 305 },
    ascent: { kind: 'stairs', fromMm: at(8500, 18300), toMm: at(13300, 18300) },
    descent: { kind: 'stairs', fromMm: at(23700, 16000), toMm: at(28800, 16000) },
    route: { widthMm: Math.round(1700 * size), toPlatformViaMm: [at(14200, 23300)], toCraterViaMm: [at(23500, 21500)] },
    flow: null, regions: [], materials: { ground: ref('wind-laid-ash'), mountain: ref('fractured-basalt'),
      crater: ref('cooled-lava-crust'), platform: ref('worn-ash-path'), flow: ref('molten-lava'), route: ref('worn-ash-path') },
  } }, contours: { mountain, crater, platform, lava }, lavaAreaId: `${prefix}-lava-area`, lavaRegionId: `${prefix}-lava-hazard` }
}

/** Explicit, reviewable finite edits after native generation; no render-time replacement. */
export function naturalVolcanoFinishCommands(document: SceneDocument, profile: NaturalVolcanoProfile, report: VolcanoReport): SceneCommand[] {
  const p = profile.input.parameters, { floorId, layerId } = p, size = Math.min(p.boundsMm.width / 50000, p.boundsMm.height / 38000)
  const commands: SceneCommand[] = []
  const shapedAreas = new Set([report.mountainAreaId, report.craterAreaId, report.platformAreaId])
  // These declarations were just created by the native volcano generator and
  // carry only its default height-boundary behavior. The same exposed height
  // boundaries remain derived from the refined saved terrain. Refuse any
  // authored declaration rather than discard its locks, barriers or finish.
  for (const edge of Object.values(document.terrainEdges).filter(edge => shapedAreas.has(edge.source.areaId))) {
    if (edge.editLocked || edge.visibility !== 'public' || edge.kind !== 'cliff' || !edge.blocksMovement || edge.blocksSight
      || edge.shoreline || edge.surfaceStyle !== null || edge.styleOverride !== null
      || document.entityLayers[edge.id] !== layerId) throw new Error('自然火山不能丢弃带人工语义的地形边缘。')
    commands.push({ type: 'deleteOutdoorEntity', kind: 'terrainEdge', id: edge.id })
  }
  const style = (key: string, rotationDeg = 0): SurfaceStyle => {
    const material = document.materials[volcanicSurfaceDefinitionId(key)]
    if (!material || material.version !== 1) throw new Error('自然火山固定材质缺失或版本不同。')
    return { base: { materialRef: { id: material.id, version: 1 }, tileSizeMm: { ...material.defaultTileSizeMm },
      rotationDeg, originMm: { x: 0, y: 0 }, alignment: 'world', tint: null, opacity: 1 }, overlays: [] }
  }
  for (const [key, areaId] of [['mountain', report.mountainAreaId], ['crater', report.craterAreaId], ['platform', report.platformAreaId]] as const) {
    const area = document.terrainAreas[areaId]
    if (!area) throw new Error(`自然火山缺少真实地形：${key}`)
    const boundary = profile.contours[key]
    if (sampleVisualBoundary(boundary).points.length > 256) throw new Error('自然火山细化轮廓超过单地形256点预算。')
    commands.push({ type: 'upsertVisualBoundary', boundary: { ...boundary, binding: { kind: 'terrain', sides: [{ areaId,
      startPointId: area.boundaryMm[0].id, endPointId: area.boundaryMm[0].id, reverse: false }] } } })
    if (key === 'crater') {
      const region = report.regionIds.map(id => document.regions[id]).find(region => region
        && JSON.stringify(region.boundaryMm) === JSON.stringify(p.crater.boundaryMm))
      if (!region) throw new Error('自然火山缺少与原火口同形的显式危险区域。')
      commands.push({ type: 'updateRegion', id: region.id, changes: { boundaryMm: sampleVisualBoundary(boundary).points } })
    }
    if (key === 'platform') {
      const platformStyle = style('fractured-basalt')
      platformStyle.overlays.push({ id: 'natural-volcano-soft-activity-clearing', boundaryMm: sampleVisualBoundary(boundary).points,
        paint: { ...style('worn-ash-path').base, opacity: .65 }, blendWidthMm: Math.round(1400 * size), renderOrder: 0 })
      commands.push({ type: 'setVisualSurface', kind: 'terrainArea', id: areaId, style: platformStyle })
      continue
    }
    commands.push({ type: 'upsertVisualEdgeLook', edgeLook: { id: `${boundary.id}-relief`, floorId, layerId,
      visibility: 'public', editLocked: false, boundaryId: boundary.id, kind: 'cliff', side: key === 'crater' ? 'left' : 'right',
      widthMm: Math.round((key === 'crater' ? 1645 : 1295) * size), color: key === 'crater' ? '#4C4E42' : '#555D4F',
      accentColor: key === 'crater' ? '#A59B78' : '#B1AB88', opacity: .94, intensity: 1.05,
      seed: `${profile.input.seed}-${key}-relief`, repeatMm: Math.round(430 * size), enabled: true, renderProfile: 'rockRelief4' } })
  }
  const lavaPoints = sampleVisualBoundary(profile.contours.lava).points
  if (lavaPoints.length > 256) throw new Error('自然火山熔岩轮廓超过单地形256点预算。')
  commands.push({ type: 'createTerrainArea', id: profile.lavaAreaId, floorId, layerId, boundaryMm: lavaPoints,
    groundElevationMm: p.crater.elevationMm, coveragePriority: 3, surfaceStyle: style('molten-lava'),
    blocksMovement: false, blocksSight: false, movementCostMultiplier: 1, visibility: 'public' },
  { type: 'createRegion', id: profile.lavaRegionId, floorId, layerId, boundaryMm: lavaPoints, kind: 'hazard',
    blocksMovement: true, movementCostMultiplier: 4, visibility: 'public' },
  { type: 'upsertVisualBoundary', boundary: { ...profile.contours.lava, binding: { kind: 'terrain', sides: [{ areaId: profile.lavaAreaId,
    startPointId: `${profile.lavaAreaId}:point:0`, endPointId: `${profile.lavaAreaId}:point:0`, reverse: false }] } } },
  { type: 'upsertVisualEdgeLook', edgeLook: { id: 'natural-volcano-lava-contact', floorId, layerId, visibility: 'public', editLocked: false,
    boundaryId: profile.contours.lava.id, kind: 'shore', side: 'both', widthMm: Math.round(210 * size), color: '#9E4931', accentColor: '#F9C76C',
    opacity: .78, intensity: .86, seed: `${profile.input.seed}-lava-contact`, repeatMm: Math.round(170 * size), enabled: true } })
  for (const connectionId of report.connectionIds) {
    const connection = document.terrainConnections[connectionId]
    if (!connection || connection.kind !== 'stairs') throw new Error('自然火山作者模板仅修饰明确的真实阶梯。')
    const from = connection.from.positionMm, to = connection.to.positionMm
    const controls = { version: 1 as const, kind: 'polyline' as const,
      segments: [{ id: `${connectionId}-rock-control`, start: from, control1: from, control2: to, end: to }],
      sampleSpacingMm: Math.round(500 * size), toleranceMm: 20, stairStyle: 'naturalRock' as const,
      treadDepthMm: Math.round(280 * size), renderProfile: 'naturalRockSteps4' as const }
    commands.push({ type: 'updateTerrainConnection', id: connectionId, changes: { route: { ...controls, centerlineMm: sampleConnectionRoute(controls) },
      surfaceStyle: style('fractured-basalt', 12) } })
  }
  const at = (x: number, y: number): PointMm => ({ x: p.boundsMm.x + Math.round(p.boundsMm.width * x / 50000), y: p.boundsMm.y + Math.round(p.boundsMm.height * y / 38000) })
  const curve = (id: string, a: PointMm, b: PointMm, c: PointMm, d: PointMm) => ({ id, start: a, control1: b, control2: c, end: d })
  for (const [index, pathId] of report.pathIds.entries()) {
    const path = document.paths[pathId]
    if (!path) throw new Error('自然火山缺少需要绑定的真实道路。')
    const segments = index === 0 ? [
      curve(`${pathId}-curve-0`, p.entrance.positionMm, at(3700, 22200), at(4500, 18300), p.ascent.fromMm),
      curve(`${pathId}-curve-1`, p.ascent.fromMm, p.ascent.fromMm, p.ascent.toMm, p.ascent.toMm),
      curve(`${pathId}-curve-2`, p.ascent.toMm, at(17400, 18300), at(14300, 26200), p.platform.anchorMm),
    ] : [
      curve(`${pathId}-curve-0`, p.platform.anchorMm, at(21800, 26200), at(21200, 23500), at(21200, 20000)),
      curve(`${pathId}-curve-1`, at(21200, 20000), at(21200, 17400), at(21200, 16000), p.descent.fromMm),
      curve(`${pathId}-curve-2`, p.descent.fromMm, p.descent.fromMm, p.descent.toMm, p.descent.toMm),
    ]
    const boundary: VisualBoundary = { id: `${pathId}-natural-boundary`, floorId, layerId, visibility: 'public', editLocked: false,
      closed: false, sampleSpacingMm: Math.max(500, Math.round(1800 * size)), toleranceMm: 70, segments, binding: { kind: 'path', pathId } }
    const pathStyle = style('fractured-basalt')
    const cuts = report.connectionIds.map(id => {
      const connection = document.terrainConnections[id], a = connection.from.positionMm, b = connection.to.positionMm
      const length = Math.hypot(b.x - a.x, b.y - a.y), dx = (b.x - a.x) / length * 650 * size, dy = (b.y - a.y) / length * 650 * size
      return { outer: corridor({ x: a.x - dx, y: a.y - dy }, { x: b.x + dx, y: b.y + dy }, connection.widthMm + 600 * size)
        .map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })), holes: [] }
    })
    const paintRegions = polygonBooleanWithHoles({ operation: 'difference', subject: [{ outer: pathPolygon({ ...path,
      centerlineMm: sampleVisualBoundary(boundary).points }).map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })), holes: [] }], clip: cuts })
    for (const [patchIndex, region] of paintRegions.polygons.entries()) {
      if (region.holes.length) throw new Error('自然火山道路落地过渡必须是无洞的独立带区。')
      pathStyle.overlays.push({ id: `${pathId}-worn-ash-${patchIndex}`, boundaryMm: region.outer.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })),
        paint: style('worn-ash-path', 8).base, blendWidthMm: Math.round(450 * size), renderOrder: patchIndex })
    }
    commands.push({ type: 'upsertVisualBoundary', boundary },
      { type: 'setVisualSurface', kind: 'path', id: pathId, style: pathStyle })
  }
  commands.push({ type: 'setVisualEnvironment', environment: { ambientColor: '#879389', ambientOpacity: .045, exposure: 1.03,
    lightDirectionDeg: 135, contactShadowMm: 90, contactShadowOpacity: .25 } },
  { type: 'upsertVisualFilter', filter: { id: 'natural-volcano-paper-grade', floorId, layerId, visibility: 'public', editLocked: false,
    target: { kind: 'scene' }, preset: 'neutral', exposure: 1, saturation: .92, contrast: 1.05, vignette: .035, grain: .008,
    seed: `${profile.input.seed}-paper`, enabled: true } })
  for (const [index, t] of [.18, .47, .78].entries()) {
    const boundary = lavaPoints[Math.floor(lavaPoints.length * t)]
    commands.push({ type: 'upsertVisualLight', light: { id: `natural-volcano-heat-${index}`, floorId, layerId,
      visibility: 'public', editLocked: false, positionMm: boundary, radiusMm: Math.round(2600 * size),
      color: '#F0AB61', intensity: .27, wallOcclusion: false, enabled: true } })
  }
  commands.push({ type: 'createNote', id: 'natural-volcano-gm-observation-area', floorId, layerId,
    anchor: { type: 'point', positionMm: p.platform.anchorMm }, kind: 'note', title: '灰脊火口观测步道',
    text: '西南清理区与山肩同高程1800mm，保留完整活动支撑和路线净宽；火口为-400mm。两条真实岩阶分别跨越地面至山肩、山肩至火口的高差，曲线路面不授予额外跨越能力。冷壳区域危险但可通行，移动代价2；熔岩池的同形区域危险、阻挡并保存移动代价4。岩层、热裂和暖光只改变外观，没有连续坡面、流体、热力或伤害模拟。',
    visibility: 'gm', discovered: false })
  return commands
}
