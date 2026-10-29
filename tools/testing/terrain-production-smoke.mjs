import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { chromium, expect } from '@playwright/test'
import { preview } from 'vite'

// Run from the repository root, only AFTER a normal `npm run build`, and serially
// with all other browser/test/build work. This script never builds the app.
// Every application write uses its actual UI in a fresh browser context. No DEV
// imports, application hooks, injected storage, model calls or user browser profile.
const root = process.cwd(), work = path.resolve(root, 'work'), dist = path.join(root, 'dist')
const output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? path.join(work, 'terrain-t0t1-20261026/production'))
assert(output.startsWith(`${work}${path.sep}`), 'Raw smoke output must stay under ignored work/.')
const port = Number(process.env.SCENEWEAVE_TERRAIN_SMOKE_PORT ?? 5195)
assert(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid preview port.')
const base = process.env.SCENEWEAVE_BASE_PATH ?? '/sceneweave/'
assert(/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base), 'Base must be a local absolute path with trailing slash.')
const origin = `http://127.0.0.1:${port}`, url = `${origin}${base}#workspace`, seed = 'terrain-v1-0'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const json = bytes => JSON.parse(decode(bytes))
await mkdir(output, { recursive: true })

const kinds = (process.env.SCENEWEAVE_TERRAIN_KINDS ?? 'island,coast').split(',')
assert(kinds.length > 0 && new Set(kinds).size === kinds.length && kinds.every(kind => ['island', 'coast', 'river', 'lake', 'forest', 'hill', 'mixed'].includes(kind)), 'Invalid terrain kinds.')
const withRoute = process.env.SCENEWEAVE_TERRAIN_ROUTE === '1'
const cancellation = process.env.SCENEWEAVE_TERRAIN_CANCEL ?? 'all'
assert(['all', 'first'].includes(cancellation), 'Invalid cancellation coverage.')
const labels = { island: '岩岛', coast: '海岸', river: '河谷', lake: '内湖', forest: '森林', hill: '丘陵', mixed: '混合' }
const started = Date.now(), checks = [], errors = [], consoleErrors = [], httpErrors = [], requestFailures = [], blockedRequests = [], workers = []
const buildFiles = new Map()
const result = { status: 'running', method: 'Normal production Vite preview under the production base path. Actual UI selected terrain generation, cancellation, independent candidate export/adoption/save, complete package download, cold reload through the saved-version button and dual-audience 4K PNG. Real Worker events and compiled assets are recorded; package entries/resources are checked by actual SHA-256. This bounded smoke is not a full regression, model journey, performance result or P3 art acceptance.',
  url, output, seed, kinds, withRoute, cancellation, checks, errors, consoleErrors, httpErrors, requestFailures, blockedRequests, workers }
let server, browser, context, page
const writeResult = () => writeFile(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
async function step(name, run) {
  const start = Date.now(), observation = await run()
  checks.push({ name, elapsedMs: Date.now() - start, ...observation })
  console.log(`PASS ${name}`)
  await writeResult()
  return observation
}

async function inspectBuild() {
  const html = await readFile(path.join(dist, 'index.html'), 'utf8')
  assert(!/@vite\/client|@react-refresh|\/src\/|performance\/b5/.test(html), 'Expected a normal production build.')
  assert(html.includes(`src="${base}assets/`), `Production assets must use ${base}assets/.`)
  const walk = async folder => {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name)
      if (item.isDirectory()) await walk(file)
      else if (item.name.endsWith('.js')) {
        const bytes = await readFile(file), text = decode(bytes), relative = path.relative(dist, file).split(path.sep).join('/')
        assert(!/__sceneweave[A-Za-z0-9_]*(?:Dev|Performance)|@vite\/client|@react-refresh|performance\/b5-harness/i.test(text), `DEV/performance code in ${relative}.`)
        buildFiles.set(relative, { file, text, sizeBytes: bytes.length, sha256: sha256(bytes) })
      }
    }
  }
  await walk(path.join(dist, 'assets'))
  assert(buildFiles.size > 0, 'Missing production JavaScript.')
  return { indexSha256: sha256(Buffer.from(html)), javascript: [...buildFiles].map(([file, value]) => ({ file, sha256: value.sha256, sizeBytes: value.sizeBytes })) }
}

async function rendered() {
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90_000 })
  const canvas = page.locator('canvas[aria-label="材质场景主持人预览"], canvas[aria-label="材质场景玩家预览"]')
  await expect(canvas).toBeVisible({ timeout: 90_000 })
  await expect.poll(() => canvas.evaluate(value => value.width > 0 && value.height > 0), { timeout: 90_000 }).toBe(true)
}
async function settled(title) {
  await expect(page.locator('.workspace-project-title h1')).toHaveText(title)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90_000 })
  await rendered()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
}
async function primaryState() {
  return { title: await page.locator('.workspace-project-title h1').innerText(), save: (await page.locator('.asset-save').innerText()).trim(),
    fullProjectEnabled: await page.getByRole('button', { name: '完整工程', exact: true }).isEnabled() }
}
async function productionGuards() {
  const observation = await page.evaluate(() => ({ userAgent: navigator.userAgent,
    hooks: Object.getOwnPropertyNames(window).filter(key => /^__sceneweave/i.test(key)),
    scripts: [...document.scripts].map(script => script.src).filter(Boolean) }))
  assert.deepEqual(observation.hooks, [], 'Normal production must not expose application DEV/performance hooks.')
  assert(observation.scripts.length > 0 && observation.scripts.every(src => {
    const target = new URL(src)
    return target.origin === origin && target.pathname.startsWith(`${base}assets/`)
  }), 'Entry scripts must come from local compiled assets.')
  assert.deepEqual(errors, [], 'Browser page errors occurred.')
  assert.deepEqual(consoleErrors, [], 'Browser console errors occurred.')
  assert.deepEqual(httpErrors, [], 'Production resource requests failed.')
  assert.deepEqual(requestFailures, [], 'A browser resource request failed.')
  assert.deepEqual(blockedRequests, [], 'The smoke attempted a non-preview network request.')
  return observation
}
async function compiledWorker(previousCount) {
  await expect.poll(() => workers.length, { timeout: 30_000 }).toBeGreaterThan(previousCount)
  const observed = workers.at(-1), target = new URL(observed.url)
  assert.equal(target.origin, origin, 'Worker must be local.')
  assert(target.pathname.startsWith(`${base}assets/`) && target.pathname.endsWith('.js'), 'Worker must be a compiled JavaScript asset.')
  assert.equal(target.search, '', 'Worker must not load a DEV transform URL.')
  const assetPath = target.pathname.slice(base.length), built = buildFiles.get(assetPath)
  assert(built, `Observed Worker is absent from dist: ${assetPath}.`)
  assert(/postMessage/.test(built.text) && /onmessage/.test(built.text) && /terrain-|地形/.test(built.text), 'Expected the bundled terrain Worker protocol.')
  Object.assign(observed, { assetPath, sha256: built.sha256, sizeBytes: built.sizeBytes })
  return { workerEvent: workers.length, assetPath, sha256: built.sha256, sizeBytes: built.sizeBytes }
}
async function generate() {
  const previousCount = workers.length
  await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
  await expect(page.getByRole('article', { name: '当前地形候选', exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90_000 })
  await expect(page.locator('.terrain-generation-progress')).toHaveCount(0, { timeout: 90_000 })
  await rendered()
  const costPanel = page.locator('.terrain-generation-cost')
  if (!await costPanel.evaluate(element => element.open)) await costPanel.locator('summary').click()
  const costText = await costPanel.locator('dl > div').first().locator('dd').innerText(), match = /(\d+)\s*\/\s*(\d+)/.exec(costText)
  assert(match, `Missing actual candidate cost: ${costText}.`)
  const cost = { total: Number(match[1]), limit: Number(match[2]) }
  assert(cost.total > 0 && cost.total <= cost.limit && cost.limit === 256, 'Candidate must respect the actual 256-cost boundary.')
  return { cost, worker: await compiledWorker(previousCount) }
}
async function download(button, filename, expectedName) {
  const pending = page.waitForEvent('download', { timeout: 120_000 })
  await button.click()
  const downloaded = await pending
  assert.equal(downloaded.suggestedFilename(), expectedName)
  const file = path.join(output, filename)
  await downloaded.saveAs(file)
  assert.equal(await downloaded.failure(), null)
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90_000 })
  return { bytes: await readFile(file), file }
}

function inspectProject(downloaded, kind) {
  const files = unzipSync(downloaded.bytes), manifest = json(files['manifest.json']), scene = json(files['scene.json'])
  const identity = json(files['identity.json']), appearance = json(files['appearance.json']), sources = json(files['sources.json'])
  assert.equal(manifest.format, 'sceneweave-complete-project'); assert.equal(manifest.schemaVersion, 3); assert.equal(manifest.packageMode, 'complete')
  assert.equal(scene.format, 'sceneweave-scene'); assert.equal(scene.schemaVersion, 3); assert.equal(scene.mapMode, 'scene'); assert.equal(scene.regional, null)
  assert.equal(scene.visual.version, 2); assert.equal(scene.visual.base.version, 1)
  assert.equal(identity.version, 2); assert.equal(identity.rootSceneId, scene.sceneId); assert.equal(appearance.version, 2)
  assert.equal(manifest.sceneId, scene.sceneId); assert.equal(manifest.revision, scene.revision)
  assert.equal(Object.keys(files).length, manifest.entries.length + 1)
  const entryPaths = new Set(manifest.entries.map(entry => entry.path))
  assert.equal(entryPaths.size, manifest.entries.length)
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', ...entryPaths].sort())
  for (const entry of manifest.entries) {
    assert(files[entry.path], `Missing package entry ${entry.path}.`)
    assert.equal(files[entry.path].length, entry.sizeBytes, entry.path)
    assert.equal(sha256(files[entry.path]), entry.sha256, entry.path)
  }
  const assetEntries = manifest.entries.filter(entry => entry.role === 'asset')
  assert.equal(assetEntries.length, Object.keys(manifest.assetRecords).length)
  const variants=Object.values(appearance.variants)
  assert.equal(assetEntries.length, (kind === 'coast' ? 15 : 13) + variants.length, 'Retain the original blank palette plus every real fixed paint derivative.')
  for(const variant of variants) {
    assert(scene.assets[variant.sourceAssetId] && scene.assets[variant.outputAssetId], 'A paint variant must retain both actual source and output assets.')
    assert(manifest.assetRecords[scene.assets[variant.outputAssetId].sha256], 'A paint variant must carry its actual PNG bytes.')
  }
  for (const entry of assetEntries) {
    const record = manifest.assetRecords[entry.sha256]
    assert(record, `Missing image record ${entry.path}.`)
    assert.equal(record.sha256, entry.sha256); assert.equal(record.mimeType, entry.mimeType); assert.equal(record.sizeBytes, entry.sizeBytes)
  }
  for (const asset of Object.values(scene.assets)) {
    const record = manifest.assetRecords[asset.sha256]
    assert(record, `Unpacked image closure is missing ${asset.id}.`)
    assert.equal(record.mimeType, asset.mimeType); assert.equal(record.pixelWidth, asset.pixelWidth); assert.equal(record.pixelHeight, asset.pixelHeight)
    assert(manifest.licenseBindings.some(binding => binding.subjectKind === 'asset' && binding.subjectId === asset.id && binding.licenseRef === asset.licenseRef))
  }
  assert.equal(Object.keys(sources).length, kind === 'coast' ? 15 : 13)
  for (const source of Object.values(sources)) {
    assert.equal(source.kind, 'svg')
    for (const [hash, size] of [[source.sourceSha256, source.sourceSizeBytes], [source.normalizedSha256, source.normalizedSizeBytes]]) {
      assert(files[`sources/${hash}.svg`]); assert.equal(files[`sources/${hash}.svg`].length, size); assert.equal(sha256(files[`sources/${hash}.svg`]), hash)
    }
    assert(manifest.assetRecords[source.rasterSha256], 'Retain the actual raster for every fixed source.')
  }
  assert(manifest.licenseBindings.length > 0 && manifest.licenseBindings.every(binding => binding.embedding === 'allowed' && files[binding.licensePath]))
  assert(manifest.entries.some(entry => entry.role === 'license'), 'Complete package must carry license text.')
  assert.equal(scene.generation.version, 1)
  const recipes = Object.values(scene.generation.recipes)
  assert.equal(recipes.length, 1); assert.equal(recipes[0].algorithmId, ['island', 'coast'].includes(kind) ? 'terrain-scene' : 'terrain-scene-t3'); assert.equal(recipes[0].algorithmVersion, ['island', 'coast'].includes(kind) ? 2 : 1)
  assert.equal(recipes[0].seed, seed); assert.equal(recipes[0].parameters.terrainKind, kind)
  assert(Object.keys(scene.generation.rules).length > 0 && Object.values(scene.generation.rules).every(rule => rule.state === 'active'))
  assert(Object.keys(scene.generation.ownership).length > 0 && Object.values(scene.generation.ownership).every(row => row.state === 'managed'))
  assert(Object.keys(scene.generation.checks).length > 0 && Object.values(scene.generation.checks).every(check => check.state === 'passed'))
  assert(Object.keys(identity.generationTokens).length > 0)
  assert(identity.regionalTokens && identity.presentationTokens && appearance.presentations)
  assert(Object.values(appearance.presentations).every(presentation => presentation.mode === 'topDown'))
  assert(Object.keys(scene.terrainAreas).length >= 2 && Object.keys(scene.props).length >= 4)
  assert.equal(scene.terrainConnections['terrain-stairs'].kind, ['island', 'coast'].includes(kind) ? 'stairs' : 'ramp'); assert.equal(scene.terrainConnections['terrain-stairs'].widthMm, 1500)
  if (withRoute && !['island', 'coast'].includes(kind)) {
    const route = scene.paths['terrain-route'], constraint = scene.generation.constraints['terrain-route-constraint']
    assert(route && route.widthMm === 1000 && route.centerlineMm.length >= 2 && route.centerlineMm.length <= 32)
    assert.deepEqual(route.centerlineMm[0], { x: 3000, y: 13500 }); assert.deepEqual(route.centerlineMm.at(-1), { x: 21000, y: 13500 })
    assert(route.supportRefs.length > 0); assert.deepEqual(constraint.pointsMm, route.centerlineMm); assert.equal(constraint.minWidthMm, route.widthMm)
    assert.equal(scene.generation.checks['terrain-route-check'].state, 'passed')
    if (kind === 'river' || kind === 'mixed') assert(route.supportRefs.some(ref => ref.id === 'terrain-shallow'))
  }
  for (const key of ['lights', 'fogs', 'filters']) assert.deepEqual(scene.visual.base[key], {}, 'Use neutral T1 views.')
  return { scene, manifest, hash: sha256(downloaded.bytes), bytes: downloaded.bytes.length, file: downloaded.file,
    summary: { sceneId: scene.sceneId, title: scene.title, revision: scene.revision, packageSha256: sha256(downloaded.bytes), packageBytes: downloaded.bytes.length,
      schema: { complete: manifest.schemaVersion, scene: scene.schemaVersion, visual: scene.visual.version, identity: identity.version, appearance: appearance.version },
      assets: assetEntries.length, sources: Object.keys(sources).length, manifestEntriesVerified: manifest.entries.length, terrainAreas: Object.keys(scene.terrainAreas).length,
      props: Object.keys(scene.props).length, generationChecks: Object.keys(scene.generation.checks).length } }
}
async function fullProject(filename, kind) {
  return inspectProject(await download(page.getByRole('button', { name: '完整工程', exact: true }), filename, 'sceneweave-complete.sceneweave'), kind)
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1
  return value >>> 0
})
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8
  return (value ^ 0xffffffff) >>> 0
}
function inspectPng(bytes, bounds) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const chunks = [], idat = []
  let cursor = 8, width, height, bitDepth, colorType
  while (cursor < bytes.length) {
    assert(cursor + 12 <= bytes.length, 'Truncated PNG chunk.')
    const length = bytes.readUInt32BE(cursor), type = bytes.toString('ascii', cursor + 4, cursor + 8), end = cursor + length + 12
    assert(end <= bytes.length, 'PNG chunk exceeds the file.')
    assert.equal(crc32(bytes.subarray(cursor + 4, end - 4)), bytes.readUInt32BE(end - 4), `PNG CRC ${type}`)
    assert(['IHDR', 'sRGB', 'IDAT', 'IEND'].includes(type), `Unexpected PNG metadata/chunk: ${type}`)
    if (type === 'IHDR') {
      assert.equal(chunks.length, 0); assert.equal(length, 13)
      width = bytes.readUInt32BE(cursor + 8); height = bytes.readUInt32BE(cursor + 12)
      bitDepth = bytes[cursor + 16]; colorType = bytes[cursor + 17]
      assert.deepEqual([...bytes.subarray(cursor + 18, cursor + 21)], [0, 0, 0])
    } else if (type === 'IDAT') idat.push(bytes.subarray(cursor + 8, end - 4))
    else if (type === 'IEND') { assert.equal(length, 0); assert.equal(end, bytes.length) }
    chunks.push(type); cursor = end
  }
  const scale = 4096 / Math.max(bounds.width, bounds.height)
  assert.deepEqual([width, height], [Math.round(bounds.width * scale), Math.round(bounds.height * scale)])
  assert.equal(bitDepth, 8); assert([2, 6].includes(colorType), 'Expected a true-color Canvas PNG.')
  assert.equal(chunks.filter(type => type === 'IHDR').length, 1); assert.equal(chunks.at(-1), 'IEND')
  assert.equal(chunks.filter(type => type === 'sRGB').length, 1); assert(idat.length > 0)
  const expectedBytes = height * (1 + width * (colorType === 6 ? 4 : 3))
  const decoded = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedBytes + 1 })
  assert.equal(decoded.length, expectedBytes, 'PNG must contain the actual full-resolution raster.')
  return { width, height, bitDepth, colorType, chunks, sizeBytes: bytes.length, sha256: sha256(bytes), scanlineBytes: decoded.length,
    metadata: 'Only IHDR/sRGB/IDAT/IEND; no text, EXIF, project or source metadata.' }
}

try {
  await step('normal-production-build-artifacts', inspectBuild)
  server = await preview({ mode: 'production', base, preview: { host: '127.0.0.1', port, strictPort: true } })
  browser = await chromium.launch({ headless: true, ...(process.env.SCENEWEAVE_BROWSER_CHANNEL ? { channel: process.env.SCENEWEAVE_BROWSER_CHANNEL } : {}) })
  context = await browser.newContext({ viewport: { width: 1512, height: 982 }, acceptDownloads: true, serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const target = new URL(route.request().url())
    if (['data:', 'blob:'].includes(target.protocol) || target.origin === origin) await route.continue()
    else { blockedRequests.push(`${route.request().method()} ${target.origin}${target.pathname}`); await route.abort('blockedbyclient') }
  })
  context.on('response', response => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }) })
  context.on('requestfailed', request => requestFailures.push({ url: request.url(), error: request.failure()?.errorText }))
  page = await context.newPage(); page.setDefaultTimeout(45_000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('worker', worker => {
    const record = { url: worker.url(), closed: false }; workers.push(record)
    worker.on('close', () => { record.closed = true })
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await expect(page.getByRole('tab', { name: '工程', exact: true })).toBeVisible()
  await step('normal-production-entry-no-hooks', productionGuards)

  let previous
  for (const kind of kinds) {
    await page.getByRole('tab', { name: '工程', exact: true }).click()
    await page.getByRole('button', { name: `选择${labels[kind]}地形`, exact: true }).click()
    await page.getByRole('textbox', { name: '地形方案种子', exact: true }).fill(seed)
    if (!['island', 'coast'].includes(kind)) await page.getByLabel('生成指定路线', { exact: true }).setChecked(withRoute)
    const baseline = await primaryState()
    if (cancellation === 'all' || kind === kinds[0]) await step(`${kind}-preview-cancel-preserves-main-project`, async () => {
      const generated = await generate()
      await expect(page.getByRole('button', { name: '完整工程', exact: true })).toBeDisabled()
      await page.screenshot({ path: path.join(output, `${kind}-cancelled-candidate.png`) })
      await page.getByRole('button', { name: '取消当前地形候选', exact: true }).click()
      await expect(page.getByRole('article', { name: '当前地形候选', exact: true })).toHaveCount(0)
      assert.deepEqual(await primaryState(), baseline, 'Cancellation must not replace, revise or save the main project.')
      if (previous) {
        await settled(previous.scene.title)
        const preserved = await fullProject(`${kind}-cancel-preserved-main.sceneweave`, previous.kind)
        assert.equal(preserved.hash, previous.hash, 'Cancelled candidate must leave the complete main package byte-identical.')
      }
      return { ...generated, mainProjectUnchanged: true, baseline }
    })

    let candidate, saved
    await step(`${kind}-regenerate-export-complete3-candidate`, async () => {
      const generated = await generate()
      const downloaded = await download(page.getByRole('button', { name: '导出当前地形候选', exact: true }), `${kind}-candidate.sceneweave`, `terrain-${kind}-${seed}.sceneweave`)
      candidate = inspectProject(downloaded, kind)
      assert.notEqual(candidate.scene.sceneId, previous?.scene.sceneId, 'Candidate must use a new independent scene identity.')
      await page.screenshot({ path: path.join(output, `${kind}-candidate.png`) })
      return { ...generated, ...candidate.summary }
    })

    await step(`${kind}-ui-adopt-save-full3-download`, async () => {
      await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
      await expect(page.getByRole('article', { name: '当前地形候选', exact: true })).toHaveCount(0, { timeout: 90_000 })
      await settled(candidate.scene.title)
      saved = await fullProject(`${kind}-saved.sceneweave`, kind)
      assert.equal(saved.hash, candidate.hash, 'Adoption must preserve the exact complete candidate, including generation and resources.')
      await page.screenshot({ path: path.join(output, `${kind}-saved.png`) })
      return { ...saved.summary, candidateByteIdentical: true }
    })

    await step(`${kind}-saved-version-cold-reload-byte-identical`, async () => {
      await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click()
      await settled(saved.scene.title)
      const reloaded = await fullProject(`${kind}-reloaded.sceneweave`, kind)
      assert.equal(reloaded.hash, saved.hash, 'Cold saved-version reload must reproduce the complete package byte-for-byte.')
      previous = { ...reloaded, kind }
      return { ...reloaded.summary, savedByteIdentical: true, reloadMethod: 'UI 重新载入已保存版本 → repository cold load → UI full-project export' }
    })

    for (const audience of ['gm', 'player']) await step(`${kind}-${audience}-actual4k-png`, async () => {
      await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: audience === 'gm' ? '主持人' : '玩家', exact: true }).click()
      await settled(saved.scene.title)
      const image = await download(page.getByRole('button', { name: '4K PNG', exact: true }), `${kind}-${audience}-4096.png`, `sceneweave-${audience}-map.png`)
      const inspection = inspectPng(image.bytes, saved.scene.exportBoundsMm)
      const bitmap = await page.evaluate(async encoded => {
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        try { return { width: image.width, height: image.height } } finally { image.close() }
      }, image.bytes.toString('base64'))
      assert.deepEqual(bitmap, { width: inspection.width, height: inspection.height })
      await page.screenshot({ path: path.join(output, `${kind}-${audience}-preview.png`) })
      return { ...inspection, nativeBitmapDecoded: bitmap }
    })
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click()
    await settled(saved.scene.title)
    await step(`${kind}-production-guards`, productionGuards)
  }
  assert(workers.length >= kinds.length + (cancellation === 'all' ? kinds.length : 1), 'Every generation/cancellation journey must instantiate a real bundled Worker.')
  await step('final-normal-production-guards', productionGuards)
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'; result.failure = error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    await writeFile(path.join(output, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => {})
  }
  console.error(result.failure); process.exitCode = 1
} finally {
  result.elapsedMs = Date.now() - started
  await writeResult()
  await context?.close()
  await browser?.close()
  await server?.close()
}
