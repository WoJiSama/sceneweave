import { expect, it } from 'vitest'
import { changedPrefabRevisionMembers, planPrefabRevisionSync } from '../../shared/appearance/prefab-revisions.js'
import { adoptLibraryEntries, prepareLibraryEntry } from '../../shared/library/content.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import { prepareCompositionCommands } from './prepare.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'

const edit = (project: EditableProject, ...commands: CompositionCommand[]) => prepareCompositionCommands(project, commands, { runtime, validation })
const sight = { id: 'shelf-sight', pointsLocalMm: [{ x: -200, y: 50 }, { x: 200, y: 50 }], visibility: 'public' as const }

async function fixedGroup() {
  const project = await fromBundle(fixture({ image: true }), validation)
  return edit(project, { type: 'createPrefab', id: 'group', definitionId: 'shelf-v1', name: '书柜组合',
    ids: ['item', 'other'], anchorMm: { x: 4000, y: 4000 } })
}

it('publishes selected member fields, retains real resources and checks divergent version edits', async () => {
  const original = await fixedGroup()
  const drawn = await edit(original, { type: 'setPropSightOccluder', id: 'item', component: sight })
  const tinted = await edit(drawn, { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
    adjustment: { id: 'red', kind: 'tint', enabled: true, value: '#FF0000' } })
  const occluder = { key: 'member-1', field: 'sightOccluder' } as const
  const appearance = { key: 'member-1', field: 'appearance' } as const
  expect(changedPrefabRevisionMembers(tinted.document, 'group')).toEqual([
    { ...occluder, propId: 'item' }, { ...appearance, propId: 'item' },
  ])
  const publish: CompositionCommand = { type: 'publishPrefabRevision', id: 'group', definitionId: 'shelf-v2', version: 2, changes: [occluder] }
  const staged = await edit(tinted, publish)
  expect(staged.document.props).toEqual(tinted.document.props)
  expect(staged.document.prefabDefinitions['shelf-v1']).toEqual(original.document.prefabDefinitions['shelf-v1'])
  expect(staged.document.prefabDefinitions['shelf-v2'].members[0].propTemplate).toEqual({
    ...original.document.prefabDefinitions['shelf-v1'].members[0].propTemplate, sightOccluder: sight,
  })
  expect(staged.document.prefabInstances.group.definitionRef.version).toBe(1)
  await expect(edit(staged, { ...publish, definitionId: 'conflicting-v3', version: 3 })).rejects.toThrow(/最新版也修改了.*视线遮挡/)

  const v3 = await edit(staged, { ...publish, definitionId: 'shelf-v3', version: 3, changes: [appearance] })
  const entry = await prepareLibraryEntry(toBundle(v3), { kind: 'prefab', definitionId: 'shelf-v3' }, validation)
  const received = await adoptLibraryEntries(toBundle(original), [entry], validation)
  const target = await fromBundle(received.bundle, validation)
  const adopted = await edit(target, { type: 'syncPrefabRevision', id: 'group', definitionId: 'shelf-v3' })
  const result = adopted.document.props.item, image = result.appearance
  expect(result.sightOccluder).toEqual(sight)
  expect(image).toEqual(tinted.document.props.item.appearance)
  expect(image.kind).toBe('image')
  if (image.kind !== 'image') throw new Error('Expected a composed image')
  const hash = adopted.document.assets[image.assetId].sha256
  expect(await adopted.resources.read(hash)).toEqual(await tinted.resources.read(hash))
  expect(result.footprintMm).toEqual(original.document.props.item.footprintMm)
  expect(result.supportRef).toEqual(original.document.props.item.supportRef)
  expect(adopted.historyIdentity.propTokens.item).toBe(original.historyIdentity.propTokens.item)
})

it('previews preserved local edits and keeps locked and deleted members with their original identity', async () => {
  const original = await fixedGroup()
  const modified = await edit(original, ...['item', 'other'].map((id): CompositionCommand => ({ type: 'setPropSightOccluder', id, component: sight })))
  const next = await edit(modified, { type: 'publishPrefabRevision', id: 'group', definitionId: 'shelf-v2', version: 2,
    changes: [{ key: 'member-1', field: 'sightOccluder' }, { key: 'member-2', field: 'sightOccluder' }] })
  const entry = await prepareLibraryEntry(toBundle(next), { kind: 'prefab', definitionId: 'shelf-v2' }, validation)
  const hydrated = await adoptLibraryEntries(toBundle(original), [entry], validation)
  const target = await fromBundle(hydrated.bundle, validation)
  const moved = await edit(target, { type: 'updateProp', id: 'item', changes: { positionMm: { x: 4500, y: 4000 } } },
    { type: 'setPropSightOccluder', id: 'item', component: { ...sight, visibility: 'gm' } })
  const command: CompositionCommand = { type: 'syncPrefabRevision', id: 'group', definitionId: 'shelf-v2' }
  const locked = await edit(moved, { type: 'setEditLock', kind: 'prop', id: 'other', locked: true })
  expect(planPrefabRevisionSync(locked, command).map(change => change.outcome)).toEqual(['manual', 'locked'])
  const syncedLocked = await edit(locked, command)
  expect(syncedLocked.document.props).toEqual(locked.document.props)
  expect(syncedLocked.document.prefabInstances.group.definitionRef.version).toBe(2)
  const deleted = await edit(moved, { type: 'deleteProp', id: 'other' })
  expect(planPrefabRevisionSync(deleted, command).map(change => change.outcome)).toEqual(['manual', 'deleted'])
  const syncedDeleted = await edit(deleted, command)
  expect(syncedDeleted.document.prefabInstances.group.members['member-2'].propId).toBeNull()
  expect(syncedDeleted.document.props).toEqual(deleted.document.props)
})
