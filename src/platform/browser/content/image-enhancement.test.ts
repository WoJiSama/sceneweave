import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../../application/workspace/test-fixtures.js'
import { fromBundle, toBundle } from '../../../application/workspace/project.js'
import { prepareCompositionCommands } from '../../../application/workspace/prepare.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { decodeCanonicalPng, encodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { transformRgba } from '../../../shared/project/pixels.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { applyImageEnhancement, type ImageEnhancementRecipe } from '../../../shared/image-enhancement/index.js'
import { inspectImageEnhancementTarget, prepareImageEnhancementCandidate, readImageEnhancementSource, type ImageEnhancementTarget } from './image-enhancement.js'
import { prepareImageImportItemVariant } from './image-import-item.js'
import { loadLibraryCapsule } from '../../../shared/library/content.js'

const validation: CompleteValidationOptions = { images: {
  async decode(bytes) { return decodeCanonicalPng(bytes) },
  async transform(image, parameters) { return { ...image, rgba: transformRgba(image.rgba, parameters.tint, parameters.brightness) } },
  async encodePng(image) { return encodeCanonicalPng(image) },
} }
const clarity: ImageEnhancementRecipe = { version: 1, direction: 'clarity', strength: 'balanced', scale: 2 }
const target: ImageEnhancementTarget = { kind: 'prop', id: 'item' }

async function source(withSurfaces = false, transparentEdge = false) {
  const bundle = fixture({ image: true, building: withSurfaces }), document = bundle.project.document
  const rgba = new Uint8ClampedArray(8 * 8 * 4)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) rgba.set(x < y ? [25, 31, 35, 255] : [98 + x % 2 * 12, 110, 130, 255], (y * 8 + x) * 4)
  if (transparentEdge) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const edge = Math.min(x, y, 7 - x, 7 - y)
    rgba.set(edge === 0 ? [0, 0, 0, 0] : edge === 1 ? [50, 75, 100, 128] : [40, 40, 40, 255], (y * 8 + x) * 4)
  }
  const bytes = encodeCanonicalPng({ width: 8, height: 8, rgba }), hash = sha256Bytes(bytes)
  Object.assign(document.assets.image, { sha256: hash, pixelWidth: 8, pixelHeight: 8 })
  bundle.project.assets = { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 8, pixelHeight: 8 } }
  bundle.resources = createMemoryResources(new Map([[hash, bytes]]))
  if (withSurfaces) {
    document.materials.wood = { id: 'wood', catalogId: 'wood', version: 1, licenseRef: 'fixture-license', origin: document.assets.image.origin,
      name: '手绘木板', tags: [], textureAssetId: 'image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room', 'terrain', 'wall'] }
    bundle.project.licenseBindings.push({ ...bundle.project.licenseBindings[0], subjectKind: 'material', subjectId: 'wood' })
    const style = { base: { materialRef: { id: 'wood', version: 1 }, tileSizeMm: { width: 1200, height: 800 }, rotationDeg: 17,
      alignment: 'world' as const, originMm: { x: 123, y: 456 }, tint: null, opacity: 1 }, overlays: [] }
    document.rooms.room.floorStyle = structuredClone(style)
    document.walls['wall-0'].topStyle = structuredClone(style)
    document.terrainAreas.ground = { id: 'ground', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      boundaryMm: [{ x: 12000, y: 12000 }, { x: 18000, y: 12000 }, { x: 18000, y: 18000 }, { x: 12000, y: 18000 }].map((positionMm, index) => ({ id: `ground-${index}`, segmentId: `ground-edge-${index}`, positionMm })),
      groundElevationMm: 0, coveragePriority: 0, surfaceStyle: structuredClone(style), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    document.entityLayers.ground = document.entityLayers.item
  }
  Object.assign(bundle.project, createCompositionContent(document, runtime))
  return fromBundle(bundle, validation)
}

describe('editable image enhancement candidates', () => {
  it.each([{ kind: 'propDefinition', id: 'definition' }, { kind: 'material', id: 'wood' }] as const)('edits fixed $kind pixels without changing any scene reference', async fixedTarget => {
    const project = await source(true), before = canonicalJson(toBundle(project).project)
    const selected = await readImageEnhancementSource(project, fixedTarget, 'current', undefined, validation)
    const prepared = await prepareImageEnhancementCandidate(project, selected, clarity, undefined, undefined, validation)
    expect(prepared.commands).toEqual([])
    expect(prepared.selector?.kind).toBe(fixedTarget.kind === 'material' ? 'material' : 'prop')
    expect(prepared.selector?.definitionId).not.toBe(fixedTarget.id)
    expect(prepared.catalog.document.props).toEqual(project.document.props)
    expect(prepared.catalog.document.rooms).toEqual(project.document.rooms)
    expect(prepared.catalog.document.materials.wood).toEqual(project.document.materials.wood)
    const assetId = fixedTarget.kind === 'material' ? prepared.catalog.document.materials[prepared.selector!.definitionId].textureAssetId
      : (prepared.catalog.document.propDefinitions[prepared.selector!.definitionId].defaultAppearance as { assetId: string }).assetId
    const asset = prepared.catalog.document.assets[assetId], actual = decodeCanonicalPng(await prepared.catalog.resources.read(asset.sha256))
    expect(actual.rgba).toEqual(applyImageEnhancement(selected.pixels, clarity).data)
    const cold = await fromBundle(toBundle(prepared.catalog), validation)
    expect(await readImageEnhancementSource(cold, { kind: fixedTarget.kind, id: prepared.selector!.definitionId }, 'original', undefined, validation))
      .toMatchObject({ pixels: { width: 8, height: 8 } })
    expect(canonicalJson(toBundle(project).project)).toBe(before)
  })

  it('saves dimensions, physical defaults and image processing together as one new library entry', async () => {
    const project = await source(), before = canonicalJson(toBundle(project).project)
    const selected = await readImageEnhancementSource(project, { kind: 'propDefinition', id: 'definition' }, 'current', undefined, validation)
    const prepared = await prepareImageEnhancementCandidate(project, selected, clarity, undefined, undefined, validation)
    const entry = await prepareImageImportItemVariant(prepared.catalog, prepared.selector!.definitionId,
      { name: '统一编辑副本', widthMm: 1600, heightMm: 1200, footprintWidthMm: 800, footprintHeightMm: 600,
        footprintOffsetXmm: 50, footprintOffsetYmm: -20, blocksMovement: true, blocksSight: true }, undefined, validation)
    const capsule = await loadLibraryCapsule(entry, validation), definition = capsule.project.document.propDefinitions[entry.item.selector.definitionId]
    expect(definition).toMatchObject({ name: '统一编辑副本', defaultVisualBoundsMm: { width: 1600, height: 1200 },
      defaultFootprintMm: { width: 800, height: 600 }, defaultFootprintOffsetMm: { x: 50, y: -20 }, defaultBlocksMovement: true, defaultBlocksSight: true })
    if (definition.defaultAppearance.kind !== 'image') throw new Error('missing image')
    const asset = capsule.project.document.assets[definition.defaultAppearance.assetId]
    expect(asset.imageEnhancement?.recipe).toEqual(clarity)
    expect(capsule.project.document.assets.image).toEqual(project.document.assets.image)
    expect(capsule.project.licenses).toEqual(project.licenses)
    expect(canonicalJson(toBundle(project).project)).toBe(before)
  })

  it('uses exact PNG pixels for decontamination review and private adoption despite native alpha rounding', async () => {
    const project = await source(false, true), recipe: ImageEnhancementRecipe = { version: 1, direction: 'decontaminate', strength: 'strong', scale: 1 }
    const native: CompleteValidationOptions = { images: { ...validation.images, async decode(bytes) {
      const raster = decodeCanonicalPng(bytes)
      for (let index = 0; index < raster.rgba.length; index += 4) if (raster.rgba[index + 3] > 0 && raster.rgba[index + 3] < 255) {
        raster.rgba[index] += 7; raster.rgba[index + 1] -= 5
      }
      return raster
    } } }
    const selected = await readImageEnhancementSource(project, target, 'current', undefined, native)
    expect(selected.canonicalPixels).toBeDefined()
    expect(selected.pixels.data).not.toEqual(selected.canonicalPixels!.data)
    const scope = new Uint8Array(64); scope.fill(255, 0, 32)
    const expected = applyImageEnhancement(selected.canonicalPixels!, recipe, scope)
    selected.pixels.data.fill(0); selected.canonicalPixels!.data.fill(0)
    const prepared = await prepareImageEnhancementCandidate(project, selected, recipe, scope, undefined, native)
    const asset = Object.values(prepared.catalog.document.assets).find(value => value.imageEnhancement)!
    const actual = decodeCanonicalPng(await prepared.catalog.resources.read(asset.sha256))
    expect(actual.rgba).toEqual(expected.data)
    expect(decodeCanonicalPng(await project.resources.read(project.document.assets.image.sha256)).rgba.some(value => value > 0)).toBe(true)
  })

  it('adds fixed PNG/definition resources, preserves geometry and source, and continues from current or original after cold validation', async () => {
    const project = await source(), before = canonicalJson(toBundle(project).project)
    const selected = await readImageEnhancementSource(project, target, 'current', undefined, validation)
    const expected = applyImageEnhancement(selected.pixels, clarity)
    // A view must not be able to replace the private baseline pixels used by adoption.
    selected.pixels.data.fill(0)
    const prepared = await prepareImageEnhancementCandidate(project, selected, clarity, undefined, undefined, validation)
    expect(prepared.commands).toHaveLength(1)
    expect(prepared.catalog.document.props).toEqual(project.document.props)
    const adopted = await prepareCompositionCommands(prepared.catalog, prepared.commands, { runtime, validation })
    const beforeProp = project.document.props.item, afterProp = adopted.document.props.item
    expect({ ...afterProp, definitionRef: beforeProp.definitionRef, appearance: beforeProp.appearance }).toEqual(beforeProp)
    expect(afterProp.appearance.kind).toBe('image')
    if (afterProp.appearance.kind !== 'image') throw new Error('missing enhanced asset')
    const asset = adopted.document.assets[afterProp.appearance.assetId], actual = decodeCanonicalPng(await adopted.resources.read(asset.sha256))
    expect(actual.rgba).toEqual(expected.data)
    expect(asset.imageEnhancement).toEqual({ version: 1, sourceAssetId: 'image', originalAssetId: 'image', recipe: clarity })
    expect(adopted.document.assets.image).toEqual(project.document.assets.image)
    const cold = await fromBundle(toBundle(adopted), validation)
    const current = await readImageEnhancementSource(cold, target, 'current', undefined, validation)
    const original = await readImageEnhancementSource(cold, target, 'original', undefined, validation)
    expect([current.pixels.width, original.pixels.width]).toEqual([16, 8])
    expect(original.pixels.data).toEqual(decodeCanonicalPng(await project.resources.read(project.document.assets.image.sha256)).rgba)
    const next = await prepareImageEnhancementCandidate(cold, current, { ...clarity, scale: 1 }, undefined, undefined, validation)
    expect(next.commands).toHaveLength(1)
    expect(canonicalJson(toBundle(project).project)).toBe(before)
  })

  it('rebases unrelated edits but rejects old candidates after any target move, edit or lock', async () => {
    const project = await source(), selected = await readImageEnhancementSource(project, target, 'current', undefined, validation)
    const renamed = await prepareCompositionCommands(project, [{ type: 'renameScene', title: '无关的工程名称' }], { runtime, validation })
    const prepared = await prepareImageEnhancementCandidate(renamed, selected, clarity, undefined, undefined, validation)
    expect(prepared.catalog.document.title).toBe('无关的工程名称')
    const moved = await prepareCompositionCommands(project, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 5000, y: 5000 } } }], { runtime, validation })
    await expect(prepareImageEnhancementCandidate(moved, selected, clarity, undefined, undefined, validation)).rejects.toThrow('已修改')
    const locked = await prepareCompositionCommands(project, [{ type: 'setEditLock', kind: 'prop', id: 'item', locked: true }], { runtime, validation })
    await expect(prepareImageEnhancementCandidate(locked, selected, clarity, undefined, undefined, validation)).rejects.toThrow('已修改')
    await expect(prepareImageEnhancementCandidate(project, { ...selected }, clarity, undefined, undefined, validation)).rejects.toThrow('基线')
  })

  it('enhances the fixed image and reapplies existing brightness exactly once', async () => {
    const initial = await source()
    const project = await prepareCompositionCommands(initial, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'dim', kind: 'brightness', enabled: true, value: .5 } }], { runtime, validation })
    const selected = await readImageEnhancementSource(project, target, 'current', undefined, validation)
    expect(selected.assetId).toBe('image')
    const enhanced = applyImageEnhancement(selected.pixels, clarity)
    const prepared = await prepareImageEnhancementCandidate(project, selected, clarity, undefined, undefined, validation)
    const adopted = await prepareCompositionCommands(prepared.catalog, prepared.commands, { runtime, validation })
    const after = adopted.document.props.item.appearance
    if (after.kind !== 'image') throw new Error('missing image')
    const actual = decodeCanonicalPng(await adopted.resources.read(adopted.document.assets[after.assetId].sha256))
    expect(actual.rgba).toEqual(transformRgba(enhanced.data, null, .5))
    expect(adopted.appearance.instanceAdjustments).toEqual(project.appearance.instanceAdjustments)
    expect(await readImageEnhancementSource(adopted, target, 'current', undefined, validation)).toMatchObject({ pixels: enhanced })
  })

  it.each([{ kind: 'room', id: 'room' }, { kind: 'terrainArea', id: 'ground' }, { kind: 'wall', id: 'wall-0' }] as const)('changes only the base image material for $kind', async target => {
    const project = await source(true), selected = await readImageEnhancementSource(project, target, 'current', undefined, validation)
    const prepared = await prepareImageEnhancementCandidate(project, selected, clarity, undefined, undefined, validation)
    const adopted = await prepareCompositionCommands(prepared.catalog, prepared.commands, { runtime, validation })
    const before = target.kind === 'room' ? project.document.rooms[target.id].floorStyle! : target.kind === 'wall' ? project.document.walls[target.id].topStyle! : project.document.terrainAreas[target.id].surfaceStyle!
    const after = target.kind === 'room' ? adopted.document.rooms[target.id].floorStyle! : target.kind === 'wall' ? adopted.document.walls[target.id].topStyle! : adopted.document.terrainAreas[target.id].surfaceStyle!
    expect({ ...after, base: { ...after.base, materialRef: before.base.materialRef } }).toEqual(before)
    expect(after.base.materialRef).not.toEqual(before.base.materialRef)
    expect(adopted.document.props).toEqual(project.document.props)
  })

  it('persists an exact local scope and rejects cancellation without changing the original', async () => {
    const project = await source(), selected = await readImageEnhancementSource(project, target, 'current', undefined, validation)
    const scope = new Uint8Array(64); scope.fill(255, 16, 32)
    const prepared = await prepareImageEnhancementCandidate(project, selected, clarity, scope, undefined, validation)
    const changed = Object.values(prepared.catalog.document.assets).find(asset => asset.imageEnhancement)!
    expect(changed.imageEnhancement?.scopeMask).toMatchObject({ x: 0, y: 2, width: 8, height: 2, runs: [16, 255] })
    const actual = decodeCanonicalPng(await prepared.catalog.resources.read(changed.sha256))
    expect(actual.rgba).toEqual(applyImageEnhancement(selected.pixels, clarity, scope).data)
    const controller = new AbortController(); controller.abort()
    await expect(prepareImageEnhancementCandidate(project, selected, clarity, scope, controller.signal, validation)).rejects.toMatchObject({ name: 'AbortError' })
    expect(inspectImageEnhancementTarget(project, { kind: 'prop', id: 'missing' })).toBeNull()
  })
})
