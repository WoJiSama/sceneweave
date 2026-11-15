// Explicit preserved inputs; normal production controls and real shared-origin IDB.
// No module imports, application state injection or native database patches in pages.
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, selectKeyboardProp } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
type Input = { input: string; target: string; outside: string; props: number }
const inputs: Record<string, Input> = process.env.SCENEWEAVE_CAS_CASES
  ? JSON.parse(readFileSync(process.env.SCENEWEAVE_CAS_CASES, 'utf8')) : {}
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const content = (document: Backup['document']) => {
  const { revision: _revision, updatedAt: _updated, ...rest } = document
  return rest
}
const copiedContent = (document: Backup['document']) => {
  const { sceneId: _id, createdAt: _created, ...rest } = content(document)
  return rest
}
const moved = (document: Backup['document'], id: string, deltaMm: number) => ({
  ...document, props: { ...document.props, [id]: { ...document.props[id],
    positionMm: { ...document.props[id].positionMm, x: document.props[id].positionMm.x + deltaMm } } },
})

async function move(page: Page, id: string, xMm: number) {
  await selectKeyboardProp(page, id)
  const field = (await openKeyboardPanel(page, 'inspector')).getByLabel('物件 X', { exact: true })
  await field.fill(String(xMm / 1000)); await field.press('Tab')
  await closeWorkspaceDrawers(page)
}
async function coldOpen(page: Page, id: string) {
  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${id}"]`)
    .getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page); await closeWorkspaceDrawers(page)
}
async function conflict(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('版本冲突')
  const recovery = page.getByRole('alert', { name: '保存恢复选项', exact: true })
  await expect(recovery).toContainText('当前编辑仍保留在此页面')
  await expect(recovery).toContainText('另一版本不会被覆盖')
  await expect(recovery.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  return recovery
}
async function picture(page: Page, audience: 'gm' | 'player', path: string) {
  await closeWorkspaceDrawers(page)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await pending).saveAs(path)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await page.locator('.workspace-export-menu > summary').click()
  const decoded = PNG.sync.read(await readFile(path))
  expect(Math.max(decoded.width, decoded.height)).toBe(4096)
  return { width: decoded.width, height: decoded.height, rgbaSha256: sha(decoded.data) }
}

for (const [key, width] of [['fantasy', 1512], ['modern', 390]] as const) test(`complete ${key} project preserves two real CAS branches and a cold editable copy at ${width}px`, async ({ page, context, browser }, info) => {
  test.skip(!inputs[key], 'Requires explicit preserved complete-project inputs')
  test.setTimeout(300000)
  const input = inputs[key], pageErrors: string[] = [], events: object[] = [], images: Record<string, unknown> = {}
  let stage = 'import'
  const watch = (target: Page) => target.on('pageerror', error => pageErrors.push(error.message))
  watch(page)
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const backup = async (target: Page, label: string) => {
    await closeWorkspaceDrawers(target)
    const result = await keyboardProjectBackup(target, info.outputPath(label + '.sceneweave'))
    events.push({ label, sceneId: result.document.sceneId, revision: result.document.revision, hashes: result.hashes })
    return result
  }
  const maps = async (target: Page, label: string) => {
    const result = { gm: await picture(target, 'gm', info.outputPath(label + '-gm.png')),
      player: await picture(target, 'player', info.outputPath(label + '-player.png')) }
    images[label] = result
    return result
  }
  const sameResources = (actual: Backup, baseline: Backup) => {
    expect(actual.identity).toEqual(baseline.identity); expect(actual.appearance).toEqual(baseline.appearance)
    expect(keyboardResourceHashes(actual.hashes)).toEqual(keyboardResourceHashes(baseline.hashes))
  }
  try {
    const response = await page.goto('./#home')
    expect(response?.ok()).toBe(true)
    if (process.env.SCENEWEAVE_TEST_BASE_URL) expect(await response!.text()).not.toContain('/@vite/client')
    await page.getByTestId('native-project-file').setInputFiles(input.input)
    await keyboardWorkspaceSaved(page)
    const initial = await backup(page, 'initial')
    expect(Object.keys(initial.document.props)).toHaveLength(input.props)
    await move(page, input.target, initial.document.props[input.target].positionMm.x + 25)
    await keyboardWorkspaceSaved(page)
    const baseline = await backup(page, 'warm-baseline')
    expect(content(baseline.document)).toEqual(content(moved(initial.document, input.target, 25)))
    expect(baseline.document.revision).toBe(initial.document.revision + 1)
    sameResources(baseline, initial)
    const baselineMaps = await maps(page, 'baseline')

    stage = 'winner'
    const other = await context.newPage(); watch(other)
    await other.setViewportSize({ width, height: width === 390 ? 844 : 982 })
    await coldOpen(other, baseline.document.sceneId)
    expect((await backup(other, 'other-baseline')).hashes).toEqual(baseline.hashes)
    // Same numeric next revision, different content: CAS must compare the old persisted baseline.
    await move(other, input.outside, baseline.document.props[input.outside].positionMm.x + 25)
    await keyboardWorkspaceSaved(other)
    const winner = await backup(other, 'winner')
    expect(winner.document.revision).toBe(baseline.document.revision + 1)
    expect(content(winner.document)).toEqual(content(moved(baseline.document, input.outside, 25)))
    sameResources(winner, baseline)
    const winnerMaps = await maps(other, 'winner')
    expect(winnerMaps.gm.rgbaSha256).not.toBe(baselineMaps.gm.rgbaSha256)
    expect((await backup(page, 'stale-before-edit')).hashes).toEqual(baseline.hashes)

    stage = 'conflict'
    await move(page, input.target, baseline.document.props[input.target].positionMm.x + 50)
    let recovery = await conflict(page)
    const memory = await backup(page, 'loser-memory')
    expect(memory.document.revision).toBe(winner.document.revision)
    expect(content(memory.document)).toEqual(content(moved(baseline.document, input.target, 50)))
    sameResources(memory, baseline)
    const download = page.waitForEvent('download')
    await recovery.getByRole('button', { name: '下载当前工程备份', exact: true }).click()
    const directPath = info.outputPath('direct-recovery.sceneweave')
    await (await download).saveAs(directPath)
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    expect(Object.fromEntries(Object.entries(unzipSync(await readFile(directPath))).map(([name, bytes]) => [name, sha(bytes)]))).toEqual(memory.hashes)
    await page.getByRole('button', { name: '回到首页', exact: true }).click()
    await expect(page.getByTestId('workspace-home')).not.toBeVisible()
    await conflict(page)
    expect((await backup(page, 'blocked-home')).hashes).toEqual(memory.hashes)

    stage = 'conflict-undo-redo'
    await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
    await conflict(page)
    const undone = await backup(page, 'loser-undone')
    expect(undone.document.revision).toBe(memory.document.revision + 1)
    expect(content(undone.document)).toEqual(content(baseline.document))
    await page.getByRole('button', { name: '重做编辑', exact: true }).click()
    await conflict(page)
    const redone = await backup(page, 'loser-redone')
    expect(redone.document.revision).toBe(undone.document.revision + 1)
    expect(content(redone.document)).toEqual(content(memory.document))
    // Further local work is retained in the blocked branch; it cannot silently rebase onto the winner.
    await move(page, input.outside, baseline.document.props[input.outside].positionMm.x + 50)
    recovery = await conflict(page)
    const continued = await backup(page, 'loser-continued')
    expect(continued.document.revision).toBe(redone.document.revision + 1)
    expect(content(continued.document)).toEqual(content(moved(redone.document, input.outside, 50)))
    sameResources(continued, baseline)
    const memoryMaps = await maps(page, 'loser')
    expect(memoryMaps.gm.rgbaSha256).not.toBe(winnerMaps.gm.rgbaSha256)
    await page.screenshot({ path: info.outputPath('conflict-recovery.png') })

    stage = 'cold-winner'
    const observer = await context.newPage(); watch(observer)
    await observer.setViewportSize({ width, height: width === 390 ? 844 : 982 })
    await coldOpen(observer, baseline.document.sceneId)
    expect((await backup(observer, 'winner-cold-before-copy')).hashes).toEqual(winner.hashes)

    stage = 'copy'
    await recovery.getByRole('button', { name: '另存副本', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    await expect(recovery).toHaveCount(0)
    const copy = await backup(page, 'copy')
    expect(copy.document.sceneId).not.toBe(baseline.document.sceneId)
    expect(copy.document.revision).toBe(0)
    expect(copiedContent(copy.document)).toEqual(copiedContent({ ...continued.document, title: continued.document.title + ' · 副本' }))
    sameResources(copy, continued)
    expect(await maps(page, 'copy')).toEqual(memoryMaps)
    expect((await backup(other, 'winner-after-copy')).hashes).toEqual(winner.hashes)
    await coldOpen(observer, baseline.document.sceneId)
    expect((await backup(observer, 'winner-cold-after-copy')).hashes).toEqual(winner.hashes)
    expect(await maps(observer, 'winner-cold')).toEqual(winnerMaps)

    stage = 'copy-cold-continuation'
    await coldOpen(page, copy.document.sceneId)
    expect((await backup(page, 'copy-cold')).hashes).toEqual(copy.hashes)
    expect(await maps(page, 'copy-cold')).toEqual(memoryMaps)
    await move(page, input.target, copy.document.props[input.target].positionMm.x + 25)
    await keyboardWorkspaceSaved(page)
    const next = await backup(page, 'copy-continued')
    expect(next.document.revision).toBe(1)
    expect(content(next.document)).toEqual(content(moved(copy.document, input.target, 25)))
    await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    const final = await backup(page, 'copy-undone')
    expect(final.document.revision).toBe(2)
    expect(content(final.document)).toEqual(content(copy.document))
    sameResources(final, copy)
    await coldOpen(observer, copy.document.sceneId)
    expect((await backup(observer, 'copy-final-cold')).hashes).toEqual(final.hashes)
    await coldOpen(other, winner.document.sceneId)
    expect((await backup(other, 'winner-final-cold')).hashes).toEqual(winner.hashes)
    await observer.goto('./#home'); await observer.reload()
    await expect(observer.getByTestId('workspace-home').locator('[data-project-key^="native:"]')).toHaveCount(2)
    expect(pageErrors).toEqual([])
    stage = 'complete'
  } finally {
    await writeFile(info.outputPath('facts.json'), JSON.stringify({ key, width, stage, browserVersion: browser.version(),
      method: 'Normal production controls; independent same-origin tabs and actual CAS, no state or database injection',
      events, images, pageErrors }, null, 2) + '\n')
  }
})
