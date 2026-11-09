import { expect, test, type Page } from '@playwright/test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import type { ProjectData } from '../src/shared/model/project'
import { mapExportButton, projectBackupButton } from './workspace-ux-helpers'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const decoder = new TextDecoder('utf-8', { fatal: true })
const requiredPath = (name: string) => {
  const value = process.env[name]
  assert.ok(value && isAbsolute(value), `${name} must be an explicit absolute path`)
  return value
}
const fixtures = requiredPath('SCENEWEAVE_SVG_DETERMINISM_FIXTURES')
const recovery = requiredPath('SCENEWEAVE_SVG_DETERMINISM_RECOVERY')
type Fixture = { name: string; variants: { art: { file: string; sha256: string; byteLength: number } } }
const manifestBytes = readFileSync(resolve(fixtures, 'formal-visual-fixtures.json'))
const manifest = JSON.parse(decoder.decode(manifestBytes)) as { format: string; version: number; status: string; cases: Fixture[] }
assert.equal(manifest.format, 'sceneweave-formal-visual-fixtures')
assert.equal(manifest.version, 1)
assert.equal(manifest.status, 'complete')
const names = ['interior', 'island', 'coast', 'mixed', 'current-island']
const inputs = names.map(name => {
  const matches = manifest.cases.filter(item => item.name === name)
  assert.equal(matches.length, 1, `Frozen ordinary art fixture ${name}`)
  const art = matches[0].variants.art, file = resolve(fixtures, art.file)
  assert.ok(!relative(fixtures, file).startsWith('..'), 'Fixture must remain within the frozen directory')
  return { name, file, sha256: art.sha256, byteLength: art.byteLength, recovered: false }
})
inputs.push({ name: 'recovered-interior', file: recovery, sha256: hash(readFileSync(recovery)), byteLength: readFileSync(recovery).byteLength, recovered: true })
assert.ok(inputs.some(input => audit(new Uint8Array(readFileSync(input.file))).variantCount > 0), 'Frozen corpus must contain an actual nonempty bitmap derivative chain')

type PackageAudit = ReturnType<typeof audit>
function audit(bytes: Uint8Array) {
  const files = unzipSync(bytes)
  const json = <T>(path: string): T => {
    assert.ok(files[path]?.length, `Required nonempty entry ${path}`)
    return JSON.parse(decoder.decode(files[path])) as T
  }
  const document = json<ProjectData['document']>('scene.json')
  const identity = json<ProjectData['historyIdentity']>('identity.json')
  const appearance = json<ProjectData['appearance']>('appearance.json')
  const sources = json<ProjectData['authoringSources']>('sources.json')
  const manifest = json<Record<string, unknown>>('manifest.json')
  assert.equal(document.format, 'sceneweave-scene')
  assert.equal(document.schemaVersion, 1)
  assert.equal(manifest.format, 'sceneweave-complete-project')
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.packageMode, 'complete')
  const hashes = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, value]) => [path, hash(value)]))
  const svg = Object.entries(sources)
  assert.ok(svg.length > 0, 'Fixture must contain actual SVG authoring sources')
  for (const [assetId, source] of svg) {
    assert.equal(source.kind, 'svg')
    assert.equal(source.processorId, 'sceneweave-static-svg')
    assert.equal(source.processorVersion, 2)
    assert.equal(source.pixelFormat, 'rgba8-srgb-straight-v1')
    assert.deepEqual(source.rasterizer, { id: 'resvg-wasm', version: '2.6.2', moduleSha256: '22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70' })
    for (const [digest, size] of [[source.sourceSha256, source.sourceSizeBytes], [source.normalizedSha256, source.normalizedSizeBytes]] as const) {
      const path = `sources/${digest}.svg`
      assert.equal(files[path]?.length, size, `Actual SVG bytes ${assetId}`)
      assert.equal(hashes[path], digest)
      assert.match(decoder.decode(files[path]), /<svg(?:\s|>)/)
    }
    const asset = document.assets[assetId]
    assert.ok(asset, `SVG source has its real document asset ${assetId}`)
    assert.equal(asset.sha256, source.rasterSha256)
    assert.equal(hashes[`assets/${source.rasterSha256}.png`], source.rasterSha256)
  }
  // The source -> normalized SVG -> raster closure above must be real even in
  // fixtures with no optional bitmap variant. Every existing derived link is
  // also checked against both actual assets and retained PNG bytes.
  for (const variant of Object.values(appearance.variants)) {
    const source = document.assets[variant.sourceAssetId], output = document.assets[variant.outputAssetId]
    assert.ok(source && output, `Derived assets ${variant.id}`)
    assert.ok(hashes[`assets/${source.sha256}.png`])
    assert.ok(hashes[`assets/${output.sha256}.png`])
  }
  for (const path of Object.keys(files).filter(path => /^(?:assets|sources|licenses)\//.test(path))) {
    const digest = /\/([a-f0-9]{64})\.[^.]+$/.exec(path)?.[1]
    assert.ok(digest, `Content-addressed entry ${path}`)
    assert.equal(hashes[path], digest)
  }
  assert.ok(Object.keys(files).some(path => path.startsWith('licenses/')), 'Actual license texts are required')
  return { document, identity, appearance, sources, manifest, hashes, archiveSha256: hash(bytes), svgCount: svg.length,
    variantCount: Object.keys(appearance.variants).length }
}

function unchangedImport(source: PackageAudit, installed: PackageAudit) {
  assert.notEqual(installed.document.sceneId, source.document.sceneId, 'UI import must create a fresh root')
  assert.equal(installed.document.revision, 0)
  assert.ok(Number.isFinite(Date.parse(installed.document.createdAt)) && Number.isFinite(Date.parse(installed.document.updatedAt)))
  assert.deepEqual(installed.document, { ...source.document, sceneId: installed.document.sceneId, revision: 0,
    createdAt: installed.document.createdAt, updatedAt: installed.document.updatedAt }, 'Complete domain must survive UI import')
  assert.deepEqual(installed.identity, source.identity, 'Complete history identity')
  assert.deepEqual(installed.appearance, source.appearance, 'Complete appearance and fixed source graph')
  assert.deepEqual(installed.sources, source.sources, 'Complete SVG processor descriptors')
  assert.deepEqual(Object.keys(installed.hashes), Object.keys(source.hashes), 'Complete archive entry set')
  const stable = (audit: PackageAudit) => Object.fromEntries(Object.entries(audit.hashes).filter(([path]) => !['scene.json', 'manifest.json'].includes(path)))
  assert.deepEqual(stable(installed), stable(source), 'Every identity, appearance, source, resource and license entry hash')
  const metadata = (value: PackageAudit) => {
    const { sceneId: _sceneId, revision: _revision, entries: _entries, ...rest } = value.manifest
    return rest
  }
  assert.deepEqual(metadata(installed), metadata(source), 'Asset records, license bindings and package metadata')
}

async function ready(page: Page) {
  await expect(page.getByRole('dialog', { name: '检查完整工程', exact: true })).toHaveCount(0, { timeout: 120_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 120_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 })
}
async function backup(page: Page, path: string) {
  const event = page.waitForEvent('download', { timeout: 90_000 })
  await (await projectBackupButton(page)).click()
  await (await event).saveAs(path)
  await ready(page)
  await page.locator('.workspace-export-menu > summary').click()
  return audit(new Uint8Array(await readFile(path)))
}
function pngAudit(bytes: Buffer) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const chunks = new Set<string>()
  let offset = 8
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'Complete PNG chunk header')
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8)
    assert.ok(offset + length + 12 <= bytes.length, 'Complete PNG chunk data')
    assert.ok(['IHDR', 'IDAT', 'IEND', 'sRGB'].includes(kind), `No metadata chunk ${kind}`)
    chunks.add(kind); offset += length + 12
  }
  assert.equal(offset, bytes.length)
  assert.ok(chunks.has('IHDR') && chunks.has('IDAT') && chunks.has('IEND'))
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  assert.equal(Math.max(width, height), 4096)
  return { sha256: hash(bytes), width, height, chunks: [...chunks] }
}

for (const input of inputs) test(`${input.name} source2 survives production import, complete backup and cold reopen`, async ({ page, browser }, info) => {
  const errors: string[] = [], developmentRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/(?:src|tests|tools)\/|\/@vite\/client/.test(new URL(request.url()).pathname)) developmentRequests.push(request.url()) })
  const bytes = new Uint8Array(await readFile(input.file))
  assert.equal(hash(bytes), input.sha256, 'Exact frozen input bytes')
  assert.equal(bytes.length, input.byteLength)
  const source = audit(bytes)
  const response = await page.goto('./#home')
  assert.ok(response, 'Normal dist home response')
  assert.ok(response.ok(), 'Normal dist home response status')
  assert.ok(!(await response.text()).includes('/@vite/client'), 'Normal production HTML')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles(input.file)
  await ready(page)
  const installed = await backup(page, info.outputPath('imported.sceneweave'))
  unchangedImport(source, installed)
  await page.reload()
  await expect(page.getByRole('button', { name: '回到首页', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  const row = page.getByTestId('workspace-home').locator(`[data-project-key="native:${installed.document.sceneId}"]`)
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await ready(page)
  const cold = await backup(page, info.outputPath('cold.sceneweave'))
  assert.deepEqual(cold.hashes, installed.hashes, 'Cold reopen must preserve every complete-package entry byte')
  const images = []
  if (input.recovered) for (const audience of ['gm', 'player'] as const) {
    const event = page.waitForEvent('download', { timeout: 90_000 })
    await (await mapExportButton(page, audience)).click()
    const file = info.outputPath(`${audience}-4k.png`)
    await (await event).saveAs(file)
    await ready(page)
    images.push({ audience, ...pngAudit(await readFile(file)) })
    await page.locator('.workspace-export-menu > summary').click()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(developmentRequests, [])
  await writeFile(info.outputPath('svg-determinism-facts.json'), JSON.stringify({ input: input.name, inputPath: input.file,
    inputSha256: input.sha256, frozenManifestSha256: hash(manifestBytes), engine: info.project.name, browserVersion: browser.version(),
    svgCount: source.svgCount, bitmapVariantCount: source.variantCount, sourceEntryHashes: source.hashes,
    importedEntryHashes: installed.hashes, coldEntryHashes: cold.hashes, images, errors, developmentRequests,
    scope: 'Normal production UI, isolated per-test context, exact frozen source2 packages, full domain and resource preservation; no DEV imports or pixel mocks.',
    excluded: ['Complete formal visual 15-case matrix', 'Human art approval and user P3', 'Performance acceptance'] }, null, 2))
})
