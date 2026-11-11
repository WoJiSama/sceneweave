import { openWorkspaceModule } from './workspace-navigation-helpers'
import { reloadSaved } from './workspace-ux-helpers'
import { expect, test, type Page } from '@playwright/test'
import type { AuthoringOperation } from '../src/shared/ai/authoring-protocol-v1'

// Retained internal SVG/style artifact replay, real browser SVG/Canvas/IDB.
// Current public authoring4 remains closed to artwork creation; no AI task is posted.
const SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path d="M40 4 L70 62 L60 76 L20 76 L10 62 Z" fill="#173f39" stroke="#0d241f" stroke-width="4"/><circle cx="40" cy="44" r="13" fill="#c99948"/></svg>'
async function read(page: Page) {
  return page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', helper = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { assimilationState } = await import(helper) as typeof import('./helpers/m2-assimilation-browser')
    return assimilationState(nativeWorkspace.getState().project!)
  })
}
async function commands(page: Page, commands: import('../src/shared/model/appearance').CompositionCommand[]) {
  await page.evaluate(async values => {
    const path = '/src/editor/main/Workbench.tsx', { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    await nativeWorkspace.execute(values); await nativeWorkspace.flush()
  }, commands)
  await saved(page)
}
async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
}
async function create(page: Page) {
  const taskPosts: string[] = []
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/tasks') taskPosts.push(request.url()) })
  await page.goto('/#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('M2 冻结范围渐进同化验收')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18'); await dialog.getByLabel('画布高度', { exact: true }).fill('12')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await saved(page)
  await page.evaluate(async () => {
    const path = '/src/editor/main/Workbench.tsx', helper = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(path) as typeof import('../src/editor/main/Workbench')
    const { seedAssimilation } = await import(helper) as typeof import('./helpers/m2-assimilation-browser')
    return seedAssimilation(nativeWorkspace)
  }); await saved(page)
  await openWorkspaceModule(page, 'AI')
  const artwork = page.getByRole('region', { name: 'AI 场景草稿', exact: true }).getByLabel('AI 素材创作和同化', { exact: true })
  await expect(artwork).toBeDisabled(); await expect(artwork).not.toBeChecked()
  expect(taskPosts).toEqual([])
  return taskPosts
}
async function scope(page: Page, mode: 'single' | 'prefab' | 'range', ids: string[], boundsMm?: { x: number; y: number; width: number; height: number }) {
  await page.evaluate(async artwork => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { freezeRetainedArtwork } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    freezeRetainedArtwork(nativeWorkspace, artwork)
  }, { mode, targetIds: ids, operations: ['svg', 'style'] as ('svg' | 'style')[], ...(boundsMm ? { boundsMm } : {}) })
}
async function draft(page: Page, operations: AuthoringOperation[]) {
  return page.evaluate(async values => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { prepareRetainedArtwork } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    return prepareRetainedArtwork(nativeWorkspace, values)
  }, operations)
}
async function adopt(page: Page) {
  const result = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { publishRetainedArtwork } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    return publishRetainedArtwork(nativeWorkspace)
  })
  expect(result.protectionId).toBeTruthy(); await saved(page)
}
async function publicationState(page: Page) {
  return page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { retainedPublicationState } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    return retainedPublicationState(nativeWorkspace)
  })
}
async function rejectedDraft(page: Page, operations: AuthoringOperation[]) {
  return page.evaluate(async values => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { rejectRetainedArtwork } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    return rejectRetainedArtwork(nativeWorkspace, values)
  }, operations)
}
const physical = (prop: import('../src/shared/model/scene').Prop) => {
  const { appearance: _appearance, definitionRef: _definitionRef, ...rest } = prop; return rest
}

test('retained internal artwork: single SVG, fixed prefab and frozen batches preserve manual edits, cancellation and offline local recovery', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const taskPosts = await create(page), initial = await read(page), audit = []
  await scope(page, 'single', ['assim-a']); const single = await draft(page, [{ kind: 'svg', id: 'assim-a', sourceSvg: SOURCE, longEdgePx: 96, name: '阴绿铜灯固定新版本' }])
  expect((await read(page)).document).toEqual(initial.document); await adopt(page)
  const afterSingle = await read(page)
  expect(Object.keys(afterSingle.sources)).toHaveLength(1)
  expect(physical(afterSingle.document.props['assim-a'])).toEqual(physical(initial.document.props['assim-a']))
  expect(afterSingle.document.props['outside-same']).toEqual(initial.document.props['outside-same'])
  await commands(page, [{ type: 'createPrefab', id: 'assim-group', definitionId: 'assim-fixed', name: '验收铜灯组合', ids: ['assim-a', 'assim-b', 'assim-delete', 'assim-detach'], anchorMm: { x: 3500, y: 3500 } }])
  await commands(page, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['assim-b'] }, adjustment: { id: 'manual-shadow', kind: 'shadowClass', value: 'none', enabled: true } },
    { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['assim-b'] }, adjustment: { id: 'disabled-manual-opacity', kind: 'opacity', value: .9, enabled: false } }])
  const beforeGroup = await read(page)
  await scope(page, 'prefab', ['assim-group']); const group = await draft(page, [{ kind: 'style', ids: ['assim-a', 'assim-b', 'assim-delete', 'assim-detach'], brightness: .85, opacity: .8 }]); await adopt(page)
  const afterGroup = await read(page)
  expect(afterGroup.document.prefabDefinitions['assim-fixed']).toEqual(beforeGroup.document.prefabDefinitions['assim-fixed'])
  expect(afterGroup.appearance.instanceAdjustments['assim-b']).toEqual(expect.arrayContaining(beforeGroup.appearance.instanceAdjustments['assim-b']))
  for (const id of ['assim-a', 'assim-b', 'assim-delete', 'assim-detach']) {
    expect(physical(afterGroup.document.props[id])).toEqual(physical(beforeGroup.document.props[id]))
    expect(afterGroup.document.props[id].appearance.opacity).toBe(.8)
  }
  // Human movement, deletion and exit are interleaved with retained batches.
  await commands(page, [{ type: 'updateProp', id: 'assim-b', changes: { positionMm: { x: 4600, y: 2600 } } },
    { type: 'deleteProp', id: 'assim-delete' }])
  await commands(page, [{ type: 'detachPrefabMember', groupId: 'assim-group', propId: 'assim-detach' }])
  const manualGroup = await read(page), keptMembers = manualGroup.document.prefabInstances['assim-group'].members
  expect(Object.values(keptMembers).filter(member => member.propId === null)).toHaveLength(2)
  await scope(page, 'range', ['assim-a', 'assim-b', 'range-a'], { x: 1000, y: 1000, width: 6500, height: 5000 })
  // New same-layer/same-definition content is added after the local target set was frozen.
  const definition = initial.document.props['range-a'].definitionRef!
  await commands(page, [{ type: 'addProp', id: 'after-freeze-a', floorId: initial.document.props['range-a'].floorId,
    definitionRef: definition, layerId: initial.document.entityLayers['range-a'], positionMm: { x: 6500, y: 4500 } }])
  const beforeFirst = await read(page), first = await draft(page, [{ kind: 'style', ids: ['assim-a', 'assim-b', 'range-a'], tint: '#627b6b', opacity: .65 }])
  expect(first.artwork.targetIds).toEqual(['assim-a', 'assim-b', 'range-a'])
  expect(first.revision).toBe(beforeFirst.document.revision)
  await adopt(page); const afterFirst = await read(page)
  expect(afterFirst.document.props['after-freeze-a']).toEqual(beforeFirst.document.props['after-freeze-a'])
  expect(afterFirst.document.props['assim-detach']).toEqual(beforeFirst.document.props['assim-detach'])
  expect(afterFirst.document.props['outside-same']).toEqual(initial.document.props['outside-same'])
  expect(afterFirst.document.props['assim-delete']).toBeUndefined()
  for (const [key, member] of Object.entries(keptMembers)) {
    expect(afterFirst.document.prefabInstances['assim-group'].members[key].propId).toBe(member.propId)
    expect(afterFirst.document.prefabInstances['assim-group'].members[key].overrideFields).toEqual(expect.arrayContaining(member.overrideFields))
  }
  await openWorkspaceModule(page, '历史')
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill('第一批已采用')
  await page.getByRole('button', { name: '保存快照', exact: true }).click(); await saved(page)
  // Terrace edit is outside both artwork scopes and must survive all later work.
  await commands(page, [{ type: 'setTerrainElevation', id: 'later-terrace', groundElevationMm: 300 },
    { type: 'updateProp', id: 'outside-same', changes: { rotationDeg: 35 } }])
  await scope(page, 'range', ['range-b'], { x: 8500, y: 1000, width: 4500, height: 5000 })
  await commands(page, [{ type: 'addProp', id: 'after-freeze-b', floorId: initial.document.props['range-b'].floorId,
    definitionRef: definition, layerId: initial.document.entityLayers['range-b'], positionMm: { x: 11500, y: 4500 } }])
  const beforeSecond = await read(page), canceled = await draft(page, [{ kind: 'style', ids: ['range-b'], brightness: .7, opacity: .45 }])
  const cancellation = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { cancelRetainedArtwork } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    return cancelRetainedArtwork(nativeWorkspace)
  })
  expect(cancellation.failure).toBe('AbortError'); expect(cancellation.realDecodes).toBeGreaterThan(0)
  expect(cancellation.writes).toEqual([]); expect(cancellation.after).toEqual(cancellation.before)
  expect((await read(page)).document).toEqual(beforeSecond.document)
  expect((await read(page)).appearance).toEqual(beforeSecond.appearance)
  // Each independent retained batch uses its own exact baseline, seed and protection.
  const second = await draft(page, [{ kind: 'style', ids: ['range-b'], brightness: .7, opacity: .45 }]); await adopt(page)
  const afterSecond = await read(page)
  expect(second.seed).not.toBe(first.seed)
  expect(second.revision).toBe(beforeSecond.document.revision)
  expect(second.artwork.targetIds).toEqual(['range-b'])
  expect(afterSecond.document.props['range-b'].appearance.opacity).toBe(.45)
  for (const id of ['assim-a', 'assim-b', 'range-a', 'assim-detach', 'after-freeze-a', 'after-freeze-b', 'outside-same']) expect(afterSecond.document.props[id]).toEqual(beforeSecond.document.props[id])
  expect(afterSecond.document.terrainAreas).toEqual(beforeSecond.document.terrainAreas)
  // Change one first-batch item again, then restore only its prior effective appearance.
  await commands(page, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['assim-a'] }, adjustment: { id: 'manual-later-opacity', kind: 'opacity', value: .2, enabled: true } }])
  await commands(page, [{ type: 'updateProp', id: 'assim-a', changes: { positionMm: { x: 2700, y: 2500 } } },
    { type: 'updateProp', id: 'outside-same', changes: { rotationDeg: 55 } }])
  const beforeRestore = await read(page)
  await openWorkspaceModule(page, '历史')
  await page.getByRole('button', { name: '查看快照 第一批已采用', exact: true }).click()
  const details = page.getByRole('region', { name: '历史详情', exact: true })
  await details.getByLabel('恢复对象类型', { exact: true }).selectOption('props')
  await details.getByLabel('局部恢复模式', { exact: true }).selectOption('appearance')
  await details.getByLabel('搜索历史物件', { exact: true }).fill('assim-a')
  await details.getByRole('checkbox', { name: '恢复物件 assim-a', exact: true }).check()
  await details.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  expect((await read(page)).document).toEqual(beforeRestore.document)
  const restore = page.getByRole('status', { name: '局部恢复候选', exact: true })
  await restore.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check()
  await restore.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await saved(page)
  const restored = await read(page)
  expect(restored.document.props['assim-a'].appearance).toEqual(afterFirst.document.props['assim-a'].appearance)
  expect(restored.document.props['assim-a'].positionMm).toEqual({ x: 2700, y: 2500 })
  for (const id of Object.keys(beforeRestore.document.props).filter(id => id !== 'assim-a')) expect(restored.document.props[id]).toEqual(beforeRestore.document.props[id])
  expect(restored.document.terrainAreas).toEqual(beforeRestore.document.terrainAreas)
  expect(restored.document.revision).toBe(beforeRestore.document.revision + 1)
  // Cold reload and complete selected-history archive retain real SVG/PNG/licence bytes offline.
  await reloadSaved(page); await saved(page)
  expect(await read(page)).toEqual(restored)
  await page.context().setOffline(true)
  const closure = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', hp = '/tests/helpers/m2-assimilation-browser.ts', rp = '/src/platform/browser/runtime.ts'
    const fp = '/src/shared/project/file.ts', pp = '/src/application/workspace/project.ts', render = '/src/platform/browser/render/renderer.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { verifyResourceClosure } = await import(hp) as typeof import('./helpers/m2-assimilation-browser')
    const { projectRepository, validation } = await import(rp) as typeof import('../src/platform/browser/runtime')
    const { exportHistoryArchive, importHistoryArchive } = await import(fp) as typeof import('../src/shared/project/file')
    const { toBundle, fromBundle } = await import(pp) as typeof import('../src/application/workspace/project')
    const { exportPng } = await import(render) as typeof import('../src/platform/browser/render/renderer')
    const current = nativeWorkspace.getState().project!, before = await verifyResourceClosure(current)
    const snapshots = await projectRepository.listSnapshots(current.document.sceneId)
    const selected = (await Promise.all(snapshots.filter(item => item.name === '第一批已采用').map(item => projectRepository.loadSnapshot(current.document.sceneId, item.id)))).filter(item => item !== null)
    const bytes = await exportHistoryArchive({ current: toBundle(current), snapshots: selected }, validation)
    const archive = await importHistoryArchive(bytes, validation), imported = await fromBundle(archive.current, validation)
    const png = await exportPng(archive.current, { audience: 'gm', longEdgePx: 512 }), bitmap = await createImageBitmap(png), dimensions = { width: bitmap.width, height: bitmap.height }; bitmap.close()
    return { before, after: await verifyResourceClosure(imported), histories: archive.snapshots.length,
      historyClosure: await verifyResourceClosure(await fromBundle(archive.snapshots[0].bundle, validation)),
      protectionCount: snapshots.filter(item => item.kind === 'protection').length, sourceCount: Object.keys(imported.authoringSources).length,
      document: imported.document, bytes: bytes.length, png: { type: png.type, size: png.size, ...dimensions } }
  })
  expect(closure.before).toEqual(closure.after); expect(closure.sourceCount).toBe(1); expect(closure.histories).toBe(1)
  expect(closure.before.sourceTexts[0].original).toBe(SOURCE); expect(closure.historyClosure.sourceTexts[0].original).toBe(SOURCE)
  expect(closure.protectionCount).toBe(5); expect(closure.document).toEqual(restored.document)
  expect(closure.png).toMatchObject({ type: 'image/png', width: 512, height: 341 }); expect(closure.png.size).toBeGreaterThan(1000)
  expect(errors).toEqual([])
  await page.context().setOffline(false)
  for (const replay of [single, group, first, canceled, second]) audit.push({ revision: replay.revision, mode: replay.artwork.mode, targets: replay.artwork.targetIds, cost: replay.operationCost, processor: replay.processor, assessments: replay.assessments })
  expect(taskPosts).toEqual([])
  await info.attach('progressive-assimilation.json', { body: JSON.stringify({ evidence: 'retained internal artwork replay; actual browser SVG/image ports; no public AI creation', audit, cancellation, taskPosts, finalRevision: restored.document.revision, closure }), contentType: 'application/json' })
})

test('retained internal artwork rejects locked members and frozen range escape without writes or public task creation', async ({ page }, info) => {
  test.setTimeout(120_000)
  const taskPosts = await create(page)
  await commands(page, [{ type: 'createPrefab', id: 'assim-group', definitionId: 'assim-fixed', name: '锁定测试组合', ids: ['assim-a', 'assim-b'], anchorMm: { x: 3500, y: 2500 } }])
  await scope(page, 'prefab', ['assim-group'])
  await commands(page, [{ type: 'setEditLock', kind: 'prop', id: 'assim-b', locked: true }])
  const locked = await read(page), lockedStorage = await publicationState(page)
  const lockedFailure = await rejectedDraft(page, [{ kind: 'style', ids: ['assim-a', 'assim-b'], brightness: .85, opacity: .8 }])
  expect(lockedFailure.failure).toMatch(/锁定/); expect(lockedFailure.writes).toEqual([])
  expect(await read(page)).toEqual(locked); expect(await publicationState(page)).toEqual(lockedStorage)
  await commands(page, [{ type: 'setEditLock', kind: 'prop', id: 'assim-b', locked: false }])
  await scope(page, 'range', ['range-a'], { x: 5000, y: 1000, width: 3000, height: 5000 })
  const before = await read(page), beforeStorage = await publicationState(page)
  const rangeFailure = await rejectedDraft(page, [{ kind: 'style', ids: ['range-a'], brightness: .7, opacity: .45 },
    { kind: 'style', ids: ['outside-same'], brightness: .7, opacity: .45 }])
  expect(rangeFailure.failure).toMatch(/冻结外观范围/); expect(rangeFailure.writes).toEqual([])
  expect(await read(page)).toEqual(before); expect(await publicationState(page)).toEqual(beforeStorage)
  // An earlier valid recipe in the rejected step never becomes publishable.
  await expect(adopt(page)).rejects.toThrow(/absent or stale/)
  // Inject a byte read failure into an independent bundle; no persisted resource is removed.
  const missingResource = await page.evaluate(async () => {
    const wp = '/src/editor/main/Workbench.tsx', pp = '/src/application/workspace/project.ts', rp = '/src/platform/browser/runtime.ts', vp = '/src/shared/project/resources.ts'
    const { nativeWorkspace } = await import(wp) as typeof import('../src/editor/main/Workbench')
    const { toBundle } = await import(pp) as typeof import('../src/application/workspace/project')
    const { validation } = await import(rp) as typeof import('../src/platform/browser/runtime')
    const { validateProjectBundle } = await import(vp) as typeof import('../src/shared/project/resources')
    const bundle = toBundle(nativeWorkspace.getState().project!), prop = bundle.project.document.props['range-a']
    if (prop.appearance.kind !== 'image') throw new Error('Expected a real image asset')
    const missing = bundle.project.document.assets[prop.appearance.assetId].sha256
    try { await validateProjectBundle({ project: bundle.project, resources: { async read(hash) { if (hash === missing) throw new Error('Injected missing member bitmap'); return bundle.resources.read(hash) } } }, validation); return false }
    catch (error) { return String(error).includes('Injected missing member bitmap') }
  })
  expect(missingResource).toBe(true); expect(await read(page)).toEqual(before)
  expect(await publicationState(page)).toEqual(beforeStorage); expect(taskPosts).toEqual([])
  await info.attach('artwork-guards.json', { body: JSON.stringify({ evidence: 'retained internal artifact replay with real browser bytes; no public AI task', lockedMemberRejectedBeforeMaterialization: true, laterFailedOperationKeptEarlierMemberUnchanged: true, missingMemberBitmapRejected: missingResource, outsideTargetRejectedByReplay: true, noProtectionOrSaveOnFailure: true, taskPosts, unchangedRevision: before.document.revision }), contentType: 'application/json' })
})
