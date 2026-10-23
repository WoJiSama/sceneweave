import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { version as applicationVersion } from '../../../package.json'
import { exportProjectV3, importProjectV3 } from '../v3/project-file'
import { sha256Bytes } from '../v3/resources'
import { imageProject as imageV3 } from '../v3/test-fixtures'
import { migrateProjectV3ToV4 } from './migration'
import { exportHistoryArchiveV4, exportProjectV4, importHistoryArchiveV4, importProjectV4, inspectPackageModeV4, inspectProjectVersionV4,
  projectContentHashV4, validateCompleteProjectV4, validateHistoryArchiveV4 } from './project-file'
import { emptyProject, imageProject, namedSnapshot, revision } from './test-fixtures'

const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const blob = (bytes: Uint8Array) => new Blob([bytes.slice().buffer], { type: 'application/x-sceneweave' })
async function unpack() { return unzipSync(new Uint8Array(await (await exportProjectV4(await imageProject())).arrayBuffer())) }
async function manifestChange(change: (manifest: Record<string, unknown>) => void): Promise<Blob> {
  const files = await unpack(), manifest = JSON.parse(decode(files['manifest.json']))
  change(manifest); files['manifest.json'] = encode(JSON.stringify(manifest)); return blob(zipSync(files))
}
async function replaceFile(files: Record<string, Uint8Array>, path: string, bytes: Uint8Array): Promise<void> {
  files[path] = bytes
  const manifest = JSON.parse(decode(files['manifest.json'])) as { entries: { path: string; sizeBytes: number; sha256: string }[] }
  const entry = manifest.entries.find(item => item.path === path)!
  entry.sizeBytes = bytes.length; entry.sha256 = await sha256Bytes(bytes)
  files['manifest.json'] = encode(JSON.stringify(manifest))
}
beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('strict v4 complete and selected-history packages', () => {
  it('roundtrips the intact v3 scene, complete resources and independent history identity', async () => {
    const input = revision(await imageProject(), 9), file = await exportProjectV4(input), output = await importProjectV4(file)
    expect(output.document).toEqual(input.document); expect(output.document.schemaVersion).toBe(3)
    expect(output.historyIdentity).toEqual(input.historyIdentity); expect(output.licenses).toEqual(input.licenses); expect(output.licenseBindings).toEqual(input.licenseBindings)
    const hash = Object.keys(input.assets)[0]
    expect(await output.assets[hash].blob.arrayBuffer()).toEqual(await input.assets[hash].blob.arrayBuffer())
    const files = unzipSync(new Uint8Array(await file.arrayBuffer())), manifest = JSON.parse(decode(files['manifest.json']))
    expect(manifest).toMatchObject({ containerVersion: 4, documentSchemaVersion: 3, profile: 'm1-history', packageMode: 'complete', applicationVersion })
    expect(decode(files['scene.json'])).not.toContain('historyIdentity')
    expect(await inspectProjectVersionV4(file)).toBe(4); expect(await inspectPackageModeV4(file)).toBe('complete')
    expect(await inspectProjectVersionV4(await exportProjectV3(await imageV3()))).toBe(3)
    await expect(importProjectV3(file)).rejects.toThrow()
  })

  it('preserves selected historical resources absent from current content and deduplicates the union', async () => {
    const initial = await imageProject(), first = await namedSnapshot(initial, 'first'), second = await namedSnapshot(initial, 'second', 'protection'), current = revision(initial, 3)
    current.document.assets = {}; current.document.materials = {}; current.assets = {}; current.licenses = {}; current.licenseBindings = []
    const file = await exportHistoryArchiveV4({ project: current, snapshots: [first, second] }), output = await importHistoryArchiveV4(file)
    expect(output.project.document).toEqual(current.document); expect(output.project.assets).toEqual({})
    expect(output.snapshots.map(value => value.id)).toEqual(['first', 'second'])
    expect(output.snapshots[0].project.document).toEqual(initial.document); expect(output.snapshots[1].contentHash).toBe(second.contentHash)
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
    expect(Object.keys(files).filter(path => path.startsWith('assets/'))).toHaveLength(1)
    expect(Object.keys(files).filter(path => path.startsWith('licenses/'))).toHaveLength(1)
    const hash = Object.keys(initial.assets)[0]
    expect(await output.snapshots[0].project.assets[hash].blob.arrayBuffer()).toEqual(await initial.assets[hash].blob.arrayBuffer())
    expect(await inspectPackageModeV4(file)).toBe('history')
  })

  it('requires the explicit import entry point instead of dropping snapshots or inventing history', async () => {
    const project = emptyProject(), history = await exportHistoryArchiveV4({ project, snapshots: [await namedSnapshot(project)] })
    await expect(importProjectV4(history)).rejects.toThrow('历史')
    await expect(importHistoryArchiveV4(await exportProjectV4(project))).rejects.toThrow('历史备份')
    expect((await importHistoryArchiveV4(await exportHistoryArchiveV4({ project, snapshots: [] }))).snapshots).toEqual([])
  })

  it('keeps local migration originals out of complete and history packages', async () => {
    const migrated = await migrateProjectV3ToV4(await imageV3()), snapshot = await namedSnapshot(migrated)
    for (const file of [await exportProjectV4(migrated), await exportHistoryArchiveV4({ project: migrated, snapshots: [snapshot] })]) {
      const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
      expect(Object.keys(files).some(path => path.includes('original') || path.includes('migration'))).toBe(false)
      expect(Object.values(files).filter(bytes => bytes[0] === 123).map(decode).join('')).not.toContain('sourceHash')
    }
    expect((await importProjectV4(await exportProjectV4(migrated))).migrationSource).toBeUndefined()
    const read = await importHistoryArchiveV4(await exportHistoryArchiveV4({ project: migrated, snapshots: [snapshot] }))
    expect(read.project.migrationSource).toBeUndefined(); expect(read.snapshots[0].project.migrationSource).toBeUndefined()
  })

  it('merges historical allocated tombstones into current content without mutating either caller', async () => {
    const project = emptyProject(), historic = structuredClone(project)
    historic.historyIdentity.propTokens['deleted-after-history'] = 'historic-birth-token'
    const snapshot = await namedSnapshot(historic), input = { project, snapshots: [snapshot] }, before = structuredClone(input)
    const archive = await validateHistoryArchiveV4(input)
    expect(archive.project.historyIdentity.propTokens['deleted-after-history']).toBe('historic-birth-token')
    expect(input).toEqual(before); expect(archive.snapshots[0].contentHash).toBe(snapshot.contentHash)
    expect(await projectContentHashV4(archive.snapshots[0].project)).toBe(snapshot.contentHash)
  })

  it('rejects lineage, birth-token, token-alias and live entity collisions', async () => {
    const project = emptyProject(), historic = structuredClone(project), propId = Object.keys(project.document.props)[0]
    historic.historyIdentity.lineageId = 'other-lineage'
    await expect(validateHistoryArchiveV4({ project, snapshots: [await namedSnapshot(historic)] })).rejects.toThrow('lineage')
    historic.historyIdentity.lineageId = project.historyIdentity.lineageId; historic.historyIdentity.propTokens[propId] = 'changed-birth-token'
    await expect(validateHistoryArchiveV4({ project, snapshots: [await namedSnapshot(historic)] })).rejects.toThrow('身份冲突')
    const alias = structuredClone(project); alias.historyIdentity.propTokens.alias = project.historyIdentity.propTokens[propId]
    await expect(validateCompleteProjectV4(alias)).rejects.toThrow('唯一')
    const old = structuredClone(project); old.historyIdentity.propTokens['future-layer'] = 'old-prop-token'
    const current = structuredClone(project), layer = Object.values(current.document.userLayers)[0]
    current.document.userLayers['future-layer'] = { ...layer, id: 'future-layer', name: 'Later layer', order: 1 }
    await expect(validateHistoryArchiveV4({ project: current, snapshots: [await namedSnapshot(old)] })).rejects.toThrow('身份冲突')
  })

  it('rejects missing live tokens, unknown identity fields and unexpected project metadata', async () => {
    const project = emptyProject(), missing = structuredClone(project); delete missing.historyIdentity.propTokens[Object.keys(project.document.props)[0]]
    await expect(validateCompleteProjectV4(missing)).rejects.toThrow('缺少已分配身份')
    await expect(validateCompleteProjectV4({ ...project, unsupported: true } as never)).rejects.toThrow('字段')
    await expect(validateCompleteProjectV4({ ...project, historyIdentity: { ...project.historyIdentity, unknown: true } } as never)).rejects.toThrow('历史身份无效')
  })

  it('rejects tampered immutable snapshot hashes, source revisions, ownership and duplicate IDs', async () => {
    const project = emptyProject(), snapshot = await namedSnapshot(project)
    for (const changed of [{ ...snapshot, contentHash: '0'.repeat(64) }, { ...snapshot, sourceRevision: 1 }, { ...snapshot, sceneId: 'other-owner' }]) {
      await expect(validateHistoryArchiveV4({ project, snapshots: [changed] })).rejects.toThrow()
    }
    await expect(validateHistoryArchiveV4({ project, snapshots: [snapshot, snapshot] })).rejects.toThrow('ID重复')
    await expect(validateHistoryArchiveV4({ project, snapshots: [{ ...snapshot, unexpected: true }] } as never)).rejects.toThrow('字段')
  })

  it('bounds named and protection counts separately, including direct archive validation', async () => {
    const project = emptyProject(), snapshot = await namedSnapshot(project)
    const snapshots = Array.from({ length: 33 }, (_, index) => ({ ...snapshot, id: `snapshot-${index}` }))
    await expect(validateHistoryArchiveV4({ project, snapshots })).rejects.toThrow('各32份')
    await expect(validateHistoryArchiveV4({ project, snapshots: snapshots.map(value => ({ ...value, kind: 'protection' as const })) })).rejects.toThrow('各32份')
    await expect(validateHistoryArchiveV4({ project, snapshots: Array.from({ length: 65 }, (_, index) => ({ ...snapshot, id: `snapshot-${index}` })) })).rejects.toThrow('64份')
  })

  // This exercises the fixed node budget; elapsed time is not a performance assertion.
  it('enforces cumulative JSON nodes across individually valid selected snapshots', async () => {
    const project = emptyProject()
    for (let index = 0; index < 50_000; index++) project.historyIdentity.propTokens[`allocated-${index}`] = `token-${index}`
    await validateCompleteProjectV4(project)
    const snapshot = await namedSnapshot(project), snapshots = Array.from({ length: 12 }, (_, index) => ({ ...snapshot, id: `json-${index}` }))
    await expect(validateHistoryArchiveV4({ project, snapshots })).rejects.toThrow('累计节点')
  }, 60_000)

  it('accepts eighty Unicode characters as a name and rejects blanks or longer names', async () => {
    const project = emptyProject(), snapshot = await namedSnapshot(project)
    snapshot.name = '🌳'.repeat(80)
    expect((await validateHistoryArchiveV4({ project, snapshots: [snapshot] })).snapshots[0].name).toBe(snapshot.name)
    snapshot.name += '🌳'; await expect(validateHistoryArchiveV4({ project, snapshots: [snapshot] })).rejects.toThrow('摘要')
    snapshot.name = '  '; await expect(validateHistoryArchiveV4({ project, snapshots: [snapshot] })).rejects.toThrow('摘要')
  })

  it('requires complete bytes and licenses for every selected snapshot', async () => {
    const project = await imageProject(), snapshot = await namedSnapshot(project), hash = Object.keys(project.assets)[0]
    delete snapshot.project.assets[hash]
    await expect(exportHistoryArchiveV4({ project, snapshots: [snapshot] })).rejects.toThrow('依赖缺失')
    const incomplete = structuredClone(project); incomplete.licenseBindings = []
    await expect(exportProjectV4(incomplete)).rejects.toThrow('缺少许可绑定')
  })

  it('rejects unknown versions, fields, roles, paths, package modes and manifest identity mismatches', async () => {
    for (const change of [
      (manifest: Record<string, unknown>) => { manifest.containerVersion = 5 },
      (manifest: Record<string, unknown>) => { manifest.profile = 'm1-layers' },
      (manifest: Record<string, unknown>) => { manifest.packageMode = 'references' },
      (manifest: Record<string, unknown>) => { manifest.unknown = true },
      (manifest: Record<string, unknown>) => { manifest.revision = 99 },
      (manifest: Record<string, unknown>) => { (manifest.entries as { role: string }[])[0].role = 'identity' },
      (manifest: Record<string, unknown>) => { (manifest.entries as { path: string }[])[0].path = '../scene.json' },
    ]) await expect(importProjectV4(await manifestChange(change))).rejects.toThrow()
  })

  it('rejects undeclared paths and byte/hash damage before any image decode', async () => {
    const files = await unpack(), decoder = vi.mocked(createImageBitmap); decoder.mockClear()
    files['extra.txt'] = encode('extra'); await expect(importProjectV4(blob(zipSync(files)))).rejects.toThrow('路径'); delete files['extra.txt']
    const path = Object.keys(files).find(item => item.startsWith('assets/'))!
    files[path][20] ^= 1
    await expect(importProjectV4(blob(zipSync(files)))).rejects.toThrow('SHA-256'); expect(decoder).not.toHaveBeenCalled()
  })

  it('rejects duplicate decoded JSON keys even with updated manifest hashes and ZIP CRC', async () => {
    const files = await unpack()
    await replaceFile(files, 'identity.json', encode(decode(files['identity.json']).replace('"version":1', '"version":1,"\\u0076ersion":1')))
    await expect(importProjectV4(blob(zipSync(files)))).rejects.toThrow('重复字段')
  })

  it('refuses history paths that disagree with the explicit index or reference undeclared resources', async () => {
    const project = await imageProject(), file = await exportHistoryArchiveV4({ project, snapshots: [await namedSnapshot(project)] })
    for (const variant of ['path', 'resource', 'hash'] as const) {
      const files = unzipSync(new Uint8Array(await file.arrayBuffer())), index = JSON.parse(decode(files['history.json']))
      if (variant === 'path') index.snapshots[0].scenePath = 'scene.json'
      else if (variant === 'resource') index.snapshots[0].assetHashes.push('0'.repeat(64))
      else index.snapshots[0].summary.contentHash = '0'.repeat(64)
      await replaceFile(files, 'history.json', encode(JSON.stringify(index)))
      await expect(importHistoryArchiveV4(blob(zipSync(files)))).rejects.toThrow(variant === 'path' ? '路径' : variant === 'resource' ? '绑定缺失' : 'hash不匹配')
    }
  })

  it('checks local/central names and stored CRC rather than trusting valid manifests', async () => {
    const stored = zipSync(await unpack(), { level: 0 }), view = new DataView(stored.buffer)
    stored[30 + view.getUint16(26, true) + view.getUint16(28, true)] ^= 1
    await expect(importProjectV4(blob(stored))).rejects.toThrow('CRC')
    const renamed = zipSync(await unpack(), { level: 0 }); renamed[30] ^= 1
    await expect(importProjectV4(blob(renamed))).rejects.toThrow('本地路径')
  })

  it('captures its writer input before asynchronous validation and keeps cancellation distinct', async () => {
    const input = await imageProject(), before = structuredClone(input), exporting = exportProjectV4(input)
    input.document.title = 'mutated during export'; input.historyIdentity.lineageId = 'mutated during export'
    const file = await exporting
    expect((await importProjectV4(file)).document).toEqual(before.document)
    const controller = new AbortController(); controller.abort()
    await expect(exportProjectV4(before, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(importProjectV4(file, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
