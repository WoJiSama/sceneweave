import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Workspace } from '../src/application/workspace/workspace.js'

type Dev = { workspace: Workspace }
const review = resolve('work/terrain-followup-20261027/t4/review')
const save = async (name: string, base64: string): Promise<void> => { await mkdir(review, { recursive: true }); await writeFile(resolve(review, name), Buffer.from(base64, 'base64')) }

test('T4 real near-side sources retain the old terrain/roots, save complete bytes and export actual dual 4K', async ({ page }, info) => {
  test.setTimeout(900000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#workspace')
  await page.waitForFunction(() => Boolean(Reflect.get(window, '__sceneweaveOutdoorDev')))
  const result = await page.evaluate(async () => {
    const contentPath = '/src/platform/browser/content/near-side.ts', oldPath = '/src/platform/browser/content/refined-island.ts', runtimePath = '/src/platform/browser/runtime.ts'
    const projectPath = '/src/application/workspace/project.ts', renderPath = '/src/platform/browser/render/renderer.ts', filePath = '/src/shared/project/file.ts'
    const jsonPath = '/src/shared/validation/json.ts', hashPath = '/src/shared/validation/hash.ts', appearancePath = '/src/shared/appearance/presentation.ts'
    const { createNearSideIslandProject } = await import(contentPath) as typeof import('../src/platform/browser/content/near-side')
    const { createRefinedIslandProject } = await import(oldPath) as typeof import('../src/platform/browser/content/refined-island')
    const { projectRepository, validation } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { toBundle, captureEditableDraft, validateEditableProject } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { exportPng, renderEditorProject, exportPublicViewportPng } = await import(renderPath) as typeof import('../src/platform/browser/render/renderer')
    const { exportProject, importProject } = await import(filePath) as typeof import('../src/shared/project/file')
    const { canonicalJson } = await import(jsonPath) as typeof import('../src/shared/validation/json')
    const { effectivePropShadow, propPresentation } = await import(appearancePath) as typeof import('../src/shared/appearance/presentation')
    const { sha256Bytes } = await import(hashPath) as typeof import('../src/shared/validation/hash')
    const encode = (bytes: Uint8Array) => { let value = ''; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(value) }
    const neutral = async (source: import('../src/application/workspace/project').EditableProject) => {
      const value = captureEditableDraft(source), visual = value.document.visual!, base = visual.version === 1 ? visual : visual.base
      base.environment.ambientOpacity = 0; base.environment.exposure = 1
      for (const fog of Object.values(base.fogs)) fog.enabled = false
      for (const filter of Object.values(base.filters)) filter.enabled = false
      return validateEditableProject(value, validation)
    }
    const old = await createRefinedIslandProject(), created = await createNearSideIslandProject()
    const before = await neutral(old), after = await neutral(created), scene = after.document
    const rootsSame = Object.entries(before.document.props).every(([id, p]) => canonicalJson({ positionMm: p.positionMm, footprintMm: p.footprintMm, supportRef: p.supportRef, blocksMovement: p.blocksMovement, blocksSight: p.blocksSight }) === canonicalJson({ positionMm: scene.props[id].positionMm, footprintMm: scene.props[id].footprintMm, supportRef: scene.props[id].supportRef, blocksMovement: scene.props[id].blocksMovement, blocksSight: scene.props[id].blocksSight }))
    const terrainSame = canonicalJson(before.document.terrainAreas) === canonicalJson(scene.terrainAreas) && canonicalJson(before.document.terrainConnections) === canonicalJson(scene.terrainConnections)
    const sourceBytesSame = Object.entries(before.document.assets).every(([id, asset]) => scene.assets[id]?.sha256 === asset.sha256)
    const nearIds = Object.keys(scene.props).filter(id => propPresentation(after.appearance, id)?.mode === 'nearSide')
    const nearSampleShadow = effectivePropShadow(scene.props[nearIds[0]], propPresentation(after.appearance, nearIds[0]), scene.activeStyleThemeRef ? scene.styleThemes[scene.activeStyleThemeRef.id]?.shadowPresets.vegetation : null)
    const normalHash = sha256Bytes(new TextEncoder().encode(canonicalJson(toBundle(after).project)))
    const helper = await renderEditorProject(toBundle(after), { audience: 'gm', longEdgePx: 2048, groundView: true })
    const context = helper.getContext('2d')!, bounds = scene.exportBoundsMm, scale = helper.width / bounds.width
    context.save(); context.scale(scale, scale); context.translate(-bounds.x, -bounds.y); context.lineWidth = 18; context.strokeStyle = '#B21D3D'; context.fillStyle = '#B21D3D'
    for (const id of nearIds) { const p = scene.props[id]; context.strokeRect(p.positionMm.x - p.footprintMm.width / 2, p.positionMm.y - p.footprintMm.height / 2, p.footprintMm.width, p.footprintMm.height); context.beginPath(); context.moveTo(p.positionMm.x - 120, p.positionMm.y); context.lineTo(p.positionMm.x + 120, p.positionMm.y); context.moveTo(p.positionMm.x, p.positionMm.y - 120); context.lineTo(p.positionMm.x, p.positionMm.y + 120); context.stroke() }
    context.restore()
    const helperBase64 = helper.toDataURL('image/png').split(',')[1]
    const afterGroundHash = sha256Bytes(new TextEncoder().encode(canonicalJson(toBundle(after).project)))
    const images: Record<string, string> = { 'roots-and-footprints.png': helperBase64 }
    for (const [name, bundle, audience, longEdgePx] of [
      ['before-neutral.png', toBundle(before), 'gm', 2048], ['after-neutral.png', toBundle(after), 'gm', 2048],
      ['near-side-gm-4k.png', toBundle(after), 'gm', 4096], ['near-side-player-4k.png', toBundle(after), 'player', 4096],
    ] as const) images[name] = encode(new Uint8Array(await (await exportPng(bundle, { audience, longEdgePx })).arrayBuffer()))
    images['fixed-closeup.png'] = encode(new Uint8Array(await (await exportPublicViewportPng(toBundle(after), { x: 9300, y: 3800, width: 7800, height: 7200 }, 1600)).arrayBuffer()))
    const bytes = await exportProject(toBundle(after), validation), reimported = await importProject(bytes, validation)
    const packageSame = canonicalJson(reimported.project) === canonicalJson(toBundle(after).project)
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace
    await workspace.flush(); await projectRepository.save(toBundle(after), null); await workspace.openPersisted(after); await workspace.flush()
    const cold = await projectRepository.load(scene.sceneId)
    if (!cold) throw new Error('T4 saved scene missing on cold load')
    const coldSame = canonicalJson(cold.project) === canonicalJson(toBundle(after).project)
    const facts = { schemaVersion: after.schemaVersion, assetCount: Object.keys(after.assets).length, sourceCount: Object.keys(after.authoringSources).length, licenses: Object.keys(after.licenses).length, nearIds, rootsSame, terrainSame, sourceBytesSame, normalHash, afterGroundHash, packageSame, coldSame, nearRotations: nearIds.map(id => scene.props[id].rotationDeg), nearSampleShadow, sceneId: scene.sceneId }
    Reflect.set(window, '__nearSideTestProject', after)
    return { facts, images, package: encode(bytes) }
  })
  expect(result.facts).toMatchObject({ schemaVersion: 3, assetCount: 20, sourceCount: 19, licenses: 2, rootsSame: true, terrainSame: true, sourceBytesSame: true, packageSame: true, coldSame: true, nearSampleShadow: { directionDeg: 50, offsetMm: 150, blurMm: 48, opacity: .12, color: '#32493F' } })
  expect(result.facts.nearIds).toHaveLength(20)
  expect(result.facts.nearRotations.every(rotation => rotation === 0)).toBe(true)
  expect(result.facts.afterGroundHash).toBe(result.facts.normalHash)
  for (const [name, base64] of Object.entries(result.images)) await save(name, base64)
  await save('near-side-island.sceneweave', result.package)
  await writeFile(resolve(review, 'content-facts.json'), JSON.stringify(result.facts, null, 2))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90000 })
  await page.screenshot({ path: resolve(review, 'workspace-near-side.png') })
  expect(errors).toEqual([])
  await info.attach('t4-content-facts', { body: JSON.stringify(result.facts), contentType: 'application/json' })
})

test('T4 personal-library backup retains root/source/PNG and private paired player 4K is identical', async ({ page }, info) => {
  test.setTimeout(900000)
  await page.goto('/#workspace')
  const result = await page.evaluate(async () => {
    const contentPath = '/src/platform/browser/content/near-side.ts', runtimePath = '/src/platform/browser/runtime.ts', projectPath = '/src/application/workspace/project.ts'
    const libraryPath = '/src/shared/library/index.ts', rendererPath = '/src/platform/browser/render/renderer.ts', graphPath = '/src/shared/appearance/graph.ts'
    const jsonPath = '/src/shared/validation/json.ts', presentationPath = '/src/shared/appearance/presentation.ts', commandPath = '/src/shared/appearance/commands.ts'
    const { createNearSideIslandProject, nearSideDefinitionId } = await import(contentPath) as typeof import('../src/platform/browser/content/near-side')
    const { validation, runtime } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
    const { toBundle, captureEditableDraft, validateEditableProject, fromBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { prepareLibraryEntry, exportLibraryBackup, importLibraryBackup, loadLibraryCapsule, adoptLibraryEntries } = await import(libraryPath) as typeof import('../src/shared/library')
    const { renderProject, exportPng } = await import(rendererPath) as typeof import('../src/platform/browser/render/renderer')
    const { addPropAppearanceSource } = await import(graphPath) as typeof import('../src/shared/appearance/graph')
    const { canonicalJson } = await import(jsonPath) as typeof import('../src/shared/validation/json')
    const { effectivePropShadow, propPresentation, definitionPresentation } = await import(presentationPath) as typeof import('../src/shared/appearance/presentation')
    const { applyCompositionCommands } = await import(commandPath) as typeof import('../src/shared/appearance/commands')
    const project = await createNearSideIslandProject(), selector = { kind: 'prop' as const, definitionId: nearSideDefinitionId('near-oak') }
    const entry = await prepareLibraryEntry(toBundle(project), selector, validation), backup = await exportLibraryBackup({ entries: [entry], organizations: {} }, validation)
    const recovered = await importLibraryBackup(backup, validation), capsule = await loadLibraryCapsule(recovered.entries[0], validation)
    const blankPath = '/src/platform/browser/content/refined-blank.ts', terrainPath = '/src/application/workspace/terrain.ts'
    const { createRefinedBlankProject } = await import(blankPath) as typeof import('../src/platform/browser/content/refined-blank')
    const { prepareTerrainUpgrade } = await import(terrainPath) as typeof import('../src/application/workspace/terrain')
    const originalBlank = await createRefinedBlankProject('island', { title: 'T4 offline library placement', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
    const blank = await prepareTerrainUpgrade(originalBlank, { runtime, validation })
    const targetInitiallyMissing = !blank.document.propDefinitions[selector.definitionId]
    const adopted = await adoptLibraryEntries(toBundle(blank), recovered.entries, validation), editable = await fromBundle(adopted.bundle, validation)
    const sourcePresentation = definitionPresentation(project.appearance, { id: selector.definitionId, version: 1 }), capsulePresentation = definitionPresentation(capsule.project.appearance, { id: selector.definitionId, version: 1 }), adoptedPresentation = definitionPresentation(editable.appearance, { id: selector.definitionId, version: 1 })
    const placed = applyCompositionCommands({ document: editable.document, historyIdentity: editable.historyIdentity, appearance: editable.appearance }, [{ type: 'addProp', id: 'library-tree', floorId: 'visual-floor', definitionRef: { id: selector.definitionId, version: 1 }, positionMm: { x: 12000, y: 9000 }, rotationDeg: 0, supportRef: { kind: 'floor', id: 'visual-floor' }, layerId: 'visual-layer-props' }], runtime)
    const placement = await validateEditableProject({ ...editable, ...placed }, validation)
    const activeTheme = placement.document.activeStyleThemeRef && placement.document.styleThemes[placement.document.activeStyleThemeRef.id]
    const placementShadow = effectivePropShadow(placement.document.props['library-tree'], propPresentation(placement.appearance, 'library-tree'), activeTheme?.shadowPresets.vegetation)
    const placedCanvas = await renderProject(toBundle(placement), { audience: 'gm', longEdgePx: 1600 })
    const privateA = captureEditableDraft(project), privateB = captureEditableDraft(project)
    const id = Object.keys(project.document.props).find(id => propPresentation(project.appearance, id)?.mode === 'nearSide')!
    privateA.document.props[id].visibility = 'gm'; privateB.document.props[id].visibility = 'gm'
    privateB.document.props[id].positionMm.x += 400
    const privateProp = privateA.document.props[id], maskPadding = 3000
    const maskLeft = privateProp.positionMm.x + privateProp.visualBoundsMm.x - maskPadding
    const maskTop = privateProp.positionMm.y + privateProp.visualBoundsMm.y - maskPadding
    const maskRight = privateProp.positionMm.x + privateProp.visualBoundsMm.x + privateProp.visualBoundsMm.width + maskPadding + 400
    const maskBottom = privateProp.positionMm.y + privateProp.visualBoundsMm.y + privateProp.visualBoundsMm.height + maskPadding
    for (const draft of [privateA, privateB]) {
      draft.document.regions['t4-private-near-side-mask'] = { id: 't4-private-near-side-mask', floorId: privateProp.floorId, editLocked: false,
        visibility: 'gm', kind: 'manualMask', boundaryMm: [{ x: maskLeft, y: maskTop }, { x: maskRight, y: maskTop }, { x: maskRight, y: maskBottom }, { x: maskLeft, y: maskBottom }],
        blocksMovement: false, movementCostMultiplier: 1 }
      draft.document.entityLayers['t4-private-near-side-mask'] = draft.document.entityLayers[id]
    }
    const a = await validateEditableProject(privateA, validation), b = await validateEditableProject(privateB, validation)
    const ca = await renderProject(toBundle(a), { audience: 'player', longEdgePx: 4096 }), cb = await renderProject(toBundle(b), { audience: 'player', longEdgePx: 4096 })
    const av = ca.getContext('2d')!.getImageData(0, 0, ca.width, ca.height).data, bv = cb.getContext('2d')!.getImageData(0, 0, cb.width, cb.height).data
    let difference = 0; for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) difference++
    const encode = (bytes: Uint8Array) => { let value = ''; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(value) }
    return { facts: { backupCount: recovered.entries.length, capsuleVersion: capsule.project.schemaVersion, presentationSame: canonicalJson(sourcePresentation) === canonicalJson(capsulePresentation) && canonicalJson(sourcePresentation) === canonicalJson(adoptedPresentation), capsuleSourceCount: Object.keys(capsule.project.authoringSources).length, privateDifference: difference, privateDimensions: [ca.width, ca.height], targetInitiallyMissing, placementPresentation: propPresentation(placed.appearance, 'library-tree'), placementShadow }, placement: placedCanvas.toDataURL('image/png').split(',')[1], backup: encode(backup), privateA: ca.toDataURL('image/png').split(',')[1], privateB: cb.toDataURL('image/png').split(',')[1] }
  })
  expect(result.facts).toMatchObject({ backupCount: 1, capsuleVersion: 3, presentationSame: true, capsuleSourceCount: 1, privateDifference: 0, privateDimensions: [4096, 3072], targetInitiallyMissing: true, placementPresentation: { mode: 'nearSide', orientation: 'fixedUpright', footprintAxes: 'world' }, placementShadow: { directionDeg: 50, offsetMm: 150, blurMm: 48, opacity: .12, color: '#32493F' } })
  await save('library-placed.png', result.placement)
  await save('near-oak.sceneweave-library', result.backup); await save('private-a-player-4k.png', result.privateA); await save('private-b-player-4k.png', result.privateB)
  await writeFile(resolve(review, 'library-private-facts.json'), JSON.stringify(result.facts, null, 2))
  await info.attach('t4-library-private-facts', { body: JSON.stringify(result.facts), contentType: 'application/json' })
})
