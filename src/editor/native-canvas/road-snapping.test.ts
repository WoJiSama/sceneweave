import { describe, expect, it, vi } from 'vitest'
import type { PointMm, SceneDocument, SurfaceRef } from '../../shared/model/scene.js'
import { applyCommands } from '../../shared/commands/commands.js'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { canonicalJson, cloneJson } from '../../shared/validation/json.js'
import * as ports from '../../shared/generation/building-port.js'
import { prepareRoadSnapTargets, resolveRoadSnap, type RoadSnapTarget } from './road-snapping.js'

const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const pointTarget = (id: string, point: PointMm, kind: 'door' | 'endpoint' = 'endpoint'): RoadSnapTarget => ({ id, entityId: id, kind, label: id, directionDeg: 0, point })
const segment: RoadSnapTarget = { id: 'segment', entityId: 'road', kind: 'centerline', label: '道路中心线', directionDeg: 0, start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } }

function fixture() {
  const source = createShoreBlankDocument('island', { sceneId: 'road-snapping', title: '道路辅助规则', now: '2026-11-10T00:00:00.000Z', widthMm: 20000, heightMm: 16000, preset: 'narrative' })
  let sequence = 0
  const runtime = { clock: { now: () => source.updatedAt }, ids: { nextId: () => `road-snap-${++sequence}` } }
  let document = applyCommands(source, [
    { type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(0, 0, 20000, 16000), groundElevationMm: 1200, coveragePriority: 0 },
    { type: 'createRoom', id: 'building', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(4000, 4000, 6000, 6000), thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ground' } },
    { type: 'createPath', id: 'road', floorId: 'visual-floor', layerId: 'visual-layer-ground', centerlineMm: [{ x: 2000, y: 2000 }, { x: 10000, y: 2000 }], widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: 'ground' }] },
  ], runtime)
  const wall = Object.values(document.walls).find(row => document.vertices[row.startVertexId].yMm === 4000 && document.vertices[row.endVertexId].yMm === 4000)!
  document = applyCommands(document, [{ type: 'addOpening', id: 'entrance', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 2400, widthMm: 1200, kind: 'door', state: 'open' }], runtime)
  return { document, runtime, wall }
}
const options = () => ({ floorId: 'visual-floor', widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: 'ground' }] as SurfaceRef[] })
const ids = (document: SceneDocument, extra: Partial<Parameters<typeof prepareRoadSnapTargets>[1]> = {}) => prepareRoadSnapTargets(document, { ...options(), ...extra }).targets.map(target => target.id)

describe('screen-space road snap resolution', () => {
  it('keeps a pixel tolerance across zoom and falls back to the caller grid', () => {
    const targets = [pointTarget('end', { x: 1000, y: 1000 })]
    expect(resolveRoadSnap({ x: 1100, y: 1000 }, targets, 10).target?.id).toBe('end')
    expect(resolveRoadSnap({ x: 1100, y: 1000 }, targets, 5, null, false, 250)).toEqual({ point: { x: 1000, y: 1000 }, target: null })
    expect(resolveRoadSnap({ x: 1050, y: 1000 }, targets, 5).target?.id).toBe('end')
  })
  it('prioritizes doors, then endpoints, then centerlines and resolves ties by stable ID', () => {
    const endpoint = pointTarget('b', { x: 500, y: 8 }), door = pointTarget('door', { x: 500, y: 11 }, 'door')
    expect(resolveRoadSnap({ x: 500, y: 0 }, [segment, endpoint, door], 1).target?.id).toBe('door')
    expect(resolveRoadSnap({ x: 500, y: 0 }, [segment, endpoint], 1).target?.id).toBe('b')
    const equal = pointTarget('a', { x: 500, y: -8 })
    for (const targets of [[endpoint, equal], [equal, endpoint]]) expect(resolveRoadSnap({ x: 500, y: 0 }, targets, 1).target?.id).toBe('a')
  })
  it('retains a nearby target until release without hiding a higher-priority door', () => {
    const targets = [pointTarget('a', { x: 0, y: 0 }), pointTarget('b', { x: 20, y: 0 })]
    expect(resolveRoadSnap({ x: 15, y: 0 }, targets, 1, 'a').target?.id).toBe('a')
    expect(resolveRoadSnap({ x: 19, y: 0 }, targets, 1, 'a').target?.id).toBe('b')
    expect(resolveRoadSnap({ x: 15, y: 0 }, [...targets, pointTarget('door', { x: 16, y: 0 }, 'door')], 1, 'a').target?.id).toBe('door')
    expect(resolveRoadSnap({ x: 15, y: 0 }, [targets[1]], 1, 'a').target?.id).toBe('b')
  })
  it('projects onto finite centerline segments and returns integer millimetres', () => {
    expect(resolveRoadSnap({ x: 500.4, y: 8 }, [segment], 1)).toMatchObject({ point: { x: 500, y: 0 }, target: { id: 'segment', kind: 'centerline' } })
    expect(resolveRoadSnap({ x: -5, y: 0 }, [segment], 1).point).toEqual({ x: 0, y: 0 })
    expect(resolveRoadSnap({ x: -20, y: 0 }, [segment], 1).target).toBeNull()
    const diagonal = { ...segment, start: { x: 0, y: 0 }, end: { x: 1000, y: 1000 } }
    expect(resolveRoadSnap({ x: 500, y: 501 }, [diagonal], 1).point).toEqual({ x: 501, y: 501 })
  })
  it('bypasses semantic, hysteresis and grid assistance with Shift but preserves safe integer coordinates', () => {
    expect(resolveRoadSnap({ x: 500.6, y: -0.6 }, [segment], 1, 'segment', true, 250)).toEqual({ point: { x: 501, y: -1 }, target: null })
    expect(() => resolveRoadSnap({ x: Infinity, y: 0 }, [], 1, null, true)).toThrow(/有限/)
    expect(() => resolveRoadSnap({ x: Number.MAX_SAFE_INTEGER + 1, y: 0 }, [], 1, null, true)).toThrow(/安全整数/)
    for (const scale of [0, -1, Infinity, NaN]) expect(() => resolveRoadSnap({ x: 0, y: 0 }, [], scale)).toThrow(/缩放/)
  })
})

describe('prepared road snap sources', () => {
  it('captures real door geometry, endpoints and centerlines without mutating supports or source', () => {
    const { document } = fixture(), input = options(), before = canonicalJson(document), supports = canonicalJson(input.supportRefs)
    const prepared = prepareRoadSnapTargets(document, input)
    expect(prepared.targets.map(target => target.id)).toEqual(['door:entrance', 'path:road:end', 'path:road:segment:0', 'path:road:start'])
    expect(prepared.targets[0]).toMatchObject({ kind: 'door', point: { x: 7000, y: 3299 }, directionDeg: 270 })
    expect(canonicalJson(document)).toBe(before)
    expect(canonicalJson(input.supportRefs)).toBe(supports)
    const mutable = cloneJson(document), captured = prepareRoadSnapTargets(mutable, input)
    mutable.paths.road.centerlineMm[0].x = 9999
    expect(captured.targets.find(target => target.id === 'path:road:start')).toMatchObject({ point: { x: 2000, y: 2000 } })
    expect(Object.isFrozen(captured.targets)).toBe(true)
  })
  it.each([0, -1, 0.5, Infinity, NaN])('refuses illegal drawing width %s', widthMm => {
    const { document } = fixture()
    expect(() => prepareRoadSnapTargets(document, { ...options(), widthMm })).toThrow(/正整数毫米/)
  })
  it('refuses insufficient existing road/door width and incompatible or missing supports', () => {
    const { document } = fixture()
    expect(ids(document, { widthMm: 1300 })).toEqual([])
    expect(ids(document, { supportRefs: [{ kind: 'floor', id: 'visual-floor' }] })).toEqual([])
    expect(ids(document, { supportRefs: [{ kind: 'terrainArea', id: 'missing' }] })).toEqual([])
    expect(ids(document, { supportRefs: [] })).toEqual([])
    const different = cloneJson(document)
    different.terrainAreas.other = { ...cloneJson(document.terrainAreas.ground), id: 'other', groundElevationMm: 2000 }
    expect(ids(different, { supportRefs: [...options().supportRefs, { kind: 'terrainArea', id: 'other' }] })).toEqual([])
    const wrongFloor = cloneJson(document); wrongFloor.paths.road.floorId = 'another-floor'
    expect(ids(wrongFloor)).not.toContain('path:road:start')
  })
  it('filters locked entities, locked layers, blocked supports and explicitly hidden dependencies', () => {
    const { document, wall } = fixture()
    for (const id of ['road', 'entrance', wall.id, 'building', 'ground']) {
      const prepared = prepareRoadSnapTargets(document, { ...options(), excludedEntityIds: new Set([id]) })
      expect(prepared.targets.some(target => target.entityId === (id === 'road' ? 'road' : 'entrance'))).toBe(false)
    }
    const locked = cloneJson(document); locked.paths.road.editLocked = true
    expect(ids(locked)).not.toContain('path:road:start')
    locked.openings.entrance.editLocked = true
    expect(ids(locked)).not.toContain('door:entrance')
    const layer = cloneJson(document); layer.userLayers['visual-layer-ground'].editLocked = true
    expect(ids(layer)).toEqual([])
    const blocked = cloneJson(document); blocked.terrainAreas.ground.blocksMovement = true
    expect(ids(blocked)).toEqual([])
  })
  it('retains the finite public doorway limitations without source-specific refusal notices', () => {
    const { document } = fixture(), expectedNotices = prepareRoadSnapTargets(document, options()).notices
    for (const changes of [{ state: 'closed' as const }, { locked: true }, { secret: true, revealed: false }, { widthMm: 1201 }]) {
      const changed = cloneJson(document); Object.assign(changed.openings.entrance, changes)
      const prepared = prepareRoadSnapTargets(changed, options())
      expect(prepared.targets.some(target => target.kind === 'door')).toBe(false)
      expect(prepared.notices).toEqual(expectedNotices)
    }
  })
  it('does not reveal secret source IDs, counts or notices to a player context', () => {
    const { document } = fixture(), before = prepareRoadSnapTargets(document, { ...options(), audience: 'player' })
    const changed = cloneJson(document)
    changed.paths['private-road'] = { ...cloneJson(changed.paths.road), id: 'private-road', visibility: 'gm' }
    changed.entityLayers['private-road'] = changed.entityLayers.road
    expect(prepareRoadSnapTargets(changed, { ...options(), audience: 'player' })).toEqual(before)
    expect(ids(changed, { audience: 'gm' })).toContain('path:private-road:start')
    const hiddenSupport = cloneJson(document); hiddenSupport.terrainAreas.ground.visibility = 'gm'
    expect(ids(hiddenSupport, { audience: 'player' })).toEqual([])
  })
  it('rejects a target whose square end cap leaves the explicitly selected surface', () => {
    const { document } = fixture(), changed = cloneJson(document)
    changed.paths.road.centerlineMm[0].x = 100
    expect(ids(changed)).not.toContain('path:road:start')
  })
  it('does not invoke doorway adaptation or scene validation while resolving pointer moves', () => {
    const { document } = fixture(), spy = vi.spyOn(ports, 'resolveBuildingEntrancePort')
    try {
      const prepared = prepareRoadSnapTargets(document, options()), count = spy.mock.calls.length
      expect(count).toBeGreaterThan(0)
      for (let x = 6900; x <= 7100; x += 10) resolveRoadSnap({ x, y: 3299 }, prepared.targets, 10)
      expect(spy).toHaveBeenCalledTimes(count)
    } finally { spy.mockRestore() }
  })
})
