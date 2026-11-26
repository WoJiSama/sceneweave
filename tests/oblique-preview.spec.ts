import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectData } from '../src/shared/model/project'
import type { ObliquePreparationMetrics } from '../src/platform/browser/render/oblique-renderer'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openOutdoorTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

async function openTavern(page: Page) {
  await page.goto('./#home')
  await page.locator('article[data-sample="fantasy"]').getByRole('button', { name: '余烬酒馆与旅舍', exact: true }).click()
  await page.getByRole('dialog', { name: '确认打开工程', exact: true }).getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

test('fine texture detail converges when zoomed out and transparent paint keeps its pigment', async ({ page }) => {
  await page.goto('./#home')
  const samples = await page.evaluate(async () => {
    const meshModule = '/src/platform/browser/render/oblique-mesh.ts'
    const { ObliqueMesh, mountObliqueMesh } = await import(meshModule)
    const canvas = (width: number, height: number) => Object.assign(document.createElement('canvas'), { width, height })
    const source = canvas(510, 318), paint = source.getContext('2d')!
    const bounds = { x: 0, y: 0, width: 2600, height: 2600 }
    const render = () => {
      const mesh = new ObliqueMesh()
      mesh.quad({ image: source, unlit: true }, [[0, 0, 0], [2600, 0, 0], [2600, 2600, 0], [0, 2600, 0]])
      const target = canvas(96, 96)
      const read = canvas(96, 96).getContext('2d')!
      const view = mountObliqueMesh(target, mesh, bounds, [1, 1, 1], [0, .24, .33])
      try {
        view.draw({ azimuthDeg: 32, elevationDeg: 46, zoom: .83 })
        read.drawImage(target, 0, 0)
        return read
      } finally { view.dispose() }
    }
    paint.fillStyle = '#000'
    paint.fillRect(0, 0, source.width, source.height)
    paint.fillStyle = '#fff'
    for (let x = 0; x < source.width; x += 2) paint.fillRect(x, 0, 1, source.height)
    const bands = Array.from(render().getImageData(36, 36, 24, 24).data).filter((_, i) => i % 4 === 0)
    paint.clearRect(0, 0, source.width, source.height)
    paint.fillStyle = '#ff9a48'
    paint.beginPath()
    paint.ellipse(255, 159, 186, 106, 0, 0, Math.PI * 2)
    paint.fill()
    const { data } = render().getImageData(0, 0, 96, 96)
    let darkFringe = 0
    for (let i = 0; i < data.length; i += 4) {
      const [r, g] = [data[i], data[i + 1]]
      if (r > 55 && g < 61 + r / 255 * 93 - 5) darkFringe++
    }
    return { min: Math.min(...bands), max: Math.max(...bands), darkFringe }
  })
  expect(samples.min).toBeGreaterThan(113)
  expect(samples.max).toBeLessThan(142)
  expect(samples.darkFringe).toBe(0)
})

test('outward wall faces respond to the same world light heading as the terrain', async ({ page }) => {
  await page.goto('./#home')
  const pixels = await page.evaluate(async () => {
    const meshModule = '/src/platform/browser/render/oblique-mesh.ts'
    const lightModule = '/src/shared/visual/directional-light.ts'
    const [{ ObliqueMesh, mountObliqueMesh, rectangle }, { directionToLight }] = await Promise.all([import(meshModule), import(lightModule)])
    const bounds = { x: 0, y: 0, width: 1000, height: 420 }
    const sample = (direction: number) => {
      const mesh = new ObliqueMesh()
      mesh.solid({ color: [.7, .7, .7] }, rectangle(bounds), 0, 500)
      const target = Object.assign(document.createElement('canvas'), { width: 160, height: 160 })
      const buffer = Object.assign(document.createElement('canvas'), { width: 160, height: 160 }).getContext('2d')!
      const view = mountObliqueMesh(target, mesh, bounds, directionToLight({ lightDirectionDeg: direction }), [0, 0, 0])
      try {
        view.draw({ azimuthDeg: 0, elevationDeg: 35, zoom: 1 })
        buffer.drawImage(target, 0, 0)
        return buffer.getImageData(80, 104, 1, 1).data[0]
      } finally { view.dispose() }
    }
    return { front: sample(270), back: sample(90) }
  })
  expect(pixels.front - pixels.back).toBeGreaterThan(25)
})

test('baked shadows follow the light, the receiving height and an open doorway', async ({ page }) => {
  await page.goto('./#home')
  const shadows = await page.evaluate(async () => {
    const shadowPath = '/src/platform/browser/render/oblique-shadows.ts', wallPath = '/src/shared/geometry/wall-paint-geometry.ts'
    const groundPath = '/src/platform/browser/render/projected-ground.ts'
    const [{ bakeObliqueShadows }, { wallGeometry }, { projectGround }] = await Promise.all([import(shadowPath), import(wallPath), import(groundPath)])
    const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
    const bounds = { x: 0, y: 0, width: 10000, height: 8000 }
    const wall = { start: { x: 3000, y: 1000 }, end: { x: 3000, y: 7000 }, thicknessMm: 180, heightMm: 2500,
      openings: [{ start: { x: 3000, y: 3500 }, end: { x: 3000, y: 4500 }, kind: 'door', vertical: { sillMm: 0, heightMm: 2100 }, state: 'open' }] }
    const projection = { bounds, audience: 'gm', walls: [wall], rooms: [], props: [], paths: [],
      terrain: [{ id: 'terrace', points: rect(3300, 4800, 2600, 2300), elevationMm: 2300 }],
      visual: { environment: { lightDirectionDeg: 0, directionalLight: { kind: 'sun', elevationDeg: 45, intensity: 1, softness: .4 } } } }
    const canvas = (width: number, height: number) => Object.assign(document.createElement('canvas'), { width, height })
    const bake = () => bakeObliqueShadows(projection, projectGround(projection), wallGeometry(projection.walls), canvas)
    const alpha = (image: HTMLCanvasElement, x: number, y: number) => image.getContext('2d')!.getImageData(
      Math.floor(x * image.width / bounds.width), Math.floor(y * image.height / bounds.height), 1, 1).data[3]
    const open = await bake()
    wall.openings[0].state = 'closed'
    const shut = await bake()
    return { illuminated: alpha(open, 2000, 2000), behindWall: alpha(open, 4000, 2000), open: alpha(open, 4000, 4000),
      lintel: alpha(open, 5300, 4000), closed: alpha(shut, 4000, 4000), terrace: alpha(open, 4000, 6000) }
  })
  expect(shadows).toMatchObject({ illuminated: 0, open: 0, terrace: 0 })
  expect(shadows.lintel).toBeGreaterThan(60)
  expect(shadows.closed).toBeGreaterThan(60)
  expect(shadows.behindWall).toBeGreaterThan(60)
})

for (const [count, budget] of [[500, 45], [2000, 60]] as const) {
  test(`oblique preview stays within the draw and atlas budget for ${count} mixed props`, async ({ page }) => {
    const fixtures = process.env.SCENEWEAVE_OBLIQUE_FIXTURES
    test.skip(!fixtures, '需准备当前完整工程的混合容量夹具。')
    const archive = await readFile(join(fixtures!, `mixed-${count}.sceneweave`))
    await page.goto('./#home')
    const report = await page.evaluate(async encoded => {
      const filePath = '/src/shared/project/file.ts', validationPath = '/src/platform/browser/project-validation.ts'
      const renderPath = '/src/platform/browser/render/oblique-renderer.ts'
      const [{ importProject }, { browserProjectValidation }, { DEFAULT_OBLIQUE_CAMERA, prepareObliquePreview }] =
        await Promise.all([import(filePath), import(validationPath), import(renderPath)])
      const bundle = await importProject(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), browserProjectValidation)
      const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 1000 })
      let metrics: ObliquePreparationMetrics | undefined
      const preview = await prepareObliquePreview(canvas, bundle, { audience: 'gm', onMetrics: (value: ObliquePreparationMetrics) => { metrics = value } })
      try {
        const draws = Array.from({ length: 24 }, (_, i) => preview.draw({ ...DEFAULT_OBLIQUE_CAMERA, azimuthDeg: i * 15 }).drawCalls)
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')!
        const texImage2D = gl.texImage2D
        const uploads: { width: number; height: number; readback: boolean }[] = []
        gl.texImage2D = ((...args: unknown[]) => {
          const image = args.at(-1)
          if (image instanceof HTMLCanvasElement) uploads.push({
            width: image.width, height: image.height, readback: !!image.getContext('2d')?.getContextAttributes().willReadFrequently,
          })
          Reflect.apply(texImage2D, gl, args)
        }) as typeof gl.texImage2D
        preview.draw(DEFAULT_OBLIQUE_CAMERA)
        const overview = canvas.toDataURL()
        for (const zoom of [2.35, 3.3, 1]) {
          preview.draw({ ...DEFAULT_OBLIQUE_CAMERA, zoom })
          await preview.refine(zoom)
        }
        const overviewRestored = canvas.toDataURL() === overview
        const normalUploads = uploads.slice()
        let released = 0
        const deleteTexture = gl.deleteTexture.bind(gl)
        gl.deleteTexture = texture => { released++; deleteTexture(texture) }
        const zoom = 3.3
        preview.setMode('performance')
        preview.draw({ ...DEFAULT_OBLIQUE_CAMERA, zoom })
        await preview.refine(zoom)
        const performanceUploads = uploads.length - normalUploads.length
        preview.setMode('normal')
        const interrupted = preview.refine(zoom).then(() => false, (failure: Error) => failure.name === 'AbortError')
        preview.setMode('performance')
        const cancelled = await interrupted
        preview.setMode('normal')
        await preview.refine(zoom)
        return { count: Object.keys(bundle.project.document.props).length, metrics, mostDraws: Math.max(...draws),
          normalUploads, performanceUploads, restoredUploads: uploads.length - normalUploads.length, released, cancelled, overviewRestored }
      } finally { preview.dispose() }
    }, archive.toString('base64'))
    expect(report.count).toBe(count)
    expect(report.mostDraws).toBeLessThanOrEqual(budget)
    expect(report.metrics?.atlasPixels).toBeLessThanOrEqual(12_000_000)
    expect(report.metrics?.triangles).toBeLessThanOrEqual(300_000)
    expect(report.normalUploads).toHaveLength(1)
    const [detail] = report.normalUploads
    expect(detail.readback).toBe(true)
    expect(detail.width).toBeGreaterThanOrEqual(3072)
    expect(detail.width * detail.height + report.metrics!.atlasPixels).toBeLessThanOrEqual(12_000_000)
    expect(report.overviewRestored).toBe(true)
    expect(report.performanceUploads).toBe(0)
    expect(report.released).toBe(1)
    expect(report.cancelled).toBe(true)
    expect(report.restoredUploads).toBe(1)
  })
}

test('private wall heights and secret door state cannot change the player’s 3D pixels', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('./#home')
  const result = await page.evaluate(async () => {
    const showcasePath = '/src/platform/browser/content/home-showcase.ts', renderPath = '/src/platform/browser/render/oblique-renderer.ts'
    const [{ readHomeShowcaseArchive }, { renderObliqueProject }] = await Promise.all([import(showcasePath), import(renderPath)])
    const before = await readHomeShowcaseArchive('ruins')
    const altered: ProjectData = structuredClone(before.project)
    const edge = (from: string, to: string) => JSON.stringify([from, to].sort())
    const roomEdges = (visibility: 'public' | 'gm') => new Set(Object.values(altered.document.rooms).filter(room => room.visibility === visibility)
      .flatMap(room => room.boundaryVertexIds.map((id, i, ids) => edge(id, ids[(i + 1) % ids.length]))))
    const publicEdges = roomEdges('public'), secretEdges = roomEdges('gm')
    const hidden = Object.values(altered.document.walls).filter(wall => {
      const key = edge(wall.startVertexId, wall.endVertexId)
      return secretEdges.has(key) && !publicEdges.has(key)
    })
    const secret = Object.values(altered.document.openings).find(opening => opening.secret && !opening.revealed)
    if (!hidden.length || !secret) throw new Error('Expected a secret room and door in the fixed mausoleum')
    hidden.forEach(wall => { wall.heightMm = 3900 })
    secret.state = 'open'; secret.locked = false
    const after = { project: altered, resources: before.resources }
    const pixels = async (bundle: typeof before, audience: 'gm' | 'player') => {
      const canvas = await renderObliqueProject(bundle, { audience, longEdgePx: 512 })
      return canvas.toDataURL()
    }
    return { player: await pixels(before, 'player') === await pixels(after, 'player'), gm: await pixels(before, 'gm') === await pixels(after, 'gm') }
  })
  expect(result).toEqual({ player: true, gm: false })
})

test('3D PNG pixels are independent of preview mode, zoom and texture detail', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./#home')
  const { before, after, standalone, zoomed, performanceExport, performanceAtlasPixels } = await page.evaluate(async () => {
    const showcaseModule = '/src/platform/browser/content/home-showcase.ts'
    const renderModule = '/src/platform/browser/render/oblique-renderer.ts'
    const [{ readHomeShowcaseArchive }, { DEFAULT_OBLIQUE_CAMERA: camera, prepareObliquePreview, exportObliquePng }] =
      await Promise.all([import(showcaseModule), import(renderModule)])
    const bundle = await readHomeShowcaseArchive('island')
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 1000 })
    const options = { audience: 'gm' as const, camera, longEdgePx: 1280 }
    const digest = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob)
      const image = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height })
      try {
        const context = image.getContext('2d', { willReadFrequently: true })!
        context.drawImage(bitmap, 0, 0)
        const pixels = context.getImageData(0, 0, image.width, image.height).data
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)))
      } finally {
        bitmap.close()
        image.width = image.height = 0
      }
    }
    let metrics: ObliquePreparationMetrics | undefined
    const performanceView = await prepareObliquePreview(canvas, bundle, { ...options, mode: 'performance',
      onMetrics: (value: ObliquePreparationMetrics) => { metrics = value } })
    const performanceAtlasPixels = metrics?.atlasPixels ?? 0
    let performanceExport: number[]
    try {
      performanceView.draw({ ...camera, zoom: 4 })
      await performanceView.refine(4)
      performanceExport = await digest(await performanceView.exportPng(options))
    } finally { performanceView.dispose() }
    const preview = await prepareObliquePreview(Object.assign(document.createElement('canvas'), { width: 1280, height: 1000 }), bundle, options)
    try {
      if (!preview.cacheable) throw new Error('Expected a verified immutable preview')
      preview.draw(camera)
      const before = await digest(await preview.exportPng(options))
      preview.draw({ ...camera, zoom: 4 })
      await preview.refine(4)
      const zoomed = await digest(await preview.exportPng({ longEdgePx: options.longEdgePx }))
      preview.draw(camera)
      const after = await digest(await preview.exportPng(options))
      return { before, after, standalone: await digest(await exportObliquePng(bundle, options)), zoomed, performanceExport, performanceAtlasPixels }
    } finally {
      preview.dispose()
    }
  })
  expect(after).toEqual(before)
  expect(standalone).toEqual(before)
  expect(performanceExport).toEqual(before)
  expect(performanceAtlasPixels).toBeGreaterThan(0)
  expect(performanceAtlasPixels).toBeLessThanOrEqual(768 * 768)
  expect(zoomed).not.toEqual(before)
})

test('sample opens on the editable plane, rotates on demand, and exports the current camera', async ({ page }, info) => {
  test.setTimeout(120_000)
  await openTavern(page)
  const workbench = page.getByTestId('outdoor-workbench'), trigger = workbench.getByRole('button', { name: '斜俯视', exact: true })
  await expect(workbench.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(page.locator('.oblique-stage canvas')).toHaveCount(0)
  const revision = await workbench.getAttribute('data-revision')
  await trigger.click()
  const preview = page.getByRole('dialog', { name: '斜俯视', exact: true })
  const canvas = preview.locator('canvas')
  const mode = preview.getByLabel('预览模式', { exact: true })
  await expect(mode).toHaveValue('normal')
  await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 40_000 })
  const firstCanvas = await canvas.elementHandle()
  const pixels = () => canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL())
  const first = await pixels()
  const base = preview.getByRole('checkbox', { name: '地图底座', exact: true })
  await base.check()
  await expect.poll(pixels).not.toBe(first)
  await base.uncheck()
  await expect.poll(pixels).toBe(first)
  await canvas.focus()
  await canvas.press('ArrowRight')
  await expect.poll(pixels).not.toBe(first)
  const zoom = preview.getByRole('slider', { name: '3D 缩放' })
  await zoom.fill('2.35')
  await expect.poll(pixels).not.toBe(first)
  await mode.selectOption('performance')
  await expect.poll(() => canvas.evaluate(node => (node as HTMLCanvasElement).width)).toBeLessThanOrEqual(960)
  await expect(zoom).toHaveValue('2.35')
  expect(await canvas.evaluate((node, initial) => node === initial, firstCanvas)).toBe(true)
  await page.screenshot({ path: info.outputPath('tavern-oblique-editor.png') })
  const downloadEvent = page.waitForEvent('download')
  await preview.getByRole('button', { name: '导出当前画面' }).click()
  const file = await downloadEvent
  expect(file.suggestedFilename()).toMatch(/-3D\.png$/)
  expect(await file.failure()).toBeNull()
  const exported = info.outputPath('tavern-current-angle.png')
  await file.saveAs(exported)
  const png = await readFile(exported)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(png.readUInt32BE(16)).toBe(2560)
  await preview.getByRole('button', { name: '返回俯视' }).click()
  await expect(preview).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(workbench).toHaveAttribute('data-revision', revision!)
  await trigger.click()
  await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 40_000 })
  expect(await canvas.evaluate((node, initial) => node === initial, firstCanvas)).toBe(true)
  await expect(mode).toHaveValue('performance')
  await mode.selectOption('normal')
  await expect.poll(pixels).toBe(first)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
})

test('a tavern box lid supports a new lamp and shows the snap when the lamp is dragged back', async ({ page }, info) => {
  test.setTimeout(160_000)
  page.setDefaultTimeout(20_000)
  await openTavern(page)
  const boxId = 'interior-f24de85621df9ee6891aeb2adfb29e08a35893d1'
  await selectKeyboardProp(page, boxId)
  const inspector = page.getByTestId('workspace-inspector')
  await openDetailsBySummary(inspector, /^立体形状$/)
  await inspector.getByLabel('立体结构模板', { exact: true }).selectOption('box')
  await inspector.getByRole('checkbox', { name: '箱顶可放物件', exact: true }).check()
  const height = inspector.getByLabel('立体高度', { exact: true })
  await height.fill('0.79'); await height.press('Tab')
  await inspector.getByRole('button', { name: '预览立体设置', exact: true }).click()
  const apply = async () => {
    const review = page.getByRole('region', { name: '候选审阅', exact: true })
    await review.getByLabel('确认完整影响范围', { exact: true }).check({ timeout: 15_000 })
    await review.getByRole('button', { name: '采用视觉修改', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }
  await apply()
  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('锻铁六角提灯')
  await library.getByRole('button', { name: '放置组件 锻铁六角提灯', exact: true }).click()
  await expect(page.getByRole('button', { name: '在此放置', exact: true })).toBeEnabled()
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  const world = { x: 0, y: 0, width: 17_500, height: 15_000 }
  const fit = async () => {
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
    const area = await canvas.boundingBox()
    expect(area).toBeTruthy()
    return ({ x, y }: { x: number; y: number }) => ({ x: area!.x + (x - world.x) * area!.width / world.width,
      y: area!.y + (y - world.y) * area!.height / world.height })
  }
  const pointer = await fit(), drop = pointer({ x: 15090, y: 7905 })
  await page.mouse.move(drop.x, drop.y)
  await expect(page.locator('[data-prop-top-snap]')).toBeVisible()
  await page.mouse.click(drop.x, drop.y)
  await keyboardWorkspaceSaved(page)
  const initial = await keyboardProjectBackup(page, info.outputPath('lamp-placed.sceneweave'))
  expect(initial.document.props[boxId].volume).toEqual({ kind: 'box', heightMm: 790 })
  const lid = Object.values(initial.document.attachmentSurfaces!).find(surface => surface.owner.id === boxId)!
  const first = Object.values(initial.document.attachments!).find(relation => relation.mode === 'support' && relation.surfaceId === lid.id)!
  expect(first).toMatchObject({ mode: 'support', follow: 'follow', materialized: { contactElevationMm: 790 } })
  const lampId = first.child.id
  expect(initial.document.props[lampId].supportRef).toEqual(initial.document.props[boxId].supportRef)

  await selectKeyboardProp(page, lampId)
  await openDetailsBySummary(inspector, /^承托与挂接$/)
  await inspector.getByRole('button', { name: '预览解除附着', exact: true }).click()
  await apply()
  const x = inspector.getByLabel('物件 X', { exact: true })
  await x.fill('13.7'); await x.press('Tab')
  await keyboardWorkspaceSaved(page)
  const dragPointer = await fit(), start = dragPointer({ x: 13700, y: initial.document.props[lampId].positionMm.y })
  const end = dragPointer(initial.document.props[boxId].positionMm)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await expect(page.getByTestId('selection-drag-status')).toContainText('已对准承托面')
  await page.screenshot({ path: info.outputPath('tavern-lid-snap.png') })
  await page.mouse.up()
  await apply()
  const attached = await keyboardProjectBackup(page, info.outputPath('lamp-snapped.sceneweave'))
  const relation = Object.values(attached.document.attachments!).find(row => row.child.id === lampId)!
  expect(relation).toMatchObject({ surfaceId: lid.id, mode: 'support', materialized: { contactElevationMm: 790 } })
  await selectKeyboardProp(page, boxId)
  await x.fill('14.69'); await x.press('Tab')
  await keyboardWorkspaceSaved(page)
  const moved = await keyboardProjectBackup(page, info.outputPath('crate-moved.sceneweave'))
  expect(moved.document.props[lampId].positionMm.x).toBe(attached.document.props[lampId].positionMm.x - 400)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${moved.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('crate-reopened.sceneweave'))).hashes).toEqual(moved.hashes)
})

test('the natural volcano can be downloaded and reopened with the same editable relief in both views', async ({ page }, info) => {
  test.setTimeout(150_000)
  await createKeyboardProject(page, '火山生成入口检查')
  await openWorkspaceModule(page, '素材')
  const themes = page.getByRole('region', { name: '主题素材包', exact: true })
  await themes.locator(':scope > details > summary').click()
  await openDetailsBySummary(themes, /^火山 ·/)
  const downloading = page.waitForEvent('download', { timeout: 90_000 })
  await themes.getByRole('button', { name: '下载场景 · 自然火口与熔岩池', exact: true }).click()
  const archive = info.outputPath('natural-volcano.sceneweave')
  await (await downloading).saveAs(archive)
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(archive)
  await keyboardWorkspaceSaved(page)
  const reopened = await keyboardProjectBackup(page, info.outputPath('natural-volcano-reopened.sceneweave'))
  expect(reopened.document.title).toBe('灰脊火口 · 自然岩坡与熔岩池')
  const shaped = Object.values(reopened.document.terrainAreas).filter(area => area.relief)
  expect(shaped).toHaveLength(2)
  expect(shaped.every(area => new Set(area.relief!.offsetsMm).size > 2)).toBe(true)
  await page.screenshot({ path: info.outputPath('natural-volcano-top.png') })
  await page.getByRole('button', { name: '斜俯视', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '斜俯视', exact: true })
  await expect(dialog.locator('canvas')).toHaveAttribute('data-ready', 'true', { timeout: 40_000 })
  await page.screenshot({ path: info.outputPath('natural-volcano-oblique.png') })
})

test('terrain brush marks the fixed steps before applying the stroke and preserves them on request', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./#home')
  await page.locator('article[data-sample="volcano"]').getByRole('button', { name: '灰脊火口观测步道', exact: true }).click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const readProject = async (name: string) => (await keyboardProjectBackup(page, info.outputPath(name + '.sceneweave'))).document
  const scene = await readProject('volcano-before-stroke')
  const mountain = Object.values(scene.terrainAreas).find(row => row.relief && row.groundElevationMm > 0)!
  const resources = await openWorkspaceModule(page, '场景')
  const allLayers = resources.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await allLayers.isVisible()) await allLayers.click()
  await resources.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
  await resources.getByLabel('搜索场景对象', { exact: true }).fill(mountain.id)
  await resources.locator(`[data-entity-id="${mountain.id}"]`).click()
  await openWorkspaceModule(page, '地形')
  await page.getByRole('button', { name: '起伏笔刷', exact: true }).click()
  const tools = page.getByRole('region', { name: '起伏笔刷设置' })
  const amount = tools.getByLabel('每笔高程变化（负数下挖）', { exact: true })
  await amount.fill('-0.55')
  await amount.press('Tab')
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  const box = await canvas.boundingBox()
  expect(box).toBeTruthy()
  const world = scene.exportBoundsMm
  const pointer = (x: number, y: number) => ({ x: box!.x + box!.width * (x - world.x) / world.width, y: box!.y + box!.height * (y - world.y) / world.height })
  const from = pointer(12450, 18900), to = pointer(13450, 20450)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  const conflict = page.locator('[data-stair-support="conflict"]').first()
  await expect(conflict).toBeInViewport()
  await page.screenshot({ path: info.outputPath('volcano-stair-conflict.png') })
  await page.mouse.up()
  await tools.getByRole('button', { name: '保留承托地形' }).click()
  await expect(page.locator('[data-stair-support="preserve"]').first()).toBeVisible()
  await tools.getByRole('button', { name: '预览这笔起伏' }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const changed = await readProject('volcano-protected-stroke')
  expect(changed.terrainAreas[mountain.id].relief).not.toEqual(mountain.relief)
  expect(changed.terrainConnections).toEqual(scene.terrainConnections)
  await page.getByRole('button', { name: '撤销编辑' }).click()
  await keyboardWorkspaceSaved(page)
  expect((await readProject('volcano-undone-stroke')).terrainAreas[mountain.id].relief).toEqual(mountain.relief)
})

test('one terrain stroke crosses two heights, preserves the fixed stair and survives redo and cold open', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '相邻高程笔刷', { widthMeters: 20, heightMeters: 20 })
  const read = (name: string) => keyboardProjectBackup(page, info.outputPath(`${name}.sceneweave`))
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const adopt = async () => {
    await expect(review).toBeVisible()
    await review.getByLabel('确认完整影响范围', { exact: true }).check()
    await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
    await keyboardWorkspaceSaved(page)
  }
  const setNumber = async (form: Locator, label: string, value: string) => {
    const field = form.getByLabel(label, { exact: true })
    await field.fill(value)
    await field.press('Tab')
  }
  for (const [x, elevation] of [[2000, '0.45'], [8000, '1.45']] as const) {
    const form = await openOutdoorTask(page)
    await openDetailsBySummary(form, /^精确坐标 · 区域轮廓$/)
    await form.getByLabel('室外坐标', { exact: true }).fill(`${x},2500\n${x + 6000},2500\n${x + 6000},8500\n${x},8500`)
    await setNumber(form, '地形高程', elevation)
    await openDetailsBySummary(form, /^重叠地形的显示顺序$/)
    await form.getByLabel('地形覆盖优先级', { exact: true }).fill('1')
    await form.getByRole('button', { name: '预览室外修改', exact: true }).click()
    await adopt()
  }
  const ground = await read('terraces-ground')
  const low = Object.values(ground.document.terrainAreas).find(area => area.groundElevationMm === 450)!
  const high = Object.values(ground.document.terrainAreas).find(area => area.groundElevationMm === 1450)!
  const stairs = await openOutdoorTask(page, '台阶 / 坡道')
  await stairs.getByLabel('连接起点表面', { exact: true }).selectOption(`terrainArea:${low.id}`)
  await stairs.getByLabel('连接终点表面', { exact: true }).selectOption(`terrainArea:${high.id}`)
  await stairs.getByLabel('高差连接类型', { exact: true }).selectOption('stairs')
  await setNumber(stairs, '室外通路净宽', '1')
  await openDetailsBySummary(stairs, /^精确坐标 · 连接路线节点$/)
  await stairs.getByLabel('室外坐标', { exact: true }).fill('6600,5450\n9500,5450')
  await stairs.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await adopt()
  const before = await read('terraces-before')
  await openWorkspaceModule(page, '地形')
  await page.getByRole('button', { name: '起伏笔刷', exact: true }).click()
  const tools = page.getByRole('region', { name: '起伏笔刷设置' })
  const brushOverlay = page.getByTestId('terrain-brush-overlay')
  await expect(brushOverlay).toBeVisible()
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  const viewport = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  expect(viewport).toBeTruthy()
  const world = before.document.exportBoundsMm
  const screenX = (x: number) => viewport!.x + viewport!.width * (x - world.x) / world.width
  const screenY = viewport!.y + viewport!.height * (6800 - world.y) / world.height
  await page.mouse.move(screenX(6450), screenY)
  await page.mouse.down()
  await page.mouse.move(screenX(9750), screenY, { steps: 16 })
  await page.mouse.up()
  await expect(brushOverlay.locator('polyline')).toHaveCount(1)
  const prepare = tools.getByRole('button', { name: '预览这笔起伏', exact: true })
  const preserve = tools.getByRole('button', { name: '保留承托地形', exact: true })
  await expect(preserve).toBeVisible()
  await expect(prepare).toBeDisabled()
  await preserve.click()
  await prepare.click()
  await adopt()
  const after = await read('terraces-after')
  expect(after.document.revision).toBe(before.document.revision + 1)
  for (const id of [low.id, high.id]) {
    const { relief, ...area } = after.document.terrainAreas[id]
    expect(area).toEqual(before.document.terrainAreas[id])
    expect(Math.max(...relief!.offsetsMm)).toBeGreaterThan(300)
  }
  expect(after.document.terrainConnections).toEqual(before.document.terrainConnections)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await read('terraces-undone')).document.terrainAreas).toEqual(before.document.terrainAreas)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await page.goto('./#home')
  await page.reload()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${after.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await read('terraces-reopened')
  expect(cold.document.terrainAreas).toEqual(after.document.terrainAreas)
  expect(cold.document.terrainConnections).toEqual(after.document.terrainConnections)
  expect(errors).toEqual([])
})
