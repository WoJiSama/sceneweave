import { describe, expect, it } from 'vitest'
import { applyCommands } from '../../../shared/commands/commands.js'
import { createImageRoomSampleDocument, createImageRoomSampleProject, IMAGE_ROOM_IDS, type ImageRoomSampleInput } from './image-room-sample.js'

const runtime = { ids: { nextId: () => 'image-room-test-next' }, clock: { now: () => '2026-11-10T01:00:00.000Z' } }
function input(): ImageRoomSampleInput {
  const pngBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'))
  const raster = (x: number, y: number, width: number, height: number) => ({ pngBytes: new Uint8Array(pngBytes), pixelWidth: 1, pixelHeight: 1, boundsPx: { x, y, width, height } })
  return { floor: raster(738, 109, 429, 384), piano: raster(780, 240, 90, 65), rug: raster(752, 224, 148, 96),
    licenseText: 'Test-only generated sample fixture; embedding allowed.', attribution: '本测试自建单色像素', sceneId: 'image-room-test' }
}

describe('editable image-room sample', () => {
  it('uses one native slanted room and distinct floor, rug and piano layers', () => {
    const scene = createImageRoomSampleDocument(input())
    expect(Object.keys(scene.rooms)).toEqual([IMAGE_ROOM_IDS.room])
    expect(Object.keys(scene.walls)).toHaveLength(8)
    expect(Object.keys(scene.props).sort()).toEqual([IMAGE_ROOM_IDS.piano, IMAGE_ROOM_IDS.rug])
    expect(scene.props[IMAGE_ROOM_IDS.rug].renderLayer).toBe('ground')
    expect(scene.props[IMAGE_ROOM_IDS.piano].renderLayer).toBe('object')
    expect(scene.props[IMAGE_ROOM_IDS.piano].shadowClass).toBe('none')
    expect(scene.rooms[IMAGE_ROOM_IDS.room].floorStyle!.base.materialRef.id).toBe(IMAGE_ROOM_IDS.floorMaterial)
    expect(scene.vertices['image-room-vertex-2']).toMatchObject({ xMm: 3425, yMm: 600 })
    expect(scene.assets['image-room-art-floor'].logicalSizeMm).toEqual({ width: 10725, height: 9600 })
  })

  it('moves each prop through the ordinary command without changing the lower layer', () => {
    const scene = createImageRoomSampleDocument(input()), room = scene.rooms[IMAGE_ROOM_IDS.room]
    const pianoMoved = applyCommands(scene, [{ type: 'updateProp', id: IMAGE_ROOM_IDS.piano, changes: { positionMm: { x: 7000, y: 7800 } } }], runtime)
    expect(pianoMoved.props[IMAGE_ROOM_IDS.rug]).toEqual(scene.props[IMAGE_ROOM_IDS.rug])
    expect(pianoMoved.rooms[IMAGE_ROOM_IDS.room]).toEqual(room)
    const rugMoved = applyCommands(pianoMoved, [{ type: 'updateProp', id: IMAGE_ROOM_IDS.rug, changes: { positionMm: { x: 7000, y: 4000 } } }], runtime)
    expect(rugMoved.rooms[IMAGE_ROOM_IDS.room]).toEqual(room)
    expect(rugMoved.props[IMAGE_ROOM_IDS.piano]).toEqual(pianoMoved.props[IMAGE_ROOM_IDS.piano])
    expect(scene.props[IMAGE_ROOM_IDS.piano].positionMm).not.toEqual(pianoMoved.props[IMAGE_ROOM_IDS.piano].positionMm)
  })

  it('rejects malformed rasters and cancellation before producing a usable project', async () => {
    const malformed = input(); malformed.piano.pngBytes = new Uint8Array([1, 2, 3])
    expect(() => createImageRoomSampleDocument(malformed)).toThrow('PNG')
    const controller = new AbortController(); controller.abort()
    await expect(createImageRoomSampleProject(input(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
