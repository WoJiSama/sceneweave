import { describe, expect, it } from 'vitest'
import { createImageImportDocument, createImageImportProject, IMAGE_IMPORT_IDS, type ImageImportProjectInput } from './image-import-project.js'
import { signedVisualArea } from '../../../shared/visual/geometry.js'
import { fromBundle, toBundle } from '../../../application/workspace/project.js'
import { adoptLibraryEntries, loadLibraryCapsule, prepareLibraryEntries } from '../../../shared/library/content.js'
import { artworkValidation, encodeFixtureRaster } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { prepareImageImportItemVariant, prepareImageImportMaterialVariant } from './image-import-item.js'

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
  it('keeps the mapped image endpoints inside the floor when a fractional origin rounds asymmetrically', () => {
    const options = input()
    options.calibration = { pixelWidth: 1000, pixelHeight: 800, first: { x: 0, y: 0 }, second: { x: 7, y: 0 },
      distanceMm: 1000, originPx: { x: .011, y: .011 } }
    options.roomPointsPx = []
    options.layers = []
    const scene = createImageImportDocument(options), floor = scene.floors[IMAGE_IMPORT_IDS.floor]
    expect(scene.rooms).toEqual({})
    expect(scene.walls).toEqual({})
    expect(floor.artwork?.boundsMm).toEqual({ x: -2, y: -2, width: 142858, height: 114286 })
    expect(scene.exportBoundsMm).toEqual(floor.artwork?.boundsMm)
    expect(floor.boundsMm).toEqual(floor.artwork?.boundsMm)

    options.floor.boundsPx = { x: 10, y: 20, width: 120, height: 90 }
    const cropped = createImageImportDocument(options)
    expect(cropped.floors[IMAGE_IMPORT_IDS.floor].artwork?.boundsMm).toEqual({ x: 1427, y: 2856, width: 17143, height: 12857 })
    expect(cropped.exportBoundsMm).toEqual(cropped.floors[IMAGE_IMPORT_IDS.floor].artwork?.boundsMm)
  })

  it('recovers old imported raster items as explicit copies using only the archived project', async () => {
    const validation = artworkValidation()
    const buildLegacy = async (licenseText: string) => {
      const options = { ...input(), licenseText }
      const png = encodeFixtureRaster({ width: 1, height: 1, rgba: new Uint8ClampedArray([88, 59, 31, 255]) })
      for (const raster of [options.floor, ...options.layers]) raster.pngBytes = png
      const modern = toBundle(await createImageImportProject(options, undefined, validation))
      const project = cloneJson(modern.project)
      for (const record of [...Object.values(project.document.assets), ...Object.values(project.document.propDefinitions), ...Object.values(project.document.materials), ...project.licenseBindings]) record.licenseRef = 'image-import-source'
      return fromBundle({ project, resources: modern.resources }, validation)
    }
    const [target, archive] = await Promise.all([buildLegacy('Fixture A'), buildLegacy('Fixture B')])
    const before = canonicalJson(toBundle(archive).project)
    const definition = archive.document.propDefinitions[archive.document.props['custom-piano'].definitionRef!.id]
    if (definition.defaultAppearance.kind !== 'image') throw new Error('Fixture requires an imported raster.')
    const originalAsset = archive.document.assets[definition.defaultAppearance.assetId]
    const originalLicense = archive.licenseBindings.find(binding => binding.subjectId === definition.id)!
    const raw = await prepareLibraryEntries(toBundle(archive), [{ kind: 'prop', definitionId: definition.id }], validation)
    await expect(adoptLibraryEntries(toBundle(target), raw, validation)).rejects.toThrow(/同一licenseRef/)

    const copy = await prepareImageImportItemVariant(archive, definition.id, { name: definition.name,
      widthMm: definition.defaultVisualBoundsMm.width, heightMm: definition.defaultVisualBoundsMm.height,
      footprintWidthMm: definition.defaultFootprintMm.width, footprintHeightMm: definition.defaultFootprintMm.height,
      blocksMovement: definition.defaultBlocksMovement }, undefined, validation)
    const originalFloor = Object.values(archive.document.materials)[0]
    const floor = await prepareImageImportMaterialVariant(archive, originalFloor.id, { name: originalFloor.name,
      widthMm: originalFloor.defaultTileSizeMm.width, heightMm: originalFloor.defaultTileSizeMm.height }, undefined, validation)
    const capsule = await loadLibraryCapsule(copy, validation)
    const renewed = capsule.project.document.propDefinitions[copy.item.selector.definitionId]
    const binding = capsule.project.licenseBindings.find(row => row.subjectId === renewed.id)!
    expect(binding.licensePath).toBe(originalLicense.licensePath)
    expect(binding.licenseRef).toBe(`image-import-source-${originalLicense.licensePath.slice(9, -4)}`)
    expect(renewed.id).not.toBe(definition.id)
    expect(renewed.defaultFootprintMm).toEqual(definition.defaultFootprintMm)
    expect(renewed.defaultBlocksMovement).toBe(definition.defaultBlocksMovement)
    if (renewed.defaultAppearance.kind !== 'image') throw new Error('Recovery requires a raster copy.')
    const copiedAsset = capsule.project.document.assets[renewed.defaultAppearance.assetId]
    expect(copiedAsset.id).not.toBe(originalAsset.id)
    expect(copiedAsset.sha256).toBe(originalAsset.sha256)
    expect(await capsule.resources.read(copiedAsset.sha256)).toEqual(await archive.resources.read(originalAsset.sha256))
    const merged = await adoptLibraryEntries(toBundle(target), [copy, floor], validation)
    expect(merged.bundle.project.licenses).toEqual({ ...target.licenses, ...archive.licenses })
    expect(canonicalJson(toBundle(archive).project)).toBe(before)
  })

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

  it('fits physical wall bands at the source edges without moving the calibrated entities or crop', () => {
    const options = input()
    options.roomPointsPx = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }]
    const scene = createImageImportDocument(options)
    expect(scene.floors[IMAGE_IMPORT_IDS.floor].boundsMm).toEqual({ x: -1025, y: -1025, width: 10050, height: 8050 })
    expect(scene.exportBoundsMm).toEqual({ x: -1250, y: -1250, width: 10500, height: 8500 })
    expect(scene.vertices['image-import-vertex-0']).toMatchObject({ xMm: -1000, yMm: -1000 })
    expect(scene.walls['image-import-wall-0'].thicknessMm).toBe(50)
    expect(scene.props['custom-piano'].positionMm).toEqual({ x: 2900, y: 1600 })
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

  it('reuses fixed image props and floors from different sources while sharing identical raster bytes', async () => {
    const validation = artworkValidation()
    const pixel = encodeFixtureRaster({ width: 1, height: 1, rgba: new Uint8ClampedArray([97, 60, 30, 255]) })
    const original = input()
    for (const raster of [original.floor, ...original.layers]) raster.pngBytes = pixel
    const sources = await Promise.all([
      createImageImportProject(original, undefined, validation),
      createImageImportProject({ ...original, licenseText: 'Another exact license text. Embedding allowed.' }, undefined, validation),
      createImageImportProject({ ...original, attribution: '另一个合法来源的相同像素' }, undefined, validation),
    ])
    const selectors = sources.map(({ document }) => ({
      prop: document.props['custom-piano'].definitionRef!.id,
      floor: document.rooms[IMAGE_IMPORT_IDS.room].floorStyle!.base.materialRef.id,
    }))
    const entries = await Promise.all(sources.slice(1).map((project, index) => prepareLibraryEntries(toBundle(project), [
      { kind: 'prop', definitionId: selectors[index + 1].prop }, { kind: 'material', definitionId: selectors[index + 1].floor },
    ], validation)))
    const { bundle } = await adoptLibraryEntries(toBundle(sources[0]), entries.flat(), validation)
    expect(new Set(selectors.map(row => row.prop)).size).toBe(3)
    expect(new Set(selectors.map(row => row.floor)).size).toBe(3)
    expect(Object.keys(bundle.project.assets)).toHaveLength(1)
    expect(bundle.project.licenses).toEqual({ ...sources[0].licenses, ...sources[1].licenses })
    for (const [index, { prop, floor }] of selectors.entries()) {
      expect(bundle.project.document.propDefinitions[prop]).toEqual(sources[index].document.propDefinitions[prop])
      expect(bundle.project.document.materials[floor]).toEqual(sources[index].document.materials[floor])
      const binding = bundle.project.licenseBindings.find(row => row.subjectKind === 'propDefinition' && row.subjectId === prop)
      expect(binding).toEqual(sources[index].licenseBindings.find(row => row.subjectKind === 'propDefinition' && row.subjectId === prop))
    }
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
    expect(scene.propDefinitions[prop.definitionRef!.id].defaultVolume).toEqual({ kind: 'flat', heightMm: 0 })
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
