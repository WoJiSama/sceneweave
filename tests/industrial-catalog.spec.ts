import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openOutdoorTask, openSceneObjects, openSceneSettings, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, openDetailsBySummary } from './workspace-ux-helpers'
import { acknowledgeAssetQuality } from './asset-quality-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const pipeStyleId = 'industrial-cyberpunk-prefab-cable-run-v2'
test.use({ actionTimeout: 15_000 })
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })

async function adopt(page: Page, kind: '组件' | '室外' | '结构') {
  if (kind === '组件') await acknowledgeAssetQuality(page)
  else await review(page).getByLabel('确认完整影响范围', { exact: true }).check()
  await review(page).getByRole('button', { name: `采用${kind}修改`, exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

async function terrain(page: Page, material: string, outline: string) {
  const panel = await openOutdoorTask(page, '地形与高程')
  await openDetailsBySummary(panel, /^精确坐标 · 区域轮廓$/)
  await panel.getByLabel('室外坐标', { exact: true }).fill(outline)
  await panel.getByLabel('地形材质', { exact: true }).selectOption(material)
  await panel.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await adopt(page, '室外')
}

async function pixels(page: Page, filename: string, audience: 'player' | 'gm') {
  const download = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await download).saveAs(filename)
  await page.locator('details.workspace-export-menu > summary').click()
  const image = PNG.sync.read(await readFile(filename)) as { width: number; height: number; data: Uint8Array }
  return (u: number, v: number) => {
    const index = 4 * (Math.floor(v * image.height) * image.width + Math.floor(u * image.width))
    return Array.from(image.data.slice(index, index + 4))
  }
}

async function editorPixel(page: Page, u: number, v: number) {
  return page.getByLabel('材质场景主持人预览', { exact: true }).evaluate((element, { u, v }) => {
    const canvas = element as HTMLCanvasElement
    return Array.from(canvas.getContext('2d')!.getImageData(Math.floor(u * canvas.width), Math.floor(v * canvas.height), 1, 1).data)
  }, { u, v })
}

test('adopts industrial fixed sources and stacks independently editable floors in real audience PNGs', async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '工业赛博朋克楼层叠绘')
  const materials = await openWorkspaceModule(page, '素材')
  const packs = materials.getByLabel('主题素材包', { exact: true })
  await openDetailsBySummary(packs, /^主题素材包 ·/)
  await packs.getByLabel('查找主题包', { exact: true }).fill('赛博朋克')
  await packs.getByLabel('选择主题包', { exact: true }).selectOption('industrial')
  await packs.getByRole('button', { name: '加载所选主题包', exact: true }).click()
  await expect(packs).toContainText('已加载 9 材质、19 物件、5 组合', { timeout: 90_000 })
  await packs.getByRole('button', { name: '全选包内素材', exact: true }).click()
  await packs.getByRole('button', { name: '预览添加所选 33 项主题素材', exact: true }).click()
  await expect(review(page)).toContainText('33 项素材', { timeout: 90_000 })
  await adopt(page, '组件')
  const stored = await keyboardProjectBackup(page, info.outputPath('industrial-sources.sceneweave'))
  const lower = Object.keys(stored.document.floors)[0]
  expect(stored.document.materials['industrial-cyberpunk-material-deck-v1'].applicableSurfaces).toContain('path')
  expect(stored.document.propDefinitions['industrial-cyberpunk-prop-compressor-roof-v1'].defaultAppearance.kind).toBe('image')
  expect(stored.document.prefabDefinitions['industrial-cyberpunk-prefab-ember-bridge-v2'].pathStyle?.structure?.palette).toBe('riveted')
  expect(stored.document.prefabDefinitions['industrial-cyberpunk-prefab-service-fence-v1'].pathStyle?.dimensions?.footprintWidthMm).toBe(220)

  await terrain(page, 'industrial-cyberpunk-material-concrete-v1', '1000,1000\n10100,1000\n10100,9200\n1000,9200')
  const layout = await keyboardProjectBackup(page, info.outputPath('industrial-lower.sceneweave'))
  const platform = Object.keys(layout.document.terrainAreas)[0]
  const pipeForm = await openOutdoorTask(page, '实体围栏')
  await pipeForm.getByLabel('重复源节', { exact: true }).selectOption('prefab:' + pipeStyleId)
  await openDetailsBySummary(pipeForm, /^精确坐标 · 围栏路线$/)
  await pipeForm.getByLabel('沿线构件坐标', { exact: true }).fill('1500,4300\n8100,4300\n8100,7000')
  await openDetailsBySummary(pipeForm, /^入口与端部留空$/)
  await pipeForm.getByRole('button', { name: '添加沿线开口', exact: true }).click()
  for (const [name, value] of [['开口开始里程 1', '2'], ['开口结束里程 1', '3.5']]) {
    const input = pipeForm.getByLabel(name, { exact: true })
    await input.fill(value)
    await input.press('Tab')
  }
  await pipeForm.getByRole('button', { name: '预览实体围栏', exact: true }).click()
  await adopt(page, '室外')

  const objects = await openSceneObjects(page)
  await objects.getByLabel('搜索场景对象', { exact: true }).fill(platform)
  await objects.locator(`.asset-entity-list [data-entity-id=${JSON.stringify(platform)}]`).click()
  const inspector = page.getByTestId('workspace-inspector')
  await openDetailsBySummary(inspector, /^平台边缘$/)
  await inspector.getByLabel('收边范围', { exact: true }).selectOption({ label: '完整轮廓' })
  await inspector.getByLabel('收边材质', { exact: true }).selectOption('industrial-cyberpunk-material-riveted-rim-v1')
  const stroke = inspector.getByLabel('边沿线宽', { exact: true })
  await stroke.fill('0.32')
  await stroke.press('Tab')
  await inspector.getByRole('button', { name: '预览平台边缘', exact: true }).click()
  await adopt(page, '室外')

  const settings = await openSceneSettings(page)
  await openDetailsBySummary(settings, /^楼层管理 ·/)
  const floors = settings.getByLabel('楼层管理', { exact: true })
  await floors.getByLabel('新楼层名称', { exact: true }).fill('吊运甲板')
  for (const name of ['新楼层宽度', '新楼层高度']) {
    const input = floors.getByLabel(name, { exact: true })
    await input.fill('12'); await input.press('Tab')
  }
  await floors.getByRole('button', { name: '预览新建楼层', exact: true }).click()
  await adopt(page, '结构')
  const floorPicker = page.getByRole('combobox', { name: '当前楼层', exact: true })
  await floorPicker.selectOption({ label: '吊运甲板' })
  const upper = await floorPicker.inputValue()
  await terrain(page, 'industrial-cyberpunk-material-deck-v1', '4400,4400\n11400,4400\n11400,7600\n4400,7600')
  const standalone = await pixels(page, info.outputPath('industrial-upper.png'), 'player')
  const blankEditorPixel = await editorPixel(page, .22, .22)

  const scene = await openWorkspaceModule(page, '场景')
  const underlay = scene.getByLabel('楼层叠绘', { exact: true })
  await openDetailsBySummary(scene, /^楼层叠绘$/)
  await underlay.getByLabel('下方楼层', { exact: true }).selectOption(lower)
  await underlay.getByRole('button', { name: '预览楼层叠绘', exact: true }).click()
  await adopt(page, '结构')
  await expect.poll(() => editorPixel(page, .22, .22)).not.toEqual(blankEditorPixel)
  const combined = await pixels(page, info.outputPath('industrial-combined-player.png'), 'player')
  expect(combined(.22, .22)).not.toEqual(standalone(.22, .22))
  expect(combined(.51, .51)).toEqual(standalone(.51, .51))
  const gm = await pixels(page, info.outputPath('industrial-combined-gm.png'), 'gm')
  expect(gm(.22, .22)).toEqual(combined(.22, .22))
  const filename = info.outputPath('industrial-stacked.sceneweave')
  const saved = await keyboardProjectBackup(page, filename)
  const pipe = Object.values(saved.document.visual.base.base.boundaries).find(boundary => boundary.fence)!
  expect(pipe.fence?.recipe.section).toMatchObject({ kind: 'prefab', ref: { id: pipeStyleId, version: 2 } })
  expect(pipe.fence?.recipe.gaps).toEqual([{ side: 'both', fromMm: 2000, toMm: 3500 }])
  expect(Object.keys(pipe.fence!.members).filter(key => key.endsWith(':pipeBend'))).toHaveLength(1)
  expect(Object.keys(pipe.fence!.members).filter(key => /:(startSocket|endSocket)$/.test(key))).toHaveLength(4)
  expect(saved.document.floors[upper].underlayFloorId).toBe(lower)
  const rim = Object.values(saved.document.terrainEdges).filter(edge => edge.source.areaId === platform)
  expect(rim).toHaveLength(4)
  expect(rim.every(edge => edge.styleOverride?.strokeWidthMm === 320 && edge.surfaceStyle?.base.materialRef.id === 'industrial-cyberpunk-material-riveted-rim-v1')).toBe(true)
  const cold = await browser.newContext()
  try {
    const editor = await cold.newPage()
    await editor.goto('./#home')
    const choosing = editor.waitForEvent('filechooser')
    await editor.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
    await (await choosing).setFiles(filename)
    await keyboardWorkspaceSaved(editor)
    await expect(editor.getByRole('combobox', { name: '当前楼层', exact: true })).toHaveValue(upper)
    const reopened = await keyboardProjectBackup(editor, info.outputPath('industrial-reopened.sceneweave'))
    expect(reopened.document.sceneId).not.toBe(saved.document.sceneId)
    expect(keyboardResourceHashes(reopened.hashes)).toEqual(keyboardResourceHashes(saved.hashes))
    expect(reopened.document.visual.base.base.boundaries[pipe.id]).toEqual(pipe)
    const scene = await openWorkspaceModule(editor, '场景')
    await openDetailsBySummary(scene, /^楼层叠绘$/)
    await expect(scene.getByLabel('下方楼层', { exact: true })).toHaveValue(lower)
    await scene.getByLabel('下方楼层', { exact: true }).selectOption('')
    await scene.getByRole('button', { name: '预览楼层叠绘', exact: true }).click()
    await adopt(editor, '结构')
    const edited = await keyboardProjectBackup(editor, info.outputPath('industrial-reedited.sceneweave'))
    expect(edited.document.floors[upper].underlayFloorId).toBeUndefined()
    expect(edited.document.sceneId).toBe(reopened.document.sceneId)
    expect(edited.document.revision).toBe(reopened.document.revision + 1)
  } finally { await cold.close() }
  expect(errors).toEqual([])
})


test('generates, edits and reopens both industrial scenes with replaceable floor artwork', async ({ page, browser }, info) => {
  test.setTimeout(650_000)
  await createKeyboardProject(page, '工业代表场景下载')
  const materials = await openWorkspaceModule(page, '素材')
  const packs = materials.getByLabel('主题素材包', { exact: true })
  await openDetailsBySummary(packs, /^主题素材包 ·/)
  await packs.getByLabel('选择主题包', { exact: true }).selectOption('industrial')
  await openDetailsBySummary(packs, /^两份可编辑代表场景$/)
  const packages = []
  const background = new PNG({ width: 60, height: 46 })
  for (let i = 0; i < background.data.length; i += 4) background.data.set([77, 33, 54, 255], i)
  const backgroundBytes = PNG.sync.write(background)
  for (const title of ['碧脉冷却枢纽', '暮港吊运环线']) {
    const filename = info.outputPath(title + '.sceneweave')
    const downloading = page.waitForEvent('download', { timeout: 180_000 })
    await packs.getByRole('button', { name: '下载场景 · ' + title, exact: true }).click()
    await (await downloading).saveAs(filename)
    const context = await browser.newContext()
    try {
      const editor = await context.newPage()
      await editor.goto(new URL('./#home', page.url()).href)
      const choosing = editor.waitForEvent('filechooser')
      await editor.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
      await (await choosing).setFiles(filename)
      await keyboardWorkspaceSaved(editor)
      await expect(editor.getByRole('combobox', { name: '当前楼层', exact: true })).toHaveValue('upper')
      const { document } = await keyboardProjectBackup(editor, info.outputPath(title + '-reopened.sceneweave'))
      expect(document.title).toBe(title)
      expect(Object.keys(document.floors)).toHaveLength(3)
      expect(document.floors.upper.underlayFloorId).toBe('lower')
      expect(document.floors.lower.links?.[0].targetFloorId).toBe('upper')
      expect(Object.keys(document.rooms)).toHaveLength(2)
      expect(Object.values(document.pathAttachments ?? {})).toHaveLength(2)
      const facadeArea = Object.values(document.terrainAreas).find(area => area.floorId === 'upper' && area.facade)!
      expect(facadeArea.facade).toBeDefined()
      const floor = editor.getByRole('combobox', { name: '当前楼层', exact: true })
      const backdrop = document.floors.lower.underlayFloorId!
      expect(document.floors[backdrop].artwork).toBeDefined()
      expect(Object.values(document.props).some(prop => prop.floorId === backdrop)).toBe(false)
      const pipes = Object.values(document.visual.base.base.boundaries).filter(boundary => {
        const section = boundary.fence?.recipe.section
        return section?.kind === 'prefab' && section.ref.id === pipeStyleId
      })
      expect(pipes.length).toBeGreaterThanOrEqual(3)
      for (const pipe of pipes) {
        const members = Object.keys(pipe.fence!.members)
        for (const fitting of ['pipeBend', 'startSocket', 'endSocket']) {
          expect(members.some(key => key.endsWith(':' + fitting))).toBe(true)
        }
      }
      expect(Object.values(document.terrainEdges).some(edge => edge.surfaceStyle?.base.materialRef.id === 'industrial-cyberpunk-material-alloy-rim-v1')).toBe(true)
      const bridge = document.paths['lower-bridge']
      packages.push(bridge.centerlineMm)
      const stacked = await pixels(editor, info.outputPath(title + '-original-player.png'), 'player')
      const gm = await pixels(editor, info.outputPath(title + '-original-gm.png'), 'gm')
      expect(stacked(.02, .02)[3]).toBe(255)
      expect(gm(.02, .02)).toEqual(stacked(.02, .02))
      await floor.selectOption('lower')
      await keyboardWorkspaceSaved(editor)
      const pixel = await pixels(editor, info.outputPath(title + '-lower-player.png'), 'player')
      if (title === '碧脉冷却枢纽') {
        const landing = document.terrainAreas['lower-east'], overhang = document.terrainAreas['lower-service']
        const buried = landing.boundaryMm.findIndex(row => row.positionMm.x === 55000 && row.positionMm.y === 40200)
        expect(buried).toBeGreaterThanOrEqual(0)
        expect(landing.boundaryMm[buried + 1].positionMm).toEqual({ x: 46600, y: 40200 })
        expect(Object.values(document.terrainEdges).some(edge => edge.source.segmentId === landing.boundaryMm[buried].segmentId)).toBe(false)
        expect(Object.values(document.terrainEdges).some(edge => edge.source.areaId === overhang.id && edge.neighborAreaId === landing.id)).toBe(true)
        const bounds = document.floors.lower.outputBoundsMm!
        const at = (read: typeof pixel, x: number, y: number) => read((x - bounds.x) / bounds.width, (y - bounds.y) / bounds.height)
        const channelSum = (rgba: number[]) => rgba[0] + rgba[1] + rgba[2]
        // The shadow extends beyond the fascia onto the horizontal road. The
        // same extension above the crossing has only a background image below it.
        expect(channelSum(at(pixel, 36800, 29400)) - channelSum(at(stacked, 36800, 29400))).toBeGreaterThan(25)
        expect(at(stacked, 36800, 24500)).toEqual(at(pixel, 36800, 24500))
        for (const entrance of bridge.centerlineMm) {
          // Average down the lane to detect a warm transverse line among aggregate speckles.
          const hues = Array.from({ length: 25 }, (_, col) => {
            const u = (entrance.x + (col - 12) * 12 - bounds.x) / bounds.width
            const colors = Array.from({ length: 17 }, (_, row) => {
              const v = (entrance.y + (row - 8) * 100 - bounds.y) / bounds.height
              const [red, green] = pixel(u, v)
              return red - green
            })
            return colors.reduce((sum, value) => sum + value, 0) / colors.length
          })
          expect(Math.max(...hues) - Math.min(...hues)).toBeLessThan(3)
        }
      }
      await floor.selectOption('upper')
      await keyboardWorkspaceSaved(editor)
      const objects = await openSceneObjects(editor)
      await objects.getByLabel('搜索场景对象', { exact: true }).fill(facadeArea.id)
      await objects.locator(`.asset-entity-list [data-entity-id=${JSON.stringify(facadeArea.id)}]`).click()
      const inspector = editor.getByTestId('workspace-inspector')
      await openDetailsBySummary(inspector, /^建筑立面$/)
      const depth = facadeArea.facade!.depthMm - 350
      const depthInput = inspector.getByLabel('立面可见深度', { exact: true })
      await depthInput.fill(String(depth / 1000))
      await depthInput.press('Tab')
      await inspector.getByRole('button', { name: '预览建筑立面', exact: true }).click()
      await adopt(editor, '室外')

      const lamp = Object.values(document.props).find(prop => prop.floorId === 'upper'
        && prop.id.startsWith('upper-pole-lamp-') && prop.definitionRef?.id === 'industrial-cyberpunk-prop-pole-lamp-v2')!
      expect(lamp.appearance.glow).toBeDefined()
      const lampX = lamp.positionMm.x + 600
      await objects.getByLabel('搜索场景对象', { exact: true }).fill(lamp.id)
      await objects.locator(`.asset-entity-list [data-entity-id=${JSON.stringify(lamp.id)}]`).click()
      const position = inspector.getByLabel('物件 X', { exact: true })
      await position.fill(String(lampX / 1000))
      await position.press('Enter')
      await keyboardWorkspaceSaved(editor)
      await openDetailsBySummary(inspector, /^外观与图层调整$/)
      await inspector.getByLabel('外观调整项目', { exact: true }).selectOption('propGlow')
      const glowRadius = inspector.getByLabel('照光半径 mm', { exact: true })
      await expect(glowRadius).toHaveValue(String(lamp.appearance.glow!.radiusMm))
      await glowRadius.fill('2350')
      await inspector.getByRole('button', { name: '预览外观调整', exact: true }).click()
      await review(editor).getByRole('button', { name: '采用组件修改', exact: true }).click()
      await keyboardWorkspaceSaved(editor)

      await floor.selectOption(backdrop)
      await keyboardWorkspaceSaved(editor)
      const scene = await openWorkspaceModule(editor, '场景')
      await openDetailsBySummary(scene, /^楼层底图$/)
      const artwork = scene.getByLabel('楼层底图', { exact: true })
      await artwork.getByLabel('底图文件', { exact: true }).setInputFiles({ name: 'alternate-backdrop.png', mimeType: 'image/png', buffer: backgroundBytes })
      await artwork.getByLabel('底图署名与来源', { exact: true }).fill('Sceneweave original browser test backdrop')
      await artwork.getByLabel('底图许可', { exact: true }).fill('Original test pixels permitted for embedding.')
      await artwork.getByLabel('允许将底图嵌入工程和出图', { exact: true }).check()
      await artwork.getByRole('button', { name: '预览更换底图', exact: true }).click()
      await adopt(editor, '结构')
      await editor.getByRole('button', { name: '撤销编辑', exact: true }).click()
      await keyboardWorkspaceSaved(editor)
      await expect(artwork).toContainText('Sceneweave original industrial cyberpunk artwork')
      await editor.getByRole('button', { name: '重做编辑', exact: true }).click()
      await keyboardWorkspaceSaved(editor)
      await expect(artwork).toContainText('Sceneweave original browser test backdrop')
      await openDetailsBySummary(scene, /^楼层底图$/)
      await artwork.getByRole('button', { name: '预览清除底图', exact: true }).click()
      await adopt(editor, '结构')
      await expect(artwork.getByRole('button', { name: '预览清除底图', exact: true })).toHaveCount(0)
      await editor.getByRole('button', { name: '撤销编辑', exact: true }).click()
      await keyboardWorkspaceSaved(editor)

      await floor.selectOption('upper')
      await keyboardWorkspaceSaved(editor)
      const editedFilename = info.outputPath(title + '-edited.sceneweave')
      const edited = await keyboardProjectBackup(editor, editedFilename)
      expect(edited.document.terrainAreas[facadeArea.id].facade?.depthMm).toBe(depth)
      expect(edited.document.props[lamp.id]).toEqual({ ...lamp, positionMm: { ...lamp.positionMm, x: lampX },
        appearance: { ...lamp.appearance, glow: { ...lamp.appearance.glow, radiusMm: 2350 } } })
      expect(edited.document.paths).toEqual(document.paths)
      expect(edited.document.visual.base.base.boundaries).toEqual(document.visual.base.base.boundaries)
      const changedArtwork = edited.document.floors[backdrop].artwork!
      expect(changedArtwork.assetId).not.toBe(document.floors[backdrop].artwork?.assetId)
      expect(changedArtwork.boundsMm).toEqual(document.floors[backdrop].boundsMm)

      const reimport = await browser.newContext()
      try {
        const reopened = await reimport.newPage()
        await reopened.goto(new URL('./#home', page.url()).href)
        const choosingEdited = reopened.waitForEvent('filechooser')
        await reopened.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
        await (await choosingEdited).setFiles(editedFilename)
        await keyboardWorkspaceSaved(reopened)
        const cold = await keyboardProjectBackup(reopened, info.outputPath(title + '-edited-cold.sceneweave'))
        expect(cold.document.floors[backdrop].artwork).toEqual(changedArtwork)
        expect(cold.document.terrainAreas[facadeArea.id].facade?.depthMm).toBe(depth)
        expect(cold.document.props[lamp.id]).toEqual(edited.document.props[lamp.id])
        expect(cold.document.paths).toEqual(edited.document.paths)
        expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(edited.hashes))
        for (const audience of ['player', 'gm'] as const) {
          const pixel = await pixels(reopened, info.outputPath(title + '-' + audience + '.png'), audience)
          expect(pixel(.02, .02)).toEqual([77, 33, 54, 255])
        }
      } finally { await reimport.close() }
    } finally { await context.close() }
  }
  expect(packages[0]).not.toEqual(packages[1])
})
