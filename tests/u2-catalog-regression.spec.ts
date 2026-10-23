import { expect, test, type Page } from '@playwright/test'
import type { WorkspaceV6 } from '../src/editor/v6/workspace'

test('U2 private fixed template and real derived bytes survive complete library backup, empty-library offline restore and 4K audience output', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  await page.goto('/')
  const packed = await page.evaluate(async () => {
    const path = '/tests/helpers/u2-catalog-regression-browser.ts'
    const helper = await import(path) as typeof import('./helpers/u2-catalog-regression-browser')
    return helper.createU2PrivateLibraryBackup()
  })
  expect(packed.item.visibility).toBe('gm'); expect(packed.sourceUnchanged).toBe(true); expect(packed.capsuleHasNoMap).toBe(true)
  expect(packed.capsuleTitle).toBe('素材目录载体'); expect(packed.installedRevision).toBe(1)
  expect(Object.keys(packed.closure.assets)).toHaveLength(2); expect(Object.keys(packed.closure.variants)).toHaveLength(1)
  for (const [hash, record] of Object.entries(packed.closure.assets)) { expect(record.actualHash).toBe(hash); expect(record.sha256).toBe(hash); expect(record.dimensions).toEqual([8, 8]) }
  expect(Object.values(packed.closure.assets).map(record => record.opaquePixel)).toEqual(expect.arrayContaining([[200, 100, 50, 255], [100, 50, 25, 255]]))
  for (const [hash, record] of Object.entries(packed.closure.licenses)) expect(record.actualHash).toBe(hash)
  const context = await browser.newContext()
  try {
    const fresh = await context.newPage(); await fresh.goto('/')
    await fresh.evaluate(async () => { const path = '/tests/helpers/u2-catalog-regression-browser.ts'; await import(path) })
    await context.setOffline(true)
    const result = await fresh.evaluate(async input => {
      const path = '/tests/helpers/u2-catalog-regression-browser.ts'
      const helper = await import(path) as typeof import('./helpers/u2-catalog-regression-browser')
      return helper.restoreU2PrivateLibraryOffline(input)
    }, { bytes: packed.bytes, key: packed.key })
    expect(result.initiallyEmpty).toBe(true); expect(result.installedCount).toBe(1); expect(result.organization).toEqual(packed.organization)
    expect(result.closure).toEqual(packed.closure); expect(result.adoptionPreviewUnchanged).toBe(true); expect(result.adoptedRevision).toBe(1)
    expect(result.missingMaskError).toMatch(/玩家输出不安全|遮罩/); expect(result.rejectedWithoutMutation).toBe(true)
    expect(result.placementPreviewUnchanged).toBe(true); expect(result.groupVisibility).toBe('gm'); expect(result.memberVisibility).toBe('gm'); expect(result.playerContainsMember).toBe(false)
    expect(result.sourceChainDepth).toBeGreaterThanOrEqual(2)
    expect(result.baseline.player.rgbaHash).toBe(result.output.player.rgbaHash)
    expect(result.baseline.gm.rgbaHash).not.toBe(result.output.gm.rgbaHash)
    expect(result.output.gm.rgbaHash).not.toBe(result.output.player.rgbaHash)
    for (const output of [result.baseline.gm, result.baseline.player, result.output.gm, result.output.player]) {
      expect([output.width, output.height]).toEqual([4096, 4096]); expect(output.metadata).toEqual([])
    }
    expect(result.undoPreservesMaskAndAdoption).toBe(true); expect(result.finalRevision).toBe(result.placedRevision + 2)
    expect(result.redoRetainsPixels).toBe(true); expect(result.reopenExact).toBe(true); expect(result.reopenVisibility).toBe('gm')
    await info.attach('u2-private-restored-gm-4k.png', { body: Buffer.from(result.output.gm.url.split(',')[1], 'base64'), contentType: 'image/png' })
    await info.attach('u2-private-restored-player-4k.png', { body: Buffer.from(result.output.player.url.split(',')[1], 'base64'), contentType: 'image/png' })
    const pngSummary = ({ url: _url, ...value }: typeof result.output.gm) => value
    const { bytes: _bytes, ...source } = packed
    await info.attach('u2-private-library-offline-4k.json', { body: JSON.stringify({ method: 'Real browser Canvas PNG and brightness output, independent native library stores, complete portable backup transferred to a new browser context. Modules load before offline mode; this is not PWA cold start. Workspace adoption and placement use ordinary validated candidates; PNGs are native 4096px exports.', source,
      ...result, baseline: { gm: pngSummary(result.baseline.gm), player: pngSummary(result.baseline.player) }, output: { gm: pngSummary(result.output.gm), player: pngSummary(result.output.player) } }, null, 2), contentType: 'application/json' })
  } finally { await context.close() }
})

const library = (page: Page) => page.getByRole('region', { name: '组件素材库', exact: true })
async function createBlank(page: Page, title: string) {
  await page.goto('/#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title); await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0); await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
  await expect(library(page)).toHaveAttribute('aria-busy', 'false')
  await expect(library(page).getByRole('button', { name: '刷新素材库', exact: true })).toBeEnabled()
  await library(page).getByRole('button', { name: '本工程', exact: true }).click()
}
async function beginOrganization(page: Page, name: string, tags: string) {
  const lib = library(page)
  await lib.getByLabel('搜索组件素材', { exact: true }).fill(name)
  await lib.getByLabel(`选择素材 ${name}`, { exact: true }).check()
  await lib.getByRole('button', { name: '整理所选', exact: true }).click()
  await lib.getByLabel('个人素材标签', { exact: true }).fill(tags)
}
async function projectState(page: Page) {
  return page.evaluate(() => {
    const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: WorkspaceV6 }).workspace
    const state = workspace.getState(), project = state.project!
    return { sceneId: project.document.sceneId, document: structuredClone(project.document), identity: structuredClone(project.historyIdentity), appearance: structuredClone(project.appearance), canUndo: state.canUndo, canRedo: state.canRedo }
  })
}

test('U2 two real pages retain a stale personal-organization draft across catalog CAS conflict and refresh before explicit save', async ({ page, context }, info) => {
  test.setTimeout(120_000)
  await createBlank(page, 'U2 CAS 页面甲')
  const other = await context.newPage()
  try {
    await createBlank(other, 'U2 CAS 页面乙')
    const beforeA = await projectState(page), beforeB = await projectState(other)
    await beginOrganization(page, '铜色桌灯', '甲页未保存草稿')
    await beginOrganization(other, '深橡木书桌', '乙页已保存记录')
    await library(other).getByRole('button', { name: '保存这1项整理', exact: true }).click()
    await expect(library(other).getByRole('form', { name: '个人素材整理草稿', exact: true })).toHaveCount(0)
    await library(page).getByRole('button', { name: '保存这1项整理', exact: true }).click()
    await expect(library(page)).toContainText('素材库已在其他标签更新')
    await expect(library(page).getByLabel('个人素材标签', { exact: true })).toHaveValue('甲页未保存草稿')
    await library(page).getByRole('button', { name: '刷新基线（保留草稿）', exact: true }).click()
    await expect(library(page)).toContainText('已刷新库基线，保留输入草稿')
    await expect(library(page).getByLabel('个人素材标签', { exact: true })).toHaveValue('甲页未保存草稿')
    await library(page).getByRole('button', { name: '保存这1项整理', exact: true }).click()
    await expect(library(page).getByRole('form', { name: '个人素材整理草稿', exact: true })).toHaveCount(0)
    const catalog = await page.evaluate(async () => {
      const path = '/src/catalog/repository.ts', { CatalogRepositoryV1 } = await import(path) as typeof import('../src/catalog/repository')
      const repository = new CatalogRepositoryV1()
      try { return await repository.read() } finally { repository.close() }
    })
    expect(catalog.revision).toBe(2); expect(catalog.entries).toHaveLength(0)
    expect(Object.values(catalog.organizations).map(value => value.tags)).toEqual(expect.arrayContaining([['甲页未保存草稿'], ['乙页已保存记录']]))
    expect(Object.keys(catalog.organizations)).toHaveLength(2)
    expect(await projectState(page)).toEqual(beforeA); expect(await projectState(other)).toEqual(beforeB)
    await info.attach('u2-two-page-cas-draft.json', { body: JSON.stringify({ method: 'Two live same-origin pages, independent actual catalog connections and public UI edits. First save wins; stale save fails, refresh retains the draft, explicit second save preserves the other key and both projects.', revision: catalog.revision, organizations: catalog.organizations, projectA: beforeA.sceneId, projectB: beforeB.sceneId, projectsAndUndoUnchanged: true }, null, 2), contentType: 'application/json' })
  } finally { await other.close() }
})
