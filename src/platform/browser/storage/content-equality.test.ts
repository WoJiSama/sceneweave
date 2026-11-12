import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import type { ProjectData } from '../../../shared/model/project.js'
import { validateProjectBundle } from '../../../shared/project/resources.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { matchingEncodedSnapshot, pinEncodedSnapshot, prepareEncodedSnapshot, releaseEncodedSnapshot } from './content-context.js'
import { ProjectRepository } from './repository.js'

it('matches complete strict world/local JSON with reordered numeric and special IDs, without changing stored bytes', async () => {
  const input = fixture({ image: true }), document = input.project.document
  document.aggregateCoordinates = { encoding: 'world', groups: { group: { id: 'group', floorId: document.props.item.floorId,
    parentId: null, frame: { translationMm: { x: 1000, y: 2000 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }], editLocked: false } } }
  for (const id of ['10', '2', '01', 'constructor', 'prototype']) document.userLayers[id] = {
    ...Object.values(document.userLayers)[0], id, name: '完整 😀 "\\\n' + id, order: Object.keys(document.userLayers).length }
  Object.assign(input.project, createCompositionContent(document, runtime))
  const bundle = await validateProjectBundle(input, validation), snapshot = prepareEncodedSnapshot(bundle)
  const repo = new ProjectRepository({ name: `content-equality-${crypto.randomUUID()}`, runtime, validation })
  try {
    await repo.database.open()
    await repo.database.transaction('rw', repo.database.storageState, async transaction => {
      pinEncodedSnapshot(transaction.idbtrans, 'result', snapshot)
      for (const representation of [snapshot.project, snapshot.encoded.stored]) {
        const copy = cloneJson(representation)
        copy.document.userLayers = Object.fromEntries(Object.entries(copy.document.userLayers).reverse())
        expect(matchingEncodedSnapshot(transaction.idbtrans, copy)).toBe(snapshot)
        expect(canonicalJson(snapshot.encoded.stored)).toBe(snapshot.encoded.canonical)
        const changed = cloneJson(copy); changed.document.title += 'different'
        expect(matchingEncodedSnapshot(transaction.idbtrans, changed)).toBeUndefined()
        const unknown = { ...copy, extra: true } as ProjectData
        expect(matchingEncodedSnapshot(transaction.idbtrans, unknown)).toBeUndefined()
      }
      const changedGeometry = cloneJson(bundle.project); changedGeometry.document.props.item.rotationDeg += 360
      expect(matchingEncodedSnapshot(transaction.idbtrans, changedGeometry)).toBeUndefined()
      const changedIdentity = cloneJson(bundle.project); changedIdentity.historyIdentity.lineageId += '-other'
      expect(matchingEncodedSnapshot(transaction.idbtrans, changedIdentity)).toBeUndefined()
      const changedResources = cloneJson(bundle.project); changedResources.licenses = {}
      expect(Object.keys(bundle.project.licenses).length).toBeGreaterThan(0)
      expect(matchingEncodedSnapshot(transaction.idbtrans, changedResources)).toBeUndefined()
    })
    await repo.database.transaction('r', repo.database.storageState, transaction => {
      expect(matchingEncodedSnapshot(transaction.idbtrans, cloneJson(bundle.project))).toBeUndefined()
    })
  } finally { releaseEncodedSnapshot(snapshot); repo.close(); await Dexie.delete(repo.database.name) }
})

it('captures descriptor values once, rejects hidden/accessor/symbol input and keeps independent transaction slots', async () => {
  const bundle = await validateProjectBundle(fixture(), validation), snapshot = prepareEncodedSnapshot(bundle)
  const different = cloneJson(bundle.project); different.document.title += ' branch'
  const other = prepareEncodedSnapshot(await validateProjectBundle({ project: different, resources: bundle.resources }, validation))
  const repo = new ProjectRepository({ name: `content-equality-${crypto.randomUUID()}`, runtime, validation })
  const get = vi.fn(() => { throw new Error('caller property read') }), getter = vi.fn(() => bundle.project.document)
  try {
    await repo.database.open()
    await repo.database.transaction('rw', repo.database.storageState, transaction => {
      pinEncodedSnapshot(transaction.idbtrans, 'baseline', snapshot)
      pinEncodedSnapshot(transaction.idbtrans, 'result', other)
      const proxy = new Proxy(cloneJson(bundle.project), { get })
      expect(matchingEncodedSnapshot(transaction.idbtrans, proxy)).toBe(snapshot)
      expect(get).not.toHaveBeenCalled()
      expect(matchingEncodedSnapshot(transaction.idbtrans, cloneJson(other.project))).toBe(other)
      const invalid = [
        Object.defineProperty(cloneJson(bundle.project), 'document', { enumerable: true, get: getter }),
        Object.defineProperty(cloneJson(bundle.project), 'extra', { value: true }),
        Object.assign(cloneJson(bundle.project), { [Symbol('hidden')]: true }),
      ]
      for (const candidate of invalid) expect(() => matchingEncodedSnapshot(transaction.idbtrans, candidate)).toThrow()
      expect(getter).not.toHaveBeenCalled()
      // A mutable match does not gain reference authority for subsequent edits.
      const mutable = cloneJson(bundle.project)
      expect(matchingEncodedSnapshot(transaction.idbtrans, mutable)).toBe(snapshot)
      mutable.document.props.item.rotationDeg += 1
      expect(matchingEncodedSnapshot(transaction.idbtrans, mutable)).toBeUndefined()
    })
  } finally { releaseEncodedSnapshot(snapshot); releaseEncodedSnapshot(other); repo.close(); await Dexie.delete(repo.database.name) }
})
