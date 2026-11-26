import { describe, expect, it } from 'vitest'
import { layerScene, FIXTURE_STAMP } from '../../../tests/helpers/current-project-fixtures.js'
import { applyCommands } from '../../shared/commands/commands'
import { extensionBoundary, extensionDepth, extensionWallAt, startRoomExtension } from './room-extension'

describe('room extension from an existing wall', () => {
  it('keeps the actual endpoints of a reversed diagonal wall and excludes a shared, hidden or locked edge', () => {
    const base = layerScene()
    let sequence = 0
    const runtime = { ids: { nextId: () => `extension-test-${++sequence}` }, clock: { now: () => FIXTURE_STAMP } }
    const room = { type: 'createRoom' as const, floorId: 'blank-floor', thicknessMm: 200, layerId: 'layer-default-0' }
    const scene = applyCommands(base, [{ ...room, id: 'hall', boundaryMm: [{ x: 3000, y: 3000 }, { x: 9000, y: 3000 }, { x: 6000, y: 7000 }] }], runtime)
    const outside = startRoomExtension(scene, 'hall', new Set()).walls.find(wall => wall.outward.x > 0)!
    const reversed = applyCommands(scene, [{ type: 'reverseWall', id: outside.id }], runtime)
    const wall = startRoomExtension(reversed, outside.id, new Set()).wall!
    expect(wall.outward).toEqual({ x: .8, y: .6 })
    expect(extensionWallAt([wall], { x: 7507, y: 5005 }, 100)?.id).toBe(wall.id)
    expect(extensionDepth(wall, { x: 9090, y: 6210 }, 100)).toBe(2000)
    expect(extensionDepth(wall, { x: 5990, y: 3810 }, 100)).toBe(0)
    const boundaryMm = extensionBoundary(wall, 2000)
    expect(boundaryMm).toEqual([wall.end, wall.start, { x: 10600, y: 4200 }, { x: 7600, y: 8200 }])
    const expanded = applyCommands(reversed, [{ ...room, id: 'annex', boundaryMm }], runtime)
    expect(Object.values(expanded.walls)).toHaveLength(6)
    expect(startRoomExtension(expanded, 'annex', new Set()).walls.map(w => w.id)).not.toContain(wall.id)
    expect(() => startRoomExtension(expanded, wall.id, new Set())).toThrow('共墙')
    expect(() => startRoomExtension(scene, wall.id, new Set([wall.id]))).toThrow('外墙')
    const locked = applyCommands(scene, [{ type: 'setEditLock', kind: 'wall', id: wall.id, locked: true }], runtime)
    expect(startRoomExtension(locked, 'hall', new Set()).walls.map(w => w.id)).not.toContain(wall.id)
  })
})
