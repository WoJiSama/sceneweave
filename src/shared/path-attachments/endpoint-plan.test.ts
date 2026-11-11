import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../commands/commands.js'
import type { SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { resolveBuildingStructurePort } from '../generation/building-port.js'
import { planPathAttachmentEndpoint, type PathAttachmentEndpointRequest, type PathAttachmentEndpointPlan } from './endpoint-plan.js'

const p = (x: number, y: number) => ({ x, y })
const rect = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
function fixture(side: 'top' | 'right' | 'bottom' | 'left' = 'top', end: 'start' | 'end' = 'start') {
  const source = createShoreBlankDocument('island', { sceneId: 'ordinary-endpoint-scene', title: '门前端点候选', now: '2026-11-10T00:00:00.000Z', widthMm: 40000, heightMm: 40000, preset: 'narrative' })
  let sequence = 0
  const runtime = { clock: { now: () => source.updatedAt }, ids: { nextId: () => `endpoint-native-${++sequence}` } }
  let scene = applyCommands(source, [
    { type: 'createTerrainArea', id: 'ordinary-ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rect(0, 0, 40000, 40000), groundElevationMm: 1200, coveragePriority: 0 },
    { type: 'createRoom', id: 'ordinary-room', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rect(12000, 12000, 6000, 6000), thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ordinary-ground' } },
  ], runtime)
  const wall = Object.values(scene.walls).find(row => {
    const a = scene.vertices[row.startVertexId], b = scene.vertices[row.endVertexId]
    return side === 'top' ? a.yMm === 12000 && b.yMm === 12000 : side === 'bottom' ? a.yMm === 18000 && b.yMm === 18000
      : side === 'left' ? a.xMm === 12000 && b.xMm === 12000 : a.xMm === 18000 && b.xMm === 18000
  })!
  scene = applyCommands(scene, [{ type: 'addOpening', id: 'ordinary-door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId,
    offsetMm: 2400, widthMm: 1200, kind: 'door', state: 'open' }], runtime)
  const port = resolveBuildingStructurePort(scene, 'ordinary-door', 1000), nx = Math.sign(port.outsideMm.x - port.positionMm.x), ny = Math.sign(port.outsideMm.y - port.positionMm.y)
  const fromDoor = [port.outsideMm, p(port.outsideMm.x + nx * 4000, port.outsideMm.y + ny * 4000), p(port.outsideMm.x + nx * 6000 - ny * 2500, port.outsideMm.y + ny * 6000 + nx * 2500)]
  scene = applyCommands(scene, [{ type: 'createPath', id: 'ordinary-road', floorId: port.floorId, layerId: 'visual-layer-ground',
    centerlineMm: end === 'start' ? fromDoor : [...fromDoor].reverse(), widthMm: 1000, supportRefs: [port.supportRef] }], runtime)
  const request: Extract<PathAttachmentEndpointRequest, { mode: 'bind' }> = { pathId: 'ordinary-road', openingId: 'ordinary-door', end, mode: 'bind', leadLengthMm: 1000, maxDisplacementMm: 0 }
  return { scene, runtime, wall, port, request, fromDoor, nx, ny }
}
function adopted(scene: SceneDocument, plan: PathAttachmentEndpointPlan): SceneDocument {
  const result = cloneJson(scene); result.paths['ordinary-road'].centerlineMm = cloneJson(plan.centerlineMm)
  return result
}
function follow(scene: SceneDocument, anchor: PathAttachmentEndpointPlan['anchor'], before: SceneDocument): PathAttachmentEndpointRequest {
  return { pathId: 'ordinary-road', openingId: 'ordinary-door', end: anchor.end, mode: 'follow', leadLengthMm: anchor.leadLengthMm, maxDisplacementMm: 500,
    before: { scene: before, anchor } }
}

describe('finite manual path endpoint attachment geometry', () => {
  it.each(['top', 'right', 'bottom', 'left'] as const)('binds either selected end at a %s door and preserves every original tail point', side => {
    for (const end of ['start', 'end'] as const) {
      const f = fixture(side, end), before = canonicalJson(f.scene), result = planPathAttachmentEndpoint(f.scene, f.request)
      const normalized = end === 'start' ? result.centerlineMm : [...result.centerlineMm].reverse()
      expect(normalized).toEqual([f.port.outsideMm, p(f.port.outsideMm.x + f.nx * 1000, f.port.outsideMm.y + f.ny * 1000), ...f.fromDoor.slice(1)])
      expect(result.preservedTail.pointsMm).toEqual(f.fromDoor.slice(1)); expect(result.preservedTail.count).toBe(2)
      expect(result.supportRefs).toEqual(f.scene.paths['ordinary-road'].supportRefs)
      expect(result.anchor.centerlineHash).toHaveLength(64); expect(result.anchor.preservedTailHash).toBe(result.preservedTail.hash)
      result.centerlineMm[0].x++; result.port.outsideMm.x++; result.preservedTail.pointsMm[0].x++
      expect(canonicalJson(f.scene)).toBe(before)
    }
  })

  it.each(['start', 'end'] as const)('follows door movement by replacing only the two managed points at the %s end', end => {
    const f = fixture('top', end), bound = planPathAttachmentEndpoint(f.scene, f.request), before = adopted(f.scene, bound), current = cloneJson(before)
    current.openings['ordinary-door'].offsetMm += 200
    const inputBefore = canonicalJson(current), result = planPathAttachmentEndpoint(current, follow(current, bound.anchor, before))
    const old = end === 'start' ? before.paths['ordinary-road'].centerlineMm : [...before.paths['ordinary-road'].centerlineMm].reverse()
    const next = end === 'start' ? result.centerlineMm : [...result.centerlineMm].reverse()
    expect(next.slice(2)).toEqual(old.slice(2)); expect(next[0]).not.toEqual(old[0]); expect(next[1]).not.toEqual(old[1])
    expect(result.preservedTail.hash).toBe(bound.preservedTail.hash)
    expect(canonicalJson(current)).toBe(inputBefore)
  })

  it('keeps a valid exterior bind/follow under closed and door-locked states without opening the door', () => {
    const f = fixture(), bound = planPathAttachmentEndpoint(f.scene, f.request), before = adopted(f.scene, bound)
    for (const changes of [{ state: 'closed' as const }, { locked: true }, { state: 'closed' as const, locked: true }]) {
      const current = cloneJson(before); Object.assign(current.openings['ordinary-door'], changes)
      const snapshot = canonicalJson(current), result = planPathAttachmentEndpoint(current, follow(current, bound.anchor, before))
      expect(result.centerlineMm).toEqual(bound.centerlineMm); expect(canonicalJson(current)).toBe(snapshot)
      const first = cloneJson(f.scene); Object.assign(first.openings['ordinary-door'], changes)
      expect(planPathAttachmentEndpoint(first, f.request).centerlineMm).toEqual(bound.centerlineMm)
    }
  })

  it.each(['door-width', 'wall-thickness'] as const)('recomputes the actual port after %s changes while preserving manual tail geometry', change => {
    const f = fixture(), bound = planPathAttachmentEndpoint(f.scene, f.request), before = adopted(f.scene, bound), current = cloneJson(before)
    if (change === 'door-width') current.openings['ordinary-door'].widthMm = 1400
    else current.walls[f.wall.id].thicknessMm = 600
    const result = planPathAttachmentEndpoint(current, follow(current, bound.anchor, before))
    expect(result.port).toEqual(resolveBuildingStructurePort(current, 'ordinary-door', 1000))
    expect(result.centerlineMm.slice(2)).toEqual(before.paths['ordinary-road'].centerlineMm.slice(2))
  })

  it('enforces exact finite displacement for binding and both managed follow points', () => {
    const f = fixture(), shifted = cloneJson(f.scene)
    shifted.paths['ordinary-road'].centerlineMm[0].y -= 400
    expect(() => planPathAttachmentEndpoint(shifted, { ...f.request, maxDisplacementMm: 399 })).toThrow(/有限位移/)
    expect(planPathAttachmentEndpoint(shifted, { ...f.request, maxDisplacementMm: 400 }).port).toEqual(f.port)
    const bound = planPathAttachmentEndpoint(f.scene, f.request), before = adopted(f.scene, bound), current = cloneJson(before)
    current.openings['ordinary-door'].offsetMm += 200
    const request = follow(current, bound.anchor, before)
    expect(() => planPathAttachmentEndpoint(current, { ...request, maxDisplacementMm: 199 })).toThrow(/有限位移/)
    expect(planPathAttachmentEndpoint(current, { ...request, maxDisplacementMm: 200 }).preservedTail.hash).toBe(bound.preservedTail.hash)
    expect(() => planPathAttachmentEndpoint(before, { ...request, leadLengthMm: 1600, maxDisplacementMm: 500 })).toThrow(/有限位移/)
  })

  it('refuses route reversal, changed manual points, end ambiguity and forged geometric witnesses', () => {
    const f = fixture(), bound = planPathAttachmentEndpoint(f.scene, f.request), before = adopted(f.scene, bound)
    for (const mode of ['reverse', 'tail', 'witness', 'end'] as const) {
      const current = cloneJson(before), request = follow(current, cloneJson(bound.anchor), before)
      if (mode === 'reverse') current.paths['ordinary-road'].centerlineMm.reverse()
      if (mode === 'tail') current.paths['ordinary-road'].centerlineMm[2].x += 100
      if (mode === 'witness' && request.mode === 'follow') request.before.anchor.preservedTailHash = '0'.repeat(64)
      if (mode === 'end') request.end = 'end'
      const snapshot = canonicalJson(current)
      expect(() => planPathAttachmentEndpoint(current, request)).toThrow(/见证|顺序|附着端/)
      expect(canonicalJson(current)).toBe(snapshot)
    }
  })

  it('rejects a changed normal or wall topology without searching for a new doorway', () => {
    const f = fixture(), bound = planPathAttachmentEndpoint(f.scene, f.request), before = adopted(f.scene, bound)
    const rotated = applyCommands(before, [{ type: 'transformBuilding', id: 'ordinary-room', offsetMm: p(0, 0), pivotMm: p(15000, 15000), quarterTurns: 1 }], f.runtime)
    expect(() => planPathAttachmentEndpoint(rotated, follow(rotated, bound.anchor, before))).toThrow(/外法向/)
    const reversed = applyCommands(before, [{ type: 'reverseWall', id: f.wall.id }], f.runtime)
    expect(() => planPathAttachmentEndpoint(reversed, follow(reversed, bound.anchor, before))).toThrow(/拓扑/)
  })

  it('checks the full exterior band for blockers and refuses a folding normal lead', () => {
    const f = fixture(), bound = planPathAttachmentEndpoint(f.scene, f.request), before = adopted(f.scene, bound), current = cloneJson(before)
    current.openings['ordinary-door'].offsetMm += 200
    const blocked = applyCommands(current, [{ type: 'createRegion', id: 'edge-blocker', floorId: 'visual-floor', layerId: 'visual-layer-ground',
      kind: 'hazard', boundaryMm: rect(f.port.outsideMm.x + 550, f.port.outsideMm.y - 1600, 200, 400), blocksMovement: true }], f.runtime)
    expect(() => planPathAttachmentEndpoint(blocked, follow(blocked, bound.anchor, before))).toThrow(/完整室外.*阻挡/)
    expect(() => planPathAttachmentEndpoint(f.scene, { ...f.request, leadLengthMm: 6000 })).toThrow(/折返|自交|重复/)
  })

  it('lists locked structural/layer/recursive-note dependencies without deciding edit permission', () => {
    const f = fixture(), current = cloneJson(f.scene), opening = current.openings['ordinary-door'], wall = current.walls[opening.wallId]
    for (const value of [opening, wall, current.rooms['ordinary-room'], current.paths['ordinary-road'], current.terrainAreas['ordinary-ground'], current.vertices[wall.startVertexId]]) value.editLocked = true
    current.userLayers['visual-layer-ground'].editLocked = true
    current.notes.first = { id: 'first', floorId: 'visual-floor', editLocked: true, kind: 'note', text: '', visibility: 'gm', anchor: { type: 'entity', entityKind: 'opening', entityId: opening.id } }
    current.notes.second = { ...current.notes.first, id: 'second', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    current.entityLayers.first = 'visual-layer-ground'; current.entityLayers.second = 'visual-layer-ground'
    const result = planPathAttachmentEndpoint(current, f.request)
    expect(result.dependencyIds).toEqual(expect.arrayContaining(['ordinary-road', opening.id, wall.id, wall.startVertexId, wall.endVertexId, 'ordinary-room', 'ordinary-ground', 'visual-layer-ground', 'first', 'second']))
    expect(result.centerlineMm).toHaveLength(4)
  })

  it('rejects incompatible private/changed support and a shared-room exterior anchor', () => {
    const f = fixture('right'), bound = planPathAttachmentEndpoint(f.scene, f.request), before = adopted(f.scene, bound)
    const privateRoad = cloneJson(f.scene); privateRoad.paths['ordinary-road'].visibility = 'gm'
    expect(() => planPathAttachmentEndpoint(privateRoad, f.request)).toThrow(/公开道路/)
    const shared = applyCommands(before, [{ type: 'createRoom', id: 'shared-neighbor', floorId: 'visual-floor', boundaryMm: rect(18000, 12000, 6000, 6000), thicknessMm: 400,
      supportRef: { kind: 'terrainArea', id: 'ordinary-ground' } }], f.runtime)
    expect(() => planPathAttachmentEndpoint(shared, follow(shared, bound.anchor, before))).toThrow(/恰好/)
    const changed = applyCommands(before, [{ type: 'createTerrainArea', id: 'extra-ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rect(1000, 1000, 1000, 1000), groundElevationMm: 1200, coveragePriority: 1 }], f.runtime)
    changed.paths['ordinary-road'].supportRefs.push({ kind: 'terrainArea', id: 'extra-ground' })
    expect(() => planPathAttachmentEndpoint(changed, follow(changed, bound.anchor, before))).toThrow(/支撑已改变/)
  })

  it('enforces actual point and dependency budgets and leaves input intact on rejection', () => {
    const f = fixture(), excessive = cloneJson(f.scene)
    excessive.paths['ordinary-road'].centerlineMm = Array.from({ length: 128 }, (_, i) => p(f.port.outsideMm.x, f.port.outsideMm.y - i * 20))
    expect(() => planPathAttachmentEndpoint(excessive, f.request)).toThrow(/128点/)
    const crowded = cloneJson(f.scene)
    for (let i = 0; i < 4100; i++) {
      const id = `dependent-note-${i}`
      crowded.notes[id] = { id, floorId: 'visual-floor', editLocked: false, kind: 'note', text: '', visibility: 'gm', anchor: { type: 'entity', entityKind: 'path', entityId: 'ordinary-road' } }
      crowded.entityLayers[id] = 'visual-layer-ground'
    }
    const snapshot = canonicalJson(crowded)
    expect(() => planPathAttachmentEndpoint(crowded, f.request)).toThrow(/dependencyRefs/)
    expect(canonicalJson(crowded)).toBe(snapshot)
  })
})
