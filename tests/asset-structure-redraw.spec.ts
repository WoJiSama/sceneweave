import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { VectorStructurePlan } from '../src/shared/asset-refinement/structure-plan'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, placeKeyboardLamp, selectKeyboardProp } from './keyboard-ux-helpers'

/** Independent generic geometry fixture. It does not call the compiler or trace source pixels. */
function drawingPlan(source: { sha256: string; pixelWidth: number; pixelHeight: number }): VectorStructurePlan {
  const w = source.pixelWidth, h = source.pixelHeight
  return {
    version: 1, source: { sha256: source.sha256, width: w, height: h },
    summary: '浏览器独立结构夹具：按源坐标框画曲线主体，重复细节明确标作推断，不声称自动识别原物件。',
    gradients: [{ id: 'body_tone', x1: w * .2, y1: h * .2, x2: w * .8, y2: h * .8,
      stops: [{ offset: 0, color: '#8b7559' }, { offset: 1, color: '#3d332a' }] }],
    elements: [
      { kind: 'path', id: 'body', name: '曲线主体', evidence: 'observed', reason: '测试用可编辑曲线主体，几何由源框比例给定。',
        d: `M${w * .2} ${h * .2}L${w * .75} ${h * .2}Q${w * .88} ${h * .2} ${w * .88} ${h * .35}L${w * .88} ${h * .7}Q${w * .88} ${h * .82} ${w * .75} ${h * .82}L${w * .2} ${h * .82}Z`,
        fill: { gradient: 'body_tone' }, stroke: '#211e1a', strokeWidth: Math.min(2, Math.min(w, h) * .01), linejoin: 'round' },
      { kind: 'repeatRects', id: 'repeated_details', name: '重复细节', evidence: 'inferred', reason: '原图没有提供此规则节律；这是明确标记的推断测试形状。',
        x: w * .29, y: h * .34, width: w * .045, height: h * .3, stepX: w * .095, stepY: 0, count: 5, fill: '#d9cfb5' },
    ],
  }
}

async function uploadPlan(panel: Locator, plan: VectorStructurePlan, name = 'independent-structure.json') {
  const text = JSON.stringify(plan, null, 2)
  await panel.getByLabel('载入SVG结构稿', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(panel.getByLabel('SVG结构稿源码', { exact: true })).toHaveValue(text)
  return text
}

async function openStructureEditor(page: Page, info: TestInfo) {
  await createKeyboardProject(page, '独立结构重绘页面旅程')
  await placeKeyboardLamp(page)
  const saved = await keyboardProjectBackup(page, info.outputPath('source.sceneweave'))
  const prop = Object.values(saved.document.props).find(value => value.definitionRef && saved.document.propDefinitions[value.definitionRef.id].name === '铜色桌灯')!
  if (!prop || prop.appearance.kind !== 'image') throw new Error('普通放置的桌灯缺少源图。')
  const sourceAsset = saved.document.assets[prop.appearance.assetId]
  const { editor, panel } = await openExistingStructureEditor(page, prop.id)
  return { saved, prop, sourceAsset, editor, panel }
}

async function openExistingStructureEditor(page: Page, id: string) {
  await selectKeyboardProp(page, id)
  await (await openKeyboardPanel(page, 'inspector')).getByRole('button', { name: '编辑素材', exact: true }).click()
  const editor = page.getByTestId('scene-asset-editor')
  await editor.getByRole('button', { name: '图像处理', exact: true }).click()
  const panel = editor.getByRole('region', { name: '素材图像精修', exact: true })
  await expect(panel.getByLabel('精修原图对照画布', { exact: true })).toBeVisible()
  await expect(panel.getByLabel('载入SVG结构稿', { exact: true })).toBeEnabled()
  await expect(panel.getByLabel('SVG重建方式', { exact: true })).toHaveValue('structure')
  await expect(panel.getByRole('button', { name: '生成结构重绘候选', exact: true })).toBeDisabled()
  return { editor, panel }
}

async function closeEditor(page: Page, editor: Locator) {
  await editor.getByRole('button', { name: '关闭素材编辑', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: '关闭素材编辑确认', exact: true })
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: '丢弃本页草稿并关闭', exact: true }).click()
  await expect(editor).toHaveCount(0)
}

function observe(page: Page) {
  const errors: string[] = [], modelRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/v1\/image-edit(?:\/|$)/.test(new URL(request.url()).pathname)) modelRequests.push(`${request.method()} ${request.url()}`) })
  return { errors, modelRequests }
}

test('source-bound SVG structure redraw keeps inference and editable geometry through scene adoption, undo, redo and cold reopening', async ({ page }, info) => {
  test.setTimeout(180000)
  const observations = observe(page)
  const { saved, prop, sourceAsset, editor, panel } = await openStructureEditor(page, info)
  const plan = drawingPlan(sourceAsset), planText = await uploadPlan(panel, plan)
  const review = panel.locator('[aria-label="结构稿审阅"]')
  await expect(review).toContainText('1 项依据原图 · 1 项含推断')
  await review.locator('details > summary').click()
  await expect(review.getByText('曲线主体', { exact: true })).toBeVisible()
  await expect(review.getByText('重复细节', { exact: true })).toBeVisible()
  await expect(review).toContainText(plan.elements[1].reason)
  await panel.getByRole('button', { name: '生成结构重绘候选', exact: true }).click()
  const candidate = panel.getByLabel('精修候选对照画布', { exact: true })
  await expect(candidate).toBeVisible({ timeout: 90000 })
  await expect(panel.getByRole('alert')).toHaveCount(0)
  const candidatePixels = await candidate.evaluate(node => (node as HTMLCanvasElement).toDataURL())
  await panel.getByLabel('精修检查背景', { exact: true }).selectOption('black')
  await expect(panel.locator('.image-refinement-comparison')).toHaveAttribute('data-background', 'black')
  await panel.getByLabel('精修对照缩放', { exact: true }).selectOption('200')
  await panel.screenshot({ path: info.outputPath('structure-black-comparison.png') })
  await panel.getByLabel('精修检查背景', { exact: true }).selectOption('white')
  await expect(panel.locator('.image-refinement-comparison')).toHaveAttribute('data-background', 'white')
  expect(await candidate.evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(candidatePixels)

  // The changed plan is a draft; its previously generated image remains visible but cannot be adopted.
  await panel.locator('details.image-refinement-plan-source > summary').click()
  const sourceText = panel.getByLabel('SVG结构稿源码', { exact: true })
  const changedPlan = { ...plan, elements: plan.elements.map((element, index) => index === 1 ? { ...element, fill: '#bcae8f' } : element) }
  await sourceText.fill(JSON.stringify(changedPlan, null, 2))
  await expect(panel.getByRole('button', { name: '在场景中预览', exact: true })).toBeDisabled()
  await expect(panel).toContainText('当前仍显示上一次候选')
  expect(await candidate.evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(candidatePixels)
  await sourceText.fill(planText)
  await expect(panel.getByRole('button', { name: '在场景中预览', exact: true })).toBeEnabled()

  await panel.getByLabel('SVG重建方式', { exact: true }).selectOption('vector')
  await panel.getByLabel('矢量颜色数量', { exact: true }).fill('16')
  await expect(candidate).toHaveCount(0)
  await panel.getByRole('button', { name: '模型补画', exact: true }).click()
  await panel.getByLabel('模型补画要求', { exact: true }).fill('保留独立路线中的补画要求。')
  await expect(panel.getByRole('button', { name: '上传并生成一次补画候选', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: '矢量重建', exact: true }).click()
  await expect(panel.getByLabel('SVG重建方式', { exact: true })).toHaveValue('vector')
  await expect(panel.getByLabel('矢量颜色数量', { exact: true })).toHaveValue('16')
  await panel.getByLabel('SVG重建方式', { exact: true }).selectOption('structure')
  await expect(sourceText).toHaveValue(planText)
  expect(await candidate.evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(candidatePixels)
  await expect(panel.getByLabel('精修检查背景', { exact: true })).toHaveValue('white')
  await expect(panel.getByLabel('精修对照缩放', { exact: true })).toHaveValue('200')

  await panel.locator('details.image-refinement-svg > summary').click()
  const svg = await panel.getByLabel('精修候选SVG源码', { exact: true }).inputValue()
  expect(svg).toContain('<linearGradient')
  expect(svg).toContain('<path')
  expect(svg).toMatch(/\bQ/)
  expect(svg).not.toMatch(/<image\b|\bhref\s*=|<script\b|<foreignObject\b/)
  const downloading = page.waitForEvent('download'), svgPath = info.outputPath('structure-candidate.svg')
  await panel.getByRole('link', { name: '下载候选 SVG', exact: true }).click()
  await (await downloading).saveAs(svgPath)
  expect(await readFile(svgPath, 'utf8')).toBe(svg)
  const svgHash = createHash('sha256').update(svg).digest('hex')
  await panel.getByRole('button', { name: '在场景中预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用图像候选', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '采用图像候选', exact: true }).click()
  await closeEditor(page, editor)
  await keyboardWorkspaceSaved(page)
  const adoptedPath = info.outputPath('structure-adopted.sceneweave'), adopted = await keyboardProjectBackup(page, adoptedPath)
  const current = adopted.document.props[prop.id]
  if (current.appearance.kind !== 'image') throw new Error('结构重绘采用后缺少图片。')
  const asset = adopted.document.assets[current.appearance.assetId]
  expect(asset.imageRefinement).toMatchObject({ version: 1, kind: 'vector', algorithm: 'structure-plan-v1', plan,
    sourceAssetId: sourceAsset.id, originalAssetId: sourceAsset.id, sourceSha256: sourceAsset.sha256,
    outputSha256: asset.sha256 })
  expect(adopted.document.assets[sourceAsset.id]).toEqual(sourceAsset)
  expect(asset.logicalSizeMm).toEqual(sourceAsset.logicalSizeMm)
  expect(asset.origin).toEqual(sourceAsset.origin)
  expect(asset.licenseRef).toBe(sourceAsset.licenseRef)
  for (const key of ['positionMm', 'rotationDeg', 'visualBoundsMm', 'footprintMm', 'footprintOffsetMm', 'blocksMovement', 'blocksSight', 'roomId', 'floorId', 'supportRef', 'visibility', 'editLocked', 'shadowClass', 'shadowOverride'] as const) expect(current[key]).toEqual(prop[key])
  expect(adopted.document.sceneId).toBe(saved.document.sceneId)
  for (const [path, hash] of Object.entries(keyboardResourceHashes(saved.hashes))) if (path !== 'sources.json') expect(adopted.hashes[path]).toBe(hash)
  expect(adopted.hashes[`sources/${svgHash}.svg`]).toBe(svgHash)
  const adoptedFiles = unzipSync(new Uint8Array(await readFile(adoptedPath)))
  const authoringSources = JSON.parse(new TextDecoder().decode(adoptedFiles['sources.json']))
  expect(authoringSources[asset.id]).toMatchObject({ kind: 'svg', sourceSha256: svgHash, rasterSha256: asset.sha256 })

  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('structure-undone.sceneweave'))
  expect(undone.document.props[prop.id].appearance).toEqual(prop.appearance)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('structure-redone.sceneweave'))
  expect(redone.document.props[prop.id].appearance).toEqual(current.appearance)
  expect(redone.document.assets[asset.id]).toEqual(asset)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${adopted.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('structure-cold.sceneweave'))
  expect(cold.document.props[prop.id]).toEqual(current)
  expect(cold.document.assets[asset.id]).toEqual(asset)
  expect(cold.document.assets[sourceAsset.id]).toEqual(sourceAsset)
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(adopted.hashes))
  await selectKeyboardProp(page, prop.id)
  await (await openKeyboardPanel(page, 'inspector')).getByRole('button', { name: '编辑素材', exact: true }).click()
  const reopenedEditor = page.getByTestId('scene-asset-editor')
  await reopenedEditor.getByRole('button', { name: '图像处理', exact: true }).click()
  const reopenedPanel = reopenedEditor.getByRole('region', { name: '素材图像精修', exact: true })
  await reopenedPanel.getByRole('button', { name: '读取已保存结构稿', exact: true }).click()
  await expect.poll(async () => {
    const text = await reopenedPanel.getByLabel('SVG结构稿源码', { exact: true }).inputValue()
    return text ? JSON.parse(text) : null
  }).toEqual(plan)
  await expect(reopenedPanel.locator('[aria-label="结构稿审阅"]')).toContainText('1 项依据原图 · 1 项含推断')
  await closeEditor(page, reopenedEditor)
  expect(observations.modelRequests).toEqual([])
  expect(observations.errors).toEqual([])
})

test('another-source structure plan is rejected without replacing a reviewed candidate or changing the scene', async ({ page }, info) => {
  test.setTimeout(120000)
  const observations = observe(page)
  const { saved, prop, sourceAsset, editor, panel } = await openStructureEditor(page, info)
  const plan = drawingPlan(sourceAsset), planText = await uploadPlan(panel, plan)
  await panel.getByRole('button', { name: '生成结构重绘候选', exact: true }).click()
  const candidate = panel.getByLabel('精修候选对照画布', { exact: true })
  await expect(candidate).toBeVisible({ timeout: 90000 })
  const pixels = await candidate.evaluate(node => (node as HTMLCanvasElement).toDataURL())
  const badPlan = { ...plan, source: { ...plan.source, sha256: '0'.repeat(64) } }
  await uploadPlan(panel, badPlan, 'wrong-source-structure.json')
  await panel.getByRole('button', { name: '生成结构重绘候选', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('结构稿来源hash或尺寸与当前基线不匹配')
  expect(await candidate.evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(pixels)
  await expect(panel.getByRole('button', { name: '在场景中预览', exact: true })).toBeDisabled()
  await uploadPlan(panel, plan)
  await expect(panel.getByLabel('SVG结构稿源码', { exact: true })).toHaveValue(planText)
  await expect(panel.getByRole('button', { name: '在场景中预览', exact: true })).toBeEnabled()
  await closeEditor(page, editor)
  await keyboardWorkspaceSaved(page)
  const unchanged = await keyboardProjectBackup(page, info.outputPath('wrong-source-discarded.sceneweave'))
  expect(unchanged.document.props[prop.id]).toEqual(prop)
  expect(unchanged.document.assets).toEqual(saved.document.assets)
  expect(keyboardResourceHashes(unchanged.hashes)).toEqual(keyboardResourceHashes(saved.hashes))
  expect(observations.modelRequests).toEqual([])
  expect(observations.errors).toEqual([])
})

test('a structure redraw based on a basic-edited parent recovers that exact parent after cold reopening and supports continued editing', async ({ page }, info) => {
  test.setTimeout(240000)
  const observations = observe(page)
  const { saved, prop, sourceAsset, editor } = await openStructureEditor(page, info)
  const basic = editor.getByRole('region', { name: '画质候选编辑', exact: true, includeHidden: true })
  await basic.locator('xpath=..').locator('summary').click()
  await expect(basic.getByLabel('画质原图与范围画布', { exact: true })).toBeVisible()
  await basic.getByLabel('画质改善方向', { exact: true }).selectOption('clarity')
  await basic.getByRole('button', { name: '生成 2 个候选', exact: true }).click()
  const basicCandidates = basic.getByRole('group', { name: '画质候选列表', exact: true }).getByRole('button')
  await expect(basicCandidates).toHaveCount(2, { timeout: 60000 })
  await basicCandidates.nth(1).click()
  await basic.getByRole('button', { name: '在场景中预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用图像候选', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '采用图像候选', exact: true }).click()
  await closeEditor(page, editor)
  await keyboardWorkspaceSaved(page)
  const basicSaved = await keyboardProjectBackup(page, info.outputPath('chain-basic-parent.sceneweave'))
  const basicProp = basicSaved.document.props[prop.id]
  if (basicProp.appearance.kind !== 'image') throw new Error('基础处理后物件缺少图片。')
  const parentAsset = basicSaved.document.assets[basicProp.appearance.assetId]
  expect(parentAsset.sha256).not.toBe(sourceAsset.sha256)
  expect([parentAsset.pixelWidth, parentAsset.pixelHeight]).toEqual([sourceAsset.pixelWidth * 2, sourceAsset.pixelHeight * 2])
  expect(parentAsset.imageEnhancement).toMatchObject({ sourceAssetId: sourceAsset.id, originalAssetId: sourceAsset.id,
    recipe: { direction: 'clarity', scale: 2 } })

  const next = await openExistingStructureEditor(page, prop.id)
  await next.panel.getByLabel('精修图像依据', { exact: true }).selectOption('current')
  const parentCanvas = next.panel.getByLabel('精修原图对照画布', { exact: true })
  await expect(parentCanvas).toHaveAttribute('width', String(parentAsset.pixelWidth))
  await expect(parentCanvas).toHaveAttribute('height', String(parentAsset.pixelHeight))
  await expect(next.panel.getByLabel('载入SVG结构稿', { exact: true })).toBeEnabled()
  const plan = drawingPlan(parentAsset)
  await uploadPlan(next.panel, plan, 'edited-parent-structure.json')
  await next.panel.getByRole('button', { name: '生成结构重绘候选', exact: true }).click()
  await expect(next.panel.getByLabel('精修候选对照画布', { exact: true })).toBeVisible({ timeout: 90000 })
  await expect(next.panel.getByRole('alert')).toHaveCount(0)
  await next.panel.getByRole('button', { name: '在场景中预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用图像候选', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '采用图像候选', exact: true }).click()
  await closeEditor(page, next.editor)
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('chain-structure.sceneweave'))
  const adoptedProp = adopted.document.props[prop.id]
  if (adoptedProp.appearance.kind !== 'image') throw new Error('结构重绘后物件缺少图片。')
  const output = adopted.document.assets[adoptedProp.appearance.assetId]
  expect(output.imageRefinement).toMatchObject({ kind: 'vector', algorithm: 'structure-plan-v1', sourceAssetId: parentAsset.id,
    originalAssetId: sourceAsset.id, sourceSha256: parentAsset.sha256, plan })
  expect(adopted.document.assets[parentAsset.id]).toEqual(parentAsset)
  expect(adopted.document.assets[sourceAsset.id]).toEqual(sourceAsset)

  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${saved.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('chain-cold.sceneweave'))
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(adopted.hashes))
  const reopened = await openExistingStructureEditor(page, prop.id)
  const basis = reopened.panel.getByLabel('精修图像依据', { exact: true })
  const loadPlan = reopened.panel.getByRole('button', { name: '读取已保存结构稿', exact: true })
  const sourceCanvas = reopened.panel.getByLabel('精修原图对照画布', { exact: true })
  await expect(basis).toHaveValue('original')
  await expect(sourceCanvas).toHaveAttribute('width', String(sourceAsset.pixelWidth))
  await expect(loadPlan).toBeDisabled()
  await basis.selectOption('current')
  await expect(sourceCanvas).toHaveAttribute('width', String(output.pixelWidth))
  await expect(loadPlan).toBeDisabled()
  await basis.selectOption({ label: '已保存结构稿来源' })
  await expect(basis).toHaveValue('savedStructure')
  await expect(sourceCanvas).toHaveAttribute('width', String(parentAsset.pixelWidth))
  await expect(sourceCanvas).toHaveAttribute('height', String(parentAsset.pixelHeight))
  await expect(loadPlan).toBeEnabled()
  await loadPlan.click()
  const sourceText = reopened.panel.getByLabel('SVG结构稿源码', { exact: true })
  await expect.poll(async () => JSON.parse(await sourceText.inputValue())).toEqual(plan)
  await reopened.panel.locator('details.image-refinement-plan-source > summary').click()
  await expect(reopened.panel.locator('details.image-refinement-plan-source')).toContainText(parentAsset.sha256)
  const changedPlan = { ...plan, elements: plan.elements.map((element, index) => index === 1 ? { ...element, fill: '#bcae8f' } : element) }
  await sourceText.fill(JSON.stringify(changedPlan, null, 2))
  await reopened.panel.getByRole('button', { name: '生成结构重绘候选', exact: true }).click()
  await expect(reopened.panel.getByLabel('精修候选对照画布', { exact: true })).toBeVisible({ timeout: 90000 })
  await expect(reopened.panel.getByRole('alert')).toHaveCount(0)
  await reopened.panel.screenshot({ path: info.outputPath('chain-continued-structure.png') })
  await reopened.panel.getByRole('button', { name: '在场景中预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用图像候选', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '采用图像候选', exact: true }).click()
  await closeEditor(page, reopened.editor)
  await keyboardWorkspaceSaved(page)
  const continued = await keyboardProjectBackup(page, info.outputPath('chain-continued.sceneweave'))
  const continuedProp = continued.document.props[prop.id]
  if (continuedProp.appearance.kind !== 'image') throw new Error('继续编辑后物件缺少图片。')
  const continuedAsset = continued.document.assets[continuedProp.appearance.assetId]
  expect(continuedAsset.sha256).not.toBe(output.sha256)
  expect(continuedAsset.imageRefinement).toMatchObject({ kind: 'vector', algorithm: 'structure-plan-v1', sourceAssetId: parentAsset.id,
    originalAssetId: sourceAsset.id, sourceSha256: parentAsset.sha256, plan: changedPlan })
  expect(continued.document.assets[parentAsset.id]).toEqual(parentAsset)
  expect(continued.document.assets[sourceAsset.id]).toEqual(sourceAsset)
  for (const [path, hash] of Object.entries(keyboardResourceHashes(adopted.hashes))) if (path !== 'sources.json') expect(continued.hashes[path]).toBe(hash)
  expect(observations.modelRequests).toEqual([])
  expect(observations.errors).toEqual([])
})
