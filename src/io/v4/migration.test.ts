import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { emptyProject as emptyV2 } from '../v2/test-fixtures'
import { sha256Bytes } from '../v3/resources'
import { createLayerProject } from '../v3/migration'
import { exportProjectV3 } from '../v3/project-file'
import { imageProject as imageV3 } from '../v3/test-fixtures'
import { HISTORY_MIGRATOR_VERSION_V4, migrateProjectV3ToV4, migrationOriginalV4, validateMigrationSourceV4 } from './migration'
import { exportHistoryArchiveV4, importHistoryArchiveV4 } from './project-file'
import { namedSnapshot } from './test-fixtures'

const stamp = '2026-10-22T00:00:00.000Z', asBlob = (bytes: Uint8Array) => new Blob([bytes.slice().buffer], { type: 'application/x-sceneweave' })
beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('complete v3 to v4 history migration', () => {
  it('forks sceneId/revision, preserves all scene/asset semantics and retains exact supplied v3 bytes', async () => {
    const input = await imageV3(); input.document.revision = 17
    const before = structuredClone(input), generated = await exportProjectV3(input)
    const original = asBlob(zipSync(unzipSync(new Uint8Array(await generated.arrayBuffer())), { level: 0 }))
    const output = await migrateProjectV3ToV4(input, { sceneId: 'new-history-copy', now: stamp, original })
    expect(input).toEqual(before)
    expect(output.document).toEqual({ ...before.document, sceneId: 'new-history-copy', revision: 0, createdAt: stamp, updatedAt: stamp })
    expect(output.licenses).toEqual(input.licenses); expect(output.licenseBindings).toEqual(input.licenseBindings)
    expect(Object.keys(output.historyIdentity.propTokens).sort()).toEqual(Object.keys(input.document.props).sort())
    expect(output.historyIdentity.rootSceneId).toBe(input.document.sceneId)
    expect(output.migrationSource).toMatchObject({ sourceSchemaVersion: 3, sourceSceneId: input.document.sceneId, sourceRevision: 17,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: HISTORY_MIGRATOR_VERSION_V4, migratedAt: stamp })
    expect(await (await migrationOriginalV4(output))!.arrayBuffer()).toEqual(await original.arrayBuffer())
  })

  it('refuses identical source IDs/revisions with different complete content and same-identity migrations', async () => {
    const input = await imageV3(), changed = structuredClone(input); changed.document.title = 'different complete source'
    await expect(migrateProjectV3ToV4(input, { original: await exportProjectV3(changed) })).rejects.toThrow('完整工程内容不一致')
    await expect(migrateProjectV3ToV4(input, { sceneId: input.document.sceneId })).rejects.toThrow('独立场景副本')
  })

  it('validates full original bytes and source identity instead of accepting metadata hashes alone', async () => {
    const project = await migrateProjectV3ToV4(await imageV3()), source = project.migrationSource!
    source.sourceHash = '0'.repeat(64)
    await expect(validateMigrationSourceV4(source, project.document.sceneId)).rejects.toThrow('SHA-256')
    source.sourceHash = await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())); source.sourceRevision++
    await expect(validateMigrationSourceV4(source, project.document.sceneId)).rejects.toThrow('完整原件不匹配')
    source.sourceRevision--
    const files = unzipSync(new Uint8Array(await source.original.arrayBuffer())), path = Object.keys(files).find(value => value.startsWith('assets/'))!
    files[path][20] ^= 1; source.original = asBlob(zipSync(files)); source.sourceHash = await sha256Bytes(new Uint8Array(await source.original.arrayBuffer()))
    await expect(validateMigrationSourceV4(source, project.document.sceneId)).rejects.toThrow('SHA-256')
  })

  it('preserves and validates the exact local v3/v2/v1 source chain and excludes all originals from portable history', async () => {
    const originalV1 = createHouse('original-m0'), original = new Blob([JSON.stringify(originalV1)], { type: 'application/json' }), source = emptyV2()
    source.document = migrateSceneV1(originalV1, { sceneId: 'original-v2', now: '2026-10-20T00:00:00.000Z' })
    source.migrationSource = { sourceSchemaVersion: 1, sourceSceneId: originalV1.sceneId, sourceRevision: originalV1.revision,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: 'sceneweave-v1-v2@1', migratedAt: '2026-10-20T00:00:00.000Z', original }
    const v3 = await createLayerProject(source, { sceneId: 'original-v3', now: '2026-10-21T00:00:00.000Z' }), v4 = await migrateProjectV3ToV4(v3, { sceneId: 'copy-v4', now: stamp })
    expect(v4.migrationSource!.previousSource).toEqual(v3.migrationSource)
    expect(await (await migrationOriginalV4(v4, 1))!.text()).toBe(await original.text())
    expect(await (await migrationOriginalV4(v4, 2))!.arrayBuffer()).toEqual(await v3.migrationSource!.original.arrayBuffer())
    const archive = await importHistoryArchiveV4(await exportHistoryArchiveV4({ project: v4, snapshots: [await namedSnapshot(v4)] }))
    expect(archive.project.migrationSource).toBeUndefined(); expect(archive.snapshots[0].project.migrationSource).toBeUndefined()
    v4.migrationSource!.previousSource!.previousSource!.sourceRevision++
    await expect(migrationOriginalV4(v4, 1)).rejects.toThrow('M0')
  })

  it('captures the original chosen for download before awaits and never replaces a cancelled migration', async () => {
    const project = await migrateProjectV3ToV4(await imageV3()), original = project.migrationSource!.original
    const downloading = migrationOriginalV4(project)
    project.migrationSource!.original = new Blob(['caller replaced during validation'])
    expect(await (await downloading)!.arrayBuffer()).toEqual(await original.arrayBuffer())
    const input = await imageV3(), before = structuredClone(input), controller = new AbortController(); controller.abort()
    await expect(migrateProjectV3ToV4(input, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(input).toEqual(before)
  })

  it.each([null, false])('rejects explicitly malformed optional provenance %s without silently dropping it', async invalid => {
    const source = await imageV3(), original = await exportProjectV3(source)
    source.migrationSource = invalid as never
    await expect(migrateProjectV3ToV4(source, { original })).rejects.toThrow('原件记录无效')
    await expect(validateMigrationSourceV4(invalid as never, 'target')).rejects.toThrow('原件记录无效')
  })
})
