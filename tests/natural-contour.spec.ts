import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { visualBase } from '../src/shared/visual/base'
import { validateHistoryIdentity } from '../src/shared/history/identity'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSamples, openVisualTask } from './workspace-navigation-helpers'
import { projectBackupButton } from './workspace-ux-helpers'

type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
const shoreIds = ['beach-sand', 'beach-water'] as const

function expectIdentityAdvance(before: Backup, after: Backup) {
  const { outdoorTokens: previous, ...outsideBefore } = before.identity
  const { outdoorTokens: next, ...outsideAfter } = after.identity
  expect(outsideAfter).toEqual(outsideBefore)
  const shoreMembers = new Set<string>(shoreIds)
  const liveBefore = new Set<string>(), liveAfter = new Set<string>()
  for (const [backup, live] of [[before, liveBefore], [after, liveAfter]] as const) for (const id of shoreIds) {
    live.add(id)
    for (const point of backup.document.terrainAreas[id].boundaryMm) {
      shoreMembers.add(point.id); shoreMembers.add(point.segmentId)
      live.add(point.id); live.add(point.segmentId)
    }
  }
  for (const [id, record] of Object.entries(previous)) {
    expect(next[id]?.token, `${id} birth`).toBe(record.token)
    expect(next[id]?.kind, `${id} kind`).toBe(record.kind)
    if (shoreIds.includes(id as typeof shoreIds[number])) {
      expect(next[id].topologyToken, `${id} topology advances`).not.toBe(record.topologyToken)
    } else if (shoreMembers.has(id) && !liveBefore.has(id) && liveAfter.has(id)) {
      expect(next[id].topologyToken, `${id} resurrection advances topology`).not.toBe(record.topologyToken)
      expect(next[id].topologyHash, `${id} restored topology shape`).toBe(record.topologyHash)
    } else expect(next[id], `${id} unchanged identity`).toEqual(record)
  }
  expect(() => validateHistoryIdentity(after.identity, after.document)).not.toThrow()
}

function unchangedScope(document: Backup['document']) {
  const { visual: _visual, revision: _revision, updatedAt: _updatedAt, terrainAreas: _terrain, ...rest } = document
  const visual = visualBase(document)
  return {
    rest,
    boundaries: Object.fromEntries(Object.entries(visual?.boundaries ?? {}).filter(([id]) => id !== 'beach-coast')),
    environment: visual?.environment, lights: visual?.lights, fogs: visual?.fogs, filters: visual?.filters,
    edgeLooks: Object.values(visual?.edgeLooks ?? {}).filter(edge => edge.boundaryId !== 'beach-coast'),
    surfaces: Object.fromEntries(Object.entries(document.terrainAreas).map(([id, area]) => {
      const { boundaryMm: _boundary, ...surface } = area
      return [id, surface]
    })),
  }
}

async function openSample(page: Page) {
  await page.goto('/#workspace'); await openSamples(page)
  await page.getByRole('button', { name: '潮声浅湾 · 连续海岸', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
  await expect(dialog).toBeVisible({ timeout: 45_000 })
  await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(dialog).toHaveCount(0); await keyboardWorkspaceSaved(page)
}

test('production natural contour uses ordinary backup evidence for draft, geometry, one undo-redo and cold reopen', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const backup = (name: string) => keyboardProjectBackup(page, info.outputPath(`${name}.sceneweave`))
  await openSample(page)
  const before = await backup('before'), original = visualBase(before.document)!.boundaries['beach-coast']
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
  const panel = await openVisualTask(page, '边界')
  await panel.getByLabel('视觉已有曲线', { exact: true }).selectOption('beach-coast')
  await panel.locator('summary').filter({ hasText: /^柔和转弯与自然起伏$/ }).click()
  await panel.getByLabel('视觉轮廓柔和强度', { exact: true }).fill('0.5')
  await panel.getByRole('button', { name: '柔和转弯草稿', exact: true }).click()
  await panel.getByRole('button', { name: '自然起伏草稿', exact: true }).click()
  const draft = await backup('draft')
  expect(draft.hashes).toEqual(before.hashes)
  await panel.getByRole('button', { name: '预览曲线与边带', exact: true }).click()
  const candidate = page.locator('.asset-structure-preview')
  await expect(candidate).toContainText('候选预览', { timeout: 30_000 })
  const impact = await candidate.getByLabel('待采用视觉操作 ID', { exact: true }).inputValue()
  for (const id of ['beach-coast', 'beach-sand', 'beach-water']) expect(impact).toContain(id)
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-revision', String(before.document.revision))
  await expect(await projectBackupButton(page)).toBeDisabled()
  await page.locator('.workspace-export-menu > summary').click()
  await page.screenshot({ path: info.outputPath('natural-contour-preview.png') })
  await candidate.getByRole('button', { name: '取消视觉预览', exact: true }).click()
  await expect(candidate).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const cancelled = await backup('preview-cancelled')
  expect(cancelled.hashes).toEqual(before.hashes)

  await panel.getByRole('button', { name: '预览曲线与边带', exact: true }).click()
  await expect(candidate).toContainText('候选预览', { timeout: 30_000 })
  await expect(candidate.getByRole('button', { name: '采用视觉修改', exact: true })).toBeDisabled()
  await candidate.getByLabel('确认完整影响范围', { exact: true }).check()
  await candidate.getByRole('button', { name: '采用视觉修改', exact: true }).click()
  await expect(candidate).toHaveCount(0); await keyboardWorkspaceSaved(page)
  const adopted = await backup('adopted'), changed = visualBase(adopted.document)!.boundaries['beach-coast']
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  expect(changed.segments).not.toEqual(original.segments)
  expect(changed.binding).toEqual(original.binding)
  expect(changed.segments.map(segment => [segment.id, segment.start, segment.end]))
    .toEqual(original.segments.map(segment => [segment.id, segment.start, segment.end]))
  for (const id of shoreIds) expect(adopted.document.terrainAreas[id].boundaryMm).not.toEqual(before.document.terrainAreas[id].boundaryMm)
  expect(unchangedScope(adopted.document)).toEqual(unchangedScope(before.document))
  expectIdentityAdvance(before, adopted)
  expect(Object.keys(adopted.identity.outdoorTokens).length).toBeGreaterThan(Object.keys(before.identity.outdoorTokens).length)
  expect(adopted.appearance).toEqual(before.appearance)
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await backup('undone')
  expect(undone.document.revision).toBe(adopted.document.revision + 1)
  expect(undone.document.visual).toEqual(before.document.visual)
  expect(undone.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect(unchangedScope(undone.document)).toEqual(unchangedScope(before.document))
  expectIdentityAdvance(adopted, undone)
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const redone = await backup('redone')
  expect(redone.document.revision).toBe(undone.document.revision + 1)
  expect(redone.document.visual).toEqual(adopted.document.visual)
  expect(redone.document.terrainAreas).toEqual(adopted.document.terrainAreas)
  expectIdentityAdvance(undone, redone)
  for (const id of shoreIds) {
    expect(redone.identity.outdoorTokens[id].topologyHash).toBe(adopted.identity.outdoorTokens[id].topologyHash)
    expect(redone.identity.outdoorTokens[id].topologyToken).not.toBe(adopted.identity.outdoorTokens[id].topologyToken)
  }
  expect(redone.appearance).toEqual(adopted.appearance)
  expect(keyboardResourceHashes(redone.hashes)).toEqual(keyboardResourceHashes(before.hashes))

  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${redone.document.sceneId}"]`)
    .getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await backup('cold')
  expect(cold.hashes).toEqual(redone.hashes)
  expect(cold.document.terrainAreas).toEqual(adopted.document.terrainAreas)
  expect(visualBase(cold.document)!.boundaries['beach-coast']).toEqual(changed)
  await page.screenshot({ path: info.outputPath('natural-contour-cold.png') })
  expect(errors).toEqual([])
  await writeFile(info.outputPath('result.json'), JSON.stringify({
    passed: true, formalAcceptance: false, ordinaryUI: true, source: 'normal complete-project downloads',
    draftArchiveUnchanged: true, cancelledPreviewArchiveUnchanged: true,
    realGeometryChanged: shoreIds, outsideScopePreserved: true, originalBirthsPreserved: true,
    topologyAdvancesOnAdoptUndoRedo: true, sampledPointAndSegmentIdentitiesValidated: true,
    appearanceAndResourcesPreserved: true, undoRedoOnce: true, coldExactArchiveEntries: true,
    revisions: [before.document.revision, adopted.document.revision, undone.document.revision, redone.document.revision], impact, errors,
  }, null, 2))
})
