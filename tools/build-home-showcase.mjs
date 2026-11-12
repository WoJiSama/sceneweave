import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startHarnessTooling } from './harness/tooling.mjs'

// The exact complete archives are the homepage's source of truth. This offline
// tool validates their real resources and derives both card and detail images;
// Home itself never reads archives or writes projects just to display a card.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'public/assets/home-scenes')
const content = JSON.parse(await readFile(path.join(root, 'src/platform/browser/content/home-showcase-content.json'), 'utf8'))
const sha = value => createHash('sha256').update(value).digest('hex')
await mkdir(output, { recursive: true })
const tooling = await startHarnessTooling(root, true)
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.env.SCENEWEAVE_BROWSER_CHANNEL ? { channel: process.env.SCENEWEAVE_BROWSER_CHANNEL } : {}) })
  const entries = {}
  for (const [id, copy] of Object.entries(content)) {
    const archiveFile = `${id}.sceneweave`, archive = await readFile(path.join(output, 'projects', archiveFile))
    const context = await browser.newContext({ serviceWorkers: 'block' })
    try {
      await context.addInitScript(() => { IDBFactory.prototype.open = () => { throw Error('Showcase generation must not access browser storage') } })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(tooling.url)
      const rendered = await page.evaluate(async ({ encoded, expected }) => {
        const { importProject } = await import('/src/shared/project/file.ts')
        const { projectContentHash } = await import('/src/shared/project/validate.ts')
        const { browserProjectValidation } = await import('/src/platform/browser/project-validation.ts')
        const { renderProject } = await import('/src/platform/browser/render/renderer.ts')
        const bundle = await importProject(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), browserProjectValidation)
        if (projectContentHash(bundle.project) !== expected) throw Error('Showcase archive differs from the approved authoring result')
        const images = []
        for (const longEdgePx of [1024, 4096]) {
          const canvas = await renderProject(bundle, { audience: 'gm', longEdgePx })
          try {
            const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data
            const rgbaSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), n => n.toString(16).padStart(2, '0')).join('')
            images.push({ png: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height, rgbaSha256 })
          } finally { canvas.width = canvas.height = 0 }
        }
        const document = bundle.project.document
        return { images, title: document.title, boundsMm: document.exportBoundsMm, rooms: Object.keys(document.rooms).length,
          terrainAreas: Object.keys(document.terrainAreas).length, props: Object.keys(document.props).length, prefabInstances: Object.keys(document.prefabInstances).length }
      }, { encoded: archive.toString('base64'), expected: copy.projectHash })
      if (errors.length) throw Error(errors.join('; '))
      const [thumb, full] = rendered.images, file = `${id}-stage1.png`, fullFile = `${id}-stage1-4k.png`
      const png = Buffer.from(thumb.png, 'base64'), fullPng = Buffer.from(full.png, 'base64')
      await writeFile(path.join(output, file), png); await writeFile(path.join(output, fullFile), fullPng)
      const { images: _, ...facts } = rendered
      entries[id] = { ...copy, ...facts, audience: 'gm', file, width: thumb.width, height: thumb.height,
        pngSha256: sha(png), rgbaSha256: thumb.rgbaSha256, fullFile, fullWidth: full.width, fullHeight: full.height,
        fullPngSha256: sha(fullPng), fullRgbaSha256: full.rgbaSha256, archiveFile, archiveBytes: archive.length, archiveSha256: sha(archive) }
      console.log(`${id}: validated complete archive, ${thumb.width} × ${thumb.height} and ${full.width} × ${full.height}`)
    } finally { await context.close() }
  }
  await writeFile(path.join(root, 'src/platform/browser/content/home-showcase-manifest.json'), JSON.stringify({ generator: 'tools/build-home-showcase.mjs', renderer: 'native-complete-v1', entries }, null, 2) + '\n')
} finally { await browser?.close(); await tooling.close() }
