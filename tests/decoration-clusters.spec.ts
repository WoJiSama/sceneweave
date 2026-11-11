import { openTerrainTask, openSceneObjects } from './workspace-navigation-helpers'
import { reloadSaved } from './workspace-ux-helpers'
import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { EditableProject } from '../src/application/workspace/project'

async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const w = '/src/editor/main/Workbench.tsx', h = '/src/shared/project/validate.ts', p = '/src/application/workspace/project.ts'
    const { nativeWorkspace } = await import(w), { projectContentHash } = await import(h), { toBundle } = await import(p)
    const project = nativeWorkspace.getState().project as EditableProject
    return { document: structuredClone(project.document), hash: projectContentHash(toBundle(project).project) }
  })
}
async function adopt(page: Page) {
  await expect(page.getByRole('checkbox', { name: '确认完整影响范围', exact: true })).toBeVisible({ timeout: 90000 })
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click(); await saved(page)
}

test('real original sprites enter one clustered preview; individual manual move/delete survives regeneration, undo and complete cold IO', async ({ page }, info) => {
  test.setTimeout(300000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('簇状布景真实素材UI')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('48')
  await dialog.getByLabel('画布高度', { exact: true }).fill('36')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await saved(page)
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@1')
  const empty = await state(page)
  await openTerrainTask(page, '布置植被')
  const panel = page.getByRole('region', { name: '簇状布景', exact: true })
  await panel.getByLabel('布景种子', { exact: true }).fill('clustered-dressing-0')
  await panel.getByRole('button', { name: /^预览所选布景素材/ }).click()
  await expect(page.getByRole('button', { name: '取消室外预览', exact: true })).toBeVisible({ timeout: 90000 })
  expect((await state(page)).hash).toBe(empty.hash)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  await panel.getByRole('button', { name: /^预览所选布景素材/ }).click(); await adopt(page)
  const sourced = await state(page)
  expect(sourced.document.decorations).toEqual({})
  expect(Object.keys(sourced.document.propDefinitions).length).toBe(Object.keys(empty.document.propDefinitions).length + 12)
  await panel.getByRole('button', { name: '预览簇状布景', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消室外预览', exact: true })).toBeVisible({ timeout: 90000 })
  expect((await state(page)).hash).toBe(sourced.hash)
  await page.getByRole('button', { name: '取消室外预览', exact: true }).click()
  await panel.getByRole('button', { name: '预览簇状布景', exact: true }).click(); await adopt(page)
  const created = await state(page), cluster = Object.values(created.document.decorationClusters!)[0]
  expect(Object.keys(created.document.decorations!).length).toBeGreaterThan(0)
  expect(Object.keys(created.document.props).length).toBeGreaterThan(0)
  expect(new Set(Object.values(created.document.decorations!).map(row => row.scalePpm)).size).toBeGreaterThan(1)
  const decoration = Object.values(created.document.decorations!)[0], other = Object.values(created.document.decorations!)[1]
  expect(other).toBeTruthy()
  const objects = await openSceneObjects(page)
  await objects.locator(`[data-entity-id="${decoration.id}"]`).click()
  const inspector = page.getByRole('region', { name: '轻量装饰属性', exact: true })
  await inspector.getByLabel('装饰位置X', { exact: true }).fill(String(decoration.positionMm.x + 100))
  await inspector.getByRole('button', { name: '预览装饰修改', exact: true }).click(); await adopt(page)
  const moved = await state(page)
  expect(moved.document.decorations![decoration.id].positionMm.x).toBe(decoration.positionMm.x + 100)
  const member = Object.entries(moved.document.decorationClusters![cluster.id].members).find(([, row]) => row.entityId === decoration.id)!
  expect(member[1].state).toBe('manual')
  await openSceneObjects(page)
  await objects.locator(`[data-entity-id="${cluster.id}"]`).click()
  await page.getByRole('region', { name: '轻量装饰属性', exact: true }).getByRole('button', { name: `轻量装饰 · ${other.id}`, exact: true }).click()
  await inspector.getByRole('button', { name: '预览删除装饰', exact: true }).click(); await adopt(page)
  const deleted = await state(page), deletedSlot = Object.entries(created.document.decorationClusters![cluster.id].members).find(([, row]) => row.entityId === other.id)![0]
  expect(deleted.document.decorations![other.id]).toBeUndefined()
  expect(deleted.document.decorationClusters![cluster.id].members[deletedSlot]).toMatchObject({ entityId: null, state: 'deleted' })
  await openSceneObjects(page)
  await objects.locator(`[data-entity-id="${cluster.id}"]`).click()
  await inspector.getByRole('button', { name: '预览重新布景', exact: true }).click(); await adopt(page)
  const regenerated = await state(page)
  expect(regenerated.document.decorations![decoration.id]).toEqual(deleted.document.decorations![decoration.id])
  expect(regenerated.document.decorations![other.id]).toBeUndefined()
  expect(regenerated.document.decorationClusters![cluster.id].members[member[0]].state).toBe('manual')
  expect(regenerated.document.decorationClusters![cluster.id].members[deletedSlot].state).toBe('deleted')
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.decorationClusters).toEqual(deleted.document.decorationClusters)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  expect((await state(page)).document.decorations).toEqual(regenerated.document.decorations)
  await reloadSaved(page); await saved(page)
  expect((await state(page)).document.decorationClusters).toEqual(regenerated.document.decorationClusters)

  const proof = await page.evaluate(async () => {
    const w = '/src/editor/main/Workbench.tsx', p = '/src/application/workspace/project.ts', r = '/src/platform/browser/runtime.ts', f = '/src/shared/project/file.ts', h = '/src/shared/project/validate.ts', renderer = '/src/platform/browser/render/renderer.ts', select = '/src/editor/native-canvas/selection.ts', hash = '/src/shared/validation/hash.ts'
    const { nativeWorkspace } = await import(w), { toBundle } = await import(p), { validation, projectRepository } = await import(r), { exportProject, importProject } = await import(f), { projectContentHash } = await import(h), { renderProject } = await import(renderer), { hitTestAll } = await import(select), { sha256Bytes } = await import(hash)
    const current = nativeWorkspace.getState().project as EditableProject, bundle = toBundle(current), bytes = await exportProject(bundle, validation), round = await importProject(bytes, validation), cold = await projectRepository.load(current.document.sceneId)
    if (projectContentHash(round.project) !== projectContentHash(bundle.project) || projectContentHash(cold!.project) !== projectContentHash(bundle.project)) throw new Error('Actual compact decoration IO did not retain the complete project.')
    const output = []
    for (const audience of ['gm', 'player']) { const canvas = await renderProject(bundle, { audience, longEdgePx: 1400 }); const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; output.push({ audience, width: canvas.width, height: canvas.height, pixelHash: sha256Bytes(new Uint8Array(rgba.buffer)), png: canvas.toDataURL('image/png').split(',')[1] }) }
    const compact = Object.values(current.document.decorations!)[0], hits = hitTestAll(current.document, compact.positionMm, 0)
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return { hash: projectContentHash(bundle.project), decorationCount: Object.keys(current.document.decorations!).length, propCount: Object.keys(current.document.props).length, clusters: current.document.decorationClusters, identityVersion: current.historyIdentity.version, assets: Object.keys(current.assets).length, licenses: Object.keys(current.licenses).length, output, hits, compactId: compact.id, package: btoa(binary) }
  })
  expect(proof.identityVersion).toBe(5)
  expect(proof.hits).toContain(proof.compactId)
  expect(proof.assets).toBeGreaterThanOrEqual(12)
  for (const row of proof.output) await writeFile(info.outputPath(`clusters-${row.audience}.png`), Buffer.from(row.png, 'base64'))
  await writeFile(info.outputPath('clusters.sceneweave'), Buffer.from(proof.package, 'base64'))
  await writeFile(info.outputPath('proof.json'), JSON.stringify({ ...proof, package: undefined, output: proof.output.map(({ png: _png, ...row }) => row) }, null, 2))
  await info.attach('clusters-ui.png', { body: await page.screenshot(), contentType: 'image/png' })
  expect(errors).toEqual([])
})
