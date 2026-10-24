import { expect, test } from '@playwright/test'

// Playwright supplies a new isolated browser context for every test. The exact old/new
// database names below exist only there; these tests do not access a user browser profile.
test('M2-0d native v6 full-family backup reread converts actual bytes and history, then cold-opens one ready project', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20d-fixtures.ts', conversionPath = '/src/application/migration/conversion.ts', capturePath = '/src/compat/legacy/capture.ts'
    const storagePath = '/src/platform/browser/storage/repository.ts', sharedPath = '/src/shared/index.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20d-fixtures')
    const migration = await import(conversionPath) as typeof import('../src/application/migration/conversion')
    const capture = await import(capturePath) as typeof import('../src/compat/legacy/capture')
    const { ProjectRepository } = await import(storagePath) as typeof import('../src/platform/browser/storage/repository')
    const shared = await import(sharedPath) as typeof import('../src/shared/index')
    const source = await helper.seedLegacyFamily(), env = helper.migrationEnvironment()
    let reopened = env.repository
    try {
      const before = await capture.captureLegacyFamily(source.reference), beforeAutomatic = await source.repository.listSnapshots(source.reference.sceneId)
      const start = await migration.beginProjectConversion(source.reference, env)
      if (!start.backup) throw new Error('First conversion must expose the full preservation set')
      const parsedIndex = JSON.parse(new TextDecoder().decode(start.backup.index)) as { records: { role: string }[] }
      const roles = parsedIndex.records.reduce<Record<string, number>>((counts, record) => { counts[record.role] = (counts[record.role] ?? 0) + 1; return counts }, {})
      const hiddenBefore = await env.repository.list(), readback = await helper.rereadBackup(start.backup)
      const converted = await migration.continueProjectConversion({ jobId: start.job.jobId, backup: readback }, env)
      env.repository.close(); reopened = new ProjectRepository({ runtime: env.runtime, validation: env.validation })
      const loaded = await reopened.load(converted.job.targetSceneId), family = await reopened.readConversion(converted.job.jobId)
      if (!loaded) throw new Error('Converted project is not ready after cold reopen')
      const assetChecks = []
      for (const [hash, asset] of Object.entries(loaded.project.assets)) {
        const actual = await loaded.resources.read(hash), expected = new Uint8Array(await source.current.assets[hash].blob.arrayBuffer()), raster = await env.validation.images.decode(actual, asset)
        const actualHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', actual.slice().buffer)), byte => byte.toString(16).padStart(2, '0')).join('')
        assetChecks.push({ exact: actual.length === expected.length && actual.every((value, index) => value === expected[index]), hashMatches: actualHash === hash, width: raster.width, height: raster.height })
      }
      const snapshotChecks = [...family.family.snapshots, ...family.family.importedSnapshots].map(snapshot => ({ id: snapshot.id, owner: snapshot.ownerSceneId,
        historicalSceneId: snapshot.bundle.project.document.sceneId, revision: snapshot.bundle.project.document.revision, sourceRevision: snapshot.sourceRevision,
        kind: snapshot.kind, hashMatches: shared.projectContentHash(snapshot.bundle.project) === snapshot.contentHash }))
      const original = new Uint8Array(await source.current.migrationSource!.original.arrayBuffer()), preserved = family.family.legacyBlobs.find(blob => blob.sha256 === source.current.migrationSource!.sourceHash)
      const identity = loaded.project.historyIdentity, originalIdentity = source.current.historyIdentity
      const after = await capture.captureLegacyFamily(source.reference)
      return { roles, hiddenBefore: hiddenBefore.length, initialStage: start.job.stage, finalStage: converted.job.stage, sourceState: converted.sourceState,
        targetId: converted.job.targetSceneId, oldOwner: source.reference.sceneId, targetRevision: loaded.project.document.revision, oldRevision: source.current.document.revision,
        readyCount: (await reopened.list()).length, beforeAutomatic: beforeAutomatic.map(row => row.revision), afterAutomatic: (await source.repository.listSnapshots(source.reference.sceneId)).map(row => row.revision),
        sourceFingerprintBefore: before.sourceFingerprint, sourceFingerprintAfter: after.sourceFingerprint, assetChecks, snapshotChecks,
        lineageMatches: identity.lineageId === originalIdentity.lineageId && identity.rootSceneId === originalIdentity.rootSceneId,
        propTokensMatch: shared.canonicalJson(identity.propTokens) === shared.canonicalJson(originalIdentity.propTokens),
        licensesMatch: shared.canonicalJson(loaded.project.licenses) === shared.canonicalJson(source.current.licenses),
        bindingsMatch: shared.canonicalJson(loaded.project.licenseBindings) === shared.canonicalJson(source.current.licenseBindings),
        appearanceMatches: shared.canonicalJson(loaded.project.appearance) === shared.canonicalJson(source.current.appearance),
        originalBytesExact: !!preserved && preserved.bytes.length === original.length && preserved.bytes.every((value, index) => value === original[index]),
        sourceSchemas: family.family.legacySources.map(node => node.sourceSchemaVersion),
        secretInProject: loaded.project.document.props['c3-secret'].visibility === 'gm', playerIds: shared.projectScene(loaded.project.document, 'player').props.map(prop => prop.id),
        journalSnapshotIds: Object.values(converted.job.snapshotIds).sort(), actualSnapshotIds: snapshotChecks.map(row => row.id).sort() }
    } finally { reopened.close(); env.repository.close(); source.repository.close() }
  })
  expect(report.roles).toMatchObject({ current: 1, automatic: 2, named: 1, protection: 1, 'history-metadata': 1, 'legacy-source': 1 })
  expect(report.roles.resource).toBeGreaterThan(0); expect(report.roles.license).toBeGreaterThan(0); expect(report.roles['resource-binding']).toBe(4)
  expect(report.hiddenBefore).toBe(0); expect(report.initialStage).toBe('captured'); expect(report.finalStage).toBe('verified'); expect(report.sourceState).toBe('unchanged')
  expect(report.targetId).not.toBe(report.oldOwner); expect(report.targetRevision).toBe(0); expect(report.oldRevision).toBe(1); expect(report.readyCount).toBe(1)
  expect(report.beforeAutomatic).toEqual([1, 0]); expect(report.afterAutomatic).toEqual(report.beforeAutomatic); expect(report.sourceFingerprintAfter).toBe(report.sourceFingerprintBefore)
  expect(report.assetChecks.length).toBeGreaterThanOrEqual(2)
  for (const asset of report.assetChecks) { expect(asset.exact).toBe(true); expect(asset.hashMatches).toBe(true); expect([asset.width, asset.height]).toEqual([8, 8]) }
  expect(report.snapshotChecks.map(row => row.kind).sort()).toEqual(['imported-auto', 'imported-auto', 'named', 'protection'])
  for (const row of report.snapshotChecks) { expect(row.owner).toBe(report.targetId); expect(row.historicalSceneId).toBe(report.oldOwner); expect(row.revision).toBe(row.sourceRevision); expect(row.hashMatches).toBe(true) }
  expect(report.lineageMatches).toBe(true); expect(report.propTokensMatch).toBe(true); expect(report.licensesMatch).toBe(true); expect(report.bindingsMatch).toBe(true); expect(report.appearanceMatches).toBe(true)
  expect(report.originalBytesExact).toBe(true); expect(report.sourceSchemas).toEqual([5]); expect(report.secretInProject).toBe(true); expect(report.playerIds).not.toContain('c3-secret')
  expect(report.actualSnapshotIds).toEqual(report.journalSnapshotIds)
})

test('M2-0d corrupt backup and cancellation preserve one mapping, committed restart cold-reads, and retries retain later edits', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const beforeRestart = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20d-fixtures.ts', conversionPath = '/src/application/migration/conversion.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20d-fixtures')
    const migration = await import(conversionPath) as typeof import('../src/application/migration/conversion')
    const source = await helper.seedLegacyFamily(), env = helper.migrationEnvironment()
    try {
      const initial = await migration.beginProjectConversion(source.reference, env)
      if (!initial.backup) throw new Error('Missing initial backup')
      const bad = await helper.rereadBackup(initial.backup); bad.volumes.values().next().value![40] ^= 1
      let corruptError = ''
      try { await migration.continueProjectConversion({ jobId: initial.job.jobId, backup: bad }, env) } catch (error) { corruptError = String(error) }
      const readyAfterBad = (await env.repository.list()).length
      const retry = await migration.beginProjectConversion(source.reference, env)
      await migration.cancelProjectConversion(retry.job.jobId, env)
      const cancelled = await env.repository.getJob(retry.job.jobId), readyAfterCancel = (await env.repository.list()).length
      const restarted = await migration.beginProjectConversion(source.reference, env)
      if (!restarted.backup) throw new Error('Retry needs the same full backup')
      let enteredPublish = false
      // Leave the native committed transaction intact and interrupt before publication.
      env.repository.publishConversion = async () => { enteredPublish = true; return new Promise<never>(() => {}) }
      const pending = migration.continueProjectConversion({ jobId: restarted.job.jobId, backup: await helper.rereadBackup(restarted.backup) }, env)
      void pending.catch(() => {})
      for (let attempt = 0; !enteredPublish && attempt < 500; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
      if (!enteredPublish) throw new Error('Conversion did not reach the committed/publish boundary')
      const committed = await env.repository.getJob(initial.job.jobId), readyBeforeRestart = (await env.repository.list()).length
      return { corruptError, readyAfterBad, readyAfterCancel, cancelStage: cancelled!.stage, readyBeforeRestart, committedStage: committed!.stage,
        jobId: initial.job.jobId, targetId: initial.job.targetSceneId, retryJob: retry.job.jobId, retryTarget: retry.job.targetSceneId,
        restartedJob: restarted.job.jobId, restartedTarget: restarted.job.targetSceneId, mapping: initial.job.snapshotIds, restartedMapping: restarted.job.snapshotIds,
        reference: source.reference }
    } finally { env.repository.close(); source.repository.close() }
  })
  expect(beforeRestart.corruptError).not.toBe(''); expect(beforeRestart.readyAfterBad).toBe(0); expect(beforeRestart.readyAfterCancel).toBe(0); expect(beforeRestart.cancelStage).toBe('cancelled')
  expect(beforeRestart.committedStage).toBe('committed'); expect(beforeRestart.readyBeforeRestart).toBe(0)
  expect(beforeRestart.retryJob).toBe(beforeRestart.jobId); expect(beforeRestart.restartedJob).toBe(beforeRestart.jobId)
  expect(beforeRestart.retryTarget).toBe(beforeRestart.targetId); expect(beforeRestart.restartedTarget).toBe(beforeRestart.targetId); expect(beforeRestart.restartedMapping).toEqual(beforeRestart.mapping)
  await page.reload()
  const afterRestart = await page.evaluate(async previous => {
    const helperPath = '/tests/helpers/m20d-fixtures.ts', conversionPath = '/src/application/migration/conversion.ts', sharedPath = '/src/shared/index.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20d-fixtures')
    const migration = await import(conversionPath) as typeof import('../src/application/migration/conversion')
    const shared = await import(sharedPath) as typeof import('../src/shared/index')
    const env = helper.migrationEnvironment()
    try {
      const prior = await env.repository.getJob(previous.jobId), hiddenBefore = await env.repository.load(previous.targetId)
      const recovered = await migration.continueProjectConversion({ jobId: previous.jobId }, env)
      const current = recovered.bundle, content = shared.applyCompositionCommands({ document: current.project.document, historyIdentity: current.project.historyIdentity, appearance: current.project.appearance },
        [{ type: 'updateProp', id: 'c3-left', changes: { rotationDeg: 25 } }], env.runtime)
      const changed = { project: { ...current.project, ...content, document: { ...content.document, revision: current.project.document.revision + 1, title: 'Manual edit after ready' } }, resources: current.resources }
      await env.repository.save(changed, 0)
      const continued = await migration.continueProjectConversion({ jobId: previous.jobId }, env)
      const again = await migration.beginProjectConversion(previous.reference, env)
      return { priorStage: prior!.stage, hiddenBefore: hiddenBefore === null, recoveredStage: recovered.job.stage, recoveredTarget: recovered.job.targetSceneId,
        laterRevision: continued.bundle.project.document.revision, laterTitle: continued.bundle.project.document.title, laterRotation: continued.bundle.project.document.props['c3-left'].rotationDeg,
        reused: continued.reused, readyCount: (await env.repository.list()).length, beginReused: again.reused?.project.document.title,
        beginJob: again.job.jobId, beginBackupAbsent: again.backup === null }
    } finally { env.repository.close() }
  }, beforeRestart)
  expect(afterRestart.priorStage).toBe('committed'); expect(afterRestart.hiddenBefore).toBe(true); expect(afterRestart.recoveredStage).toBe('verified'); expect(afterRestart.recoveredTarget).toBe(beforeRestart.targetId)
  expect(afterRestart.laterRevision).toBe(1); expect(afterRestart.laterTitle).toBe('Manual edit after ready'); expect(afterRestart.laterRotation).toBe(25); expect(afterRestart.reused).toBe(true)
  expect(afterRestart.readyCount).toBe(1); expect(afterRestart.beginJob).toBe(beforeRestart.jobId); expect(afterRestart.beginBackupAbsent).toBe(true); expect(afterRestart.beginReused).toBe('Manual edit after ready')
})

test('M2-0d a changed source blocks default publication and explicitly captured-copy preserves both branches', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20d-fixtures.ts', conversionPath = '/src/application/migration/conversion.ts', capturePath = '/src/compat/legacy/capture.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20d-fixtures')
    const migration = await import(conversionPath) as typeof import('../src/application/migration/conversion')
    const capture = await import(capturePath) as typeof import('../src/compat/legacy/capture')
    const source = await helper.seedLegacyFamily(), env = helper.migrationEnvironment()
    try {
      const initial = await migration.beginProjectConversion(source.reference, env)
      if (!initial.backup) throw new Error('Missing preservation set')
      const readback = await helper.rereadBackup(initial.backup), changed = await helper.editLegacySource(source.current, source.repository)
      const changedFingerprint = (await capture.captureLegacyFamily(source.reference)).sourceFingerprint
      let error = ''
      try { await migration.continueProjectConversion({ jobId: initial.job.jobId, backup: readback }, env) } catch (caught) { error = String(caught) }
      const readyAfterDefault = (await env.repository.list()).length
      const explicit = await migration.continueProjectConversion({ jobId: initial.job.jobId, backup: readback, sourcePolicy: 'captured-copy' }, env)
      const after = await capture.captureLegacyFamily(source.reference), old = await source.repository.load(source.reference.sceneId)
      return { error, readyAfterDefault, capturedFingerprint: initial.job.sourceFingerprint, changedFingerprint, afterFingerprint: after.sourceFingerprint,
        finalStage: explicit.job.stage, sourceState: explicit.sourceState, jobId: explicit.job.jobId, initialJobId: initial.job.jobId,
        sourceRevision: old!.document.revision, sourceTitle: old!.document.title, changedRevision: changed.document.revision,
        targetRevision: explicit.bundle.project.document.revision, targetTitle: explicit.bundle.project.document.title, targetRotation: explicit.bundle.project.document.props['c3-right'].rotationDeg,
        readyCount: (await env.repository.list()).length }
    } finally { env.repository.close(); source.repository.close() }
  })
  expect(report.error).not.toBe(''); expect(report.readyAfterDefault).toBe(0); expect(report.changedFingerprint).not.toBe(report.capturedFingerprint)
  expect(report.afterFingerprint).toBe(report.changedFingerprint); expect(report.finalStage).toBe('verified'); expect(report.sourceState).toBe('changed'); expect(report.jobId).toBe(report.initialJobId)
  expect(report.sourceRevision).toBe(report.changedRevision); expect(report.sourceRevision).toBe(2); expect(report.sourceTitle).toBe('New source edit after backup')
  expect(report.targetRevision).toBe(0); expect(report.targetTitle).toBe('M2-0d preserved source'); expect(report.targetRotation).toBe(5); expect(report.readyCount).toBe(1)
})

test('M2-0d an uploaded native v6 history file retains exact original ZIP bytes and selected historical identities without database source checks', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m20d-fixtures.ts', conversionPath = '/src/application/migration/conversion.ts'
    const capturePath = '/src/compat/legacy/capture.ts', oldIoPath = '/src/io/v6/project-file.ts', sharedPath = '/src/shared/index.ts'
    const repositoryPath = '/src/platform/browser/storage/repository.ts'
    const helper = await import(helperPath) as typeof import('./helpers/m20d-fixtures')
    const migration = await import(conversionPath) as typeof import('../src/application/migration/conversion')
    const capture = await import(capturePath) as typeof import('../src/compat/legacy/capture')
    const oldIo = await import(oldIoPath) as typeof import('../src/io/v6/project-file')
    const shared = await import(sharedPath) as typeof import('../src/shared/index')
    const { ProjectRepository } = await import(repositoryPath) as typeof import('../src/platform/browser/storage/repository')
    const source = await helper.seedLegacyFamily(), env = helper.migrationEnvironment()
    let reopened = env.repository, databaseSourceChecks = 0
    // A file is an immutable source; this adapter would fail if conversion tried to
    // recheck an unrelated legacy database rather than its retained uploaded bytes.
    const fileEnv = { ...env, legacy: { factory: { open() { databaseSourceChecks++; throw new Error('File conversion must not open a legacy source database') } } as unknown as IDBFactory } }
    try {
      const beforeFingerprint = (await capture.captureLegacyFamily(source.reference)).sourceFingerprint
      const uploaded = await oldIo.exportHistoryArchiveV6({ project: source.current, snapshots: [source.named, source.protection] })
      const file = new File([await uploaded.arrayBuffer()], 'selected-source.sceneweave', { type: 'application/octet-stream' }), bytes = new Uint8Array(await file.arrayBuffer())
      const actualHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)), byte => byte.toString(16).padStart(2, '0')).join('')
      const begun = await migration.beginProjectFileConversion(bytes, fileEnv)
      if (!begun.backup) throw new Error('Uploaded file conversion must expose its preservation set')
      const index = JSON.parse(new TextDecoder().decode(begun.backup.index)) as { scope: { repository: string }; records: { role: string; rawSha256: string }[] }
      const completed = await migration.continueProjectConversion({ jobId: begun.job.jobId, backup: await helper.rereadBackup(begun.backup) }, fileEnv)
      env.repository.close(); reopened = new ProjectRepository({ runtime: env.runtime, validation: env.validation })
      const cold = await reopened.load(completed.job.targetSceneId), persisted = await reopened.readConversion(completed.job.jobId)
      if (!cold) throw new Error('Uploaded-file target failed its cold reopen')
      const node = persisted.family.legacySources.find(value => value.sourceSchemaVersion === 6), original = persisted.family.legacyBlobs.find(value => value.sha256 === node?.sourceHash)
      const historical = persisted.family.snapshots.map(snapshot => {
        const old = snapshot.kind === 'named' ? source.named : source.protection
        return { kind: snapshot.kind, owner: snapshot.ownerSceneId, sceneId: snapshot.bundle.project.document.sceneId,
          sourceRevision: snapshot.sourceRevision, documentRevision: snapshot.bundle.project.document.revision, expectedRevision: old.project.document.revision,
          tokensMatch: shared.canonicalJson(snapshot.bundle.project.historyIdentity.propTokens) === shared.canonicalJson(old.project.historyIdentity.propTokens),
          appearanceMatch: shared.canonicalJson(snapshot.bundle.project.appearance) === shared.canonicalJson(old.project.appearance),
          contentHashMatches: shared.projectContentHash(snapshot.bundle.project) === snapshot.contentHash }
      })
      const resourceExact = await Promise.all(Object.keys(cold.project.assets).map(async hash => {
        const actual = await cold.resources.read(hash), expected = new Uint8Array(await source.current.assets[hash].blob.arrayBuffer())
        return actual.length === expected.length && actual.every((value, index) => value === expected[index])
      }))
      return { finalStage: completed.job.stage, sourceState: completed.sourceState, repository: completed.job.sourceRepository, scopeRepository: index.scope.repository,
        setRoles: index.records.map(record => record.role), setRawHash: index.records[0].rawSha256, actualHash,
        targetId: completed.job.targetSceneId, oldOwner: source.reference.sceneId, currentRevision: cold.project.document.revision,
        originalSchema: node?.sourceSchemaVersion, originalHash: node?.sourceHash,
        originalExact: !!original && original.bytes.length === bytes.length && original.bytes.every((value, index) => value === bytes[index]),
        historical, importedCount: persisted.family.importedSnapshots.length, resourceExact,
        mappedSourceIds: Object.keys(completed.job.snapshotIds).map(key => (JSON.parse(key) as { id: string }).id).sort(),
        oldSnapshotIds: [source.named.id, source.protection.id].sort(),
        databaseSourceChecks, beforeFingerprint, afterFingerprint: (await capture.captureLegacyFamily(source.reference)).sourceFingerprint,
        readyCount: (await reopened.list()).length }
    } finally { reopened.close(); env.repository.close(); source.repository.close() }
  })
  expect(report.finalStage).toBe('verified'); expect(report.sourceState).toBe('unchanged'); expect(report.repository).toBe('file-v6'); expect(report.scopeRepository).toBe('file-v6')
  expect(report.databaseSourceChecks).toBe(0); expect(report.setRoles).toEqual(['current']); expect(report.setRawHash).toBe(report.actualHash)
  expect(report.originalSchema).toBe(6); expect(report.originalHash).toBe(report.actualHash); expect(report.originalExact).toBe(true)
  expect(report.targetId).not.toBe(report.oldOwner); expect(report.currentRevision).toBe(0); expect(report.importedCount).toBe(0); expect(report.readyCount).toBe(1)
  expect(report.historical.map(snapshot => snapshot.kind).sort()).toEqual(['named', 'protection'])
  for (const snapshot of report.historical) {
    expect(snapshot.owner).toBe(report.targetId); expect(snapshot.sceneId).toBe(report.oldOwner); expect(snapshot.sourceRevision).toBe(snapshot.expectedRevision)
    expect(snapshot.documentRevision).toBe(snapshot.expectedRevision); expect(snapshot.tokensMatch).toBe(true); expect(snapshot.appearanceMatch).toBe(true); expect(snapshot.contentHashMatches).toBe(true)
  }
  expect(report.resourceExact.every(Boolean)).toBe(true); expect(report.mappedSourceIds).toEqual(report.oldSnapshotIds); expect(report.afterFingerprint).toBe(report.beforeFingerprint)
})
