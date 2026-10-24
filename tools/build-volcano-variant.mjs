import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

// Apply a new fixed appearance to the native sample. The published lava image,
// material definition and surface source stay available in the complete closure.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const filename = path.join(root, 'src/platform/browser/content/scenes-data.json')
const data = JSON.parse(await readFile(filename, 'utf8'))
const { assets: [art] } = JSON.parse(await readFile(path.join(root, 'assets/sceneweave-handdrawn-content/lava-hot-manifest.json'), 'utf8'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5195, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ channel: process.env.SCENEWEAVE_BROWSER_CHANNEL ?? 'chrome' })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:5195/')
  const project = await page.evaluate(async ({ data, art }) => {
    const { addSurfaceAppearanceSource } = await import('/src/shared/appearance/graph.ts')
    const { createMemoryResources, validateProjectBundle } = await import('/src/shared/project/resources.ts')
    const { loadFixedResources } = await import('/src/platform/browser/content/load-resources.ts')
    const { validation } = await import('/src/platform/browser/runtime.ts')
    const project = data.scenes.volcano, document = project.document
    const assetId = 'content-a-lava-hot', materialId = 'content-m-lava-hot'
    const existing = document.assets[assetId]
    if (existing && existing.sha256 !== art.sha256) throw new Error('Fixed lava-hot artwork already exists with different bytes; publish a distinct variant instead of replacing it.')
    document.assets[assetId] = { ...document.assets['content-a-lava'], id: assetId, sha256: art.sha256, pixelWidth: art.pixelWidth, pixelHeight: art.pixelHeight }
    document.materials[materialId] = { ...document.materials['content-m-lava'], id: materialId, catalogId: art.catalogId, name: art.name,
      tags: ['墨绘原野', '原创', ...art.tags], textureAssetId: assetId }
    project.assets[art.sha256] = { sha256: art.sha256, mimeType: 'image/png', pixelWidth: art.pixelWidth, pixelHeight: art.pixelHeight, sizeBytes: art.sizeBytes }
    for (const [kind, originalId, id] of [['asset', 'content-a-lava', assetId], ['material', 'content-m-lava', materialId]]) {
      if (!project.licenseBindings.some(binding => binding.subjectKind === kind && binding.subjectId === id)) {
        const source = project.licenseBindings.find(binding => binding.subjectKind === kind && binding.subjectId === originalId)
        if (!source) throw new Error('Original lava license is missing')
        project.licenseBindings.push({ ...source, subjectId: id })
      }
    }
    const target = document.terrainAreas['volcano-lava-visual'], previous = project.appearance.surfaceSources[target.id]
    if (target.surfaceStyle.base.materialRef.id !== materialId) {
      target.surfaceStyle.base.materialRef = { id: materialId, version: 1 }
      project.appearance.surfaceSources[target.id] = addSurfaceAppearanceSource(project.appearance, target.surfaceStyle, previous)
    }
    const paths = { ...data.paths, [art.sha256]: `assets/sceneweave-handdrawn-content/${art.file}` }
    const bytes = await loadFixedResources(project.assets, paths, data.embedded)
    await validateProjectBundle({ project, resources: createMemoryResources(bytes) }, validation)
    return project
  }, { data, art })
  data.scenes.volcano = project
  data.paths[art.sha256] = `assets/sceneweave-handdrawn-content/${art.file}`
  await writeFile(filename, JSON.stringify(data) + '\n')
  console.log(`Volcano sample: independent ${art.catalogId} v${art.version}; ${Object.keys(project.assets).length} preserved image resources`)
} finally {
  await browser?.close()
  await server.close()
}
