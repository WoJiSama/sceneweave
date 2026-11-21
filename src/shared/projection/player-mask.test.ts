import { beforeAll, describe, expect, it } from 'vitest'
import { createWaysideInnDocument } from '../../platform/browser/content/wayside-inn.js'
import { applyCommands } from '../commands/commands.js'
import { planRoomPrivacy } from '../../editor/main/room-privacy-plan.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { getPlayerCoverageDiagnostics, projectScene, PlayerCoverageError } from './projection.js'
import { playerMaskContains } from './player-mask.js'
import type { SceneDocument } from '../model/scene.js'

const context = { clock: { now: () => '2026-11-18T00:00:00.000Z' }, ids: { nextId: () => 'unused' } }
let source: SceneDocument, candidate: SceneDocument
beforeAll(() => {
  source = createWaysideInnDocument({ sceneId: 'public-room-protection', now: context.clock.now() }).document
  let sequence = 0
  const commands = planRoomPrivacy({ scene: source, roomId: 'inn-linen', secretOpeningIds: [], privateNoteIds: [], nextMaskId: () => sequence++ ? `mask-${sequence}` : 'mask', layerId: 'visual-layer-ground' }).commands
  candidate = applyCommands(source, commands, context)
})
describe('explicit public room preservation inside fully validated masks', () => {
  it('retains public-only data, uses exact public room polygons, and leaves the entire private envelope covered', () => {
    const projection = projectScene(candidate, 'player')
    expect(getPlayerCoverageDiagnostics(candidate)).toEqual([])
    expect(projection.rooms.some(room => room.id === 'inn-linen')).toBe(false)
    const hiddenProps = Object.values(candidate.props).filter(prop => prop.supportRef.id === 'inn-linen')
    expect(hiddenProps.length).toBeGreaterThan(0)
    for (const prop of hiddenProps) expect(projection.props.some(row => row.id === prop.id)).toBe(false)
    expect(projection.maskPublicRooms?.flat().length).toBeGreaterThan(0)
    expect(playerMaskContains({ x: 19900, y: 9600 }, projection.masks, projection.maskPublicRooms)).toBe(false)
    expect(playerMaskContains({ x: 17500, y: 5000 }, projection.masks, projection.maskPublicRooms)).toBe(true)
    const exposed = cloneJson(candidate); exposed.regions.mask.boundaryMm[1].x = exposed.regions.mask.boundaryMm[0].x + 500; exposed.regions.mask.boundaryMm[2].x = exposed.regions.mask.boundaryMm[1].x
    expect(() => projectScene(exposed, 'player')).toThrow(/固定遮罩/)
  })
  it('keeps player projection exactly invariant when hidden props change or a new GM note is added', () => {
    const expected = projectScene(candidate, 'player'), changed = cloneJson(candidate)
    const hidden = Object.values(changed.props).find(prop => prop.supportRef.id === 'inn-linen')!
    hidden.rotationDeg = (hidden.rotationDeg + 180) % 360
    const withNote = applyCommands(changed, [{ type: 'createNote', id: 'private-canary', floorId: 'visual-floor', layerId: 'visual-layer-ground', kind: 'clue', visibility: 'gm', text: 'MUST NEVER REACH PLAYER', anchor: { type: 'entity', entityKind: 'room', entityId: 'inn-linen' } }], context)
    expect(projectScene(withNote, 'player')).toEqual(expected)
    expect(canonicalJson(expected)).not.toContain('MUST NEVER REACH PLAYER')
  })
  it('keeps mask paint and public holes stable after archive key ordering changes', () => {
    const reordered = cloneJson(candidate)
    reordered.regions = Object.fromEntries(Object.entries(reordered.regions).reverse())
    reordered.rooms = Object.fromEntries(Object.entries(reordered.rooms).reverse())
    expect(projectScene(reordered, 'player')).toEqual(projectScene(candidate, 'player'))
  })
  it('lets solid overlapping masks win and removes a room hole when that room becomes private', () => {
    const projection = projectScene(candidate, 'player'), point = { x: 19900, y: 9600 }
    const coveringMask = [{ x: 0, y: 0 }, { x: 28000, y: 0 }, { x: 28000, y: 22000 }, { x: 0, y: 22000 }]
    projection.masks.push(coveringMask)
    projection.maskPublicRooms!.push(projection.rooms.map(room => room.points))
    expect(playerMaskContains(point, projection.masks, projection.maskPublicRooms)).toBe(false)
    projection.masks.push(coveringMask)
    expect(playerMaskContains(point, projection.masks, projection.maskPublicRooms)).toBe(true)
    const changed = cloneJson(candidate); changed.rooms['inn-hall'].visibility = 'gm'
    changed.regions.mask.boundaryMm = [{ x: 0, y: 0 }, { x: 28000, y: 0 }, { x: 28000, y: 22000 }, { x: 0, y: 22000 }]
    const hiddenRoom = projectScene(changed, 'player')
    expect(playerMaskContains(point, hiddenRoom.masks, hiddenRoom.maskPublicRooms)).toBe(true)
  })
  it('preserves mode when only resizing, allows explicit solid mode, and rejects malformed/foreign region modes', () => {
    const resized = applyCommands(candidate, [{ type: 'upsertManualMask', id: 'mask', floorId: 'visual-floor', boundsMm: { x: 0, y: 0, width: 28000, height: 22000 } }], context)
    expect(resized.regions.mask.preservePublicRooms).toBe(true)
    const solid = applyCommands(resized, [{ type: 'upsertManualMask', id: 'mask', floorId: 'visual-floor', boundsMm: { x: 0, y: 0, width: 28000, height: 22000 }, preservePublicRooms: false }], context)
    expect(projectScene(solid, 'player').maskPublicRooms?.[0]).toEqual([])
    const invalid = cloneJson(candidate); invalid.regions.mask.preservePublicRooms = 'yes' as unknown as boolean
    expect(() => projectScene(invalid, 'player')).toThrow()
    invalid.regions.mask.preservePublicRooms = true; invalid.regions.mask.kind = 'hazard'
    expect(() => projectScene(invalid, 'player')).toThrow()
  })
  it('does not expose private collinear splits through public-room holes or public note positions', () => {
    const scene = applyCommands(candidate, [{ type: 'createNote', id: 'public-note', floorId: 'visual-floor', layerId: 'visual-layer-ground', kind: 'label', visibility: 'public', text: 'PUBLIC ROOM', anchor: { type: 'entity', entityKind: 'room', entityId: 'inn-guest-east' } }], context)
    const expected = projectScene(scene, 'player'), split = cloneJson(scene)
    const room = split.rooms['inn-guest-east'], wall = Object.values(split.walls).find(wall => {
      const a = split.vertices[wall.startVertexId], b = split.vertices[wall.endVertexId]
      return a.yMm === 2000 && b.yMm === 2000 && Math.min(a.xMm, b.xMm) === 8500 && Math.max(a.xMm, b.xMm) === 15000
    })!
    const endId = wall.endVertexId, startId = wall.startVertexId
    split.vertices['private-split'] = { id: 'private-split', floorId: wall.floorId, editLocked: false, xMm: 12000, yMm: 2000 }
    split.entityLayers['private-split'] = split.entityLayers[wall.id]
    split.walls['private-segment'] = { ...wall, id: 'private-segment', startVertexId: 'private-split' }
    split.entityLayers['private-segment'] = split.entityLayers[wall.id]
    wall.endVertexId = 'private-split'
    for (const r of Object.values(split.rooms)) r.boundaryVertexIds = r.boundaryVertexIds.flatMap((id, index, ids) => {
      const next = ids[(index + 1) % ids.length]
      return id === startId && next === endId || id === endId && next === startId ? [id, 'private-split'] : [id]
    })
    // The public shape is identical; the additional segment is hidden topology.
    expect(projectScene(split, 'player')).toEqual(expected)
    expect(projectScene(split, 'gm').rooms.find(row => row.id === room.id)).toBeTruthy()
  })
  it('keeps standalone walls and attached notes out even near a public-room hole', () => {
    const scene = cloneJson(candidate), layer = 'visual-layer-ground', floorId = 'visual-floor'
    scene.vertices['private-start'] = { id: 'private-start', floorId, editLocked: false, xMm: 15050, yMm: 8000 }
    scene.vertices['private-end'] = { id: 'private-end', floorId, editLocked: false, xMm: 16000, yMm: 8000 }
    scene.walls['private-divider'] = { id: 'private-divider', floorId, editLocked: false, startVertexId: 'private-start', endVertexId: 'private-end', thicknessMm: 100, blocksMovement: true, blocksSight: true, topStyle: null }
    for (const id of ['private-start', 'private-end', 'private-divider']) scene.entityLayers[id] = layer
    const noted = applyCommands(scene, [{ type: 'createNote', id: 'wall-canary', floorId, layerId: layer, kind: 'label', visibility: 'public', text: 'HIDDEN WALL NOTE', anchor: { type: 'entity', entityKind: 'wall', entityId: 'private-divider' } }], context)
    // Adding a private interior wall cannot silently turn its shadow public.
    // Its complete envelope must be covered before this proposal can be used.
    expect(() => projectScene(noted, 'player')).toThrow(PlayerCoverageError)
    const covered = applyCommands(noted, [{ type: 'upsertManualMask', id: 'wall-coverage', floorId, layerId: layer,
      boundsMm: { x: 0, y: 0, width: 28000, height: 22000 }, preservePublicRooms: true }], context)
    const result = projectScene(covered, 'player')
    expect(result.walls).toEqual(projectScene(candidate, 'player').walls)
    expect(result.notes.some(note => note.id === 'wall-canary')).toBe(false)
    expect(canonicalJson(result)).not.toContain('private-divider')
  })
})
