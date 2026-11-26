import { expect, it, vi } from 'vitest'
import { fixture, NOW, validation } from '../../../application/workspace/test-fixtures.js'
import { importHistoryArchive, importProject, prepareProjectArchive } from '../../../shared/project/file.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import { zipProjectArchive } from './project-archive-zip.js'

it('streams deterministic backup ZIPs that the strict complete and history readers can cold open', async () => {
  const current = fixture({ image: true }), document = current.project.document
  const complete = await prepareProjectArchive({ current, snapshots: [] }, 'complete', validation)
  const data = async (files: Record<string, Uint8Array>) => new Uint8Array(await zipProjectArchive(files).arrayBuffer())
  let bytes: Uint8Array
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(new Date(2026, 0, 1))
    bytes = await data(complete)
    vi.setSystemTime(new Date(2026, 6, 1))
    expect(await data(complete)).toEqual(bytes)
  } finally { vi.useRealTimers() }
  const reread = await importProject(bytes, validation)
  expect(reread.project).toEqual(current.project)
  for (const hash of Object.keys(current.project.assets)) expect(await reread.resources.read(hash)).toEqual(await current.resources.read(hash))

  const snapshot = { id: 'named', ownerSceneId: document.sceneId, lineageId: current.project.historyIdentity.lineageId,
    name: 'Named version', sourceRevision: document.revision, kind: 'named' as const, createdAt: NOW,
    contentHash: projectContentHash(current.project), bundle: current }
  const history = await prepareProjectArchive({ current, snapshots: [snapshot] }, 'history', validation)
  const archive = await importHistoryArchive(await data(history), validation)
  expect(archive.current.project).toEqual(current.project)
  expect(archive.snapshots).toHaveLength(1)
  expect(archive.snapshots[0]).toMatchObject({ id: snapshot.id, contentHash: snapshot.contentHash, bundle: { project: current.project } })
})

it('rejects an oversized output during the ZIP stream, before compressing subsequent entries', () => {
  const entries = { 'scene.json': Uint8Array.of(123, 125), 'manifest.json': Uint8Array.of(123, 125) }
  const read = entries['manifest.json'].subarray.bind(entries['manifest.json'])
  entries['manifest.json'].subarray = () => { throw new Error('later entry was reached') }
  expect(() => zipProjectArchive(entries, 30)).toThrow('超过 ZIP 字节预算')
  entries['manifest.json'].subarray = read
  const archive = zipProjectArchive(entries)
  expect(zipProjectArchive(entries, archive.size).size).toBe(archive.size)
  expect(() => zipProjectArchive(entries, archive.size - 1)).toThrow('超过 ZIP 字节预算')
})
