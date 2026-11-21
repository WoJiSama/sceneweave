import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import type { PointMm } from '../src/shared/model/scene'
import { clickKeyboardWorldPoint, keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'

async function importBackup(page: Page, bytes: Uint8Array) {
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles({ name: 'device-pipe.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await keyboardWorkspaceSaved(page)
}

test('marks pipe ports on a device, snaps one endpoint, and previews a reversible disconnect', async ({ page, browser }, info) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(12000)
  const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
  let archive: Uint8Array
  try {
    const { fixture, runtime, validation } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { prepareCompositionCommands } = await vite.ssrLoadModule('/src/application/workspace/prepare.ts')
    const { fromBundle, toBundle } = await vite.ssrLoadModule('/src/application/workspace/project.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const bundle = fixture(), scene = bundle.project.document, floorId = 'blank-floor', layerId = scene.entityLayers.item
    scene.title = '自制水泵与两条管线'; scene.units.display = 'm'; scene.units.snapMm = 100
    scene.props.item.positionMm = { x: 8000, y: 8000 }
    scene.props.item.visualBoundsMm = { x: -850, y: -500, width: 1700, height: 1000 }
    scene.props.item.footprintMm = { width: 1400, height: 700 }
    Object.assign(bundle.project, createCompositionContent(scene, runtime))
    const project = await fromBundle(bundle, validation)
    const pipe = (id: string, centerlineMm: PointMm[]) => ({ type: 'setFenceAssembly', id, floorId, layerId, centerlineMm, closed: false,
      visibility: 'public', recipe: { section: { kind: 'profile', profile: 'coolantPipe', lengthMm: 1800 }, endClearanceMm: 0, dimensions: { visualWidthMm: 480, footprintWidthMm: 300 } } })
    const staged = await prepareCompositionCommands(project, [
      pipe('west-pipe', [{ x: 1500, y: 8000 }, { x: 4300, y: 8000 }, { x: 6300, y: 8000 }]),
      pipe('east-pipe', [{ x: 8800, y: 8000 }, { x: 14300, y: 8000 }]),
    ], { runtime, validation })
    archive = await exportProject(toBundle(staged), validation)
  } finally { await vite.close() }

  await page.goto('./#home')
  const home = page.url()
  await importBackup(page, archive)
  const backup = (phase: string) => keyboardProjectBackup(page, info.outputPath(`${phase}.sceneweave`))
  const initial = await backup('before'), bounds = initial.document.exportBoundsMm
  const review = (target: Page) => target.getByRole('region', { name: '候选审阅', exact: true })
  async function adopt(target: Page, type: '室外' | '组件') {
    const candidate = review(target), confirm = candidate.getByLabel('确认完整影响范围', { exact: true })
    await expect(candidate).toBeVisible()
    if (await confirm.isVisible()) await confirm.check()
    await candidate.getByRole('button', { name: `采用${type}修改`, exact: true }).click()
    await keyboardWorkspaceSaved(target)
  }
  for (const [name, x] of [['进水口', 7250], ['出水口', 8800]] as const) {
    await selectKeyboardProp(page, 'item')
    const details = page.getByText('设备管口', { exact: true }).locator('..')
    if (await details.getAttribute('open') === null) await details.locator('summary').click()
    await details.getByRole('button', { name: `在画布标记${name}`, exact: true }).click()
    await clickKeyboardWorldPoint(page, { x, y: 8000 }, bounds)
    await adopt(page, '组件')
  }
  const ports = await backup('ports'), device = ports.document.props.item
  expect(device.pipePorts?.inlet?.x).toBeLessThan(-700)
  expect(device.pipePorts?.outlet?.x).toBeGreaterThan(750)
  const pipes = (snapshot: typeof ports) => snapshot.document.visual.base.base.boundaries
  expect(pipes(ports)['east-pipe']).toEqual(pipes(initial)['east-pipe'])
  expect(pipes(ports)['west-pipe'].fence?.pipeLinks).toBeUndefined()

  async function drag(from: PointMm, to: PointMm) {
    const canvas = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
    if (!canvas) throw new Error('Map canvas must be visible.')
    const screen = (point: PointMm) => ({ x: canvas.x + (point.x - bounds.x) * canvas.width / bounds.width, y: canvas.y + (point.y - bounds.y) * canvas.height / bounds.height })
    const a = screen(from), b = screen(to)
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 })
  }
  await drag(device.positionMm, { x: 7050, y: 8000 })
  await expect(page.getByTestId('pipe-link-attach')).toBeAttached()
  await expect(page.getByTestId('selection-drag-status')).toContainText('放下将建立管端链接')
  await page.mouse.up(); await adopt(page, '室外')
  const linked = await backup('linked'), west = pipes(linked)['west-pipe'], position = linked.document.props.item.positionMm
  expect(west.fence?.pipeLinks).toEqual({ end: { propId: 'item', port: 'inlet', restMm: { x: 6300, y: 8000 } } })
  expect(position.x + device.pipePorts!.inlet!.x).toBe(6300)
  expect(pipes(linked)['east-pipe']).toEqual(pipes(initial)['east-pipe'])

  await drag(position, { ...position, y: position.y + 500 })
  await expect(page.getByTestId('pipe-link-follow').locator('polyline')).toBeAttached()
  await page.mouse.up(); await adopt(page, '室外')
  const followed = await backup('followed'), followedPipe = pipes(followed)['west-pipe']
  expect(followedPipe.segments[0]).toEqual(west.segments[0])
  expect(followedPipe.segments.at(-1)?.end).toEqual({ x: 6300, y: 8500 })
  expect(followedPipe.fence?.pipeLinks).toEqual(west.fence?.pipeLinks)
  const moved = followed.document.props.item.positionMm, far = { ...moved, y: moved.y + 3100 }
  await drag(moved, far)
  await expect(page.getByTestId('pipe-link-break')).toHaveAttribute('stroke', '#c83d36')
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(review(page)).toHaveCount(0)
  expect((await backup('cancelled')).hashes).toEqual(followed.hashes)
  await drag(moved, far)
  await expect(page.getByTestId('pipe-link-break')).toBeAttached()
  await page.mouse.up(); await adopt(page, '室外')
  const detached = await backup('detached')
  expect(pipes(detached)['west-pipe'].fence?.pipeLinks).toBeUndefined()
  expect(pipes(detached)['west-pipe'].segments).toEqual(followedPipe.segments)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const exportPath = info.outputPath('restored.sceneweave')
  const restored = await keyboardProjectBackup(page, exportPath)
  expect(pipes(restored)).toEqual(pipes(followed))
  expect(restored.document.props.item).toEqual(followed.document.props.item)
  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${restored.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await backup('reopened')).hashes).toEqual(restored.hashes)

  const fresh = await browser.newPage()
  try {
    await fresh.goto(home); await importBackup(fresh, await readFile(exportPath))
    await selectKeyboardProp(fresh, 'item')
    const angle = fresh.getByLabel('物件旋转', { exact: true })
    await angle.fill('90'); await angle.press('Tab')
    await adopt(fresh, '室外')
    const rotated = await keyboardProjectBackup(fresh, info.outputPath('rotated.sceneweave'))
    const host = rotated.document.props.item, inlet = host.pipePorts!.inlet!
    expect(host.rotationDeg).toBe(90)
    expect(pipes(rotated)['west-pipe'].segments.at(-1)?.end).toEqual({ x: host.positionMm.x - inlet.y, y: host.positionMm.y + inlet.x })
    expect(pipes(rotated)['east-pipe']).toEqual(pipes(initial)['east-pipe'])
  } finally { await fresh.close() }
})
