import { zipSync, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { assertBackupReceipt, exportMigrationSet, importMigrationSet } from './migration/set.js'
import type { MigrationSetFiles, MigrationSetIndex, MigrationSetInput } from './migration/set.js'
import { MIGRATION_SET_LIMITS } from './migration/set-limits.js'
import { captureBytes, decodeUtf8, sha256Bytes } from './project/binary.js'
import { encodeUtf8 } from './validation/json.js'

const hash = (text: string) => sha256Bytes(encodeUtf8(text))
function fixture(): MigrationSetInput {
  const bytes = encodeUtf8('{"exact":"字段值","revision":7}')
  return { setId: 'set-one', createdAt: '2026-10-24T00:00:00.000Z', converterVersion: 'm20-converter-1',
    scope: { kind: 'project-family', repository: 'sceneweave-m1-outdoor', sourceSceneId: 'old-owner' }, sourceFingerprint: hash('all-source-rows'),
    records: [
      { role: 'current', recordKey: 'current-old-owner', sourceFormat: 'sceneweave-project@6', contentHash: hash('semantic-current'), bytes },
      { role: 'named', recordKey: 'named-one', sourceFormat: 'sceneweave-project@6', contentHash: hash('semantic-current'), bytes: bytes.slice() },
      { role: 'legacy-blob', recordKey: 'original-zip', sourceFormat: 'sceneweave-project@5', contentHash: hash('old-zip-content'), bytes: new Uint8Array([80, 75, 0, 255, 1, 100]) },
    ] }
}
const indexOf = (files: MigrationSetFiles) => JSON.parse(decodeUtf8(files.index)) as MigrationSetIndex
function updateIndex(files: MigrationSetFiles, update: (index: MigrationSetIndex) => void): MigrationSetFiles {
  const index = indexOf(files); update(index)
  return { index: encodeUtf8(JSON.stringify(index)), volumes: new Map(files.volumes) }
}
function updateVolume(files: MigrationSetFiles, update: (contents: Record<string, Uint8Array>, manifest: Record<string, unknown>) => void): MigrationSetFiles {
  const index = indexOf(files), descriptor = index.volumes[0], contents: Record<string, Uint8Array> = unzipSync(files.volumes.get(descriptor.path)!)
  const manifest = JSON.parse(decodeUtf8(contents['volume.json'])) as Record<string, unknown>
  update(contents, manifest); contents['volume.json'] = encodeUtf8(JSON.stringify(manifest))
  const bytes = zipSync(contents, { level: 0 }); descriptor.sizeBytes = bytes.length; descriptor.sha256 = sha256Bytes(bytes)
  const volumes = new Map(files.volumes); volumes.set(descriptor.path, bytes)
  return { index: encodeUtf8(JSON.stringify(index)), volumes }
}
const reading = (files: MigrationSetFiles, signal?: { aborted: boolean }) => importMigrationSet(files.index, files.volumes, signal)

describe('migration set complete reread and unforgeable receipt', () => {
  it('preserves binary data, roles and semantic hashes while deduplicating exact bytes', async () => {
    const input = fixture(), files = await exportMigrationSet(input), index = indexOf(files), imported = await reading(files)
    expect(Object.keys(index).sort()).toEqual(['complete', 'converterVersion', 'createdAt', 'format', 'records', 'schemaVersion', 'scope', 'setId', 'sourceFingerprint', 'volumes'].sort())
    expect(index.records[0].parts).toEqual(index.records[1].parts)
    expect(index.records[0].rawSha256).toBe(sha256Bytes(input.records[0].bytes))
    expect(index.records[0].contentHash).toBe(hash('semantic-current'))
    for (const [i, record] of imported.records.entries()) expect(record.bytes).toEqual(input.records[i].bytes)
    const contents = unzipSync(files.volumes.values().next().value!)
    expect(Object.keys(contents)).toHaveLength(3)
    expect(assertBackupReceipt(imported.receipt, { setId: input.setId, sourceFingerprint: input.sourceFingerprint, indexHash: sha256Bytes(files.index) })).toMatchObject({ volumeHashes: index.volumes.map(volume => ({ path: volume.path, sha256: volume.sha256 })) })
    expect(files).not.toHaveProperty('receipt')
  })
  it('preserves a catalog with organization-only entries and exact installation metadata', async () => {
    const input = fixture(); input.scope = { kind: 'catalog', repository: 'sceneweave-personal-library', sourceSceneId: null }
    input.records = [
      { role: 'catalog-metadata', recordKey: 'state', sourceFormat: 'catalog@1', contentHash: hash('state'), bytes: encodeUtf8('{"revision":14,"installed":[]}') },
      { role: 'catalog-organization', recordKey: 'not-installed', sourceFormat: 'catalog@1', contentHash: hash('organization'), bytes: encodeUtf8('{"tags":["先后","Ａ"],"colors":["red","blue"],"favorite":true}') },
    ]
    const recovered = await reading(await exportMigrationSet(input))
    expect(recovered.manifest.scope).toEqual(input.scope)
    expect(recovered.records.map(record => decodeUtf8(record.bytes))).toEqual(input.records.map(record => decodeUtf8(record.bytes)))
  })
  it('captures caller bytes before asynchronous work and returns independent role bytes', async () => {
    const input = fixture(), exact = input.records[0].bytes.slice(), pending = exportMigrationSet(input)
    input.records[0].bytes.fill(0); input.scope.repository = 'changed'
    const files = await pending, importing = reading(files)
    files.index.fill(0); for (const bytes of files.volumes.values()) bytes.fill(0)
    const recovered = await importing
    expect(recovered.manifest.scope.repository).toBe('sceneweave-m1-outdoor'); expect(recovered.records[0].bytes).toEqual(exact)
    recovered.records[0].bytes.fill(1); expect(recovered.records[1].bytes).toEqual(exact)
  })
  it('never trusts JSON clones, another set or a changed fingerprint as receipt proof', async () => {
    const input = fixture(), recovered = await reading(await exportMigrationSet(input)), expected = { sourceFingerprint: input.sourceFingerprint }
    expect(() => assertBackupReceipt(JSON.parse(JSON.stringify(recovered.receipt)), expected)).toThrow(/backupReceipt/)
    expect(() => assertBackupReceipt({ ...recovered.receipt }, expected)).toThrow(/backupReceipt/)
    expect(() => assertBackupReceipt(recovered.receipt, { ...expected, setId: 'other-set' })).toThrow(/backupReceipt/)
    expect(() => assertBackupReceipt(recovered.receipt, { sourceFingerprint: hash('changed-history') })).toThrow(/backupReceipt/)
    expect(Object.isFrozen(recovered.receipt)).toBe(true)
  })
  it('preserves different raw originals despite equal semantic hashes and accepts empty opaque bytes', async () => {
    const input = fixture(); input.records[1].bytes = encodeUtf8('{ "exact" : "字段值", "revision" : 7 }'); input.records[2].bytes = new Uint8Array()
    const files = await exportMigrationSet(input), index = indexOf(files), recovered = await reading(files)
    expect(index.records[0].contentHash).toBe(index.records[1].contentHash)
    expect(index.records[0].rawSha256).not.toBe(index.records[1].rawSha256)
    expect(index.records[2].parts).toEqual([]); expect(recovered.records[2].bytes).toHaveLength(0)
  })
  it('rejects duplicate role keys, invalid scopes and accessors without invoking them', async () => {
    const input = fixture(); input.records[1] = { ...input.records[0] }
    await expect(exportMigrationSet(input)).rejects.toThrow(/重复/)
    const invalid = fixture(); invalid.scope.sourceSceneId = null
    await expect(exportMigrationSet(invalid)).rejects.toThrow()
    const accessor = fixture(); let calls = 0
    Object.defineProperty(accessor.records[0], 'bytes', { enumerable: true, get: () => { calls++; return new Uint8Array() } })
    await expect(exportMigrationSet(accessor)).rejects.toThrow(/访问器/); expect(calls).toBe(0)
    const hidden = fixture(); Object.defineProperty(hidden.records, 'extra', { value: true })
    await expect(exportMigrationSet(hidden)).rejects.toThrow(/数组/)
  })
  it('rejects incomplete indexes, extra fields, duplicate JSON keys, hostile paths and count limits', async () => {
    const files = await exportMigrationSet(fixture())
    for (const change of [
      (index: MigrationSetIndex) => { (index as unknown as { complete: boolean }).complete = false },
      (index: MigrationSetIndex) => { Object.assign(index, { trusted: true }) },
      (index: MigrationSetIndex) => { index.volumes[0].path = 'https://example.invalid/part' },
      (index: MigrationSetIndex) => { index.volumes[0].path = '../part-0000.sceneweave-migration-part' },
      (index: MigrationSetIndex) => { index.volumes = Array.from({ length: 513 }, () => index.volumes[0]) },
    ]) await expect(reading(updateIndex(files, change))).rejects.toThrow()
    const duplicate = encodeUtf8(decodeUtf8(files.index).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'))
    await expect(importMigrationSet(duplicate, files.volumes)).rejects.toThrow(/重复/)
    await expect(importMigrationSet(new Uint8Array(MIGRATION_SET_LIMITS.indexBytes + 1), files.volumes)).rejects.toThrow(/预算/)
  })
  it('requires all and only declared volumes with exact actual sizes and hashes', async () => {
    const files = await exportMigrationSet(fixture())
    await expect(importMigrationSet(files.index, new Map())).rejects.toThrow(/缺少/)
    const extra = new Map(files.volumes); extra.set('part-0001.sceneweave-migration-part', new Uint8Array([1]))
    await expect(importMigrationSet(files.index, extra)).rejects.toThrow(/未声明/)
    const corrupt = new Map(files.volumes); corrupt.values().next().value![40] ^= 1
    await expect(importMigrationSet(files.index, corrupt)).rejects.toThrow(/SHA256/)
    await expect(reading(updateIndex(await exportMigrationSet(fixture()), index => { index.volumes[0].sizeBytes++ }))).rejects.toThrow(/长度/)
  })
  it('checks reconstructed total hash and exact part coverage including offsets and lengths', async () => {
    const files = await exportMigrationSet(fixture())
    for (const change of [
      (index: MigrationSetIndex) => { index.records[0].rawSha256 = hash('false-original') },
      (index: MigrationSetIndex) => { index.records[0].parts[0].offset = 1 },
      (index: MigrationSetIndex) => { index.records[0].parts.push({ ...index.records[0].parts[0] }) },
      (index: MigrationSetIndex) => { index.records[0].parts[0].length-- },
      (index: MigrationSetIndex) => { index.records[0].parts[0].volume = 'part-0001.sceneweave-migration-part' },
    ]) await expect(reading(updateIndex(files, change))).rejects.toThrow()
  })
  it('checks ZIP paths and exact manifest/chunk membership independently from outer volume hashes', async () => {
    const files = await exportMigrationSet(fixture())
    for (const path of ['../bad.bin', '/chunks/bad.bin', 'nested.zip', 'chunks/', 'https://example.invalid/a']) {
      await expect(reading(updateVolume(files, contents => { contents[path] = new Uint8Array([1]) }))).rejects.toThrow(/路径/)
    }
    await expect(reading(updateVolume(files, (contents, manifest) => { delete contents[(manifest.entries as { path: string }[])[0].path] }))).rejects.toThrow()
    await expect(reading(updateVolume(files, (contents, manifest) => { const entry = (manifest.entries as { path: string }[])[0]; contents[entry.path] = new Uint8Array([7]) }))).rejects.toThrow(/长度|SHA256/)
    await expect(reading(updateVolume(files, (_contents, manifest) => { (manifest.entries as unknown[]).push((manifest.entries as unknown[])[0]) }))).rejects.toThrow()
  })
  it('checks each volume set identity, number and exact fields', async () => {
    const files = await exportMigrationSet(fixture())
    for (const change of [
      (manifest: Record<string, unknown>) => { manifest.setId = 'another-set' },
      (manifest: Record<string, unknown>) => { manifest.index = 1 },
      (manifest: Record<string, unknown>) => { manifest.executable = true },
    ]) await expect(reading(updateVolume(files, (_contents, manifest) => change(manifest)))).rejects.toThrow()
  })
  it('rejects ZIP local/central inconsistencies and actual CRC errors even with a matching outer hash', async () => {
    const files = await exportMigrationSet(fixture()), descriptor = indexOf(files).volumes[0], bytes = captureBytes(files.volumes.get(descriptor.path)!)
    const view = new DataView(bytes.buffer), firstData = 30 + view.getUint16(26, true) + view.getUint16(28, true)
    bytes[firstData] ^= 1
    const index = indexOf(files); index.volumes[0].sha256 = sha256Bytes(bytes)
    await expect(importMigrationSet(encodeUtf8(JSON.stringify(index)), new Map([[descriptor.path, bytes]]))).rejects.toThrow(/CRC/)
    const local = captureBytes(files.volumes.get(descriptor.path)!); new DataView(local.buffer).setUint32(18, 1, true)
    index.volumes[0].sha256 = sha256Bytes(local)
    await expect(importMigrationSet(encodeUtf8(JSON.stringify(index)), new Map([[descriptor.path, local]]))).rejects.toThrow(/不一致/)
  })
  it('cancellation before or during reread never returns a usable receipt', async () => {
    const input = fixture(), files = await exportMigrationSet(input)
    await expect(exportMigrationSet(input, { aborted: true })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(importMigrationSet(files.index, files.volumes, { aborted: true })).rejects.toMatchObject({ name: 'AbortError' })
    const signal = { aborted: false }, pending = reading(files, signal); signal.aborted = true
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('splits large originals into bounded chunks and bounded volumes then verifies every byte', async () => {
    const input = fixture(), bytes = new Uint8Array(32 * 1024 * 1024 + 7)
    for (let i = 0; i < bytes.length; i += MIGRATION_SET_LIMITS.chunkBytes) bytes.fill(1 + i / MIGRATION_SET_LIMITS.chunkBytes, i, Math.min(bytes.length, i + MIGRATION_SET_LIMITS.chunkBytes))
    input.records = [{ ...input.records[0], bytes }]
    const files = await exportMigrationSet(input), index = indexOf(files)
    expect(index.volumes).toHaveLength(2); expect(index.records[0].parts).toHaveLength(5)
    expect(index.records[0].parts.every(part => part.length <= MIGRATION_SET_LIMITS.chunkBytes)).toBe(true)
    for (const volume of files.volumes.values()) expect(Object.values(unzipSync(volume)).reduce((sum, value) => sum + value.length, 0)).toBeLessThanOrEqual(MIGRATION_SET_LIMITS.expandedBytes)
    const recovered = await reading(files)
    expect(recovered.records[0].rawSha256).toBe(sha256Bytes(bytes)); expect(recovered.records[0].bytes.length).toBe(bytes.length)
    expect(recovered.records[0].bytes.every((value, index) => value === bytes[index])).toBe(true)
  }, 30_000)
})
