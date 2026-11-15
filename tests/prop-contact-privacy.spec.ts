import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'vite'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function pixels(bytes: Buffer) {
  const png = PNG.sync.read(bytes), chunks: string[] = []
  for (let at = 8; at < bytes.length;) { const length = bytes.readUInt32BE(at); chunks.push(bytes.toString('ascii', at + 4, at + 8)); at += length + 12 }
  expect(chunks.every(chunk => ['IHDR', 'IDAT', 'IEND', 'sRGB'].includes(chunk))).toBe(true)
  return { width: png.width, height: png.height, rgbaSha256: sha(png.data), chunks }
}
async function observe(page: Page, audience: 'gm' | 'player', path: string) {
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: audience === 'gm' ? '主持人' : '玩家', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const canvas = page.getByLabel(audience === 'gm' ? '材质场景主持人预览' : '材质场景玩家预览', { exact: true })
  const preview = Buffer.from(await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL('image/png').split(',')[1]), 'base64')
  await writeFile(path + '-preview.png', preview)
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await pending).saveAs(path + '-4096.png'); await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  const png = await readFile(path + '-4096.png')
  expect(png.includes(Buffer.from('SECRET-CONTACT'))).toBe(false)
  expect(pixels(png).width).toBe(4096)
  return { preview: pixels(preview), png: pixels(png) }
}

test('shadowless private images use their body mask through normal import, dual-audience output and cold reopen', async ({ browser }, info) => {
  test.setTimeout(180000)
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' }), inputs: { variant: string; path: string }[] = []
  try {
    const { fixture, validation, runtime } = await vite.ssrLoadModule('/src/application/workspace/test-fixtures.ts')
    const { createCompositionContent } = await vite.ssrLoadModule('/src/shared/appearance/graph.ts')
    const { exportProject } = await vite.ssrLoadModule('/src/shared/project/file.ts')
    const { visualBase } = await vite.ssrLoadModule('/src/shared/visual/base.ts')
    for (const variant of ['public', 'secret-a', 'secret-b']) {
      const bundle = fixture({ image: true }), scene = bundle.project.document, prop = scene.props.item
      scene.title = '关闭阴影的图片与固定遮罩'
      visualBase(scene).environment.contactShadowMm = 50; visualBase(scene).environment.contactShadowOpacity = .4
      if (variant !== 'public') {
        prop.visibility = 'gm'; prop.appearance.opacity = variant === 'secret-a' ? 1 : .3
        const { x, y } = prop.positionMm, b = prop.visualBoundsMm
        scene.regions.mask = { id: 'mask', floorId: prop.floorId, editLocked: false, visibility: 'gm', kind: 'manualMask',
          boundaryMm: [{ x: x + b.x, y: y + b.y }, { x: x + b.x + b.width, y: y + b.y }, { x: x + b.x + b.width, y: y + b.y + b.height }, { x: x + b.x, y: y + b.y + b.height }],
          blocksMovement: false, movementCostMultiplier: 1 }
        scene.notes.secret = { id: 'secret', floorId: prop.floorId, editLocked: false, visibility: 'gm', kind: 'note', text: 'SECRET-CONTACT-FIXED',
          anchor: { type: 'entity', entityKind: 'prop', entityId: prop.id } }
        scene.entityLayers.mask = scene.entityLayers.item; scene.entityLayers.secret = scene.entityLayers.item
      }
      Object.assign(bundle.project, createCompositionContent(scene, runtime))
      const path = info.outputPath(variant + '-input.sceneweave')
      await writeFile(path, await exportProject(bundle, validation)); inputs.push({ variant, path })
    }
  } finally { await vite.close() }
  const results: any[] = []
  for (const { variant, path } of inputs) {
    const context = await browser.newContext(), page = await context.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      const response = await page.goto('./#home')
      expect(response?.ok()).toBe(true)
      if (process.env.SCENEWEAVE_TEST_BASE_URL) expect(await response!.text()).not.toContain('/@vite/client')
      await page.getByTestId('native-project-file').setInputFiles(path); await keyboardWorkspaceSaved(page)
      const initial = await keyboardProjectBackup(page, info.outputPath(variant + '-initial.sceneweave'))
      if (variant !== 'public') {
        expect(initial.document.props.item.shadowClass).toBe('none'); expect(initial.document.props.item.shadowOverride).toBeNull()
        expect(initial.document.props.item.visibility).toBe('gm')
      }
      const observations: any[] = []
      for (const phase of ['imported', 'cold']) {
        if (phase === 'cold') {
          await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
          await page.locator(`[data-project-key="native:${initial.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
          await keyboardWorkspaceSaved(page)
          const cold = await keyboardProjectBackup(page, info.outputPath(variant + '-cold.sceneweave'))
          expect(cold.hashes).toEqual(initial.hashes)
          expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(initial.hashes))
        }
        for (const audience of ['gm', 'player'] as const) observations.push({ phase, audience, ...await observe(page, audience, info.outputPath(`${variant}-${phase}-${audience}`)) })
      }
      for (const audience of ['gm', 'player']) {
        const images = observations.filter(o => o.audience === audience)
        expect(images[1].preview).toEqual(images[0].preview); expect(images[1].png).toEqual(images[0].png)
      }
      expect(errors).toEqual([])
      results.push({ variant, observations, pageErrors: errors })
      await writeFile(info.outputPath('facts.json'), JSON.stringify({ normalProduction: !!process.env.SCENEWEAVE_TEST_BASE_URL, results }, null, 2))
    } finally { await context.close() }
  }
  for (const phase of ['imported', 'cold']) {
    const image = (variant: string, audience: string) => results.find(r => r.variant === variant).observations.find((o: any) => o.phase === phase && o.audience === audience)
    expect(image('secret-a', 'player')).toEqual(image('secret-b', 'player'))
    expect(image('secret-a', 'gm').png.rgbaSha256).not.toBe(image('secret-b', 'gm').png.rgbaSha256)
  }
})
