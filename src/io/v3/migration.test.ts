import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { exportProjectV2 } from '../v2/project-file'
import { imageProject as imageV2, emptyProject as emptyV2 } from '../v2/test-fixtures'
import { createLayerProject, LAYER_MIGRATOR_VERSION_V3, migrationOriginalV3, validateMigrationSourceV3 } from './migration'
import { exportProjectV3, importProjectV3 } from './project-file'
import { sha256Bytes } from './resources'

beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const stamp = '2026-10-21T00:00:00.000Z'
const asBlob = (bytes: Uint8Array) => new Blob([bytes.slice().buffer], { type: 'application/x-sceneweave' })

describe('complete v2 -> v3 layer migration', () => {
  it('forks identity/revision, keeps every complete dependency and records the exact supplied original', async () => {
    const source = await imageV2(); source.document.revision = 17
    const before = structuredClone(source), generated = await exportProjectV2(source)
    // A non-default but valid ZIP encoding must be retained instead of re-exported.
    const original = asBlob(zipSync(unzipSync(new Uint8Array(await generated.arrayBuffer())), { level: 0 }))
    const migrated = await createLayerProject(source, { sceneId: 'layers-new', now: stamp, original })
    expect(source).toEqual(before); expect(migrated.document).toMatchObject({ schemaVersion: 3, sceneId: 'layers-new', revision: 0, createdAt: stamp, updatedAt: stamp })
    for (const key of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes', 'props', 'rooms', 'walls', 'openings', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'scatterGroups'] as const) expect(migrated.document[key]).toEqual(source.document[key])
    expect(migrated.licenseBindings).toEqual(source.licenseBindings); expect(migrated.licenses).toEqual(source.licenses)
    expect(migrated.migrationSource).toMatchObject({ sourceSchemaVersion: 2, sourceSceneId: source.document.sceneId, sourceRevision: 17,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: LAYER_MIGRATOR_VERSION_V3, migratedAt: stamp })
    expect(await (await migrationOriginalV3(migrated))!.arrayBuffer()).toEqual(await original.arrayBuffer())
    expect(Object.keys(migrated.document.userLayers)).toHaveLength(Object.keys(source.document.floors).length)
    expect(await migrationOriginalV3(migrated, 1)).toBeNull()
  })

  it('rejects the same source identity/revision when complete content differs', async () => {
    const source = await imageV2(), other = structuredClone(source); other.document.title = 'different complete source with identical identity'
    await expect(createLayerProject(source, { original: await exportProjectV2(other) })).rejects.toThrow('完整工程内容不匹配')
    await expect(createLayerProject(source, { sceneId: source.document.sceneId })).rejects.toThrow('独立 sceneId')
  })

  it('validates resource bytes and licenses of the original rather than accepting its metadata/hash alone', async () => {
    const project = await createLayerProject(await imageV2(), { now: stamp }), source = project.migrationSource!
    source.sourceHash = '0'.repeat(64)
    await expect(validateMigrationSourceV3(source, project.document.sceneId)).rejects.toThrow('SHA-256')
    source.sourceHash = await sha256Bytes(new Uint8Array(await source.original.arrayBuffer())); source.sourceRevision++
    await expect(validateMigrationSourceV3(source, project.document.sceneId)).rejects.toThrow('完整原件不匹配')
    source.sourceRevision--
    const files = unzipSync(new Uint8Array(await source.original.arrayBuffer())), imagePath = Object.keys(files).find(key => key.startsWith('assets/'))!
    files[imagePath][20] ^= 1; source.original = asBlob(zipSync(files)); source.sourceHash = await sha256Bytes(new Uint8Array(await source.original.arrayBuffer()))
    await expect(validateMigrationSourceV3(source, project.document.sceneId)).rejects.toThrow('SHA-256')
  })

  it('preserves and validates prior v1 provenance locally without embedding it in complete v3 exports', async () => {
    const originalV1 = createHouse('prior-m0'), original = new Blob([JSON.stringify(originalV1)], { type: 'application/json' }), source = emptyV2()
    source.document = migrateSceneV1(originalV1, { sceneId: 'source-v2', now: '2026-10-20T00:00:00.000Z' })
    source.migrationSource = { sourceSchemaVersion: 1, sourceSceneId: originalV1.sceneId, sourceRevision: originalV1.revision,
      sourceHash: await sha256Bytes(new Uint8Array(await original.arrayBuffer())), migratorVersion: 'sceneweave-v1-v2@1', migratedAt: '2026-10-20T00:00:00.000Z', original }
    const project = await createLayerProject(source, { sceneId: 'new-v3', now: stamp })
    expect(project.migrationSource!.previousSource).toEqual(source.migrationSource)
    expect(await (await migrationOriginalV3(project, 1))!.text()).toBe(await original.text())
    const packed = await exportProjectV3(project), files = unzipSync(new Uint8Array(await packed.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'scene.json'])
    expect((await importProjectV3(packed)).migrationSource).toBeUndefined()
    const text = new TextDecoder().decode(files['scene.json'])
    expect(text).not.toContain('previousSource'); expect(text).not.toContain('sourceHash')
    project.migrationSource!.previousSource!.sourceRevision++
    await expect(migrationOriginalV3(project, 1)).rejects.toThrow('M0')
  })

  it('keeps cancellation distinct and never changes the input', async () => {
    const source = emptyV2(), before = structuredClone(source), controller = new AbortController(); controller.abort()
    await expect(createLayerProject(source, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(source).toEqual(before)
  })

  it('downloads the captured validated original even if the caller changes its local source during validation', async () => {
    const project = await createLayerProject(await imageV2()), original = project.migrationSource!.original
    const downloading = migrationOriginalV3(project)
    project.migrationSource!.original = new Blob(['caller replaced this while validation was pending'])
    expect(await (await downloading)!.arrayBuffer()).toEqual(await original.arrayBuffer())
  })

  it('rejects explicitly malformed optional source records rather than treating them as absent', async () => {
    const project = await createLayerProject(await imageV2()), source = project.migrationSource!
    await expect(validateMigrationSourceV3(null as never, project.document.sceneId)).rejects.toThrow('原件记录无效')
    source.previousSource = null as never
    await expect(validateMigrationSourceV3(source, project.document.sceneId)).rejects.toThrow('原件记录无效')
    await expect(exportProjectV3({ ...project, migrationSource: null as never })).rejects.toThrow('原件记录无效')
  })

  it.each([null, false])('rejects an explicit %s v2 provenance record without silently dropping it', async invalidSource => {
    const source = await imageV2(), original = await exportProjectV2(source)
    source.migrationSource = invalidSource as never
    const before = structuredClone(source)
    // Exercise both generated-source and supplied exact-source entry paths.
    await expect(createLayerProject(source)).rejects.toThrow('迁移原件记录无效')
    await expect(createLayerProject(source, { original })).rejects.toThrow('迁移原件记录无效')
    expect(source).toEqual(before)
    expect(source.migrationSource).toBe(invalidSource)
  })
})
