import { describe, expect, it, vi } from 'vitest'
import { artworkValidation } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { svgProjectFixture } from '../../../../tests/helpers/m24-svg-fixtures.js'
import { fixture, runtime } from '../../../application/workspace/test-fixtures.js'
import { fromBundle, toBundle, type EditableProject } from '../../../application/workspace/project.js'
import { prepareCompositionCommands } from '../../../application/workspace/prepare.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { listCatalogItems, loadLibraryCapsule, prepareLibraryEntry } from '../../../shared/library/content.js'
import { importProject } from '../../../shared/project/file.js'
import { projectResourceHashes } from '../../../shared/project/source-resources.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { assessAssetPublication } from '../../../shared/assets/review.js'
import { prepareProjectAssetReviews } from './review-content.js'

// Actual PNG/hash/source/ZIP checks with the explicit solid-rectangle SVG unit
// port. This suite does not exercise browser rendering or art acceptance.
vi.mock('../project-validation.js', async () => {
  const { artworkValidation } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  return { browserProjectValidation: artworkValidation() }
})

describe('read-only project asset review descriptors', () => {
  it('binds actual SVG/PNG capsules and exact prefab dependencies without including unrelated fixed items or issuing approval', async () => {
    const { bundle, normalized } = svgProjectFixture(), document = bundle.project.document
    document.propDefinitions.definition.name = ' 椅子_02.dark '
    document.props.other = { ...cloneJson(document.props.item), id: 'other', positionMm: { x: 9000, y: 9000 } }
    document.entityLayers.other = document.entityLayers.item
    document.materials.unrelated = { id: 'unrelated', catalogId: 'unrelated.surface', version: 1,
      name: '同图独立材质', tags: [], licenseRef: document.assets.image.licenseRef, origin: cloneJson(document.assets.image.origin),
      textureAssetId: 'image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room'] }
    bundle.project.licenseBindings.push({ ...bundle.project.licenseBindings[0], subjectKind: 'material', subjectId: 'unrelated' })
    Object.assign(bundle.project, createCompositionContent(document, runtime))
    const validation = artworkValidation(), project = await prepareCompositionCommands(await fromBundle(bundle, validation),
      [{ type: 'createPrefab', id: 'review-group', definitionId: 'review-group-definition', name: '真实组合', ids: ['item', 'other'], anchorMm: { x: 5000, y: 5000 } }],
      { validation, runtime })
    const before = canonicalJson(toBundle(project).project), result = await prepareProjectAssetReviews(project)
    expect(result.items).toHaveLength(3)
    expect(result.content).toHaveLength(3)
    expect(result.items.find(item => item.selector.kind === 'prop')!.name).toBe(' 椅子_02.dark ')
    const group = result.items.find(item => item.selector.kind === 'prefab')!
    const descriptor = result.content.find(item => item.catalogKey === group.identity.key)!
    const entry = await prepareLibraryEntry(toBundle(project), group.selector, validation), capsule = await loadLibraryCapsule(entry, validation)
    expect(descriptor.resourceHashes).toEqual(projectResourceHashes(capsule.project).sort())
    expect(descriptor.resourceHashes).toContain(normalized.sourceSha256)
    expect(descriptor.resourceHashes).toContain(normalized.normalizedSha256)
    expect(descriptor.dependencyKeys).toEqual(result.items.filter(item => item.selector.kind === 'prop').map(item => item.identity.key).sort())
    expect(descriptor.dependencyKeys).not.toContain(result.items.find(item => item.selector.kind === 'material')!.identity.key)
    expect(assessAssetPublication(descriptor, null).reviewReady).toBe(false)
    expect(Object.isFrozen(result.content[0].resourceHashes)).toBe(true)
    expect(canonicalJson(toBundle(project).project)).toBe(before)
  })

  it('rejects corrupt actual bytes and invalid permission bindings, including before an empty review result can be returned', async () => {
    const source = fixture({ image: true }), editable: EditableProject = { ...source.project, resources: {
      async read(hash) { const bytes = await source.resources.read(hash); bytes[bytes.length - 1] ^= 1; return bytes },
    } }
    await expect(prepareProjectAssetReviews(editable)).rejects.toThrow(/hash|摘要|CRC|字节/)
    const denied = fixture({ image: true })
    denied.project.licenseBindings[0].embedding = 'forbidden' as never
    await expect(prepareProjectAssetReviews({ ...denied.project, resources: denied.resources })).rejects.toThrow()
    const empty = fixture(), result = await prepareProjectAssetReviews({ ...empty.project, resources: empty.resources })
    expect(result).toEqual({ items: [], content: [] })
  })

  it('cancels before reads and after an in-flight resource read without returning usable descriptors', async () => {
    const source = fixture({ image: true }), before = new AbortController(), read = vi.fn(source.resources.read)
    before.abort()
    await expect(prepareProjectAssetReviews({ ...source.project, resources: { read } }, before.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).not.toHaveBeenCalled()
    const during = new AbortController()
    await expect(prepareProjectAssetReviews({ ...source.project, resources: { async read(hash) {
      const bytes = await source.resources.read(hash); during.abort(); return bytes
    } } }, during.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps a fixed multi-image prefab reviewable when JSON canonicalization reorders its member map', async () => {
    const source = fixture({ image: true }), document = source.project.document, first = document.props.item
    document.assets['second-image'] = { ...cloneJson(document.assets.image), id: 'second-image' }
    document.propDefinitions['second-definition'] = { ...cloneJson(document.propDefinitions.definition), id: 'second-definition', catalogId: 'review.second-definition',
      defaultAppearance: { kind: 'image', assetId: 'second-image', tint: null, opacity: 1 } }
    const template = (second: boolean) => ({ definitionRef: { id: second ? 'second-definition' : 'definition', version: 1 },
      appearance: cloneJson(document.propDefinitions[second ? 'second-definition' : 'definition'].defaultAppearance),
      visualBoundsMm: cloneJson(first.visualBoundsMm), positionMm: { x: second ? 1000 : -1000, y: 0 }, rotationDeg: 0,
      footprintMm: cloneJson(first.footprintMm), footprintOffsetMm: cloneJson(first.footprintOffsetMm), blocksMovement: false,
      blocksSight: false, renderLayer: 'object' as const, renderOrder: 0, shadowClass: 'none' as const, shadowOverride: null })
    document.prefabDefinitions['review-prefab'] = { id: 'review-prefab', catalogId: 'review.multi-image-prefab', version: 1,
      name: '两个独立图像成员', tags: [], licenseRef: document.assets.image.licenseRef, origin: cloneJson(document.assets.image.origin),
      members: [{ key: 'z-first', propTemplate: template(false) }, { key: 'a-second', propTemplate: template(true) }] }
    const binding = source.project.licenseBindings[0]
    source.project.licenseBindings.push({ ...binding, subjectKind: 'asset', subjectId: 'second-image' },
      { ...binding, subjectKind: 'propDefinition', subjectId: 'second-definition' }, { ...binding, subjectKind: 'prefabDefinition', subjectId: 'review-prefab' })
    Object.assign(source.project, createCompositionContent(document, runtime))
    const project = await fromBundle(source, artworkValidation()), before = canonicalJson(toBundle(project).project)
    const entry = await prepareLibraryEntry(toBundle(project), { kind: 'prefab', definitionId: 'review-prefab' }, artworkValidation())
    const decoded = await importProject(entry.capsule, artworkValidation()), actual = listCatalogItems(decoded).find(item => item.selector.kind === 'prefab')!
    expect(actual.identity).toEqual(entry.item.identity)
    expect(entry.item.thumbnailAssetIds).toEqual(['image', 'second-image'])
    expect(actual.thumbnailAssetIds).toEqual(['second-image', 'image'])
    await expect(loadLibraryCapsule(entry, artworkValidation())).resolves.toBeDefined()
    await expect(loadLibraryCapsule({ ...entry, item: { ...entry.item, thumbnailAssetIds: [...entry.item.thumbnailAssetIds].reverse() } }, artworkValidation())).resolves.toBeDefined()
    expect(entry.item.thumbnailAssetIds).toEqual(['image', 'second-image'])
    for (const thumbnailAssetIds of [['image'], ['image', 'second-image', 'second-image'], ['image', 'forged-image']]) {
      await expect(loadLibraryCapsule({ ...entry, item: { ...entry.item, thumbnailAssetIds } }, artworkValidation())).rejects.toThrow(/不一致/)
    }
    const result = await prepareProjectAssetReviews(project), group = result.items.find(item => item.selector.kind === 'prefab')!
    expect(result.content.find(item => item.catalogKey === group.identity.key)!.dependencyKeys).toEqual(result.items.filter(item => item.selector.kind === 'prop').map(item => item.identity.key).sort())
    expect(group.thumbnailAssetIds).toHaveLength(2)
    expect(canonicalJson(toBundle(project).project)).toBe(before)
  })
})
