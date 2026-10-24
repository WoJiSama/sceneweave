import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

// Refresh the homepage scene images from the complete, validated native samples.
// This runs outside the product: visiting Home never loads sample resources or
// creates a project just to display a card.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'public/assets/home-scenes')
const fixed = JSON.parse(await readFile(path.join(root, 'src/platform/browser/content/scenes-data.json'), 'utf8'))
const samples = ['study', 'island', 'outpost', 'graveyard', 'volcano', 'calibration']
const sha = value => createHash('sha256').update(value).digest('hex')
await mkdir(output, { recursive: true })
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5194, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ channel: process.env.SCENEWEAVE_BROWSER_CHANNEL ?? 'chrome' })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:5194/')
  const entries = {}
  for (const sample of samples) {
    const rendered = await page.evaluate(async sample => {
      const factoryPath = '/src/platform/browser/content/factories.ts'
      const bundlePath = '/src/application/workspace/project.ts'
      const rendererPath = '/src/platform/browser/render/renderer.ts'
      const { createSampleProject } = await import(factoryPath)
      const { toBundle } = await import(bundlePath)
      const { renderProject } = await import(rendererPath)
      const project = await createSampleProject(sample)
      const canvas = await renderProject(toBundle(project), { audience: 'gm', longEdgePx: 1600 })
      try {
        const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data
        const rgbaSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), n => n.toString(16).padStart(2, '0')).join('')
        return { png: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height, rgbaSha256 }
      } finally { canvas.width = canvas.height = 0 }
    }, sample)
    const png = Buffer.from(rendered.png, 'base64'), document = fixed.scenes[sample].document
    await writeFile(path.join(output, `${sample}.png`), png)
    entries[sample] = { file: `${sample}.png`, title: document.title, audience: 'gm', width: rendered.width, height: rendered.height,
      boundsMm: document.exportBoundsMm, rooms: Object.keys(document.rooms).length, terrainAreas: Object.keys(document.terrainAreas).length,
      props: Object.keys(document.props).length, prefabInstances: Object.keys(document.prefabInstances).length,
      sourceSceneSha256: sha(JSON.stringify(fixed.scenes[sample])), pngSha256: sha(png), rgbaSha256: rendered.rgbaSha256 }
    console.log(`${sample}: ${rendered.width} × ${rendered.height}, ${png.length} bytes`)
  }
  await writeFile(path.join(root, 'src/editor/main-shell/showcase-manifest.json'), JSON.stringify({ generator: 'tools/build-home-showcase.mjs', renderer: 'native-complete-v1', entries }, null, 2) + '\n')
} finally {
  await browser?.close()
  await server.close()
}
