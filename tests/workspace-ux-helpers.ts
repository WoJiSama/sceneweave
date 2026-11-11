import { expect, type Locator, type Page } from '@playwright/test'

async function closeHeaderMenu(menu: Locator): Promise<void> {
  if (await menu.getAttribute('open') !== null) await menu.locator(':scope > summary').click()
}

/** Reveal a folded form without closing it again when the caller reuses it. */
export async function openDetailsBySummary(scope: Page | Locator, name: RegExp): Promise<void> {
  const summary = scope.locator('summary').filter({ hasText: name })
  const details = summary.locator('..')
  if (await details.getAttribute('open') === null) await summary.click()
  await expect(details).toHaveAttribute('open', '')
}

/** Open the product menu through its visible summary, preserving native details behavior. */
export async function openExportMenu(page: Page): Promise<Locator> {
  await closeHeaderMenu(page.locator('details.workspace-file-menu'))
  const menu = page.locator('details.workspace-export-menu')
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
  const options = menu.getByRole('group', { name: '导出选项', exact: true })
  await expect(options).toBeVisible()
  return options
}

/** Start a new scene from the workspace's current file menu. */
export async function openNewScene(page: Page): Promise<Locator> {
  await closeHeaderMenu(page.locator('details.workspace-export-menu'))
  const menu = page.locator('details.workspace-file-menu')
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
  await menu.getByRole('button', { name: '新建空白场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

export async function projectBackupButton(page: Page): Promise<Locator> {
  return (await openExportMenu(page)).getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true })
}

export async function mapExportButton(page: Page, audience: 'gm' | 'player'): Promise<Locator> {
  return (await openExportMenu(page)).getByRole('button', { name: audience === 'gm' ? '主持人地图 PNG · 含秘密' : '玩家地图 PNG', exact: true })
}

export async function openVttExport(page: Page): Promise<void> {
  await (await openExportMenu(page)).getByRole('button', { name: 'VTT 导出', exact: true }).click()
}

export async function reloadSaved(page: Page): Promise<void> {
  await closeHeaderMenu(page.locator('details.workspace-export-menu'))
  const menu = page.locator('details.workspace-file-menu')
  const wasOpen = await menu.getAttribute('open') !== null
  if (!wasOpen) await menu.locator('summary').click()
  await menu.getByRole('button', { name: '重新载入已保存版本', exact: true }).click()
  if (!wasOpen && await menu.getAttribute('open') !== null) await menu.locator('summary').click()
}
