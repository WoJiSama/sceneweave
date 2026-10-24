import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createHouse } from '../../core/seed'
import { exportProject as exportV1 } from '../../io/project-file'
import { exportProjectV2 } from '../../io/v2/project-file'
import { exportProjectV3 } from '../../io/v3/project-file'
import { exportProjectV4, exportHistoryArchiveV4 } from '../../io/v4/project-file'
import { exportProjectV5, exportHistoryArchiveV5 } from '../../io/v5/project-file'
import { exportProjectV6, exportHistoryArchiveV6 } from '../../io/v6/project-file'
import { emptyProject as emptyV2 } from '../../io/v2/test-fixtures'
import { emptyProject as emptyV3 } from '../../io/v3/test-fixtures'
import { emptyProject as emptyV4, namedSnapshot as namedV4 } from '../../io/v4/test-fixtures'
import { emptyProject as emptyV5, namedSnapshot as namedV5 } from '../../io/v5/test-fixtures'
import { emptyProject as emptyV6, namedSnapshot as namedV6 } from '../../io/v6/test-fixtures'
import { sha256Bytes } from '../../shared/project/binary.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { captureLegacyFile } from './file.js'
import { restoreLegacyCapture, type LegacyCapture } from './capture.js'
import { prepareLegacyFamily } from './convert.js'

const stamp = '2026-10-24T00:00:00.000Z'
const options: CompleteValidationOptions = { images: {
  async decode() { throw new Error('symbol-only test must not decode') }, async transform() { throw new Error('symbol-only test must not transform') }, async encodePng() { throw new Error('symbol-only test must not encode') },
} }
const bytes = async (blob: Promise<Blob> | Blob) => new Uint8Array(await (await blob).arrayBuffer())
function preparation(capture: LegacyCapture) {
  let sequence = 0
  return { sceneId: 'new-file-copy', createdAt: stamp, snapshotIds: Object.fromEntries(capture.snapshotKeys.map((key, i) => [key, `file-snapshot-${i}`])),
    context: { ids: { nextId: () => `file-token-${++sequence}` }, clock: { now: () => stamp } } }
}
describe('exact legacy file conversion', () => {
  it('strictly reads all six file generations and preserves their original ZIP bytes instead of reexporting them', async () => {
    const inputs = [await bytes(exportV1(createHouse())), await bytes(exportProjectV2(emptyV2())), await bytes(exportProjectV3(emptyV3())),
      await bytes(exportProjectV4(emptyV4())), await bytes(exportProjectV5(emptyV5())), await bytes(exportProjectV6(emptyV6()))]
    for (const [index, input] of inputs.entries()) {
      const capture = await captureLegacyFile(input)
      expect(capture.scope.repository).toBe(`file-v${index + 1}`); expect(capture.records).toHaveLength(1); expect(capture.records[0].bytes).toEqual(input)
      const restored = await restoreLegacyCapture(capture.scope, capture.records), converted = await prepareLegacyFamily(restored, preparation(restored), options)
      expect(restored.sourceFingerprint).toBe(capture.sourceFingerprint)
      expect(converted.current.project.document).toMatchObject({ sceneId: 'new-file-copy', revision: 0 })
      expect(converted.legacySources[0]).toMatchObject({ sourceSchemaVersion: index + 1, sourceSceneId: capture.scope.sourceSceneId, sourceHash: sha256Bytes(input), previousNodeId: null })
      expect(converted.legacyBlobs).toEqual([{ sha256: sha256Bytes(input), bytes: input }])
      expect(converted.sourceContentHashes).toEqual(capture.sourceContentHashes)
    }
  })
  it('retains original v6 selected historical identities while v4/v5 selected histories remain in the exact file archive', async () => {
    const original = emptyV6(), historical = structuredClone(original)
    original.document.revision = 9; historical.document.sceneId = 'real-historical-file-id'; historical.document.revision = 3
    const snapshot = await namedV6(historical, 'original-file-snapshot'); snapshot.sceneId = original.document.sceneId
    const input = await bytes(exportHistoryArchiveV6({ project: original, snapshots: [snapshot] })), capture = await captureLegacyFile(input)
    expect(capture.snapshotKeys).toHaveLength(1); expect(capture.snapshotKeys[0]).toContain('file-v6')
    const restored = await restoreLegacyCapture(capture.scope, capture.records), converted = await prepareLegacyFamily(restored, preparation(restored), options)
    expect(converted.snapshots).toHaveLength(1); expect(converted.importedSnapshots).toHaveLength(0)
    expect(converted.snapshots[0].bundle.project.document).toMatchObject({ sceneId: 'real-historical-file-id', revision: 3 })
    expect(converted.snapshots[0].ownerSceneId).toBe('new-file-copy'); expect(converted.current.project.historyIdentity.propTokens).toEqual(original.historyIdentity.propTokens)
    const old4 = emptyV4(), old5 = emptyV5()
    for (const input of [await bytes(exportHistoryArchiveV4({ project: old4, snapshots: [await namedV4(old4)] })),
      await bytes(exportHistoryArchiveV5({ project: old5, snapshots: [await namedV5(old5)] }))]) {
      const capture = await captureLegacyFile(input), result = await prepareLegacyFamily(capture, preparation(capture), options)
      expect(capture.snapshotKeys).toHaveLength(1); expect(result.snapshots).toEqual([]); expect(result.legacyBlobs[0].bytes).toEqual(input)
    }
  })
  it('distinguishes equivalent files by actual byte SHA and rejects altered scope, semantic claims and mutated records', async () => {
    const input = await bytes(exportV1(createHouse())), repacked = zipSync(unzipSync(input), { level: 0, mtime: new Date(2000, 0, 1) })
    const a = await captureLegacyFile(input), b = await captureLegacyFile(repacked)
    expect(b.sourceContentHashes.current).toBe(a.sourceContentHashes.current); expect(b.sourceFingerprint).not.toBe(a.sourceFingerprint)
    await expect(restoreLegacyCapture({ ...a.scope, repository: 'file-v6' }, a.records)).rejects.toThrow(/版本|场景|语义/)
    await expect(restoreLegacyCapture(a.scope, [{ ...a.records[0], contentHash: 'f'.repeat(64) }])).rejects.toThrow(/语义/)
    a.records[0].bytes[0] ^= 1
    await expect(prepareLegacyFamily(a, preparation(a), options)).rejects.toThrow(/修改/)
  })
})
