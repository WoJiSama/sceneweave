import { unzipSync, unzlibSync, zlibSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPropAppearanceSourceV6, bitmapVariantV6, ensureSourceAssetRootsV6 } from '../core/v6/graph'
import { projectSceneV3 } from '../render/v3/projection'
import type { PropTemplate } from '../core/v3/types'
import { exportProjectV6 } from '../io/v6/project-file'
import { prepareCompositionCommandsV6 } from '../io/v6/prepare'
import { sha256Bytes } from '../io/v6/resources'
import { emptyProject, imageProject, outdoorProject, concatBytes, imageRecord, pixelPng, pngChunk } from '../io/v6/test-fixtures'
import type { CompleteProjectV6 } from '../io/v6/types'
import { describeCatalogItems, prepareCatalogAdoption, prepareCatalogEntry, readCatalogEntry } from './content'

beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function privatePrefabProject(members = 1): Promise<CompleteProjectV6> {
  const project = await outdoorProject(1), original = project.document.props['scatter-item-0'], originalDefinition = project.document.propDefinitions['scatter-definition']
  const template: PropTemplate = { definitionRef: { id: originalDefinition.id, version: 1 }, appearance: structuredClone(original.appearance), visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 },
    positionMm: { x: 0, y: 0 }, rotationDeg: 0, footprintMm: { width: 200, height: 200 }, footprintOffsetMm: { x: -100, y: -100 }, blocksMovement: false, blocksSight: false, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
  const definition = { id: 'private-prefab', catalogId: 'test.private-prefab', version: 1, licenseRef: originalDefinition.licenseRef, origin: originalDefinition.origin, name: '私密组合', tags: ['固定标签'], members: [] as { key: string; propTemplate: PropTemplate }[] }
  const fixedMembers: CompleteProjectV6['appearance']['prefabAppearanceTemplates'][string]['members'] = {}
  for (let index = 0; index < members; index++) {
    const prop = structuredClone(template), key = `member-${index}`
    if (members > 1) {
      const id = `distinct-prop-${index}`
      project.document.propDefinitions[id] = { ...structuredClone(originalDefinition), id, catalogId: id }
      project.licenseBindings.push({ ...project.licenseBindings[0], subjectId: id })
      prop.definitionRef = { id, version: 1 }
    }
    const ancestor = addPropAppearanceSourceV6(project.appearance, prop), child = addPropAppearanceSourceV6(project.appearance, { ...prop, appearance: { ...prop.appearance, opacity: .7 } }, ancestor)
    definition.members.push({ key, propTemplate: prop })
    fixedMembers[key] = { sourceId: child, adjustments: [{ id: `opacity-${index}`, kind: 'opacity', value: .5, enabled: true }] }
  }
  project.document.prefabDefinitions[definition.id] = definition
  project.appearance.prefabAppearanceTemplates[definition.id] = { definitionRef: { id: definition.id, version: 1 }, visibility: 'gm', members: fixedMembers }
  project.licenseBindings.push({ ...project.licenseBindings[0], subjectKind: 'prefabDefinition', subjectId: definition.id })
  return project
}

describe('U2 fixed catalog capsules and append-only adoption', () => {
  it('preserves real licensed image bytes while removing map geometry, current identity and private notes', async () => {
    const project = await imageProject()
    project.document.title = '秘密场景标题'
    const floor = Object.keys(project.document.floors)[0], layer = Object.values(project.document.userLayers).find(value => value.floorId === floor)!.id
    project.document.notes.secret = { id: 'secret', floorId: floor, editLocked: false, anchor: { type: 'point', positionMm: { x: 1000, y: 1000 } }, kind: 'note', text: '秘密文本', visibility: 'gm' }
    project.document.entityLayers.secret = layer
    const item = describeCatalogItems(project).find(value => value.selector.definitionId === 'test-material')!
    const entry = await prepareCatalogEntry(project, item.selector), capsule = await readCatalogEntry(entry)
    expect(entry.item).toEqual(item)
    expect(capsule.document.title).toBe('素材目录载体')
    expect(capsule.document.rooms).toEqual({}); expect(capsule.document.notes).toEqual({})
    expect(capsule.historyIdentity.propTokens).toEqual({}); expect(capsule.migrationSource).toBeUndefined()
    expect(capsule.appearance.propSources).toEqual({}); expect(capsule.appearance.surfaceSources).toEqual({})
    expect(Object.keys(capsule.document.materials)).toEqual(['test-material'])
    const hash = Object.keys(project.assets)[0]
    expect(await capsule.assets[hash].blob.arrayBuffer()).toEqual(await project.assets[hash].blob.arrayBuffer())
    const files = unzipSync(new Uint8Array(await entry.capsule.arrayBuffer()))
    expect(new TextDecoder().decode(files['scene.json'])).not.toContain('秘密')
    const changed = structuredClone(project); changed.document.title = '另一张图'; changed.document.revision++
    expect(describeCatalogItems(changed).find(value => value.selector.definitionId === 'test-material')!.identity).toEqual(item.identity)
  })

  it('transfers exact private prefab templates and ancestors; placement still enforces legal player masks', async () => {
    const source = await privatePrefabProject(), selector = { kind: 'prefab' as const, definitionId: 'private-prefab' }
    const entry = await prepareCatalogEntry(source, selector), capsule = await readCatalogEntry(entry)
    expect(entry.item.visibility).toBe('gm')
    expect(capsule.appearance.prefabAppearanceTemplates['private-prefab']).toEqual(source.appearance.prefabAppearanceTemplates['private-prefab'])
    expect(Object.values(capsule.appearance.sources)).toHaveLength(2)
    const target = emptyProject()
    for (const room of Object.values(target.document.rooms)) room.visibility = 'public'
    for (const prop of Object.values(target.document.props)) prop.visibility = 'public'
    for (const opening of Object.values(target.document.openings)) opening.secret = false
    for (const id of Object.keys(target.document.regions)) delete target.document.entityLayers[id]
    target.document.regions = {}
    const before = structuredClone(target), adopted = await prepareCatalogAdoption(target, [entry])
    expect(target).toEqual(before); expect(adopted.project.document.revision).toBe(target.document.revision)
    expect(adopted.project.historyIdentity).toEqual(target.historyIdentity)
    expect(adopted.project.document.props).toEqual(target.document.props)
    const floor = Object.keys(adopted.project.document.floors)[0], layer = Object.values(adopted.project.document.userLayers).find(value => value.floorId === floor)!.id
    const command = { type: 'instantiatePrefab' as const, id: 'placed-private', definitionRef: { id: selector.definitionId, version: 1 }, memberIds: { 'member-0': 'placed-private-member' }, anchorMm: { x: 2000, y: 2000 }, layerId: layer, supportRef: { kind: 'floor' as const, id: floor } }
    const placement = await prepareCompositionCommandsV6(adopted.project, [command])
    expect(placement.document.prefabInstances['placed-private'].visibility).toBe('gm')
    expect(placement.document.props['placed-private-member'].visibility).toBe('gm')
    expect(() => projectSceneV3(placement.document, 'player')).toThrow()
    const masked = structuredClone(adopted.project)
    masked.document.regions['private-mask'] = { id: 'private-mask', floorId: floor, editLocked: false, kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1,
      boundaryMm: [{ x: 1000, y: 1000 }, { x: 3000, y: 1000 }, { x: 3000, y: 3000 }, { x: 1000, y: 3000 }] }
    masked.document.entityLayers['private-mask'] = layer
    const legal = await prepareCompositionCommandsV6(masked, [command]), player = projectSceneV3(legal.document, 'player')
    expect(legal.document.prefabInstances['placed-private'].visibility).toBe('gm')
    expect(player.props.some(prop => prop.id === 'placed-private-member')).toBe(false)
    expect((await prepareCatalogAdoption(adopted.project, [entry])).operationCost).toBe(0)
  })

  it('retains actual inactive variant output, input, licenses and native definition roots', async () => {
    // A bounded 1px PNG/Canvas double verifies IO closure and pixel comparisons, not browser acceptance.
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer()), chunks: Uint8Array[] = []
      for (let offset = 8; offset < bytes.length;) {
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0), name = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))
        if (name === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
        offset += length + 12
      }
      return { width: 1, height: 1, pixels: unzlibSync(concatBytes(chunks)).slice(1), close: vi.fn() }
    }))
    vi.stubGlobal('document', { createElement: () => {
      let pixels = new Uint8ClampedArray(4)
      const context = { drawImage: (image: { pixels: Uint8Array }) => { pixels = new Uint8ClampedArray(image.pixels) }, getImageData: () => ({ data: pixels.slice() }), createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: (image: { data: Uint8ClampedArray }) => { pixels = image.data.slice() } }
      return { width: 0, height: 0, getContext: () => context }
    } })
    let project = await imageProject()
    const inputAsset = project.document.assets['test-image'], variant = bitmapVariantV6(inputAsset.id, '#808080', 1)!, original = pixelPng(), header = original.subarray(8, 33)
    const png = concatBytes([original.subarray(0, 8), header, pngChunk('IDAT', zlibSync(new Uint8Array([0, 10, 25, 40, 200]))), pngChunk('IEND', new Uint8Array())]), output = await imageRecord(png)
    project.document.assets[variant.outputAssetId] = { ...inputAsset, id: variant.outputAssetId, sha256: output.sha256 }
    project.assets[output.sha256] = output; project.appearance.variants[variant.id] = variant
    const prop = { id: 'derived-prop', catalogId: 'test.derived-prop', version: 1, licenseRef: inputAsset.licenseRef, origin: inputAsset.origin, name: '固定派生', tags: [], defaultAppearance: { kind: 'image' as const, assetId: variant.outputAssetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 }, defaultFootprintMm: { width: 1000, height: 1000 }, defaultFootprintOffsetMm: { x: -500, y: -500 }, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object' as const, defaultShadowClass: 'none' as const }
    project.document.propDefinitions[prop.id] = prop
    const binding = project.licenseBindings[0]
    project.licenseBindings.push({ ...binding, subjectId: variant.outputAssetId }, { ...binding, subjectKind: 'propDefinition', subjectId: prop.id })
    project = { ...project, ...ensureSourceAssetRootsV6(project) }
    const entry = await prepareCatalogEntry(project, { kind: 'prop', definitionId: prop.id }), capsule = await readCatalogEntry(entry)
    expect(capsule.appearance.variants[variant.id]).toEqual(variant)
    expect(Object.keys(capsule.document.assets).sort()).toEqual([inputAsset.id, variant.outputAssetId].sort())
    expect(capsule.document.materials['test-material']).toEqual(project.document.materials['test-material'])
    expect(Object.keys(capsule.assets)).toHaveLength(2)
    expect(await capsule.assets[output.sha256].blob.arrayBuffer()).toEqual(await output.blob.arrayBuffer())
    const incomplete = structuredClone(entry), parsed = await readCatalogEntry(entry)
    delete parsed.assets[output.sha256]
    await expect(exportProjectV6(parsed)).rejects.toThrow()
    expect(incomplete.item.identity).toEqual(entry.item.identity)
  })

  it('rejects forged metadata, unknown fields, corrupt bytes and a valid native map masquerading as a capsule', async () => {
    const source = await outdoorProject(1), entry = await prepareCatalogEntry(source, { kind: 'prop', definitionId: 'scatter-definition' })
    await expect(readCatalogEntry({ ...entry, item: { ...entry.item, name: '伪造名称' } })).rejects.toThrow('不一致')
    await expect(readCatalogEntry({ ...entry, unsupported: true } as never)).rejects.toThrow('字段')
    await expect(readCatalogEntry({ ...entry, capsule: new Blob(['broken']) })).rejects.toThrow('摘要')
    const capsule = await exportProjectV6(source), capsuleSha256 = await sha256Bytes(new Uint8Array(await capsule.arrayBuffer()))
    await expect(readCatalogEntry({ ...entry, capsule, capsuleSha256 })).rejects.toThrow('场景信息')
    const getter = vi.fn(), malicious = { ...entry }; Object.defineProperty(malicious.item, 'name', { get: getter, enumerable: true })
    await expect(readCatalogEntry(malicious)).rejects.toThrow('访问器'); expect(getter).not.toHaveBeenCalled()
  })

  it('rejects same logical content with different fixed IDs, and conflicting bindings, without changing the current branch', async () => {
    const source = await outdoorProject(1), entry = await prepareCatalogEntry(source, { kind: 'prop', definitionId: 'scatter-definition' }), target = structuredClone(source)
    const original = target.document.propDefinitions['scatter-definition']
    original.name = '同身份的不同内容'
    const before = structuredClone(target)
    await expect(prepareCatalogAdoption(target, [entry])).rejects.toThrow('逻辑素材身份')
    expect(target).toEqual(before)
    const renamed = emptyProject(), copy = structuredClone(source.document.propDefinitions['scatter-definition'])
    copy.id = 'different-fixed-id'; renamed.document.propDefinitions[copy.id] = copy
    renamed.licenses = source.licenses; renamed.licenseBindings.push({ ...source.licenseBindings[0], subjectId: copy.id })
    await expect(prepareCatalogAdoption(renamed, [entry])).rejects.toThrow('逻辑素材身份')
    const bindingConflict = structuredClone(source), text = 'Other actual legal text', hash = await sha256Bytes(new TextEncoder().encode(text))
    bindingConflict.licenses = { [hash]: { sha256: hash, text } }; bindingConflict.licenseBindings[0].licensePath = `licenses/${hash}.txt`
    await expect(prepareCatalogAdoption(bindingConflict, [entry])).rejects.toThrow('逻辑素材身份')
  })

  it('checks actual expanded adoption cost and leaves the current branch intact when more than256 entries are needed', async () => {
    const source = await privatePrefabProject(85), entry = await prepareCatalogEntry(source, { kind: 'prefab', definitionId: 'private-prefab' }), target = emptyProject(), before = structuredClone(target)
    await expect(prepareCatalogAdoption(target, [entry])).rejects.toThrow('超过256')
    expect(target).toEqual(before)
  })

  it('rejects cancellation before returning any prepared entry or adoption', async () => {
    const source = await outdoorProject(1), entry = await prepareCatalogEntry(source, { kind: 'prop', definitionId: 'scatter-definition' }), cancelled = AbortSignal.abort()
    await expect(prepareCatalogEntry(source, entry.item.selector, cancelled)).rejects.toThrow()
    await expect(readCatalogEntry(entry, cancelled)).rejects.toThrow()
    await expect(prepareCatalogAdoption(emptyProject(), [entry], cancelled)).rejects.toThrow()
    const pending = readCatalogEntry(entry); entry.item.name = '异步期间恶意修改'
    expect((await pending).document.propDefinitions['scatter-definition'].name).not.toBe('异步期间恶意修改')
  })
})
