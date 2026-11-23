import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'vite'
import type { ProjectData } from '../src/shared/model/project'
import { keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { archiveUrl, featuredSampleIds, importSampleFile, showcaseManifest as manifest } from './home-showcase-helpers'

const home = (page: Page) => page.getByTestId('workspace-home')
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function unpack(bytes: Uint8Array) {
  const files = unzipSync(bytes)
  const json = <T>(name: string) => JSON.parse(new TextDecoder().decode(files[name])) as T
  return { files, json, hashes: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])) }
}
async function requestCopy(page: Page, id: typeof featuredSampleIds[number], fromDetails = false) {
  const card = home(page).locator(`[data-sample="${id}"]`), { name, title, props } = manifest.entries[id]
  if (fromDetails) {
    await card.getByRole('button', { name: name + '场景详情', exact: true }).click()
    const details = page.getByRole('dialog', { name: name + ' · 场景详情', exact: true })
    await details.getByRole('button', { name: '用此样板创建副本', exact: true }).click()
  } else await card.getByRole('button', { name, exact: true }).click()
  const candidate = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(candidate).toBeVisible({ timeout: 30_000 })
  await expect(candidate).toContainText(title)
  await expect(candidate).toContainText(props + ' 件物件')
  return candidate
}
const geometryOnly = (document: ProjectData['document']) => {
  const { sceneId: _scene, revision: _revision, createdAt: _created, updatedAt: _updated, attachmentSurfaces, attachments, pathAttachments, ...content } = document
  const withoutProofs = <T extends { proofs: unknown }>(rows: Record<string, T> | undefined) =>
    rows && Object.fromEntries(Object.entries(rows).map(([id, { proofs: _proofs, ...row }]) => [id, row]))
  return { ...content, attachmentSurfaces: withoutProofs(attachmentSurfaces), attachments: withoutProofs(attachments),
    pathAttachments: withoutProofs(pathAttachments) }
}
function tokens(identity: ProjectData['historyIdentity']): string[] {
  return Object.entries(identity).flatMap(([field, pool]) => !field.endsWith('Tokens') ? []
    : Object.values(pool as Record<string, string | { token: string; topologyToken?: string }>).flatMap(value =>
      typeof value === 'string' ? [value] : [value.token, ...(value.topologyToken ? [value.topologyToken] : [])]))
}

test('production home prepares featured complete candidates without storing on browse or cancellation', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home'); await expect(home(page)).toBeVisible()
  const cards = home(page).locator('article[data-sample]')
  await expect(cards.locator('h3')).toHaveText(featuredSampleIds.map(id => manifest.entries[id].name))
  const gridPositions = () => cards.evaluateAll(elements => elements.map(element => {
    const { left, top } = element.getBoundingClientRect()
    return { left, top }
  }))
  const desktop = await gridPositions()
  expect(new Set(desktop.map(card => card.left)).size).toBe(2)
  expect(new Set(desktop.map(card => card.top)).size).toBe(2)
  await expect(home(page)).toContainText('共 0 个工程')
  const captureGallery = async (filename: string) => {
    const images = cards.getByRole('img')
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded()
      await image.evaluate((element: HTMLImageElement) => element.decode())
    }
    await page.screenshot({ path: info.outputPath(filename), fullPage: true })
  }
  await captureGallery('home-desktop.png')
  for (const id of featuredSampleIds) {
    const entry = manifest.entries[id]
    const card = home(page).locator(`[data-sample="${id}"]`)
    await card.scrollIntoViewIfNeeded()
    await expect(card.locator('.home-showcase-image:not(.home-showcase-angle) img')).toHaveJSProperty('naturalWidth', entry.width, { timeout: 20_000 })
    await expect(card.locator('.home-showcase-angle img')).toHaveJSProperty('naturalWidth', entry.oblique.width, { timeout: 20_000 })
    await card.getByRole('button', { name: entry.name + '场景详情', exact: true }).click()
    const details = page.getByRole('dialog', { name: entry.name + ' · 场景详情', exact: true })
    await expect(details.getByRole('img')).toHaveJSProperty('naturalWidth', entry.fullWidth, { timeout: 20_000 })
    await details.getByRole('button', { name: '3D 斜俯视', exact: true }).click()
    await expect(details.getByRole('img')).toHaveJSProperty('naturalWidth', entry.oblique.fullWidth, { timeout: 20_000 })
    await details.getByRole('button', { name: '返回首页', exact: true }).click()
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
  const narrow = await gridPositions()
  expect(new Set(narrow.map(card => card.left)).size).toBe(1)
  expect(new Set(narrow.map(card => card.top)).size).toBe(4)
  await captureGallery('home-390.png')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
})

for (const id of [...featuredSampleIds, 'coast', 'cyberpunk'] as const) test(`production ${id} retains the complete scene through cold reopen`, async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const sourceBytes = new Uint8Array(await readFile(archiveUrl(id))), source = unpack(sourceBytes), entry = manifest.entries[id]
  expect(hash(sourceBytes)).toBe(entry.archiveSha256); expect(sourceBytes.byteLength).toBe(entry.archiveBytes)
  const sourceDocument = source.json<ProjectData['document']>('scene.json'), sourceIdentity = source.json<ProjectData['historyIdentity']>('identity.json')
  await page.goto('./#home'); await expect(home(page)).toBeVisible()
  const fromFile = id === 'cyberpunk'
  if (fromFile) {
    await importSampleFile(page, id)
  } else {
    if (id === 'coast') {
      await page.goto('./#tutorial/atmosphere/line-art')
      await page.getByRole('button', { name: entry.name, exact: true }).click()
    } else {
      await requestCopy(page, id, id === 'volcano')
    }
    const candidate = page.getByRole('dialog', { name: '确认打开工程', exact: true })
    await expect(candidate).toContainText(entry.title, { timeout: 30_000 })
    await expect(home(page).locator('[data-project-key]')).toHaveCount(0)
    await candidate.getByRole('button', { name: '保存并打开副本', exact: true }).click()
    await expect(candidate).toHaveCount(0, { timeout: 30_000 })
  }
  await keyboardWorkspaceSaved(page)
  const beforePath = info.outputPath(`${id}-copy.sceneweave`)
  const before = await keyboardProjectBackup(page, beforePath), complete = unpack(new Uint8Array(await readFile(beforePath)))
  expect(before.document.sceneId).not.toBe(sourceDocument.sceneId)
  expect(before.document.revision).toBe(0)
  expect(geometryOnly(before.document)).toEqual(geometryOnly(sourceDocument))
  if (fromFile) {
    expect(before.identity).toEqual(sourceIdentity)
  } else {
    expect(before.identity.lineageId).not.toBe(sourceIdentity.lineageId)
    expect(before.identity.rootSceneId).toBe(before.document.sceneId)
    expect(before.identity.rootSceneId).not.toBe(sourceIdentity.rootSceneId)
    const sourceTokens = new Set(tokens(sourceIdentity)), copyTokens = tokens(before.identity)
    expect(copyTokens.length).toBeGreaterThan(0)
    expect(new Set(copyTokens).size).toBe(copyTokens.length)
    expect(copyTokens.filter(token => sourceTokens.has(token))).toEqual([])
  }
  expect(Object.keys(before.identity.propTokens).sort()).toEqual(Object.keys(before.document.props).sort())
  expect(Object.keys(before.identity.prefabTokens).sort()).toEqual(Object.keys(before.document.prefabInstances).sort())
  if (id === 'fantasy') {
    const attachments = Object.values(before.document.attachments ?? {})
    expect(attachments).toHaveLength(6)
    for (const attachment of attachments) {
      expect(attachment.proofs.lineageId).toBe(before.identity.lineageId)
      expect(attachment.proofs.child.birthToken).toBe(before.identity.propTokens[attachment.child.id])
    }
  }
  if (id === 'coast') {
    const pier = before.document.paths['tidehaven-landing-pier'].assembly!
    expect(pier.recipe.gaps).toEqual([{ side: 'right', fromMm: 2620, toMm: 4920 }])
    expect(pier.bridge?.roadLinks?.start).toMatchObject({ pathId: 'tidehaven-pier-approach', end: 'end' })
  }
  // All non-identity package entries retain their actual bytes, including
  // appearance, assets, source/normalized SVG bytes and full license texts.
  const preserved = (hashes: Record<string, string>) => Object.fromEntries(Object.entries(hashes).filter(([name]) => !['scene.json', 'identity.json', 'manifest.json'].includes(name)))
  expect(preserved(complete.hashes)).toEqual(preserved(source.hashes))
  const originalMetadata = source.json<{ assetRecords: unknown; licenseBindings: unknown }>('manifest.json')
  const copyMetadata = complete.json<typeof originalMetadata>('manifest.json')
  expect(copyMetadata.assetRecords).toEqual(originalMetadata.assetRecords)
  expect(copyMetadata.licenseBindings).toEqual(originalMetadata.licenseBindings)
  await page.screenshot({ path: info.outputPath(`${id}-copy-open.png`) })

  if (id === 'volcano') {
    await page.getByRole('button', { name: '回到首页', exact: true }).click()
    const brokenEntry = manifest.entries.fantasy
    const brokenRoute = (url: URL) => url.pathname.endsWith('/assets/home-scenes/projects/' + brokenEntry.archiveFile)
    let requested = false
    await page.route(brokenRoute, route => { requested = true; return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from('invalid-complete-project') }) })
    await home(page).locator('[data-sample="fantasy"]').getByRole('button', { name: brokenEntry.name, exact: true }).click()
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
  if (id === 'cyberpunk') {
    expect(cold.document.floors.upper.underlayFloorId).toBe('lower')
    expect(cold.document.floors[cold.document.floors.lower.underlayFloorId!].artwork).toBeDefined()
    const north = cold.document.terrainAreas['upper-north'].facade
    const south = cold.document.terrainAreas['upper-south'].facade
    expect(north).toMatchObject({ profile: 'girder-v1', depthMm: 1276, facing: 'right' })
    expect(south).toEqual(north)
    const doorLinks = Object.values(cold.document.pathAttachments ?? {})
    expect(doorLinks).toHaveLength(2)
    for (const link of doorLinks) {
      expect(link.proofs.lineageId).toBe(cold.identity.lineageId)
      expect(link.proofs.path.birthToken).toBe(cold.identity.outdoorTokens[link.pathId].token)
      expect(link.proofs.opening.birthToken).toBe(cold.identity.structureTokens![link.openingId].token)
    }
    await expect(page.getByRole('combobox', { name: '当前楼层', exact: true })).toHaveValue('upper')
    const lamp = Object.values(cold.document.props).find(prop => prop.id.startsWith('upper-pole-lamp-'))!
    await selectKeyboardProp(page, lamp.id)
    const x = lamp.positionMm.x + 200
    const position = page.getByRole('spinbutton', { name: '物件 X', exact: true })
    await position.fill(String(x / 1000))
    await position.press('Tab'); await keyboardWorkspaceSaved(page)
    const edited = await keyboardProjectBackup(page, info.outputPath('cyberpunk-edited.sceneweave'))
    expect(edited.document.props[lamp.id].positionMm).toEqual({ ...lamp.positionMm, x })
    expect(edited.document.paths).toEqual(cold.document.paths)
  }
  if (id === 'coast') {
    const pier = cold.document.paths['tidehaven-landing-pier'], link = pier.assembly!.bridge!.roadLinks!.start!
    const box = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
    if (!box) throw new Error('Missing coast canvas')
    const bounds = cold.document.exportBoundsMm
    const [start, end] = pier.centerlineMm
    const x = box.x + box.width * ((start.x + end.x) / 2 - bounds.x) / bounds.width
    const y = box.y + box.height * (start.y - bounds.y) / bounds.height
    const dragPier = async (offsetMm: number) => {
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x, y + box.height * offsetMm / bounds.height, { steps: 6 })
    }
    await dragPier(-600)
    await expect(page.getByTestId('bridge-link-break')).toBeAttached()
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await dragPier(-300)
    await expect(page.getByTestId('bridge-link-follow').locator('polygon')).toBeAttached()
    await page.mouse.up()
    const review = page.getByRole('region', { name: '候选审阅', exact: true })
    await review.getByLabel('确认完整影响范围', { exact: true }).check()
    await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    const moved = await keyboardProjectBackup(page, info.outputPath('coast-dragged.sceneweave'))
    const movedPier = moved.document.paths[pier.id]
    expect(movedPier.centerlineMm[0].y).toBeLessThan(start.y)
    expect(movedPier.assembly!.bridge!.roadLinks!.start).toEqual(link)
    expect(moved.document.paths[link.pathId].centerlineMm.at(-1)!.y).toBe(movedPier.centerlineMm[0].y)
    await page.screenshot({ path: info.outputPath('coast-dragged.png') })
  }
  if (id === 'fantasy') {
    const table = 'interior-fad2fafa73206b4072e31c1892f5e276734cf9d7'
    await selectKeyboardProp(page, table)
    const position = page.getByRole('spinbutton', { name: '物件 X', exact: true })
    await position.fill(String((cold.document.props[table].positionMm.x + 200) / 1000))
    await position.press('Tab'); await keyboardWorkspaceSaved(page)
    const edited = await keyboardProjectBackup(page, info.outputPath('fantasy-edited.sceneweave'))
    expect(edited.document.props[table].positionMm.x).toBe(cold.document.props[table].positionMm.x + 200)
    for (const child of ['ember-table-1-meal', 'ember-table-1-lantern']) {
      expect(edited.document.props[child].positionMm).toEqual({ ...cold.document.props[child].positionMm, x: cold.document.props[child].positionMm.x + 200 })
    }
    const vite = await createServer({ configFile: false, logLevel: 'error', cacheDir: info.outputPath('projection-cache'),
      server: { middlewareMode: true, hmr: false, watch: { ignored: ['**/*'] } }, optimizeDeps: { noDiscovery: true } })
    try {
      const { projectScene } = await vite.ssrLoadModule('/src/shared/projection/projection.ts') as typeof import('../src/shared/projection/projection')
      const glow = (project: typeof cold) => projectScene(project.document, 'player', project.appearance).visual?.fixtureGlows?.find(light => light.radiusMm === 3600)
      const beforeLight = glow(cold), movedLight = glow(edited)
      expect(beforeLight?.positionMm).toEqual(cold.document.props['ember-table-1-lantern'].positionMm)
      expect(movedLight?.positionMm).toEqual(edited.document.props['ember-table-1-lantern'].positionMm)
    } finally { await vite.close() }
  }
  expect(errors).toEqual([])
  await writeFile(info.outputPath('result.json'), JSON.stringify({ id, ordinaryProductionUI: true, formalAcceptance: false,
    geometryAndFullResourcesPreserved: true, freshLineageAndTokens: !fromFile, coldEntryHashesEqual: true,
    invalidTemplatePreservedCurrent: id === 'volcano', errors }, null, 2))
})
