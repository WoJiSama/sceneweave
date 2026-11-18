import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { fromBundle } from '../../application/workspace/project.js'
import { Workspace } from '../../application/workspace/workspace.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { certifyCompositionContent } from '../validation/content.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { PointMm } from '../model/scene.js'
import { validateGeometry } from '../geometry/geometry.js'
import { supportSampleAt } from '../geometry/support-sample.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { connectionRouteSchema, sampleConnectionRoute, type ConnectionRoute } from '../geometry/connection-route.js'
import { planTerrainInlay, createTerrainInlaySampler } from './geometry.js'
import { createTerrainSlopeCommand } from './slope.js'
import { cloneJson } from '../validation/json.js'
import { exportProject, importProject } from '../project/file.js'
import { terrainInlayHash, validateTerrainInlayProofs } from './scene.js'

function prepared(route?: PointMm[] | ConnectionRoute, bundle = fixture()) {
  const scene = bundle.project.document
  scene.props = {}; scene.entityLayers = Object.fromEntries(Object.entries(scene.entityLayers).filter(([id]) => id !== 'item' && id !== 'other'))
  const initial = certifyCompositionContent(createCompositionContent(scene, runtime)), floorId = 'blank-floor'
  const create = (id: string, x: number, z: number): CompositionCommand => ({ type: 'createTerrainArea', id, floorId,
    boundaryMm: [{ x, y: id === 'high' ? 2000 : 1000 }, { x: id === 'high' ? 10500 : 11000, y: id === 'high' ? 2000 : 1000 },
      { x: id === 'high' ? 10500 : 11000, y: id === 'high' ? 10000 : 11000 }, { x, y: id === 'high' ? 10000 : 11000 }],
    groundElevationMm: z, coveragePriority: id === 'high' ? 2 : 1, visibility: 'public', surfaceStyle: null })
  const points = Array.isArray(route) ? route : route?.centerlineMm ?? [{ x: 2000, y: 6000 }, { x: 9000, y: 6000 }]
  const segments = points.slice(1).map((end, i) => ({ id: `route-segment-${i}`, start: points[i], control1: points[i], control2: end, end }))
  const shape = { version: 1 as const, kind: 'polyline' as const, segments, sampleSpacingMm: 20000, toleranceMm: 1, stairStyle: 'naturalRock' as const, treadDepthMm: 300 }
  const connectionRoute = connectionRouteSchema.parse(route && !Array.isArray(route) ? route : { ...shape, centerlineMm: sampleConnectionRoute(shape) })
  return applyCompositionDraftCommands(initial, [create('low', 1000, 1000), create('high', 5500, 3000),
    { type: 'createTerrainConnection', id: 'road', floorId, kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: points[0].x < 5500 ? 'low' : 'high' }, positionMm: points[0] },
      to: { surfaceRef: { kind: 'terrainArea', id: points.at(-1)!.x < 5500 ? 'low' : 'high' }, positionMm: points.at(-1)! }, widthMm: 1000, openingId: null,
      visibility: 'public', surfaceStyle: null, ...(route ? { route: connectionRoute } : {}) }], runtime)
}

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) { const name = repository.database.name; repository.close(); await Dexie.delete(name) }
})

describe('complete terrain slope proposals', () => {
  it('constructs real source-joining banks around a full-width continuous rise, preserving the input', () => {
    const content = prepared(), before = JSON.stringify(content)
    const command = createTerrainSlopeCommand(content.document, 'road', { bankWidthMm: 1000 }), plan = planTerrainInlay(command.geometry)
    expect(JSON.stringify(content)).toBe(before)
    expect(plan.footprintAreaMm2).toBeGreaterThan(plan.walkAreaMm2 * 2.6)
    expect(plan.footprintAreaMm2).toBeLessThan(plan.walkAreaMm2 * 2.9)
    for (const label of ['slope-from-outer', 'slope-to-outer']) {
      const a = command.geometry.verticesMm[`${label}-outer-left`], b = command.geometry.verticesMm[`${label}-outer-right`]
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBe(1008)
      expect(a.z).toBe(b.z)
    }
    expect(plan.fillVolumeMm3).toBeGreaterThan(0); expect(plan.cutVolumeMm3).toBeGreaterThan(0)
    const sample = createTerrainInlaySampler(command.geometry)
    expect(sample.sample({ x: 4000, y: 7502 })).toMatchObject({ zMm: 1000, kind: 'apron' })
    expect(sample.sample({ x: 7000, y: 7502 })).toMatchObject({ zMm: 3000, kind: 'apron' })
    expect(sample.sample({ x: 4000, y: 6502 })).toMatchObject({ kind: 'walk' })
    expect(sample.sample({ x: 4000, y: 6502 })!.zMm).toBeGreaterThan(sample.sample({ x: 4000, y: 7502 })!.zMm)
    expect(sample.sample({ x: 7000, y: 6502 })!.zMm).toBeLessThan(sample.sample({ x: 7000, y: 7502 })!.zMm)
    // An outer edge crossing the original scarp has a real, finite return wall.
    expect(plan.exposedWalls.length).toBeGreaterThan(0)
    expect(plan.exposedWalls.reduce((sum, wall) => sum + Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y), 0)).toBeLessThanOrEqual(14)
    const after = applyCompositionDraftCommands(content, [command], runtime)
    expect(validateGeometry(after.document).errors).toEqual([])
    expect(supportSampleAt(after.document, 'blank-floor', { x: 4000, y: 7000 })).toMatchObject({ walkable: false, sourceConnectionId: 'road' })
    expect(checkTerrainRoute(after.document, { floorId: 'blank-floor', pointsMm: [{ x: 2000, y: 6000 }, { x: 9000, y: 6000 }], widthMm: 1000 }).ok).toBe(true)
  })

  it('retains the whole bent route and asymmetric real banks through ordinary adoption', () => {
    const points = [{ x: 2000, y: 5000 }, { x: 4000, y: 5000 }, { x: 6000, y: 6000 }, { x: 9000, y: 6000 }]
    const content = prepared(points), command = createTerrainSlopeCommand(content.document, 'road', { bankWidthMm: { left: 700, right: 1100 } })
    expect(command.centerlineVertexIds.map(id => { const { x, y } = command.geometry.verticesMm[id]; return { x, y } })).toEqual(points)
    const after = applyCompositionDraftCommands(content, [command], runtime)
    expect(validateGeometry(after.document).errors).toEqual([])
    expect(Object.values(command.geometry.verticesMm).every(point => Object.values(point).every(Number.isSafeInteger))).toBe(true)
  })

  it('rounds tapered diagonal entrances once, keeping tiny banks distinct from the complete walk', () => {
    const points = [{ x: 2000, y: 2500 }, { x: 9000, y: 9500 }]
    const content = applyCompositionDraftCommands(prepared(points), [{ type: 'updateTerrainConnection', id: 'road', changes: { widthMm: 170 } }], runtime)
    const command = createTerrainSlopeCommand(content.document, 'road', { bankWidthMm: 7 })
    const v = command.geometry.verticesMm
    expect(v['slope-from-outer-outer-left']).not.toEqual(v['slope-from-outer-walk-left'])
    expect(v['slope-from-outer-outer-left'].x).not.toBe(v['slope-from-outer-walk-left'].x)
    expect(v['slope-from-outer-outer-left'].y).not.toBe(v['slope-from-outer-walk-left'].y)
    const after = applyCompositionDraftCommands(content, [command], runtime)
    expect(validateGeometry(after.document).errors).toEqual([])
    expect(checkTerrainRoute(after.document, { floorId: 'blank-floor', pointsMm: points, widthMm: 170 }).ok).toBe(true)
  })

  it('checks source ownership at the actual tapered entrance instead of the discarded full-bank construction point', () => {
    const points = [{ x: 2000, y: 1700 }, { x: 9000, y: 6700 }], content = prepared(points)
    const command = createTerrainSlopeCommand(content.document, 'road', { bankWidthMm: 1000 })
    expect(command.geometry.verticesMm['slope-from-outer-outer-right'].y).toBeGreaterThan(1000)
    expect(validateGeometry(applyCompositionDraftCommands(content, [command], runtime).document).errors).toEqual([])
  })

  it('preserves all 33 original cubic samples and level endpoint approaches', () => {
    const shape = { version: 1 as const, kind: 'cubic' as const, sampleSpacingMm: 300, toleranceMm: 100,
      segments: [{ id: 'curve', start: { x: 2000, y: 6000 }, control1: { x: 4000, y: 5000 }, control2: { x: 7000, y: 7000 }, end: { x: 9000, y: 6000 } }],
      stairStyle: 'naturalRock' as const, treadDepthMm: 300 }
    const route = connectionRouteSchema.parse({ ...shape, centerlineMm: sampleConnectionRoute(shape) })
    expect(route.centerlineMm).toHaveLength(33)
    const content = prepared(route), command = createTerrainSlopeCommand(content.document, 'road', { bankWidthMm: 1000 })
    expect(command.centerlineVertexIds.map(id => { const { x, y } = command.geometry.verticesMm[id]; return { x, y } })).toEqual(route.centerlineMm)
    expect(Object.keys(command.geometry.verticesMm).length).toBeLessThanOrEqual(512)
    expect(Object.keys(command.geometry.faces).length).toBeLessThanOrEqual(512)
    const after = applyCompositionDraftCommands(content, [command], runtime)
    expect(validateGeometry(after.document).errors).toEqual([])
    expect(checkTerrainRoute(after.document, { floorId: 'blank-floor', pointsMm: route.centerlineMm, widthMm: 1000 }).ok).toBe(true)
  }, 15000)

  it('uses the same complete body for a descending route', () => {
    const points = [{ x: 9000, y: 6000 }, { x: 2000, y: 6000 }], content = prepared(points)
    const command = createTerrainSlopeCommand(content.document, 'road', { bankWidthMm: 1000 })
    expect(command.centerlineVertexIds.map(id => command.geometry.verticesMm[id].z)).toEqual([3000, 1000])
    const after = applyCompositionDraftCommands(content, [command], runtime)
    expect(validateGeometry(after.document).errors).toEqual([])
    expect(checkTerrainRoute(after.document, { floorId: 'blank-floor', pointsMm: points, widthMm: 1000 }).ok).toBe(true)
  })

  it('persists a wide slope through preview, adoption, undo/redo and cold export/import, rejecting changed baselines and source locks', async () => {
    const bundle = fixture(), content = prepared(undefined, bundle)
    Object.assign(bundle.project, content)
    const repository = new ProjectRepository({ name: `slope-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await fromBundle(bundle, validation))
    const command = () => ({ ...createTerrainSlopeCommand(workspace.getDocument()!, 'road', { bankWidthMm: 1000 }),
      appearance: 'source-ground' as const, finish: { kind: 'slope' as const } })
    const stale = await workspace.preview([command()])
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toBeUndefined()
    await workspace.execute([{ type: 'setEditLock', kind: 'terrainArea', id: 'low', locked: true }])
    const locked = cloneJson(workspace.getDocument())
    await expect(workspace.adoptPreview(stale)).rejects.toThrow(/场景已有修改/)
    expect(workspace.getDocument()).toEqual(locked)
    workspace.cancelPreview(stale)
    await expect(workspace.preview([command()])).rejects.toThrow(/锁/)
    expect(workspace.getDocument()).toEqual(locked)
    await workspace.execute([{ type: 'setEditLock', kind: 'terrainArea', id: 'low', locked: false }])
    const sources = cloneJson(workspace.getDocument()!.terrainAreas), input = command()
    const preview = await workspace.preview([input])
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toBeUndefined()
    const previewInlay = preview.document.terrainConnections.road.terrainInlay!
    expect(planTerrainInlay(previewInlay.geometry).footprintAreaMm2).toBeGreaterThan(planTerrainInlay(previewInlay.geometry).walkAreaMm2 * 2.6)
    await workspace.adoptPreview(preview)
    const actual = cloneJson(workspace.getDocument()!.terrainConnections.road.terrainInlay!)
    expect(actual).toMatchObject({ appearance: 'source-ground', finish: { kind: 'slope' } })
    expect(workspace.getDocument()!.terrainAreas).toEqual(sources)
    workspace.undo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toBeUndefined()
    workspace.redo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toEqual(actual)
    const finish = await workspace.preview([{ type: 'setTerrainInlayFinish', id: 'road', finish: { kind: 'steps', treadDepthMm: 350 },
      expectedConnectionHash: terrainInlayHash(workspace.getDocument()!.terrainConnections.road) }])
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.finish).toEqual({ kind: 'slope' })
    await workspace.adoptPreview(finish)
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.geometry).toEqual(actual.geometry)
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.finish).toEqual({ kind: 'steps', treadDepthMm: 350 })
    workspace.undo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toEqual(actual)
    workspace.redo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.finish?.kind).toBe('steps')
    await workspace.flush()
    const cold = (await repository.load(workspace.getDocument()!.sceneId))!
    expect(cold.project.document).toEqual(workspace.getDocument())
    expect(cold.project.document.terrainConnections.road.terrainInlay!.geometry).toEqual(actual.geometry)
    expect(validateTerrainInlayProofs(cold.project.document, cold.project.historyIdentity)).toEqual([])
    expect(validateGeometry(cold.project.document).errors).toEqual([])
    expect(supportSampleAt(cold.project.document, 'blank-floor', { x: 4000, y: 7000 })).toMatchObject({ walkable: false, sourceConnectionId: 'road' })
    expect(checkTerrainRoute(cold.project.document, { floorId: 'blank-floor', pointsMm: [{ x: 2000, y: 6000 }, { x: 9000, y: 6000 }], widthMm: 1000 }).ok).toBe(true)
    const imported = await importProject(await exportProject(cold, validation), validation)
    expect(imported.project.document).toEqual(cold.project.document)
    expect(imported.project.historyIdentity).toEqual(cold.project.historyIdentity)
    expect(validateTerrainInlayProofs(imported.project.document, imported.project.historyIdentity)).toEqual([])
  }, 30000)

  it('rejects a bank outside the source domain and invalid or over-budget full input without shrinking it', () => {
    const content = prepared(), before = JSON.stringify(content)
    expect(() => createTerrainSlopeCommand(content.document, 'road', { bankWidthMm: 7000 })).toThrow(/源地形|Floor/)
    expect(() => createTerrainSlopeCommand(content.document, 'road', { bankWidthMm: 0 })).toThrow()
    let x = 2000
    const shape = { version: 1 as const, kind: 'cubic' as const, sampleSpacingMm: 110, toleranceMm: 100,
      segments: [1600, 800, 400, 200, 100, 3200].map((span, i) => {
        const start = { x, y: 6000 }, control1 = { x: Math.round(x + span / 3), y: 6000 }, control2 = { x: Math.round(x + 2 * span / 3), y: 6000 }
        x += span
        return { id: `dense-${i}`, start, control1, control2, end: { x, y: 6000 } }
      }), stairStyle: 'naturalRock' as const, treadDepthMm: 300 }
    const route = connectionRouteSchema.parse({ ...shape, centerlineMm: sampleConnectionRoute(shape) })
    expect(route.centerlineMm).toHaveLength(64)
    const dense = prepared(route), denseBefore = JSON.stringify(dense)
    expect(() => createTerrainSlopeCommand(dense.document, 'road', { bankWidthMm: 500 })).toThrow(/预算/)
    expect(JSON.stringify(dense)).toBe(denseBefore)
    expect(JSON.stringify(content)).toBe(before)
  })
})
