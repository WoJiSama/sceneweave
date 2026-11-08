// Normal production UI; native API failures do not inject project data.
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import {
  createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved,
  openKeyboardPanel, placeKeyboardLamp, selectKeyboardProp,
} from './keyboard-ux-helpers'

type FaultHit = { kind: 'history-read' | 'protection-add'; store: string; name: string }
type FaultState = { failRead: number; failProtection: number; historyReads: number; hits: FaultHit[] }
const faultKey = '__sceneweaveHistoryUxFault'

async function installNativeFaults(page: Page): Promise<void> {
  await page.addInitScript(key => {
    const state: FaultState = { failRead: 0, failProtection: 0, historyReads: 0, hits: [] }
    Reflect.set(window, key, state)
    const nativeGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (query: IDBValidKey | IDBKeyRange) {
      if (this.name === 'historyHeads') {
        state.historyReads++
        if (state.failRead > 0) {
          state.failRead--
          state.hits.push({ kind: 'history-read', store: this.name, name: 'UnknownError' })
          throw new DOMException('测试：历史读取暂时不可用', 'UnknownError')
        }
      }
      return nativeGet.call(this, query)
    }
    const nativeAdd = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'historyPins' && value && typeof value === 'object'
        && Reflect.get(value, 'kind') === 'protection' && state.failProtection > 0) {
        state.failProtection--
        state.hits.push({ kind: 'protection-add', store: this.name, name: 'QuotaExceededError' })
        // Throw inside the real Dexie write transaction. Its native transaction
        // must abort; do not manufacture a successful IDBRequest or mutate rows.
        throw new DOMException('测试：保护点保存空间不足', 'QuotaExceededError')
      }
      return key === undefined ? nativeAdd.call(this, value) : nativeAdd.call(this, value, key)
    }
  }, faultKey)
}

async function faults(page: Page): Promise<FaultState> {
  return page.evaluate(key => Reflect.get(window, key) as FaultState, faultKey)
}

async function armFault(page: Page, kind: 'read' | 'protection'): Promise<void> {
  await page.evaluate(({ key, kind }) => {
    const state = Reflect.get(window, key) as FaultState
    if (kind === 'read') state.failRead = 1
    else state.failProtection = 1
  }, { key: faultKey, kind })
}

async function closeDrawers(page: Page): Promise<void> {
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') !== 'true') return
  for (const [id, name] of [['resources', '内容面板'], ['inspector', '当前详情']] as const) {
    const panel = page.getByTestId(`workspace-${id}`)
    if (await panel.getAttribute('data-open') !== 'true') continue
    await panel.getByRole('button', { name: `关闭${name}`, exact: true }).click()
    await expect(panel).toHaveAttribute('data-open', 'false')
  }
}

async function openHistory(page: Page) {
  const navigation = await openWorkspaceModule(page, '历史')
  const panel = navigation.getByRole('region', { name: '命名历史', exact: true })
  await expect(panel).toBeVisible()
  await expect(panel.getByLabel('完整保存版本', { exact: true })).toBeEnabled()
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  return panel
}

async function createNamedSnapshot(page: Page, name: string): Promise<void> {
  const history = await openHistory(page)
  await history.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await history.getByLabel('命名快照名称', { exact: true }).fill(name)
  await history.getByRole('button', { name: '保存快照', exact: true }).click()
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await openWorkspaceModule(page, '历史')
  await expect(history.getByRole('button', { name: `查看快照 ${name}`, exact: true })).toBeVisible()
}

async function inspectProp(page: Page, id: string) {
  await selectKeyboardProp(page, id)
  await closeDrawers(page)
  return openKeyboardPanel(page, 'inspector')
}

async function moveProp(page: Page, id: string, metres: string): Promise<void> {
  const inspector = await inspectProp(page, id)
  const x = inspector.getByLabel('物件 X', { exact: true })
  await x.fill(metres); await x.press('Tab')
  await keyboardWorkspaceSaved(page)
}

async function setPropLock(page: Page, id: string, locked: boolean): Promise<void> {
  const inspector = await inspectProp(page, id)
  await inspector.getByRole('button', { name: locked ? '锁定物件编辑' : '解除物件编辑锁', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

async function setLayerLock(page: Page, name: string, locked: boolean): Promise<void> {
  const navigation = await openWorkspaceModule(page, '场景')
  await navigation.getByRole('button', { name: `${locked ? '锁定' : '解锁'}图层 ${name}`, exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

async function selectTransformRestore(page: Page, name: string, id: string) {
  const history = await openHistory(page)
  await history.getByRole('button', { name: `查看快照 ${name}`, exact: true }).click()
  const inspector = await openKeyboardPanel(page, 'inspector')
  const details = inspector.getByRole('region', { name: '历史详情', exact: true, includeHidden: true })
  await expect(details).toBeVisible()
  await details.getByLabel('恢复对象类型', { exact: true }).selectOption('props')
  await details.getByLabel('局部恢复模式', { exact: true }).selectOption('transform')
  await details.getByLabel('搜索历史物件', { exact: true }).fill('铜色桌灯')
  await details.getByLabel(`恢复物件 ${id}`, { exact: true }).check()
  await expect(details.getByLabel(`恢复物件 ${id}`, { exact: true })).toBeChecked()
  return { history, details }
}

async function previewTransformRestore(page: Page, name: string, id: string): Promise<void> {
  const { details } = await selectTransformRestore(page, name, id)
  await details.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
}

async function backup(page: Page, info: TestInfo, name: string) {
  await closeDrawers(page)
  return keyboardProjectBackup(page, info.outputPath(`${name}.sceneweave`))
}

async function cancelRestore(page: Page): Promise<void> {
  await openKeyboardPanel(page, 'inspector')
  const candidate = page.getByRole('status', { name: '局部恢复候选', exact: true })
  await candidate.getByRole('button', { name: '取消局部恢复', exact: true }).click()
  await expect(candidate).toHaveCount(0)
}

async function adoptRestore(page: Page): Promise<void> {
  await openKeyboardPanel(page, 'inspector')
  const candidate = page.getByRole('status', { name: '局部恢复候选', exact: true })
  await candidate.getByLabel('确认恢复完整影响范围', { exact: true }).check()
  await candidate.getByRole('button', { name: '保护当前并采用', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
}

async function writeFacts(info: TestInfo, value: unknown): Promise<void> {
  const path = info.outputPath('history-recovery-facts.json')
  await writeFile(path, JSON.stringify(value, null, 2))
  await info.attach('history-recovery-facts.json', { path, contentType: 'application/json' })
}

for (const size of [{ width: 1512, height: 982 }, { width: 390, height: 844 }]) {
  test(`production history read retry, readable lock refusal and protection failure recovery at ${size.width}px`, async ({ page, browser }, info) => {
    test.setTimeout(240_000)
    await installNativeFaults(page)
    await page.setViewportSize(size)
    const errors: string[] = [], facts: unknown[] = []
    page.on('pageerror', error => errors.push(error.message))
    await createKeyboardProject(page, `历史失败恢复 ${size.width}`)
    await placeKeyboardLamp(page)
    const original = await backup(page, info, 'history-original')
    const [prop] = Object.values(original.document.props)
    expect(Object.keys(original.document.props)).toHaveLength(1)
    expect(prop.positionMm).toEqual({ x: 4000, y: 4000 })
    const layerId = original.document.entityLayers[prop.id]
    const layerName = original.document.userLayers[layerId].name
    const snapshotName = '位置基线'
    await createNamedSnapshot(page, snapshotName)
    await moveProp(page, prop.id, '6')
    const tip = await backup(page, info, 'history-tip')
    expect(tip.document.props[prop.id].positionMm).toEqual({ x: 6000, y: 4000 })
    const revision = page.locator('.workspace-unified')
    const undo = page.getByRole('button', { name: '撤销编辑', exact: true })

    // 1. A failed explicit refresh must retain the actual old list and scope.
    const { history, details } = await selectTransformRestore(page, snapshotName, prop.id)
    await openWorkspaceModule(page, '历史')
    const beforeRead = await faults(page)
    await armFault(page, 'read')
    await history.getByRole('button', { name: '刷新历史', exact: true }).click()
    // Prove the real historyHeads.get failure fired before checking its UI.
    // A changed storage route must fail here, rather than masquerade as a UI race.
    await expect.poll(async () => (await faults(page)).hits.filter(hit => hit.kind === 'history-read').length).toBe(beforeRead.hits.filter(hit => hit.kind === 'history-read').length + 1)
    const readFailure = history.locator('[role="alert"]').filter({ hasText: '历史刷新失败，下面保留上次读取的记录。' })
    // This strict assertion may expose a refreshBlocked/onAction ticket race:
    // busy=true must not invalidate the refresh that the user just requested.
    await expect(readFailure).toBeVisible()
    await expect(history).toHaveAttribute('aria-busy', 'false')
    await expect(history.getByRole('button', { name: `查看快照 ${snapshotName}`, exact: true })).toBeVisible()
    await expect(history.getByText('暂无命名快照', { exact: true })).toHaveCount(0)
    await expect(details.getByLabel('搜索历史物件', { exact: true })).toHaveValue('铜色桌灯')
    await expect(details.getByLabel(`恢复物件 ${prop.id}`, { exact: true })).toBeChecked()
    await expect(revision).toHaveAttribute('data-revision', String(tip.document.revision))
    expect((await faults(page)).hits.filter(hit => hit.kind === 'history-read')).toHaveLength(beforeRead.hits.filter(hit => hit.kind === 'history-read').length + 1)
    await history.getByRole('button', { name: '重试读取历史', exact: true }).click()
    await expect(readFailure).toHaveCount(0)
    await expect(history.getByLabel('完整保存版本', { exact: true })).toBeEnabled()
    await expect(details.getByLabel('搜索历史物件', { exact: true })).toHaveValue('铜色桌灯')
    await expect(details.getByLabel(`恢复物件 ${prop.id}`, { exact: true })).toBeChecked()
    expect((await backup(page, info, 'history-read-recovered')).hashes).toEqual(tip.hashes)
    facts.push({ step: 'history read failure and explicit retry', faults: await faults(page), revision: tip.document.revision })

    // 2. Both entity and actual containing-layer locks need actionable labels.
    // These are deliberately red on the existing raw-ID-only error messages.
    for (const kind of ['entity', 'layer'] as const) {
      if (kind === 'entity') await setPropLock(page, prop.id, true)
      else await setLayerLock(page, layerName, true)
      const locked = await backup(page, info, `history-${kind}-locked`)
      const undoBefore = await undo.isEnabled()
      await previewTransformRestore(page, snapshotName, prop.id)
      await expect(page.locator('.asset-busy')).toHaveCount(0)
      await closeDrawers(page)
      const notice = page.locator('.asset-notice[role="alert"]')
      await expect(notice).toBeVisible()
      await expect(notice).toContainText(kind === 'entity' ? '铜色桌灯' : layerName)
      await expect(notice).toContainText(/解除|解锁/)
      await expect(notice).toContainText(/重新预览|重试/)
      await expect(notice).not.toContainText(prop.id)
      await expect(page.getByRole('status', { name: '局部恢复候选', exact: true })).toHaveCount(0)
      await expect(revision).toHaveAttribute('data-revision', String(locked.document.revision))
      expect(await undo.isEnabled()).toBe(undoBefore)
      await page.screenshot({ path: info.outputPath(`history-${kind}-lock-refusal.png`) })
      const lockedHashes = (await backup(page, info, `history-${kind}-refused`)).hashes
      expect(lockedHashes).toEqual(locked.hashes)
      if (kind === 'entity') await setPropLock(page, prop.id, false)
      else await setLayerLock(page, layerName, false)
      const unlocked = await backup(page, info, `history-${kind}-unlocked`)
      await previewTransformRestore(page, snapshotName, prop.id)
      await expect(page.getByRole('status', { name: '局部恢复候选', exact: true })).toBeVisible()
      await cancelRestore(page)
      expect((await backup(page, info, `history-${kind}-cancelled`)).hashes).toEqual(unlocked.hashes)
      facts.push({ step: `${kind} lock refusal and explicit unlock`, lockedRevision: locked.document.revision, unlockedRevision: unlocked.document.revision, lockedHashes })
    }

    // 3. Fail precisely the protection pin add. The real transaction must roll
    // back, leaving no adoption and no new protection point. Explicitly retry.
    const current = await backup(page, info, 'history-before-protection')
    const undoBefore = await undo.isEnabled()
    await previewTransformRestore(page, snapshotName, prop.id)
    await expect(page.getByRole('status', { name: '局部恢复候选', exact: true })).toBeVisible()
    await closeDrawers(page)
    const beforeProtection = await faults(page)
    await armFault(page, 'protection')
    await adoptRestore(page)
    await expect(page.locator('.asset-notice[role="alert"]')).toContainText('保护点保存空间不足')
    await expect(revision).toHaveAttribute('data-revision', String(current.document.revision))
    expect(await undo.isEnabled()).toBe(undoBefore)
    await keyboardWorkspaceSaved(page)
    const historyAfterFailure = await openHistory(page)
    await expect(historyAfterFailure.getByLabel('保护快照列表', { exact: true }).locator('.history-snapshot-row')).toHaveCount(0)
    expect((await faults(page)).hits.filter(hit => hit.kind === 'protection-add')).toHaveLength(beforeProtection.hits.filter(hit => hit.kind === 'protection-add').length + 1)
    expect((await backup(page, info, 'history-protection-failed')).hashes).toEqual(current.hashes)

    await previewTransformRestore(page, snapshotName, prop.id)
    await expect(page.getByRole('status', { name: '局部恢复候选', exact: true })).toBeVisible()
    await adoptRestore(page)
    await expect(revision).toHaveAttribute('data-revision', String(current.document.revision + 1))
    await keyboardWorkspaceSaved(page)
    const restored = await backup(page, info, 'history-restored')
    expect(restored.document.props).toEqual(original.document.props)
    expect(keyboardResourceHashes(restored.hashes)).toEqual(keyboardResourceHashes(current.hashes))
    const historyAfterSuccess = await openHistory(page)
    await expect(historyAfterSuccess.getByLabel('保护快照列表', { exact: true }).locator('.history-snapshot-row')).toHaveCount(1)
    await closeDrawers(page)
    await undo.click()
    await expect(revision).toHaveAttribute('data-revision', String(restored.document.revision + 1))
    await keyboardWorkspaceSaved(page)
    const undone = await backup(page, info, 'history-undone')
    expect(undone.document.props).toEqual(current.document.props)
    expect(undone.document.userLayers).toEqual(current.document.userLayers)
    const faultFacts = await faults(page)

    // A full reload discards the in-memory workspace and uses the normal recent
    // project open. The injected fault state resets; no fault is armed on reload.
    await page.reload()
    await expect(page.locator('.asset-save')).toHaveText('尚未打开工程')
    await page.getByRole('button', { name: '回到首页', exact: true }).click()
    await page.getByTestId('workspace-home').locator(`[data-project-key="native:${current.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    const cold = await backup(page, info, 'history-cold')
    expect(cold.hashes).toEqual(undone.hashes)
    expect(cold.document).toEqual(undone.document)
    expect(errors).toEqual([])
    await writeFacts(info, { size, browserVersion: browser.version(), snapshotName, propId: prop.id, layerId, layerName,
      facts, faultFacts, revisions: { original: original.document.revision, tip: tip.document.revision, beforeProtection: current.document.revision,
        restored: restored.document.revision, undone: undone.document.revision, cold: cold.document.revision },
      hashes: { original: original.hashes, current: current.hashes, restored: restored.hashes, undone: undone.hashes, cold: cold.hashes }, errors,
      excluded: ['entire-version restore failure matrix', 'stale or deleted source in another tab', 'building continuity expiry', 'all support and cross-layer dependencies', 'screen reader and visual P3'] })
  })
}
