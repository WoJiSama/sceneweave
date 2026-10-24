import { describe, expect, it, vi } from 'vitest'
import { exportMigrationSet } from '../../shared/migration/set'
import { CONVERTER_VERSION } from '../../shared/migration/types'
import { sha256Bytes } from '../../shared/project/binary'
import { readPreservationFiles, PRESERVATION_SELECTION_LIMITS } from './read-preservation'

async function fixture() {
  const bytes = new TextEncoder().encode('exact opaque preservation fixture')
  const files = await exportMigrationSet({ setId: 'selection-set', createdAt: '2026-10-24T00:00:00.000Z', converterVersion: CONVERTER_VERSION,
    scope: { kind: 'project-family', repository: 'file-v6', sourceSceneId: 'original-scene' }, sourceFingerprint: 'a'.repeat(64),
    records: [{ role: 'current', recordKey: 'input.sceneweave', sourceFormat: 'sceneweave-file-v6@1', contentHash: sha256Bytes(bytes), bytes }] })
  const index = new File([files.index.slice().buffer], 'selection-set.sceneweave-migration.json')
  const volumes = [...files.volumes].map(([name, bytes]) => new File([bytes.slice().buffer], name))
  return { files, index, volumes }
}

describe('user selection of a complete preservation set', () => {
  it('fully rereads actual unordered File bytes before exposing the verified scope', async () => {
    const { files, index, volumes } = await fixture(), result = await readPreservationFiles([...volumes, index])
    expect(result.scope).toEqual({ kind: 'project-family', repository: 'file-v6', sourceSceneId: 'original-scene' })
    expect(result.files.index).toEqual(files.index); expect(result.files.volumes).toEqual(files.volumes)
  })

  it('rejects missing, duplicate, extra and corrupted files, including extra volumes before reading them', async () => {
    const { index, volumes } = await fixture()
    await expect(readPreservationFiles([index])).rejects.toThrow(/全部同名分卷|缺失/)
    await expect(readPreservationFiles([index, ...volumes, volumes[0]])).rejects.toThrow(/重复/)
    await expect(readPreservationFiles([index, ...volumes, new File(['extra'], 'extra.txt')])).rejects.toThrow(/额外/)
    const extra = new File(['extra'], 'part-0001.sceneweave-migration-part'), read = vi.spyOn(extra, 'arrayBuffer')
    await expect(readPreservationFiles([index, ...volumes, extra])).rejects.toThrow(/额外/); expect(read).not.toHaveBeenCalled()
    const bytes = new Uint8Array(await volumes[0].arrayBuffer()); bytes[bytes.length - 1] ^= 1
    await expect(readPreservationFiles([index, new File([bytes], volumes[0].name)])).rejects.toThrow(/SHA256/)
    await expect(readPreservationFiles([index, ...volumes], { signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('enforces count, individual byte and 512MiB aggregate protection before reading file contents', async () => {
    const index = new File(['{}'], 'fixture.sceneweave-migration.json')
    const shared = new Blob([new Uint8Array(PRESERVATION_SELECTION_LIMITS.volumeBytes)])
    const tooMany = [index, ...Array.from({ length: 513 }, (_, i) => new File(['x'], `part-${String(i).padStart(4, '0')}.sceneweave-migration-part`))]
    await expect(readPreservationFiles(tooMany)).rejects.toThrow(/512/)
    const largeIndex = new File([shared.slice(0, PRESERVATION_SELECTION_LIMITS.indexBytes + 1)], index.name)
    await expect(readPreservationFiles([largeIndex])).rejects.toThrow(/16MiB/)
    const largeVolume = new File([shared, 'x'], 'part-0000.sceneweave-migration-part')
    await expect(readPreservationFiles([index, largeVolume])).rejects.toThrow(/33MiB/)
    const many = Array.from({ length: 16 }, (_, i) => new File([shared], `part-${String(i).padStart(4, '0')}.sceneweave-migration-part`)), read = vi.spyOn(index, 'arrayBuffer')
    await expect(readPreservationFiles([index, ...many])).rejects.toThrow(/累计超过512MiB/)
    expect(read).not.toHaveBeenCalled()
  })
})
