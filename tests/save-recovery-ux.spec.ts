import { expect, test, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { HistoryIndex } from '../src/shared/project/file'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, placeKeyboardLamp } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

type SaveFailureName = 'QuotaExceededError' | 'UnknownError'
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
type SaveFaultFacts = { enabled: boolean; errorName: SaveFailureName; hits: { method: 'add' | 'put'; database: string; sceneId: string | null; revision: number | null }[] }

async function closeDrawers(page: Page): Promise<void> {
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') !== 'true') return
  for (const [id, name] of [['resources', '内容面板'], ['inspector', '当前详情']] as const) {
    const panel = page.getByTestId(`workspace-${id}`)
    if (await panel.getAttribute('data-open') !== 'true') continue
    await panel.getByRole('button', { name: `关闭${name}`, exact: true }).click()
    await expect(panel).toHaveAttribute('data-open', 'false')
  }
}

/** Wrap only native write APIs in this isolated page; never inject an application state or write a record. */
async function installSaveFault(page: Page, errorName: SaveFailureName): Promise<void> {
  await page.evaluate(name => {
    const originalAdd = IDBObjectStore.prototype.add, originalPut = IDBObjectStore.prototype.put
    const state: SaveFaultFacts = { enabled: true, errorName: name, hits: [] }
    const fail = (store: IDBObjectStore, method: 'add' | 'put', value: unknown) => {
      // A continuing quota fault rejects a new copy too. Do not accidentally
      // imply that switching scene IDs solves an actually full browser store.
      if (!state.enabled || store.name !== 'projects' || !/^sceneweave-projects-dev-v1(?:-[a-f0-9]{64})?$/.test(store.transaction.db.name)) return
      const row = value && typeof value === 'object' ? value as Record<string, unknown> : null
      state.hits.push({ method, database: store.transaction.db.name, sceneId: typeof row?.sceneId === 'string' ? row.sceneId : null,
        revision: typeof row?.revision === 'number' ? row.revision : null })
      throw new DOMException(`保存恢复定向注入：${name}`, name)
    }
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      fail(this, 'add', value)
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key)
    }
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      fail(this, 'put', value)
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
    }
    Reflect.set(window, '__saveRecoveryFault', { state, restore: () => {
      state.enabled = false
      IDBObjectStore.prototype.add = originalAdd; IDBObjectStore.prototype.put = originalPut
    } })
  }, errorName)
}

async function faultFacts(page: Page): Promise<SaveFaultFacts> {
  return page.evaluate(() => Reflect.get(window, '__saveRecoveryFault').state as SaveFaultFacts)
}

async function clearSaveFault(page: Page): Promise<void> {
  await page.evaluate(() => Reflect.get(window, '__saveRecoveryFault')?.restore())
}

async function titleSettings(page: Page): Promise<Locator> {
  const resources = await openWorkspaceModule(page, '场景')
  await resources.getByRole('button', { name: '场景设置', exact: true }).click()
  return (await openKeyboardPanel(page, 'inspector')).getByRole('region', { name: '场景设置', exact: true }).and(page.locator('.workspace-project-tools'))
}

async function rename(page: Page, title: string): Promise<void> {
  const settings = await titleSettings(page)
  await settings.getByLabel('工程名称', { exact: true }).and(settings.locator('input:enabled')).fill(title)
  await settings.getByRole('button', { name: '保存名称', exact: true }).and(settings.locator('button:enabled')).click()
}

async function savedColdOpen(page: Page, id: string): Promise<void> {
  await page.goto('./#home')
  // Explicit reload discards the previous in-memory workspace even when goto
  // changed only the hash in an existing page.
  await page.reload()
  const row = page.getByTestId('workspace-home').locator(`[data-project-key="native:${id}"]`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await closeDrawers(page)
}

async function backupHashes(path: string): Promise<Record<string, string>> {
  const entries = unzipSync(new Uint8Array(await readFile(path)))
  return Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]))
}

async function recoveryBackup(page: Page, path: string): Promise<Record<string, string>> {
  const recovery = page.getByRole('alert', { name: '保存恢复选项', exact: true })
  const downloaded = page.waitForEvent('download')
  await recovery.getByRole('button', { name: '下载当前工程备份', exact: true }).click()
  await (await downloaded).saveAs(path)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  return backupHashes(path)
}

/** Check a real click target after scrolling the recovery bar's own overflow. */
async function usableButton(button: Locator): Promise<unknown> {
  await expect(button).toBeEnabled()
  await button.scrollIntoViewIfNeeded()
  const target = await button.evaluate(node => {
    const box = node.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2
    const hit = document.elementFromPoint(x, y)
    return { name: node.textContent?.trim(), x, y, width: box.width, height: box.height,
      inViewport: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight, hit: hit === node || !!hit && node.contains(hit) }
  })
  expect(target.inViewport, JSON.stringify(target)).toBe(true)
  expect(target.hit, JSON.stringify(target)).toBe(true)
  return target
}

async function failedSave(page: Page, before: Backup): Promise<Locator> {
  const recovery = page.getByRole('alert', { name: '保存恢复选项', exact: true })
  await expect(page.locator('.asset-save')).toHaveText('保存失败')
  await expect(recovery).toContainText('本机保存未完成')
  await expect(recovery).toContainText('当前编辑仍保留在此页面')
  await expect(recovery).toContainText('不包含尚未采用的草稿')
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision + 1))
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await closeDrawers(page)
  return recovery
}

for (const scenario of [
  { failure: 'QuotaExceededError', recovery: 'retry', size: { width: 1512, height: 982 } },
  { failure: 'UnknownError', recovery: 'copy', size: { width: 390, height: 844 } },
] as const) test(`production ${scenario.failure} preserves the memory and saved branches, then ${scenario.recovery} at ${scenario.size.width}px`, async ({ page, context, browser }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = [], clickTargets: unknown[] = []
  page.on('pageerror', error => errors.push(error.message))
  // Fixture creation uses the normal desktop library/placement UI. The entire
  // failure and recovery journey below uses the declared desktop/narrow size.
  await page.setViewportSize({ width: 1512, height: 982 })
  await createKeyboardProject(page, `保存恢复 ${scenario.failure}`)
  await placeKeyboardLamp(page)
  await closeDrawers(page)
  const before = await keyboardProjectBackup(page, info.outputPath('saved-before.sceneweave'))
  expect(Object.keys(before.document.props)).toHaveLength(1)
  expect(Object.keys(keyboardResourceHashes(before.hashes)).length).toBeGreaterThan(0)
  await page.setViewportSize(scenario.size)
  await closeDrawers(page)
  await installSaveFault(page, scenario.failure)
  const editedTitle = `${before.document.title} 内存新分支`
  let observer: Page | null = null
  try {
    await rename(page, editedTitle)
    const recovery = await failedSave(page, before)
    if (scenario.failure === 'QuotaExceededError') {
      await expect(recovery).toContainText('浏览器存储空间不足')
      await expect(recovery).toContainText('另存副本也需要此浏览器的可用空间')
    }
    await expect.poll(async () => (await faultFacts(page)).hits.length).toBe(1)
    // 120ms is the application's auto-save debounce. Wait through multiple
    // intervals to prove blocked saves do not keep resending on their own.
    await page.waitForTimeout(400)
    expect((await faultFacts(page)).hits).toHaveLength(1)
    // A draft does not enter a backup. Its separate guard still blocks creating
    // a copy, and the recovery explanation must describe that exact action.
    const settings = await titleSettings(page)
    const draftTitle = `${editedTitle} 未采用草稿`
    await settings.getByLabel('工程名称', { exact: true }).fill(draftTitle)
    const copy = recovery.getByRole('button', { name: '另存副本', exact: true })
    await expect(copy).toBeDisabled()
    await expect(copy).toHaveAccessibleDescription(/另存副本暂不可用：工程名称尚未保存/)
    await expect(recovery.getByRole('button', { name: '下载当前工程备份', exact: true })).toBeEnabled()
    await openWorkspaceModule(page, '素材')
    await page.locator('.workspace-help > summary').click()
    await expect(page.getByRole('region', { name: '制作流程与快捷键', exact: true })).toContainText('保存、备份与分享')
    await page.locator('.workspace-help > summary').press('Escape')
    await expect(page.locator('.workspace-help')).not.toHaveAttribute('open')
    await page.getByRole('button', { name: '返回当前工具与草稿', exact: true }).click()
    await expect(settings.getByLabel('工程名称', { exact: true })).toHaveValue(draftTitle)
    await settings.getByRole('button', { name: '取消改名', exact: true }).click()
    await expect(settings.getByLabel('工程名称', { exact: true })).toHaveValue(editedTitle)
    await expect(copy).toBeEnabled()
    await closeDrawers(page)
    const ordinaryNotice = page.getByRole('button', { name: '关闭工坊提示', exact: true })
    if (await ordinaryNotice.isVisible()) await ordinaryNotice.click()
    await expect(recovery).toBeVisible()
    await recovery.locator('summary').click()
    await expect(recovery).toContainText(`保存恢复定向注入：${scenario.failure}`)
    for (const name of ['下载当前工程备份', '重试保存', '另存副本']) {
      clickTargets.push(await usableButton(recovery.getByRole('button', { name, exact: true })))
    }
    await page.screenshot({ path: info.outputPath('save-failed-recovery.png') })
    const memory = await keyboardProjectBackup(page, info.outputPath('memory-retained.sceneweave'))
    expect(memory.document.sceneId).toBe(before.document.sceneId)
    expect(memory.document.revision).toBe(before.document.revision + 1)
    expect(memory.document.title).toBe(editedTitle)
    expect(memory.document.props).toEqual(before.document.props)
    expect(memory.identity).toEqual(before.identity)
    expect(memory.appearance).toEqual(before.appearance)
    expect(keyboardResourceHashes(memory.hashes)).toEqual(keyboardResourceHashes(before.hashes))
    expect(await recoveryBackup(page, info.outputPath('direct-recovery-backup.sceneweave'))).toEqual(memory.hashes)

    observer = await context.newPage()
    observer.on('pageerror', error => errors.push(error.message))
    await observer.setViewportSize(scenario.size)
    await savedColdOpen(observer, before.document.sceneId)
    expect((await keyboardProjectBackup(observer, info.outputPath('original-during-failure.sceneweave'))).hashes).toEqual(before.hashes)

    await usableButton(recovery.getByRole('button', { name: '重试保存', exact: true }))
    await recovery.getByRole('button', { name: '重试保存', exact: true }).click()
    await failedSave(page, before)
    await expect.poll(async () => (await faultFacts(page)).hits.length).toBe(2)
    expect((await keyboardProjectBackup(page, info.outputPath('retry-failed-memory.sceneweave'))).hashes).toEqual(memory.hashes)
    await usableButton(recovery.getByRole('button', { name: '另存副本', exact: true }))
    await recovery.getByRole('button', { name: '另存副本', exact: true }).click()
    await failedSave(page, before)
    await expect.poll(async () => (await faultFacts(page)).hits.length).toBe(3)
    const rejected = await faultFacts(page)
    expect(rejected.hits.map(hit => hit.method)).toEqual(['put', 'put', 'add'])
    expect((await keyboardProjectBackup(page, info.outputPath('copy-failed-memory.sceneweave'))).hashes).toEqual(memory.hashes)
    await savedColdOpen(observer, before.document.sceneId)
    expect((await keyboardProjectBackup(observer, info.outputPath('original-after-recovery-failures.sceneweave'))).hashes).toEqual(before.hashes)

    await clearSaveFault(page)
    const actionName = scenario.recovery === 'retry' ? '重试保存' : '另存副本'
    await usableButton(recovery.getByRole('button', { name: actionName, exact: true }))
    await recovery.getByRole('button', { name: actionName, exact: true }).click()
    await keyboardWorkspaceSaved(page)
    await expect(recovery).toHaveCount(0)
    const recovered = await keyboardProjectBackup(page, info.outputPath('recovered.sceneweave'))
    expect(recovered.document.props).toEqual(memory.document.props)
    expect(recovered.identity).toEqual(memory.identity)
    expect(recovered.appearance).toEqual(memory.appearance)
    expect(keyboardResourceHashes(recovered.hashes)).toEqual(keyboardResourceHashes(memory.hashes))
    if (scenario.recovery === 'retry') {
      expect(recovered.hashes).toEqual(memory.hashes)
      await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
    } else {
      expect(recovered.document.sceneId).not.toBe(before.document.sceneId)
      expect(recovered.document.revision).toBe(0)
      expect(recovered.document.title).toBe(`${editedTitle} · 副本`)
      await savedColdOpen(observer, before.document.sceneId)
      expect((await keyboardProjectBackup(observer, info.outputPath('original-after-copy.sceneweave'))).hashes).toEqual(before.hashes)
    }
    await savedColdOpen(page, recovered.document.sceneId)
    expect((await keyboardProjectBackup(page, info.outputPath('recovered-cold.sceneweave'))).hashes).toEqual(recovered.hashes)
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
    expect(dimensions.root).toBeLessThanOrEqual(dimensions.viewport)
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport)
    expect(errors).toEqual([])
    await writeFile(info.outputPath('save-recovery-facts.json'), JSON.stringify({ scenario, browserVersion: browser.version(), injected: rejected, clickTargets, dimensions,
      revisions: { saved: before.document.revision, memory: memory.document.revision, recovered: recovered.document.revision },
      savedSceneId: before.document.sceneId, recoveredSceneId: recovered.document.sceneId,
      savedHashes: before.hashes, memoryHashes: memory.hashes, recoveredHashes: recovered.hashes, errors,
      method: 'Deterministic native IDBObjectStore add/put exception in the isolated page; not actual storage exhaustion',
      excluded: ['real full-disk or browser quota exhaustion', 'cross-tab CAS', 'all storage failure modes', 'visual P3'] }, null, 2))
  } finally {
    await clearSaveFault(page)
    await observer?.close()
  }
})

test('production cross-tab conflict offers backup and copy without replacing the saved branch at 390px', async ({ page, context, browser }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1512, height: 982 })
  await createKeyboardProject(page, '保存冲突恢复')
  await placeKeyboardLamp(page)
  await closeDrawers(page)
  const baseline = await keyboardProjectBackup(page, info.outputPath('cas-baseline.sceneweave'))
  const other = await context.newPage()
  other.on('pageerror', error => errors.push(error.message))
  try {
    await other.setViewportSize({ width: 390, height: 844 })
    await savedColdOpen(other, baseline.document.sceneId)
    const snapshotName = '冲突前的命名快照'
    const history = await openWorkspaceModule(other, '历史')
    await history.getByRole('button', { name: '新建命名快照', exact: true }).click()
    await history.getByLabel('命名快照名称', { exact: true }).fill(snapshotName)
    await history.getByRole('button', { name: '保存快照', exact: true }).click()
    await expect(other.locator('.asset-busy')).toHaveCount(0)
    await openWorkspaceModule(other, '历史')
    await history.getByLabel('备份携带所选快照', { exact: true }).check()
    await history.getByLabel(`备份快照 ${snapshotName}`, { exact: true }).check()
    const healthyHistoryDownload = other.waitForEvent('download')
    await history.getByRole('button', { name: '下载工程与所选历史 · 1 份', exact: true }).click()
    const healthyHistoryPath = info.outputPath('cas-history-before.sceneweave')
    await (await healthyHistoryDownload).saveAs(healthyHistoryPath)
    await expect(other.locator('.asset-busy')).toHaveCount(0)
    const healthyFeedback = other.getByRole('status', { name: '工程备份状态', exact: true })
    await expect(healthyFeedback).toContainText('已发起此工程的文件下载')
    await expect(healthyFeedback).toContainText('所选 1 份历史快照')
    const healthyHistoryFiles = unzipSync(new Uint8Array(await readFile(healthyHistoryPath)))
    const healthyIndex = JSON.parse(new TextDecoder().decode(healthyHistoryFiles['history.json'])) as HistoryIndex
    expect(JSON.parse(new TextDecoder().decode(healthyHistoryFiles['scene.json']))).toEqual(baseline.document)
    expect(healthyIndex.snapshots).toHaveLength(1)
    expect(healthyIndex.snapshots[0].summary.name).toBe(snapshotName)

    const savedTitle = `${baseline.document.title} 已保存版本`
    await rename(page, savedTitle)
    await keyboardWorkspaceSaved(page)
    const winner = await keyboardProjectBackup(page, info.outputPath('cas-saved-winner.sceneweave'))

    // With no pending write this stale page still reports saved. A history
    // archive must not silently substitute the other page's current project.
    await expect(other.locator('.asset-save')).toHaveText('本地已保存')
    await expect(other.locator('.workspace-unified')).toHaveAttribute('data-revision', String(baseline.document.revision))
    let rejectedHistoryDownloads = 0
    const receivedHistory = () => { rejectedHistoryDownloads++ }
    other.on('download', receivedHistory)
    try {
      await history.getByRole('button', { name: '下载工程与所选历史 · 1 份', exact: true }).click()
      const feedback = other.getByRole('status', { name: '工程备份状态', exact: true })
      await expect(feedback).toContainText('此浏览器中的已保存版本已变化')
      await expect(feedback).toContainText('尚未发起本次文件下载')
      await expect(other.locator('.asset-busy')).toHaveCount(0)
      await expect(other.getByText(/此浏览器中的已保存版本已变化/)).toHaveCount(1)
      expect(rejectedHistoryDownloads).toBe(0)
      await expect(other.locator('.asset-save')).toHaveText('本地已保存')
      await expect(other.locator('.workspace-unified')).toHaveAttribute('data-revision', String(baseline.document.revision))
      await other.screenshot({ path: info.outputPath('cas-stale-history-backup-rejected-390.png') })
    } finally { other.off('download', receivedHistory) }
    const stalePage = await keyboardProjectBackup(other, info.outputPath('cas-stale-page-complete.sceneweave'))
    expect(stalePage.hashes).toEqual(baseline.hashes)

    const memoryTitle = `${baseline.document.title} 当前冲突分支`
    await rename(other, memoryTitle)
    await expect(other.locator('.asset-save')).toHaveText('版本冲突')
    await expect(other.locator('.asset-busy')).toHaveCount(0)
    await closeDrawers(other)
    const recovery = other.getByRole('alert', { name: '保存恢复选项', exact: true })
    await expect(recovery).toContainText('保存版本发生冲突')
    await expect(recovery).toContainText('另一版本不会被覆盖')
    await expect(recovery.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0)
    await expect(other.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
    const targets = []
    for (const name of ['下载当前工程备份', '另存副本']) targets.push(await usableButton(recovery.getByRole('button', { name, exact: true })))
    await other.screenshot({ path: info.outputPath('cas-conflict-recovery-390.png') })
    const memory = await keyboardProjectBackup(other, info.outputPath('cas-memory-branch.sceneweave'))
    expect(memory.document.sceneId).toBe(baseline.document.sceneId)
    expect(memory.document.revision).toBe(baseline.document.revision + 1)
    expect(memory.document.title).toBe(memoryTitle)
    expect(memory.document.props).toEqual(baseline.document.props)
    expect(memory.identity).toEqual(baseline.identity)
    expect(memory.appearance).toEqual(baseline.appearance)
    expect(keyboardResourceHashes(memory.hashes)).toEqual(keyboardResourceHashes(baseline.hashes))
    expect(await recoveryBackup(other, info.outputPath('cas-direct-recovery-backup.sceneweave'))).toEqual(memory.hashes)

    await recovery.getByRole('button', { name: '另存副本', exact: true }).click()
    await keyboardWorkspaceSaved(other)
    await expect(recovery).toHaveCount(0)
    const copied = await keyboardProjectBackup(other, info.outputPath('cas-recovered-copy.sceneweave'))
    expect(copied.document.sceneId).not.toBe(baseline.document.sceneId)
    expect(copied.document.revision).toBe(0)
    expect(copied.document.title).toBe(`${memoryTitle} · 副本`)
    expect(copied.document.props).toEqual(memory.document.props)
    expect(copied.identity).toEqual(memory.identity)
    expect(copied.appearance).toEqual(memory.appearance)
    expect(keyboardResourceHashes(copied.hashes)).toEqual(keyboardResourceHashes(memory.hashes))

    await savedColdOpen(page, baseline.document.sceneId)
    expect((await keyboardProjectBackup(page, info.outputPath('cas-cold-winner.sceneweave'))).hashes).toEqual(winner.hashes)
    await savedColdOpen(other, copied.document.sceneId)
    expect((await keyboardProjectBackup(other, info.outputPath('cas-cold-copy.sceneweave'))).hashes).toEqual(copied.hashes)
    expect(errors).toEqual([])
    await writeFile(info.outputPath('cas-save-recovery-facts.json'), JSON.stringify({
      browserVersion: browser.version(), method: 'Normal UI, two pages in one isolated origin, real IndexedDB CAS; no state or fault injection',
      baselineSceneId: baseline.document.sceneId, copiedSceneId: copied.document.sceneId,
      baselineRevision: baseline.document.revision, winnerRevision: winner.document.revision, memoryRevision: memory.document.revision,
      staleHistoryBackup: { snapshotName, healthyHistorySnapshots: healthyIndex.snapshots.map(snapshot => snapshot.summary.name), rejectedHistoryDownloads, currentPageBackupHashes: stalePage.hashes },
      winnerHashes: winner.hashes, memoryHashes: memory.hashes, copiedHashes: copied.hashes, targets, errors,
    }, null, 2))
  } finally { await other.close() }
})
