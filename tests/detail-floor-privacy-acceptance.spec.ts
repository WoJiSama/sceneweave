/** Targeted 09 acceptance: fixed paired private mutations on overlapping Floors.
 * Inputs use ordinary shared commands and enter through the complete-file UI.
 * Pixel equality is exact within one audience; this is not a GM/player AA test. */
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync, zipSync } from 'fflate'
import { applyCompositionCommands } from '../src/shared/appearance/commands'
import type { CompositionCommand } from '../src/shared/appearance/commands'
import type { ProjectManifest } from '../src/shared/project/file'
import { canonicalJson } from '../src/shared/validation/json'
import { validateSceneDocument } from '../src/shared/validation/scene'
import { visualBase } from '../src/shared/visual/base'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const rect = (x: number, y: number, width: number, height: number) => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
type Content = Parameters<typeof applyCompositionCommands>[0]
const content = (source: Backup): Content => ({ document: source.document, historyIdentity: source.identity, appearance: source.appearance })

let proofSequence = 0
function prepare(input: Content, commands: CompositionCommand[]) {
  return applyCompositionCommands(input, commands, { ids: { nextId: () => `acceptance-proof-${proofSequence++}` }, clock: { now: () => '2026-11-10T12:00:00.000Z' } })
}
async function packageInput(sourcePath: string, outputPath: string, value: Content) {
  const files = unzipSync(new Uint8Array(await readFile(sourcePath)))
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as ProjectManifest
  for (const [path, data] of [['scene.json', value.document], ['identity.json', value.historyIdentity], ['appearance.json', value.appearance]] as const) {
    files[path] = new TextEncoder().encode(canonicalJson(data))
    const entry = manifest.entries.find(row => row.path === path)!
    entry.sha256 = digest(files[path]); entry.sizeBytes = files[path].length
  }
  manifest.revision = value.document.revision; manifest.sceneId = value.document.sceneId
  files['manifest.json'] = new TextEncoder().encode(canonicalJson(manifest))
  const bytes = zipSync(files, { level: 6 }); await writeFile(outputPath, bytes)
  return { path: outputPath, sha256: digest(bytes), sceneSha256: digest(files['scene.json']) }
}
async function load(page: Page, path: string) {
  await page.goto('about:blank')
  const response = await page.goto('./#home')
  expect(response?.ok()).toBe(true); expect(await response!.text()).not.toContain('/@vite/client')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(path); await keyboardWorkspaceSaved(page)
}
async function exportImage(page: Page, floorId: string, audience: 'gm' | 'player', path: string) {
  await page.getByRole('combobox', { name: '当前楼层', exact: true }).selectOption(floorId)
  await keyboardWorkspaceSaved(page)
  const downloading = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click(); const download = await downloading
  expect(download.suggestedFilename()).toBe(`sceneweave-${audience}-map.png`)
  await download.saveAs(path); await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  const bytes = await readFile(path), image = PNG.sync.read(bytes)
  const chunks: string[] = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)
    chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset += 12 + length
  }
  expect(chunks.some(chunk => ['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(chunk))).toBe(false)
  return { rgbaSha256: digest(image.data), fileSha256: digest(bytes), width: image.width, height: image.height, chunks, image }
}
function facts(value: Awaited<ReturnType<typeof exportImage>>) {
  const { image: _image, ...result } = value; return result
}
function importedContent(document: Content['document']) {
  const { sceneId: _sceneId, createdAt: _createdAt, updatedAt: _updatedAt, ...result } = document
  return result
}

test('paired secret mutations and same-XY other-Floor effects cannot change Floor A player PNG', async ({ page, browser }, info) => {
  test.setTimeout(420_000)
  const artifact = JSON.parse(await readFile(process.env.SCENEWEAVE_DETAIL_ARTIFACT ?? 'work/detail-acceptance-20261110/frozen-artifact.json', 'utf8'))
  await createKeyboardProject(page, '楼层配对保密验收')
  expect(page.url().startsWith(artifact.baseUrl)).toBe(true)
  const sourcePath = info.outputPath('source.sceneweave'), source = await keyboardProjectBackup(page, sourcePath)
  const a = Object.keys(source.document.floors)[0], aLayer = Object.keys(source.document.userLayers)[0]
  const b = 'acceptance-overlapping-floor', bLayer = 'acceptance-overlapping-layer'
  const environment = { ...visualBase(source.document)!.environment, contactShadowMm: 150, contactShadowOpacity: .35 }
  const definition = Object.values(source.document.propDefinitions).find(row => row.catalogId === 'prop.sw.desk-oak')!
  expect(definition).toBeDefined()
  const reference = { id: definition.id, version: definition.version }
  const transparent = prepare(content(source), [{ type: 'setSceneBackground', background: { mode: 'transparent' } }])
  const initial = prepare(transparent, [
    { type: 'createFloor', id: b, name: 'SECRET_FLOOR_NAME_DO_NOT_EXPORT', boundsMm: { x: 0, y: 0, width: 14000, height: 10000 }, outputBoundsMm: { x: 500, y: 500, width: 12000, height: 9000 }, newLayerId: bLayer, layerName: '第二层' },
    { type: 'setFloorEnvironment', id: a, environment },
    { type: 'setFloorEnvironment', id: b, environment: { ...environment, ambientColor: '#9caabb', ambientOpacity: .2 } },
    { type: 'upsertManualMask', id: 'acceptance-fixed-mask', floorId: a, layerId: aLayer, boundsMm: { x: 1000, y: 4000, width: 8500, height: 5500 } },
    { type: 'createRoom', id: 'acceptance-private-room', floorId: a, layerId: aLayer, boundaryMm: rect(2000, 5000, 6000, 3000), thicknessMm: 180, visibility: 'gm', purpose: 'SECRET_ROOM' },
    { type: 'createRoom', id: 'acceptance-public-room-b', floorId: b, layerId: bLayer, boundaryMm: rect(2000, 5000, 6000, 3000), thicknessMm: 250, visibility: 'public', purpose: '公开房间B' },
    { type: 'addProp', id: 'acceptance-secret-desk', floorId: a, definitionRef: reference, positionMm: { x: 4000, y: 6500 }, supportRef: { kind: 'room', id: 'acceptance-private-room' } },
    { type: 'addProp', id: 'acceptance-public-desk-a', floorId: a, definitionRef: reference, positionMm: { x: 11000, y: 2000 }, supportRef: { kind: 'floor', id: a } },
    { type: 'addProp', id: 'acceptance-public-desk-b', floorId: b, definitionRef: reference, positionMm: { x: 11000, y: 2000 }, supportRef: { kind: 'floor', id: b } },
    { type: 'createNote', id: 'acceptance-secret-note', floorId: a, layerId: aLayer, anchor: { type: 'entity', entityKind: 'prop', entityId: 'acceptance-secret-desk' }, kind: 'label', text: 'SECRET_TEXT_ALPHA', visibility: 'gm' },
    { type: 'upsertVisualLight', light: { id: 'acceptance-secret-light', floorId: a, layerId: aLayer, visibility: 'gm', editLocked: false, positionMm: { x: 5000, y: 6500 }, radiusMm: 2000, color: '#ff6644', intensity: .7, wallOcclusion: true, enabled: true } },
    { type: 'upsertVisualFog', fog: { id: 'acceptance-secret-fog', floorId: a, layerId: aLayer, visibility: 'gm', editLocked: false, boundaryMm: rect(2500, 5500, 4000, 1500), color: '#775599', opacity: .6, directionDeg: 35, scaleMm: 500, seed: 'private-fog-before', enabled: true } },
  ])
  const privateWall = Object.values(initial.document.walls).find(wall => initial.document.rooms['acceptance-private-room'].boundaryVertexIds.includes(wall.startVertexId))!
  const withDoor = prepare(initial, [{ type: 'addOpening', id: 'acceptance-secret-door', wallId: privateWall.id, offsetReferenceVertexId: privateWall.startVertexId, offsetMm: 1300, widthMm: 1000, kind: 'door', state: 'closed', locked: true, secret: true, revealed: false, layerId: aLayer }])
  const visual = visualBase(withDoor.document)!
  const changed = prepare(withDoor, [
    { type: 'updateProp', id: 'acceptance-secret-desk', changes: { positionMm: { x: 6000, y: 6500 }, rotationDeg: 90 } },
    { type: 'updateOpening', id: 'acceptance-secret-door', changes: { offsetMm: 2900, state: 'open', locked: false } },
    { type: 'setWallThickness', id: privateWall.id, thicknessMm: 320 },
    { type: 'updateNote', id: 'acceptance-secret-note', changes: { text: 'SECRET_TEXT_BETA' } },
    { type: 'upsertVisualLight', light: { ...visual.lights['acceptance-secret-light'], color: '#44bbff', radiusMm: 2500 } },
    { type: 'upsertVisualFog', fog: { ...visual.fogs['acceptance-secret-fog'], seed: 'private-fog-after', color: '#335577', directionDeg: 145 } },
    { type: 'setFloorEnvironment', id: b, environment: { ...environment, ambientColor: '#557799', ambientOpacity: .45, exposure: .75 } },
    { type: 'updateProp', id: 'acceptance-public-desk-b', changes: { positionMm: { x: 10500, y: 3000 }, rotationDeg: 90 } },
  ])
  for (const value of [withDoor, changed]) {
    const valid = validateSceneDocument(value.document)
    expect(valid.ok, valid.ok ? '' : JSON.stringify(valid.errors)).toBe(true)
  }
  const beforePath = info.outputPath('paired-before.sceneweave'), afterPath = info.outputPath('paired-after.sceneweave')
  const inputs = [await packageInput(sourcePath, beforePath, withDoor), await packageInput(sourcePath, afterPath, changed)]
  await writeFile(info.outputPath('frozen-inputs.json'), JSON.stringify({ scope: '09 multi-Floor paired-private-mutation pixels/metadata and complete cold read', artifact, inputs, floors: [a, b], tolerance: 'exact RGBA SHA256 for same audience', P3: false }, null, 2))
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } }), other = await context.newPage()
  try {
    await load(page, beforePath); await load(other, afterPath)
    const before = await keyboardProjectBackup(page, info.outputPath('imported-before.sceneweave'))
    const after = await keyboardProjectBackup(other, info.outputPath('imported-after.sceneweave'))
    expect(importedContent(before.document)).toEqual(importedContent(withDoor.document))
    expect(importedContent(after.document)).toEqual(importedContent(changed.document))
    expect(keyboardResourceHashes(before.hashes)).toEqual(keyboardResourceHashes(source.hashes))
    expect(keyboardResourceHashes(after.hashes)).toEqual(keyboardResourceHashes(source.hashes))
    const aPlayer = await exportImage(page, a, 'player', info.outputPath('a-before-player.png'))
    const changedAPlayer = await exportImage(other, a, 'player', info.outputPath('a-after-player.png'))
    expect(changedAPlayer.rgbaSha256).toBe(aPlayer.rgbaSha256)
    const aGm = await exportImage(page, a, 'gm', info.outputPath('a-before-gm.png'))
    const changedAGm = await exportImage(other, a, 'gm', info.outputPath('a-after-gm.png'))
    expect(changedAGm.rgbaSha256).not.toBe(aGm.rgbaSha256)
    const bPlayer = await exportImage(page, b, 'player', info.outputPath('b-before-player.png'))
    const changedBPlayer = await exportImage(other, b, 'player', info.outputPath('b-after-player.png'))
    expect(changedBPlayer.rgbaSha256).not.toBe(bPlayer.rgbaSha256)
    expect(aPlayer.width).toBe(4096); expect(aPlayer.height).toBe(Math.round(4096 * 10000 / 14000))
    expect(bPlayer.width).toBe(4096); expect(bPlayer.height).toBe(3072)
    const masked = Math.floor(6500 / 10000 * aPlayer.height) * aPlayer.width + Math.floor(5000 / 14000 * aPlayer.width)
    expect(aPlayer.image.data[masked * 4 + 3]).toBe(255)
    expect(aPlayer.image.data[3]).toBe(0)
    await other.reload(); await other.getByRole('button', { name: '回到首页', exact: true }).click()
    await other.locator(`[data-project-key="native:${after.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(other)
    const cold = await keyboardProjectBackup(other, info.outputPath('paired-cold.sceneweave'))
    expect(cold.hashes).toEqual(after.hashes)
    const coldA = await exportImage(other, a, 'player', info.outputPath('a-cold-player.png'))
    expect(coldA.rgbaSha256).toBe(aPlayer.rgbaSha256)
    await writeFile(info.outputPath('floor-privacy-facts.json'), JSON.stringify({ artifact, inputs, sourceResourceCount: Object.keys(keyboardResourceHashes(source.hashes)).length, secretMutations: ['prop position/rotation', 'door offset/state/lock', 'wall thickness', 'note text', 'private light', 'private fog'], otherFloorMutations: ['same-XY public prop', 'environment'], aPlayer: facts(aPlayer), changedAPlayer: facts(changedAPlayer), aGm: facts(aGm), changedAGm: facts(changedAGm), bPlayer: facts(bPlayer), changedBPlayer: facts(changedBPlayer), coldA: facts(coldA), maskPixelAlpha: aPlayer.image.data[masked * 4 + 3], backgroundCornerAlpha: aPlayer.image.data[3], fullColdPackageHashesEqual: true, P3: false }, null, 2))
  } finally { await context.close() }
})
