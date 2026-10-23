import { createHouse } from '../src/core/seed'
import { migrateProjectV1 } from '../src/editor/v2/migration-project'
import { exportProject } from '../src/io/project-file'
import { exportProjectV2 } from '../src/io/v2/project-file'
import { createLayerProject } from '../src/io/v3/migration'
import { exportProjectV3 } from '../src/io/v3/project-file'
import { migrateProjectV3ToV4 } from '../src/io/v4/migration'
import { exportProjectV4 } from '../src/io/v4/project-file'
import { migrateProjectV4ToV5 } from '../src/io/v5/migration'
import { exportProjectV5 } from '../src/io/v5/project-file'
import { migrateProjectV5ToV6 } from '../src/io/v6/migration'
import { prepareCompositionCommandsV6 } from '../src/io/v6/prepare'
import { createC4ProjectV6, C4_FLOOR, C4_STAMP } from './c4-fixtures'

export const C5_BUILDING_LAYER = 'c5-building-layer'
export const C5_ROOM = 'c5-room'
export const C5_NOTE = 'c5-room-note'

/** Real bitmap/material bytes, fixed prefab, scatter and terrain, plus a distinct building layer. */
export async function createC5MixedProjectV6() {
  let project = await createC4ProjectV6({ title: 'C5 混合工程与联合存储夹具' })
  // Layer organization and scene content have separate finite transaction contracts.
  project = await prepareCompositionCommandsV6(project, [
    { type: 'createLayer', id: C5_BUILDING_LAYER, floorId: C4_FLOOR, name: 'C5 建筑与注记' },
  ])
  return prepareCompositionCommandsV6(project, [
    { type: 'createRoom', id: C5_ROOM, floorId: C4_FLOOR, layerId: C5_BUILDING_LAYER,
      boundaryMm: [{ x: 1000, y: 500 }, { x: 6000, y: 500 }, { x: 6000, y: 2500 }, { x: 1000, y: 2500 }],
      thicknessMm: 100, purpose: 'C5 联合验收小屋', accessExpectation: 'unspecified' },
    { type: 'createNote', id: C5_NOTE, floorId: C4_FLOOR, layerId: C5_BUILDING_LAYER,
      anchor: { type: 'entity', entityKind: 'room', entityId: C5_ROOM }, kind: 'note', text: 'C5 原始建筑注记', visibility: 'public' },
  ])
}

/** No bitmap resources: this fixture isolates all five real, exact exported migration originals. */
export async function createC5MigrationChain() {
  const v1 = createHouse()
  // M0's mask ended at the shared wall centerline (4000). Native v3 also
  // protects the private room's full 100 mm wall extent. Make this source
  // fixture conservatively covered BEFORE exporting any original; retain its
  // private room, secret door, original mask identity and every source byte.
  v1.regions['g-a1'].boundaryMm = v1.regions['g-a1'].boundaryMm.map(point => ({ ...point, y: point.y === 4000 ? 4200 : point.y }))
  const original1 = await exportProject(v1)
  const v2 = await migrateProjectV1(v1, original1), original2 = await exportProjectV2(v2)
  const v3 = await createLayerProject(v2, { original: original2, now: C4_STAMP }), original3 = await exportProjectV3(v3)
  const v4 = await migrateProjectV3ToV4(v3, { original: original3, now: C4_STAMP }), original4 = await exportProjectV4(v4)
  const v5 = await migrateProjectV4ToV5(v4, { original: original4, now: C4_STAMP }), original5 = await exportProjectV5(v5)
  const migrated = await migrateProjectV5ToV6(v5, { original: original5, now: C4_STAMP })
  const v6 = await prepareCompositionCommandsV6(migrated, [
    { type: 'createTerrainArea', id: 'c5-chain-terrain', floorId: 'f-a1',
      boundaryMm: [{ x: 15000, y: 9000 }, { x: 18000, y: 9000 }, { x: 18000, y: 13000 }, { x: 15000, y: 13000 }] },
  ])
  return { v1, v2, v3, v4, v5, v6, originals: [original1, original2, original3, original4, original5] }
}

/** Counts native rows to detect partial current/snapshot/resource writes after an aborted save. */
export async function countC5NativeStores(databaseName: string, sceneId: string) {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName)
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  })
  try {
    const names = ['scenes', 'snapshots', 'resourceBindings', 'assetBlobs', 'licenseTexts', 'migrationSources']
    const transaction = connection.transaction(names, 'readonly')
    const rows = await Promise.all(names.map(name => new Promise<readonly [string, number]>((resolve, reject) => {
      const store = transaction.objectStore(name)
      const request = name === 'scenes' || name === 'migrationSources' ? store.count(IDBKeyRange.only(sceneId))
        : name === 'snapshots' || name === 'resourceBindings' ? store.index('sceneId').count(IDBKeyRange.only(sceneId)) : store.count()
      request.onsuccess = () => resolve([name, request.result]); request.onerror = () => reject(request.error)
    })))
    return Object.fromEntries(rows)
  } finally { connection.close() }
}
