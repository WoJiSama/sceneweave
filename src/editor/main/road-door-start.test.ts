import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../shared/commands/commands.js'
import { canonicalJson, cloneJson } from '../../shared/validation/json.js'
import { prepareRoadDoorStart } from './road-door-start.js'

const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function fixture() {
  const source = createShoreBlankDocument('island', { sceneId: 'door-road-start', title: '从真实门口接路', now: '2026-11-10T00:00:00.000Z', widthMm: 20000, heightMm: 16000, preset: 'narrative' })
  let sequence = 0
  const runtime = { clock: { now: () => source.updatedAt }, ids: { nextId: () => `door-start-${++sequence}` } }
  let document = applyCommands(source, [
    { type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(0, 0, 20000, 16000), groundElevationMm: 1200, coveragePriority: 0 },
    { type: 'createRoom', id: 'building', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(4000, 4000, 6000, 6000), thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ground' } },
  ], runtime)
  const wall = Object.values(document.walls).find(row => document.vertices[row.startVertexId].yMm === 4000 && document.vertices[row.endVertexId].yMm === 4000)!
  document = applyCommands(document, [{ type: 'addOpening', id: 'entrance', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 2400, widthMm: 1200, kind: 'door', state: 'open' }], runtime)
  return { document, wall, runtime }
}
const start = (document: ReturnType<typeof fixture>['document'], widthMm = 1000, hidden?: ReadonlySet<string>) => prepareRoadDoorStart(document, { document, openingId: 'entrance', widthMm }, hidden)

describe('one-time road draft from an actual exterior doorway', () => {
  it('prepares the exact outside anchor, width, Floor and terrain support without changing the door or document', () => {
    const { document } = fixture(), before = canonicalJson(document), prepared = start(document)
    expect(prepared).toMatchObject({ openingId: 'entrance', floorId: 'visual-floor', widthMm: 1000, point: { x: 7000, y: 3299 }, directionDeg: 270,
      visibility: 'public', supportRefs: [{ kind: 'terrainArea', id: 'ground' }] })
    expect(prepared.dependencyIds).toEqual(expect.arrayContaining(['entrance', 'building', 'ground']))
    prepared.point.x = 1; prepared.supportRefs[0].id = 'changed'
    expect(canonicalJson(document)).toBe(before)
    expect(start(document).point.x).toBe(7000)
  })
  it('refuses an old request even if the replacement has identical JSON, scene ID and revision', () => {
    const { document } = fixture(), replacement = cloneJson(document)
    expect(() => prepareRoadDoorStart(replacement, { document, openingId: 'entrance', widthMm: 1000 })).toThrow(/工程已改变/)
  })
  it('keeps door state and refuses closed, locked, secret, undersized and non-integer anchors', () => {
    const { document } = fixture()
    for (const changes of [{ state: 'closed' as const }, { locked: true }, { secret: true, revealed: false }, { widthMm: 1201 }]) {
      const changed = cloneJson(document); Object.assign(changed.openings.entrance, changes)
      const before = canonicalJson(changed)
      expect(() => start(changed)).toThrow(/打开|上锁|可见|整数毫米/)
      expect(canonicalJson(changed)).toBe(before)
    }
    expect(() => start(document, 1300)).toThrow(/净宽不足/)
    expect(() => start(document, 0)).toThrow(/正整数毫米/)
  })
  it('refuses each hidden/locked dependency and the dependency layer with a readable explanation', () => {
    const { document } = fixture(), prepared = start(document)
    for (const id of prepared.dependencyIds) {
      expect(() => start(document, 1000, new Set([id]))).toThrow(/隐藏|编辑范围/)
      const changed = cloneJson(document)
      const entity = changed.openings[id] ?? changed.walls[id] ?? changed.vertices[id] ?? changed.rooms[id] ?? changed.terrainAreas[id]
      entity.editLocked = true
      expect(() => start(changed)).toThrow(/锁定/)
    }
    const changed = cloneJson(document); changed.userLayers['visual-layer-ground'].editLocked = true
    expect(() => start(changed)).toThrow(/图层/)
  })
  it('refuses a shared internal doorway and blocked or private ground', () => {
    const { document, wall, runtime } = fixture()
    const shared = applyCommands(document, [{ type: 'createRoom', id: 'neighbor', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(4000, 1000, 6000, 3000), thicknessMm: wall.thicknessMm, supportRef: { kind: 'terrainArea', id: 'ground' } }], runtime)
    expect(() => start(shared)).toThrow(/恰好/)
    for (const changes of [{ blocksMovement: true }, { visibility: 'gm' as const }]) {
      const changed = cloneJson(document); Object.assign(changed.terrainAreas.ground, changes)
      expect(() => start(changed)).toThrow(/公开|支撑/)
    }
  })
  it('does not extend the existing adapter to a diagonal exterior wall', () => {
    const { document, runtime } = fixture()
    let diagonal = applyCommands(document, [{ type: 'createRoom', id: 'diagonal-building', floorId: 'visual-floor', layerId: 'visual-layer-ground',
      boundaryMm: [{ x: 12000, y: 5000 }, { x: 15000, y: 2000 }, { x: 18000, y: 5000 }, { x: 15000, y: 8000 }], thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ground' } }], runtime)
    const room = diagonal.rooms['diagonal-building'], vertices = new Set(room.boundaryVertexIds)
    const wall = Object.values(diagonal.walls).find(wall => vertices.has(wall.startVertexId) && vertices.has(wall.endVertexId))!
    diagonal = applyCommands(diagonal, [{ type: 'addOpening', id: 'diagonal-door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1000, widthMm: 1200, kind: 'door', state: 'open' }], runtime)
    expect(() => prepareRoadDoorStart(diagonal, { document: diagonal, openingId: 'diagonal-door', widthMm: 1000 })).toThrow(/正交/)
  })
})
