import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

async function downloads(page: Page, info: TestInfo, directory = 'original') {
  const dialog = page.getByRole('dialog', { name: '旧存档保全与转换', exact: true }), paths: string[] = []
  for (const button of await dialog.getByRole('button', { name: /^下载保全索引$|^下载分卷 / }).all()) {
    const event = page.waitForEvent('download'); await button.click()
    const file = await event, path = info.outputPath(directory, file.suggestedFilename())
    await file.saveAs(path); paths.push(path)
  }
  return paths
}
async function settled(page: Page) {
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@1')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}
test('M2-0f legacy entry requires actual full backup reread, cancels safely, converts and retrieves exact originals', async ({ page, browser }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#home')
  const before = await page.evaluate(async () => {
    const hp = '/tests/helpers/m20d-fixtures.ts', cp = '/src/compat/legacy/capture.ts'
    const helper = await import(hp) as typeof import('./helpers/m20d-fixtures'), capture = await import(cp) as typeof import('../src/compat/legacy/capture')
    const source = await helper.seedLegacyFamily()
    try { return { reference: source.reference, fingerprint: (await capture.captureLegacyFamily(source.reference)).sourceFingerprint } }
    finally { source.repository.close() }
  })
  await page.getByRole('button', { name: '查找旧工程', exact: true }).click()
  const row = page.locator('.home-project-row').filter({ has: page.getByRole('heading', { name: 'M2-0d preserved source', exact: true }) })
  await row.getByRole('button', { name: '保全并转换', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '旧存档保全与转换', exact: true })
  await expect(dialog.getByRole('button', { name: '核验并转换', exact: true })).toBeDisabled()
  const initial = await page.evaluate(async () => {
    const p = '/src/platform/browser/runtime.ts', { projectRepository: repo } = await import(p) as typeof import('../src/platform/browser/runtime')
    const jobs = await repo.database.conversionJobs.toArray()
    const advance = repo.advanceJob.bind(repo)
    repo.advanceJob = async (...args: Parameters<typeof repo.advanceJob>) => {
      if (args[2] === 'cancelled') await new Promise(resolve => setTimeout(resolve, 250))
      return advance(...args)
    }
    return { job: jobs[0].jobId, target: jobs[0].targetSceneId, ready: (await repo.list()).length }
  })
  expect(initial.ready).toBe(0)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.native-app-content')).toHaveAttribute('inert', '')
  await expect(dialog).toHaveCount(0)
  await row.getByRole('button', { name: '保全并转换', exact: true }).click()
  await expect(dialog).toBeVisible()
  const files = await downloads(page, info)
  await dialog.getByLabel('重新选择完整保全文件', { exact: true }).setInputFiles(files)
  await dialog.getByRole('button', { name: '核验并转换', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 30_000 }); await settled(page)
  const after = await page.evaluate(async ({ initial, reference }) => {
    const rp = '/src/platform/browser/runtime.ts', cp = '/src/compat/legacy/capture.ts', wp = '/src/editor/main/Workbench.tsx'
    const { projectRepository: repo } = await import(rp) as typeof import('../src/platform/browser/runtime'), capture = await import(cp) as typeof import('../src/compat/legacy/capture')
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const project = nativeWorkspace.getState().project!, job = await repo.getJob(initial.job)
    return { job: job!.jobId, target: job!.targetSceneId, stage: job!.stage, format: project.format, revision: project.document.revision,
      fingerprint: (await capture.captureLegacyFamily(reference)).sourceFingerprint, originals: await repo.listLegacySources(project.document.sceneId),
      snapshots: await repo.listSnapshots(project.document.sceneId), ready: (await repo.list()).length }
  }, { initial, reference: before.reference })
  expect(after).toMatchObject({ job: initial.job, target: initial.target, stage: 'verified', format: 'sceneweave-complete-project', revision: 0, fingerprint: before.fingerprint, ready: 1 })
  expect(after.snapshots.map(value => value.kind)).toEqual(expect.arrayContaining(['named', 'protection', 'imported-auto']))
  expect(after.originals.length).toBeGreaterThan(0)
  await page.getByTestId('workspace-navigation').getByRole('tab', { name: '历史', exact: true }).click()
  const sources = page.getByRole('region', { name: '迁移原件', exact: true })
  const source = after.originals[0], event = page.waitForEvent('download')
  await sources.locator(`[data-legacy-source-node="${source.nodeId}"]`).getByRole('button', { name: /^下载迁移原件 / }).click()
  const download = await event, path = await download.path()
  expect(path).not.toBeNull()
  expect(createHash('sha256').update(await readFile(path!)).digest('hex')).toBe(source.sourceHash)
  expect(errors).toEqual([])
  const empty = await browser.newContext(), reopened = await empty.newPage()
  try {
    await reopened.goto('/#home')
    await reopened.getByTestId('preservation-files').setInputFiles(files)
    const check = reopened.getByRole('dialog', { name: '旧存档保全与转换', exact: true })
    await expect(check).toBeVisible()
    const rebound = await downloads(reopened, info, 'reopened')
    await check.getByLabel('重新选择完整保全文件', { exact: true }).setInputFiles(rebound)
    await check.getByRole('button', { name: '核验并转换', exact: true }).click()
    await expect(check.getByRole('alert')).toContainText('暂不可读')
    await check.getByLabel('源内容变化策略', { exact: true }).selectOption('captured-copy')
    await check.getByRole('button', { name: '核验并转换', exact: true }).click()
    await expect(check).toHaveCount(0, { timeout: 30_000 }); await settled(reopened)
    const databases = await reopened.evaluate(async () => (await indexedDB.databases()).map(value => value.name).sort())
    expect(databases).toEqual(['sceneweave-library', 'sceneweave-projects'])
    await expect(reopened.locator('.workspace-project-title h1')).toHaveText('M2-0d preserved source')
  } finally { await empty.close() }
})

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

test('M2-0f personal-library conversion resumes its frozen organization policy through the real home dialog', async ({ page }, info) => {
  test.setTimeout(90_000)
  await page.goto('/#home')
  const before = await page.evaluate(async () => {
    const hp = '/tests/helpers/m20e-fixtures.ts', mp = '/src/application/migration/library-conversion.ts', rp = '/src/platform/browser/runtime.ts', cp = '/src/compat/legacy/catalog.ts'
    const helper = await import(hp) as typeof import('./helpers/m20e-fixtures'), migration = await import(mp) as typeof import('../src/application/migration/library-conversion')
    const browserRuntime = await import(rp) as typeof import('../src/platform/browser/runtime'), capture = await import(cp) as typeof import('../src/compat/legacy/catalog')
    const source = await helper.seedLegacyCatalog(), repo = browserRuntime.libraryRepository
    const env = { repository: repo, runtime: browserRuntime.runtime, validation: browserRuntime.validation }, commit = repo.commitConversion.bind(repo)
    try {
      const fingerprint = (await capture.captureLegacyCatalog()).sourceFingerprint, start = await migration.beginLibraryConversion(env)
      repo.commitConversion = async () => { throw new Error('injected interruption after frozen policy') }
      try { await migration.continueLibraryConversion({ jobId: start.job.jobId, backup: await helper.rereadBackup(start.backup!), organizationPolicy: 'replace-selected' }, env) } catch { /* Deliberate stopped conversion; retry must retain its policy. */ }
      return { fingerprint, jobId: start.job.jobId, policy: (await repo.getJob(start.job.jobId))!.organizationPolicy }
    } finally { repo.commitConversion = commit; source.repository.close() }
  })
  expect(before.policy).toBe('replace-selected')
  await page.getByRole('button', { name: '保全并转换旧个人素材库', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '旧存档保全与转换', exact: true })
  await expect(dialog.getByLabel('个人整理冲突策略', { exact: true })).toHaveValue('replace-selected')
  await expect(dialog.getByLabel('个人整理冲突策略', { exact: true })).toBeDisabled()
  const files = await downloads(page, info)
  await dialog.getByLabel('重新选择完整保全文件', { exact: true }).setInputFiles(files)
  await dialog.getByRole('button', { name: '核验并转换', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 30_000 })
  const result = await page.evaluate(async ({ jobId }) => {
    const rp = '/src/platform/browser/runtime.ts', cp = '/src/compat/legacy/catalog.ts'
    const { libraryRepository: repo } = await import(rp) as typeof import('../src/platform/browser/runtime'), capture = await import(cp) as typeof import('../src/compat/legacy/catalog')
    const snapshot = await repo.read()
    return { job: await repo.getJob(jobId), fingerprint: (await capture.captureLegacyCatalog()).sourceFingerprint,
      installed: snapshot.entries.length, organizations: Object.values(snapshot.organizations) }
  }, before)
  expect(result.job).toMatchObject({ jobId: before.jobId, stage: 'verified', organizationPolicy: 'replace-selected' })
  expect(result.fingerprint).toBe(before.fingerprint); expect(result.installed).toBe(2); expect(result.organizations).toHaveLength(3)
  expect(result.organizations).toContainEqual({ tags: [' 原显示文本 ', '第二个标签'], colors: ['蓝', '灰'], favorite: true })
})

test('M2-0f an unpublished committed copy keeps an explicit captured-copy choice after its old source disappears', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/#home')
  const prepared = await page.evaluate(async () => {
    const hp = '/tests/helpers/m20d-fixtures.ts', mp = '/src/application/migration/conversion.ts', rp = '/src/platform/browser/runtime.ts'
    const helper = await import(hp) as typeof import('./helpers/m20d-fixtures'), migration = await import(mp) as typeof import('../src/application/migration/conversion')
    const browserRuntime = await import(rp) as typeof import('../src/platform/browser/runtime'), source = await helper.seedLegacyFamily(), repo = browserRuntime.projectRepository
    const env = { repository: repo, runtime: browserRuntime.runtime, validation: browserRuntime.validation }, publish = repo.publishConversion.bind(repo)
    let result
    try {
      const start = await migration.beginProjectConversion(source.reference, env)
      repo.publishConversion = async () => { throw new Error('injected stop before ready') }
      try { await migration.continueProjectConversion({ jobId: start.job.jobId, backup: await helper.rereadBackup(start.backup!) }, env) } catch { /* Private target must survive this interruption. */ }
      result = { jobId: start.job.jobId, target: start.job.targetSceneId, files: [{ name: start.job.jobId + '.sceneweave-migration.json', bytes: [...start.backup!.index] },
        ...[...start.backup!.volumes].map(([name, bytes]) => ({ name, bytes: [...bytes] }))] }
    } finally { repo.publishConversion = publish; source.repository.close() }
    // This is a fresh, isolated Playwright profile. Delete only the fixture's old
    // database to represent a moved backup; no real user profile is connected.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('sceneweave-m1-outdoor')
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Fixture database still open'))
    })
    return result
  })
  await page.getByTestId('preservation-files').setInputFiles(prepared.files.map(file => ({ name: file.name, mimeType: 'application/octet-stream', buffer: Buffer.from(file.bytes) })))
  const dialog = page.getByRole('dialog', { name: '旧存档保全与转换', exact: true })
  await expect(dialog).toContainText('待开放副本')
  await expect(dialog.getByRole('button', { name: '核验并转换', exact: true })).toBeDisabled()
  await dialog.getByLabel('重新选择完整保全文件', { exact: true }).setInputFiles(prepared.files.map(file => ({ name: file.name, mimeType: 'application/octet-stream', buffer: Buffer.from(file.bytes) })))
  await dialog.getByRole('button', { name: '核验并转换', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('暂不可读')
  await dialog.getByLabel('源内容变化策略', { exact: true }).selectOption('captured-copy')
  await dialog.getByRole('button', { name: '核验并转换', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 30_000 }); await settled(page)
  const result = await page.evaluate(async jobId => {
    const rp = '/src/platform/browser/runtime.ts', { projectRepository: repo } = await import(rp) as typeof import('../src/platform/browser/runtime')
    return { job: await repo.getJob(jobId), ready: (await repo.list()).length }
  }, prepared.jobId)
  expect(result.job).toMatchObject({ jobId: prepared.jobId, targetSceneId: prepared.target, stage: 'verified' }); expect(result.ready).toBe(1)
})
