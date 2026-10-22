import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { WorkspaceV5 } from '../src/editor/v5/workspace'
import type { SceneRepositoryV5 } from '../src/io/v5/storage'
type Dev = { workspace: WorkspaceV5; repository: SceneRepositoryV5 }

async function settled(page: Page) {
  await expect(page.getByTestId('composition-workbench')).toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
}
async function seed(page: Page, title: string) {
  await page.goto('/#composition'); await expect(page.getByTestId('composition-workbench')).toBeVisible()
  await page.evaluate(async title => {
    const fixturePath = '/tests/c3-fixtures.ts', preparePath = '/src/io/v5/prepare.ts'
    const { createC3ProjectV5 } = await import(fixturePath) as typeof import('./c3-fixtures')
    const { prepareCompositionCommandsV5 } = await import(preparePath) as typeof import('../src/io/v5/prepare')
    // Start at r0 with real original and derived bytes, so CAS/copy must preserve the full graph.
    const project = await prepareCompositionCommandsV5(await createC3ProjectV5({ title }), [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-left'] }, adjustment: { id: 'native-cas-tint', kind: 'tint', value: '#80FF00', enabled: true } }])
    const { workspace } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev
    await workspace.adoptNew(project); await workspace.flush()
  }, title)
  await settled(page)
}
/** Validation here uses native browser image decode and native IndexedDB, never fake-indexeddb. */
async function completeState(page: Page, persistedSceneId?: string) {
  return page.evaluate(async sceneId => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev
    const project = sceneId ? await repository.load(sceneId) : workspace.getState().project
    if (!project) throw new Error('Expected complete v5 project')
    const ioPath = '/src/io/v5/project-file.ts', { projectContentHashV5 } = await import(ioPath) as typeof import('../src/io/v5/project-file')
    const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('')
    const assets = Object.fromEntries(await Promise.all(Object.entries(project.assets).map(async ([key, asset]) => [key, { sha256: asset.sha256, actualHash: await digest(await asset.blob.arrayBuffer()), sizeBytes: asset.sizeBytes, mimeType: asset.mimeType, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight }] as const)))
    const licenses = Object.fromEntries(await Promise.all(Object.entries(project.licenses).map(async ([key, license]) => [key, { ...license, actualHash: await digest(new TextEncoder().encode(license.text).buffer) }] as const)))
    return { document: structuredClone(project.document), historyIdentity: structuredClone(project.historyIdentity), appearance: structuredClone(project.appearance), assets, licenses,
      licenseBindings: structuredClone(project.licenseBindings), contentHash: await projectContentHashV5(project), status: workspace.getState().status, error: workspace.getState().error }
  }, persistedSceneId)
}
async function rotateAndSave(page: Page, id: string, rotationDeg: number) {
  await page.evaluate(async ({ id, rotationDeg }) => { const { workspace } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev; await workspace.execute([{ type: 'updateProp', id, changes: { rotationDeg } }]); await workspace.flush() }, { id, rotationDeg })
  await settled(page)
}
async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}

test('C3 native two-tab revision CAS preserves both branches and saves the conflicted branch as a complete independent copy', async ({ page, context }, info) => {
  test.setTimeout(180_000)
  await seed(page, 'C3 native two-tab original')
  const original = await completeState(page), sceneId = original.document.sceneId
  expect(original.document.revision).toBe(0); expect(Object.keys(original.appearance.variants)).toHaveLength(1)
  const second = await context.newPage()
  try {
    // Both tabs share the same real origin/database and load r0 before either edits.
    await second.goto('/#composition'); await settled(second)
    const stale = await completeState(second)
    expect(stale.document.sceneId).toBe(sceneId); expect(stale.contentHash).toBe(original.contentHash)
    await rotateAndSave(page, 'c3-left', 10)
    const winner = await completeState(page)
    expect(winner.document.revision).toBe(1); expect(winner.document.props['c3-left'].rotationDeg).toBe(10); expect(winner.document.props['c3-right'].rotationDeg).toBe(0)
    const failure = await second.evaluate(async () => {
      const { workspace } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev
      await workspace.execute([{ type: 'updateProp', id: 'c3-right', changes: { rotationDeg: 25 } }])
      try { await workspace.flush(); return null } catch (error) { return { name: error instanceof Error ? error.name : '', message: String(error) } }
    })
    expect(failure?.name).toBe('ConflictErrorV5'); await expect(second.locator('.asset-save')).toHaveText('版本冲突')
    const losingBranch = await completeState(second), persistedWinner = await completeState(second, sceneId)
    expect(losingBranch.status).toBe('conflict'); expect(losingBranch.document.revision).toBe(1)
    expect(losingBranch.document.props['c3-left'].rotationDeg).toBe(0); expect(losingBranch.document.props['c3-right'].rotationDeg).toBe(25)
    expect(persistedWinner.contentHash).toBe(winner.contentHash); expect((await completeState(page)).contentHash).toBe(winner.contentHash)
    expect(losingBranch.appearance).toEqual(original.appearance); expect(losingBranch.assets).toEqual(original.assets)
    expect(losingBranch.licenses).toEqual(original.licenses); expect(losingBranch.licenseBindings).toEqual(original.licenseBindings)
    for (const asset of Object.values(losingBranch.assets)) expect(asset.actualHash).toBe(asset.sha256)
    for (const license of Object.values(losingBranch.licenses)) expect(license.actualHash).toBe(license.sha256)
    await second.screenshot({ path: info.outputPath('c3-native-cas-conflict.png'), fullPage: true })
    // The user-visible recovery action must preserve this tab's edits, not reload the winner.
    await second.getByRole('button', { name: '另存副本', exact: true }).click(); await settled(second)
    const copy = await completeState(second)
    expect(copy.document.sceneId).not.toBe(sceneId); expect(copy.document.revision).toBe(0)
    expect(copy.document.props).toEqual(losingBranch.document.props); expect(copy.appearance).toEqual(losingBranch.appearance)
    expect(copy.historyIdentity).toEqual(losingBranch.historyIdentity); expect(copy.assets).toEqual(losingBranch.assets)
    expect(copy.licenses).toEqual(losingBranch.licenses); expect(copy.licenseBindings).toEqual(losingBranch.licenseBindings)
    const oldAfterCopy = await completeState(page, sceneId)
    expect(oldAfterCopy.contentHash).toBe(winner.contentHash); expect(oldAfterCopy.document.revision).toBe(1); expect(oldAfterCopy.document.props['c3-left'].rotationDeg).toBe(10)
    await second.reload(); await settled(second)
    const reopened = await completeState(second)
    expect(reopened.document.sceneId).toBe(copy.document.sceneId); expect(reopened.contentHash).toBe(copy.contentHash)
    expect(reopened.assets).toEqual(copy.assets); expect(reopened.licenses).toEqual(copy.licenses); expect(reopened.appearance).toEqual(copy.appearance)
    expect((await completeState(second, sceneId)).contentHash).toBe(winner.contentHash)
    const branches = await second.evaluate(async () => { const { repository } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev; return repository.list() })
    expect(branches.map(value => value.sceneId).sort()).toEqual([sceneId, copy.document.sceneId].sort())
    await evidence(info, 'c3-native-two-tab-cas.json', { method: 'Two pages in one Chromium context, separate native IndexedDB connections. Both load r0; first tab saves left=10°, stale tab keeps right=25° after real revision CAS rejection, then UI saves its complete branch as a new scene/r0 and reloads it. Fixture setup and command calls use the development API; storage and image decoding are native. This is not quota-exhaustion evidence.', original, winner, failure, losingBranch, copy, reopened, branches })
  } finally { await second.close() }
})

interface ProtectionGate {
  entered: boolean
  expectedMetadataVersion?: number
  release: () => void
  pending: Promise<void>
  failure: { name: string; message: string } | null
  adopted: boolean
  restoreMethod: () => void
}

test('C3 native protection metadata CAS rejects a stale snapshot list before restore and permits a fresh retry', async ({ page, context }, info) => {
  test.setTimeout(180_000)
  await seed(page, 'C3 native protection metadata CAS')
  const snapshot = await page.evaluate(async () => { const { workspace } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev; const snapshot = await workspace.createNamedSnapshot('Native restore source'); return { id: snapshot.id, contentHash: snapshot.contentHash } })
  await rotateAndSave(page, 'c3-left', 10)
  const before = await completeState(page), sceneId = before.document.sceneId, second = await context.newPage()
  try {
    await second.goto('/#composition'); await settled(second); expect((await completeState(second)).contentHash).toBe(before.contentHash)
    await page.evaluate(async snapshotId => {
      const { workspace, repository } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev
      const preview = await workspace.prepareRestore(snapshotId, { ids: ['c3-left'], mode: 'transform' }), original = repository.createNamedSnapshot.bind(repository)
      let release!: () => void
      const pause = new Promise<void>(resolve => { release = resolve })
      const state: ProtectionGate = { entered: false, release, pending: Promise.resolve(), failure: null, adopted: false, restoreMethod: () => { repository.createNamedSnapshot = original } }
      repository.createNamedSnapshot = async (project, name, options = {}) => {
        if (options.kind === 'protection') { state.expectedMetadataVersion = options.expectedMetadataVersion; state.entered = true; await pause }
        return original(project, name, options)
      }
      Reflect.set(window, '__c3NativeProtectionGate', state)
      state.pending = workspace.applyRestore(preview).then(() => { state.adopted = true }, error => { state.failure = { name: error instanceof Error ? error.name : '', message: String(error) } })
    }, snapshot.id)
    await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__c3NativeProtectionGate') as ProtectionGate).entered)).toBe(true)
    // Only the method entry is delayed. The actual metadata compare and all writes run in native IDB.
    const inserted = await second.evaluate(async () => {
      const { workspace, repository } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev
      const named = await workspace.createNamedSnapshot('Other tab inserted during protection preparation')
      return { id: named.id, contentHash: named.contentHash, usage: await repository.usage(named.sceneId) }
    })
    const failed = await page.evaluate(async () => {
      const state = Reflect.get(window, '__c3NativeProtectionGate') as ProtectionGate
      state.release(); await state.pending; state.restoreMethod()
      const { workspace, repository } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev, sceneId = workspace.getState().project!.document.sceneId
      return { failure: state.failure, adopted: state.adopted, expectedMetadataVersion: state.expectedMetadataVersion,
        usage: await repository.usage(sceneId), snapshots: await repository.listNamedSnapshots(sceneId) }
    })
    expect(failed.failure?.name).toBe('HistoryConflictErrorV5'); expect(failed.adopted).toBe(false)
    expect(failed.expectedMetadataVersion).toBe(1); expect(inserted.usage.metadataVersion).toBe(2)
    expect(failed.usage.metadataVersion).toBe(2); expect(failed.usage.protectionCount).toBe(0); expect(failed.usage.namedCount).toBe(2)
    expect(failed.snapshots.map(value => value.id).sort()).toEqual([snapshot.id, inserted.id].sort())
    expect((await completeState(page)).contentHash).toBe(before.contentHash); expect((await completeState(second, sceneId)).contentHash).toBe(before.contentHash)
    const retried = await page.evaluate(async snapshotId => {
      const { workspace, repository } = Reflect.get(window, '__sceneweaveCompositionDev') as Dev
      const fresh = await workspace.prepareRestore(snapshotId, { ids: ['c3-left'], mode: 'transform' })
      await workspace.applyRestore(fresh); await workspace.flush()
      const sceneId = workspace.getState().project!.document.sceneId
      return { usage: await repository.usage(sceneId), snapshots: await repository.listNamedSnapshots(sceneId) }
    }, snapshot.id)
    await settled(page); const after = await completeState(page)
    expect(after.document.revision).toBe(before.document.revision + 1); expect(after.document.props['c3-left'].rotationDeg).toBe(0)
    expect(after.document.props['c3-right']).toEqual(before.document.props['c3-right']); expect(after.appearance).toEqual(before.appearance)
    expect(after.assets).toEqual(before.assets); expect(after.licenses).toEqual(before.licenses)
    expect(retried.usage.protectionCount).toBe(1); expect(retried.usage.namedCount).toBe(2); expect(retried.usage.metadataVersion).toBe(3)
    const protection = retried.snapshots.find(value => value.kind === 'protection')!
    expect(protection.contentHash).toBe(before.contentHash)
    expect((await completeState(second, sceneId)).contentHash).toBe(after.contentHash)
    await evidence(info, 'c3-native-protection-metadata-cas.json', { method: 'Two native browser connections. A deterministic method-entry gate pauses protection creation after its metadata baseline is captured; the other tab commits a real named snapshot. Native metadata CAS rejects the stale protection atomically, retaining current content and both named snapshots; a newly prepared restore succeeds with one protection snapshot. No storage quota is simulated.', snapshot, before, inserted, failed, retried, after })
  } finally {
    await page.evaluate(async () => { const state = Reflect.get(window, '__c3NativeProtectionGate') as ProtectionGate | undefined; if (state) { state.release(); await state.pending; state.restoreMethod(); Reflect.deleteProperty(window, '__c3NativeProtectionGate') } }).catch(() => {})
    await second.close()
  }
})
