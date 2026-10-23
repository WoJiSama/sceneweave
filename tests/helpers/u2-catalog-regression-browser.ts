import { createBlankDocumentV2 } from '../../src/editor/v2/blank-project'
import { createNativeOutdoorDocument } from '../../src/editor/v6/blank-project'
import { createCompositionContentV6 } from '../../src/core/v6/graph'
import { prepareAssetImportV6, prepareCompositionCommandsV6 } from '../../src/io/v6/prepare'
import { projectContentHashV6, toCompleteProjectV3, validateCompleteProjectV6 } from '../../src/io/v6/project-file'
import { readBitmapPixelsV6, sha256Bytes } from '../../src/io/v6/resources'
import { SceneRepositoryV6 } from '../../src/io/v6/storage'
import { WorkspaceV6 } from '../../src/editor/v6/workspace'
import { prepareCatalogAdoption, prepareCatalogEntry, readCatalogEntry } from '../../src/catalog/content'
import { exportCatalogBackup, readCatalogBackup } from '../../src/catalog/backup'
import { CatalogRepositoryV1 } from '../../src/catalog/repository'
import { projectSceneV3 } from '../../src/render/v3/projection'
import { exportPngV3 } from '../../src/render/v3/renderer'
import type { CompleteProjectV6 } from '../../src/io/v6/types'
import { c3ImageBlob } from '../c3-fixtures'

const FLOOR = 'blank-floor', LAYER = 'layer-default-0', DEFINITION = 'u2-private-fixed-definition'
const organization = { tags: ['私密完整组合', '实际派生'], colors: ['棕', '绿'] as ('棕' | '绿')[], favorite: true }

/** A new empty native project. No fetched catalog assets or fictional migration original. */
function emptyProject(title: string): CompleteProjectV6 {
  const document = createBlankDocumentV2({ title, widthMm: 20000, heightMm: 20000, preset: 'investigation' })
  document.assets = {}; document.propDefinitions = {}
  return { ...createCompositionContentV6(createNativeOutdoorDocument(document)), assets: {}, licenses: {}, licenseBindings: [] }
}

async function describeClosure(project: CompleteProjectV6) {
  const assets: Record<string, { sha256: string; actualHash: string; bytes: number; dimensions: number[]; rgbaHash: string; opaquePixel: number[] }> = {}
  for (const [hash, record] of Object.entries(project.assets)) {
    const pixels = await readBitmapPixelsV6(record)
    assets[hash] = { sha256: record.sha256, actualHash: await sha256Bytes(new Uint8Array(await record.blob.arrayBuffer())), bytes: record.blob.size,
      dimensions: [record.pixelWidth, record.pixelHeight], rgbaHash: await sha256Bytes(new Uint8Array(pixels)), opaquePixel: Array.from(pixels.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)) }
  }
  const licenses: Record<string, { text: string; actualHash: string }> = {}
  for (const [hash, license] of Object.entries(project.licenses)) licenses[hash] = { text: license.text, actualHash: await sha256Bytes(new TextEncoder().encode(license.text)) }
  return { assets, licenses, bindings: structuredClone(project.licenseBindings), definitions: structuredClone(project.document.prefabDefinitions),
    sources: structuredClone(project.appearance.sources), variants: structuredClone(project.appearance.variants), templates: structuredClone(project.appearance.prefabAppearanceTemplates) }
}

async function describePng(project: CompleteProjectV6, audience: 'gm' | 'player') {
  const blob = await exportPngV3(toCompleteProjectV3(project), { audience, longEdgePx: 4096 }), bytes = new Uint8Array(await blob.arrayBuffer())
  const chunks: string[] = [], view = new DataView(bytes.buffer)
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (offset + length + 12 > bytes.length) throw new Error('Truncated U2 actual PNG')
    chunks.push(type); offset += length + 12
  }
  const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
  canvas.width = bitmap.width; canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
    context.drawImage(bitmap, 0, 0)
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob)
    })
    return { width: bitmap.width, height: bitmap.height, bytes: bytes.length, chunks,
      metadata: chunks.filter(chunk => ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(chunk)),
      rgbaHash: await sha256Bytes(new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data)), url }
  } finally { bitmap.close(); canvas.width = canvas.height = 0 }
}

/** Actual native Canvas normalization/derivation, fixed private template, and installed library bytes. */
export async function createU2PrivateLibraryBackup() {
  let project = await prepareAssetImportV6(emptyProject('U2 私密来源工程，不可进入目录载体'), { file: await c3ImageBlob(), kind: 'prop', name: 'U2 原创私密叶片',
    widthMm: 1400, heightMm: 1400, footprintWidthMm: 1000, footprintHeightMm: 1000, blocksMovement: false, blocksSight: false,
    licenseText: 'CC0-1.0. Original Sceneweave U2 native-browser artwork; dedicated to the public domain.', attribution: 'Sceneweave U2 browser regression original', canEmbed: true })
  const definition = Object.values(project.document.propDefinitions)[0]
  project = await prepareCompositionCommandsV6(project, [{ type: 'addProp', id: 'u2-source-member', floorId: FLOOR, layerId: LAYER,
    definitionRef: { id: definition.id, version: definition.version }, positionMm: { x: 4000, y: 4000 }, supportRef: { kind: 'floor', id: FLOOR } }])
  project = await prepareCompositionCommandsV6(project, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['u2-source-member'] },
    adjustment: { id: 'u2-real-half-brightness', kind: 'brightness', value: .5, enabled: true } }])
  // Define a private source fixture explicitly, with a legal fixed player mask.
  project = structuredClone(project); project.document.props['u2-source-member'].visibility = 'gm'
  project = await prepareCompositionCommandsV6(project, [{ type: 'upsertManualMask', id: 'u2-source-mask', floorId: FLOOR, layerId: LAYER,
    boundsMm: { x: 2000, y: 2000, width: 4000, height: 4000 } }])
  project = await prepareCompositionCommandsV6(project, [{ type: 'createPrefab', id: 'u2-source-group', definitionId: DEFINITION,
    name: 'U2 私密派生固定组合', ids: ['u2-source-member'], anchorMm: { x: 4000, y: 4000 } }])
  await validateCompleteProjectV6(project); projectSceneV3(project.document, 'player')
  const before = await projectContentHashV6(project), entry = await prepareCatalogEntry(project, { kind: 'prefab', definitionId: DEFINITION })
  const capsule = await readCatalogEntry(entry), repo = new CatalogRepositoryV1(`u2-library-source-${crypto.randomUUID()}`)
  try {
    const initial = await repo.read(), installed = await repo.commit(initial.revision, { put: [entry], organization: [{ key: entry.item.identity.key, value: organization }] })
    const loaded = await repo.load(entry.item.identity.key), blob = await exportCatalogBackup([{ entry: loaded, organization: installed.organizations[entry.item.identity.key] }])
    return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), key: entry.item.identity.key, item: entry.item, closure: await describeClosure(capsule),
      sourceUnchanged: before === await projectContentHashV6(project), capsuleHasNoMap: Object.keys(capsule.document.props).length === 0 && Object.keys(capsule.document.regions).length === 0 && Object.keys(capsule.document.notes).length === 0,
      capsuleTitle: capsule.document.title, installedRevision: installed.revision, backupBytes: blob.size, organization }
  } finally { repo.close() }
}

/** Run after this module is loaded and the new browser context has been set offline. */
export async function restoreU2PrivateLibraryOffline(input: { bytes: number[]; key: string }) {
  const libraryName = `u2-library-empty-target-${crypto.randomUUID()}`, projectName = `u2-offline-target-${crypto.randomUUID()}`
  const repo = new CatalogRepositoryV1(libraryName), store = new SceneRepositoryV6(projectName), workspace = new WorkspaceV6(store)
  let reopened: CatalogRepositoryV1 | undefined
  try {
    const initial = await repo.read(), records = await readCatalogBackup(new Blob([new Uint8Array(input.bytes)]))
    const installed = await repo.commit(initial.revision, { put: records.map(record => record.entry), organization: records.map(record => ({ key: record.entry.item.identity.key, value: record.organization })) })
    repo.close(); reopened = new CatalogRepositoryV1(libraryName)
    const entry = await reopened.load(input.key), capsule = await readCatalogEntry(entry)
    await workspace.adoptNew(emptyProject('U2 空库恢复后的全新离线工程'))
    const blank = workspace.getState().project!, blankHash = await projectContentHashV6(blank), prepared = await prepareCatalogAdoption(blank, [entry])
    const adoption = await workspace.previewPrepared(prepared.project, '恢复完整库后采用私密固定组合')
    const adoptionPreviewUnchanged = blankHash === await projectContentHashV6(workspace.getState().project!)
    await workspace.adoptPreview(adoption); await workspace.flush()
    const adopted = workspace.getState().project!, beforeFailure = await projectContentHashV6(adopted), undoBeforeFailure = workspace.getState().canUndo
    const command = { type: 'instantiatePrefab' as const, id: 'u2-placed-private', definitionRef: { id: DEFINITION, version: 1 }, memberIds: { 'member-1': 'u2-placed-member' },
      anchorMm: { x: 10000, y: 10000 }, layerId: LAYER, supportRef: { kind: 'floor' as const, id: FLOOR } }
    let missingMaskError = ''
    try { await workspace.preview([command]) } catch (error) { missingMaskError = error instanceof Error ? error.message : String(error) }
    const rejectedWithoutMutation = beforeFailure === await projectContentHashV6(workspace.getState().project!) && undoBeforeFailure === workspace.getState().canUndo
    const mask = await workspace.preview([{ type: 'upsertManualMask', id: 'u2-target-mask', floorId: FLOOR, layerId: LAYER,
      boundsMm: { x: 7000, y: 7000, width: 6000, height: 6000 } }])
    await workspace.adoptPreview(mask); await workspace.flush()
    const beforePlacement = workspace.getState().project!, baseline = { gm: await describePng(beforePlacement, 'gm'), player: await describePng(beforePlacement, 'player') }
    const placement = await workspace.preview([command]), placementPreviewUnchanged = await projectContentHashV6(beforePlacement) === await projectContentHashV6(workspace.getState().project!)
    await workspace.adoptPreview(placement); await workspace.flush()
    const placed = workspace.getState().project!, projection = projectSceneV3(placed.document, 'player')
    const output = { gm: await describePng(placed, 'gm'), player: await describePng(placed, 'player') }
    const placedHash = await projectContentHashV6(placed)
    workspace.undo(); await workspace.flush()
    const undone = workspace.getState().project!, undoPreservesMaskAndAdoption = Object.keys(undone.document.props).length === 0 && !!undone.document.regions['u2-target-mask'] && !!undone.document.prefabDefinitions[DEFINITION]
    workspace.redo(); await workspace.flush()
    const final = workspace.getState().project!, finalHash = await projectContentHashV6(final)
    await workspace.close(); store.close()
    const readStore = new SceneRepositoryV6(projectName)
    try {
      const saved = await readStore.load(final.document.sceneId)
      if (!saved) throw new Error('Expected actual saved native v6 target')
      return { initiallyEmpty: initial.revision === 0 && initial.entries.length === 0 && Object.keys(initial.organizations).length === 0,
        installedCount: installed.entries.length, organization: installed.organizations[input.key], closure: await describeClosure(capsule),
        adoptionPreviewUnchanged, adoptedRevision: adopted.document.revision, missingMaskError, rejectedWithoutMutation, placementPreviewUnchanged,
        groupVisibility: placed.document.prefabInstances[command.id].visibility, memberVisibility: placed.document.props['u2-placed-member'].visibility,
        playerContainsMember: projection.props.some(prop => prop.id === 'u2-placed-member'), sourceChainDepth: (() => {
          let depth = 0, id: string | null = placed.appearance.prefabAppearanceTemplates[DEFINITION].members['member-1'].sourceId
          while (id) { depth++; id = placed.appearance.sources[id].parentSourceId }
          return depth
        })(), baseline, output, undoPreservesMaskAndAdoption, placedRevision: placed.document.revision, finalRevision: final.document.revision,
        redoRetainsPixels: Object.keys(final.assets).sort().join() === Object.keys(placed.assets).sort().join(),
        reopenExact: finalHash === await projectContentHashV6(saved), reopenVisibility: saved.document.props['u2-placed-member'].visibility, placedHash }
    } finally { readStore.close() }
  } finally { repo.close(); reopened?.close(); store.close() }
}
