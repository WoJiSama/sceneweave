import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { createCompositionContentV5 } from '../../core/v5/graph'
import { emptyProject as emptyV2 } from '../v2/test-fixtures'
import { sha256Bytes } from '../v3/resources'
import { createLayerProject } from '../v3/migration'
import { migrateProjectV3ToV4 } from '../v4/migration'
import { migrateProjectV4ToV5 } from '../v5/migration'
import { exportProjectV5, importProjectV5 } from '../v5/project-file'
import { imageProject as imageV5 } from '../v5/test-fixtures'
import { OUTDOOR_MIGRATOR_VERSION_V6, migrateProjectV5ToV6, migrationOriginalV6, validateMigrationSourceV6 } from './migration'
import { exportHistoryArchiveV6, importHistoryArchiveV6, exportProjectV6 } from './project-file'
import { namedSnapshot, outdoorProject } from './test-fixtures'

const stamp = '2026-10-22T00:00:00.000Z', blob = (bytes: Uint8Array) => new Blob([bytes.slice().buffer], { type: 'application/x-sceneweave' })
// Node substitutes native decode only. Browser tests own normalization and derived pixel evidence.
beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('complete v5 to v6 outdoor migration', () => {
  it('preserves v3 content, appearance1 and allocated births while establishing outdoor identities at migration', async () => {
    const current = await outdoorProject(), { migrationSource: _localV6Original, ...portable } = current
    const input = { ...portable, ...createCompositionContentV5(current.document) }
    input.document.revision = 17; input.historyIdentity.propTokens['old-tombstone'] = 'old-allocated-token'
    const before = structuredClone(input), generated = await exportProjectV5(input)
    const original = blob(zipSync(unzipSync(new Uint8Array(await generated.arrayBuffer())), { level: 0 }))
    const output = await migrateProjectV5ToV6(input, { sceneId: 'new-outdoor-copy', now: stamp, original })
    expect(input).toEqual(before)
    expect(output.document).toEqual({ ...before.document, sceneId: 'new-outdoor-copy', revision: 0, createdAt: stamp, updatedAt: stamp })
    expect(output.historyIdentity).toMatchObject({ version: 3, lineageId: input.historyIdentity.lineageId, rootSceneId: input.historyIdentity.rootSceneId, propTokens: input.historyIdentity.propTokens, prefabTokens: input.historyIdentity.prefabTokens })
    expect(output.historyIdentity.outdoorTokens.domain.kind).toBe('terrainArea')
    expect(output.appearance).toEqual(input.appearance)
    expect(output.migrationSource).toMatchObject({ sourceSchemaVersion: 5, sourceSceneId: input.document.sceneId, sourceRevision: 17, sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: OUTDOOR_MIGRATOR_VERSION_V6, migratedAt: stamp })
    expect(await (await migrationOriginalV6(output))!.arrayBuffer()).toEqual(await original.arrayBuffer())
    await expect(importProjectV5(await exportProjectV6(output))).rejects.toThrow()
  })

  it('refuses a same-identity copy, different full supplied original, hash/revision/bytes tampering and cancellation', async () => {
    const input = await imageV5(), changed = structuredClone(input); changed.document.title = 'different complete source'
    await expect(migrateProjectV5ToV6(input, { original: await exportProjectV5(changed) })).rejects.toThrow('完整工程内容不一致')
    await expect(migrateProjectV5ToV6(input, { sceneId: input.document.sceneId })).rejects.toThrow('独立场景副本')
    const project = await migrateProjectV5ToV6(input), source = structuredClone(project.migrationSource!)
    source.sourceHash = '0'.repeat(64)
    await expect(validateMigrationSourceV6(source, project.document.sceneId)).rejects.toThrow('SHA-256')
    source.sourceHash = await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())); source.sourceRevision++
    await expect(validateMigrationSourceV6(source, project.document.sceneId)).rejects.toThrow('修订不匹配')
    const before = structuredClone(input), controller = new AbortController(); controller.abort()
    await expect(migrateProjectV5ToV6(input, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(input).toEqual(before)
  })

  it('preserves five exact originals and excludes local provenance from selected-history exports', async () => {
    const v1 = createHouse('original-m0'), original = new Blob([JSON.stringify(v1)], { type: 'application/json' }), v2 = emptyV2()
    v2.document = migrateSceneV1(v1, { sceneId: 'original-v2', now: stamp })
    v2.migrationSource = { sourceSchemaVersion: 1, sourceSceneId: v1.sceneId, sourceRevision: v1.revision, sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: 'sceneweave-v1-v2@1', migratedAt: stamp, original }
    const v3 = await createLayerProject(v2, { sceneId: 'original-v3', now: stamp }), v4 = await migrateProjectV3ToV4(v3, { sceneId: 'original-v4', now: stamp })
    const v5 = await migrateProjectV4ToV5(v4, { sceneId: 'original-v5', now: stamp }), v6 = await migrateProjectV5ToV6(v5, { sceneId: 'copy-v6', now: stamp })
    expect(v6.migrationSource!.previousSource).toEqual(v5.migrationSource)
    expect(await (await migrationOriginalV6(v6, 1))!.text()).toBe(await original.text())
    expect(await (await migrationOriginalV6(v6, 2))!.arrayBuffer()).toEqual(await v3.migrationSource!.original.arrayBuffer())
    expect(await (await migrationOriginalV6(v6, 3))!.arrayBuffer()).toEqual(await v4.migrationSource!.original.arrayBuffer())
    expect(await (await migrationOriginalV6(v6, 4))!.arrayBuffer()).toEqual(await v5.migrationSource!.original.arrayBuffer())
    expect(await (await migrationOriginalV6(v6, 5))!.arrayBuffer()).toEqual(await v6.migrationSource!.original.arrayBuffer())
    const archive = await importHistoryArchiveV6(await exportHistoryArchiveV6({ project: v6, snapshots: [await namedSnapshot(v6)] }))
    expect(archive.project.migrationSource).toBeUndefined(); expect(archive.snapshots[0].project.migrationSource).toBeUndefined()
    const tampered = structuredClone(v6)
    tampered.migrationSource!.previousSource!.previousSource!.previousSource!.previousSource!.sourceRevision++
    await expect(migrationOriginalV6(tampered, 1)).rejects.toThrow('M0')
  })

  it.each([null, false])('rejects explicitly malformed optional provenance %s', async invalid => {
    await expect(validateMigrationSourceV6(invalid as never, 'target')).rejects.toThrow('原件记录无效')
  })
})
