import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { fromBundle, toBundle } from '../../../application/workspace/project.js'
import { Workspace } from '../../../application/workspace/workspace.js'
import * as deltaModule from '../../../shared/project/delta.js'
import { getOwnedProjectEncoding } from '../../../shared/project/encoding.js'
import { validateProjectBundle } from '../../../shared/project/resources.js'
import { getProjectLocalTransaction, getProjectTransactionReceipt } from '../../../shared/project/validate.js'
import * as hashModule from '../../../shared/validation/hash.js'
import { cloneJson, freezeJson } from '../../../shared/validation/json.js'
import { prepareEncodedSnapshot, releaseEncodedSnapshot } from './content-context.js'
import { ProjectRepository } from './repository.js'

it('reuses complete encodings across public adoption and consecutive snapshot saves', async () => {
  const name = `encoding-reuse-${crypto.randomUUID()}`
  const repo = new ProjectRepository({ name, runtime, validation }), workspace = new Workspace(repo, { runtime, validation })
  const observations: unknown[] = []
  const original = deltaModule.tryCreateLocalProjectDelta
  const digest = vi.spyOn(hashModule, 'sha256Bytes')
  vi.spyOn(deltaModule, 'tryCreateLocalProjectDelta').mockImplementation((before, after, source = after, encodings) => {
    const evidence = getProjectLocalTransaction(source) ?? getProjectTransactionReceipt(source)
    const start = digest.mock.calls.length
    const delta = original(before, after, source, encodings)
    observations.push({ revision: after.document.revision, delta: !!delta,
      beforeOwner: !!evidence && !!encodings && !!getOwnedProjectEncoding(encodings.before, evidence.baseline),
      afterOwner: !!evidence && !!encodings && !!getOwnedProjectEncoding(encodings.after, evidence.result),
      beforeEndpoint: !!evidence && (before === evidence.baseline || before === encodings?.before.stored),
      afterEndpoint: !!evidence && (after === evidence.result || after === encodings?.after.stored),
      hashes: digest.mock.calls.length - start })
    return delta
  })
  try {
    await workspace.adoptNew(await fromBundle(fixture(), validation))
    for (const rotationDeg of [90, 180, 270]) {
      await workspace.updateProp('item', { rotationDeg }); await workspace.flush()
    }
    expect(observations).toEqual([1, 2, 3].map(revision => ({ revision, delta: true,
      beforeOwner: true, afterOwner: true, beforeEndpoint: true, afterEndpoint: true, hashes: 0 })))
    const expected = toBundle(workspace.getState().project!).project
    vi.restoreAllMocks(); repo.close()
    expect((await repo.load(expected.document.sceneId))!.project).toEqual(expected)
  } finally { vi.restoreAllMocks(); await workspace.close().catch(() => {}); repo.close(); await Dexie.delete(name) }
})

it('connects independently verified equal endpoints while rejecting same-revision different content', async () => {
  const source = await validateProjectBundle(fixture(), validation)
  const detached = await validateProjectBundle(source, validation)
  expect(detached.project).not.toBe(source.project)
  const matching = prepareEncodedSnapshot(detached, source)
  try {
    expect(matching.project).toBe(source.project)
    expect(getOwnedProjectEncoding(matching.encoded, source.project)).toBe(matching.encoded)
    expect(matching.encoded.stored).toEqual(detached.project)
  } finally { releaseEncodedSnapshot(matching) }
  const changed = cloneJson(source.project); changed.document.title = 'Different content at the same revision'
  const different = await validateProjectBundle({ project: changed, resources: source.resources }, validation)
  const rejected = prepareEncodedSnapshot(detached, different)
  try {
    expect(rejected.project).toBe(detached.project)
    expect(getOwnedProjectEncoding(rejected.encoded, different.project)).toBeUndefined()
    expect(rejected.encoded.stored).toEqual(detached.project)
  } finally { releaseEncodedSnapshot(rejected) }
})

it('never inherits an encoding owner from a cloned, caller-frozen or accessor bundle', async () => {
  const source = await validateProjectBundle(fixture(), validation)
  const clone = cloneJson(source.project), frozen = freezeJson(cloneJson(source.project))
  // A caller-declared frozen marker, including an angle later normalized by
  // frame conversion, cannot issue a validator capability.
  const unsafe = cloneJson(source.project); unsafe.document.props.item.rotationDeg = 450
  let getters = 0
  const accessor = Object.defineProperty({ resources: source.resources }, 'project', {
    enumerable: true, get() { getters++; return source.project },
  })
  for (const candidate of [{ project: clone, resources: source.resources }, { project: frozen, resources: source.resources },
    { project: freezeJson(unsafe), resources: source.resources }, accessor as typeof source]) {
    const snapshot = prepareEncodedSnapshot(source, candidate)
    try {
      expect(snapshot.project).toBe(source.project)
      expect(getOwnedProjectEncoding(snapshot.encoded, clone)).toBeUndefined()
      expect(getOwnedProjectEncoding(snapshot.encoded, frozen)).toBeUndefined()
      expect(getOwnedProjectEncoding(snapshot.encoded, unsafe)).toBeUndefined()
      expect(snapshot.encoded.stored).toEqual(source.project)
    } finally { releaseEncodedSnapshot(snapshot) }
  }
  expect(getters).toBe(0)
})
