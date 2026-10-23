import { c3ImageBlob, createC3ProjectV5, C3_LAYER } from './c3-fixtures'
import { prepareAssetImportV5, prepareCompositionCommandsV5 } from '../src/io/v5/prepare'
import { exportProjectV5 } from '../src/io/v5/project-file'
import { migrateProjectV5ToV6 } from '../src/io/v6/migration'
import { prepareCompositionCommandsV6 } from '../src/io/v6/prepare'
import { projectContentHashV6 } from '../src/io/v6/project-file'
import type { CompleteProjectV6 } from '../src/io/v6/types'

export const C4_FLOOR = 'blank-floor'
export const C4_LAYER = C3_LAYER
export const C4_AREA = 'c4-terrain'
export const C4_PATH = 'c4-path'
export const C4_SCATTER = 'c4-scatter'
export const C4_PREFAB = 'c4-prefab'
export const C4_ENTRANCE = 'c4-entrance-exclusion'
export const C4_STAMP = '2026-10-22T08:00:00.000Z'

/** Real browser images, a fixed C3 composition and its exact v5 migration original. */
export async function createC4ProjectV6(options: { title?: string; sceneId?: string } = {}): Promise<CompleteProjectV6> {
  let source = await createC3ProjectV5({ title: options.title ?? 'C4 原生持久化与地形夹具' })
  source = await prepareAssetImportV5(source, { file: await c3ImageBlob(), kind: 'material', name: '原创室外纹理', widthMm: 1200, heightMm: 1200,
    licenseText: 'CC0-1.0. Original Sceneweave C4 outdoor texture; dedicated to the public domain.', attribution: 'Sceneweave original browser fixture', canEmbed: true, tags: ['C4', '原创材质'] })
  source = await prepareCompositionCommandsV5(source, [
    { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-secret'] }, adjustment: { id: 'c4-retained-tint', kind: 'tint', value: '#80FF00', enabled: true } },
  ])
  // Materialize derived bytes before the separately prepared fixed composition.
  source = await prepareCompositionCommandsV5(source, [
    { type: 'createPrefab', id: C4_PREFAB, definitionId: 'c4-prefab-definition', name: 'C4 固定双物件', ids: ['c3-left', 'c3-right'], anchorMm: { x: 5000, y: 4000 } },
  ])
  const original = await exportProjectV5(source)
  let project = await migrateProjectV5ToV6(source, { original, sceneId: options.sceneId, now: C4_STAMP })
  const material = Object.values(project.document.materials)[0], definition = project.document.propDefinitions[project.document.props['c3-left'].definitionRef!.id]
  project = await prepareCompositionCommandsV6(project, [
    { type: 'createTerrainArea', id: C4_AREA, floorId: C4_FLOOR, layerId: C4_LAYER,
      boundaryMm: [{ x: 1000, y: 9000 }, { x: 19000, y: 9000 }, { x: 19000, y: 19000 }, { x: 1000, y: 19000 }], materialRef: { id: material.id, version: material.version } },
    { type: 'createPath', id: C4_PATH, floorId: C4_FLOOR, layerId: C4_LAYER,
      centerlineMm: [{ x: 2000, y: 7000 }, { x: 10000, y: 7000 }, { x: 17000, y: 7500 }], widthMm: 1000,
      supportRefs: [{ kind: 'floor', id: C4_FLOOR }], materialRef: { id: material.id, version: material.version } },
    { type: 'createScatter', id: C4_SCATTER, floorId: C4_FLOOR, layerId: C4_LAYER, domain: { kind: 'area', areaId: C4_AREA },
      palette: [{ key: 'original-image', propDefinitionRef: { id: definition.id, version: definition.version }, weight: 1 }], seed: 'c4-native-storage-fixture',
      cellSizeMm: 4000, densityFactor: 1, minDistanceMm: 100, rotationRangeDeg: { min: 0, max: 0 } },
    { type: 'upsertScatterExclusion', groupId: C4_SCATTER, exclusion: { id: C4_ENTRANCE, reason: 'entrance',
      boundaryMm: [{ x: 16500, y: 16500 }, { x: 18500, y: 16500 }, { x: 18500, y: 18500 }, { x: 16500, y: 18500 }] } },
    { type: 'regenerateScatter', id: C4_SCATTER },
  ])
  if (Object.values(project.document.scatterGroups[C4_SCATTER].members).filter(member => member.propId !== null).length < 3) throw new Error('C4 fixture requires at least three real scatter results')
  return project
}

/** Includes byte-derived hashes; JSON metadata alone is insufficient storage evidence. */
export async function describeC4Project(project: CompleteProjectV6) {
  const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('')
  const assets = Object.fromEntries(await Promise.all(Object.entries(project.assets).map(async ([key, asset]) => [key, {
    sha256: asset.sha256, actualHash: await digest(await asset.blob.arrayBuffer()), sizeBytes: asset.sizeBytes, mimeType: asset.mimeType,
    pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight,
  }] as const)))
  const licenses = Object.fromEntries(await Promise.all(Object.entries(project.licenses).map(async ([key, license]) => [key, {
    ...license, actualHash: await digest(new TextEncoder().encode(license.text).buffer),
  }] as const)))
  const originals: { schemaVersion: number; sourceSceneId: string; sourceRevision: number; sourceHash: string; actualHash: string; sizeBytes: number }[] = []
  type Node = { sourceSceneId: string; sourceRevision: number; sourceHash: string; original: Blob; previousSource?: Node }
  let source: Node | undefined = project.migrationSource, schemaVersion = 5
  while (source) {
    originals.push({ schemaVersion, sourceSceneId: source.sourceSceneId, sourceRevision: source.sourceRevision, sourceHash: source.sourceHash,
      actualHash: await digest(await source.original.arrayBuffer()), sizeBytes: source.original.size })
    source = source.previousSource; schemaVersion--
  }
  return { document: structuredClone(project.document), historyIdentity: structuredClone(project.historyIdentity), appearance: structuredClone(project.appearance),
    assets, licenses, licenseBindings: structuredClone(project.licenseBindings), originals, contentHash: await projectContentHashV6(project) }
}
