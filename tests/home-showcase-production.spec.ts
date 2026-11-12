import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { expect, test, type Page } from '@playwright/test'
import type { ProjectData } from '../src/shared/model/project'
import { keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'

type SampleId = 'investigation' | 'modern' | 'fantasy' | 'ruins' | 'wilderness' | 'coast' | 'island' | 'volcano'
const manifest = JSON.parse(await readFile(new URL('../src/platform/browser/content/home-showcase-manifest.json', import.meta.url), 'utf8')) as {
  entries: Record<SampleId, { name: string; title: string; archiveFile: string; archiveSha256: string; archiveBytes: number; props: number }>
}
const ids: SampleId[] = ['investigation', 'modern', 'fantasy', 'ruins', 'wilderness', 'coast', 'island', 'volcano']
const home = (page: Page) => page.getByTestId('workspace-home')
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const archiveUrl = (id: SampleId) => new URL('../public/assets/home-scenes/projects/' + manifest.entries[id].archiveFile, import.meta.url)
function unpack(bytes: Uint8Array) {
  const files = unzipSync(bytes)
  const json = <T>(name: string) => JSON.parse(new TextDecoder().decode(files[name])) as T
  return { files, json, hashes: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])) }
}
async function requestCopy(page: Page, id: SampleId) {
  await home(page).locator(`[data-sample="${id}"]`).getByRole('button', { name: manifest.entries[id].name, exact: true }).click()
  const candidate = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(candidate).toBeVisible({ timeout: 30_000 })
  await expect(candidate).toContainText(manifest.entries[id].title)
  await expect(candidate).toContainText(manifest.entries[id].props + ' 件物件')
  return candidate
}
const geometryOnly = (document: ProjectData['document']) => {
  const { sceneId: _scene, revision: _revision, createdAt: _created, updatedAt: _updated, ...content } = document
  return content
}
function tokens(identity: ProjectData['historyIdentity']): string[] {
  return Object.entries(identity).flatMap(([field, pool]) => !field.endsWith('Tokens') ? []
    : Object.values(pool as Record<string, string | { token: string; topologyToken?: string }>).flatMap(value =>
      typeof value === 'string' ? [value] : [value.token, ...(value.topologyToken ? [value.topologyToken] : [])]))
}

test('production home prepares all eight complete candidates without storing on browse or cancellation', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home'); await expect(home(page)).toBeVisible()
  await expect(home(page).locator('article[data-sample]')).toHaveCount(8)
  await expect(home(page)).toContainText('共 0 个工程')
  await page.screenshot({ path: info.outputPath('home-desktop.png'), fullPage: true })
  for (const id of ids) {
    const candidate = await requestCopy(page, id)
    await expect(home(page).locator('[data-project-key]')).toHaveCount(0)
    await candidate.getByRole('button', { name: '取消', exact: true }).click()
    await expect(candidate).toHaveCount(0)
    await page.getByRole('button', { name: '回到首页', exact: true }).click()
    await page.reload(); await expect(home(page)).toBeVisible()
    await expect(home(page)).toContainText('共 0 个工程')
    await expect(home(page).locator('[data-project-key]')).toHaveCount(0)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath('home-390.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
})

for (const id of ['investigation', 'volcano'] as const) test(`production ${id} copy retains complete source and creates fresh identities through cold reopen`, async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const sourceBytes = new Uint8Array(await readFile(archiveUrl(id))), source = unpack(sourceBytes), entry = manifest.entries[id]
  expect(hash(sourceBytes)).toBe(entry.archiveSha256); expect(sourceBytes.byteLength).toBe(entry.archiveBytes)
  const sourceDocument = source.json<ProjectData['document']>('scene.json'), sourceIdentity = source.json<ProjectData['historyIdentity']>('identity.json')
  await page.goto('./#home'); await expect(home(page)).toBeVisible()
  const candidate = await requestCopy(page, id)
  await expect(home(page).locator('[data-project-key]')).toHaveCount(0)
  await candidate.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(candidate).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const beforePath = info.outputPath(`${id}-copy.sceneweave`)
  const before = await keyboardProjectBackup(page, beforePath), complete = unpack(new Uint8Array(await readFile(beforePath)))
  expect(before.document.sceneId).not.toBe(sourceDocument.sceneId)
  expect(before.document.revision).toBe(0)
  expect(geometryOnly(before.document)).toEqual(geometryOnly(sourceDocument))
  expect(before.identity.lineageId).not.toBe(sourceIdentity.lineageId)
  expect(before.identity.rootSceneId).toBe(before.document.sceneId)
  expect(before.identity.rootSceneId).not.toBe(sourceIdentity.rootSceneId)
  const sourceTokens = new Set(tokens(sourceIdentity)), copyTokens = tokens(before.identity)
  expect(copyTokens.length).toBeGreaterThan(0)
  expect(new Set(copyTokens).size).toBe(copyTokens.length)
  expect(copyTokens.filter(token => sourceTokens.has(token))).toEqual([])
  expect(Object.keys(before.identity.propTokens).sort()).toEqual(Object.keys(before.document.props).sort())
  expect(Object.keys(before.identity.prefabTokens).sort()).toEqual(Object.keys(before.document.prefabInstances).sort())
  // All non-identity package entries retain their actual bytes, including
  // appearance, assets, source/normalized SVG bytes and full license texts.
  const preserved = (hashes: Record<string, string>) => Object.fromEntries(Object.entries(hashes).filter(([name]) => !['scene.json', 'identity.json', 'manifest.json'].includes(name)))
  expect(preserved(complete.hashes)).toEqual(preserved(source.hashes))
  const originalMetadata = source.json<{ assetRecords: unknown; licenseBindings: unknown }>('manifest.json')
  const copyMetadata = complete.json<typeof originalMetadata>('manifest.json')
  expect(copyMetadata.assetRecords).toEqual(originalMetadata.assetRecords)
  expect(copyMetadata.licenseBindings).toEqual(originalMetadata.licenseBindings)
  await page.screenshot({ path: info.outputPath(`${id}-copy-open.png`) })

  if (id === 'investigation') {
    await page.getByRole('button', { name: '回到首页', exact: true }).click()
    const brokenEntry = manifest.entries.volcano
    const brokenRoute = '**/assets/home-scenes/projects/' + brokenEntry.archiveFile
    let requested = false
    await page.route(brokenRoute, route => { requested = true; return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from('invalid-complete-project') }) })
    await home(page).locator('[data-sample="volcano"]').getByRole('button', { name: brokenEntry.name, exact: true }).click()
    await expect.poll(() => requested).toBe(true)
    await expect(page.getByRole('dialog', { name: '准备打开工程', exact: true })).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByRole('dialog', { name: '确认打开工程', exact: true })).toHaveCount(0)
    await expect(page.getByRole('alert')).toContainText(/校验|摘要|完整|不一致|失败/)
    await page.unroute(brokenRoute)
    await keyboardWorkspaceSaved(page)
    expect((await keyboardProjectBackup(page, info.outputPath('after-invalid-template.sceneweave'))).hashes).toEqual(before.hashes)
    await page.getByRole('button', { name: '回到首页', exact: true }).click()
    await expect(home(page).locator('[data-project-key]')).toHaveCount(1)
    await home(page).getByRole('button', { name: '继续编辑', exact: true }).first().click(); await keyboardWorkspaceSaved(page)
  }

  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  const row = home(page).locator(`[data-project-key="native:${before.document.sceneId}"]`)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath(`${id}-cold.sceneweave`))
  expect(cold.hashes).toEqual(before.hashes)
  expect(errors).toEqual([])
  await writeFile(info.outputPath('result.json'), JSON.stringify({ id, ordinaryProductionUI: true, formalAcceptance: false,
    geometryAndFullResourcesPreserved: true, freshLineageAndTokens: true, coldEntryHashesEqual: true,
    invalidTemplatePreservedCurrent: id === 'investigation', errors }, null, 2))
})
