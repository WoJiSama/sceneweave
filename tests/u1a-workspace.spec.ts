import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { WorkspaceV6 } from '../src/editor/v6/workspace'
import type { SceneRepositoryV6 } from '../src/io/v6/storage'
import type { CompositionCommandV6 } from '../src/core/v6/types'

type Dev = { workspace: WorkspaceV6; repository: SceneRepositoryV6 }
const headline = '把故事画成可以探索的地方'
const home = (page: Page) => page.getByTestId('workspace-home')
const row = (page: Page, key: string) => page.locator(`[data-project-key="${key}"]`)
const openDialog = (page: Page) => page.getByRole('dialog', { name: '确认打开室外工程', exact: true })
const pageErrors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const errors: string[] = []; pageErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(async ({ page }, info) => {
  const errors = pageErrors.get(page) ?? []
  await info.attach('u1a-page-errors.json', { body: JSON.stringify(errors, null, 2), contentType: 'application/json' })
  expect(errors).toEqual([])
})

async function report(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}
async function settled(page: Page) {
  await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
}
async function number(page: Page, name: string, value: number) {
  const field = page.getByRole('spinbutton', { name, exact: true }); await field.fill(String(value)); await field.press('Tab')
}
async function current(page: Page) {
  return page.evaluate(async () => {
    const path = '/tests/helpers/u1a-browser.ts', { readU1ACurrent } = await import(path) as typeof import('./helpers/u1a-browser')
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    const state = workspace.getState(), project = state.project
    if (!project) throw new Error('Expected an active complete v6 project')
    const persisted = await repository.load(project.document.sceneId)
    return { ...await readU1ACurrent(project), status: state.status, error: state.error ?? null, canUndo: state.canUndo, canRedo: state.canRedo,
      persisted: persisted ? await readU1ACurrent(persisted) : null }
  })
}
async function seedCurrent(page: Page, title = 'U1a 当前工程') {
  await page.goto('/#workspace'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await page.evaluate(async title => {
    const path = '/tests/helpers/u1a-browser.ts', { createU1AProject } = await import(path) as typeof import('./helpers/u1a-browser')
    await (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.adoptNew(await createU1AProject(title))
  }, title)
  await settled(page); return current(page)
}
async function execute(page: Page, commands: CompositionCommandV6[]) {
  await page.evaluate(async commands => { const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev; await workspace.execute(commands); await workspace.flush() }, commands)
  await settled(page)
}
async function goHome(page: Page) {
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(home(page)).toBeVisible(); await expect(page).toHaveURL(/#home$/)
}
async function selectProp(page: Page, id = 'c3-left') {
  await page.getByTestId('workspace-navigation').getByRole('tab', { name: '对象', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill(id)
  await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
}
async function adoptOpen(page: Page) {
  const dialog = openDialog(page); await expect(dialog).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(dialog).toHaveCount(0); await settled(page); await expect(page).toHaveURL(/#workspace$/)
}
async function fileFromHome(page: Page, buffer: Buffer, name: string) {
  const chooser = page.waitForEvent('filechooser')
  await home(page).getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer })
}

test('U1a default Home creates one complete native v6 blank project through real UI', async ({ page }, info) => {
  test.setTimeout(150_000)
  await page.goto('/'); await expect(page.getByRole('heading', { level: 1, name: headline, exact: true })).toBeVisible()
  for (const name of ['新建场景', '打开工程文件', '刷新工程列表', '书房与露台', '双层岩岛', '海岸哨所']) await expect(home(page).getByRole('button', { name, exact: true })).toBeVisible()
  await home(page).getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('U1a 首页创建原生完整工程')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18000'); await dialog.getByLabel('画布高度', { exact: true }).fill('12000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled(page)
  const created = await current(page)
  expect(created.title).toBe('U1a 首页创建原生完整工程'); expect(created.revision).toBe(0)
  expect(Object.keys(created.document.props)).toHaveLength(0); expect(Object.keys(created.document.propDefinitions)).toHaveLength(23)
  expect(Object.keys(created.document.materials)).toHaveLength(11); expect(Object.keys(created.document.prefabDefinitions)).toHaveLength(3)
  expect(Object.keys(created.assets)).toHaveLength(34); expect(created.persisted?.contentHash).toBe(created.contentHash)
  for (const item of [...Object.values(created.assets), ...Object.values(created.licenses)]) expect(item.actualHash).toBe(item.sha256)
  await goHome(page); await expect(row(page, `v6:${created.sceneId}`).getByRole('button', { name: '继续编辑', exact: true })).toBeVisible()
  await report(info, 'u1a-home-create.json', { method: 'Home form, actual stock bytes, native IDB save; DEV observation only.', created })
})

for (const sample of [
  { name: '书房与露台', preset: 'sceneweave-vis01' },
  { name: '双层岩岛', preset: 'sceneweave-vis02' },
  { name: '海岸哨所', preset: 'sceneweave-scn04' },
]) test(`U1a Home sample ${sample.name} requires review before saving a complete editable copy`, async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/#home'); await home(page).getByRole('button', { name: sample.name, exact: true }).click()
  await expect(openDialog(page)).toBeVisible({ timeout: 40_000 })
  const before = await page.evaluate(() => (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project?.document.sceneId ?? null)
  expect(before).toBeNull(); await openDialog(page).getByRole('button', { name: '取消', exact: true }).click()
  expect(await page.evaluate(() => (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project?.document.sceneId ?? null)).toBeNull()
  if (!(await home(page).isVisible())) await goHome(page)
  await home(page).getByRole('button', { name: sample.name, exact: true }).click(); await adoptOpen(page)
  const adopted = await current(page)
  expect(adopted.document.presetSnapshot.presetId).toBe(sample.preset)
  expect(adopted.document.presetSnapshot.presetVersion).toBe(1)
  expect(Object.keys(adopted.document.props).length).toBeGreaterThan(0); expect(Object.keys(adopted.assets).length).toBeGreaterThan(0)
  expect(adopted.persisted?.contentHash).toBe(adopted.contentHash)
  await report(info, 'u1a-home-sample.json', { sample: sample.name, method: 'Real sample resources, review/cancel, explicit native v6 copy adoption.', adopted })
})

test('U1a six native repositories disambiguate identical names and IDs, retaining every row during read-only discovery', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/#home'); await expect(home(page)).toBeVisible()
  const fixture = await page.evaluate(async () => { const path = '/tests/helpers/u1a-browser.ts'; return (await import(path) as typeof import('./helpers/u1a-browser')).seedU1ADiscoveryFixture() })
  await home(page).getByRole('button', { name: '刷新工程列表', exact: true }).click()
  for (let version = 1; version <= 6; version++) {
    const item = row(page, `v${version}:${fixture.sceneId}`)
    await expect(item).toBeVisible(); await expect(item).toContainText(fixture.title)
    await expect(item.getByRole('button', { name: version === 6 ? '打开' : '升级为副本', exact: true })).toBeEnabled()
  }
  await expect(row(page, `v2:${fixture.brokenId}`)).toBeVisible()
  await expect(row(page, `v2:${fixture.brokenId}`).getByRole('alert')).toBeVisible()
  await expect(row(page, `v2:${fixture.brokenId}`).getByRole('button', { name: '升级为副本', exact: true })).toBeDisabled()
  await home(page).getByRole('button', { name: '刷新工程列表', exact: true }).click()
  const after = await page.evaluate(async () => { const path = '/tests/helpers/u1a-browser.ts'; return (await import(path) as typeof import('./helpers/u1a-browser')).fingerprintU1ADatabases() })
  expect(after).toEqual(fixture.before)
  await row(page, `v6:${fixture.sceneId}`).getByRole('button', { name: '打开', exact: true }).click(); await settled(page)
  expect((await current(page)).sceneId).toBe(fixture.sceneId)
  const afterOpen = await page.evaluate(async () => { const path = '/tests/helpers/u1a-browser.ts'; return (await import(path) as typeof import('./helpers/u1a-browser')).fingerprintU1ADatabases() })
  expect(afterOpen).toEqual(fixture.before)
  await report(info, 'u1a-native-discovery.json', { method: 'Six actual default Chromium IDBs; valid independent same-ID/name projects plus one deliberately corrupt v2 row. Every store/Blob fingerprint must remain identical after discovery, refresh and native v6 open.', fixture, after, afterOpen })
})

test('U1a explicit upgrade captures complete native v5 content and preserves four exact ancestor originals and old history', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/#home')
  const source = await page.evaluate(async () => { const path = '/tests/helpers/u1a-browser.ts'; return (await import(path) as typeof import('./helpers/u1a-browser')).seedU1AMigrationFixture() })
  await home(page).getByRole('button', { name: '刷新工程列表', exact: true }).click()
  await row(page, `v5:${source.sourceSceneId}`).getByRole('button', { name: '升级为副本', exact: true }).click()
  await expect(openDialog(page)).toBeVisible({ timeout: 30_000 }); await openDialog(page).getByRole('button', { name: '取消', exact: true }).click()
  const cancelled = await page.evaluate(async () => { const path = '/tests/helpers/u1a-browser.ts', helpers = await import(path) as typeof import('./helpers/u1a-browser'); return helpers.fingerprintU1ADatabases(helpers.U1A_DATABASES.slice(0, 5)) })
  expect(cancelled).toEqual(source.before)
  if (!(await home(page).isVisible())) await goHome(page)
  await row(page, `v5:${source.sourceSceneId}`).getByRole('button', { name: '升级为副本', exact: true }).click(); await adoptOpen(page)
  const adopted = await page.evaluate(async () => { const path = '/tests/helpers/u1a-browser.ts', helpers = await import(path) as typeof import('./helpers/u1a-browser'); return helpers.describeU1AUpgrade((Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!) })
  expect(adopted.sceneId).not.toBe(source.sourceSceneId); expect(adopted.revision).toBe(0)
  expect(adopted.sourceSceneId).toBe(source.sourceSceneId); expect(adopted.sourceRevision).toBe(source.sourceRevision)
  expect(adopted.oldRepositories).toEqual(source.before)
  expect(adopted.existingAncestors.map(item => item.schema)).toEqual([1, 2, 3, 4])
  expect(adopted.existingAncestors.map(item => item.sha256)).toEqual(source.existingAncestorHashes)
  for (const original of adopted.existingAncestors) { expect(original.exact).toBe(true); expect(original.sha256).toBe(original.expectedHash) }
  expect(adopted.capturedNativeV5.sceneId).toBe(source.sourceSceneId); expect(adopted.capturedNativeV5.revision).toBe(source.sourceRevision)
  expect(adopted.capturedNativeV5.actualBlobSha256).toBe(adopted.capturedNativeV5.recordedSourceHash)
  expect(adopted.capturedNativeV5.importedContentHash).toBe(source.nativeSourceContentHash)
  expect(adopted.capturedNativeV5.currentNativeContentHash).toBe(source.nativeSourceContentHash)
  expect(adopted.capturedNativeV5.fixtureContentHash).toBe(source.nativeSourceContentHash)
  await report(info, 'u1a-explicit-upgrade.json', { method: 'Home review/cancel/confirm against a real native v5 source. Newly serialized v5 capture is fully imported/validated and its content hash compared with native source and fixture; captured Blob SHA must match recorded sourceHash. Existing v1-v4 ancestor originals stay byte-exact, and all old native store/history fingerprints remain unchanged.', source, cancelled, adopted })
})

test('U1a Home Continue retains the same session, selected object, viewport, search and undo while explicit reload opens the persisted ID', async ({ page }, info) => {
  test.setTimeout(150_000)
  await seedCurrent(page); await selectProp(page)
  await number(page, '物件旋转', 25); await settled(page)
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  await page.getByRole('button', { name: '放大地图', exact: true }).click()
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  const visual = { selected: await viewport.getAttribute('data-selected-ids'), zoom: await viewport.getAttribute('data-zoom'), x: await viewport.getAttribute('data-pan-x'), y: await viewport.getAttribute('data-pan-y') }
  const before = await current(page); expect(before.canUndo).toBe(true)
  await page.evaluate(() => Reflect.set(window, '__u1aOriginalCanvas', document.querySelector('.asset-map-wrap canvas')))
  await goHome(page)
  await row(page, `v6:${before.sceneId}`).getByRole('button', { name: '继续编辑', exact: true }).click(); await settled(page)
  expect(await page.evaluate(() => Reflect.get(window, '__u1aOriginalCanvas') === document.querySelector('.asset-map-wrap canvas'))).toBe(true)
  expect((await current(page)).contentHash).toBe(before.contentHash)
  expect({ selected: await viewport.getAttribute('data-selected-ids'), zoom: await viewport.getAttribute('data-zoom'), x: await viewport.getAttribute('data-pan-x'), y: await viewport.getAttribute('data-pan-y') }).toEqual(visual)
  await expect(page.getByLabel('搜索场景物件', { exact: true })).toHaveValue('c3-left')
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click(); await settled(page)
  const undone = await current(page); expect(undone.sceneId).toBe(before.sceneId); expect(undone.revision).toBe(before.revision + 1); expect(undone.document.props['c3-left'].rotationDeg).toBe(0)
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click(); await settled(page)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(page)
  const reloaded = await current(page)
  expect(reloaded.sceneId).toBe(before.sceneId); expect(reloaded.document.props['c3-left'].rotationDeg).toBe(25); expect(reloaded.canUndo).toBe(false)
  const rows = await page.evaluate(async () => (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).repository.list())
  expect(rows).toHaveLength(1)
  await report(info, 'u1a-session-continue.json', { method: 'Native fixture; real object edit, zoom, Home row Continue, same canvas node, UI undo/redo and explicit persisted reload.', before, visual, undone, reloaded, rows })
})

test('U1a passive module browsing retains inputs and selection; active drawing and review guard Home, hash and browser Back', async ({ page }, info) => {
  test.setTimeout(150_000)
  const source = await seedCurrent(page); await selectProp(page)
  await goHome(page); await row(page, `v6:${source.sceneId}`).getByRole('button', { name: '继续编辑', exact: true }).click(); await settled(page)
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByLabel('房间名称', { exact: true }).fill('U1a 保留的房间输入')
  await number(page, '房间起点 Y', 10000)
  await page.getByRole('tab', { name: '素材库', exact: true }).click(); await page.getByLabel('搜索组件素材', { exact: true }).fill('原创测试')
  await page.getByRole('tab', { name: '建筑', exact: true }).click(); await expect(page.getByLabel('房间名称', { exact: true })).toHaveValue('U1a 保留的房间输入')
  await expect(page.getByRole('group', { name: '地图视口', exact: true })).toHaveAttribute('data-selected-ids', '["c3-left"]')
  await page.getByRole('button', { name: '回到首页', exact: true }).click(); await expect(page).toHaveURL(/#workspace$/)
  await expect(page.getByRole('button', { name: '取消建筑草稿', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '取消建筑草稿', exact: true }).click(); await expect(page.getByLabel('房间名称', { exact: true })).toHaveValue('新房间')
  expect((await current(page)).revision).toBe(source.revision)
  await page.getByLabel('房间名称', { exact: true }).fill('U1a 保留的房间输入'); await number(page, '房间起点 Y', 10000)
  await page.getByRole('button', { name: '在图上画房间', exact: true }).click()
  await page.getByRole('tab', { name: '素材库', exact: true }).click(); await expect(page.getByLabel('搜索组件素材', { exact: true })).toHaveValue('原创测试')
  await page.goBack(); await expect(page).toHaveURL(/#workspace$/); await expect(home(page)).not.toBeVisible()
  await page.evaluate(() => { location.hash = '#home' }); await expect(page).toHaveURL(/#workspace$/); await expect(home(page)).not.toBeVisible()
  await page.evaluate(() => { location.hash = '#history' }); await expect(page).toHaveURL(/#workspace$/); await expect(page.getByTestId('history-workbench')).toHaveCount(0)
  await page.getByRole('tab', { name: '建筑', exact: true }).click(); await expect(page.getByRole('button', { name: '取消绘图或量尺', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消绘图或量尺', exact: true }).click()
  const before = await current(page)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '回到首页', exact: true }).click(); await expect(page).toHaveURL(/#workspace$/)
  await page.evaluate(() => { location.hash = '#home' }); await expect(page).toHaveURL(/#workspace$/)
  await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toBeVisible(); expect((await current(page)).contentHash).toBe(before.contentHash)
  await page.getByRole('button', { name: '取消结构预览', exact: true }).click()
  await goHome(page); await home(page).getByRole('button', { name: '继续编辑', exact: true }).first().click(); await settled(page)
  expect((await current(page)).contentHash).toBe(before.contentHash)
  await report(info, 'u1a-navigation-guards.json', { method: 'Real pointer draft, module controls, candidate, Home button, hash assignment and browser history Back; no timer-based discard.', before, after: await current(page) })
})

test('U1a unpreviewed appearance input retains its target across browsing and refuses navigation or target changes until explicit cancel', async ({ page }, info) => {
  test.setTimeout(150_000)
  await seedCurrent(page); await selectProp(page)
  await page.getByLabel('搜索场景物件', { exact: true }).fill('c3-')
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  const before = await current(page), initialKind = await page.getByLabel('外观调整项目', { exact: true }).inputValue()
  const initialTint = await page.getByLabel('外观调色颜色', { exact: true }).inputValue()
  await page.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  await page.getByLabel('外观亮度', { exact: true }).fill('0.55')
  await page.getByRole('tab', { name: '素材库', exact: true }).click()
  await page.getByTestId('workspace-navigation').getByRole('tab', { name: '对象', exact: true }).click()
  await expect(page.getByLabel('外观调整项目', { exact: true })).toHaveValue('brightness')
  await expect(page.getByLabel('外观亮度', { exact: true })).toHaveValue('0.55')
  await expect(page.getByRole('button', { name: '预览外观调整', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '回到首页', exact: true }).click(); await expect(page).toHaveURL(/#workspace$/)
  await page.evaluate(() => { location.hash = '#home' }); await expect(page).toHaveURL(/#workspace$/)
  const other = page.locator('.asset-entity-list [data-entity-id="c3-right"]')
  await expect(other).toBeVisible()
  if (await other.isEnabled()) await other.click()
  else await expect(other).toBeDisabled()
  await expect(viewport).toHaveAttribute('data-selected-ids', '["c3-left"]')
  expect((await current(page)).contentHash).toBe(before.contentHash)
  await expect(page.getByLabel('外观亮度', { exact: true })).toHaveValue('0.55')
  await page.getByRole('button', { name: '取消外观草稿', exact: true }).click()
  await expect(page.getByLabel('外观调整项目', { exact: true })).toHaveValue(initialKind)
  await expect(page.getByLabel('外观调色颜色', { exact: true })).toHaveValue(initialTint)
  await expect(viewport).toHaveAttribute('data-selected-ids', '["c3-left"]')
  expect((await current(page)).contentHash).toBe(before.contentHash)
  await other.click(); await expect(viewport).toHaveAttribute('data-selected-ids', '["c3-right"]')
  await goHome(page)
  await report(info, 'u1a-appearance-draft-target.json', { method: 'Real brightness input without preview; passive tab browsing, guarded Home/hash/other-object selection, explicit panel draft cancellation and unchanged complete project.', before, after: await current(page), initialKind, initialTint })
})

test('U1a Home navigation retains C2 same-session witness but explicit persisted reload invalidates it', async ({ page }, info) => {
  test.setTimeout(150_000)
  await seedCurrent(page)
  const proof = await page.evaluate(async () => {
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    await workspace.execute([{ type: 'createRoom', id: 'u1a-room', floorId: 'blank-floor', boundaryMm: [{ x: 1000, y: 10000 }, { x: 5000, y: 10000 }, { x: 5000, y: 14000 }, { x: 1000, y: 14000 }], thicknessMm: 100, purpose: 'U1a continuity room' }]); await workspace.flush()
    const snapshot = await workspace.createNamedSnapshot('U1a same-session structural source')
    const wallId = Object.keys(workspace.getState().project!.document.walls)[0]
    await workspace.execute([{ type: 'setWallThickness', id: wallId, thicknessMm: 160 }]); await workspace.flush()
    const before = await workspace.inspectStructureRestore(snapshot.id, { ids: [wallId], mode: 'geometry' })
    return { snapshotId: snapshot.id, wallId, scope: before.scope, sceneId: workspace.getState().project!.document.sceneId }
  })
  await settled(page); await goHome(page); await row(page, `v6:${proof.sceneId}`).getByRole('button', { name: '继续编辑', exact: true }).click(); await settled(page)
  const continued = await page.evaluate(async proof => (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.inspectStructureRestore(proof.snapshotId, { ids: [proof.wallId], mode: 'geometry' }), proof)
  expect(continued.scope).toEqual(proof.scope)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(page)
  const reloadError = await page.evaluate(async proof => {
    try { await (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.inspectStructureRestore(proof.snapshotId, { ids: [proof.wallId], mode: 'geometry' }); return null }
    catch (error) { return error instanceof Error ? error.message : String(error) }
  }, proof)
  expect(reloadError).toMatch(/连续|会话|重开|证明|continuity/i)
  await report(info, 'u1a-c2-witness.json', { method: 'DEV commands seed an actual C2 room/named checkpoint; UI Home/Continue versus explicit reload; native snapshot read and real continuity check.', proof, continued, reloadError })
})

test('U1a Home file review, cancel and malformed input retain the current branch; valid v6 import creates a complete copy', async ({ page }, info) => {
  test.setTimeout(180_000)
  const before = await seedCurrent(page, 'U1a 保留的当前分支')
  const source = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/u1a-browser.ts', ioPath = '/src/io/v6/project-file.ts'
    const { createU1AProject } = await import(helperPath) as typeof import('./helpers/u1a-browser')
    const { exportProjectV6 } = await import(ioPath) as typeof import('../src/io/v6/project-file')
    const project = await createU1AProject('U1a 文件中的另一工程'), blob = await exportProjectV6(project)
    return { sceneId: project.document.sceneId, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }
  })
  await goHome(page); await fileFromHome(page, Buffer.from(source.bytes), 'u1a-complete.sceneweave')
  await expect(openDialog(page)).toBeVisible({ timeout: 30_000 }); expect((await current(page)).contentHash).toBe(before.contentHash)
  await openDialog(page).getByRole('button', { name: '取消', exact: true }).click()
  if (!(await home(page).isVisible())) await goHome(page)
  await fileFromHome(page, Buffer.from('deliberately invalid sceneweave input'), 'u1a-malformed.sceneweave')
  await expect(page.getByRole('alert').filter({ hasText: /格式|工程|ZIP|文件|容器|signature/i })).toBeVisible()
  expect((await current(page)).contentHash).toBe(before.contentHash); await expect(openDialog(page)).toHaveCount(0)
  if (!(await home(page).isVisible())) await goHome(page)
  await fileFromHome(page, Buffer.from(source.bytes), 'u1a-complete.sceneweave'); await adoptOpen(page)
  const adopted = await current(page)
  expect(adopted.sceneId).not.toBe(before.sceneId); expect(adopted.sceneId).not.toBe(source.sceneId); expect(adopted.revision).toBe(0)
  expect(adopted.title).toBe('U1a 文件中的另一工程 · 副本'); expect(adopted.persisted?.contentHash).toBe(adopted.contentHash)
  const old = await page.evaluate(async id => { const helperPath = '/tests/helpers/u1a-browser.ts', { readU1ACurrent } = await import(helperPath) as typeof import('./helpers/u1a-browser'); return readU1ACurrent((await (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).repository.load(id))!) }, before.sceneId)
  expect(old.contentHash).toBe(before.contentHash)
  await report(info, 'u1a-file-open.json', { method: 'Real v6 zip through Home file chooser; cancellation and malformed input before explicit imported copy.', before, sourceSceneId: source.sceneId, adopted, old })
})

test('U1a cancelled real stock resource request cannot adopt a late blank candidate or lose the current project', async ({ page }, info) => {
  test.setTimeout(150_000)
  const before = await seedCurrent(page), counts = await page.evaluate(async () => (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).repository.list())
  let release!: () => void, reached!: () => void
  const held = new Promise<void>(resolve => { release = resolve }), requested = new Promise<void>(resolve => { reached = resolve })
  let heldUrl = ''
  await page.route('**/assets/**/*.png', async route => { if (!heldUrl) { heldUrl = route.request().url(); reached() }; await held; await route.continue().catch(() => {}) })
  try {
    await goHome(page); await home(page).getByRole('button', { name: '新建场景', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
    await dialog.getByLabel('场景名称', { exact: true }).fill('U1a 不得迟到采用')
    await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await requested
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: '取消', exact: true }).click(); release()
    await expect(dialog).toHaveCount(0); await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30_000 })
    const after = await current(page)
    expect(heldUrl).toContain('.png'); expect(after.contentHash).toBe(before.contentHash); expect(after.canUndo).toBe(before.canUndo)
    expect(await page.evaluate(async () => (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).repository.list())).toEqual(counts)
    await report(info, 'u1a-cancel-pending-resource.json', { method: 'Real stock PNG fetch is held, UI cancels preparation, request is released after cancellation; no mocked decoder/save.', heldUrl, before, after })
  } finally { release(); await page.unroute('**/assets/**/*.png') }
})

test('U1a genuine cross-tab native CAS conflict blocks Home departure and preserves both branches', async ({ page, context }, info) => {
  test.setTimeout(180_000)
  const source = await seedCurrent(page), second = await context.newPage()
  try {
    await second.goto('/#home'); await row(second, `v6:${source.sceneId}`).getByRole('button', { name: '打开', exact: true }).click(); await settled(second)
    await execute(page, [{ type: 'updateProp', id: 'c3-left', changes: { rotationDeg: 10 } }])
    const conflict = await second.evaluate(async () => {
      const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
      await workspace.execute([{ type: 'updateProp', id: 'c3-right', changes: { rotationDeg: 25 } }])
      try { await workspace.flush(); return null } catch (error) { return error instanceof Error ? error.message : String(error) }
    })
    expect(conflict).toMatch(/冲突|版本/)
    const beforeLeave = await current(second); expect(beforeLeave.status).toBe('conflict'); expect(beforeLeave.canUndo).toBe(true)
    await second.getByRole('button', { name: '回到首页', exact: true }).click()
    await expect(second).toHaveURL(/#workspace$/); await expect(home(second)).not.toBeVisible()
    const afterLeave = await current(second)
    expect(afterLeave.contentHash).toBe(beforeLeave.contentHash); expect(afterLeave.canUndo).toBe(true)
    expect(afterLeave.document.props['c3-right'].rotationDeg).toBe(25); expect(afterLeave.persisted?.document.props['c3-right'].rotationDeg).toBe(0)
    expect(afterLeave.persisted?.document.props['c3-left'].rotationDeg).toBe(10)
    await report(info, 'u1a-native-cas-navigation.json', { method: 'Two pages in one actual Chrome origin use the same default v6 IDB; independent old baseline, real CAS failure and guarded UI Home.', conflict, beforeLeave, afterLeave })
  } finally { await second.close() }
})
