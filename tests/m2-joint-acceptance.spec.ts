import { expect, test, chromium, type Page, type TestInfo } from '@playwright/test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function report(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}
async function readState(page: Page) {
  return page.evaluate(async () => {
    // Vite may append a dependency HMR timestamp even before a new page loads.
    // Read the exact module used by React instead of constructing a second,
    // empty Workspace through an unversioned import.
    const loaded = performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname.endsWith('/src/editor/main/Workbench.tsx')).at(-1)
    const path = loaded?.name ?? '/src/editor/main/Workbench.tsx', { nativeWorkspace } = await import(path)
    const state = nativeWorkspace.getState(), project = state.project
    if (!project) throw new Error('Expected active native workspace project')
    return { status: state.status, canUndo: state.canUndo, document: structuredClone(project.document), identity: structuredClone(project.historyIdentity), appearance: structuredClone(project.appearance) }
  })
}
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 45_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 45_000 })
}
async function blank(page: Page, title: string) {
  await page.goto('/#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled(page)
}

for (const sample of ['VIS-01-S01', 'VIS-02-S01', 'VIS-02-S02', 'M2-SECRET-DOOR'] as const) {
  test(`native privacy A/B ${sample}: private edits leave actual player 4K pixels and metadata unchanged`, async ({ page, browser }, info) => {
    await page.goto('/')
    const result = await page.evaluate(async sample => {
      const helperPath = '/tests/helpers/m2-joint-browser.ts', renderPath = '/src/platform/browser/render/renderer.ts', projectionPath = '/src/shared/projection/projection.ts'
      const { nativePrivacyPair, readActualPng } = await import(helperPath) as typeof import('./helpers/m2-joint-browser')
      const { exportPng, renderProject } = await import(renderPath) as typeof import('../src/platform/browser/render/renderer')
      const { projectScene } = await import(projectionPath) as typeof import('../src/shared/projection/projection')
      const pair = await nativePrivacyPair(sample), before = [JSON.stringify(pair.a.project), JSON.stringify(pair.b.project)]
      const outputs: any[] = []
      for (const audience of ['player', 'gm'] as const) {
        const longEdgePx = audience === 'player' ? 4096 : 1024
        const a = await readActualPng(await exportPng(pair.a, { audience, longEdgePx })), b = await readActualPng(await exportPng(pair.b, { audience, longEdgePx }))
        let differingChannels = 0, opaque = true, maxDifference = 0
        const firstDifferences: { x: number; y: number; channel: number; a: number; b: number }[] = []
        if (a.pixels.length !== b.pixels.length) throw new Error('Private edit changed export dimensions')
        for (let index = 0; index < a.pixels.length; index++) {
          if (a.pixels[index] !== b.pixels[index]) {
            differingChannels++; maxDifference = Math.max(maxDifference, Math.abs(a.pixels[index] - b.pixels[index]))
            if (firstDifferences.length < 20) firstDifferences.push({ x: Math.floor(index / 4) % a.width, y: Math.floor(index / 4 / a.width), channel: index % 4, a: a.pixels[index], b: b.pixels[index] })
          }
          if (index % 4 === 3 && a.pixels[index] !== 255) opaque = false
        }
        outputs.push({ audience, width: a.width, height: a.height, hashA: a.rgbaHash, hashB: b.rgbaHash, differingChannels, opaque,
          chunks: a.chunks, maxDifference, firstDifferences, privateMarkers: pair.sentinels.filter(marker => a.rawText.includes(marker) || b.rawText.includes(marker)) })
      }
      // A second call after both audiences were rendered exercises the hot path
      // without reusing a GM projection. Pixel comparisons remain per browser.
      const previews: string[] = []
      for (const bundle of [pair.a, pair.b]) {
        const canvas = await renderProject(bundle, { audience: 'player', longEdgePx: 1024 })
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Actual preview encode failed')), 'image/png'))
        previews.push((await readActualPng(blob)).rgbaHash); canvas.width = canvas.height = 0
      }
      const projection = projectScene(pair.b.project.document, 'player'), playerJson = JSON.stringify(projection)
      const unsafe = { project: structuredClone(pair.b.project), resources: pair.b.resources }
      for (const [id, region] of Object.entries(unsafe.project.document.regions)) if (region.kind === 'manualMask') { delete unsafe.project.document.regions[id]; delete unsafe.project.document.entityLayers[id] }
      let unsafeError = ''
      try { projectScene(unsafe.project.document, 'player') } catch (error) { unsafeError = String(error) }
      return { sample, outputs, previews, privateResourcesInPlayerProjection: pair.privateAssetIds.filter(id => projection.assetIds.includes(id)),
        projectionEqual: JSON.stringify(projectScene(pair.a.project.document, 'player')) === playerJson,
        publicResourcesEqual: projection.assetIds.every(id => pair.a.project.document.assets[id].sha256 === pair.b.project.document.assets[id].sha256),
        privateTextInPlayerProjection: pair.sentinels.filter(marker => playerJson.includes(marker)), masks: projection.masks.length, unsafeError,
        unchanged: before[0] === JSON.stringify(pair.a.project) && before[1] === JSON.stringify(pair.b.project), sourceFormat: pair.a.project.format,
        nativePrivateSvgCount: Object.keys(pair.b.project.authoringSources).length }
    }, sample)
    await report(info, `privacy-${sample}.json`, { browser: browser.version(), ...result })
    expect(result.sourceFormat).toBe('sceneweave-complete-project'); expect(result.unchanged).toBe(true); expect(result.projectionEqual).toBe(true); expect(result.publicResourcesEqual).toBe(true)
    expect(result.outputs[0].width).toBe(4096); expect(result.outputs[0].differingChannels).toBe(0); expect(result.outputs[0].hashA).toBe(result.outputs[0].hashB)
    expect(result.outputs[1].differingChannels).toBeGreaterThan(0); expect(result.previews[0]).toBe(result.previews[1])
    expect(result.privateResourcesInPlayerProjection).toEqual([]); expect(result.privateTextInPlayerProjection).toEqual([])
    expect(result.masks).toBeGreaterThan(0); expect(result.unsafeError).toContain('遮罩未覆盖')
    for (const output of result.outputs) { expect(output.opaque).toBe(true); expect(output.privateMarkers).toEqual([]); expect(output.chunks.every((chunk: string) => ['IHDR', 'IDAT', 'IEND', 'sRGB'].includes(chunk))).toBe(true) }
    if (sample === 'M2-SECRET-DOOR') expect(result.nativePrivateSvgCount).toBe(1)
  })
}

test('native protected restore failure rolls back actual IndexedDB and retains saved branch, memory, undo and recovery', async ({ page }, info) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m2-joint-browser.ts', { workspaceFixture, rows, toBundle } = await import(helperPath) as typeof import('./helpers/m2-joint-browser')
    const { workspace, repository, named } = await workspaceFixture(`m2-joint-fault-${crypto.randomUUID()}`), owner = workspace.getDocument()!.sceneId
    const snapshot = () => ({ document: structuredClone(workspace.getDocument()), status: workspace.getState().status, canUndo: workspace.getState().canUndo })
    const originalAdd = IDBObjectStore.prototype.add, originalPut = IDBObjectStore.prototype.put
    let phase = 'protect', hits = 0, injected = false
    IDBObjectStore.prototype.add = function(value: any, key?: IDBValidKey) {
      if (phase === 'protect' && this.name === 'snapshots' && value.kind === 'protection') { hits++; throw new DOMException('M2 deterministic protection abort', 'QuotaExceededError') }
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key)
    }
    IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
      if (phase === 'save' && this.name === 'projects' && value.revision === 2) { hits++; throw new DOMException('M2 deterministic adopted-save abort', 'QuotaExceededError') }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
    }
    try {
      const before = snapshot(), beforeRows = await rows(repository), preview = await workspace.prepareRestore(named.id, { ids: ['item'], mode: 'transform' })
      let protectionError = ''
      try { await workspace.applyRestore(preview) } catch (error) { protectionError = String(error) }
      const afterProtect = snapshot(), protectRows = await rows(repository)
      phase = 'save'
      const retryPreview = await workspace.prepareRestore(named.id, { ids: ['item'], mode: 'transform' }), protection = await workspace.applyRestore(retryPreview)
      let saveError = ''
      try { await workspace.flush() } catch (error) { saveError = String(error); injected = true }
      const failed = snapshot(), persisted = (await repository.load(owner))!, protectedRow = await repository.loadSnapshot(owner, protection.id), failedRows = await rows(repository)
      phase = 'none'
      workspace.undo(); const undoneRevision = workspace.getDocument()!.revision
      await workspace.retrySave(); workspace.redo(); await workspace.flush()
      const recovered = snapshot(), cold = (await repository.load(owner))!
      return { method: 'Deterministic native IDBObjectStore add/put QuotaExceededError; not actual quota exhaustion', hits, injected, protectionError, saveError,
        before, afterProtect, beforeRows, protectRows, failed, persistedRevision: persisted.project.document.revision, persistedRotation: persisted.project.document.props.item.rotationDeg,
        protectedRevision: protectedRow?.sourceRevision, failedRows, undoneRevision, recovered, coldMatches: JSON.stringify(cold.project) === JSON.stringify(toBundle(workspace.getState().project!).project) }
    } finally { phase = 'none'; IDBObjectStore.prototype.add = originalAdd; IDBObjectStore.prototype.put = originalPut; repository.close(); await repository.database.delete() }
  })
  expect(result.hits).toBe(2); expect(result.injected).toBe(true); expect(result.protectionError).toContain('protection abort'); expect(result.saveError).toContain('adopted-save abort')
  expect(result.afterProtect).toEqual(result.before); expect(result.protectRows).toEqual(result.beforeRows)
  expect(result.failed.document!.revision).toBe(2); expect(result.failed.document!.props.item.rotationDeg).toBe(0); expect(result.failed.status).toBe('error'); expect(result.failed.canUndo).toBe(true)
  expect(result.persistedRevision).toBe(1); expect(result.persistedRotation).toBe(25); expect(result.protectedRevision).toBe(1)
  expect(result.undoneRevision).toBe(3); expect(result.recovered.document!.revision).toBe(4); expect(result.recovered.document!.props.item.rotationDeg).toBe(0); expect(result.recovered.status).toBe('saved'); expect(result.coldMatches).toBe(true)
  await report(info, 'native-storage-failures.json', result)
})

test('browser enforced isolated quota failure rejects a new complete image project atomically and succeeds after quota restoration', async ({ page, context, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'CDP quota override is only available in Chromium.')
  const origin = new URL(info.project.use.baseURL ?? 'http://127.0.0.1:5173').origin
  // Enforce before the origin's first IDB access: overriding an already-open
  // origin leaves Chromium's old quota reservation usable until exhausted.
  const cdp = await context.newCDPSession(page)
  await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 512 * 1024 })
  await page.goto('/')
  const seeded = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m2-joint-browser.ts', helper = await import(helperPath)
    const env = await helper.workspaceFixture(`m2-joint-real-quota-${crypto.randomUUID()}`)
    Reflect.set(window, '__jointQuota', env)
    return { owner: env.workspace.getDocument().sceneId, rows: await helper.rows(env.repository), title: env.workspace.getDocument().title }
  })
  const enforced = await cdp.send('Storage.getUsageAndQuota', { origin })
  let failed: any
  try { failed = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m2-joint-browser.ts', fixturePath = '/tests/helpers/m24-svg-fixtures.ts', compositionPath = '/src/shared/appearance/graph.ts', resourcePath = '/src/shared/project/resources.ts', binaryPath = '/src/shared/project/binary.ts'
    const helper = await import(helperPath), { svgProjectFixture } = await import(fixturePath), { createCompositionContent } = await import(compositionPath), { createMemoryResources } = await import(resourcePath), { sha256Bytes } = await import(binaryPath)
    const env = Reflect.get(window, '__jointQuota'), fixture = svgProjectFixture(), canvas = globalThis.document.createElement('canvas'); canvas.width = canvas.height = 2048
    const ctx = canvas.getContext('2d')!, image = ctx.createImageData(2048, 2048)
    for (let i = 0; i < image.data.length; i += 65536) crypto.getRandomValues(new Uint8Array(image.data.buffer, i, Math.min(65536, image.data.length - i)))
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255
    ctx.putImageData(image, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Actual quota PNG encode failed')), 'image/png')), bytes = new Uint8Array(await blob.arrayBuffer()), hash = sha256Bytes(bytes)
    canvas.width = canvas.height = 0
    const data = structuredClone(fixture.bundle.project), document = data.document
    document.sceneId = crypto.randomUUID(); document.title = 'Actual isolated quota candidate'
    Object.assign(document.assets.image, { sha256: hash, pixelWidth: 2048, pixelHeight: 2048 })
    Object.assign(data, createCompositionContent(document, helper.runtime)); data.authoringSources = {}; data.assets = { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 2048, pixelHeight: 2048 } }
    const projectPath = '/src/application/workspace/project.ts', { fromBundle } = await import(projectPath)
    const candidate = await fromBundle({ project: data, resources: createMemoryResources(new Map([[hash, bytes]])) }, helper.validation)
    Reflect.set(window, '__jointQuotaCandidate', candidate)
    let errorName = '', error = ''
    try { await env.workspace.adoptNew(candidate) } catch (e) { errorName = e instanceof Error ? e.name : ''; error = String(e) }
    return { errorName, error, imageBytes: bytes.length, owner: env.workspace.getDocument().sceneId, candidateOwner: document.sceneId,
      title: env.workspace.getDocument().title, status: env.workspace.getState().status, rows: await helper.rows(env.repository), ready: await env.repository.list() }
  })
  const afterUsage = await cdp.send('Storage.getUsageAndQuota', { origin })
  await report(info, 'quota-first-observation.json', { enforced, afterUsage, seeded, failed })
  expect(failed.error).toContain('QuotaExceededError')
  expect(['QuotaExceededError', 'AbortError']).toContain(failed.errorName)
  } finally { await cdp.send('Storage.overrideQuotaForOrigin', { origin }) }
  const recovered = await page.evaluate(async () => {
    const env = Reflect.get(window, '__jointQuota'), candidate = Reflect.get(window, '__jointQuotaCandidate')
    await env.workspace.adoptNew(candidate)
    const current = await env.repository.load(candidate.document.sceneId), result = { saved: env.workspace.getState().status, owner: current.project.document.sceneId, assets: Object.keys(current.project.assets).length, ready: (await env.repository.list()).length }
    env.repository.close(); await env.repository.database.delete(); return result
  })
  expect(enforced.overrideActive).toBe(true); expect(enforced.quota).toBe(512 * 1024); expect(failed.imageBytes).toBeGreaterThan(512 * 1024)
  expect(failed.error).toContain('QuotaExceededError'); expect(failed.owner).toBe(seeded.owner); expect(failed.title).toBe(seeded.title); expect(failed.rows).toEqual(seeded.rows); expect(failed.ready).toHaveLength(1)
  expect(recovered.saved).toBe('saved'); expect(recovered.owner).toBe(failed.candidateOwner); expect(recovered.assets).toBe(1); expect(recovered.ready).toBe(2)
  await report(info, 'browser-enforced-isolated-quota.json', { method: 'Chromium native storage quota enforcement in a fresh test browser context; CDP origin quota 512KiB enforced before any IDB access; no exception injection or user disk filling. This does not establish default device quota/capacity.', enforced, seeded, failed, recovered })
})

test('native two-page revision and metadata CAS preserve both editable branches and reject a stale protection guard', async ({ page, context }, info) => {
  await page.goto('/')
  const name = `m2-joint-cas-${crypto.randomUUID()}`
  const seeded = await page.evaluate(async name => {
    const path = '/tests/helpers/m2-joint-browser.ts', helper = await import(path) as typeof import('./helpers/m2-joint-browser')
    const env = await helper.workspaceFixture(name); Reflect.set(window, '__jointCAS', env)
    return { owner: env.workspace.getDocument()!.sceneId, namedId: env.named.id }
  }, name)
  const second = await context.newPage(); await second.goto('/')
  await second.evaluate(async ({ name, owner }) => {
    const helperPath = '/tests/helpers/m2-joint-browser.ts', workspacePath = '/src/application/workspace/workspace.ts', repositoryPath = '/src/platform/browser/storage/repository.ts', projectPath = '/src/application/workspace/project.ts'
    const { runtime, validation } = await import(helperPath), { Workspace } = await import(workspacePath), { ProjectRepository } = await import(repositoryPath), { fromBundle } = await import(projectPath)
    const repository = new ProjectRepository({ name, runtime, validation }), workspace = new Workspace(repository, { runtime, validation })
    await workspace.openPersisted(await fromBundle(await repository.load(owner), validation)); Reflect.set(window, '__jointCAS', { repository, workspace })
  }, { name, owner: seeded.owner })
  await page.evaluate(async () => { const { workspace } = Reflect.get(window, '__jointCAS'); await workspace.updateProp('item', { rotationDeg: 45 }); await workspace.flush() })
  const loser = await second.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__jointCAS'); await workspace.updateProp('item', { rotationDeg: 70 }); let error = ''
    try { await workspace.flush() } catch (e) { error = String(e) }
    const beforeCopy = { error, state: workspace.getState().status, canUndo: workspace.getState().canUndo, rotation: workspace.getDocument().props.item.rotationDeg, owner: workspace.getDocument().sceneId }
    await workspace.saveAsCopy(); const copy = workspace.getDocument()
    return { ...beforeCopy, copyOwner: copy.sceneId, copyRevision: copy.revision, copyRotation: copy.props.item.rotationDeg, saved: workspace.getState().status, list: await repository.list() }
  })
  const guard = await page.evaluate(async owner => {
    const { repository, workspace } = Reflect.get(window, '__jointCAS'), current = await repository.load(owner), usage = await repository.usage(owner)
    const protection = await repository.createSnapshot(current, 'CAS protection', { kind: 'protection', expectedRevision: 2, expectedMetadataVersion: usage.metadataVersion })
    const guard = { expectedMetadataVersion: usage.metadataVersion + 1, protection: { id: protection.id, contentHash: protection.contentHash } }
    await repository.checkProtection(owner, 2, protection.contentHash, guard)
    Reflect.set(window, '__jointGuard', { current, guard }); return { metadataVersion: guard.expectedMetadataVersion, namedId: (await repository.listSnapshots(owner)).find((value: any) => value.kind === 'named').id }
  }, seeded.owner)
  await second.evaluate(async owner => { const { repository } = Reflect.get(window, '__jointCAS'), current = await repository.load(owner), usage = await repository.usage(owner); await repository.createSnapshot(current, 'Other page metadata', { expectedRevision: 2, expectedMetadataVersion: usage.metadataVersion }) }, seeded.owner)
  const rejected = await page.evaluate(async owner => {
    const { repository } = Reflect.get(window, '__jointCAS'), { current, guard } = Reflect.get(window, '__jointGuard')
    const candidate = { project: structuredClone(current.project), resources: current.resources }; candidate.project.document.revision = 3; candidate.project.document.props.item.rotationDeg = 95
    let error = ''
    try { await repository.save(candidate, 2, { guard }) } catch (e) { error = String(e) }
    return { error, persisted: (await repository.load(owner)).project.document, candidateRotation: candidate.project.document.props.item.rotationDeg, snapshots: await repository.listSnapshots(owner), usage: await repository.usage(owner) }
  }, seeded.owner)
  expect(loser.error).toContain('版本冲突'); expect(loser.state).toBe('conflict'); expect(loser.rotation).toBe(70); expect(loser.canUndo).toBe(true)
  expect(loser.copyOwner).not.toBe(loser.owner); expect(loser.copyRotation).toBe(70); expect(loser.copyRevision).toBe(0); expect(loser.saved).toBe('saved'); expect(loser.list).toHaveLength(2)
  expect(rejected.error).toContain('历史元数据'); expect(rejected.persisted.revision).toBe(2); expect(rejected.persisted.props.item.rotationDeg).toBe(45); expect(rejected.candidateRotation).toBe(95)
  expect(rejected.usage.metadataVersion).toBe(guard.metadataVersion + 1); expect(rejected.snapshots.filter((v: any) => v.kind === 'protection')).toHaveLength(1)
  await report(info, 'native-two-page-cas.json', { name, seeded, loser, guard, rejected })
  await second.evaluate(() => Reflect.get(window, '__jointCAS').repository.close()); await second.close()
  await page.evaluate(async () => { const { repository } = Reflect.get(window, '__jointCAS'); repository.close(); await repository.database.delete() })
})

test('all six legacy repositories convert only after reread preservation and keep source rows, complete ancestry and independent native identities', async ({ page }, info) => {
  test.setTimeout(240_000)
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/helpers/u1a-browser.ts', helperPath = '/tests/helpers/m20d-fixtures.ts', conversionPath = '/src/application/migration/conversion.ts', capturePath = '/src/compat/legacy/capture.ts', setPath = '/src/shared/migration/set.ts'
    const fixture = await import(fixturePath), helper = await import(helperPath), migration = await import(conversionPath), capture = await import(capturePath), { importMigrationSet } = await import(setPath)
    const seeded = await fixture.seedU1ADiscoveryFixture(), env = helper.migrationEnvironment(), before = await fixture.fingerprintU1ADatabases()
    const converted = []
    try {
      for (const repository of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] as const) {
        const reference = { repository, sceneId: seeded.sceneId }, initial = await capture.captureLegacyFamily(reference), start = await migration.beginProjectConversion(reference, env)
        if (!start.backup) throw new Error('A new conversion must require reread preservation')
        const reread = await helper.rereadBackup(start.backup), recovered = await importMigrationSet(reread.index, reread.volumes)
        const exactPreservation = initial.records.every((record: any) => recovered.records.some((actual: any) => actual.role === record.role && actual.recordKey === record.recordKey && actual.contentHash === record.contentHash && actual.bytes.length === record.bytes.length && actual.bytes.every((value: number, index: number) => value === record.bytes[index])))
        const done = await migration.continueProjectConversion({ jobId: start.job.jobId, backup: reread }, env)
        const cold = await env.repository.load(done.job.targetSceneId), originals = await env.repository.listLegacySources(done.job.targetSceneId)
        const exactOriginals = []
        for (const original of originals) {
          const actual = await env.repository.loadLegacyOriginal(done.job.targetSceneId, original.nodeId)
          exactOriginals.push({ schema: original.sourceSchemaVersion, hash: original.sourceHash, bytes: actual.bytes.length })
        }
        converted.push({ repository, stage: done.job.stage, oldId: seeded.sceneId, newId: done.job.targetSceneId, revision: cold.project.document.revision,
          format: cold.project.format, sourceUnchanged: (await capture.captureLegacyFamily(reference)).sourceFingerprint === initial.sourceFingerprint,
          preservedRoles: recovered.records.map((v: any) => v.role), exactPreservation,
          originalSchemas: originals.map((v: any) => v.sourceSchemaVersion), exactOriginals, snapshots: (await env.repository.listSnapshots(done.job.targetSceneId)).map((v: any) => v.kind) })
      }
      return { before, after: await fixture.fingerprintU1ADatabases(), converted, nativeReady: (await env.repository.list()).length }
    } finally { env.repository.close() }
  })
  expect(result.after).toEqual(result.before); expect(result.nativeReady).toBe(6); expect(new Set(result.converted.map(value => value.newId)).size).toBe(6)
  for (const value of result.converted) {
    expect(value.stage).toBe('verified'); expect(value.format).toBe('sceneweave-complete-project'); expect(value.newId).not.toBe(value.oldId); expect(value.revision).toBe(0); expect(value.sourceUnchanged).toBe(true)
    expect(value.exactPreservation).toBe(true); expect(value.preservedRoles).toContain('current'); expect(value.exactOriginals.every((row: any) => row.bytes > 0)).toBe(true)
    expect(value.originalSchemas).toEqual([]); expect(value.snapshots).toEqual(value.repository === 'v6' ? ['imported-auto'] : [])
  }
  expect(result.converted[3].preservedRoles).toContain('named'); expect(result.converted[4].preservedRoles).toContain('named')
  await report(info, 'six-legacy-native-preservation.json', result)
})

test('selected SVG history archive imports in an empty native database offline and remains editable with exact original source/license bytes', async ({ page, context, browserName }, info) => {
  await page.goto('/')
  const transfer = await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m2-joint-browser.ts', filePath = '/src/shared/project/file.ts'
    const { workspaceFixture, toBundle } = await import(helperPath), { exportHistoryArchive } = await import(filePath)
    const { workspace, repository, named, fixture } = await workspaceFixture(`m2-joint-offline-source-${crypto.randomUUID()}`)
    const { validation } = await import(helperPath), owner = workspace.getDocument()!.sceneId
    const archive = { current: toBundle(workspace.getState().project!), snapshots: [(await repository.loadSnapshot(owner, named.id))!] }
    const bytes = await exportHistoryArchive(archive, validation), blob = new Blob([bytes])
    const base64 = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob) })
    const expected = { source: fixture.normalized.sourceSvg, normalized: fixture.normalized.normalizedSource, sources: archive.current.project.authoringSources,
      assets: archive.current.project.assets, licenses: archive.current.project.licenses, physical: archive.current.project.document.props.item.footprintMm }
    repository.close(); await repository.database.delete()
    return { base64, expected, owner }
  })
  // Load the application's modules before going offline. This does not claim PWA
  // cold start: no network modules or external assets are fetched after this point.
  await page.evaluate(async () => {
    const helperPath = '/tests/helpers/m2-joint-browser.ts', filePath = '/src/shared/project/file.ts', repositoryPath = '/src/platform/browser/storage/repository.ts', workspacePath = '/src/application/workspace/workspace.ts', projectPath = '/src/application/workspace/project.ts', renderPath = '/src/platform/browser/render/renderer.ts'
    const [helper, io, repo, workspace, project, render] = await Promise.all([import(helperPath), import(filePath), import(repositoryPath), import(workspacePath), import(projectPath), import(renderPath)])
    Reflect.set(window, '__jointOffline', { helper, io, repo, workspace, project, render })
  })
  let requestsAfterOffline = 0; page.on('request', request => { if (request.url().startsWith('http')) requestsAfterOffline++ })
  // WebKit's offline emulation also rejects local Blob decoding/reads. Deny all
  // HTTP(S) there while retaining the real local image/storage APIs under test.
  const denyNetwork = (route: import('@playwright/test').Route) => route.abort('internetdisconnected')
  if (browserName === 'webkit') await context.route(/^https?:/, denyNetwork)
  else await context.setOffline(true)
  const result = await page.evaluate(async transfer => {
    const { helper, io, repo, workspace: w, project: p, render } = Reflect.get(window, '__jointOffline')
    const repository = new repo.ProjectRepository({ name: `m2-joint-empty-${crypto.randomUUID()}`, runtime: helper.runtime, validation: helper.validation })
    const initial = await repository.list(), bytes = Uint8Array.from(atob(transfer.base64), value => value.charCodeAt(0))
    const archive = await io.importHistoryArchive(bytes, helper.validation), imported = await repository.importArchive(archive)
    const owner = imported.project.project.document.sceneId, snapshots = await repository.listSnapshots(owner), historical = (await repository.loadSnapshot(owner, snapshots[0].id))!
    const workspace = new w.Workspace(repository, { runtime: helper.runtime, validation: helper.validation })
    await workspace.openPersisted(await p.fromBundle(imported.project, helper.validation))
    const preview = await workspace.prepareRestore(snapshots[0].id, { ids: ['item'], mode: 'transform' }); await workspace.applyRestore(preview); await workspace.flush()
    const current = (await repository.load(owner))!, source: any = Object.values(current.project.authoringSources)[0], decode = (value: Uint8Array) => new TextDecoder().decode(value)
    const actualSource = decode(await current.resources.read(source.sourceSha256)), actualNormalized = decode(await current.resources.read(source.normalizedSha256))
    const png = await helper.readActualPng(await render.exportPng(current, { audience: 'gm', longEdgePx: 4096 }))
    const reexport = await io.importHistoryArchive(await io.exportHistoryArchive({ current, snapshots: [historical] }, helper.validation), helper.validation)
    const result = { initialCount: initial.length, owner, oldOwner: transfer.owner, snapshots: snapshots.map((v: any) => ({ kind: v.kind, name: v.name })),
      source: actualSource, normalized: actualNormalized, sources: current.project.authoringSources, assets: current.project.assets, licenses: current.project.licenses,
      footprint: current.project.document.props.item.footprintMm, restoredRotation: current.project.document.props.item.rotationDeg,
      revision: current.project.document.revision, png: { width: png.width, height: png.height, chunks: png.chunks },
      historySourceExact: JSON.stringify(reexport.snapshots[0].bundle.project.authoringSources) === JSON.stringify(historical.bundle.project.authoringSources),
      namedCount: (await repository.usage(owner)).namedCount, protectionCount: (await repository.usage(owner)).protectionCount }
    repository.close(); await repository.database.delete(); return result
  }, transfer)
  if (browserName === 'webkit') await context.unroute(/^https?:/, denyNetwork)
  else await context.setOffline(false)
  expect(result.initialCount).toBe(0); expect(result.owner).not.toBe(result.oldOwner); expect(result.snapshots).toEqual([{ kind: 'named', name: 'Joint SVG baseline' }])
  expect(result.source).toBe(transfer.expected.source); expect(result.normalized).toBe(transfer.expected.normalized); expect(result.sources).toEqual(transfer.expected.sources)
  expect(result.assets).toEqual(transfer.expected.assets); expect(result.licenses).toEqual(transfer.expected.licenses); expect(result.footprint).toEqual(transfer.expected.physical)
  expect(result.restoredRotation).toBe(0); expect(result.revision).toBe(1); expect(result.png.width).toBe(4096); expect(result.historySourceExact).toBe(true)
  expect(result.namedCount).toBe(1); expect(result.protectionCount).toBe(1); expect(requestsAfterOffline).toBe(0)
  await report(info, 'native-offline-selected-svg-history.json', { ...result, requestsAfterOffline, networkDenial: browserName === 'webkit' ? 'all HTTP(S) aborted; local Blob APIs enabled' : 'native browser offline emulation' })
})

test('390px actual mixed-tool UI, named restore, reload, keyboard drawers and failed import preserve the native project', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 }); await blank(page, 'M2 390px mixed acceptance')
  const resourceTrigger = page.getByRole('button', { name: '资源面板', exact: true }), navigationTrigger = page.getByRole('button', { name: '场景导航', exact: true })
  await resourceTrigger.click(); await page.getByTestId('workspace-resources').getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByLabel('房间名称', { exact: true }).fill('窄屏值守室'); await page.getByRole('button', { name: '预览新房间', exact: true }).click()
  await page.getByRole('button', { name: '关闭资源面板', exact: true }).click()
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check(); await page.getByRole('button', { name: '采用结构修改', exact: true }).click(); await settled(page)
  await resourceTrigger.click()
  await page.getByTestId('workspace-resources').getByRole('tab', { name: '素材库', exact: true }).click()
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯'); await library.getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  await page.getByRole('button', { name: '关闭资源面板', exact: true }).click(); await expect(resourceTrigger).toBeFocused()
  await page.getByRole('button', { name: '属性面板', exact: true }).click(); await page.getByRole('button', { name: '在此放置', exact: true }).click(); await settled(page)
  await page.getByRole('button', { name: '关闭属性面板', exact: true }).click()
  await resourceTrigger.click(); await page.getByTestId('workspace-resources').getByRole('tab', { name: '室外', exact: true }).click()
  await page.getByLabel('室外坐标', { exact: true }).fill('10000,1000\n13000,1000\n13000,4500\n10000,4500')
  await page.getByRole('button', { name: '预览室外修改', exact: true }).click(); await page.getByRole('button', { name: '关闭资源面板', exact: true }).click(); await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check(); await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await settled(page)
  await navigationTrigger.click(); await page.getByTestId('workspace-navigation').getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click(); await page.getByLabel('命名快照名称', { exact: true }).fill('390px mixed baseline'); await page.getByRole('button', { name: '保存快照', exact: true }).click(); await settled(page)
  await page.getByRole('button', { name: '关闭场景导航', exact: true }).click()
  const mixed = await readState(page), propId = Object.keys(mixed.document.props)[0]
  await page.getByRole('button', { name: '属性面板', exact: true }).click()
  await page.getByLabel('外观调整项目', { exact: true }).selectOption('opacity'); await page.getByLabel('外观透明度', { exact: true }).fill('0.55')
  await page.getByRole('button', { name: '预览外观调整', exact: true }).click(); await page.getByRole('button', { name: '关闭属性面板', exact: true }).click(); await page.getByRole('button', { name: '采用组件修改', exact: true }).click(); await settled(page)
  await navigationTrigger.click(); await page.getByRole('button', { name: '查看快照 390px mixed baseline', exact: true }).click()
  await page.getByLabel('局部恢复模式', { exact: true }).selectOption('appearance'); await page.getByRole('checkbox', { name: `恢复物件 ${propId}`, exact: true }).check()
  await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click(); await page.getByRole('button', { name: '关闭场景导航', exact: true }).click(); await page.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check(); await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled(page)
  const restored = await readState(page); expect(restored.document.props[propId].appearance.opacity).toBe(1); expect(restored.document.terrainAreas).toEqual(mixed.document.terrainAreas); expect(restored.document.rooms).toEqual(mixed.document.rooms)
  for (const label of ['资源面板', '属性面板', '场景导航']) {
    const trigger = page.getByRole('button', { name: label, exact: true }); await trigger.focus(); await trigger.press('Enter')
    await expect(page.getByRole('region', { name: label, exact: true })).toBeVisible()
    await info.attach(`390px-${label}.png`, { body: await page.screenshot(), contentType: 'image/png' })
    await page.getByRole('button', { name: `关闭${label}`, exact: true }).focus(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
  }
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '4K PNG', exact: true }).click()
  const pngDownload = await download; expect(pngDownload.suggestedFilename()).toBe('sceneweave-gm-map.png')
  const stream = await pngDownload.createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const pngBytes = Buffer.concat(chunks); expect(pngBytes.readUInt32BE(16)).toBe(4096)
  await settled(page); expect((await readState(page)).document).toEqual(restored.document)
  const overflow = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }))
  expect(overflow.width).toBeLessThanOrEqual(overflow.viewport)
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click(); await settled(page); expect((await readState(page)).document).toEqual(restored.document)
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('native-project-file').setInputFiles({ name: 'truncated.sceneweave', mimeType: 'application/octet-stream', buffer: Buffer.from([80, 75, 3, 4, 0]) })
  await expect(page.locator('.workspace-notice')).toContainText(/导入失败|不能读取|无效|损坏|ZIP/i)
  await page.getByTestId('workspace-home').getByRole('button', { name: '继续编辑', exact: true }).first().click(); await settled(page); expect((await readState(page)).document).toEqual(restored.document)
  await page.getByRole('button', { name: '关闭提示', exact: true }).click()
  expect(errors).toEqual([])
  await info.attach('390px-mixed.png', { body: await page.screenshot(), contentType: 'image/png' }); await report(info, '390px-mixed.json', { overflow, propId, revision: restored.document.revision, pngWidth: pngBytes.readUInt32BE(16), pngHeight: pngBytes.readUInt32BE(20), errors })
})

test('actual browser 200% tab zoom keeps essential UI reachable without document changes', async ({ browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Native chrome.tabs.setZoom API is Chromium-specific; other engines run 390px core flow above.')
  const origin = new URL(info.project.use.baseURL ?? 'http://127.0.0.1:5173').origin
  const extension = await mkdtemp(join(tmpdir(), 'sceneweave-zoom-extension-')), profile = await mkdtemp(join(tmpdir(), 'sceneweave-zoom-profile-'))
  let context
  try {
    await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Sceneweave isolated zoom acceptance', version: '1.0', permissions: ['tabs'], background: { service_worker: 'background.js' } }))
    await writeFile(join(extension, 'background.js'), 'chrome.runtime.onInstalled.addListener(() => {});')
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1512, height: 982 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const page = await context.newPage(); await page.goto(origin)
    const nativeZoom = await worker.evaluate(async origin => { const chrome = Reflect.get(globalThis, 'chrome'), tabs = await chrome.tabs.query({}); const target = tabs.find((tab: any) => tab.url?.startsWith(origin)); if (!target?.id) throw new Error('Expected isolated application tab'); await chrome.tabs.setZoom(target.id, 2); return chrome.tabs.getZoom(target.id) }, origin)
    expect(nativeZoom).toBe(2)
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2)
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, dpr: devicePixelRatio, visualScale: visualViewport?.scale }))
    await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true }); await dialog.getByLabel('场景名称', { exact: true }).fill('Actual 200 percent zoom')
    await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled(page)
    const before = await readState(page)
    for (const label of ['资源面板', '属性面板', '场景导航']) {
      const trigger = page.getByRole('button', { name: label, exact: true }); await trigger.click()
      await expect(page.getByRole('region', { name: label, exact: true })).toBeVisible(); await page.getByRole('button', { name: `关闭${label}`, exact: true }).focus(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
    }
    await page.getByRole('button', { name: '放大地图', exact: true }).click(); await page.getByRole('button', { name: '适应全图', exact: true }).click()
    expect(await readState(page)).toEqual(before)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await info.attach('actual-200-percent.png', { body: await page.screenshot(), contentType: 'image/png' }); await report(info, 'actual-200-percent.json', { dimensions, method: 'Chrome native tabs.setZoom(tabId, 2), fresh isolated profile; no CSS zoom or deviceScaleFactor substitution', documentUnchanged: true })
  } finally { await context?.close(); await rm(extension, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }) }
})
