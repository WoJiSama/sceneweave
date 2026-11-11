// Normal UI setup; facts only from actual project downloads and DOM events.
import { closeWorkspaceDrawers, openWorkspaceModule } from './workspace-navigation-helpers'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import {
  clickKeyboardWorldPoint, createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes,
  keyboardWorkspaceSaved, openKeyboardPanel, placeKeyboardLamp, selectKeyboardProp,
} from './keyboard-ux-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
type GestureEvent = { type: string; trusted: boolean; pointerId?: number; pointerType?: string }
const groupName = '双灯填充体验组合'
const review = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true })
const viewport = (page: Page) => page.getByRole('group', { name: '地图视口', exact: true })

async function closeDrawers(page: Page): Promise<void> {
  await closeWorkspaceDrawers(page)
}

async function backup(page: Page, info: TestInfo, name: string): Promise<Backup> {
  await closeDrawers(page)
  return keyboardProjectBackup(page, info.outputPath(`${name}.sceneweave`))
}

async function fit(page: Page): Promise<void> {
  await closeDrawers(page)
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await expect(viewport(page)).toHaveAttribute('data-zoom', '1')
}

async function selected(page: Page, id: string): Promise<void> {
  await expect(viewport(page)).toHaveAttribute('data-selected-ids', JSON.stringify([id]))
}

async function placeSecondLamp(page: Page): Promise<void> {
  await closeDrawers(page)
  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  await library.getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  const inspector = await openKeyboardPanel(page, 'inspector')
  for (const [label, value] of [['放置 X', '4'], ['放置 Y', '5.5'], ['放置旋转', '15']]) {
    const input = inspector.getByLabel(label, { exact: true })
    await input.fill(value); await input.press('Tab')
  }
  await inspector.getByRole('button', { name: '在此放置', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await closeDrawers(page)
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
}

async function createLampGroup(page: Page, info: TestInfo, width: number): Promise<Backup> {
  await createKeyboardProject(page, `组合与填充柄 ${width}`)
  await placeKeyboardLamp(page)
  await placeSecondLamp(page)
  await fit(page)
  await page.getByRole('button', { name: '全选可编辑对象', exact: true }).click()
  const inspector = await openKeyboardPanel(page, 'inspector')
  await expect(inspector.getByRole('heading', { name: '已选择 2 个对象', exact: true })).toBeVisible()
  await openDetailsBySummary(inspector, /^组合与重复布置$/)
  const tools = inspector.getByRole('region', { name: '固定组合工具', exact: true })
  await tools.getByLabel('新组合名称', { exact: true }).fill(groupName)
  await tools.getByRole('button', { name: '预览保存组合 · 2 件', exact: true }).click()
  await review(page).getByRole('button', { name: '采用组件修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const grouped = await backup(page, info, 'group-created')
  expect(Object.keys(grouped.document.props)).toHaveLength(2)
  expect(Object.keys(grouped.document.prefabInstances)).toHaveLength(1)
  const [group] = Object.values(grouped.document.prefabInstances)
  const memberIds = Object.values(group.members).flatMap(member => member.propId ? [member.propId] : [])
  expect(memberIds).toHaveLength(2)
  expect(group.visibility).toBe('public')

  // Actual canvas selection must distinguish the whole group and its member.
  await fit(page)
  await page.getByLabel('选择组合成员', { exact: true }).uncheck()
  await clickKeyboardWorldPoint(page, grouped.document.props[memberIds[0]].positionMm, grouped.document.exportBoundsMm)
  await selected(page, group.id)
  await page.getByLabel('选择组合成员', { exact: true }).check()
  await clickKeyboardWorldPoint(page, grouped.document.props[memberIds[1]].positionMm, grouped.document.exportBoundsMm)
  await selected(page, memberIds[1])
  const memberInspector = await openKeyboardPanel(page, 'inspector')
  await expect(memberInspector.getByRole('heading', { name: '物件属性', exact: true })).toBeVisible()
  await expect(memberInspector.getByRole('button', { name: '拖拽填充柄', exact: true })).toHaveCount(0)

  // A member edit after freezing the definition creates real manual overrides.
  for (const [label, value] of [['物件 X', '4.25'], ['物件旋转', '35']]) {
    const input = memberInspector.getByLabel(label, { exact: true })
    await input.fill(value); await input.press('Tab')
    await keyboardWorkspaceSaved(page)
  }
  await memberInspector.getByRole('button', { name: `选择整个${groupName}`, exact: true }).click()
  await selected(page, group.id)
  await expect(memberInspector.getByRole('heading', { name: '组合属性', exact: true })).toBeVisible()
  // Also exercise the member list and its explicit route back to the group.
  await memberInspector.locator('.asset-member-list button').first().click()
  await selected(page, memberIds[0])
  await memberInspector.getByRole('button', { name: `选择整个${groupName}`, exact: true }).click()
  await closeDrawers(page)
  await page.getByLabel('选择组合成员', { exact: true }).uncheck()
  // The two real members give a 4.750m group anchor. Quarter-grid snapping
  // keeps that Y exact while the drag requests a 2.000m horizontal step.
  await page.getByLabel('子格细分', { exact: true }).selectOption('4')
  await page.getByLabel('吸附锚点', { exact: true }).selectOption('intersection')
  const before = await backup(page, info, 'fill-before')
  const edited = before.document.props[memberIds[1]]
  expect(edited).toMatchObject({ positionMm: { x: 4250, y: grouped.document.props[memberIds[1]].positionMm.y }, rotationDeg: 35, visibility: 'public' })
  expect(edited.supportRef.kind).toBe('floor')
  const record = Object.values(before.document.prefabInstances[group.id].members).find(member => member.propId === edited.id)!
  expect(record.overrideFields).toEqual(expect.arrayContaining(['positionMm', 'rotationDeg']))
  expect(before.document.prefabDefinitions).toEqual(grouped.document.prefabDefinitions)
  return before
}

async function beginFill(page: Page, before: Backup): Promise<void> {
  const [group] = Object.values(before.document.prefabInstances)
  const memberId = Object.values(group.members).find(member => member.propId)!.propId!
  await selectKeyboardProp(page, memberId)
  await closeDrawers(page)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByRole('button', { name: `选择整个${groupName}`, exact: true }).click()
  await openDetailsBySummary(inspector, /^填充复制$/)
  await inspector.getByLabel('填充副本数量', { exact: true }).fill('2')
  await inspector.getByRole('button', { name: '拖拽填充柄', exact: true }).click()
  await fit(page)
  await expect(page.getByTestId('fill-copy-handle')).toBeVisible()
}

async function observeDrag(page: Page): Promise<void> {
  await page.getByTestId('fill-copy-overlay').evaluate(node => {
    const events: GestureEvent[] = []
    Reflect.set(window, '__fillGestureEvents', events)
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      node.addEventListener(type, event => {
        const pointer = event as PointerEvent
        events.push({ type, trusted: event.isTrusted, pointerId: pointer.pointerId, pointerType: pointer.pointerType })
      }, { capture: true })
    }
    window.addEventListener('blur', event => events.push({ type: 'blur', trusted: event.isTrusted }), { once: true })
  })
}

async function events(page: Page): Promise<GestureEvent[]> {
  return page.evaluate(() => Reflect.get(window, '__fillGestureEvents') as GestureEvent[])
}

async function dragByTwoMetres(page: Page, before: Backup): Promise<number> {
  const [group] = Object.values(before.document.prefabInstances)
  await observeDrag(page)
  const handle = page.getByTestId('fill-copy-handle'), box = await handle.boundingBox()
  const canvas = await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox()
  if (!box || !canvas) throw new Error('Expected the rendered group fill handle and canvas.')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  expect(await handle.evaluate((node, point) => document.elementFromPoint(point.x, point.y) === node, start)).toBe(true)
  const bounds = before.document.exportBoundsMm
  await page.mouse.move(start.x, start.y); await page.mouse.down()
  await page.mouse.move(canvas.x + (group.anchorMm.x + 2000 - bounds.x) / bounds.width * canvas.width,
    canvas.y + (group.anchorMm.y - bounds.y) / bounds.height * canvas.height, { steps: 6 })
  const down = (await events(page)).find(event => event.type === 'pointerdown')!
  expect(down).toMatchObject({ trusted: true, pointerType: 'mouse' })
  await expect(viewport(page)).toBeFocused()
  expect(await page.getByTestId('fill-copy-overlay').evaluate((node, id) => node.hasPointerCapture(id), down.pointerId!)).toBe(true)
  await expect(page.locator('.asset-selection-notice')).toContainText('副本 2 份')
  return down.pointerId!
}

async function previewFill(page: Page, before: Backup): Promise<void> {
  await beginFill(page, before)
  await dragByTwoMetres(page, before)
  await page.mouse.up()
  await expect(page.getByTestId('fill-copy-overlay')).toHaveCount(0)
  await expect(review(page).getByLabel('填充复制参数', { exact: true })).toContainText('组合 · 新增 2 份')
  await expect(review(page)).toContainText('每份偏移 2.000 m, 0.000 m')
  await expect(review(page).getByRole('button', { name: '采用填充复制', exact: true })).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision))
  await keyboardWorkspaceSaved(page)
}

async function coldBackup(page: Page, info: TestInfo, expected: Backup): Promise<void> {
  await page.reload()
  await expect(page.locator('.asset-save')).toHaveText('尚未打开工程')
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${expected.document.sceneId}"]`)
    .getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await backup(page, info, 'fill-cold')
  expect(cold.hashes).toEqual(expected.hashes)
  expect(cold.document).toEqual(expected.document)
  expect(cold.appearance).toEqual(expected.appearance)
  expect(cold.identity).toEqual(expected.identity)
}

for (const size of [{ width: 1512, height: 982 }, { width: 390, height: 844 }]) {
  test(`production group selection and fill handle preview cancel adopt undo redo cold read at ${size.width}px`, async ({ page, browser }, info) => {
    test.setTimeout(300000)
    await page.setViewportSize(size)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const before = await createLampGroup(page, info, size.width)
    const [source] = Object.values(before.document.prefabInstances)
    const undo = page.getByRole('button', { name: '撤销编辑', exact: true })
    const redo = page.getByRole('button', { name: '重做编辑', exact: true })
    await expect(undo).toBeEnabled(); await expect(redo).toBeDisabled()
    await previewFill(page, before)
    await page.screenshot({ path: info.outputPath('group-fill-preview.png') })
    await review(page).getByRole('button', { name: '取消填充复制预览', exact: true }).click()
    await expect(review(page)).toHaveCount(0)
    expect((await backup(page, info, 'fill-cancelled')).hashes).toEqual(before.hashes)
    await expect(undo).toBeEnabled(); await expect(redo).toBeDisabled()
    await previewFill(page, before)
    await viewport(page).focus(); await page.keyboard.press('Escape')
    await expect(review(page)).toHaveCount(0)
    expect((await backup(page, info, 'fill-candidate-escape')).hashes).toEqual(before.hashes)
    await previewFill(page, before)
    const details = review(page).locator('details.composition-preview-details')
    await details.locator(':scope > summary').focus()
    if (await details.getAttribute('open') === null) await page.keyboard.press('Space')
    await expect(details).toHaveAttribute('open', '')
    const fields = details.locator('summary').filter({ hasText: '字段与 ID 详情' }).first()
    await fields.focus(); await page.keyboard.press('Space')
    const adopt = review(page).getByRole('button', { name: '采用填充复制', exact: true })
    for (let index = 0; index < 80 && !await adopt.evaluate(node => document.activeElement === node); index++) await page.keyboard.press('Tab')
    await expect(adopt).toBeFocused()
    await expect(adopt).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: info.outputPath('group-fill-long-review-keyboard.png') })
    await page.keyboard.press('Enter')
    await expect(review(page)).toHaveCount(0)
    await keyboardWorkspaceSaved(page)
    await page.screenshot({ path: info.outputPath('group-fill-adopted.png') })
    const adopted = await backup(page, info, 'fill-adopted')
    expect(adopted.document.revision).toBe(before.document.revision + 1)
    expect(adopted.document.prefabInstances[source.id]).toEqual(source)
    expect(Object.keys(adopted.document.props)).toHaveLength(6)
    const copies = Object.values(adopted.document.prefabInstances).filter(group => group.id !== source.id)
      .sort((a, b) => a.anchorMm.x - b.anchorMm.x)
    expect(copies).toHaveLength(2)
    for (const [id, original] of Object.entries(before.document.props)) expect(adopted.document.props[id]).toEqual(original)
    for (const [index, copy] of copies.entries()) {
      const dx = (index + 1) * 2000
      expect(copy).toEqual({ ...source, id: copy.id, members: copy.members,
        anchorMm: { x: source.anchorMm.x + dx, y: source.anchorMm.y } })
      expect(Object.keys(copy.members)).toEqual(Object.keys(source.members))
      expect(adopted.document.entityLayers[copy.id]).toBe(before.document.entityLayers[source.id])
      expect(adopted.identity.prefabTokens[copy.id]).toBeTruthy()
      expect(adopted.identity.prefabTokens[copy.id]).not.toBe(before.identity.prefabTokens[source.id])
      for (const [key, member] of Object.entries(source.members)) {
        const original = before.document.props[member.propId!], copied = adopted.document.props[copy.members[key].propId!]
        expect(copied.id).not.toBe(original.id)
        expect(copy.members[key].overrideFields).toEqual(member.overrideFields)
        expect(copied).toEqual({ ...original, id: copied.id, renderOrder: copied.renderOrder,
          positionMm: { x: original.positionMm.x + dx, y: original.positionMm.y } })
        expect(adopted.document.entityLayers[copied.id]).toBe(before.document.entityLayers[original.id])
        expect(adopted.identity.propTokens[copied.id]).toBeTruthy()
        expect(adopted.identity.propTokens[copied.id]).not.toBe(before.identity.propTokens[original.id])
        expect(adopted.appearance.propSources[copied.id]).toBe(before.appearance.propSources[original.id])
        expect(adopted.appearance.instanceAdjustments[copied.id] ?? []).toEqual(before.appearance.instanceAdjustments[original.id] ?? [])
      }
    }
    expect(adopted.document.prefabDefinitions).toEqual(before.document.prefabDefinitions)
    expect(adopted.document.propDefinitions).toEqual(before.document.propDefinitions)
    expect(adopted.appearance.sources).toEqual(before.appearance.sources)
    expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(before.hashes))
    await undo.click(); await keyboardWorkspaceSaved(page)
    await expect(redo).toBeEnabled()
    const undone = await backup(page, info, 'fill-undone')
    expect(undone.document).toEqual({ ...before.document, revision: before.document.revision + 2, updatedAt: undone.document.updatedAt })
    expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(before.hashes))
    await redo.click(); await keyboardWorkspaceSaved(page)
    const redone = await backup(page, info, 'fill-redone')
    expect(redone.document).toEqual({ ...adopted.document, revision: before.document.revision + 3, updatedAt: redone.document.updatedAt })
    await coldBackup(page, info, redone)
    const dimensions = await page.evaluate(() => ({ width: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
    expect(dimensions.root).toBeLessThanOrEqual(dimensions.width)
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.width)
    expect(errors).toEqual([])
    await writeFile(info.outputPath('fill-handle-facts.json'), JSON.stringify({ viewport: size, browserVersion: browser.version(), dimensions,
      group: source, copies, revisions: [before.document.revision, adopted.document.revision, undone.document.revision, redone.document.revision], errors,
      privacy: 'Actual normal-UI sample has public group and public members on Floor support; visibility/support fields are compared in full.',
      excluded: ['gm group/member or private support cases', 'full player confidentiality pixels', 'deleted slots', 'all locks and dependency combinations', 'visual P3'] }, null, 2))
  })

  test(`production fill handle interruptions preserve the group and can start again at ${size.width}px`, async ({ page, browser }, info) => {
    test.setTimeout(360000)
    await page.setViewportSize(size)
    const errors: string[] = [], facts: unknown[] = []
    page.on('pageerror', error => errors.push(error.message))
    const before = await createLampGroup(page, info, size.width)
    for (const interruption of ['lostcapture', 'escape', 'outside', 'blur-handler'] as const) {
      await beginFill(page, before)
      const pointerId = await dragByTwoMetres(page, before)
      const overlay = page.getByTestId('fill-copy-overlay')
      await page.screenshot({ path: info.outputPath(`${interruption}-dragging.png`) })
      if (interruption === 'lostcapture') {
        // Browser capture API plus a real subsequent move produces the native loss event.
        await overlay.evaluate((node, id) => node.releasePointerCapture(id), pointerId)
        await page.mouse.move(12, 12)
      } else if (interruption === 'escape') {
        await page.keyboard.press('Escape')
      } else if (interruption === 'outside') {
        const canvas = (await page.getByLabel('材质场景主持人预览', { exact: true }).boundingBox())!
        await page.mouse.move(canvas.x + canvas.width + 20, canvas.y + canvas.height / 2, { steps: 4 })
        await page.mouse.up()
        await expect(page.locator('.asset-selection-notice')).toContainText('地图范围内松开')
        await expect(review(page)).toHaveCount(0)
        await page.keyboard.press('Escape')
      } else {
        // Synthetic handler check only. This does not prove native OS/window focus loss.
        await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      }
      const observed = await events(page)
      // Keep raw observations even when the expected cancellation exposes a product defect.
      await writeFile(info.outputPath(`${interruption}-events.json`), JSON.stringify({ interruption, pointerId, observed,
        overlayCount: await overlay.count(), reviewCount: await review(page).count(), syntheticWindowBlur: interruption === 'blur-handler' }, null, 2))
      await expect(overlay).toHaveCount(0)
      await page.mouse.up()
      await expect(review(page)).toHaveCount(0)
      if (interruption === 'lostcapture') expect(observed.some(event => event.type === 'lostpointercapture' && event.trusted)).toBe(true)
      if (interruption === 'blur-handler') expect(observed.some(event => event.type === 'blur' && !event.trusted)).toBe(true)
      await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision))
      await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
      await expect(page.getByRole('button', { name: '重做编辑', exact: true })).toBeDisabled()
      expect((await backup(page, info, `${interruption}-cancelled`)).hashes).toEqual(before.hashes)
      // A fresh real drag after each interruption must still preview and cancel normally.
      await previewFill(page, before)
      await review(page).getByRole('button', { name: '取消填充复制预览', exact: true }).click()
      await expect(review(page)).toHaveCount(0)
      expect((await backup(page, info, `${interruption}-recovery`)).hashes).toEqual(before.hashes)
      facts.push({ interruption, pointerId, observed })
    }
    await coldBackup(page, info, before)
    expect(errors).toEqual([])
    await writeFile(info.outputPath('fill-interruption-facts.json'), JSON.stringify({ viewport: size, browserVersion: browser.version(), facts, errors,
      excluded: ['native OS/window focus loss', 'touch pointercancel', 'gm/privacy matrix', 'all dependency/lock cases', 'visual P3'] }, null, 2))
  })
}
