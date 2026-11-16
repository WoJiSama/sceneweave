import { describe, expect, it } from 'vitest'
import clipping from 'polygon-clipping'
import native from '../content/scenes-data.json'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import { addSurfaceAppearanceSource, createCompositionContent, resolveAppearance } from '../../../shared/appearance/graph.js'
import { applyCompositionCommands } from '../../../shared/appearance/commands.js'
import { validateProjectData } from '../../../shared/project/validate.js'
import { cloneJson, canonicalJson } from '../../../shared/validation/json.js'
import { validateScene } from '../../../shared/validation/scene.js'
import { WALL_RELIEF_MATERIAL_ID } from '../../../shared/appearance/wall-edge-profile.js'
import { inspectSceneWallReliefBudget } from '../../../shared/appearance/wall-relief-budget.js'
import { planWallRelief } from '../../../shared/appearance/wall-relief.js'
import { wallGeometry } from './canvas-renderer.js'
import type { ProjectedWall } from '../../../shared/projection/types.js'
import type { ProjectData } from '../../../shared/model/project.js'
import type { CompositionCommand } from '../../../shared/model/appearance.js'
import type { PreparationContext } from '../../../shared/ports/runtime.js'

const runtime: PreparationContext = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => '2026-11-15T10:00:00.000Z' } }
const style = { base: { materialRef: { id: WALL_RELIEF_MATERIAL_ID, version: 1 }, tileSizeMm: { width: 1440, height: 1440 }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, opacity: 1, tint: null }, overlays: [] }
const w = (id: string, a: number[], b: number[], enabled = true): ProjectedWall => ({ id, sourceIds: [], start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thicknessMm: 340, style: cloneJson(style), openings: [], ...(enabled ? { edgeProfile: 'stone-blocks-v1' as const } : {}) })
const ring = (ps: { x: number; y: number }[]): [number, number][] => [...ps.map(p => [p.x, p.y] as [number, number]), [ps[0].x, ps[0].y]]
const united = (geometry: ReturnType<typeof wallGeometry>) => { const ps = geometry.flatMap(g => g.polygons.map(p => [ring(p)])); return clipping.union(ps[0], ...ps.slice(1)) }
const area = (polys: clipping.MultiPolygon) => Math.abs(polys.reduce((total, p) => total + p.reduce((sum, r) => sum + r.slice(0, -1).reduce((a, v, i) => a + v[0] * r[i + 1][1] - r[i + 1][0] * v[1], 0) / 2, 0), 0))
const apply = (p: ProjectData, commands: CompositionCommand[]) => validateProjectData({ ...p, ...applyCompositionCommands({ document: p.document, historyIdentity: p.historyIdentity, appearance: p.appearance }, commands, runtime) })
function fixture() {
  const seed = cloneJson(native.scenes.blank), document = toCurrentSceneDocument(seed.document as Parameters<typeof toCurrentSceneDocument>[0])
  let p = validateProjectData({ ...seed, schemaVersion: 1, ...createCompositionContent(document, runtime) })
  // Commands/schema fixture only; real fixed-source PNGs are exercised separately in Chrome.
  const material = { ...cloneJson(document.materials['b2-m-04']), id: WALL_RELIEF_MATERIAL_ID, catalogId: 'test.relief-source' }
  p.document.materials[material.id] = material
  p.licenseBindings.push({ ...p.licenseBindings.find(b => b.subjectKind === 'material' && b.subjectId === 'b2-m-04')!, subjectId: material.id })
  p = validateProjectData(p)
  p = apply(p, [{ type: 'createRoom', id: 'house', floorId: 'blank-floor', layerId: 'layer-default-0', boundaryMm: [{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 8000 }, { x: 2000, y: 8000 }], thicknessMm: 340 }])
  return apply(p, [{ type: 'setSurfaceMaterial', kind: 'wall', id: 'house:wall:0', materialRef: { id: material.id, version: 1 } }])
}

describe('fixed wall stone relief', () => {
  it('is opt-in and does not mutate physical inputs', () => {
    const input = wallGeometry([w('plain', [0, 0], [6000, 0], false)]), before = canonicalJson(input)
    expect(planWallRelief(input)).toMatchObject({ geometry: input, additions: 0 })
    expect(canonicalJson(input)).toBe(before)
    const enabled = wallGeometry([w('stone', [0, 0], [6000, 0])]), snapshot = canonicalJson(enabled)
    expect(planWallRelief(enabled).additions).toBeGreaterThan(0)
    expect(canonicalJson(enabled)).toBe(snapshot)
  })

  it('derives one stable visible union across straight splits, reversal, corners and T joins', () => {
    const a = [w('a', [0, 0], [6000, 0]), w('b', [6000, 0], [6000, 3000]), w('t', [3000, 0], [3000, -2500])]
    const b = [w('a2', [3000, 0], [6000, 0]), w('a1', [0, 0], [3000, 0]), w('b', [6000, 3000], [6000, 0]), w('t', [3000, -2500], [3000, 0])]
    const x = united(planWallRelief(wallGeometry(a)).geometry), y = united(planWallRelief(wallGeometry(b)).geometry)
    expect(area(clipping.difference(x, y)) + area(clipping.difference(y, x))).toBeLessThan(.001)
  })

  it.each(['open', 'closed'] as const)('keeps the entire %s doorway net interval clear including jamb returns', state => {
    const wall = w('door-wall', [0, 0], [6000, 0])
    wall.openings = [{ id: 'door', start: { x: 2100, y: 0 }, end: { x: 3600, y: 0 }, widthMm: 1500, kind: 'door', state, secret: false }]
    const plan = planWallRelief(wallGeometry([wall]))
    const aperture: clipping.Polygon = [[[2100, -260], [3600, -260], [3600, 260], [2100, 260], [2100, -260]]]
    expect(area(clipping.intersection(united(plan.geometry), aperture))).toBeLessThan(.001)
  })

  it('limits every new contour point to 45mm from the original wall body', () => {
    const input = wallGeometry([w('a', [0, 0], [4000, 0]), w('b', [4000, 0], [4000, 4000])]), plan = planWallRelief(input)
    const edges = input.flatMap(g => g.polygons.flatMap(ps => ps.map((a, i) => [a, ps[(i + 1) % ps.length]])))
    for (const [i, g] of plan.geometry.entries()) for (const ps of g.polygons.slice(input[i].polygons.length)) for (const p of ps) {
      const distance = Math.min(...edges.map(([a, b]) => { const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) }))
      expect(distance).toBeLessThanOrEqual(45.001)
    }
  })

  it('respects a straight neighbor even when the common boundary is collinear', () => {
    const plain = w('plain', [3000, 0], [6000, 0], false), plan = planWallRelief(wallGeometry([w('stone', [0, 0], [3000, 0]), plain]))
    const outsidePlain: clipping.Polygon = [[[3200, 170.01], [5900, 170.01], [5900, 230], [3200, 230], [3200, 170.01]]]
    expect(area(clipping.intersection(united(plan.geometry), outsidePlain))).toBeLessThan(.001)
  })

  it('refuses pathological source sampling before an unbounded loop', () => {
    const wall = w('dense', [0, 0], [6000, 0]); wall.style!.base.tileSizeMm = { width: 1, height: 1 }
    expect(() => planWallRelief(wallGeometry([wall]))).toThrow(/派生预算/)
  })

  it.each(['door', 'window'] as const)('clamps near-end %s returns to the actual solid pier in either wall direction', kind => {
    for (const reversed of [false, true]) for (const reverseOpening of [false, true]) {
      const wall = w('near-end', reversed ? [6000, 0] : [0, 0], reversed ? [0, 0] : [6000, 0])
      wall.openings = [{ id: 'near-end-opening', start: { x: reverseOpening ? 1520 : 20, y: 0 }, end: { x: reverseOpening ? 20 : 1520, y: 0 }, widthMm: 1500, kind, state: 'open', secret: false }]
      const input = wallGeometry([wall]), plan = planWallRelief(input)
      for (const polygon of plan.geometry[0].polygons.slice(input[0].polygons.length)) for (const point of polygon) {
        expect(point.x).toBeGreaterThanOrEqual(-45.001)
        expect(point.x).toBeLessThanOrEqual(6045.001)
      }
      const aperture: clipping.Polygon = [[[20, -260], [1520, -260], [1520, 260], [20, 260], [20, -260]]]
      expect(area(clipping.intersection(united(plan.geometry), aperture))).toBeLessThan(.001)
    }
  })

  it('rejects unrenderable paint before adoption and on independent persisted-document validation', () => {
    const p = apply(fixture(), [{ type: 'setWallEdgeProfile', id: 'house:wall:0', profile: 'stone-blocks-v1' }]), before = canonicalJson(p)
    expect(() => apply(p, [{ type: 'setSurfacePaint', kind: 'wall', id: 'house:wall:0', changes: { tileSizeMm: { width: 1, height: 1 } } }])).toThrow(/派生预算/)
    const cold = JSON.parse(JSON.stringify(p)) as ProjectData
    cold.document.walls['house:wall:0'].topStyle!.base.tileSizeMm = { width: 1, height: 1 }
    expect(validateScene(cold.document)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'WALL_RELIEF_BUDGET' })]) })
    expect(() => validateProjectData(cold)).toThrow(/派生预算/)
    expect(canonicalJson(p)).toBe(before)
  })

  it('rejects cumulative network work even when each individual wall fits the fixed source', () => {
    const document = cloneJson(fixture().document), floor = document.floors['blank-floor']
    floor.boundsMm = { x: 0, y: 0, width: 100000, height: 100000 }
    document.exportBoundsMm = cloneJson(floor.boundsMm)
    for (let index = 0; index < 65; index++) {
      const id = `additional-wall-${index}`, y = 10000 + index * 1000
      document.vertices[`${id}-a`] = { id: `${id}-a`, floorId: floor.id, editLocked: false, xMm: 10000, yMm: y }
      document.vertices[`${id}-b`] = { id: `${id}-b`, floorId: floor.id, editLocked: false, xMm: 16000, yMm: y }
      document.walls[id] = { id, floorId: floor.id, editLocked: false, startVertexId: `${id}-a`, endVertexId: `${id}-b`, thicknessMm: 340, topStyle: cloneJson(style), blocksMovement: true, blocksSight: true, edgeProfile: 'stone-blocks-v1' }
      for (const entityId of [id, `${id}-a`, `${id}-b`]) document.entityLayers[entityId] = 'layer-default-0'
      expect(() => planWallRelief(wallGeometry([w(id, [10000, y], [16000, y])]))).not.toThrow()
    }
    expect(inspectSceneWallReliefBudget(document)).toEqual([expect.objectContaining({ code: 'WALL_RELIEF_BUDGET' })])
    expect(validateScene(JSON.parse(JSON.stringify(document)))).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'WALL_RELIEF_BUDGET' })]) })
  })

  it('reserves the full wall before private openings are filtered and filled', () => {
    const wall = w('large-private-opening', [0, 0], [600000, 0])
    wall.openings = [{ id: 'private', start: { x: 100, y: 0 }, end: { x: 599900, y: 0 }, widthMm: 599800, kind: 'door', state: 'closed', secret: true }]
    const fragmented = wallGeometry([wall]), filled = wallGeometry([{ ...wall, openings: [] }])
    const perimeter = (input: typeof fragmented) => input.reduce((sum, item) => sum + item.polygons.reduce((total, ps) => total + ps.reduce((length, p, i) => length + Math.hypot(p.x - ps[(i + 1) % ps.length].x, p.y - ps[(i + 1) % ps.length].y), 0), 0), 0)
    expect(perimeter(filled)).toBeGreaterThan(perimeter(fragmented) * 100)
    expect(() => planWallRelief(fragmented)).toThrow(/派生预算/)
    expect(() => planWallRelief(filled)).toThrow(/派生预算/)
    const small = w('admitted-private-opening', [0, 0], [12000, 0])
    small.openings = [{ ...wall.openings[0], start: { x: 100, y: 0 }, end: { x: 11900, y: 0 }, widthMm: 11800 }]
    expect(() => planWallRelief(wallGeometry([small]))).not.toThrow()
    expect(() => planWallRelief(wallGeometry([{ ...small, openings: [] }]))).not.toThrow()
  })

  it('checks the resolved fixed appearance source before it can become the saved wall paint', () => {
    const p = apply(fixture(), [{ type: 'setWallEdgeProfile', id: 'house:wall:0', profile: 'stone-blocks-v1' }])
    const withSource = cloneJson(p), dense = cloneJson(style)
    dense.base.tileSizeMm = { width: 1, height: 1 }
    const sourceId = addSurfaceAppearanceSource(withSource.appearance, dense)
    const baseline = validateProjectData(withSource)
    const draft = applyCompositionCommands({ document: baseline.document, historyIdentity: baseline.historyIdentity, appearance: baseline.appearance }, [{ type: 'setAppearanceSource', ids: ['house:wall:0'], sourceId }], runtime)
    const resolved = resolveAppearance(draft)
    expect(resolved.document.walls['house:wall:0'].topStyle!.base.tileSizeMm).toEqual({ width: 1, height: 1 })
    expect(() => validateProjectData({ ...baseline, ...resolved })).toThrow(/派生预算/)
    expect(baseline.document.walls['house:wall:0'].topStyle!.base.tileSizeMm).not.toEqual({ width: 1, height: 1 })
  })

  it('uses the same strict transaction, removes the field on reset and retains resources/identity', () => {
    const p = fixture(), before = canonicalJson(p), after = apply(p, [{ type: 'setWallEdgeProfile', id: 'house:wall:0', profile: 'stone-blocks-v1' }])
    expect(after.document.walls['house:wall:0'].edgeProfile).toBe('stone-blocks-v1')
    expect(apply(after, [{ type: 'setWallEdgeProfile', id: 'house:wall:0', profile: 'straight' }])).toEqual(p)
    for (const key of ['historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings', 'authoringSources'] as const) expect(after[key]).toEqual(p[key])
    expect(canonicalJson(p)).toBe(before)
    const bad = cloneJson(after.document); (bad.walls['house:wall:0'] as { edgeProfile?: string }).edgeProfile = 'noise'
    expect(validateScene(bad).ok).toBe(false)
    expect(() => apply(after, [{ type: 'setSurfaceMaterial', kind: 'wall', id: 'house:wall:0', materialRef: { id: 'b2-m-04', version: 1 } }])).toThrow(/块石外缘/)
    expect(() => apply(p, Array.from({ length: 257 }, () => ({ type: 'setWallEdgeProfile' as const, id: 'house:wall:0', profile: 'stone-blocks-v1' as const })))).toThrow(/256/)
  })

  it.each(['wall', 'layer', 'neighbor', 'door'] as const)('checks %s locks and rolls back the entire candidate', kind => {
    let p = fixture()
    p = apply(p, [{ type: 'addOpening', id: 'door', wallId: 'house:wall:0', offsetReferenceVertexId: p.document.walls['house:wall:0'].startVertexId, offsetMm: 1000, widthMm: 1500, kind: 'door' }])
    const lock: CompositionCommand = kind === 'layer' ? { type: 'setLayerLock', id: 'layer-default-0', locked: true } : { type: 'setEditLock', kind: kind === 'door' ? 'opening' : 'wall', id: kind === 'door' ? 'door' : kind === 'neighbor' ? 'house:wall:1' : 'house:wall:0', locked: true }
    const locked = apply(p, [lock]), before = canonicalJson(locked)
    expect(() => apply(locked, [{ type: 'setWallEdgeProfile', id: 'house:wall:0', profile: 'stone-blocks-v1' }])).toThrow(/锁定/)
    expect(canonicalJson(locked)).toBe(before)
  })
})
