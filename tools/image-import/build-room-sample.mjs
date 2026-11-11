import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { assert, digest, readBounded, replaceResult, writeVerified } from '../harness/io.mjs'
import { startHarnessTooling } from '../harness/tooling.mjs'
import { verifyDiskDelivery } from '../harness/browser.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const usage = `Usage:
  node tools/image-import/build-room-sample.mjs --input ABS_MANIFEST_JSON --output NEW_ABS_DIR

The local manifest supplies floor, piano and rug PNG layers. Each layer contains
path and boundsPx {x,y,width,height} in the original image coordinate system.
Relative PNG paths are resolved against the manifest directory. licenseText and
attribution describe the exact supplied layers. Optional sceneId and now fix the
new project identity and timestamp. Output must not exist and its parent must
exist. Only result.json status complete confirms disk reread, native cold import
and matching preview pixels. Import map.sceneweave in the editor to continue.
Install the bundled browser with npx playwright install chromium.`

function options(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    assert(['--input', '--output'].includes(key) && !values.has(key) && value && !value.startsWith('--'), usage)
    values.set(key, value)
  }
  const input = values.get('--input'), output = values.get('--output')
  assert(input && path.isAbsolute(input) && output && path.isAbsolute(output), usage)
  assert(path.resolve(input) !== path.resolve(output), 'Input and output must differ')
  return { input: path.resolve(input), output: path.resolve(output) }
}

async function captureInput(file) {
  const original = await readBounded(file, 64 * 1024)
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original))
  const allowed = ['floor', 'piano', 'rug', 'licenseText', 'attribution', 'sceneId', 'now']
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest) && Object.keys(manifest).every(key => allowed.includes(key)), 'Unknown manifest fields')
  assert(typeof manifest.licenseText === 'string' && manifest.licenseText.trim() && typeof manifest.attribution === 'string' && manifest.attribution.trim(), 'License text and attribution are required')
  const input = { licenseText: manifest.licenseText, attribution: manifest.attribution }
  for (const key of ['sceneId', 'now']) {
    if (manifest[key] !== undefined) {
      assert(typeof manifest[key] === 'string' && manifest[key], `Invalid ${key}`)
      input[key] = manifest[key]
    }
  }
  const sources = {}
  for (const key of ['floor', 'piano', 'rug']) {
    const layer = manifest[key]
    assert(layer && typeof layer === 'object' && Object.keys(layer).every(name => ['path', 'boundsPx'].includes(name)), `Invalid ${key} layer`)
    assert(typeof layer.path === 'string' && layer.path, `Missing ${key} PNG path`)
    const bounds = layer.boundsPx
    assert(bounds && Object.keys(bounds).length === 4 && ['x', 'y', 'width', 'height'].every(name => typeof bounds[name] === 'number' && Number.isFinite(bounds[name])) && bounds.width > 0 && bounds.height > 0, `Invalid ${key} boundsPx`)
    const bytes = await readBounded(path.resolve(path.dirname(file), layer.path), 20 * 1024 * 1024)
    assert(bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR', `Invalid ${key} PNG`)
    const pixelWidth = bytes.readUInt32BE(16), pixelHeight = bytes.readUInt32BE(20)
    assert(pixelWidth > 0 && pixelHeight > 0 && pixelWidth <= 8192 && pixelHeight <= 8192 && pixelWidth * pixelHeight <= 32_000_000, `Invalid ${key} PNG dimensions`)
    input[key] = { pngBase64: bytes.toString('base64'), pixelWidth, pixelHeight, boundsPx: bounds }
    sources[key] = { sha256: digest(bytes), byteLength: bytes.length, pixelWidth, pixelHeight, boundsPx: bounds }
  }
  return { input, sources, manifestHash: digest(original) }
}

async function buildInBrowser(input) {
  const samplePath = '/src/platform/browser/content/image-room-sample.ts'
  const projectPath = '/src/application/workspace/project.ts'
  const filePath = '/src/shared/project/file.ts'
  const validationPath = '/src/platform/browser/project-validation.ts'
  const hashPath = '/src/shared/project/validate.ts'
  const rendererPath = '/src/platform/browser/render/renderer.ts'
  const imagesPath = '/src/platform/browser/images/adapter.ts'
  const { createImageRoomSampleProject } = await import(samplePath)
  const { toBundle } = await import(projectPath)
  const { exportProject } = await import(filePath)
  const { browserProjectValidation } = await import(validationPath)
  const { projectContentHash } = await import(hashPath)
  const { exportPng } = await import(rendererPath)
  const { normalizeBrowserImage } = await import(imagesPath)
  const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0))
  const encode = bytes => {
    let value = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    return btoa(value)
  }
  const normalizedLayers = {}
  for (const key of ['floor', 'piano', 'rug']) {
    const normalized = await normalizeBrowserImage(decode(input[key].pngBase64), 'image/png')
    input[key].pngBytes = normalized.bytes
    input[key].pixelWidth = normalized.record.pixelWidth
    input[key].pixelHeight = normalized.record.pixelHeight
    normalizedLayers[key] = normalized.record
    delete input[key].pngBase64
  }
  const sample = await createImageRoomSampleProject(input), bundle = toBundle(sample)
  const archive = await exportProject(bundle, browserProjectValidation)
  const png = new Uint8Array(await (await exportPng(bundle, { audience: 'player', longEdgePx: 2048 })).arrayBuffer())
  return { archiveBase64: encode(archive), previewBase64: encode(png), projectHash: projectContentHash(bundle.project),
    normalizedLayers, sceneId: bundle.project.document.sceneId, title: bundle.project.document.title }
}

async function run(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(`${usage}\n`); return }
  const config = options(args), captured = await captureInput(config.input)
  let tooling, browser, context, record, output, stopReason, timer, complete = false
  const checkCurrent = () => assert(!stopReason, stopReason)
  const stop = reason => { if (!complete) { stopReason ??= reason; void browser?.close().catch(() => {}) } }
  const interrupt = () => stop('Operation cancelled')
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
  try {
    await fs.mkdir(config.output, { mode: 0o700 }); output = config.output
    record = { format: 'sceneweave-image-room-sample-result', version: 1, status: 'running', startedAt: new Date().toISOString(),
      manifestHash: captured.manifestHash, sources: captured.sources, formalAcceptance: false, modelRequests: 0 }
    await fs.writeFile(path.join(output, 'result.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    timer = setTimeout(() => stop('Sample creation exceeded its 360-second deadline'), 360000)
    tooling = await startHarnessTooling(root, true)
    browser = await chromium.launch({ headless: true })
    checkCurrent()
    context = await browser.newContext({ serviceWorkers: 'block' })
    const browserErrors = []
    context.on('page', page => page.on('pageerror', error => browserErrors.push(error.message)))
    await context.route('**/*', route => route.request().url().startsWith(`${tooling.origin}/`) ? route.continue() : route.abort('blockedbyclient'))
    await context.addInitScript(() => {
      IDBFactory.prototype.open = () => { throw new Error('File-only sample builder cannot open browser databases') }
      IDBFactory.prototype.deleteDatabase = () => { throw new Error('File-only sample builder cannot delete browser databases') }
    })
    const page = await context.newPage()
    await page.goto(tooling.url)
    const built = await page.evaluate(buildInBrowser, captured.input)
    checkCurrent()
    const archive = await writeVerified(output, 'map.sceneweave', Buffer.from(built.archiveBase64, 'base64'))
    const preview = await writeVerified(output, 'preview.png', Buffer.from(built.previewBase64, 'base64'))
    const coldPage = await context.newPage()
    await coldPage.goto(tooling.url)
    const diskVerification = await coldPage.evaluate(verifyDiskDelivery, { archiveBase64: archive.bytes.toString('base64'),
      previewBase64: preview.bytes.toString('base64'), expectedProjectHash: built.projectHash })
    checkCurrent()
    assert(browserErrors.length === 0, `Browser execution errors: ${browserErrors.join('; ')}`)
    record = { ...record, status: 'complete', completedAt: new Date().toISOString(), projectHash: built.projectHash,
      sceneId: built.sceneId, title: built.title, normalizedLayers: built.normalizedLayers,
      browser: { engine: 'chromium', version: browser.version(), isolated: true },
      files: { project: archive.record, preview: preview.record }, diskVerification, browserErrors }
    await replaceResult(output, record, { checkCurrent, onPublished: () => { complete = true } })
    process.stdout.write(`${JSON.stringify({ status: 'complete', output, projectHash: built.projectHash, diskVerification }, null, 2)}\n`)
  } catch (error) {
    const message = stopReason ?? (error instanceof Error ? error.message : 'Sample creation failed')
    if (record && output) await replaceResult(output, { ...record, status: 'failed', completedAt: new Date().toISOString(), error: message }).catch(() => {})
    throw new Error(message)
  } finally {
    clearTimeout(timer)
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    try { await context?.close() } finally {
      try { await browser?.close() } finally { await tooling?.close() }
    }
  }
}

run(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Sample creation failed'}\n`)
  process.exitCode = 1
})
