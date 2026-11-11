import { test, expect, type Page } from '@playwright/test'

/** DEV-source integration evidence: fixtures are installed into a fresh
 * Playwright context. The UI migration, native IndexedDB/locks and real Canvas
 * decoding/rendering are exercised; this is not production-only UI acceptance. */
const modules = {
  fixture: '/src/application/workspace/test-fixtures.ts', database: '/src/platform/browser/storage/database.ts', library: '/src/platform/browser/library/database.ts',
  current: '/src/platform/browser/storage/current-databases.ts', importer: '/src/platform/browser/storage/development-import.ts',
  legacy: '/src/shared/migration/development-project.ts', history: '/src/platform/browser/storage/incremental-history.ts', delta: '/src/shared/project/delta.ts',
  json: '/src/shared/validation/json.ts', binary: '/src/shared/project/binary.ts', hash: '/src/shared/project/validate.ts', runtime: '/src/platform/browser/runtime.ts',
  repository: '/src/platform/browser/storage/repository.ts', renderer: '/src/platform/browser/render/renderer.ts', resources: '/src/shared/project/resources.ts',
  libraryContent: '/src/shared/library/content.ts', workspace: '/src/editor/main/Workbench.tsx', project: '/src/application/workspace/project.ts',
}

async function installSource(page: Page) {
  return page.evaluate(async paths => {
    const { fixture } = await import(paths.fixture), { PROJECT_STORES_V3, LEGACY_DEVELOPMENT_PROJECT_DATABASE } = await import(paths.database)
    const { LIBRARY_STORES, LEGACY_DEVELOPMENT_LIBRARY_DATABASE } = await import(paths.library), { legacyDevelopmentProjectHash, convertDevelopmentProject } = await import(paths.legacy)
    const { sealHistoryRecord } = await import(paths.history), { createProjectDelta, projectDeltaBytes } = await import(paths.delta)
    const { cloneJson, canonicalJson } = await import(paths.json), { projectContentHash } = await import(paths.hash), { sha256Bytes } = await import(paths.binary)
    const { validation } = await import(paths.runtime), { exportPng } = await import(paths.renderer)
    const base = fixture({ image: true }), owner = base.project.document.sceneId
    const projects = [0, 1, 2].map(revision => { const project = cloneJson(base.project); project.document.revision = revision; project.document.title = ['迁入根版本', '保留分支版本', '迁入后的完整地图'][revision]; return project })
    const old = projects.map(project => {
      const { structureTokens: _currentStructuralBirths, ...historyIdentity } = cloneJson(project.historyIdentity)
      return { ...cloneJson(project), schemaVersion: 8, historyIdentity, document: { ...cloneJson(project.document), schemaVersion: 8 } }
    })
    const hashes = old.map(legacyDevelopmentProjectHash), delta = { ...createProjectDelta(projects[0], projects[2]), beforeHash: hashes[0], afterHash: hashes[2] }
    const versions = projects.map((project, index) => sealHistoryRecord({ format: 'sceneweave-history-version', version: 1, ownerSceneId: owner, id: `version-${index}`, revision: index, savedAt: project.document.updatedAt,
      contentHash: hashes[index], parentId: index ? 'version-0' : null, parentHash: index ? hashes[0] : null, checkpoint: index === 2 ? null : old[index], delta: index === 2 ? delta : null,
      depth: index === 2 ? 1 : 0, chainBytes: index === 2 ? projectDeltaBytes(delta) : 0, automatic: true }))
    const head = sealHistoryRecord({ format: 'sceneweave-history-head', version: 1, ownerSceneId: owner, status: 'ready', activeVersionId: 'version-2', savedRevision: 2, contentHash: hashes[2], migration: null })
    const pin = sealHistoryRecord({ format: 'sceneweave-history-pin', version: 1, ownerSceneId: owner, id: 'branch-pin', versionId: 'version-1', lineageId: base.project.historyIdentity.lineageId, sourceRevision: 1, name: '保留分支', kind: 'named', createdAt: base.project.document.updatedAt, contentHash: hashes[1] })
    const createDatabase = (name: string, version: number, stores: Record<string, string>) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, version)
      request.onupgradeneeded = () => {
        for (const [name, expression] of Object.entries(stores)) {
          const [key, ...indexes] = expression.split(',').map(value => value.trim()), path = (value: string) => value.startsWith('[') ? value.slice(1, -1).split('+') : value
          const store = request.result.createObjectStore(name, { keyPath: path(key) })
          for (const index of indexes) { const unique = index.startsWith('&'), value = unique ? index.slice(1) : index; store.createIndex(value, path(value), { unique }) }
        }
      }
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const db = await createDatabase(LEGACY_DEVELOPMENT_PROJECT_DATABASE, 30, PROJECT_STORES_V3)
    const resources = await Promise.all(Object.keys(base.project.assets).map(async sha256 => ({ sha256, bytes: await base.resources.read(sha256) })))
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(Object.keys(PROJECT_STORES_V3), 'readwrite')
      tx.objectStore('projects').add({ sceneId: owner, revision: 2, savedAt: base.project.document.updatedAt, contentHash: hashes[2], status: 'ready', conversionJobId: null, project: old[2] })
      tx.objectStore('historyMetadata').add({ ownerSceneId: owner, metadataVersion: 1 })
      for (const row of versions) tx.objectStore('historyVersions').add(row)
      tx.objectStore('historyHeads').add(head); tx.objectStore('historyPins').add(pin)
      for (const [kind, recordId] of [['current', 'current'], ['named', 'branch-pin']]) tx.objectStore('resourceBindings').add({ ownerSceneId: owner, kind, recordId, assetHashes: Object.keys(base.project.assets).sort(), sourceHashes: [], licenseHashes: Object.keys(base.project.licenses).sort(), licenseBindings: base.project.licenseBindings })
      for (const row of resources) tx.objectStore('resources').add(row)
      for (const row of Object.values(base.project.licenses)) tx.objectStore('licenseTexts').add(row)
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error)
    }); db.close()
    const library = await createDatabase(LEGACY_DEVELOPMENT_LIBRARY_DATABASE, 10, LIBRARY_STORES); library.close()
    const expected = { ...base, project: convertDevelopmentProject(old[2]) }, png = await exportPng(expected, { audience: 'gm', longEdgePx: 512 })
    const bitmap = await createImageBitmap(png), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    localStorage.setItem('development-import-spec-source-guard', 'enabled')
    sessionStorage.setItem('development-import-spec-source-writes', '[]')
    return { owner, hashes, expectedHash: projectContentHash(expected.project), expectedDocument: projects[2].document, expectedLegacyIdentity: old[2].historyIdentity, expectedAppearance: old[2].appearance, resourceHashes: resources.map(row => row.sha256), pixelHash: sha256Bytes(new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data)), renderSize: [canvas.width, canvas.height], hasRealLocks: !!navigator.locks, canonicalLength: canonicalJson(old[2]).length }
  }, modules)
}
async function sourceFingerprint(page: Page) {
  return page.evaluate(async paths => {
    const { inspectLocalDevelopmentImport } = await import(paths.importer), { validation } = await import(paths.runtime), { CURRENT_DATABASE_SELECTION_KEY } = await import(paths.current)
    const preview = await inspectLocalDevelopmentImport({ validation })
    return { ...preview, selection: localStorage.getItem(CURRENT_DATABASE_SELECTION_KEY), writes: JSON.parse(sessionStorage.getItem('development-import-spec-source-writes') ?? '[]') }
  }, modules)
}

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    // Observe native source transactions, including after publication reload.
    // Fixture setup runs before this opt-in guard is enabled.
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      if (localStorage.getItem('development-import-spec-source-guard') && ['sceneweave-projects', 'sceneweave-library'].includes(this.name) && args[1] && args[1] !== 'readonly') {
        const writes = JSON.parse(sessionStorage.getItem('development-import-spec-source-writes') ?? '[]'); writes.push({ database: this.name, mode: args[1] }); sessionStorage.setItem('development-import-spec-source-writes', JSON.stringify(writes))
        throw new Error('Integration source guard: legacy data must remain readonly')
      }
      return transaction.apply(this, args)
    } as IDBDatabase['transaction']
  })
  await page.goto('/')
})

test('DEV integration: homepage migrates full v8 branched bitmap project, reloads and cold-opens full v1 without touching source', async ({ page }, info) => {
  test.setTimeout(120_000)
  const fixture = await installSource(page), before = await sourceFingerprint(page)
  expect(fixture.hasRealLocks).toBe(true); expect(before.projectCount).toBe(1); expect(before.historyVersionCount).toBe(3); expect(before.selection).toBeNull()
  await page.getByText('一次性迁入旧开发数据', { exact: true }).click()
  await page.getByRole('button', { name: '检查迁入范围', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '检测到 1 个工程、3 个增量历史版本' })).toBeVisible()
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: '迁入并切换到 v1', exact: true }).click()])
  const row = page.locator(`[data-project-key="native:${fixture.owner}"]`)
  await expect(row).toContainText('迁入后的完整地图')
  const after = await sourceFingerprint(page)
  expect(after.sourceFingerprint).toBe(before.sourceFingerprint); expect(after.writes).toEqual([]); expect(JSON.parse(after.selection!)).toEqual(before.target)
  const cold = await page.evaluate(async ({ paths, owner }) => {
    const { projectRepository } = await import(paths.runtime), { projectContentHash } = await import(paths.hash), { sha256Bytes } = await import(paths.binary), { exportPng } = await import(paths.renderer)
    const bundle = await projectRepository.load(owner), overview = await projectRepository.historyOverview(owner), historical = await projectRepository.loadHistoryVersion(owner, 'version-1')
    if (!bundle || !historical) throw new Error('Cold project or pinned branch missing')
    const png = await exportPng(bundle, { audience: 'gm', longEdgePx: 512 }), bitmap = await createImageBitmap(png), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    return { document: bundle.project.document, identity: bundle.project.historyIdentity, appearance: bundle.project.appearance, projectVersion: bundle.project.schemaVersion, documentVersion: bundle.project.document.schemaVersion, fullFields: ['generation', 'visual', 'decorations', 'decorationClusters', 'surfaceRules'].every(key => Object.hasOwn(bundle.project.document, key)), hash: projectContentHash(bundle.project), versions: (overview.history.versions as { id: string; parentId: string | null; contentHash: string }[]).map((version: { id: string; parentId: string | null; contentHash: string }) => ({ id: version.id, parentId: version.parentId, contentHash: version.contentHash })), pins: (overview.snapshots as { id: string; sourceRevision: number }[]).map((pin: { id: string; sourceRevision: number }) => ({ id: pin.id, sourceRevision: pin.sourceRevision })), branchTitle: historical.project.document.title, resourceHashes: Object.keys(bundle.project.assets).sort(), actualResourceHashes: await Promise.all(Object.keys(bundle.project.assets).sort().map(async hash => sha256Bytes(await bundle.resources.read(hash)))), pixelHash: sha256Bytes(new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data)), renderSize: [canvas.width, canvas.height] }
  }, { paths: modules, owner: fixture.owner })
  expect(cold).toMatchObject({ projectVersion: 1, documentVersion: 1, fullFields: true, hash: fixture.expectedHash, branchTitle: '保留分支版本', pins: [{ id: 'branch-pin', sourceRevision: 1 }], pixelHash: fixture.pixelHash, renderSize: fixture.renderSize })
  expect(cold.document).toEqual(fixture.expectedDocument)
  const { structureTokens: _newStructureBirths, ...preservedIdentity } = cold.identity
  expect(preservedIdentity).toEqual(fixture.expectedLegacyIdentity)
  expect(cold.appearance).toEqual(fixture.expectedAppearance)
  expect(cold.versions).toHaveLength(3); expect(cold.versions.find((row: { id: string; parentId: string | null }) => row.id === 'version-2')?.parentId).toBe('version-0'); expect(cold.versions.find((row: { id: string; parentId: string | null }) => row.id === 'version-1')?.parentId).toBe('version-0')
  expect(cold.resourceHashes).toEqual(fixture.resourceHashes); expect(cold.actualResourceHashes).toEqual(fixture.resourceHashes)
  for (const version of cold.versions) expect(fixture.hashes).not.toContain(version.contentHash)
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page.getByTestId('workspace-home')).not.toBeVisible()
  await expect.poll(async () => page.evaluate(async paths => { const { nativeWorkspace } = await import(paths.workspace), { toBundle } = await import(paths.project), { projectContentHash } = await import(paths.hash); const project = nativeWorkspace.getState().project; return project ? projectContentHash(toBundle(project).project) : null }, modules)).toBe(fixture.expectedHash)
  await expect(page.locator('canvas').first()).toBeVisible()
  await info.attach('development-import-native-result.json', { body: JSON.stringify({ evidence: 'DEV source integration, isolated context, actual IndexedDB/navigator.locks/Canvas', sourceFingerprint: before.sourceFingerprint, target: before.target, cold }, null, 2), contentType: 'application/json' })
})

test('DEV integration: cancellation while a real publication lock is held cannot select a target or write the source', async ({ context, page }, info) => {
  test.setTimeout(120_000)
  await installSource(page); const before = await sourceFingerprint(page)
  const holder = await context.newPage(); await holder.goto('/')
  await holder.evaluate(() => {
    const state = window as unknown as { lockHeld: boolean; releaseImportLock?: () => void }
    void navigator.locks.request('sceneweave-development-import-publication', { mode: 'exclusive' }, async () => { state.lockHeld = true; await new Promise<void>(resolve => { state.releaseImportLock = resolve }) })
  })
  await expect.poll(() => holder.evaluate(() => (window as unknown as { lockHeld?: boolean }).lockHeld)).toBe(true)
  await page.getByText('一次性迁入旧开发数据', { exact: true }).click(); await page.getByRole('button', { name: '检查迁入范围', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '检测到 1 个工程' })).toBeVisible()
  await page.getByRole('button', { name: '迁入并切换到 v1', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '检查完整工程', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消操作', exact: true }).click()
  await holder.evaluate(() => (window as unknown as { releaseImportLock: () => void }).releaseImportLock())
  await expect(page.getByRole('dialog', { name: '检查完整工程', exact: true })).toHaveCount(0)
  const cancelled = await sourceFingerprint(page)
  expect(cancelled.sourceFingerprint).toBe(before.sourceFingerprint); expect(cancelled.selection).toBeNull(); expect(cancelled.writes).toEqual([])
  const targetPresence = await page.evaluate(async target => (await indexedDB.databases()).filter(database => [target.projects, target.library].includes(database.name ?? '')).map(database => database.name), before.target)
  expect(targetPresence).toEqual([])
  await info.attach('development-import-cancelled-lock.json', { body: JSON.stringify({ evidence: 'real navigator.locks across two isolated-context tabs; queued operation cancelled before target creation', cancelled, targetPresence }, null, 2), contentType: 'application/json' })
  await holder.close()
})
