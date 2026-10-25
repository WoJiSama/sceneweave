import { expect, test, type Page } from '@playwright/test'

async function settled(page: Page) {
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@1')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}

test('M2-0f native history file opens as an independent complete project and cold reads selected original history', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/#home')
  const file = await page.evaluate(async () => {
    const fp = '/src/platform/browser/content/factories.ts', bp = '/src/application/workspace/project.ts', hp = '/src/shared/project/file.ts', vp = '/src/shared/project/validate.ts'
    const { createSampleProject } = await import(fp) as typeof import('../src/platform/browser/content/factories'), { toBundle } = await import(bp) as typeof import('../src/application/workspace/project')
    const { exportHistoryArchive } = await import(hp) as typeof import('../src/shared/project/file'), { projectContentHash } = await import(vp) as typeof import('../src/shared/project/validate')
    const rp = '/src/platform/browser/runtime.ts', { validation } = await import(rp) as typeof import('../src/platform/browser/runtime')
    const bundle = toBundle(await createSampleProject('outpost')), project = bundle.project, contentHash = projectContentHash(project)
    const bytes = await exportHistoryArchive({ current: bundle, snapshots: [{ id: 'portable-native-history', ownerSceneId: project.document.sceneId, lineageId: project.historyIdentity.lineageId,
      sourceRevision: project.document.revision, name: '明确携带的原生历史', kind: 'named', createdAt: project.document.updatedAt, contentHash, bundle }] }, validation)
    return { bytes: [...bytes], sourceId: project.document.sceneId, contentHash, identity: project.historyIdentity, document: project.document }
  })
  await page.getByTestId('native-project-file').setInputFiles({ name: 'native-history.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from(file.bytes) })
  await settled(page)
  const result = await page.evaluate(async () => {
    const rp = '/src/platform/browser/runtime.ts', wp = '/src/editor/main/Workbench.tsx'
    const { projectRepository: repo } = await import(rp) as typeof import('../src/platform/browser/runtime'), { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const current = nativeWorkspace.getState().project!, summaries = await repo.listSnapshots(current.document.sceneId), snapshot = await repo.loadSnapshot(current.document.sceneId, summaries[0].id)
    const loaded = await repo.load(current.document.sceneId)
    return { currentId: current.document.sceneId, format: loaded!.project.format, revision: loaded!.project.document.revision,
      identity: loaded!.project.historyIdentity, historical: snapshot!.bundle.project.document, hash: snapshot!.contentHash,
      owner: snapshot!.ownerSceneId, title: summaries[0].name, databases: (await indexedDB.databases()).map(value => value.name) }
  })
  expect(result.currentId).not.toBe(file.sourceId)
  expect(result).toMatchObject({ format: 'sceneweave-complete-project', revision: 0, identity: file.identity, historical: file.document, hash: file.contentHash, title: '明确携带的原生历史' })
  expect(result.owner).toBe(result.currentId)
  expect(result.databases.sort()).toEqual(['sceneweave-library', 'sceneweave-projects'])
  await page.getByTestId('native-project-file').setInputFiles({ name: 'broken.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from('broken project') })
  await expect(page.getByRole('dialog', { name: '检查完整工程', exact: true })).toHaveCount(0)
  await expect(page.locator('.workspace-notice')).toContainText(/不支持|无效|格式/)
  const retained = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    return nativeWorkspace.getState().project!.document.sceneId
  })
  expect(retained).toBe(result.currentId)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开', exact: true }).click(); await settled(page)
  await expect(page.locator('.workspace-project-title h1')).toContainText(file.document.title)
})
