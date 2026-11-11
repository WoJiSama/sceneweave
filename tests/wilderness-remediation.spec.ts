import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { THEME_PACK_CATALOGS } from '../src/shared/assets/theme-pack-catalogs'
import { projectScene } from '../src/shared/projection/projection'
import type { SceneDocument } from '../src/shared/model/scene'
import { resolveBuildingEntrancePort } from '../src/shared/generation/building-port'
import { checkTerrainRoute } from '../src/shared/geometry/terrain-travel'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved,
  openKeyboardPanel, selectKeyboardProp } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const geometry = (document: SceneDocument) => Object.fromEntries(([
  'floors', 'vertices', 'rooms', 'walls', 'openings', 'terrainAreas', 'terrainEdges',
  'terrainConnections', 'paths', 'props', 'prefabInstances', 'notes', 'entityLayers',
  'constraints', 'exportBoundsMm',
] as const).map(key => [key, document[key]]))

/** Read pixels from the actual downloaded browser PNG, with no production API. */
async function pngFacts(page: Page, filename: string) {
  const png = await readFile(filename)
  return page.evaluate(async encoded => {
    const response = await fetch(`data:image/png;base64,${encoded}`), image = await createImageBitmap(await response.blob())
    try {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
      const rgbaSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))).map(value => value.toString(16).padStart(2, '0')).join('')
      let nonTransparentPixels = 0
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) nonTransparentPixels++
      return { width: image.width, height: image.height, rgbaSha256, nonTransparentPixels }
    } finally { image.close() }
  }, png.toString('base64'))
}

test('wilderness v2 delivers the door-connected outpost layout and real mountain trail with cold save, managed edits, undo and both audiences', async ({ page, browser }, info) => {
  test.setTimeout(420_000)
  const errors: string[] = [], facts = []
  page.on('pageerror', error => errors.push(error.message))
  const pack = THEME_PACK_CATALOGS.find(pack => pack.id === 'wilderness')!
  expect(pack.fixedVersion).toBe(2)
  await createKeyboardProject(page, '温带荒野整改交付检查')
  await openWorkspaceModule(page, '素材')
  const panel = page.getByRole('region', { name: '主题素材包', exact: true })
  await panel.locator(':scope > details > summary').click()
  await panel.getByLabel('选择主题包', { exact: true }).selectOption('wilderness')
  await panel.getByRole('button', { name: '加载所选主题包', exact: true }).click()
  const { materials, props, prefabs } = pack.counts
  await expect(panel).toContainText(`已加载 ${materials} 材质、${props} 物件、${prefabs} 组合`, { timeout: 90_000 })
  await expect.poll(() => panel.locator('img').evaluateAll((images, total) => images.length === total
    && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0), materials + props + prefabs)).toBe(true)
  await panel.screenshot({ path: info.outputPath('wilderness-v2-palette.png') })
  await panel.getByText('两份可编辑代表场景', { exact: true }).click()
  for (const variant of [0, 1]) {
    const prefix = `wilderness-v2-${variant + 1}`, sourcePath = info.outputPath(`${prefix}.sceneweave`)
    const downloading = page.waitForEvent('download')
    await panel.getByRole('button', { name: /^下载场景 ·/ }).nth(variant).click()
    await (await downloading).saveAs(sourcePath)
    await expect(panel.getByRole('button', { name: '加载所选主题包', exact: true })).toBeEnabled()
    const archive = unzipSync(new Uint8Array(await readFile(sourcePath)))
    const source = JSON.parse(new TextDecoder().decode(archive['scene.json'])) as SceneDocument
    const context = await browser.newContext()
    try {
      const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message))
      const home = new URL('./#home', page.url()).href
      await target.goto(home)
      const choosing = target.waitForEvent('filechooser')
      await target.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
      await (await choosing).setFiles(sourcePath); await keyboardWorkspaceSaved(target)
      const opened = await keyboardProjectBackup(target, info.outputPath(`${prefix}-opened.sceneweave`))
      expect(geometry(opened.document)).toEqual(geometry(source))
      expect(Object.keys(keyboardResourceHashes(opened.hashes)).length).toBeGreaterThan(28)
      for (const definition of [...Object.values(opened.document.propDefinitions), ...Object.values(opened.document.materials), ...Object.values(opened.document.prefabDefinitions)]) {
        expect(definition.version).toBe(2)
      }
      if (variant === 0) {
        expect(source.presetSnapshot).toMatchObject({ presetId: 'sceneweave-outpost-layout', presetVersion: 1 })
        expect(Object.keys(source.rooms)).toHaveLength(2)
        expect(Object.values(source.openings).filter(opening => opening.kind === 'door')).toHaveLength(2)
        const usedKeys = Object.values(source.props).map(prop => prop.definitionRef!.id)
        for (const key of ['canvas-tent', 'torn-tent', 'scattered-gear', 'field-cot', 'watch-table']) {
          expect(usedKeys.some(id => id.includes(`-${key}-v2`))).toBe(true)
        }
        expect(Object.values(source.paths).some(path => path.centerlineMm.length > 2)).toBe(true)
        const entranceRoad = source.paths['theme-sample-path-2']
        const port = resolveBuildingEntrancePort(source, 'watch-entrance', entranceRoad.widthMm)
        expect(entranceRoad.centerlineMm[0]).toEqual(port.outsideMm)
        expect(checkTerrainRoute(source, { floorId: port.floorId, pointsMm: [port.insideMm, ...entranceRoad.centerlineMm], widthMm: entranceRoad.widthMm }).issues).toEqual([])
        expect(Object.keys(source.scatterGroups)).toHaveLength(3)
        expect(source.terrainAreas['sample-ground'].surfaceStyle!.overlays.filter(overlay => overlay.id.startsWith('outpost-transition-'))).toHaveLength(6)
      } else {
        expect(Object.values(source.terrainAreas).some(area => area.groundElevationMm > 0)).toBe(true)
        expect(Object.values(source.terrainEdges).some(edge => edge.kind === 'cliff' && edge.blocksMovement)).toBe(true)
        expect(Object.values(source.terrainAreas).some(area => area.blocksMovement)).toBe(true)
        expect(Object.values(source.terrainConnections).some(connection => connection.kind === 'ramp'
          && connection.from.surfaceRef.id !== connection.to.surfaceRef.id && !connection.blocksMovement)).toBe(true)
      }
      const gmNotes = Object.values(source.notes).filter(note => note.visibility === 'gm')
      expect(gmNotes.length).toBeGreaterThan(0)
      const gmProjection = projectScene(source, 'gm'), playerProjection = projectScene(source, 'player')
      for (const note of gmNotes) {
        expect(JSON.stringify(gmProjection)).toContain(note.text)
        expect(JSON.stringify(playerProjection)).not.toContain(note.text)
        expect(JSON.stringify(playerProjection)).not.toContain(note.id)
      }
      await target.getByLabel('材质场景主持人预览', { exact: true }).screenshot({ path: info.outputPath(`${prefix}-map.png`) })
      await target.reload(); await target.getByRole('button', { name: '回到首页', exact: true }).click()
      // Import assigns a fresh local scene identity while preserving content.
      await target.getByTestId('workspace-home').locator(`[data-project-key="native:${opened.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
      await keyboardWorkspaceSaved(target)
      const cold = await keyboardProjectBackup(target, info.outputPath(`${prefix}-cold.sceneweave`))
      expect(cold.hashes).toEqual(opened.hashes)
      const memberIds = new Set(Object.values(cold.document.prefabInstances).flatMap(prefab => Object.values(prefab.members).map(member => member.propId)))
      const movable = Object.values(cold.document.props).filter(prop => !memberIds.has(prop.id))
      const managedPropId = Object.values(cold.document.scatterGroups)[0]?.members
        && Object.values(Object.values(cold.document.scatterGroups)[0].members).find(member => member.propId)?.propId
      const prop = (variant === 0 && managedPropId ? movable.find(prop => prop.id === managedPropId) : undefined)
        ?? movable.find(prop => prop.definitionRef?.id.includes('-map-roll-'))
        ?? movable.find(prop => !prop.blocksMovement) ?? movable[0]
      expect(prop).toBeTruthy()
      await selectKeyboardProp(target, prop.id)
      const inspector = await openKeyboardPanel(target, 'inspector')
      await inspector.getByLabel('物件 X', { exact: true }).fill(String((prop.positionMm.x + 1) / 1000))
      await inspector.getByLabel('物件 X', { exact: true }).press('Enter')
      if (variant === 0) {
        // Managed scatter members use the ordinary outdoor dependency preview.
        const review = target.getByRole('region', { name: '候选审阅', exact: true })
        await expect(review).toBeVisible()
        await review.getByLabel('确认完整影响范围', { exact: true }).check()
        await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
        await expect(review).toHaveCount(0)
      }
      await keyboardWorkspaceSaved(target)
      const edited = await keyboardProjectBackup(target, info.outputPath(`${prefix}-edited.sceneweave`))
      expect(edited.document.props[prop.id].positionMm.x).toBe(prop.positionMm.x + 1)
      expect(edited.document.revision).toBeGreaterThan(cold.document.revision)
      expect(keyboardResourceHashes(edited.hashes)).toEqual(keyboardResourceHashes(cold.hashes))
      const expectedProps = structuredClone(cold.document.props)
      expectedProps[prop.id].positionMm.x += 1
      expect(edited.document.props).toEqual(expectedProps)
      if (variant === 0) {
        const group = Object.values(edited.document.scatterGroups).find(group => Object.values(group.members).some(member => member.propId === prop.id))!
        expect(Object.values(group.members).find(member => member.propId === prop.id)).toMatchObject({ state: 'manual', overrideFields: ['positionMm'] })
      }
      await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
      const undone = await keyboardProjectBackup(target, info.outputPath(`${prefix}-undone.sceneweave`))
      expect(geometry(undone.document)).toEqual(geometry(cold.document))
      expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(cold.hashes))
      const maps = {} as Record<'gm' | 'player', Awaited<ReturnType<typeof pngFacts>>>
      for (const audience of ['gm', 'player'] as const) {
        const output = info.outputPath(`${prefix}-${audience}-4096.png`), exporting = target.waitForEvent('download')
        await (await mapExportButton(target, audience)).click(); await (await exporting).saveAs(output)
        await target.locator('.workspace-export-menu > summary').click()
        maps[audience] = await pngFacts(target, output)
        expect(Math.max(maps[audience].width, maps[audience].height)).toBe(4096)
        expect(maps[audience].nonTransparentPixels).toBeGreaterThan(maps[audience].width * maps[audience].height / 2)
      }
      expect(maps.gm.width).toBe(maps.player.width); expect(maps.gm.height).toBe(maps.player.height)
      expect(maps.gm.rgbaSha256).not.toBe(maps.player.rgbaSha256)
      const final = await keyboardProjectBackup(target, info.outputPath(`${prefix}-final.sceneweave`))
      expect(final.hashes).toEqual(undone.hashes)
      facts.push({ variant, sceneId: source.sceneId, title: source.title, maps,
        rooms: Object.keys(source.rooms).length, props: Object.keys(source.props).length,
        terrainAreas: Object.keys(source.terrainAreas).length, paths: Object.keys(source.paths).length,
        terrainConnections: Object.keys(source.terrainConnections).length,
        resourceHashes: keyboardResourceHashes(final.hashes), privateNotesFiltered: gmNotes.length,
        editedProp: prop.id, coldReadEqual: true, editAndUndoEqual: true, exportReadOnly: true })
    } finally { await context.close() }
  }
  expect(errors).toEqual([])
  await writeFile(info.outputPath('wilderness-v2-facts.json'), JSON.stringify({ facts, errors }, null, 2))
})
