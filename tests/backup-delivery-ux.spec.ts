import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, placeKeyboardLamp } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSceneSettings, openWorkspaceModule } from './workspace-navigation-helpers'
import { openExportMenu, openNewScene, projectBackupButton } from './workspace-ux-helpers'

const backupStatus = (page: Page) => page.getByRole('status', { name: '工程备份状态', exact: true })

for (const size of [{ width: 1512, height: 982 }, { width: 390, height: 844 }]) {
  test(`production backup delivery distinguishes browser storage and tracks only the downloaded project at ${size.width}px`, async ({ page }, info) => {
    test.setTimeout(150_000)
    await page.setViewportSize(size)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const title = `工程备份交付 ${size.width}`
    await page.goto('./#home')
    await page.getByRole('region', { name: '保存与交付', exact: true }).screenshot({ path: info.outputPath('home-storage-guide.png') })
    await createKeyboardProject(page, title)
    const generation = await openWorkspaceModule(page, '生成')
    const settingsDisclosure = generation.locator('.workspace-generation-settings')
    await settingsDisclosure.locator(':scope > summary').click()
    await settingsDisclosure.screenshot({ path: info.outputPath('generation-settings.png') })
    await placeKeyboardLamp(page)
    await closeWorkspaceDrawers(page)
    await expect(backupStatus(page)).toHaveCount(0)

    const fileMenu = page.locator('details.workspace-file-menu')
    const fileSummary = fileMenu.locator(':scope > summary')
    await fileSummary.click()
    const fileOptions = fileMenu.getByRole('group', { name: '文件操作', exact: true })
    await expect(fileOptions).toContainText('自动保存只在此浏览器、此站点')
    await expect(fileOptions).toContainText('不包含尚未采用的草稿')
    await expect(fileOptions.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('file-storage-and-backup.png') })
    await fileSummary.focus()
    await page.keyboard.press('Escape')
    await expect(fileMenu).not.toHaveAttribute('open', '')
    await expect(fileSummary).toBeFocused()

    const exports = await openExportMenu(page)
    await expect(exports).toContainText('可编辑工程需下载 .sceneweave 备份')
    await expect(exports).toContainText('自动保存只在此浏览器，不会下载文件')
    for (const name of ['玩家地图 PNG', '主持人地图 PNG · 含秘密', '备份可编辑工程 · 含秘密']) {
      const button = exports.getByRole('button', { name, exact: true })
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeVisible()
      await expect(button).toBeEnabled()
      await expect(button).toBeInViewport()
    }
    await page.screenshot({ path: info.outputPath('delivery-menu.png') })
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
    expect(dimensions.root).toBeLessThanOrEqual(dimensions.viewport)
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport)

    // The existing helper clicks the normal menu, saves the real download and
    // reads its complete-project archive; no export data or storage is injected.
    const path = info.outputPath('complete-editable-project.sceneweave')
    const backup = await keyboardProjectBackup(page, path)
    expect(backup.document.title).toBe(title)
    expect(Object.keys(backup.document.props)).toHaveLength(1)
    const files = unzipSync(new Uint8Array(await readFile(path)))
    const assets = Object.entries(files).filter(([name]) => name.startsWith('assets/'))
    const licenses = Object.entries(files).filter(([name]) => name.startsWith('licenses/'))
    expect(assets.length).toBeGreaterThan(0)
    expect(licenses.length).toBeGreaterThan(0)
    for (const [, bytes] of [...assets, ...licenses]) expect(bytes.byteLength).toBeGreaterThan(0)
    for (const [name] of [...assets, ...licenses]) {
      // Archive resource names carry the SHA256 of the actual included bytes.
      expect(name).toContain(backup.hashes[name])
    }
    await expect(backupStatus(page)).toContainText('已发起此工程的文件下载')
    await expect(backupStatus(page)).toContainText('含全部资源、许可和秘密')
    await expect(backupStatus(page)).toContainText('页面无法确认文件已写入磁盘')
    await page.screenshot({ path: info.outputPath('download-started.png') })

    const settings = await openSceneSettings(page)
    await settings.getByLabel('工程名称', { exact: true }).and(settings.locator('input:enabled')).fill(`${title} 后续修改`)
    await settings.getByRole('button', { name: '保存名称', exact: true }).and(settings.locator('button:enabled')).click()
    await keyboardWorkspaceSaved(page)
    await closeWorkspaceDrawers(page)
    await expect(backupStatus(page)).toContainText('工程在发起下载后已有变化')
    await expect(backupStatus(page)).toContainText('上次下载不包含后续修改')
    expect(backup.document.title).toBe(title)
    await page.screenshot({ path: info.outputPath('backup-behind-current-edit.png') })

    // Switch through the real File entry in this workspace, keeping its backup
    // feedback state alive so a different scene cannot inherit the old claim.
    const nextTitle = `另一份工程 ${size.width}`
    const dialog = await openNewScene(page)
    await dialog.getByLabel('场景名称', { exact: true }).fill(nextTitle)
    await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 60_000 })
    await keyboardWorkspaceSaved(page)
    await expect(page.getByRole('heading', { name: nextTitle, level: 1, exact: true })).toBeVisible()
    await expect(backupStatus(page)).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('production backup download setup failure reports no download and permits an explicit retry', async ({ page }, info) => {
  test.setTimeout(120_000)
  await createKeyboardProject(page, '备份下载失败保留工程')
  const originalRevision = await page.locator('.workspace-unified').getAttribute('data-revision')
  const downloads: string[] = []
  page.on('download', value => downloads.push(value.suggestedFilename()))
  // Fail only construction of the final archive download URL, after the real
  // complete-project export. Native data, validation and IndexedDB stay intact.
  await page.evaluate(() => {
    const original = URL.createObjectURL
    const state = { hits: 0 }
    URL.createObjectURL = function (object: Blob | MediaSource) {
      if (object instanceof Blob && object.type === 'application/octet-stream') {
        state.hits++
        throw new Error('备份下载定向失败')
      }
      return original.call(URL, object)
    }
    Reflect.set(window, '__backupDownloadFault', { state, restore: () => { URL.createObjectURL = original } })
  })
  try {
    await (await projectBackupButton(page)).click()
    await expect(backupStatus(page)).toContainText('备份生成失败，尚未发起本次文件下载。')
    await expect(backupStatus(page)).toContainText('备份下载定向失败')
    await expect(backupStatus(page)).not.toContainText('已发起此工程的文件下载')
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    await expect(page.getByText(/备份下载定向失败/)).toHaveCount(1)
    expect(await page.evaluate(() => Reflect.get(window, '__backupDownloadFault').state.hits)).toBe(1)
    expect(downloads).toEqual([])
    await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', originalRevision!)
    await page.screenshot({ path: info.outputPath('backup-download-failed.png') })
  } finally {
    await page.evaluate(() => Reflect.get(window, '__backupDownloadFault').restore())
  }
  const retry = await keyboardProjectBackup(page, info.outputPath('retry-complete-project.sceneweave'))
  expect(retry.document.title).toBe('备份下载失败保留工程')
  expect(downloads).toHaveLength(1)
  await expect(backupStatus(page)).toContainText('已发起此工程的文件下载')
  await expect(backupStatus(page)).not.toContainText('备份生成失败')
})
