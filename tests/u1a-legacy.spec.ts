import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { WorkspaceV2 } from '../src/editor/v2/workspace'
import type { WorkspaceV3 } from '../src/editor/v3/workspace'
import type { WorkspaceV5 } from '../src/editor/v5/workspace'
import type { SceneRepositoryV3 } from '../src/io/v3/storage'
import type { SceneRepositoryV5 } from '../src/io/v5/storage'

type AssetsDev = { workspace: WorkspaceV2 }
type LayersDev = { workspace: WorkspaceV3; repository: SceneRepositoryV3 }
type CompositionDev = { workspace: WorkspaceV5; repository: SceneRepositoryV5 }
const pageErrors = new WeakMap<Page, string[]>()
const legacyNavigation = (page: Page) => page.getByRole('navigation', { name: '兼容编辑器导航', exact: true })
const discard = (page: Page) => page.getByRole('button', { name: '放弃未提交输入并离开', exact: true })

test.beforeEach(({ page }) => {
  const errors: string[] = []; pageErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(async ({ page }, info) => {
  const errors = pageErrors.get(page) ?? []
  await evidence(info, 'u1a-legacy-page-errors.json', errors)
  expect(errors).toEqual([])
})

async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}
async function settled(page: Page, workbench: string) {
  await expect(page.getByTestId(workbench)).toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
}
async function fingerprints(page: Page, databases: string[]) {
  return page.evaluate(async databases => {
    const path = '/tests/helpers/u1a-browser.ts'
    return (await import(path) as typeof import('./helpers/u1a-browser')).fingerprintU1ADatabases(databases)
  }, databases)
}
async function layerState(page: Page) {
  return page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveLayersDev') as LayersDev
    const state = workspace.getState(), project = state.project
    if (!project) throw new Error('Expected an active native v3 project')
    const saved = await repository.load(project.document.sceneId)
    if (!saved) throw new Error('Expected the complete persisted native v3 project')
    return { document: structuredClone(project.document), savedDocument: structuredClone(saved.document),
      sourceHash: project.migrationSource?.sourceHash, status: state.status,
      rows: await repository.list(), snapshots: await repository.listSnapshots(project.document.sceneId) }
  })
}
async function compositionState(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/io/v5/project-file.ts'
    const { projectContentHashV5 } = await import(path) as typeof import('../src/io/v5/project-file')
    const { workspace, repository } = Reflect.get(window, '__sceneweaveCompositionDev') as CompositionDev
    const state = workspace.getState(), project = state.project
    if (!project) throw new Error('Expected an active native v5 project')
    const saved = await repository.load(project.document.sceneId)
    if (!saved) throw new Error('Expected the complete persisted native v5 project')
    return { sceneId: project.document.sceneId, revision: project.document.revision, status: state.status,
      contentHash: await projectContentHashV5(project), persistedHash: await projectContentHashV5(saved),
      appearance: structuredClone(project.appearance), canUndo: state.canUndo, canRedo: state.canRedo }
  })
}

test('U1a legacy handoff is consumed once and Home reopens the edited native v3 project without migrating again', async ({ page }, info) => {
  test.setTimeout(150_000)
  await page.goto('/#assets')
  await page.getByRole('button', { name: /书房与露台/ }).click()
  const migration = page.getByRole('dialog', { name: '确认打开素材工程', exact: true })
  await expect(migration).toBeVisible({ timeout: 30_000 })
  await migration.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(migration).toHaveCount(0); await settled(page, 'asset-workbench')
  const source = await page.evaluate(() => structuredClone((Reflect.get(window, '__sceneweaveAssetsDev') as AssetsDev).workspace.getState().project!.document))
  await page.getByRole('button', { name: '用户图层', exact: true }).click()
  await expect(page).toHaveURL(/#layers$/); await expect(migration).toBeVisible({ timeout: 30_000 })
  await migration.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(migration).toHaveCount(0); await settled(page, 'layer-workbench')
  const migrated = await layerState(page)
  expect(migrated.document.schemaVersion).toBe(3); expect(migrated.document.sceneId).not.toBe(source.sceneId)
  expect(migrated.document.revision).toBe(0); expect(migrated.document.props).toEqual(source.props)
  await page.getByRole('button', { name: '新建用户图层', exact: true }).click()
  await page.getByRole('textbox', { name: '新图层名称', exact: true }).fill('U1a 迁移后保留的图层')
  await page.getByRole('button', { name: '创建图层', exact: true }).click()
  await expect(page.getByRole('button', { name: '设为当前图层 U1a 迁移后保留的图层', exact: true })).toBeVisible()
  await expect(page.getByTestId('layer-workbench')).toHaveAttribute('data-revision', '1')
  await settled(page, 'layer-workbench')
  const edited = await layerState(page), storesBefore = await fingerprints(page, ['sceneweave-m1', 'sceneweave-m1-layers'])
  expect(edited.document.sceneId).toBe(migrated.document.sceneId); expect(edited.savedDocument).toEqual(edited.document)
  expect(edited.rows).toHaveLength(1)
  // A real committed revision clears the compatibility input guard; no discard is necessary.
  await legacyNavigation(page).getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(page.getByTestId('workspace-home')).toBeVisible(); await expect(page).toHaveURL(/#home$/)
  await expect(discard(page)).toHaveCount(0); await expect(page.locator('.workspace-legacy-body')).toHaveCount(0)
  await page.getByTestId('workspace-home').getByText('旧版兼容入口', { exact: true }).click()
  await page.getByTestId('workspace-home').getByRole('button', { name: '图层工坊', exact: true }).click()
  await expect(page).toHaveURL(/#layers$/); await settled(page, 'layer-workbench')
  await expect(migration).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '设为当前图层 U1a 迁移后保留的图层', exact: true })).toBeVisible()
  const reopened = await layerState(page), storesAfter = await fingerprints(page, ['sceneweave-m1', 'sceneweave-m1-layers'])
  expect(reopened).toEqual(edited); expect(storesAfter).toEqual(storesBefore)
  await evidence(info, 'u1a-legacy-source-handoff.json', { method: 'Real VIS-01 UI v2 to v3 handoff, explicit migration adoption and committed layer edit. Home compatibility reentry must reopen the same native ID/revision with no modal or new copy; all v2/v3 rows, snapshots, resource bytes and retained original fingerprints remain unchanged.', sourceSceneId: source.sceneId, migrated, edited, reopened, storesBefore, storesAfter })
})

test('U1a legacy unpreviewed appearance input guards Home, hash and real beforeunload until explicit discard', async ({ page }, info) => {
  test.setTimeout(150_000)
  await page.goto('/#composition'); await expect(page.getByTestId('composition-workbench')).toBeVisible()
  await page.evaluate(async () => {
    const path = '/tests/c3-fixtures.ts', { createC3ProjectV5 } = await import(path) as typeof import('./c3-fixtures')
    await (Reflect.get(window, '__sceneweaveCompositionDev') as CompositionDev).workspace.adoptNew(await createC3ProjectV5({ title: 'U1a 旧版外观草稿保护' }))
  })
  await settled(page, 'composition-workbench')
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill('c3-left')
  await page.locator('.asset-entity-list [data-entity-id="c3-left"]').click()
  const before = await compositionState(page), storesBefore = await fingerprints(page, ['sceneweave-m1-composition'])
  await page.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  await page.getByLabel('外观亮度', { exact: true }).fill('0.55')
  await expect(page.getByRole('button', { name: '预览外观调整', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toHaveCount(0)
  await legacyNavigation(page).getByRole('button', { name: '回到首页', exact: true }).click()
  const warning = page.getByRole('alert').filter({ hasText: '尚未提交的输入' })
  await expect(warning).toBeVisible(); await expect(discard(page)).toBeVisible()
  await expect(page).toHaveURL(/#composition$/); await expect(page.getByTestId('workspace-home')).toHaveCount(0)
  await expect(page.getByLabel('外观亮度', { exact: true })).toHaveValue('0.55')
  await page.evaluate(() => { location.hash = '#home' })
  await expect(page).toHaveURL(/#composition$/); await expect(warning).toBeVisible()
  await expect(page.getByLabel('外观亮度', { exact: true })).toHaveValue('0.55')
  await expect(page.getByLabel('地图视口', { exact: true })).toHaveAttribute('data-selected-ids', '["c3-left"]')
  expect(await compositionState(page)).toEqual(before)
  // Trusted UI input above supplies Chrome's required user activation. This is a real browser prompt.
  const pendingDialog = page.waitForEvent('dialog', { timeout: 15_000 })
  const reload = page.reload({ waitUntil: 'commit', timeout: 20_000 }).then(
    () => ({ completed: true, error: null as string | null }),
    error => ({ completed: false, error: String(error) }),
  )
  const dialog = await pendingDialog, promptType = dialog.type()
  await dialog.dismiss(); expect(promptType).toBe('beforeunload')
  const rejectedReload = await reload
  expect(rejectedReload.completed).toBe(false)
  await expect(page).toHaveURL(/#composition$/); await expect(page.getByLabel('外观亮度', { exact: true })).toHaveValue('0.55')
  expect(await compositionState(page)).toEqual(before)
  await expect(discard(page)).toBeVisible(); await discard(page).click()
  await expect(page.getByTestId('workspace-home')).toBeVisible(); await expect(page).toHaveURL(/#home$/)
  await expect(page.getByTestId('composition-workbench')).toHaveCount(0); await expect(page.locator('.workspace-legacy-body')).toHaveCount(0)
  await expect(discard(page)).toHaveCount(0)
  const storesAfter = await fingerprints(page, ['sceneweave-m1-composition'])
  expect(storesAfter).toEqual(storesBefore)
  await page.getByTestId('workspace-home').getByText('旧版兼容入口', { exact: true }).click()
  await page.getByTestId('workspace-home').getByRole('button', { name: '组件工坊', exact: true }).click()
  await settled(page, 'composition-workbench'); await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await compositionState(page)).toEqual(before)
  await expect(page.getByLabel('外观调整项目', { exact: true })).toHaveValue('tint')
  await evidence(info, 'u1a-legacy-unsubmitted-input.json', { method: 'Real native v5 and actual C3 bitmap fixture via DEV seeding only; trusted UI brightness input without preview, Home/hash rejection, real beforeunload dismissal, then explicit discard and native reopen. No content/revision/appearance/resource/history change is allowed.', before, promptType, rejectedReload, reopened: await compositionState(page), storesBefore, storesAfter })
})

test('U1a legacy outdoor keeps its own draft guard and reloads a durable appearance adoption without a stale unload prompt', async ({ page }, info) => {
  test.setTimeout(150_000)
  type OutdoorDev = { workspace: import('../src/editor/v6/workspace').WorkspaceV6; repository: import('../src/io/v6/storage').SceneRepositoryV6 }
  const readState = () => page.evaluate(async () => {
    const path = '/src/io/v6/project-file.ts'
    const { projectContentHashV6 } = await import(path) as typeof import('../src/io/v6/project-file')
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as OutdoorDev
    const state = workspace.getState(), project = state.project
    if (!project) throw new Error('Expected an active native v6 project')
    const saved = await repository.load(project.document.sceneId)
    return { sceneId: project.document.sceneId, revision: project.document.revision, status: state.status,
      contentHash: await projectContentHashV6(project), appearance: structuredClone(project.appearance),
      persistedRevision: saved?.document.revision ?? null, persistedHash: saved ? await projectContentHashV6(saved) : null }
  })
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await page.evaluate(async () => {
    const path = '/tests/helpers/u1a-browser.ts'
    const { createU1AProject } = await import(path) as typeof import('./helpers/u1a-browser')
    await (Reflect.get(window, '__sceneweaveOutdoorDev') as OutdoorDev).workspace.adoptNew(await createU1AProject('U1a 旧版室外持久采用'))
  })
  await settled(page, 'outdoor-workbench')
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill('c3-left')
  await page.locator('.asset-entity-list [data-entity-id="c3-left"]').click()
  const before = await readState()
  expect(before.persistedRevision).toBe(before.revision); expect(before.persistedHash).toBe(before.contentHash)
  await page.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  await page.getByLabel('外观亮度', { exact: true }).fill('0.55')
  await legacyNavigation(page).getByRole('button', { name: '回到首页', exact: true }).click()
  const warning = page.getByTestId('outdoor-workbench').getByRole('alert').filter({ hasText: '外观参数有尚未预览的输入' })
  await expect(warning).toBeVisible(); await expect(page).toHaveURL(/#outdoor$/)
  await expect(page.getByTestId('workspace-home')).toHaveCount(0); await expect(discard(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '取消外观草稿', exact: true })).toBeVisible()
  await page.evaluate(() => { location.hash = '#home' })
  await expect(page).toHaveURL(/#outdoor$/); await expect(warning).toBeVisible()
  await expect(page.getByLabel('外观亮度', { exact: true })).toHaveValue('0.55')
  await expect(page.getByLabel('地图视口', { exact: true })).toHaveAttribute('data-selected-ids', '["c3-left"]')
  expect(await readState()).toEqual(before)
  await page.getByRole('button', { name: '预览外观调整', exact: true }).click()
  const adopt = page.getByRole('button', { name: '采用组件修改', exact: true })
  await expect(adopt).toBeVisible(); expect(await readState()).toEqual(before)
  await adopt.click(); await expect(adopt).toHaveCount(0)
  const expectedRevision = before.revision + 1
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-revision', String(expectedRevision))
  // Wait for this specific committed revision in native IDB, not a stale "saved" label from the prior revision.
  const committed = await readState()
  expect(committed.sceneId).toBe(before.sceneId); expect(committed.revision).toBe(expectedRevision)
  expect(committed.contentHash).not.toBe(before.contentHash)
  expect(committed.appearance.instanceAdjustments['c3-left']).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'brightness', value: 0.55, enabled: true })]))
  await expect.poll(async () => {
    const current = await readState()
    return { sceneId: current.sceneId, revision: current.revision, status: current.status,
      persistedRevision: current.persistedRevision, contentMatches: current.contentHash === committed.contentHash && current.persistedHash === committed.contentHash }
  }, { timeout: 30_000, intervals: [100, 250, 500] }).toEqual({ sceneId: before.sceneId, revision: expectedRevision, status: 'saved', persistedRevision: expectedRevision, contentMatches: true })
  await settled(page, 'outdoor-workbench')
  const durable = await readState(), storesBeforeReload = await fingerprints(page, ['sceneweave-m1-outdoor'])
  expect(durable.persistedRevision).toBe(expectedRevision); expect(durable.persistedHash).toBe(committed.contentHash)
  const unexpectedDialogs: { type: string; message: string }[] = [], dismissalErrors: string[] = [], dismissals: Promise<void>[] = []
  const onDialog = (dialog: import('@playwright/test').Dialog) => {
    unexpectedDialogs.push({ type: dialog.type(), message: dialog.message() })
    dismissals.push(dialog.dismiss().catch(error => { dismissalErrors.push(String(error)) }))
  }
  page.on('dialog', onDialog)
  let reloadError: string | null = null
  try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }) }
  catch (error) { reloadError = String(error) }
  finally { page.off('dialog', onDialog); await Promise.all(dismissals) }
  await evidence(info, 'u1a-legacy-outdoor-reload-attempt.json', { durable, unexpectedDialogs, dismissalErrors, reloadError })
  expect(unexpectedDialogs).toEqual([]); expect(dismissalErrors).toEqual([]); expect(reloadError).toBeNull()
  await expect(page).toHaveURL(/#outdoor$/); await settled(page, 'outdoor-workbench')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const reopened = await readState(), storesAfterReload = await fingerprints(page, ['sceneweave-m1-outdoor'])
  expect(reopened).toEqual(durable); expect(storesAfterReload).toEqual(storesBeforeReload)
  await legacyNavigation(page).getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(page.getByTestId('workspace-home')).toBeVisible(); await expect(page).toHaveURL(/#home$/)
  await expect(discard(page)).toHaveCount(0)
  expect(await fingerprints(page, ['sceneweave-m1-outdoor'])).toEqual(storesBeforeReload)
  await evidence(info, 'u1a-legacy-outdoor-own-guard.json', { method: 'Real native v6 with actual C3 bitmap via DEV seeding only. UI unpreviewed brightness is protected by the v6-specific appearance guard for Home and hash, then previewed/adopted. Reload starts only after the exact committed revision and fully validated content hash are durable in native IDB. Any unload dialog is dismissed and fails the test; successful reload and Home keep the original ID/revision, complete graph/resources and all native store fingerprints.', before, committed, durable, reopened, unexpectedDialogs, storesBeforeReload, storesAfterReload })
})

test('U1a legacy departure blocks new input while save is pending and releases the barrier on success or rejection', async ({ page }, info) => {
  test.setTimeout(180_000)
  type OutdoorDev = { workspace: import('../src/editor/v6/workspace').WorkspaceV6; repository: import('../src/io/v6/storage').SceneRepositoryV6 }
  type SaveGate = { entered: boolean; calls: number; revision: number | null; release: (outcome: 'save' | 'reject') => void; restore: () => void }
  const readState = () => page.evaluate(async () => {
    const path = '/src/io/v6/project-file.ts'
    const { projectContentHashV6 } = await import(path) as typeof import('../src/io/v6/project-file')
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as OutdoorDev
    const state = workspace.getState(), project = state.project
    if (!project) throw new Error('Expected the current v6 editing branch')
    const saved = await repository.load(project.document.sceneId)
    return { sceneId: project.document.sceneId, revision: project.document.revision, rotation: project.document.props['c3-left'].rotationDeg,
      contentHash: await projectContentHashV6(project), status: state.status, canUndo: state.canUndo, canRedo: state.canRedo,
      persistedRevision: saved?.document.revision ?? null, persistedHash: saved ? await projectContentHashV6(saved) : null }
  })
  const choose = async () => {
    await page.getByRole('tab', { name: '场景', exact: true }).click()
    await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
    await page.getByLabel('搜索场景物件', { exact: true }).fill('c3-left')
    await page.locator('.asset-entity-list [data-entity-id="c3-left"]').click()
  }
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await page.evaluate(async () => {
    const path = '/tests/helpers/u1a-browser.ts'
    const { createU1AProject } = await import(path) as typeof import('./helpers/u1a-browser')
    await (Reflect.get(window, '__sceneweaveOutdoorDev') as OutdoorDev).workspace.adoptNew(await createU1AProject('U1a 离开保存期屏障'))
  })
  await settled(page, 'outdoor-workbench'); await choose()
  const stages: unknown[] = [], modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  try {
    for (const outcome of ['save', 'reject'] as const) {
      const before = await readState(), angle = outcome === 'save' ? 10 : 25
      expect(before.status).toBe('saved'); expect(before.persistedHash).toBe(before.contentHash)
      // Only this repository method's scheduling/failure is simulated. The successful release executes its real native IDB write.
      await page.evaluate(() => {
        const { repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as OutdoorDev
        const original = repository.save.bind(repository)
        let release!: (outcome: 'save' | 'reject') => void
        const held = new Promise<'save' | 'reject'>(resolve => { release = resolve })
        const gate: SaveGate = { entered: false, calls: 0, revision: null, release, restore: () => { repository.save = original } }
        repository.save = async (...args) => {
          gate.calls++; gate.revision = args[0].document.revision; gate.entered = true
          if (await held === 'reject') throw new Error('U1a injected save rejection while leaving')
          return original(...args)
        }
        Reflect.set(window, '__u1aLeaveSaveGate', gate)
      })
      const rotation = page.getByRole('spinbutton', { name: '物件旋转', exact: true })
      await rotation.fill(String(angle)); await rotation.press('Tab')
      await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__u1aLeaveSaveGate') as SaveGate).entered)).toBe(true)
      await expect(page.locator('.asset-busy')).toHaveCount(0)
      const during = await readState()
      expect(during.revision).toBe(before.revision + 1); expect(during.rotation).toBe(angle)
      expect(during.status).toBe('saving'); expect(during.canUndo).toBe(true)
      expect(during.persistedHash).toBe(before.contentHash)
      const body = page.locator('.workspace-legacy-body'), color = body.locator('input[aria-label="外观调色颜色"]')
      const buildingTab = body.locator('[role="tab"]').filter({ hasText: /^建筑$/ })
      const originalColor = await color.inputValue(), colorBox = await color.boundingBox(), buildingBox = await buildingTab.boundingBox()
      if (!colorBox || !buildingBox) throw new Error('Expected visible appearance and building controls before departure')
      await legacyNavigation(page).getByRole('button', { name: '回到首页', exact: true }).click()
      await expect(body).toHaveJSProperty('inert', true)
      await expect(page).toHaveURL(/#outdoor$/); await expect(page.getByTestId('workspace-home')).toHaveCount(0)
      // Raw pointer/keyboard input respects native inert. Programmatic fill/dispatch would not test this browser barrier.
      await page.mouse.click(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2)
      await page.keyboard.press(`${modifier}+A`); await page.keyboard.type('#ff0000')
      await page.mouse.click(buildingBox.x + buildingBox.width / 2, buildingBox.y + buildingBox.height / 2)
      await page.keyboard.press(`${modifier}+Z`); await page.keyboard.press(`${modifier}+S`)
      await expect(color).toHaveValue(originalColor); await expect(buildingTab).toHaveAttribute('aria-selected', 'false')
      expect(await readState()).toEqual(during)
      expect(await page.evaluate(() => (Reflect.get(window, '__u1aLeaveSaveGate') as SaveGate).calls)).toBe(1)
      await page.evaluate(outcome => {
        const gate = Reflect.get(window, '__u1aLeaveSaveGate') as SaveGate
        gate.restore(); gate.release(outcome); Reflect.deleteProperty(window, '__u1aLeaveSaveGate')
      }, outcome)
      if (outcome === 'save') {
        await expect(page.getByTestId('workspace-home')).toBeVisible({ timeout: 30_000 }); await expect(page).toHaveURL(/#home$/)
        await expect(body).toHaveCount(0)
        const persisted = await page.evaluate(async sceneId => {
          const path = '/src/io/v6/project-file.ts'
          const { projectContentHashV6 } = await import(path) as typeof import('../src/io/v6/project-file')
          const { repository, workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as OutdoorDev
          const saved = await repository.load(sceneId)
          if (!saved) throw new Error('Released native save did not preserve the original project')
          return { sceneId: saved.document.sceneId, revision: saved.document.revision, rotation: saved.document.props['c3-left'].rotationDeg,
            contentHash: await projectContentHashV6(saved), closed: workspace.getState().project === null, rows: (await repository.list()).length }
        }, before.sceneId)
        expect(persisted).toEqual({ sceneId: before.sceneId, revision: during.revision, rotation: angle, contentHash: during.contentHash, closed: true, rows: 1 })
        stages.push({ outcome, before, during, persisted })
        await page.getByTestId('workspace-home').getByText('旧版兼容入口', { exact: true }).click()
        await page.getByTestId('workspace-home').getByRole('button', { name: '室外工坊', exact: true }).click()
        await settled(page, 'outdoor-workbench'); await choose()
        expect((await readState()).contentHash).toBe(during.contentHash)
      } else {
        await expect(page.locator('.workspace-route-message')).toContainText('U1a injected save rejection while leaving')
        await expect(body).toHaveJSProperty('inert', false)
        await expect(page).toHaveURL(/#outdoor$/); await expect(page.getByTestId('workspace-home')).toHaveCount(0)
        const failed = await readState()
        expect(failed.contentHash).toBe(during.contentHash); expect(failed.revision).toBe(during.revision)
        expect(failed.status).toBe('error'); expect(failed.canUndo).toBe(true); expect(failed.canRedo).toBe(during.canRedo)
        expect(failed.persistedRevision).toBe(before.revision); expect(failed.persistedHash).toBe(before.contentHash)
        await expect(page.getByRole('button', { name: '撤销素材编辑', exact: true })).toBeEnabled()
        await page.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
        await page.getByLabel('外观亮度', { exact: true }).fill('0.65')
        await expect(page.getByLabel('外观亮度', { exact: true })).toHaveValue('0.65')
        await page.getByRole('button', { name: '取消外观草稿', exact: true }).click()
        await expect(page.getByLabel('外观调整项目', { exact: true })).toHaveValue('tint')
        expect(await readState()).toEqual(failed)
        stages.push({ outcome, before, during, failed, inputAvailableAfterFailure: true })
      }
    }
    await evidence(info, 'u1a-legacy-departure-save-barrier.json', { method: 'Real Chrome and native v6/C3 bitmap fixture; only repository.save is held by an injected Promise. UI immediate prop edits start each save, then root Home requests close. Native inert plus raw mouse and keyboard input must prevent appearance changes, new tools and Undo/Save during the wait. The success gate runs the actual repository save; the failure gate throws a clearly simulated rejection, preserving current branch/undo and old durable revision while restoring form input.', stages })
  } finally {
    await page.evaluate(() => {
      const gate = Reflect.get(window, '__u1aLeaveSaveGate') as SaveGate | undefined
      if (gate) { gate.restore(); gate.release('reject'); Reflect.deleteProperty(window, '__u1aLeaveSaveGate') }
    }).catch(() => {})
  }
})
