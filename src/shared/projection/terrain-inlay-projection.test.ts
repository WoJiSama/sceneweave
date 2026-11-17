import { describe, expect, it, vi } from 'vitest'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { selectionGeometry, hitTestAll, selectInBounds } from '../../editor/native-canvas/selection.js'
import { boundaryConnections, clipConnectionOpenings } from '../../platform/browser/render/connection-geometry.js'
import { connectionPolygon } from '../../platform/browser/render/canvas-renderer.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { certifyCompositionContent } from '../validation/content.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { terrainInlayHash, terrainInlaySource } from '../terrain-inlay/scene.js'
import { inspectTerrainInlayVisualScope, planTerrainInlayVisualScope } from '../terrain-inlay/visual-scope.js'
import { createPublicVisibility, publicTerrainView } from '../geometry/visibility.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { PointMm } from '../model/scene.js'
import { visualBase } from '../visual/base.js'
import { projectVisualSystem } from '../visual/projection.js'
import { projectScene, projectEditorScene } from './projection.js'
import type { ProjectedSurface } from './types.js'

const floorId = 'blank-floor'
const rect = (x0: number, y0: number, x1: number, y1: number): PointMm[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
function setup(visibility: 'public' | 'gm' = 'public') {
  const scene = fixture().project.document; scene.props = {}; delete scene.entityLayers.item; delete scene.entityLayers.other
  scene.regions['fixed-mask'] = { id: 'fixed-mask', floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', boundaryMm: rect(0, 0, 20000, 20000), blocksMovement: false, movementCostMultiplier: 1 }
  scene.entityLayers['fixed-mask'] = Object.keys(scene.userLayers)[0]
  const initial = certifyCompositionContent(createCompositionContent(scene, runtime))
  const create = (id: string, points: PointMm[], z: number): CompositionCommand => ({ type: 'createTerrainArea', id, floorId,
    boundaryMm: points, groundElevationMm: z, coveragePriority: id === 'high' ? 2 : 1, visibility: 'public', surfaceStyle: null })
  let before = applyCompositionDraftCommands(initial, [create('low', rect(1000, 1000, 10000, 9000), 1000), create('high', rect(5000, 2000, 9500, 8000), 3000),
    { type: 'updateTerrainArea', id: 'high', changes: { coveragePriority: 2 } },
    { type: 'createTerrainConnection', id: 'road', floorId, kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: 'low' }, positionMm: { x: 2000, y: 5000 } },
      to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 8000, y: 5000 } }, widthMm: 2000, openingId: null, visibility, surfaceStyle: null }], runtime)
  // Separately hidden dependency layers make it possible to prove omission of
  // the whole actual composition without hiding all other source paint.
  const document = cloneJson(before.document)
  for (const id of ['low', 'high', 'road']) {
    const layerId = `${id}-layer`; document.userLayers[layerId] = { id: layerId, floorId, name: layerId, order: Object.keys(document.userLayers).length, editLocked: false }; document.entityLayers[id] = layerId
  }
  before = certifyCompositionContent({ ...before, document })
  const verticesMm = { a: { x: 2000, y: 4000, z: 1000 }, b: { x: 8000, y: 4000, z: 3000 }, t: { x: 8000, y: 5000, z: 3000 },
    c: { x: 8000, y: 6000, z: 3000 }, d: { x: 2000, y: 6000, z: 1000 }, s: { x: 2000, y: 5000, z: 1000 },
    e: { x: 2000, y: 3500, z: 1000 }, f: { x: 8000, y: 3500, z: 3000 } }
  const triangles: { ids: [keyof typeof verticesMm, keyof typeof verticesMm, keyof typeof verticesMm]; kind: 'walk' | 'apron' }[] = [
    { ids: ['a', 'b', 't'], kind: 'walk' }, { ids: ['a', 't', 's'], kind: 'walk' }, { ids: ['s', 't', 'c'], kind: 'walk' }, { ids: ['s', 'c', 'd'], kind: 'walk' },
    { ids: ['e', 'f', 'b'], kind: 'apron' }, { ids: ['e', 'b', 'a'], kind: 'apron' },
  ]
  const command: Extract<CompositionCommand, { type: 'adoptTerrainInlay' }> = { type: 'adoptTerrainInlay', id: 'road', expectedConnectionHash: terrainInlayHash(before.document.terrainConnections.road), centerlineVertexIds: ['s', 't'],
    geometry: { sources: ['low', 'high'].map(id => terrainInlaySource(document.terrainAreas[id])), verticesMm,
      faces: Object.fromEntries(triangles.map(({ ids: vertexIds, kind }, i) => [`inlay-f${i}`, { id: `inlay-f${i}`, kind, vertexIds }])),
      footprintVertexIds: ['e', 'f', 'b', 't', 'c', 'd', 's', 'a'], walkBoundaryVertexIds: ['a', 'b', 't', 'c', 'd', 's'] } }
  const after = applyCompositionDraftCommands(before, [command], runtime)
  return { before, after, command }
}
const paintRegions = (surface: ProjectedSurface): MultiPolygon => surface.regionsMm
  ? surface.regionsMm.map(r => [r.outerMm.map(p => [p.x, p.y] as [number, number]), ...r.holesMm.map(ring => ring.map(p => [p.x, p.y] as [number, number]))]) : [[surface.points.map(p => [p.x, p.y] as [number, number])]]
const poly = (points: PointMm[]): MultiPolygon => [[points.map(p => [p.x, p.y] as [number, number])]]
const area = (multi: MultiPolygon) => multi.reduce((sum, p) => sum + p.reduce((s, r, i) => s + (i ? -1 : 1) * Math.abs(r.reduce((a, p, j) => a + p[0] * r[(j + 1) % r.length][1] - r[(j + 1) % r.length][0] * p[1], 0) / 2), 0), 0)

function authoredSource(kind: 'cliff' | 'shore') {
  const { before, command } = setup(), document = cloneJson(before.document), base = visualBase(document)!
  for (const id of ['paint-layer', 'boundary-layer']) document.userLayers[id] = { id, floorId, name: id, order: Object.keys(document.userLayers).length, editLocked: false }
  base.boundaries.edge = { id: 'edge', floorId, layerId: 'boundary-layer', visibility: 'public', editLocked: false, closed: false, sampleSpacingMm: 10000, toleranceMm: 1,
    segments: [{ id: 'edge-cubic', start: { x: 5000, y: 8000 }, control1: { x: 5000, y: 8000 }, control2: { x: 5000, y: 2000 }, end: { x: 5000, y: 2000 } }],
    binding: { kind: 'terrain', sides: [{ areaId: 'high', startPointId: document.terrainAreas.high.boundaryMm[3].id, endPointId: document.terrainAreas.high.boundaryMm[0].id, reverse: false }] } }
  base.edgeLooks.look = { id: 'look', boundaryId: 'edge', floorId, layerId: 'paint-layer', visibility: 'public', editLocked: false, kind, side: 'both', widthMm: 500,
    color: '#39443E', accentColor: '#A79878', opacity: 1, intensity: 1, seed: 'retain-complete-arc', repeatMm: 500, enabled: true,
    ...(kind === 'cliff' ? { renderProfile: 'rockRelief7' as const } : {}) }
  return { before: certifyCompositionContent({ ...before, document }), command }
}

type VisualLockTarget = 'look' | 'boundary' | 'paint-layer' | 'boundary-layer'
function lockedVisual(content: ReturnType<typeof authoredSource>['before'], target: VisualLockTarget) {
  const document = cloneJson(content.document), base = visualBase(document)!
  if (target === 'look') base.edgeLooks.look.editLocked = true
  else if (target === 'boundary') base.boundaries.edge.editLocked = true
  else document.userLayers[target].editLocked = true
  return certifyCompositionContent({ ...content, document })
}

describe('cross-terrace actual projection and editor geometry', () => {
  it('paints explicit source-ground across the complete walk/apron with original disjoint source ownership', () => {
    const { after } = setup(), old = projectScene(after.document, 'gm')
    expect(old.inlays![0].groundSurfaces).toBeUndefined()
    expect(old.connections[0].inlayAppearance).toBeUndefined()
    const updated = applyCompositionDraftCommands(after, [{ type: 'setTerrainInlayAppearance', id: 'road', appearance: 'source-ground',
      expectedConnectionHash: terrainInlayHash(after.document.terrainConnections.road) }], runtime)
    const projected = projectScene(updated.document, 'gm'), inlay = projected.inlays![0]
    expect(projected.connections[0].inlayAppearance).toBe('source-ground')
    expect(inlay.patches).toEqual(old.inlays![0].patches)
    expect(inlay.walls).toEqual(old.inlays![0].walls)
    expect(inlay.walkFootprintMm).toEqual(old.inlays![0].walkFootprintMm)
    expect(inlay.apronSurfaces).toEqual(old.inlays![0].apronSurfaces)
    const regions = inlay.groundSurfaces!.map(surface => surface.regionsMm.map(r => [r.outerMm.map(p => [p.x, p.y] as [number, number]), ...r.holesMm.map(ring => ring.map(p => [p.x, p.y] as [number, number]))]))
    expect(area(polygonClipping.intersection(regions[0], regions[1]))).toBeCloseTo(0, 6)
    expect(area(polygonClipping.xor(polygonClipping.union(regions[0], regions[1]), poly(inlay.footprintMm)))).toBeCloseTo(0, 6)
    const hidden = cloneJson(updated.document); hidden.terrainConnections.road.visibility = 'gm'
    expect(projectScene(hidden, 'player').inlays).toBeUndefined()
    expect(projectScene(hidden, 'player').connections).toEqual([])
  })
  it('cuts both source tops including apron, preserves untouched original edges and replaces only exact changed intervals', () => {
    const { before, after } = setup(), original = canonicalJson(after.document), old = projectScene(before.document, 'gm'), projected = projectScene(after.document, 'gm')
    const inlay = projected.inlays![0]
    expect(inlay.patches.filter(p => p.kind === 'walk')).toHaveLength(4)
    expect(inlay.patches.filter(p => p.kind === 'apron')).toHaveLength(2)
    const actualApron = polygonClipping.union(...inlay.patches.filter(p => p.kind === 'apron').map(p => poly(p.pointsMm)) as [MultiPolygon, ...MultiPolygon[]])
    const ownedAprons = inlay.apronSurfaces.flatMap(patch => {
      expect(['low', 'high']).toContain(patch.sourceAreaId)
      const original = old.terrain.find(area => area.id === patch.sourceAreaId)!
      const regions = patch.regionsMm.map(r => [r.outerMm.map(p => [p.x, p.y] as [number, number]), ...r.holesMm.map(ring => ring.map(p => [p.x, p.y] as [number, number]))])
      expect(area(polygonClipping.difference(regions, poly(original.points)))).toBeCloseTo(0, 6)
      return regions
    })
    expect(area(polygonClipping.xor(ownedAprons, actualApron))).toBeCloseTo(0, 6)
    expect(area(polygonClipping.intersection(ownedAprons, poly(inlay.walkFootprintMm)))).toBeCloseTo(0, 6)
    expect(inlay.walls.length).toBeGreaterThan(0)
    expect(projected.connections).toHaveLength(1)
    expect(projected.connections[0].route).toBeUndefined()
    expect(connectionPolygon(projected.connections[0])).toEqual(inlay.walkFootprintMm)
    for (const top of projected.terrain.filter(a => ['low', 'high'].includes(a.id))) {
      expect(area(polygonClipping.intersection(paintRegions(top), poly(inlay.footprintMm)))).toBeCloseTo(0, 6)
      expect(top.points).toEqual(old.terrain.find(a => a.id === top.id)!.points)
    }
    const removed = old.edges.find(e => e.sourceAreaId === 'high' && e.start.x === 5000 && e.end.x === 5000)!
    const remainders = projected.edges.filter(e => e.id.startsWith(removed.id + ':inlay-remainder:'))
    expect(remainders).toHaveLength(2)
    expect(remainders.map(e => Math.abs(e.end.y - e.start.y)).sort((a, b) => a - b)).toEqual([1500, 2000])
    for (const edge of old.edges.filter(e => e.id !== removed.id)) expect(projected.edges.find(e => e.id === edge.id)).toEqual(edge)
    expect(projectScene(JSON.parse(canonicalJson(after.document)), 'gm')).toEqual(projected)
    const reordered = cloneJson(after.document), geometry = reordered.terrainConnections.road.terrainInlay!.geometry
    geometry.faces = Object.fromEntries(Object.entries(geometry.faces).reverse())
    geometry.verticesMm = Object.fromEntries(Object.entries(geometry.verticesMm).reverse())
    expect(projectScene(reordered, 'gm')).toEqual(projected)
    expect(canonicalJson(after.document)).toBe(original)
    expect(JSON.stringify(projected)).not.toMatch(/originalConnection|sourceProofs|lineageId|birthToken|topologyToken|geometryHash/)
  })

  it('keeps a private inlay absent from public top/edges and all dependency views', () => {
    const { before, after } = setup('gm'), player = projectScene(after.document, 'player'), baseline = projectScene(before.document, 'player')
    expect(player.terrain).toEqual(baseline.terrain); expect(player.edges).toEqual(baseline.edges)
    expect(player.connections).toEqual([]); expect(player.inlays).toBeUndefined()
    expect(createPublicVisibility(after.document).terrainConnection('road')).toBe(false)
    expect(publicTerrainView(after.document).terrainConnections.road).toBeUndefined()
    expect(JSON.stringify(player)).not.toMatch(/inlay-f|sourceProofs|originalConnection|lineageId|birthToken/)
    expect(projectScene(JSON.parse(canonicalJson(after.document)), 'player')).toEqual(player)
  })

  it.each(['low', 'high', 'road'])('omits the whole composition when %s layer is hidden, without cutting either surviving top', id => {
    const { after } = setup(), projected = projectEditorScene(after.document, { hiddenLayerIds: new Set([id + '-layer']) })
    expect(projected.inlays).toBeUndefined(); expect(projected.connections).toEqual([])
    expect(projected.terrain.every(a => a.regionsMm === undefined)).toBe(true)
  })

  it('selects the actual apron in exact and coarse queries while ordinary route opening paint cannot cut it again', () => {
    const { after } = setup(), scene = after.document, inlay = projectScene(scene, 'gm').inlays![0]
    expect(selectionGeometry(scene, 'road')).toEqual([inlay.footprintMm])
    expect(hitTestAll(scene, { x: 4000, y: 3700 }, 0)).toContain('road')
    expect(selectInBounds(scene, { x: 3900, y: 3600, width: 200, height: 200 }, 'intersect').ids).toContain('road')
    const connection = projectScene(scene, 'gm').connections[0]
    expect(boundaryConnections([connection], [{ x: 5000, y: 2000 }, { x: 5000, y: 8000 }], false, ['low', 'high'])).toEqual([])
    // Inlay is skipped before touching Canvas; an accidental straight-band
    // opening would dereference this deliberately empty context.
    expect(() => clipConnectionOpenings({} as CanvasRenderingContext2D, { x: 0, y: 0, width: 10000, height: 10000 }, [connection])).not.toThrow()
  })

  it('keeps old visual phases intact and excludes only owned changed carrier paint plus the complete influence', () => {
    const { after } = setup(), scene = cloneJson(after.document), layerId = scene.entityLayers.high
    const base = visualBase(scene)!
    base.boundaries.edge = { id: 'edge', floorId, layerId, visibility: 'public', editLocked: false, closed: false, sampleSpacingMm: 500, toleranceMm: 1,
      segments: [{ id: 'edge-cubic', start: { x: 5000, y: 8000 }, control1: { x: 5000, y: 8000 }, control2: { x: 5000, y: 2000 }, end: { x: 5000, y: 2000 } }],
      binding: { kind: 'terrain', sides: [{ areaId: 'high', startPointId: scene.terrainAreas.high.boundaryMm[3].id, endPointId: scene.terrainAreas.high.boundaryMm[0].id, reverse: false }] } }
    base.edgeLooks.look = { id: 'look', boundaryId: 'edge', floorId, layerId, visibility: 'public', editLocked: false, kind: 'cliff', side: 'both', widthMm: 500,
      color: '#39443E', accentColor: '#A79878', opacity: 1, intensity: 1, seed: 'retain-complete-arc', repeatMm: 500, enabled: true, renderProfile: 'rockRelief7' }
    const projected = projectScene(after.document, 'gm')
    // The visual projection consumes an already-validated physical projection;
    // this focused planner test supplies its own explicit sampled edge rather
    // than changing the persistent source boundary to match a new curve.
    projected.visual = projectVisualSystem(scene, base, projected, 'gm')
    expect(projected.visual!.edgeLooks[0]).toEqual(base.edgeLooks.look)
    expect(projected.visual!.boundaries[0].points[0]).toEqual({ x: 5000, y: 8000 })
    expect(projected.visual!.boundaries[0].points.at(-1)).toEqual({ x: 5000, y: 2000 })
    const exclusions = projected.visual!.inlayExclusions!.find(r => r.paintId === 'look')!
    const domains = exclusions.regionsMm.map(r => [r.outerMm.map(p => [p.x, p.y] as [number, number]), ...r.holesMm.map(ring => ring.map(p => [p.x, p.y] as [number, number]))])
    expect(area(polygonClipping.intersection(domains, poly(rect(4500, 6900, 5500, 7100))))).toBeCloseTo(0, 6)
    expect(area(polygonClipping.intersection(domains, poly(projected.inlays![0].footprintMm)))).toBeCloseTo(15_000_000, 3)
    base.edgeLooks.look.renderProfile = 'rockRelief5'
    expect(() => projectVisualSystem(scene, base, projected, 'gm')).toThrow(/逐段归属/)
  })

  it('rejects an overlapping saved decoration instead of silently cutting authored paint', () => {
    const { after } = setup(), scene = cloneJson(after.document), base = visualBase(scene)!, layerId = scene.entityLayers.high
    base.boundaries['authored-grass'] = { id: 'authored-grass', floorId, layerId, visibility: 'public', editLocked: false, closed: false,
      sampleSpacingMm: 1000, toleranceMm: 1, binding: { kind: 'decoration' },
      segments: [{ id: 'grass-cubic', start: { x: 2000, y: 5000 }, control1: { x: 2000, y: 5000 }, control2: { x: 8000, y: 5000 }, end: { x: 8000, y: 5000 } }] }
    base.edgeLooks['authored-look'] = { id: 'authored-look', boundaryId: 'authored-grass', floorId, layerId, visibility: 'public', editLocked: false,
      kind: 'grass', side: 'both', widthMm: 200, color: '#39443E', accentColor: '#71865A', opacity: 1, intensity: 1, seed: 'manual-paint-canary', repeatMm: 300, enabled: true }
    const before = canonicalJson(scene), projected = projectScene(after.document, 'gm')
    expect(() => projectVisualSystem(scene, base, projected, 'gm')).toThrow(/既有草带/)
    expect(canonicalJson(scene)).toBe(before)
    base.boundaries['authored-grass'].visibility = 'gm'; base.edgeLooks['authored-look'].visibility = 'gm'
    const player = projectScene(after.document, 'player')
    expect(projectVisualSystem(scene, base, player, 'player').inlayExclusions).toEqual([])
  })

  it('lists source-bound shoreline coverage explicitly while preserving its complete saved record', () => {
    const { after } = setup(), scene = cloneJson(after.document), base = visualBase(scene)!, layerId = scene.entityLayers.low
    base.boundaries.shore = { id: 'shore', floorId, layerId, visibility: 'public', editLocked: false, closed: false,
      sampleSpacingMm: 1000, toleranceMm: 1, binding: { kind: 'terrain', sides: [{ areaId: 'low', startPointId: 'start', endPointId: 'end', reverse: false }] },
      segments: [{ id: 'shore-cubic', start: { x: 2000, y: 3500 }, control1: { x: 2000, y: 3500 }, control2: { x: 8000, y: 3500 }, end: { x: 8000, y: 3500 } }] }
    base.edgeLooks['source-shore'] = { id: 'source-shore', boundaryId: 'shore', floorId, layerId, visibility: 'public', editLocked: false,
      kind: 'shore', side: 'both', widthMm: 180, color: '#D9D4B4', accentColor: '#D9D4B4', opacity: 1, intensity: 1, seed: 'keep-shore-phase', repeatMm: 300, enabled: true }
    const saved = canonicalJson(scene), projected = projectScene(after.document, 'gm')
    const visual = projectVisualSystem(scene, base, projected, 'gm')
    expect(projected.inlays![0].scopedPaintIds).toEqual(['source-shore'])
    expect(visual.inlayExclusions![0].paintId).toBe('source-shore')
    expect(area(visual.inlayExclusions![0].regionsMm.map(r => [r.outerMm.map(p => [p.x, p.y] as [number, number]), ...r.holesMm.map(ring => ring.map(p => [p.x, p.y] as [number, number]))]))).toBeCloseTo(15_000_000, 3)
    expect(canonicalJson(scene)).toBe(saved)
  })

  it.each(['cliff', 'shore'] as const)('shares %s scope between commands and projection and preserves authored records', kind => {
    const { before, command } = authoredSource(kind), saved = canonicalJson(visualBase(before.document))
    const scope = inspectTerrainInlayVisualScope(before.document, 'road', command.geometry)
    expect(scope.paintIds).toEqual(['look']); expect(scope.boundaryIds).toEqual(['edge'])
    expect(scope.layerIds).toEqual(['boundary-layer', 'paint-layer'])
    expect(scope.scopedPaintIds).toEqual(kind === 'shore' ? ['look'] : [])
    const after = applyCompositionDraftCommands(before, [command], runtime), projection = projectScene(after.document, 'gm')
    expect(projection.visual!.inlayExclusions!.map(row => row.paintId)).toEqual(scope.paintIds)
    expect(projection.inlays![0].scopedPaintIds ?? []).toEqual(scope.scopedPaintIds)
    expect(canonicalJson(visualBase(after.document))).toBe(saved)
    const restored = applyCompositionDraftCommands(after, [{ type: 'restoreTerrainInlaySource', id: 'road', disposition: 'restore-original-connection-and-ground' }], runtime)
    expect(canonicalJson(visualBase(restored.document))).toBe(saved)
  })

  it.each((['cliff', 'shore'] as const).flatMap(kind => (['look', 'boundary', 'paint-layer', 'boundary-layer'] as const).map(target => ({ kind, target }))))(
    'refuses adopt and restore when affected $kind $target is locked', ({ kind, target }) => {
      const { before, command } = authoredSource(kind), lockedBefore = lockedVisual(before, target), original = canonicalJson(lockedBefore)
      expect(() => applyCompositionDraftCommands(lockedBefore, [command], runtime)).toThrow(/锁定视觉/)
      expect(canonicalJson(lockedBefore)).toBe(original)
      const after = applyCompositionDraftCommands(before, [command], runtime), lockedAfter = lockedVisual(after, target), saved = canonicalJson(lockedAfter)
      expect(() => applyCompositionDraftCommands(lockedAfter, [{ type: 'restoreTerrainInlaySource', id: 'road', disposition: 'restore-original-connection-and-ground' }], runtime)).toThrow(/锁定视觉/)
      expect(canonicalJson(lockedAfter)).toBe(saved)
    })

  it('retains an unrelated locked cliff and its layer outside the finite scope', () => {
    const { before, command } = authoredSource('cliff'), document = cloneJson(before.document), base = visualBase(document)!
    document.userLayers['far-paint-layer'] = { id: 'far-paint-layer', floorId, name: 'far', order: Object.keys(document.userLayers).length, editLocked: true }
    base.boundaries.far = { ...cloneJson(base.boundaries.edge), id: 'far', layerId: 'far-paint-layer', editLocked: true,
      segments: [{ id: 'far-cubic', start: { x: 5000, y: 2000 }, control1: { x: 5000, y: 2000 }, control2: { x: 9500, y: 2000 }, end: { x: 9500, y: 2000 } }],
      binding: { kind: 'terrain', sides: [{ areaId: 'high', startPointId: document.terrainAreas.high.boundaryMm[0].id, endPointId: document.terrainAreas.high.boundaryMm[1].id, reverse: false }] } }
    base.edgeLooks['far-look'] = { ...cloneJson(base.edgeLooks.look), id: 'far-look', boundaryId: 'far', layerId: 'far-paint-layer', editLocked: true, widthMm: 100 }
    const source = certifyCompositionContent({ ...before, document }), scope = inspectTerrainInlayVisualScope(source.document, 'road', command.geometry)
    expect(scope.paintIds).toEqual(['look'])
    expect(scope.layerIds).not.toContain('far-paint-layer')
    const saved = canonicalJson(base), after = applyCompositionDraftCommands(source, [command], runtime)
    expect(canonicalJson(visualBase(after.document))).toBe(saved)
    expect(projectScene(after.document, 'gm').visual!.inlayExclusions!.map(row => row.paintId)).toEqual(['look'])
    const restored = applyCompositionDraftCommands(after, [{ type: 'restoreTerrainInlaySource', id: 'road', disposition: 'restore-original-connection-and-ground' }], runtime)
    expect(canonicalJson(visualBase(restored.document))).toBe(saved)
  })

  it('rejects legacy cliff paint touching the actual influence even without a changed carrier', () => {
    const { before, command } = authoredSource('cliff'), document = cloneJson(before.document), base = visualBase(document)!
    base.boundaries.edge.segments = [{ id: 'edge-cubic', start: { x: 5000, y: 2000 }, control1: { x: 5000, y: 2000 }, control2: { x: 9500, y: 2000 }, end: { x: 9500, y: 2000 } }]
    base.boundaries.edge.binding = { kind: 'terrain', sides: [{ areaId: 'high', startPointId: document.terrainAreas.high.boundaryMm[0].id, endPointId: document.terrainAreas.high.boundaryMm[1].id, reverse: false }] }
    base.edgeLooks.look.widthMm = 1000; base.edgeLooks.look.renderProfile = 'rockRelief5'
    const source = certifyCompositionContent({ ...before, document }), projected = projectScene(source.document, 'gm')
    const input = { id: 'road', sourceIds: ['low', 'high'], changedCarriers: [], footprintMm: command.geometry.footprintVertexIds.map(id => command.geometry.verticesMm[id]) }
    expect(() => planTerrainInlayVisualScope([input], projected.visual!)).toThrow(/逐段归属/)
    expect(() => applyCompositionDraftCommands(source, [command], runtime)).toThrow(/逐段归属/)
  })

  it('meters reach edges against every footprint edge before boolean execution', () => {
    const { before } = authoredSource('cliff'), visual = projectScene(before.document, 'gm').visual!
    const footprintMm = Array.from({ length: 512 }, (_, i) => ({ x: Math.round(5000 + 1000 * Math.cos(i * Math.PI / 256)), y: Math.round(5000 + 1000 * Math.sin(i * Math.PI / 256)) }))
    const boundaries = ['edge-a', 'edge-b'].map((id, j) => ({ ...visual.boundaries[0], id,
      points: Array.from({ length: 512 }, (_, i) => ({ x: 5000 + i * 4, y: 2000 + j * 100 })) }))
    const edgeLooks = boundaries.map((boundary, i) => ({ ...visual.edgeLooks[0], id: `look-${i}`, boundaryId: boundary.id }))
    const intersection = vi.spyOn(polygonClipping, 'intersection')
    try {
      expect(() => planTerrainInlayVisualScope([{ id: 'road', sourceIds: ['low', 'high'], footprintMm, changedCarriers: [] }], { boundaries, edgeLooks })).toThrow(/有限工作预算/)
      expect(intersection).not.toHaveBeenCalled()
    } finally { intersection.mockRestore() }
  })
})
