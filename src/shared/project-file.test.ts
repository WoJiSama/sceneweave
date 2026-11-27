import { createHash } from 'node:crypto'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { fixtureRuntime, layerScene, outdoorProject } from '../../tests/helpers/current-project-fixtures.js'
import { applyCompositionDraftCommands } from './appearance/commands.js'
import { createCompositionContent } from './appearance/graph.js'
import { LANDSCAPE_GROUND_SCATTER_VERSION } from './geometry/scatter-algorithm.js'
import type { SceneDocument } from './model/scene.js'
import type { ProjectBundle } from './model/project.js'
import type { CompleteValidationOptions } from './ports/resources.js'
import { createMemoryResources } from './project/resources.js'
import type { HistoryArchive } from './project/history.js'
import { exportHistoryArchive, exportProject, importHistoryArchive, importProject, importProjectArchive } from './project/file.js'
import { PROJECT_EXTENSIONS_READER_VERSION, PROJECT_LANDSCAPE_READER_VERSION, PROJECT_READER_VERSION, PROJECT_TERRAIN_FINISH_READER_VERSION, PROJECT_REGION_OUTLINE_READER_VERSION,
  PROJECT_WRITER_BUILD, ProjectReaderVersionError } from './project/format.js'
import { captureBytes, crc32, decodeUtf8, sha256Bytes } from './project/binary.js'
import { parseBoundedJson } from './project/json.js'
import { PACKAGE_LIMITS } from './project/limits.js'
import { inspectZip } from './project/zip.js'
import { projectContentHash } from './project/validate.js'
import { canonicalJson, encodeUtf8 } from './validation/json.js'

const options: CompleteValidationOptions = { images: {
  async decode() { throw new Error('symbol-only test must not decode') },
  async transform() { throw new Error('symbol-only test must not transform') },
  async encodePng() { throw new Error('symbol-only test must not encode') },
} }
function fixture(): ProjectBundle {
  const document: SceneDocument = layerScene()
  document.sceneId = 'unified-owner'; document.title = '织境 · ZIP'; document.props.item.visibility = 'gm'
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  let sequence = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `container-token-${++sequence}` }, clock: { now: () => '2026-10-24T00:00:00.000Z' } })
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }, resources: createMemoryResources({}) }
}
function archiveFixture(): HistoryArchive {
  const current = fixture(), historical = fixture()
  historical.project.document.sceneId = 'historical-document-id'; historical.project.document.revision = 7; historical.project.document.title = '旧名称'
  current.project.document.revision = 9
  return { current, snapshots: [{ id: 'snapshot-one', ownerSceneId: current.project.document.sceneId, lineageId: historical.project.historyIdentity.lineageId,
    sourceRevision: 7, name: '保留历史', kind: 'named', createdAt: '2026-10-24T01:00:00.000Z', contentHash: projectContentHash(historical.project), bundle: historical }] }
}
const readJson = (bytes: Uint8Array): Record<string, unknown> => JSON.parse(decodeUtf8(bytes)) as Record<string, unknown>
function modify(bytes: Uint8Array, update: (files: Record<string, Uint8Array>, manifest: Record<string, unknown>) => void): Uint8Array {
  const files: Record<string, Uint8Array> = unzipSync(bytes), manifest = readJson(files['manifest.json'])
  update(files, manifest)
  files['manifest.json'] = encodeUtf8(JSON.stringify(manifest))
  return zipSync(files, { level: 0 })
}
function replaceJson(files: Record<string, Uint8Array>, manifest: Record<string, unknown>, path: string, value: unknown): void {
  const bytes = encodeUtf8(typeof value === 'string' ? value : JSON.stringify(value)); files[path] = bytes
  const entries = manifest.entries as { path: string; sizeBytes: number; sha256: string }[]
  const entry = entries.find(item => item.path === path)!
  entry.sizeBytes = bytes.length; entry.sha256 = sha256Bytes(bytes)
}

describe('complete-v1 native portable container', () => {
  it('round-trips full project with new discriminators and four independently hashed JSON parts', async () => {
    const input = fixture(), bytes = await exportProject(input, options), files = unzipSync(bytes), manifest = readJson(files['manifest.json'])
    expect(Object.keys(files).sort()).toEqual(['appearance.json', 'identity.json', 'manifest.json', 'scene.json', 'sources.json'])
    expect(manifest).toMatchObject({ format: 'sceneweave-complete-project', schemaVersion: 1, packageMode: 'complete', assetRecords: {}, application: 'Sceneweave' })
    expect(manifest).not.toHaveProperty('containerVersion')
    expect(manifest.applicationVersion).toBe(PROJECT_WRITER_BUILD)
    expect(manifest.applicationVersion).not.toBe('development')
    expect(manifest).not.toHaveProperty('minReaderVersion')
    const imported = await importProject(bytes, options)
    expect(imported.project).toEqual(input.project); expect(imported.project).not.toBe(input.project)
    expect(imported.project.document.props.item.visibility).toBe('gm')
    expect(await exportProject(imported, options)).toEqual(bytes)
  })
  it('round-trips selected history while preserving historical document identity and ownerSceneId', async () => {
    const input = archiveFixture(), bytes = await exportHistoryArchive(input, options), archive = await importHistoryArchive(bytes, options)
    expect(archive.current.project).toEqual(input.current.project)
    expect(archive.snapshots[0]).toMatchObject({ ownerSceneId: 'unified-owner', sourceRevision: 7, name: '保留历史' })
    expect(archive.snapshots[0].bundle.project.document.sceneId).toBe('historical-document-id')
    expect(archive.snapshots[0].bundle.project.document.revision).toBe(7)
    const history = readJson(unzipSync(bytes)['history.json'])
    expect(history).toMatchObject({ schemaVersion: 1, current: { sourcesPath: 'sources.json', sourceHashes: [] } })
  })
  it('requires explicit complete/history entry points and never silently strips selected history', async () => {
    const history = await exportHistoryArchive(archiveFixture(), options), complete = await exportProject(fixture(), options)
    await expect(importProject(history, options)).rejects.toThrow(/入口/)
    await expect(importHistoryArchive(complete, options)).rejects.toThrow(/入口/)
    expect((await importProjectArchive(history, options)).snapshots).toHaveLength(1)
    expect((await importProjectArchive(complete, options)).snapshots).toEqual([])
  })
  it('negotiates the reader before opening version-specific payloads and strictly validates a supported minimum', async () => {
    const old = await exportProject(fixture(), options)
    for (const minReaderVersion of [null, 0, '2', 1.5]) {
      await expect(importProjectArchive(modify(old, (_, m) => { m.minReaderVersion = minReaderVersion }), options)).rejects.toThrow(/正整数/)
    }
    const compatible = modify(old, (_, m) => { m.applicationVersion = 'independent-writer'; m.minReaderVersion = 1 })
    expect((await importProject(compatible, options)).project).toEqual(fixture().project)
    const futureHeader = encodeUtf8(JSON.stringify({ format: 'sceneweave-complete-project', schemaVersion: 2, minReaderVersion: 3 }))
    const future = zipSync({ 'manifest.json': futureHeader, 'sections/': new Uint8Array(), 'sections/new-layout.json': encodeUtf8('new reader payload') })
    for (const open of [importProject, importHistoryArchive, importProjectArchive]) {
      await expect(open(future, options)).rejects.toBeInstanceOf(ProjectReaderVersionError)
      await expect(open(modify(old, (_, m) => { m.minReaderVersion = PROJECT_READER_VERSION + 1 }), options)).rejects.toThrow(/更新织境/)
    }
    await expect(importProjectArchive(zipSync({ 'manifest.json': futureHeader, '../bad-path': encodeUtf8('x') }), options)).rejects.toThrow(/不安全路径/)
    await expect(importProject(modify(compatible, (files) => { files['sections/new-layout.json'] = encodeUtf8('extra') }), options)).rejects.toThrow(/路径/)
    await expect(importProject(modify(compatible, (_, m) => { m.extra = true }), options)).rejects.toThrow(/字段/)
  })
  it('requires the landscape reader for a new scatter rule on flat terrain', async () => {
    const { project, resources } = outdoorProject()
    project.document.scatterGroups.scatter.algorithmVersion = LANDSCAPE_GROUND_SCATTER_VERSION
    const input = { project: { ...project, ...createCompositionContent(project.document, fixtureRuntime()) }, resources }
    const bytes = await exportProject(input, options)
    expect(readJson(unzipSync(bytes)['manifest.json']).minReaderVersion).toBe(PROJECT_LANDSCAPE_READER_VERSION)
    expect((await importProject(bytes, options)).project).toEqual(input.project)
    await expect(importProject(modify(bytes, (_, manifest) => { manifest.minReaderVersion = 2 }), options)).rejects.toThrow(/最低读取协议/)
  })
  it('uses the terrain finish reader when the finish occurs only in selected history', async () => {
    const input = archiveFixture(), snapshot = input.snapshots[0], previous = snapshot.bundle.project
    const { document, historyIdentity, appearance } = previous, floorId = Object.keys(document.floors)[0]
    const updated = applyCompositionDraftCommands({ document, historyIdentity, appearance }, [{ type: 'createTerrainArea', id: 'rock-slope', floorId,
      boundaryMm: [{ x: 1000, y: 1000 }, { x: 2500, y: 1000 }, { x: 2500, y: 2500 }, { x: 1000, y: 2500 }],
      relief: { version: 1, rows: 2, columns: 2, offsetsMm: [0, 1500, 0, 1500] }, reliefFinish: 'weathered-v3' }], fixtureRuntime())
    snapshot.bundle.project = { ...previous, ...updated }
    snapshot.sourceRevision = updated.document.revision
    snapshot.contentHash = projectContentHash(snapshot.bundle.project)
    const bytes = await exportHistoryArchive(input, options)
    expect(readJson(unzipSync(bytes)['manifest.json']).minReaderVersion).toBe(PROJECT_TERRAIN_FINISH_READER_VERSION)
    expect((await importHistoryArchive(bytes, options)).snapshots[0].bundle.project).toEqual(snapshot.bundle.project)
    await expect(importHistoryArchive(modify(bytes, (_, m) => { m.minReaderVersion = PROJECT_LANDSCAPE_READER_VERSION }), options))
      .rejects.toThrow(/最低读取协议 v4/)
  })
  it('declares the region outline reader only for projects containing the optional field', async () => {
    const { project, resources } = outdoorProject(), floorId = Object.keys(project.document.floors)[0]
    const commands = [{ type: 'createRegion' as const, id: 'terrain-mark', floorId, kind: 'terrain' as const,
      boundaryMm: [{ x: 1000, y: 1000 }, { x: 2500, y: 1000 }, { x: 2500, y: 2500 }, { x: 1000, y: 2500 }] }]
    const { document, historyIdentity, appearance } = project
    const withRegion = applyCompositionDraftCommands({ document, historyIdentity, appearance }, commands, fixtureRuntime())
    const old = await exportProject({ project: { ...project, ...withRegion }, resources }, options)
    expect(readJson(unzipSync(old)['manifest.json']).minReaderVersion).toBeUndefined()
    expect((await importProject(old, options)).project.document.regions['terrain-mark'].showOutlineInOutput).toBeUndefined()
    const next = applyCompositionDraftCommands(withRegion, [{ type: 'updateRegion', id: 'terrain-mark',
      changes: { showOutlineInOutput: false } }], fixtureRuntime())
    const bytes = await exportProject({ project: { ...project, ...next }, resources }, options)
    expect(readJson(unzipSync(bytes)['manifest.json']).minReaderVersion).toBe(PROJECT_REGION_OUTLINE_READER_VERSION)
    expect((await importProject(bytes, options)).project.document.regions['terrain-mark'].showOutlineInOutput).toBe(false)
    await expect(importProject(modify(bytes, (_, manifest) => { manifest.minReaderVersion = PROJECT_TERRAIN_FINISH_READER_VERSION }), options))
      .rejects.toThrow(/最低读取协议 v5/)
  })
  it('carries opaque private text per project and snapshot, even when only a historical snapshot has extensions', async () => {
    const input = archiveFixture(), snapshot = input.snapshots[0]
    const data = '  { "线索" : "地下室🔑" }\r\n'
    snapshot.bundle.project.extensions = { 'example.org/notes': { schemaVersion: 41, data } }
    snapshot.contentHash = projectContentHash(snapshot.bundle.project)
    const bytes = await exportHistoryArchive(input, options), parts = unzipSync(bytes)
    expect(readJson(parts['manifest.json']).minReaderVersion).toBe(PROJECT_EXTENSIONS_READER_VERSION)
    expect(parts['extensions.json']).toBeUndefined()
    expect(readJson(parts['snapshots/00.extensions.json'])).toEqual(snapshot.bundle.project.extensions)
    const opened = await importHistoryArchive(bytes, options)
    expect(opened.current.project).not.toHaveProperty('extensions')
    expect(opened.snapshots[0].bundle.project).toEqual(snapshot.bundle.project)
    expect(await exportHistoryArchive(opened, options)).toEqual(bytes)
    input.current.project.extensions = { 'other/notes': { schemaVersion: 2, data: '别的内容' } }
    const both = await importProjectArchive(await exportHistoryArchive(input, options), options)
    expect(both.current.project.extensions).toEqual(input.current.project.extensions)
    expect(both.snapshots[0].bundle.project.extensions).toEqual(snapshot.bundle.project.extensions)

    const complete = await exportProject(snapshot.bundle, options)
    expect((await importProject(complete, options)).project.extensions).toEqual(snapshot.bundle.project.extensions)
    await expect(importProject(modify(complete, (_, manifest) => { delete manifest.minReaderVersion }), options)).rejects.toThrow(/最低读取协议/)
    await expect(importProject(modify(complete, files => { files['extensions.json'][2] ^= 1 }), options)).rejects.toThrow(/SHA-256/)
  })
  it('bounds namespace counts, UTF-8 payloads and total serialized bytes and strictly checks each envelope', async () => {
    const project = fixture(), record = { schemaVersion: 1, data: '' }
    for (const extensions of [
      {}, { 'notes': record }, { 'pub/../notes': record }, { 'pub/Notes': record },
      { 'pub/notes': { ...record, schemaVersion: 0 } }, { 'pub/notes': { ...record, run: true } },
      { 'pub/notes': { ...record, data: '\ud800' } }, { 'pub/notes': { ...record, data: '界'.repeat(22000) } },
      Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`pub/p${index}`, record])),
      Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`pub/p${index}`, { ...record, data: 'x'.repeat(65536) }])),
    ]) {
      await expect(exportProject({ ...project, project: { ...project.project, extensions } }, options)).rejects.toThrow(/extensions|扩展/)
    }
  })
  it('captures caller ZIP bytes synchronously before its first asynchronous read', async () => {
    const bytes = await exportProject(fixture(), options), importing = importProject(bytes, options)
    bytes.fill(0)
    expect((await importing).project.document.title).toBe('织境 · ZIP')
  })
  it('rejects old discriminators, unknown fields and mismatched current identities', async () => {
    const bytes = await exportProject(fixture(), options)
    for (const update of [
      (manifest: Record<string, unknown>) => { manifest.format = 'sceneweave-project' },
      (manifest: Record<string, unknown>) => { manifest.schemaVersion = 6 },
      (manifest: Record<string, unknown>) => { manifest.profile = 'm1-outdoor' },
      (manifest: Record<string, unknown>) => { manifest.sceneId = 'other' },
      (manifest: Record<string, unknown>) => { manifest.revision = 300 },
    ]) await expect(importProject(modify(bytes, (_files, manifest) => update(manifest)), options)).rejects.toThrow()
  })
  it('rejects unknown, directory, traversal and nested archive paths before extraction', async () => {
    const bytes = await exportProject(fixture(), options)
    for (const path of ['../scene.json', 'assets/', 'nested.zip', '/scene.json', 'snapshots/64.scene.json']) {
      const files: Record<string, Uint8Array> = unzipSync(bytes); files[path] = encodeUtf8('x')
      await expect(importProject(zipSync(files), options)).rejects.toThrow(/路径/)
    }
  })
  it('rejects missing, undeclared, role-mismatched and duplicate manifest references', async () => {
    const bytes = await exportProject(fixture(), options)
    await expect(importProject(modify(bytes, (files) => { delete files['identity.json'] }), options)).rejects.toThrow()
    await expect(importProject(modify(bytes, (_files, manifest) => { (manifest.entries as unknown[]).pop() }), options)).rejects.toThrow()
    await expect(importProject(modify(bytes, (_files, manifest) => { (manifest.entries as Record<string, unknown>[])[0].role = 'snapshot-scene' }), options)).rejects.toThrow(/角色/)
    await expect(importProject(modify(bytes, (_files, manifest) => { const entries = manifest.entries as unknown[]; entries.push(entries[0]) }), options)).rejects.toThrow(/重复/)
  })
  it('checks actual SHA, local CRC and exact declaration lengths rather than accepting JSON metadata', async () => {
    const bytes = await exportProject(fixture(), options)
    await expect(importProject(modify(bytes, (files) => { files['scene.json'][5] ^= 1 }), options)).rejects.toThrow(/SHA/)
    await expect(importProject(modify(bytes, (_files, manifest) => { (manifest.entries as Record<string, unknown>[])[0].sizeBytes = 999 }), options)).rejects.toThrow(/长度/)
    const stored = zipSync(unzipSync(bytes), { level: 0 }), corrupted = stored.slice()
    const local = new DataView(corrupted.buffer), nameSize = local.getUint16(26, true), extraSize = local.getUint16(28, true)
    corrupted[30 + nameSize + extraSize + 2] ^= 1
    await expect(importProject(corrupted, options)).rejects.toThrow(/CRC/)
  })
  it('rejects duplicate escaped JSON keys, invalid UTF-8 and nonfinite values even with recomputed hashes', async () => {
    const bytes = await exportProject(fixture(), options)
    await expect(importProject(modify(bytes, (files, manifest) => { replaceJson(files, manifest, 'sources.json', '{"x":1,"\\u0078":2}') }), options)).rejects.toThrow(/重复/)
    await expect(importProject(modify(bytes, (files, manifest) => { replaceJson(files, manifest, 'sources.json', '{"x":1e999}') }), options)).rejects.toThrow(/有限/)
    const files: Record<string, Uint8Array> = unzipSync(bytes); files['manifest.json'] = new Uint8Array([0xc0, 0xaf])
    await expect(importProject(zipSync(files), options)).rejects.toThrow(/UTF-8/)
  })
  it('rejects unreferenced history parts and unexpected history source references', async () => {
    const bytes = await exportHistoryArchive(archiveFixture(), options)
    await expect(importHistoryArchive(modify(bytes, (files, manifest) => {
      const history = readJson(files['history.json']); history.snapshots = []
      replaceJson(files, manifest, 'history.json', history)
    }), options)).rejects.toThrow(/未引用/)
    await expect(importHistoryArchive(modify(bytes, (files, manifest) => {
      const history = readJson(files['history.json']); (history.current as Record<string, unknown>).sourceHashes = ['a'.repeat(64)]
      replaceJson(files, manifest, 'history.json', history)
    }), options)).rejects.toThrow(/SVG/)
  })
  it('checks history exact paths, current binding agreement and full snapshot content hashes', async () => {
    const bytes = await exportHistoryArchive(archiveFixture(), options)
    await expect(importHistoryArchive(modify(bytes, (files, manifest) => {
      const history = readJson(files['history.json']); ((history.snapshots as Record<string, unknown>[])[0]).scenePath = 'scene.json'
      replaceJson(files, manifest, 'history.json', history)
    }), options)).rejects.toThrow(/路径/)
    await expect(importHistoryArchive(modify(bytes, (files, manifest) => {
      const history = readJson(files['history.json']); ((history.snapshots as Record<string, unknown>[])[0].summary as Record<string, unknown>).contentHash = 'a'.repeat(64)
      replaceJson(files, manifest, 'history.json', history)
    }), options)).rejects.toThrow(/hash/)
  })
  it('rejects unreferenced SVG entries and unmatched asset descriptors', async () => {
    const bytes = await exportProject(fixture(), options)
    await expect(importProject(modify(bytes, (files, manifest) => {
      const value = encodeUtf8('<svg/>'), hash = sha256Bytes(value), path = `sources/${hash}.svg`
      files[path] = value; (manifest.entries as unknown[]).push({ path, role: 'source', sha256: hash, sizeBytes: value.length, mimeType: 'image/svg+xml' })
    }), options)).rejects.toThrow(/SVG/)
    await expect(importProject(modify(bytes, (_files, manifest) => {
      const hash = 'b'.repeat(64)
      manifest.assetRecords = { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: 20, pixelWidth: 1, pixelHeight: 1 } }
    }), options)).rejects.toThrow(/图片描述/)
  })
  it('honors cancellation without returning output and preserves input project on validation failures', async () => {
    const input = fixture(), previous = canonicalJson(input.project), signal = { aborted: true }
    await expect(exportProject(input, { ...options, signal })).rejects.toMatchObject({ name: 'AbortError' })
    const bytes = await exportProject(input, options)
    await expect(importProject(bytes, { ...options, signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(canonicalJson(input.project)).toBe(previous)
  })
})

describe('bounded binary readers', () => {
  it('uses native byte capture and fatal UTF-8 with complete SHA vectors', () => {
    for (const bytes of [new Uint8Array(), encodeUtf8('织境🪨'), Uint8Array.from({ length: 100_000 }, (_, i) => i % 256)]) expect(sha256Bytes(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(crc32(encodeUtf8('123456789'))).toBe(0xcbf43926)
    for (const text of ['', '织境', 'a🪨b', '\ufefflicense']) expect(decodeUtf8(encodeUtf8(text))).toBe(text)
    for (const bytes of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe4, 0xb8]]) expect(() => decodeUtf8(Uint8Array.from(bytes))).toThrow()
    expect(() => captureBytes(new Uint8Array(16), 15)).toThrow(/预算/)
    const bytes = encodeUtf8('bytes'), copy = captureBytes(bytes); bytes[0] = 0; expect(decodeUtf8(copy)).toBe('bytes')
    let calls = 0; Object.defineProperty(bytes, 'buffer', { get() { calls++; throw new Error('getter') } })
    expect(captureBytes(bytes).length).toBe(5); expect(calls).toBe(0)
  })
  it('enforces JSON cumulative values, depth, exact grammar and duplicate decoded names', () => {
    const budget = { values: PACKAGE_LIMITS.jsonValues - 1 }
    expect(parseBoundedJson(encodeUtf8('null'), budget)).toBe(null)
    expect(() => parseBoundedJson(encodeUtf8('null'), budget)).toThrow(/累计/)
    for (const text of ['{"a":1,"\\u0061":2}', '[1,]', '{"a":undefined}', '0 garbage', '['.repeat(130) + '0' + ']'.repeat(130)]) expect(() => parseBoundedJson(encodeUtf8(text))).toThrow()
  })
  it('rejects directory declarations over limits before resource inflation and forbids repeated inflation', async () => {
    const bytes = await exportProject(fixture(), options), zip = inspectZip(bytes)
    await zip.read('scene.json'); await expect(zip.read('scene.json')).rejects.toThrow(/重复/)
    const stored = zipSync(unzipSync(bytes), { level: 0 }), changed = stored.slice(), view = new DataView(changed.buffer)
    let central = 0
    while (central + 4 < changed.length && view.getUint32(central, true) !== 0x02014b50) central++
    view.setUint32(central + 24, PACKAGE_LIMITS.sceneBytes + 1, true)
    expect(() => inspectZip(changed)).toThrow(/预算/)
  })
})
