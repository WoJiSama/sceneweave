import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync, zipSync } from 'fflate'
import { readReleaseFixture } from './helpers/release-fixtures'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSceneSettings } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

test('opens the released investigation map, edits it and cold-opens its full contents on the current build', async ({ page }, info) => {
  test.setTimeout(180_000)
  const bytes = await readReleaseFixture('investigation.sceneweave'), files = unzipSync(bytes)
  const json = (name: string) => JSON.parse(new TextDecoder().decode(files[name]))
  const source = json('scene.json'), originalManifest = json('manifest.json')
  expect(originalManifest.applicationVersion).toBe('development')
  const originalHashes = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')]))
  await page.goto('./#home')
  const input = page.getByTestId('native-project-file')
  await input.setInputFiles({ name: 'investigation.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await keyboardWorkspaceSaved(page)
  const settings = await openSceneSettings(page)
  const title = '雨夜调查 · 继续备团'
  await settings.getByLabel('工程名称', { exact: true }).and(settings.locator('input:enabled')).fill(title)
  await settings.getByRole('button', { name: '保存名称', exact: true }).and(settings.locator('button:enabled')).click()
  await keyboardWorkspaceSaved(page)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  const home = page.getByTestId('workspace-home')
  const row = home.locator('.home-project-row').filter({ hasText: title })
  // A file from a newer reader must leave the saved copy available.
  const future = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify({ format: originalManifest.format, schemaVersion: 2, minReaderVersion: 3 })) })
  await input.setInputFiles({ name: 'newer.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(future) })
  await expect(page.locator('.workspace-notice')).toContainText('请更新织境')
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const path = info.outputPath('reopened.sceneweave')
  const saved = await keyboardProjectBackup(page, path)
  expect(saved.document.sceneId).not.toBe(source.sceneId)
  expect(saved.document).toEqual({ ...source, sceneId: saved.document.sceneId, createdAt: saved.document.createdAt,
    updatedAt: saved.document.updatedAt, revision: 1, title })
  expect(saved.identity).toEqual(json('identity.json'))
  expect(saved.appearance).toEqual(json('appearance.json'))
  expect(keyboardResourceHashes(saved.hashes)).toEqual(keyboardResourceHashes(originalHashes))
  const manifest = JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(path)))['manifest.json']))
  expect(manifest.applicationVersion).toMatch(/^\d+\.\d+\.\d+/)
  if (process.env.GITHUB_SHA) expect(manifest.applicationVersion).toContain(`+g${process.env.GITHUB_SHA}`)
  expect(manifest.assetRecords).toEqual(originalManifest.assetRecords)
  expect(manifest.licenseBindings).toEqual(originalManifest.licenseBindings)
})

test('preserves unknown extension text in a GM backup and produces identical player PNGs with and without it', async ({ page }, info) => {
  test.setTimeout(180_000)
  const original = await readReleaseFixture('investigation.sceneweave')
  const parts = unzipSync(original)
  const data = { 'example.org/notes': { schemaVersion: 17, data: '  私有线索\r\n🔑  ' } }
  const extensionBytes = Buffer.from(JSON.stringify(data))
  const manifest = JSON.parse(new TextDecoder().decode(parts['manifest.json']))
  manifest.minReaderVersion = 2
  manifest.entries.push({ path: 'extensions.json', role: 'extensions', mimeType: 'application/json', sizeBytes: extensionBytes.length,
    sha256: createHash('sha256').update(extensionBytes).digest('hex') })
  const extended = zipSync({ ...parts, 'manifest.json': Buffer.from(JSON.stringify(manifest)), 'extensions.json': extensionBytes })

  const hashes = []
  await page.goto('./#home')
  for (const [name, buffer] of [['original', original], ['extended', extended]] as const) {
    await page.getByTestId('native-project-file').setInputFiles({ name: `${name}.sceneweave`, mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) })
    await keyboardWorkspaceSaved(page)
    const received = page.waitForEvent('download')
    await (await mapExportButton(page, 'player')).click()
    const png = info.outputPath(`${name}.png`), download = await received
    expect(download.suggestedFilename()).toBe('sceneweave-player-map.png')
    await download.saveAs(png)
    const image = await readFile(png)
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    hashes.push(createHash('sha256').update(image).digest('hex'))
    if (name === 'original') await page.getByRole('button', { name: '回到首页', exact: true }).click()
  }
  expect(hashes[1]).toBe(hashes[0])
  const path = info.outputPath('extension-backup.sceneweave')
  await keyboardProjectBackup(page, path)
  const saved = unzipSync(new Uint8Array(await readFile(path)))
  expect(JSON.parse(new TextDecoder().decode(saved['extensions.json']))).toEqual(data)
  expect(JSON.parse(new TextDecoder().decode(saved['manifest.json'])).minReaderVersion).toBe(2)
})
