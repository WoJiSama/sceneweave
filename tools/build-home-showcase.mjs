import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startHarnessTooling } from './harness/tooling.mjs'

// The exact complete archives are the homepage's source of truth. This offline
// tool validates their real resources and derives the card, detail and demo
// images. Loading an image on Home requires no project archive.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'public/assets/home-scenes')
const content = JSON.parse(await readFile(path.join(root, 'src/platform/browser/content/home-showcase-content.json'), 'utf8'))
const args = process.argv.slice(2)
const flags = new Map()
for (let i = 0; i < args.length; i += 2) {
  if (!['--sample', '--out'].includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw new Error('Usage: node tools/build-home-showcase.mjs [--sample <id>] [--out <directory>]')
  flags.set(args[i], args[i + 1])
}
const selected = flags.get('--sample'), destination = flags.get('--out')
if (selected && !Object.hasOwn(content, selected)) throw new Error('Unknown showcase sample')
const output = destination ? path.resolve(root, destination) : source
const existingManifest = path.join(root, 'src/platform/browser/content/home-showcase-manifest.json')
const manifestPath = destination ? path.join(output, 'manifest.json') : existingManifest
const sha = value => createHash('sha256').update(value).digest('hex')
await mkdir(output, { recursive: true })
const tooling = await startHarnessTooling(root, true)
let browser
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.SCENEWEAVE_BROWSER_CHANNEL ? { channel: process.env.SCENEWEAVE_BROWSER_CHANNEL } : {}) })
  const entries = {}
  for (const [id, copy] of Object.entries(content)) {
    if (selected && selected !== id) continue
    const archiveFile = `${id}.sceneweave`, archive = await readFile(path.join(source, 'projects', archiveFile))
    const context = await browser.newContext({ serviceWorkers: 'block' })
    try {
      await context.addInitScript(() => { IDBFactory.prototype.open = () => { throw Error('Showcase generation must not access browser storage') } })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(tooling.url)
      const rendered = await page.evaluate(async ({ encoded, expected, compareStyles }) => {
        const { importProject } = await import('/src/shared/project/file.ts')
        const { projectContentHash } = await import('/src/shared/project/validate.ts')
        const { browserProjectValidation } = await import('/src/platform/browser/project-validation.ts')
        const { renderEditorProject, renderProject } = await import('/src/platform/browser/render/renderer.ts')
        const { renderObliqueProject } = await import('/src/platform/browser/render/oblique-renderer.ts')
        const { defaultDisplayFloorId, resolveFloorOutput } = await import('/src/shared/floors/output.ts')
        const bundle = await importProject(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), browserProjectValidation)
        if (projectContentHash(bundle.project) !== expected) throw Error('Showcase archive differs from the approved authoring result')
        const document = bundle.project.document
        const displayFloor = defaultDisplayFloorId(document)
        if (!displayFloor) throw Error('Showcase archive requires a display floor')
        const { boundsMm } = resolveFloorOutput(document, displayFloor)
        const floorId = Object.keys(document.floors).length > 1 ? displayFloor : undefined
        const images = []
        for (const longEdgePx of [1024, 4096]) {
          const canvas = await renderProject(bundle, { audience: 'gm', longEdgePx, ...(floorId && { floorId }) })
          try {
            const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data
            const rgbaSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), n => n.toString(16).padStart(2, '0')).join('')
            images.push({ png: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height, rgbaSha256 })
          } finally { canvas.width = canvas.height = 0 }
        }
        const spatial = []
        for (const longEdgePx of [1024, 2560]) {
          const view = await renderObliqueProject(bundle, { audience: 'gm', floorId: displayFloor, longEdgePx })
          try {
            const image = view.toDataURL('image/webp', .94)
            if (!image.startsWith('data:image/webp;')) throw Error('Showcase renderer did not encode WebP')
            spatial.push({ encoded: image.split(',')[1], width: view.width, height: view.height })
          } finally { view.width = view.height = 0 }
        }
        const artStyles = []
        if (compareStyles) {
          const { ART_STYLE_PRESETS, defaultSceneArtStyle } = await import('/src/shared/visual/art-style.ts')
          for (const active of ['original', ...ART_STYLE_PRESETS]) {
            const canvas = await renderEditorProject(bundle, { audience: 'gm', floorId: displayFloor, longEdgePx: 1024,
              artStyleDraft: { ...defaultSceneArtStyle(), active } })
            try {
              const image = canvas.toDataURL('image/webp', .94)
              if (!image.startsWith('data:image/webp;')) throw Error('Showcase renderer did not encode art style WebP')
              artStyles.push({ active, encoded: image.split(',')[1], width: canvas.width, height: canvas.height })
            } finally { canvas.width = canvas.height = 0 }
          }
        }
        return { images, spatial, artStyles, title: document.title, boundsMm, rooms: Object.keys(document.rooms).length,
          terrainAreas: Object.keys(document.terrainAreas).length, props: Object.keys(document.props).length, prefabInstances: Object.keys(document.prefabInstances).length }
      }, { encoded: archive.toString('base64'), expected: copy.projectHash, compareStyles: id === 'fantasy' })
      if (errors.length) throw Error(errors.join('; '))
      const [thumb, full] = rendered.images, file = `${id}-stage1.png`, fullFile = `${id}-stage1-4k.png`
      const png = Buffer.from(thumb.png, 'base64'), fullPng = Buffer.from(full.png, 'base64')
      await writeFile(path.join(output, file), png); await writeFile(path.join(output, fullFile), fullPng)
      const [angle, fullAngle] = rendered.spatial, angleFile = `${id}-3d.webp`, fullAngleFile = `${id}-3d-detail.webp`
      const angleBytes = Buffer.from(angle.encoded, 'base64'), fullAngleBytes = Buffer.from(fullAngle.encoded, 'base64')
      await writeFile(path.join(output, angleFile), angleBytes)
      await writeFile(path.join(output, fullAngleFile), fullAngleBytes)
      const artStyles = {}
      for (const { active, encoded, width, height } of rendered.artStyles) {
        const file = `${id}-style-${active}.webp`, bytes = Buffer.from(encoded, 'base64')
        await writeFile(path.join(output, file), bytes)
        artStyles[active] = { file, width, height, sha256: sha(bytes) }
      }
      const { images: _, spatial: _spatial, artStyles: _artStyles, ...facts } = rendered
      entries[id] = { ...copy, ...facts, audience: 'gm', file, width: thumb.width, height: thumb.height,
        pngSha256: sha(png), rgbaSha256: thumb.rgbaSha256, fullFile, fullWidth: full.width, fullHeight: full.height,
        fullPngSha256: sha(fullPng), fullRgbaSha256: full.rgbaSha256,
        oblique: { file: angleFile, width: angle.width, height: angle.height, sha256: sha(angleBytes),
          fullFile: fullAngleFile, fullWidth: fullAngle.width, fullHeight: fullAngle.height, fullSha256: sha(fullAngleBytes) },
        ...(Object.keys(artStyles).length ? { artStyles } : {}), archiveFile, archiveBytes: archive.length, archiveSha256: sha(archive) }
      console.log(`${id}: validated complete archive and both views at card and detail sizes`)
    } finally { await context.close() }
  }
  const previous = selected ? JSON.parse(await readFile(existingManifest, 'utf8')).entries : {}
  const manifest = { generator: 'tools/build-home-showcase.mjs', renderer: 'native-complete-v1', entries: { ...previous, ...entries } }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
} finally { await browser?.close(); await tooling.close() }
