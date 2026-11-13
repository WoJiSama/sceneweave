import { describe, expect, it } from 'vitest'
import { createImageImportDocument, createImageImportProject, IMAGE_IMPORT_IDS, type ImageImportProjectInput } from './image-import-project.js'
import { signedVisualArea } from '../../../shared/visual/geometry.js'

function input(): ImageImportProjectInput {
  const pngBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'))
  const raster = (x: number, y: number, width: number, height: number) => ({ pngBytes, pixelWidth: 1, pixelHeight: 1, boundsPx: { x, y, width, height } })
  return { title: '自定义图片房间', calibration: { pixelWidth: 1000, pixelHeight: 800, first: { x: 100, y: 100 }, second: { x: 200, y: 100 }, distanceMm: 1000, originPx: { x: 100, y: 100 } },
    roomPointsPx: [{ x: 100, y: 100 }, { x: 850, y: 100 }, { x: 900, y: 700 }, { x: 100, y: 700 }], floor: raster(0, 0, 1000, 800),
    layers: [{ ...raster(300, 200, 180, 120), id: 'custom-piano', name: '钢琴', renderLayer: 'object', blocksMovement: true },
      { ...raster(250, 180, 280, 220), id: 'custom-rug', name: '地毯', renderLayer: 'ground', blocksMovement: false }],
    licenseText: 'Test fixture. Embedding allowed.', attribution: '本测试独立像素', sceneId: 'custom-image-room', now: '2026-11-10T00:00:00.000Z' }
}

describe('generic image import project preparation', () => {
  it('uses the supplied polygon, calibration and independent layers', () => {
    const scene = createImageImportDocument(input())
    expect(scene.title).toBe('自定义图片房间')
    expect(Object.keys(scene.walls)).toHaveLength(4)
    expect(scene.vertices['image-import-vertex-0']).toMatchObject({ xMm: 0, yMm: 0 })
    expect(scene.props['custom-piano'].positionMm).toEqual({ x: 2900, y: 1600 })
    expect(scene.props['custom-rug'].renderLayer).toBe('ground')
    expect(scene.props['custom-piano'].blocksMovement).toBe(true)
    expect(scene.rooms[IMAGE_IMPORT_IDS.room].floorStyle!.base.originMm).toEqual({ x: -1000, y: -1000 })
    expect(scene.exportBoundsMm).toEqual({ x: -250, y: -250, width: 8500, height: 6500 })
    expect(scene.floors[IMAGE_IMPORT_IDS.floor].boundsMm).toEqual({ x: -1000, y: -1000, width: 10000, height: 8000 })
  })

  it('normalizes reversed closed polygons and keeps fixed asset identities independent of instance ids', () => {
    const first = input(), second = input()
    second.roomPointsPx.reverse(); second.roomPointsPx.push(second.roomPointsPx[0])
    second.layers[0].id = 'another-piano'; second.sceneId = 'another-image-room'
    const a = createImageImportDocument(first), b = createImageImportDocument(second)
    const points = b.rooms[IMAGE_IMPORT_IDS.room].boundaryVertexIds.map(id => ({ x: b.vertices[id].xMm, y: b.vertices[id].yMm }))
    expect(signedVisualArea(points)).toBeGreaterThan(0)
    expect(b.props['another-piano'].definitionRef).toEqual(a.props['custom-piano'].definitionRef)
    expect(b.propDefinitions).toEqual(a.propDefinitions)
  })

  it('rejects out-of-range, conflicting and malformed input and exits cancelled preparation', async () => {
    const outside = input(); outside.layers[0].boundsPx.x = 999
    expect(() => createImageImportDocument(outside)).toThrow('范围')
    const duplicate = input(); duplicate.layers[1].id = duplicate.layers[0].id
    expect(() => createImageImportDocument(duplicate)).toThrow('身份重复')
    const malformed = input(); malformed.floor.pngBytes = new Uint8Array([1, 2, 3])
    expect(() => createImageImportDocument(malformed)).toThrow('PNG')
    const controller = new AbortController(); controller.abort()
    await expect(createImageImportProject(input(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('calibrates an explicitly marked physical footprint independently of the visual crop and checks its support', () => {
    const options = input()
    options.layers[0].footprintPx = { x: 330, y: 240, width: 80, height: 40 }
    const scene = createImageImportDocument(options), prop = scene.props['custom-piano']
    expect(prop.positionMm).toEqual({ x: 2900, y: 1600 })
    expect(prop.visualBoundsMm).toEqual({ x: -900, y: -600, width: 1800, height: 1200 })
    expect(prop.footprintMm).toEqual({ width: 800, height: 400 })
    expect(prop.footprintOffsetMm).toEqual({ x: -200, y: 0 })
    expect(scene.propDefinitions[prop.definitionRef!.id].defaultFootprintOffsetMm).toEqual({ x: -200, y: 0 })
    options.layers[0].footprintPx = { x: 999, y: 240, width: 80, height: 40 }
    expect(() => createImageImportDocument(options)).toThrow('范围')
    options.layers[0].footprintPx = { x: 0, y: 0, width: 10, height: 10 }
    options.layers[0].blocksMovement = false
    expect(() => createImageImportDocument(options)).toThrow('支撑面')
  })

  it('preserves the implicit physical footprint and its world center when an appearance raster expands', () => {
    const baseline = input(), expanded = input()
    // A non-integer calibration and asymmetric expansion expose independent
    // rounding of the visual center and the original physical footprint.
    baseline.calibration = { ...baseline.calibration, distanceMm: 731 }
    expanded.calibration = { ...expanded.calibration, distanceMm: 731 }
    const originalBounds = { ...expanded.layers[0].boundsPx }
    expanded.layers[0].boundsPx = { x: originalBounds.x - 1, y: originalBounds.y, width: originalBounds.width + 1, height: originalBounds.height + 2 }
    expanded.layers[0].footprintBasisPx = originalBounds
    const a = createImageImportDocument(baseline).props['custom-piano']
    const scene = createImageImportDocument(expanded), b = scene.props['custom-piano']
    expect(b.visualBoundsMm).not.toEqual(a.visualBoundsMm)
    expect(b.footprintMm).toEqual(a.footprintMm)
    const center = (p: typeof a) => ({ x: p.positionMm.x + p.footprintOffsetMm.x, y: p.positionMm.y + p.footprintOffsetMm.y })
    expect(center(b)).toEqual(center(a))
    expect(b.supportRef).toEqual(a.supportRef)
    expect(b.blocksMovement).toBe(a.blocksMovement)
    const definition = scene.propDefinitions[b.definitionRef!.id]
    expect(definition.defaultFootprintMm).toEqual(a.footprintMm)
    expect(definition.defaultFootprintOffsetMm).toEqual(b.footprintOffsetMm)
    expanded.layers[0].footprintBasisPx = { ...originalBounds, x: 999 }
    expect(() => createImageImportDocument(expanded)).toThrow('范围')
  })
})
