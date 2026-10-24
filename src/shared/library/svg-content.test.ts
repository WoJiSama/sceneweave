import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { artworkValidation, artworkDraft, ARTWORK_SVG } from '../../../tests/helpers/m24-artwork-fixtures'
import { SVG_FIXTURE_SOURCE, svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures'
import { fixture, runtime } from '../../application/workspace/test-fixtures'
import { fromBundle, toBundle } from '../../application/workspace/project'
import { prepareCompositionCommands } from '../../application/workspace/prepare'
import { materializeAuthoringArtwork } from '../../application/workspace/artwork'
import { createCompositionContent } from '../appearance/graph'
import { exportLibraryBackup, importLibraryBackup } from './backup'
import { adoptLibraryEntries, listCatalogItems, loadLibraryCapsule, prepareLibraryEntry, validateLibraryEntry } from './content'
import { exportProject, importProject } from '../project/file'
import { decodeUtf8, sha256Bytes } from '../project/binary'
import { projectResourceHashes } from '../project/source-resources'
import { canonicalJson, cloneJson } from '../validation/json'
import type { ProjectData } from '../model/project'

function algorithm2Hash(project: ProjectData): string {
  const base = { definitions: Object.fromEntries(['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'].map(key => [key, project.document[key as 'assets']])),
    appearance: Object.fromEntries(['sources', 'variants', 'prefabAppearanceTemplates'].map(key => [key, project.appearance[key as 'sources']])),
    assets: Object.fromEntries(Object.entries(project.assets).map(([hash, record]) => [hash, { sha256: record.sha256, mimeType: record.mimeType, sizeBytes: record.sizeBytes, pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight }])),
    licenseHashes: Object.keys(project.licenses).sort(), licenseBindings: project.licenseBindings }
  return sha256Bytes(new TextEncoder().encode(canonicalJson({ domain: 'sceneweave-svg-fixed', version: 1, base, authoringSources: project.authoringSources })))
}

describe('SVG library algorithm2 complete fixed closure', () => {
  it('uses the frozen algorithm2 domain/base/source identity while bitmap-only content stays algorithm1', async () => {
    const validation = artworkValidation(), { bundle } = svgProjectFixture(), entry = await prepareLibraryEntry(bundle, { kind: 'prop', definitionId: 'definition' }, validation)
    const loaded = await loadLibraryCapsule(entry, validation)
    expect(JSON.parse(entry.item.identity.key)[0]).toBe(2)
    expect(JSON.parse(entry.item.identity.logicalKey)[0]).toBe(2)
    expect(entry.item.identity.contentHash).toBe(algorithm2Hash(loaded.project))
    const noSvg = { project: cloneJson(bundle.project), resources: bundle.resources }; noSvg.project.authoringSources = {}
    expect(JSON.parse((await prepareLibraryEntry(noSvg, entry.item.selector, validation)).item.identity.key)[0]).toBe(1)
  })

  it('binds original SVG bytes even if normalization and real PNG are identical', async () => {
    const validation = artworkValidation(), first = svgProjectFixture(), second = svgProjectFixture(SVG_FIXTURE_SOURCE.replace('><rect', '>\n<rect'))
    const [a, b] = await Promise.all([prepareLibraryEntry(first.bundle, { kind: 'prop', definitionId: 'definition' }, validation), prepareLibraryEntry(second.bundle, { kind: 'prop', definitionId: 'definition' }, validation)])
    expect(first.normalized.normalizedSha256).toBe(second.normalized.normalizedSha256)
    expect(first.bundle.project.assets).toEqual(second.bundle.project.assets)
    expect(a.item.identity.logicalKey).toBe(b.item.identity.logicalKey)
    expect(a.item.identity.contentHash).not.toBe(b.item.identity.contentHash)
    expect(a.item.identity.key).not.toBe(b.item.identity.key)
    const target = fixture(), before = canonicalJson(target.project)
    await expect(adoptLibraryEntries(target, [a, b], validation)).rejects.toThrow(/逻辑/)
    expect(canonicalJson(target.project)).toBe(before)
  })

  it('keeps source/PNG/licence/physical metadata through prepare, neutral ZIP, adoption and offline backup', async () => {
    const validation = artworkValidation(), source = svgProjectFixture(), originalDefinition = source.bundle.project.document.propDefinitions.definition
    source.bundle.project.document.title = 'GM-private map title'
    const entry = await prepareLibraryEntry(source.bundle, { kind: 'prop', definitionId: 'definition' }, validation), files = unzipSync(entry.capsule)
    expect(Object.keys(files).filter(path => path.startsWith('sources/'))).toHaveLength(2)
    expect(decodeUtf8(files['scene.json'])).not.toContain('GM-private map title')
    const capsule = await loadLibraryCapsule(entry, validation)
    expect(capsule.project.document.props).toEqual({}); expect(capsule.project.document.notes).toEqual({})
    expect(capsule.project.authoringSources).toEqual(source.bundle.project.authoringSources)
    expect(capsule.project.document.propDefinitions.definition).toEqual(originalDefinition)
    expect(capsule.project.licenseBindings).toEqual([...source.bundle.project.licenseBindings].sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : 1))
    const organization = { tags: ['阴森'], colors: ['灰' as const], favorite: true }
    const backup = await exportLibraryBackup({ entries: [entry], organizations: { [entry.item.identity.key]: organization } }, validation)
    const restored = await importLibraryBackup(backup, validation)
    expect(restored.organizations[entry.item.identity.key]).toEqual(organization)
    expect(restored.entries[0].item).toEqual(entry.item)
    const target = fixture(), before = canonicalJson(target.project), adopted = await adoptLibraryEntries(target, restored.entries, validation)
    expect(canonicalJson(target.project)).toBe(before)
    expect(adopted.bundle.project.document.props).toEqual(target.project.document.props)
    expect(adopted.bundle.project.document.propDefinitions.definition).toEqual(originalDefinition)
    expect(adopted.bundle.project.document.revision).toBe(target.project.document.revision)
    expect(adopted.bundle.project.historyIdentity).toEqual(target.project.historyIdentity)
    expect((await adoptLibraryEntries(adopted.bundle, [entry], validation)).operationCost).toBe(0)
    const reopened = await importProject(await exportProject(adopted.bundle, validation), validation)
    expect(reopened.project.authoringSources).toEqual(source.bundle.project.authoringSources)
    for (const hash of projectResourceHashes(capsule.project)) expect(await reopened.resources.read(hash)).toEqual(await capsule.resources.read(hash))
  })

  it('selects only the chosen SVG source closure and rejects forged algorithm/source metadata', async () => {
    const validation = artworkValidation(), input = fixture({ image: true })
    input.project.document.props.other = { ...cloneJson(input.project.document.props.item), id: 'other', positionMm: { x: 9000, y: 9000 } }
    Object.assign(input.project, createCompositionContent(input.project.document, runtime))
    const editable = await fromBundle(input, validation), draft = artworkDraft(input, [[{ kind: 'svg', id: 'item', sourceSvg: ARTWORK_SVG, longEdgePx: 16, name: 'First' },
      { kind: 'svg', id: 'other', sourceSvg: ARTWORK_SVG.replace('#2468ac', '#ddee11'), longEdgePx: 16, name: 'Second' }]], { mode: 'range', targetIds: ['item', 'other'], operations: ['svg'], boundsMm: Object.values(input.project.document.floors)[0].boundsMm })
    const output = await materializeAuthoringArtwork(editable, draft, validation), first = output.document.props.item, second = output.document.props.other
    const entry = await prepareLibraryEntry(toBundle(output), { kind: 'prop', definitionId: first.definitionRef!.id }, validation), capsule = await loadLibraryCapsule(entry, validation)
    expect(capsule.project.document.propDefinitions[first.definitionRef!.id]).toBeDefined()
    expect(capsule.project.document.propDefinitions[second.definitionRef!.id]).toBeUndefined()
    const firstSource = first.appearance.kind === 'image' ? output.authoringSources[first.appearance.assetId] : null
    const secondSource = second.appearance.kind === 'image' ? output.authoringSources[second.appearance.assetId] : null
    expect(Object.keys(capsule.project.authoringSources)).toHaveLength(1)
    expect(decodeUtf8(await capsule.resources.read(firstSource!.sourceSha256))).toBe(ARTWORK_SVG)
    await expect(capsule.resources.read(secondSource!.sourceSha256)).rejects.toThrow(/闭包/)
    const forged = cloneJson(entry.item), tuple = JSON.parse(forged.identity.key); tuple[0] = 1
    forged.identity.key = JSON.stringify(tuple); forged.identity.logicalKey = JSON.stringify(tuple.slice(0, 5))
    await expect(validateLibraryEntry({ ...entry, item: forged }, validation)).rejects.toThrow(/不一致/)
  })

  it('retains both SVGs, immutable ancestors and per-member style in a reusable prefab capsule', async () => {
    const validation = artworkValidation(), input = fixture({ image: true })
    input.project.document.props.other = { ...cloneJson(input.project.document.props.item), id: 'other', positionMm: { x: 9000, y: 9000 } }
    Object.assign(input.project, createCompositionContent(input.project.document, runtime))
    const editable = await fromBundle(input, validation), draft = artworkDraft(input, [[{ kind: 'svg', id: 'item', sourceSvg: ARTWORK_SVG, longEdgePx: 16, name: 'First' },
      { kind: 'svg', id: 'other', sourceSvg: ARTWORK_SVG.replace('#2468ac', '#aabbcc'), longEdgePx: 16, name: 'Second' }],
    [{ kind: 'style', ids: ['item', 'other'], brightness: .5, opacity: .8 }]], { mode: 'range', targetIds: ['item', 'other'], operations: ['svg', 'style'], boundsMm: Object.values(input.project.document.floors)[0].boundsMm })
    const styled = await materializeAuthoringArtwork(editable, draft, validation)
    const group = await prepareCompositionCommands(styled, [{ type: 'createPrefab', id: 'art-group', definitionId: 'art-group-definition', name: 'SVG family', ids: ['item', 'other'], anchorMm: { x: 5000, y: 5000 } }], { validation, runtime })
    const entry = await prepareLibraryEntry(toBundle(group), { kind: 'prefab', definitionId: 'art-group-definition' }, validation), capsule = await loadLibraryCapsule(entry, validation)
    expect(JSON.parse(entry.item.identity.key)[0]).toBe(2)
    expect(Object.keys(capsule.project.authoringSources)).toHaveLength(2)
    expect(capsule.project.appearance.prefabAppearanceTemplates['art-group-definition']).toEqual(group.appearance.prefabAppearanceTemplates['art-group-definition'])
    for (const hash of projectResourceHashes(capsule.project)) expect(sha256Bytes(await capsule.resources.read(hash))).toBe(hash)
    expect(capsule.project.document.propDefinitions.definition).toEqual(input.project.document.propDefinitions.definition)
    expect(capsule.project.licenses).toEqual(group.licenses)
    expect((await adoptLibraryEntries(fixture(), [entry], validation)).bundle.project.authoringSources).toEqual(capsule.project.authoringSources)
  })
})
