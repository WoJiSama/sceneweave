import { describe, expect, it } from 'vitest'
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

describe('cross-terrace actual projection and editor geometry', () => {
  it('cuts both source tops including apron, preserves untouched original edges and replaces only exact changed intervals', () => {
    const { before, after } = setup(), original = canonicalJson(after.document), old = projectScene(before.document, 'gm'), projected = projectScene(after.document, 'gm')
    const inlay = projected.inlays![0]
    expect(inlay.patches.filter(p => p.kind === 'walk')).toHaveLength(4)
    expect(inlay.patches.filter(p => p.kind === 'apron')).toHaveLength(2)
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
})
