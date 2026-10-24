import { expect, test } from '@playwright/test'

test('M2-0e full old catalog preserves exact identities, personal organization and real private-template pixels through cold reopen and selected backup', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20e-fixtures.ts', migrationPath = '/src/application/migration/library-conversion.ts'
    const capturePath = '/src/compat/legacy/catalog.ts', libraryPath = '/src/shared/library/index.ts', storagePath = '/src/platform/browser/library/index.ts'
    const oldBackupPath = '/src/catalog/backup.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20e-fixtures')
    const migration = await import(migrationPath) as typeof import('../src/application/migration/library-conversion')
    const capture = await import(capturePath) as typeof import('../src/compat/legacy/catalog')
    const library = await import(libraryPath) as typeof import('../src/shared/library')
    const storage = await import(storagePath) as typeof import('../src/platform/browser/library')
    const oldBackup = await import(oldBackupPath) as typeof import('../src/catalog/backup')
    const source = await helper.seedLegacyCatalog(), env = helper.libraryEnvironment()
    let reopened = env.repository
    const restored = helper.libraryEnvironment('m20e-restored')
    try {
      const local = { tags: ['本机已有标签'], colors: ['红'] as ('红')[], favorite: false }
      await env.repository.commit(0, { organization: [{ key: source.prop.item.identity.key, value: local }, { key: helper.OUTSIDE_KEY, value: local }] })
      const before = await capture.captureLegacyCatalog(), start = await migration.beginLibraryConversion(env)
      if (!start.backup) throw new Error('Initial conversion needs full preservation files')
      const roles: string[] = JSON.parse(new TextDecoder().decode(start.backup.index)).records.map((record: { role: string }) => record.role)
      const hidden = await env.repository.read(), converted = await migration.continueLibraryConversion({ jobId: start.job.jobId, backup: await helper.rereadBackup(start.backup), organizationPolicy: 'keep-local' }, env)
      env.repository.close(); reopened = new storage.LibraryRepository({ runtime: env.runtime, validation: env.validation })
      const current = await reopened.read(), entries = []
      for (const summary of current.entries) entries.push(await reopened.load(summary.item.identity.key))
      const prefab = entries.find(entry => entry.item.identity.kind === 'prefab')!, bundle = await library.loadLibraryCapsule(prefab, env.validation)
      const originals = new Map(Object.entries(source.legacy.assets).map(([hash, record]) => [hash, record.blob]))
      const actualAssets = []
      for (const [hash, record] of Object.entries(bundle.project.assets)) {
        const bytes = await bundle.resources.read(hash), original = new Uint8Array(await originals.get(hash)!.arrayBuffer()), image = await env.validation.images.decode(bytes, record)
        actualAssets.push({ exact: bytes.length === original.length && bytes.every((byte, index) => byte === original[index]), width: image.width, height: image.height })
      }
      const selected = await library.exportLibraryBackup({ entries, organizations: current.organizations }, env.validation)
      const file = new File([selected.slice().buffer], 'selected.sceneweave-library', { type: 'application/json' })
      const recovered = await library.importLibraryBackup(new Uint8Array(await file.arrayBuffer()), env.validation)
      const copy = await restored.repository.commit(0, { put: recovered.entries, organization: Object.entries(recovered.organizations).map(([key, value]) => ({ key, value })) })
      let oldRejects = false, newRejects = false
      try { await oldBackup.readCatalogBackup(file) } catch { oldRejects = true }
      const oldFile = await oldBackup.exportCatalogBackup([{ entry: source.prop, organization: helper.SOURCE_ORGANIZATION }])
      try { await library.importLibraryBackup(new Uint8Array(await oldFile.arrayBuffer()), env.validation) } catch { newRejects = true }
      const after = await capture.captureLegacyCatalog()
      return { roles, hiddenEntries: hidden.entries.length, hiddenOrganizations: Object.keys(hidden.organizations).length,
        stage: converted.job.stage, sourceState: converted.sourceState, keys: current.entries.map(entry => entry.item.identity.key).sort(), expectedKeys: [source.prop.item.identity.key, source.prefab.item.identity.key].sort(),
        local: current.organizations[source.prop.item.identity.key], organizationOnly: current.organizations[helper.ORGANIZATION_ONLY_KEY], outside: current.organizations[helper.OUTSIDE_KEY], installedOnly: current.entries.some(entry => entry.item.identity.key === helper.ORGANIZATION_ONLY_KEY),
        copyKeys: copy.entries.map(entry => entry.item.identity.key).sort(), copyOrganizations: copy.organizations, organizations: current.organizations,
        nativeFormat: bundle.project.format, nativeScene: bundle.project.document.format, capsuleProps: Object.keys(bundle.project.document.props).length,
        privateTemplate: bundle.project.appearance.prefabAppearanceTemplates['m20e-private-definition'].visibility, sourceAncestors: Object.keys(bundle.project.appearance.sources).length,
        variantCount: Object.keys(bundle.project.appearance.variants).length, actualAssets, oldRejects, newRejects,
        oldFingerprintUnchanged: before.sourceFingerprint === after.sourceFingerprint, newHashesDiffer: entries.every(entry => entry.capsuleSha256 !== (entry.item.identity.kind === 'prop' ? source.prop : source.prefab).capsuleSha256),
        staging: await reopened.database.conversionStaging.count() }
    } finally { reopened.close(); env.repository.close(); restored.repository.close(); source.repository.close() }
  })
  expect(report.roles.filter(role => role === 'catalog-entry')).toHaveLength(2)
  expect(report.roles.filter(role => role === 'catalog-organization')).toHaveLength(3)
  expect(report.roles.filter(role => role === 'catalog-metadata')).toHaveLength(1)
  expect(report).toMatchObject({ hiddenEntries: 0, hiddenOrganizations: 2, stage: 'verified', sourceState: 'unchanged', installedOnly: false, nativeFormat: 'sceneweave-complete-project', nativeScene: 'sceneweave-scene', capsuleProps: 0, privateTemplate: 'gm', oldRejects: true, newRejects: true, oldFingerprintUnchanged: true, newHashesDiffer: true, staging: 0 })
  expect(report.keys).toEqual(report.expectedKeys); expect(report.copyKeys).toEqual(report.expectedKeys)
  expect(report.local).toEqual({ tags: ['本机已有标签'], colors: ['红'], favorite: false })
  expect(report.organizationOnly).toEqual({ tags: [' 原显示文本 ', '第二个标签'], colors: ['蓝', '灰'], favorite: true })
  expect(report.outside).toEqual(report.local); expect(report.copyOrganizations).toEqual(report.organizations)
  expect(report.sourceAncestors).toBeGreaterThan(1); expect(report.variantCount).toBeGreaterThan(0)
  expect(report.actualAssets.length).toBeGreaterThan(1); expect(report.actualAssets.every(asset => asset.exact && asset.width === 8 && asset.height === 8)).toBe(true)
})

test('M2-0e damaged backup, cancellation and committed-page reload keep public library intact, retry same journal and preserve later edits', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const staged = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20e-fixtures.ts', migrationPath = '/src/application/migration/library-conversion.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20e-fixtures')
    const migration = await import(migrationPath) as typeof import('../src/application/migration/library-conversion')
    const source = await helper.seedLegacyCatalog(), env = helper.libraryEnvironment()
    try {
      const first = await migration.beginLibraryConversion(env)
      if (!first.backup) throw new Error('Missing preservation set')
      const damaged = await helper.rereadBackup(first.backup), part = damaged.volumes.values().next().value!
      part[part.length - 1] ^= 1
      let rejectsDamage = false
      try { await migration.continueLibraryConversion({ jobId: first.job.jobId, backup: damaged }, env) } catch { rejectsDamage = true }
      const retry = await migration.beginLibraryConversion(env)
      await migration.cancelLibraryConversion(retry.job.jobId, env)
      const resumed = await migration.beginLibraryConversion(env)
      if (!resumed.backup) throw new Error('Cancelled precommit conversion needs files again')
      const originalPublish = env.repository.publishConversion.bind(env.repository)
      env.repository.publishConversion = async () => { throw new Error('Simulated page interruption after durable staging') }
      let interrupted = false
      try { await migration.continueLibraryConversion({ jobId: resumed.job.jobId, backup: await helper.rereadBackup(resumed.backup), organizationPolicy: 'replace-selected' }, env) } catch { interrupted = true }
      env.repository.publishConversion = originalPublish
      return { jobId: resumed.job.jobId, rejectsDamage, interrupted, sameJob: first.job.jobId === resumed.job.jobId, publicEntries: (await env.repository.read()).entries.length, stagedRows: await env.repository.database.conversionStaging.count(), key: source.prop.item.identity.key }
    } finally { env.repository.close(); source.repository.close() }
  })
  expect(staged).toMatchObject({ rejectsDamage: true, interrupted: true, sameJob: true, publicEntries: 0 }); expect(staged.stagedRows).toBe(5)
  await page.reload()
  const resumed = await page.evaluate(async ({ jobId, key }) => {
    const helperPath = '/tests/helpers/m20e-fixtures.ts', migrationPath = '/src/application/migration/library-conversion.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20e-fixtures')
    const migration = await import(migrationPath) as typeof import('../src/application/migration/library-conversion')
    const env = helper.libraryEnvironment()
    try {
      const result = await migration.continueLibraryConversion({ jobId }, env)
      const changed = await env.repository.commit(result.snapshot.revision, { organization: [{ key, value: { tags: ['转换后手工编辑'], colors: ['绿'], favorite: false } }] })
      const again = await migration.continueLibraryConversion({ jobId }, env)
      return { stage: result.job.stage, count: result.snapshot.entries.length, againReused: again.reused, revision: again.snapshot.revision, changedRevision: changed.revision,
        organization: again.snapshot.organizations[key], staging: await env.repository.database.conversionStaging.count() }
    } finally { env.repository.close() }
  }, staged)
  expect(resumed).toMatchObject({ stage: 'verified', count: 2, againReused: true, organization: { tags: ['转换后手工编辑'], colors: ['绿'], favorite: false }, staging: 0 })
  expect(resumed.revision).toBe(resumed.changedRevision)
})

test('M2-0e source-change choice preserves both branches; original legacy backup file converts independently', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20e-fixtures.ts', migrationPath = '/src/application/migration/library-conversion.ts', oldBackupPath = '/src/catalog/backup.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20e-fixtures')
    const migration = await import(migrationPath) as typeof import('../src/application/migration/library-conversion')
    const oldBackup = await import(oldBackupPath) as typeof import('../src/catalog/backup')
    const source = await helper.seedLegacyCatalog(), env = helper.libraryEnvironment(), fileEnv = helper.libraryEnvironment('m20e-from-file')
    try {
      await env.repository.commit(0, { organization: [{ key: helper.ORGANIZATION_ONLY_KEY, value: { tags: ['已有本机整理'], colors: ['红'], favorite: false } }] })
      const start = await migration.beginLibraryConversion(env)
      if (!start.backup) throw new Error('Missing preservation set')
      await source.repository.commit(1, { organization: [{ key: helper.ORGANIZATION_ONLY_KEY, value: { tags: ['备份后修改'], colors: ['橙'], favorite: false } }] })
      let defaultRejects = false
      try { await migration.continueLibraryConversion({ jobId: start.job.jobId, backup: await helper.rereadBackup(start.backup), organizationPolicy: 'replace-selected' }, env) } catch (error) { defaultRejects = error instanceof migration.LibraryConversionSourceChangedError }
      const hiddenEntries = (await env.repository.read()).entries.length
      const converted = await migration.continueLibraryConversion({ jobId: start.job.jobId, backup: await helper.rereadBackup(start.backup), sourcePolicy: 'captured-copy' }, env)
      const oldFile = await oldBackup.exportCatalogBackup([{ entry: source.prefab, organization: helper.SOURCE_ORGANIZATION }]), original = new Uint8Array(await oldFile.arrayBuffer())
      let sourceReads = 0
      fileEnv.legacy = { factory: { open: () => { sourceReads++; throw new Error('File conversion must not read old DB') } } as unknown as IDBFactory }
      const fileStart = await migration.beginLibraryFileConversion(original, fileEnv)
      if (!fileStart.backup) throw new Error('Missing file preservation set')
      const preservedPath = '/src/shared/migration/set.ts'
      const set = await import(preservedPath) as typeof import('../src/shared/migration/set')
      const reread = await helper.rereadBackup(fileStart.backup), parsed = await set.importMigrationSet(reread.index, reread.volumes)
      const exactFile = parsed.records[0].bytes.length === original.length && parsed.records[0].bytes.every((byte, index) => byte === original[index])
      const fromFile = await migration.continueLibraryConversion({ jobId: fileStart.job.jobId, backup: reread }, fileEnv)
      return { defaultRejects, hiddenEntries, sourceState: converted.sourceState, retainedPolicy: converted.job.organizationPolicy, capturedOrganization: converted.snapshot.organizations[helper.ORGANIZATION_ONLY_KEY],
        laterOrganization: (await source.repository.read()).organizations[helper.ORGANIZATION_ONLY_KEY], sourceReads, exactFile, fileRepository: fileStart.job.sourceRepository,
        fileStage: fromFile.job.stage, fileKeys: fromFile.snapshot.entries.map(entry => entry.item.identity.key), expectedKey: source.prefab.item.identity.key,
        fileOrganization: fromFile.snapshot.organizations[source.prefab.item.identity.key], fileOnlyCount: Object.keys(fromFile.snapshot.organizations).length }
    } finally { source.repository.close(); env.repository.close(); fileEnv.repository.close() }
  })
  expect(report).toMatchObject({ defaultRejects: true, hiddenEntries: 0, sourceState: 'changed', retainedPolicy: 'replace-selected', sourceReads: 0, exactFile: true, fileRepository: 'file-catalog-v1', fileStage: 'verified', fileOnlyCount: 1 })
  expect(report.capturedOrganization).toEqual({ tags: [' 原显示文本 ', '第二个标签'], colors: ['蓝', '灰'], favorite: true })
  expect(report.laterOrganization).toEqual({ tags: ['备份后修改'], colors: ['橙'], favorite: false })
  expect(report.fileKeys).toEqual([report.expectedKey]); expect(report.fileOrganization).toEqual(report.capturedOrganization)
})

test('M2-0e standalone native provider validates all 57 actual images and preserves every old item, 62 curation keys and six refinement links', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const providerPath = '/src/platform/browser/content/index.ts', libraryPath = '/src/shared/library/index.ts', imagePath = '/src/platform/browser/images/index.ts'
    const oldBuiltinPath = '/src/catalog/builtin.ts', oldContentPath = '/src/catalog/content.ts'
    const provider = await import(providerPath) as typeof import('../src/platform/browser/content')
    const library = await import(libraryPath) as typeof import('../src/shared/library')
    const images = await import(imagePath) as typeof import('../src/platform/browser/images')
    const oldBuiltin = await import(oldBuiltinPath) as typeof import('../src/catalog/builtin')
    const oldContent = await import(oldContentPath) as typeof import('../src/catalog/content')
    const validation = { images: images.createBrowserImagePort() }, before = await indexedDB.databases()
    const current = await provider.loadBuiltinCatalog(validation), old = await oldBuiltin.loadBuiltinCatalogV1()
    const oldItems = oldContent.describeCatalogItems(old), newItems = library.listCatalogItems(current), byKey = new Map(oldItems.map(item => [item.identity.key, item]))
    const itemsExact = newItems.every(item => JSON.stringify(item) === JSON.stringify(byKey.get(item.identity.key)))
    const audit = provider.builtinIdentityAudit(current), hashes = []
    for (const [hash, record] of Object.entries(current.project.assets)) {
      const bytes = await current.resources.read(hash), expected = new Uint8Array(await old.assets[hash].blob.arrayBuffer())
      hashes.push(bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]) && record.pixelWidth === old.assets[hash].pixelWidth && record.pixelHeight === old.assets[hash].pixelHeight)
    }
    const selected = newItems.find(item => item.identity.catalogId === 'prop.sw.tree-broadleaf.refined')!
    const entry = await library.prepareLibraryEntry(current, selected.selector, validation), capsule = await library.loadLibraryCapsule(entry, validation)
    const refined = provider.catalogCurationFor(selected)!, original = provider.CATALOG_CURATION.get(refined.refines!)!
    const matches = library.matchesCatalogFilter(selected, undefined, { ...library.EMPTY_CATALOG_FILTER, query: '精修', colors: ['绿'] }, provider.CATALOG_CURATION)
    const after = await indexedDB.databases()
    return { audit, itemsExact, bytesExact: hashes.every(Boolean), sourceCount: hashes.length, selectedKey: entry.item.identity.key, expectedKey: selected.identity.key,
      refinedRelation: !!original && original.key === refined.refines, matches, capsuleSceneProps: Object.keys(capsule.project.document.props).length,
      databasesUnchanged: JSON.stringify(before) === JSON.stringify(after) }
  })
  expect(report.audit).toEqual({ items: 62, images: 57, curations: 62, refines: 6 })
  expect(report).toMatchObject({ itemsExact: true, bytesExact: true, sourceCount: 57, refinedRelation: true, matches: true, capsuleSceneProps: 0, databasesUnchanged: true })
  expect(report.selectedKey).toBe(report.expectedKey)
})
