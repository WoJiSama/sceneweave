import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { WorkspaceV6 } from '../src/editor/v6/workspace'
import type { SceneRepositoryV6 } from '../src/io/v6/storage'
import type { CompleteProjectV6 } from '../src/io/v6/types'

// Keep test expectations independent of the browser-only fixture's ?raw asset imports.
const C5_BUDGET_IDS = Array.from({ length: 257 }, (_, index) => `c5-budget-${String(index).padStart(3, '0')}`)
const C5_SUPPORTED_PROP = 'c5-supported-prop'

type Dev = { workspace: WorkspaceV6; repository: SceneRepositoryV6 }
async function project(page: Page): Promise<CompleteProjectV6> {
  return page.evaluate(() => structuredClone((Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!))
}
async function settled(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
}
async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true })
  await input.fill(String(value)); await input.press('Tab')
}
async function evidence(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}
async function adopt(page: Page, kind: '室外' | '结构' | '组件' | '图层') {
  const button = page.getByRole('button', { name: `采用${kind}修改`, exact: true })
  if (kind === '室外' || kind === '结构') {
    await expect(button).toBeDisabled()
    await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  }
  await button.click(); await expect(button).toHaveCount(0); await settled(page)
}
async function addLayer(page: Page, name: string) {
  await page.getByRole('button', { name: '新建用户图层', exact: true }).click()
  await page.getByLabel('新图层名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '创建图层', exact: true }).click(); await settled(page)
  return Object.values((await project(page)).document.userLayers).find(layer => layer.name === name)!.id
}
async function chooseProp(page: Page, id: string) {
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await page.getByLabel('搜索场景物件', { exact: true }).fill(id)
  await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
}
async function snapshot(page: Page, name: string) {
  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存快照', exact: true }).click(); await settled(page)
}
async function placeChair(page: Page, roomId: string, x: number) {
  const before = await project(page), definition = before.document.propDefinitions['b2-p-03']
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '放置', exact: true }).click()
  await page.getByRole('button', { name: `放置${definition.name}`, exact: true }).click()
  await number(page, '放置 X', x); await number(page, '放置 Y', 3500)
  await page.getByLabel('放置表面', { exact: true }).selectOption(`room:${roomId}`)
  await expect(page.getByRole('button', { name: '在此放置', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await settled(page)
  const next = await project(page), ids = Object.keys(next.document.props).filter(id => !Object.hasOwn(before.document.props, id))
  expect(ids).toHaveLength(1)
  expect(next.document.props[ids[0]].supportRef).toEqual({ kind: 'room', id: roomId })
  return ids[0]
}

test('C5 one v6 UI journey joins building, outdoor, fixed composition, layers, appearance and protected restore', async ({ page }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('C5 书房与庭院联合旅程')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('20000')
  await dialog.getByLabel('画布高度', { exact: true }).fill('20000')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await expect(dialog).toHaveCount(0); await settled(page)
  const initial = await project(page)
  expect(initial.historyIdentity.version).toBe(3); expect(initial.appearance.version).toBe(1); expect(initial.document.schemaVersion).toBe(3)
  await page.getByRole('tab', { name: '建筑', exact: true }).click()
  await page.getByLabel('房间名称', { exact: true }).fill('C5 书房')
  await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  for (const [label, value] of [['房间起点 X', 1000], ['房间起点 Y', 1000], ['房间宽度', 6000], ['房间高度', 5500]] as const) await number(page, label, value)
  await page.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(page, '结构')
  const roomId = Object.keys((await project(page)).document.rooms)[0]

  await page.getByRole('tab', { name: '室外', exact: true }).click()
  const tools = page.getByRole('region', { name: '室外制作工具', exact: true })
  await tools.getByLabel('室外坐标', { exact: true }).fill('9000, 9000\n19000, 9000\n19000, 19000\n9000, 19000')
  await tools.getByLabel('地形材质', { exact: true }).selectOption('b3-m-01')
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  let current = await project(page)
  const areaId = Object.keys(current.document.terrainAreas)[0], floorId = Object.keys(current.document.floors)[0]
  await tools.getByLabel('室外制作工具', { exact: true }).selectOption('path')
  await tools.getByLabel('室外坐标', { exact: true }).fill('2000, 7500\n18000, 7500')
  await tools.getByLabel('道路支撑表面', { exact: true }).selectOption(`floor:${floorId}`)
  await number(page, '室外通路宽度毫米', 1000)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click(); await adopt(page, '室外')
  current = await project(page); const pathId = Object.keys(current.document.paths)[0]

  await page.getByRole('tab', { name: '场景', exact: true }).click()
  const furnitureLayer = await addLayer(page, 'C5 家具')
  await page.getByRole('button', { name: '设为当前图层 C5 家具', exact: true }).click()
  const first = await placeChair(page, roomId, 3000), second = await placeChair(page, roomId, 5000)
  await chooseProp(page, first)
  await page.getByLabel('搜索场景物件', { exact: true }).fill('')
  await page.locator(`.asset-entity-list [data-entity-id="${second}"]`).click({ modifiers: ['Shift'] })
  await page.getByLabel('新组合名称', { exact: true }).fill('C5 双椅')
  await page.getByRole('button', { name: '预览保存组合 · 2 件', exact: true }).click(); await adopt(page, '组件')
  current = await project(page); const prefabId = Object.keys(current.document.prefabInstances)[0]
  expect(current.document.entityLayers[prefabId]).toBe(furnitureLayer)
  for (const id of [first, second]) expect(current.document.entityLayers[id]).toBe(furnitureLayer)
  await snapshot(page, 'C5 联合基线')
  const baseline = await project(page), originalBoundary = baseline.document.terrainAreas[areaId].boundaryMm

  await page.getByRole('tab', { name: '室外', exact: true }).click()
  await page.getByRole('button', { name: areaId, exact: true }).click()
  await page.getByLabel('室外对象坐标', { exact: true }).fill('9500, 9500\n18500, 9500\n18500, 18500\n9500, 18500')
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click()
  await page.getByRole('button', { name: '取消室外预览', exact: true }).focus(); await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '采用室外修改', exact: true })).toHaveCount(0)
  expect(await project(page)).toEqual(baseline)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await adopt(page, '室外')
  await page.getByRole('button', { name: pathId, exact: true }).click()
  await number(page, '对象通路净宽', 1200)
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click(); await adopt(page, '室外')

  await page.getByRole('tab', { name: '场景', exact: true }).click()
  const currentLayerButton = page.getByRole('button', { name: '设为当前图层 C5 家具', exact: true })
  await currentLayerButton.focus(); await currentLayerButton.press('Shift+F10')
  const layerMenu = page.getByRole('menu', { name: '图层菜单', exact: true })
  await expect(layerMenu).toBeVisible(); await page.keyboard.press('Escape'); await expect(layerMenu).toHaveCount(0)
  await expect(currentLayerButton).toBeFocused()
  await chooseProp(page, first)
  const beforeAppearance = await project(page)
  const appearance = page.getByRole('region', { name: '非破坏性外观', exact: true })
  await appearance.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  await appearance.getByLabel('外观亮度', { exact: true }).fill('0.75')
  await appearance.getByRole('button', { name: '预览外观调整', exact: true }).click(); await adopt(page, '组件')
  const changed = await project(page)
  expect(changed.appearance.instanceAdjustments[first]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'brightness', value: .75, enabled: true })]))
  const laterPath = changed.document.paths[pathId], laterRoom = changed.document.rooms[roomId]
  const laterPrefab = changed.document.prefabInstances[prefabId], laterAppearance = changed.appearance
  await currentLayerButton.focus(); await page.keyboard.press('ControlOrMeta+z'); await settled(page)
  const undone = await project(page)
  expect(undone.document.revision).toBe(changed.document.revision + 1)
  expect(undone.appearance).toEqual(beforeAppearance.appearance)
  await currentLayerButton.focus(); await page.keyboard.press('ControlOrMeta+Shift+z'); await settled(page)
  const redone = await project(page)
  expect(redone.document.revision).toBe(undone.document.revision + 1)
  expect(redone.appearance).toEqual(laterAppearance)

  await page.getByRole('tab', { name: '历史', exact: true }).click()
  await page.getByRole('button', { name: '查看快照 C5 联合基线', exact: true }).click()
  await page.getByLabel('局部恢复模式', { exact: true }).selectOption('outdoorGeometry')
  await page.getByRole('checkbox', { name: `恢复物件 ${areaId}`, exact: true }).check()
  await page.getByRole('button', { name: '预览局部恢复 · 1 件', exact: true }).click()
  const restoreIds = (await page.getByLabel('局部恢复完整实际范围', { exact: true }).inputValue()).split('\n')
  expect(restoreIds).toContain(areaId)
  expect(await project(page)).toEqual(redone)
  await expect(page.getByRole('button', { name: '保护当前并采用', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: '确认恢复完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '保护当前并采用', exact: true }).click(); await settled(page)
  const restored = await project(page)
  expect(restored.document.revision).toBe(redone.document.revision + 1)
  expect(restored.document.terrainAreas[areaId].boundaryMm).toEqual(originalBoundary)
  expect(restored.document.paths[pathId]).toEqual(laterPath)
  expect(restored.document.rooms[roomId]).toEqual(laterRoom)
  expect(restored.document.prefabInstances[prefabId]).toEqual(laterPrefab)
  expect(restored.appearance).toEqual(laterAppearance)
  expect(restored.document.entityLayers).toEqual(redone.document.entityLayers)
  const protection = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    return (await repository.listNamedSnapshots(workspace.getState().project!.document.sceneId)).filter(item => item.kind === 'protection')
  })
  expect(protection).toHaveLength(1)
  await expect.poll(() => page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    const saved = await repository.load(workspace.getState().project!.document.sceneId)
    return saved ? { document: saved.document, appearance: saved.appearance, historyIdentity: saved.historyIdentity } : null
  }), { timeout: 30_000 }).toEqual({ document: restored.document, appearance: restored.appearance, historyIdentity: restored.historyIdentity })
  await page.reload(); await expect(page.getByTestId('outdoor-workbench')).toBeVisible(); await settled(page)
  expect(await project(page)).toEqual(restored)
  expect(errors).toEqual([])
  await evidence(info, 'c5-joint-ui-restore', { roomId, areaId, pathId, prefabId, furnitureLayer, props: [first, second], restoreIds, canceledUnchanged: true,
    revisions: [baseline.document.revision, changed.document.revision, undone.document.revision, redone.document.revision, restored.document.revision], protection,
    preserved: { road: laterPath, room: laterRoom, prefab: laterPrefab, appearance: laterAppearance }, reopened: restored })
})

test('C5 shared UI preserves the complete v6 branch when layer, batch, appearance and support edits are refused', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await page.evaluate(async () => {
    const path = '/tests/c5-ui-fixtures.ts', { createC5BudgetProjectV6 } = await import(path) as typeof import('./c5-ui-fixtures')
    await (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.adoptNew(await createC5BudgetProjectV6())
  }); await settled(page)
  await page.getByRole('button', { name: '设为当前图层 C5 257 件', exact: true }).click()
  await page.getByRole('button', { name: '选择图层成员 C5 257 件', exact: true }).click()
  const viewport = page.getByLabel('地图视口', { exact: true })
  const ids = JSON.parse(await viewport.getAttribute('data-selected-ids') ?? '[]') as string[]
  expect(ids.slice().sort()).toEqual(C5_BUDGET_IDS)
  await expect(page.getByRole('button', { name: '预览批量移动', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '预览复制所选', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '移动所选到图层 · 257', exact: true })).toBeDisabled()
  const before = await project(page), appearance = page.getByRole('region', { name: '非破坏性外观', exact: true })
  await appearance.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  await appearance.getByLabel('外观亮度', { exact: true }).fill('0.5')
  await appearance.getByRole('button', { name: '预览外观调整', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /256|预算|展开/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toHaveCount(0)
  expect(await project(page)).toEqual(before)
  await page.getByRole('button', { name: '关闭工坊提示', exact: true }).click()

  await expect(page.getByRole('button', { name: '锁定图层 C5 支撑物件', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '取消外观草稿', exact: true }).click()
  expect(await project(page)).toEqual(before)
  await page.getByRole('button', { name: '锁定图层 C5 支撑物件', exact: true }).click(); await settled(page)
  const locked = await project(page)
  await page.getByRole('tab', { name: '室外', exact: true }).click()
  await page.getByRole('button', { name: 'c4-terrain', exact: true }).click()
  await page.getByLabel('室外对象坐标', { exact: true }).fill('900, 9000\n19000, 9000\n19000, 19000\n900, 19000')
  await page.getByRole('button', { name: '预览对象修改', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /锁/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '采用室外修改', exact: true })).toHaveCount(0)
  expect(await project(page)).toEqual(locked)
  await page.getByRole('button', { name: '关闭工坊提示', exact: true }).click()
  await page.getByRole('button', { name: '取消室外属性草稿', exact: true }).click()
  expect(await project(page)).toEqual(locked)
  await chooseProp(page, C5_SUPPORTED_PROP)
  await appearance.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  await appearance.getByLabel('外观亮度', { exact: true }).fill('0.5')
  await appearance.getByRole('button', { name: '预览外观调整', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /锁/ })).toBeVisible()
  expect(await project(page)).toEqual(locked)
  const persisted = await page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    const saved = await repository.load(workspace.getState().project!.document.sceneId)
    return { document: saved!.document, appearance: saved!.appearance, historyIdentity: saved!.historyIdentity }
  })
  expect(persisted).toEqual({ document: locked.document, appearance: locked.appearance, historyIdentity: locked.historyIdentity })
  await evidence(info, 'c5-rejected-cross-tool-branches', { selectedIds: ids, appearanceBudgetRejected: true, dependentLayerLocked: true, outdoorDependencyRejected: true, ownLayerAppearanceRejected: true, supportedProp: C5_SUPPORTED_PROP,
    revisions: [before.document.revision, locked.document.revision], unchangedAfterRefusals: true, persisted })
})

async function png(page: Page, audience: '主持人' | '玩家', info: TestInfo, stage: 'baseline' | 'hidden-solo' | 'secret-adjusted') {
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: audience, exact: true }).click(); await settled(page)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '4K PNG', exact: true }).click()
  const download = await pending, path = await download.path()
  if (!path) throw new Error('C5 PNG download has no actual file')
  const bytes = await readFile(path); await settled(page)
  const attachment = `c5-${stage}-${audience === '主持人' ? 'gm' : 'player'}-4k.png`
  await info.attach(attachment, { body: bytes, contentType: 'image/png' })
  const chunks: string[] = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    expect(offset + length + 12).toBeLessThanOrEqual(bytes.length); chunks.push(type); offset += length + 12
  }
  expect(chunks.at(-1)).toBe('IEND')
  for (const metadata of ['tEXt', 'zTXt', 'iTXt', 'eXIf']) expect(chunks).not.toContain(metadata)
  const pixels = await page.evaluate(async base64 => {
    const data = Uint8Array.from(atob(base64), character => character.charCodeAt(0)), image = await createImageBitmap(new Blob([data], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    try {
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
      context.drawImage(image, 0, 0)
      const digest = await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data)
      return { width: image.width, height: image.height, rgbaSha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') }
    } finally { image.close(); canvas.width = 0; canvas.height = 0 }
  }, bytes.toString('base64'))
  expect(pixels.width).toBe(4096); expect(pixels.height).toBe(4096)
  return { filename: download.suggestedFilename(), attachment, byteSha256: createHash('sha256').update(bytes).digest('hex'), chunks, ...pixels }
}

test('C5 mixed native-v6 4K audiences ignore editing eye and solo while secret appearance stays out of player pixels', async ({ page }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  await page.evaluate(async () => {
    const path = '/tests/c4-fixtures.ts', { createC4ProjectV6 } = await import(path) as typeof import('./c4-fixtures')
    await (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.adoptNew(await createC4ProjectV6({ title: 'C5 双受众混合工程' }))
  }); await settled(page)
  const secretLayer = await addLayer(page, 'C5 秘密')
  await chooseProp(page, 'c3-secret')
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '移动所选到图层…', exact: true }).click()
  await page.getByLabel('图层操作目标', { exact: true }).selectOption(secretLayer)
  expect((await page.getByLabel('图层操作完整 ID', { exact: true }).inputValue()).split('\n')).toEqual(['c3-secret'])
  await page.getByRole('button', { name: '预览图层修改', exact: true }).click(); await adopt(page, '图层')
  const baseline = await project(page)
  expect(baseline.document.props['c3-secret'].visibility).toBe('gm')
  expect(Object.keys(baseline.document.prefabInstances)).toContain('c4-prefab')
  expect(Object.keys(baseline.document.scatterGroups)).toContain('c4-scatter')
  const gm = await png(page, '主持人', info, 'baseline'), player = await png(page, '玩家', info, 'baseline')
  expect(gm.rgbaSha256).not.toBe(player.rgbaSha256)
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click(); await settled(page)
  await page.getByRole('button', { name: '隐藏图层 C5 秘密', exact: true }).click()
  await page.getByRole('button', { name: '独显图层 默认图层', exact: true }).click(); await settled(page)
  expect(await project(page)).toEqual(baseline)
  const hiddenGm = await png(page, '主持人', info, 'hidden-solo'), hiddenPlayer = await png(page, '玩家', info, 'hidden-solo')
  expect(hiddenGm.rgbaSha256).toBe(gm.rgbaSha256); expect(hiddenPlayer.rgbaSha256).toBe(player.rgbaSha256)
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click(); await settled(page)
  await page.getByRole('button', { name: '退出独显 默认图层', exact: true }).click()
  await page.getByRole('button', { name: '显示图层 C5 秘密', exact: true }).click(); await settled(page)
  await chooseProp(page, 'c3-secret')
  const appearance = page.getByRole('region', { name: '非破坏性外观', exact: true })
  await appearance.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  await appearance.getByLabel('外观亮度', { exact: true }).fill('0.25')
  await appearance.getByRole('button', { name: '预览外观调整', exact: true }).click(); await adopt(page, '组件')
  const changed = await project(page)
  expect(changed.document.props['c3-secret'].visibility).toBe('gm')
  expect(changed.document.props['c3-secret'].positionMm).toEqual(baseline.document.props['c3-secret'].positionMm)
  expect(changed.document.props['c3-secret'].supportRef).toEqual(baseline.document.props['c3-secret'].supportRef)
  const changedGm = await png(page, '主持人', info, 'secret-adjusted'), changedPlayer = await png(page, '玩家', info, 'secret-adjusted')
  expect(changedGm.rgbaSha256).not.toBe(gm.rgbaSha256); expect(changedPlayer.rgbaSha256).toBe(player.rgbaSha256)
  expect(errors).toEqual([])
  await evidence(info, 'c5-native-v6-paired-audience-pixels', { completeEnvelope: 'v6', identityVersion: baseline.historyIdentity.version, appearanceVersion: baseline.appearance.version, effectiveSceneSchema: baseline.document.schemaVersion,
    secretLayer, nativeMixedEntities: { prefab: 'c4-prefab', scatter: 'c4-scatter', terrain: 'c4-terrain', path: 'c4-path' }, gm, player, hiddenGm, hiddenPlayer, changedGm, changedPlayer,
    editorHiddenStateUnpersisted: true, playerPixelsUnchangedBySecretAppearance: true, revisions: [baseline.document.revision, changed.document.revision] })
})
