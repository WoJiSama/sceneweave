import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { emptyProject as emptyV2 } from '../v2/test-fixtures'
import { sha256Bytes } from '../v3/resources'
import { createLayerProject } from '../v3/migration'
import { migrateProjectV3ToV4 } from '../v4/migration'
import { exportProjectV4, importProjectV4 } from '../v4/project-file'
import { imageProject as imageV4 } from '../v4/test-fixtures'
import { COMPOSITION_MIGRATOR_VERSION_V5, migrateProjectV4ToV5, migrationOriginalV5, validateMigrationSourceV5 } from './migration'
import { exportHistoryArchiveV5, importHistoryArchiveV5, exportProjectV5 } from './project-file'
import { namedSnapshot } from './test-fixtures'

const stamp = '2026-10-22T00:00:00.000Z', blob = (bytes: Uint8Array) => new Blob([bytes.slice().buffer], { type: 'application/x-sceneweave' })
// Node substitutes native decode only. Browser tests own normalization and derived pixel evidence.
beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('complete v4 to v5 composition migration', () => {
  it('preserves full strict v3 content, birth tokens, lineage and exact supplied v4 bytes in a new scene/r0', async () => {
    const input = await imageV4(); input.document.revision = 17
    input.historyIdentity.propTokens['old-tombstone'] = 'old-allocated-token'
    const before = structuredClone(input), generated = await exportProjectV4(input)
    const original = blob(zipSync(unzipSync(new Uint8Array(await generated.arrayBuffer())), { level: 0 }))
    const output = await migrateProjectV4ToV5(input, { sceneId: 'new-composition-copy', now: stamp, original })
    expect(input).toEqual(before)
    expect(output.document).toEqual({ ...before.document, sceneId: 'new-composition-copy', revision: 0, createdAt: stamp, updatedAt: stamp })
    expect(output.historyIdentity).toMatchObject({ ...input.historyIdentity, version: 2, prefabTokens: {} })
    expect(output.appearance.version).toBe(1)
    expect(Object.keys(output.appearance.propSources).sort()).toEqual(Object.keys(input.document.props).sort())
    expect(output.migrationSource).toMatchObject({ sourceSchemaVersion: 4, sourceSceneId: input.document.sceneId, sourceRevision: 17,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: COMPOSITION_MIGRATOR_VERSION_V5, migratedAt: stamp })
    expect(await (await migrationOriginalV5(output))!.arrayBuffer()).toEqual(await original.arrayBuffer())
    await expect(importProjectV4(await exportProjectV5(output))).rejects.toThrow()
  })

  it('refuses identical source IDs with different full contents and same-identity migrations', async () => {
    const input = await imageV4(), changed = structuredClone(input); changed.document.title = 'different complete source'
    await expect(migrateProjectV4ToV5(input, { original: await exportProjectV4(changed) })).rejects.toThrow('完整工程内容不一致')
    await expect(migrateProjectV4ToV5(input, { sceneId: input.document.sceneId })).rejects.toThrow('独立场景副本')
  })

  it('validates original hash, strict package bytes and source revision independently', async () => {
    const project = await migrateProjectV4ToV5(await imageV4()), source = project.migrationSource!
    source.sourceHash = '0'.repeat(64)
    await expect(validateMigrationSourceV5(source, project.document.sceneId)).rejects.toThrow('SHA-256')
    source.sourceHash = await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())); source.sourceRevision++
    await expect(validateMigrationSourceV5(source, project.document.sceneId)).rejects.toThrow('修订不匹配')
    source.sourceRevision--
    const files = unzipSync(new Uint8Array(await source.original.arrayBuffer())), path = Object.keys(files).find(value => value.startsWith('assets/'))!
    files[path][20] ^= 1; source.original = blob(zipSync(files)); source.sourceHash = await sha256Bytes(new Uint8Array(await source.original.arrayBuffer()))
    await expect(validateMigrationSourceV5(source, project.document.sceneId)).rejects.toThrow('SHA-256')
  })

  it('preserves every exact v4/v3/v2/v1 original and excludes local provenance from portable history', async () => {
    const v1 = createHouse('original-m0'), original = new Blob([JSON.stringify(v1)], { type: 'application/json' }), v2 = emptyV2()
    v2.document = migrateSceneV1(v1, { sceneId: 'original-v2', now: stamp })
    v2.migrationSource = { sourceSchemaVersion: 1, sourceSceneId: v1.sceneId, sourceRevision: v1.revision,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: 'sceneweave-v1-v2@1', migratedAt: stamp, original }
    const v3 = await createLayerProject(v2, { sceneId: 'original-v3', now: stamp }), v4 = await migrateProjectV3ToV4(v3, { sceneId: 'original-v4', now: stamp })
    const v5 = await migrateProjectV4ToV5(v4, { sceneId: 'copy-v5', now: stamp })
    expect(v5.migrationSource!.previousSource).toEqual(v4.migrationSource)
    expect(await (await migrationOriginalV5(v5, 1))!.text()).toBe(await original.text())
    expect(await (await migrationOriginalV5(v5, 2))!.arrayBuffer()).toEqual(await v3.migrationSource!.original.arrayBuffer())
    expect(await (await migrationOriginalV5(v5, 3))!.arrayBuffer()).toEqual(await v4.migrationSource!.original.arrayBuffer())
    const archive = await importHistoryArchiveV5(await exportHistoryArchiveV5({ project: v5, snapshots: [await namedSnapshot(v5)] }))
    expect(archive.project.migrationSource).toBeUndefined(); expect(archive.snapshots[0].project.migrationSource).toBeUndefined()
    v5.migrationSource!.previousSource!.previousSource!.previousSource!.sourceRevision++
    await expect(migrationOriginalV5(v5, 1)).rejects.toThrow('M0')
  })

  it('captures original downloads before awaits and leaves source intact on cancellation', async () => {
    const project = await migrateProjectV4ToV5(await imageV4()), original = project.migrationSource!.original
    const downloading = migrationOriginalV5(project)
    project.migrationSource!.original = new Blob(['caller mutation'])
    expect(await (await downloading)!.arrayBuffer()).toEqual(await original.arrayBuffer())
    const input = await imageV4(), before = structuredClone(input), controller = new AbortController(); controller.abort()
    await expect(migrateProjectV4ToV5(input, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(input).toEqual(before)
  })

  it.each([null, false])('rejects explicitly malformed optional provenance %s', async invalid => {
    await expect(validateMigrationSourceV5(invalid as never, 'target')).rejects.toThrow('原件记录无效')
  })
})
