import { expect, test, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { chooseImageEditSize, decodeImageEditBase64, encodeImageEditBase64, imageEditCapabilities, imageEditInputHash, sha256Bytes, type ImageEditRequest } from '../src/shared/asset-refinement/model-protocol'
import { decodeCanonicalPng, encodeCanonicalPng } from '../src/shared/project/png-rgba'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, placeKeyboardLamp, selectKeyboardProp } from './keyboard-ux-helpers'

const serviceCors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const configuredModel = 'browser-configured-image-model'

async function mockConfiguredModelService(page: Page, onPost: (request: ImageEditRequest, route: Route) => Promise<void>) {
  await page.route('https://image-edit.example.test/v1/image-edit**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: serviceCors }); return }
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: serviceCors, body: JSON.stringify(imageEditCapabilities(configuredModel)) })
      return
    }
    expect(route.request().method()).toBe('POST')
    const request = route.request().postDataJSON() as ImageEditRequest
    expect(sha256Bytes(decodeImageEditBase64(request.pngBase64, 4 * 1024 * 1024))).toBe(request.sourceSha256)
    await onPost(request, route)
  })
}

async function configureModel(panel: Locator, prompt = '保留真实外轮廓，只调整已有纹理。') {
  await panel.getByRole('button', { name: '模型补画', exact: true }).click()
  await panel.getByLabel('补画应用服务地址', { exact: true }).fill('https://image-edit.example.test')
  await panel.getByLabel('补画应用访问凭据', { exact: true }).fill('browser-fixture-application-token')
  await panel.getByRole('button', { name: '检查补画服务', exact: true }).click()
  await expect(panel).toContainText('补画服务可用')
  await panel.getByLabel('模型补画要求', { exact: true }).fill(prompt)
  await expect(panel.getByLabel('同意本次图片上传与可能计费', { exact: true })).toBeEnabled()
}

function controlledModelResponse(request: ImageEditRequest, transparent = false) {
  const raster = decodeCanonicalPng(decodeImageEditBase64(request.pngBase64, 4 * 1024 * 1024))
  const requestedSize = chooseImageEditSize(raster.width, raster.height)
  if (transparent) raster.rgba.fill(0)
  else {
    const pixel = raster.rgba.findIndex((value, offset) => offset % 4 === 3 && value === 255)
    expect(pixel).toBeGreaterThanOrEqual(3)
    raster.rgba[pixel - 3] = raster.rgba[pixel - 3] === 255 ? 254 : raster.rgba[pixel - 3] + 1
  }
  const outputBytes = encodeCanonicalPng(raster), outputHash = sha256Bytes(outputBytes)
  return { schemaVersion: 1, sourceSha256: request.sourceSha256, inputHash: imageEditInputHash(request, configuredModel, requestedSize),
    outputHash, model: configuredModel, requestId: 'provider-controlled-response', requestedSize, pngBase64: encodeImageEditBase64(outputBytes) }
}

async function openRefinement(page: Page, info: TestInfo) {
  await createKeyboardProject(page, '素材精修浏览器旅程')
  await placeKeyboardLamp(page)
  const saved = await keyboardProjectBackup(page, info.outputPath('source.sceneweave'))
  const prop = Object.values(saved.document.props).find(value => value.definitionRef && saved.document.propDefinitions[value.definitionRef.id].name === '铜色桌灯')!
  if (!prop || prop.appearance.kind !== 'image') throw new Error('正常放置的铜色桌灯缺少图片。')
  await selectKeyboardProp(page, prop.id)
  const inspector = await openKeyboardPanel(page, 'inspector')
  await inspector.getByRole('button', { name: '编辑素材', exact: true }).click()
  const editor = page.getByTestId('scene-asset-editor')
  await editor.getByRole('button', { name: '图像处理', exact: true }).click()
  const panel = editor.getByRole('region', { name: '素材图像精修', exact: true })
  await expect(panel.getByLabel('精修原图对照画布', { exact: true })).toBeVisible()
  await panel.getByLabel('SVG重建方式', { exact: true }).selectOption('vector')
  await expect(panel.getByRole('button', { name: '生成矢量候选', exact: true })).toBeEnabled()
  return { editor, panel, saved, prop, sourceAsset: saved.document.assets[prop.appearance.assetId] }
}

async function closeEditor(page: Page, editor: Locator) {
  await editor.getByRole('button', { name: '关闭素材编辑', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: '关闭素材编辑确认', exact: true })
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: '丢弃本页草稿并关闭', exact: true }).click()
  await expect(editor).toHaveCount(0)
}

test('real vector candidate retains its SVG across routes and adopts through normal reversible scene review', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const modelRequests: string[] = []
  page.on('request', request => { if (/\/v1\/image-edit(?:\/|$)/.test(new URL(request.url()).pathname)) modelRequests.push(`${request.method()} ${request.url()}`) })
  const { editor, panel, saved, prop, sourceAsset } = await openRefinement(page, info)
  await expect(panel).toContainText('无需图片编辑模型、服务地址或访问凭据')
  await expect(panel.getByLabel('精修图像依据', { exact: true })).toHaveValue('original')
  await panel.getByLabel('矢量颜色数量', { exact: true }).fill('16')
  await panel.getByLabel('矢量曲线容差', { exact: true }).fill('0.45')
  await panel.getByRole('button', { name: '生成矢量候选', exact: true }).click()
  const candidate = panel.getByLabel('精修候选对照画布', { exact: true })
  await expect(candidate).toBeVisible({ timeout: 90000 })
  await expect(panel.getByRole('alert')).toHaveCount(0)
  const pixels = await candidate.evaluate(node => (node as HTMLCanvasElement).toDataURL())
  await panel.getByLabel('精修检查背景', { exact: true }).selectOption('black')
  await panel.getByLabel('精修对照缩放', { exact: true }).selectOption('200')
  await panel.getByRole('button', { name: '模型补画', exact: true }).click()
  await panel.getByLabel('模型补画要求', { exact: true }).fill('保留原有轮廓和透明孔洞，比较材质细节。')
  await expect(panel.getByRole('button', { name: '上传并生成一次补画候选', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: '矢量重建', exact: true }).click()
  expect(await candidate.evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(pixels)
  await expect(panel.getByLabel('矢量颜色数量', { exact: true })).toHaveValue('16')
  await expect(panel.getByLabel('精修检查背景', { exact: true })).toHaveValue('black')
  await expect(panel.getByLabel('精修对照缩放', { exact: true })).toHaveValue('200')
  await panel.locator('details.image-refinement-svg > summary').click()
  const svg = await panel.getByLabel('精修候选SVG源码', { exact: true }).inputValue()
  expect(svg).toContain('<svg')
  expect(svg).toContain('<path')
  expect(svg).not.toMatch(/<image\b|<script\b|<foreignObject\b/)
  const downloading = page.waitForEvent('download')
  await panel.getByRole('link', { name: '下载候选 SVG', exact: true }).click()
  const path = info.outputPath('candidate.svg')
  await (await downloading).saveAs(path)
  expect(await readFile(path, 'utf8')).toBe(svg)
  await panel.screenshot({ path: info.outputPath('vector-black-comparison.png') })
  await panel.getByRole('button', { name: '在场景中预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用图像候选', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '采用图像候选', exact: true }).click()
  // The editor keeps other route inputs until explicitly discarded on close.
  await closeEditor(page, editor)
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('vector-adopted.sceneweave'))
  const current = adopted.document.props[prop.id]
  if (current.appearance.kind !== 'image') throw new Error('采用后物件缺少图片。')
  const asset = adopted.document.assets[current.appearance.assetId]
  expect(asset.imageRefinement).toMatchObject({ version: 1, kind: 'vector', algorithm: 'regional-tones-v1', sourceAssetId: sourceAsset.id,
    originalAssetId: sourceAsset.id, sourceSha256: sourceAsset.sha256, options: { colors: 16, curveTolerancePx: .45 } })
  expect(adopted.document.assets[sourceAsset.id]).toEqual(sourceAsset)
  for (const key of ['positionMm', 'rotationDeg', 'visualBoundsMm', 'footprintMm', 'blocksMovement', 'blocksSight'] as const) expect(current[key]).toEqual(prop[key])
  expect(adopted.document.sceneId).toBe(saved.document.sceneId)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('vector-undone.sceneweave'))
  expect(undone.document.props[prop.id].appearance).toEqual(prop.appearance)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('vector-redone.sceneweave'))
  expect(redone.document.props[prop.id].appearance).toEqual(current.appearance)
  expect(modelRequests).toEqual([])
  expect(errors).toEqual([])
})

test('unconfigured model service checks capability without uploading pixels or creating a substitute candidate', async ({ page }, info) => {
  test.setTimeout(120000)
  const { editor, panel } = await openRefinement(page, info)
  const requests: Array<{ method: string; body: string | null }> = []
  await page.route('https://image-edit.example.test/v1/image-edit**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: serviceCors }); return }
    requests.push({ method: route.request().method(), body: route.request().postData() })
    if (route.request().method() !== 'GET') throw new Error('不可用服务不应收到图片生成请求。')
    await route.fulfill({ status: 200, contentType: 'application/json', headers: serviceCors, body: JSON.stringify(imageEditCapabilities()) })
  })
  await panel.getByRole('button', { name: '模型补画', exact: true }).click()
  await panel.getByLabel('模型补画要求', { exact: true }).fill('保留真实外轮廓和描边，检查已有木纹。')
  await panel.getByLabel('补画应用服务地址', { exact: true }).fill('https://image-edit.example.test')
  await panel.getByLabel('补画应用访问凭据', { exact: true }).fill('browser-fixture-application-token')
  await panel.getByRole('button', { name: '检查补画服务', exact: true }).click()
  await expect(panel).toContainText('此服务未配置可用的图片补画模型')
  await expect(panel.getByLabel('同意本次图片上传与可能计费', { exact: true })).toBeDisabled()
  await expect(panel.getByRole('button', { name: '上传并生成一次补画候选', exact: true })).toBeDisabled()
  await expect(panel.getByLabel('精修候选对照画布', { exact: true })).toHaveCount(0)
  expect(requests).toEqual([{ method: 'GET', body: null }])
  await panel.getByRole('button', { name: '矢量重建', exact: true }).click()
  await panel.getByRole('button', { name: '模型补画', exact: true }).click()
  await expect(panel.getByLabel('模型补画要求', { exact: true })).toHaveValue('保留真实外轮廓和描边，检查已有木纹。')
  await panel.getByRole('button', { name: '清除补画连接', exact: true }).click()
  await expect(panel.getByLabel('补画应用服务地址', { exact: true })).toHaveValue('')
  await expect(panel.getByLabel('补画应用访问凭据', { exact: true })).toHaveValue('')
  await closeEditor(page, editor)
  await keyboardWorkspaceSaved(page)
})

test('an unknown model response consumes one upload consent and is never automatically resubmitted', async ({ page }, info) => {
  test.setTimeout(120000)
  const { editor, panel } = await openRefinement(page, info)
  let posts = 0
  await page.route('https://image-edit.example.test/v1/image-edit**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: serviceCors }); return }
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: serviceCors, body: JSON.stringify(imageEditCapabilities('browser-configured-image-model')) })
      return
    }
    posts++
    const body = route.request().postDataJSON() as { pngBase64: string; prompt: string }
    expect(body.pngBase64).toMatch(/^iVBOR/)
    expect(body.prompt).toBe('保留真实外轮廓，只调整已有纹理。')
    await route.abort('connectionreset')
  })
  await panel.getByRole('button', { name: '模型补画', exact: true }).click()
  await panel.getByLabel('补画应用服务地址', { exact: true }).fill('https://image-edit.example.test')
  await panel.getByLabel('补画应用访问凭据', { exact: true }).fill('browser-fixture-application-token')
  await panel.getByRole('button', { name: '检查补画服务', exact: true }).click()
  await expect(panel).toContainText('补画服务可用')
  await panel.getByLabel('模型补画要求', { exact: true }).fill('保留真实外轮廓，只调整已有纹理。')
  const consent = panel.getByLabel('同意本次图片上传与可能计费', { exact: true })
  const generate = panel.getByRole('button', { name: '上传并生成一次补画候选', exact: true })
  await expect(generate).toBeDisabled()
  await consent.check()
  await generate.click()
  await expect(panel.getByRole('alert')).toContainText('补画结果未知')
  await expect(panel.locator('[aria-label="结果未确认的补画请求"]')).toContainText('https://image-edit.example.test')
  await expect(consent).not.toBeChecked()
  await expect(generate).toBeDisabled()
  await expect(panel.getByLabel('精修候选对照画布', { exact: true })).toHaveCount(0)
  expect(posts).toBe(1)
  await panel.getByRole('button', { name: '矢量重建', exact: true }).click()
  await panel.getByRole('button', { name: '模型补画', exact: true }).click()
  await expect(generate).toBeDisabled()
  expect(posts).toBe(1)
  await closeEditor(page, editor)
  await keyboardWorkspaceSaved(page)
})

test('a real target edit prevents adoption of an older vector result until the baseline is explicitly reread', async ({ page }, info) => {
  test.setTimeout(180000)
  const { editor, panel, prop } = await openRefinement(page, info)
  await panel.getByRole('button', { name: '生成矢量候选', exact: true }).click()
  await expect(panel.getByLabel('精修候选对照画布', { exact: true })).toBeVisible({ timeout: 90000 })
  await editor.getByRole('button', { name: '属性与占地', exact: true }).click()
  await editor.getByLabel('物件 X', { exact: true }).fill(String((prop.positionMm.x + 100) / 1000))
  await editor.getByLabel('物件 X', { exact: true }).press('Enter')
  await editor.getByRole('button', { name: '图像处理', exact: true }).click()
  await expect(panel).toContainText('此素材已修改，旧候选仅供对照')
  await expect(panel.getByRole('button', { name: '在场景中预览', exact: true })).toBeDisabled()
  await expect(panel.getByRole('button', { name: '生成矢量候选', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: '重新读取精修基线', exact: true }).click()
  const confirmation = panel.getByRole('alertdialog', { name: '重新读取精修基线确认', exact: true })
  await confirmation.getByRole('button', { name: '保留当前候选', exact: true }).click()
  await expect(panel.getByLabel('精修候选对照画布', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '重新读取精修基线', exact: true }).click()
  await confirmation.getByRole('button', { name: '丢弃候选并重新读取', exact: true }).click()
  await expect(panel.getByRole('button', { name: '生成矢量候选', exact: true })).toBeEnabled()
  await expect(panel.getByLabel('精修候选对照画布', { exact: true })).toHaveCount(0)
  await closeEditor(page, editor)
  await keyboardWorkspaceSaved(page)
})

test('a controlled model result keeps provenance through scene adoption, undo, redo and a cold reopen without another POST', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { editor, panel, saved, prop, sourceAsset } = await openRefinement(page, info)
  const requests: ImageEditRequest[] = [], responses: ReturnType<typeof controlledModelResponse>[] = []
  await mockConfiguredModelService(page, async (request, route) => {
    requests.push(request)
    const response = controlledModelResponse(request)
    responses.push(response)
    await route.fulfill({ status: 200, contentType: 'application/json', headers: serviceCors, body: JSON.stringify(response) })
  })
  const prompt = '保留真实外轮廓，只调整已有纹理。'
  await configureModel(panel, prompt)
  await panel.getByLabel('同意本次图片上传与可能计费', { exact: true }).check()
  await panel.getByRole('button', { name: '上传并生成一次补画候选', exact: true }).click()
  await expect(panel.getByLabel('精修候选对照画布', { exact: true })).toBeVisible({ timeout: 60000 })
  await expect(panel.getByRole('alert')).toHaveCount(0)
  expect(requests).toHaveLength(1)
  expect(responses).toHaveLength(1)
  const request = requests[0], response = responses[0]
  expect(request.prompt).toBe(prompt)
  await expect(panel.locator('[aria-label="已完成的补画请求"] code')).toHaveText(request.clientRequestId)
  await expect(panel.locator('[aria-label="结果未确认的补画请求"] code')).toHaveCount(0)
  await expect(panel.getByLabel('同意本次图片上传与可能计费', { exact: true })).not.toBeChecked()
  await panel.screenshot({ path: info.outputPath('model-controlled-comparison.png') })
  await panel.getByRole('button', { name: '在场景中预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用图像候选', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '采用图像候选', exact: true }).click()
  await closeEditor(page, editor)
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('model-adopted.sceneweave'))
  const current = adopted.document.props[prop.id]
  if (current.appearance.kind !== 'image') throw new Error('模型候选采用后缺少图片。')
  const asset = adopted.document.assets[current.appearance.assetId]
  expect(asset.sha256).toBe(response.outputHash)
  expect(asset.imageRefinement).toMatchObject({ version: 1, kind: 'model', sourceAssetId: sourceAsset.id,
    originalAssetId: sourceAsset.id, sourceSha256: sourceAsset.sha256, outputSha256: response.outputHash,
    inputSha256: request.sourceSha256, model: configuredModel, requestId: response.requestId, clientRequestId: request.clientRequestId, prompt })
  expect(adopted.document.assets[sourceAsset.id]).toEqual(sourceAsset)
  expect(asset.logicalSizeMm).toEqual(sourceAsset.logicalSizeMm)
  expect(asset.origin).toEqual(sourceAsset.origin)
  expect(asset.licenseRef).toBe(sourceAsset.licenseRef)
  for (const key of ['positionMm', 'rotationDeg', 'visualBoundsMm', 'footprintMm', 'blocksMovement', 'blocksSight'] as const) expect(current[key]).toEqual(prop[key])
  expect(adopted.document.sceneId).toBe(saved.document.sceneId)
  for (const [path, hash] of Object.entries(keyboardResourceHashes(saved.hashes))) if (path !== 'sources.json') expect(adopted.hashes[path]).toBe(hash)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('model-undone.sceneweave'))
  expect(undone.document.props[prop.id].appearance).toEqual(prop.appearance)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('model-redone.sceneweave'))
  expect(redone.document.props[prop.id].appearance).toEqual(current.appearance)
  expect(redone.document.assets[asset.id]).toEqual(asset)
  expect(requests).toHaveLength(1)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${adopted.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('model-cold.sceneweave'))
  expect(cold.document.props[prop.id].appearance).toEqual(current.appearance)
  expect(cold.document.assets[asset.id]).toEqual(asset)
  expect(cold.document.assets[sourceAsset.id]).toEqual(sourceAsset)
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(adopted.hashes))
  expect(requests).toHaveLength(1)
  expect(errors).toEqual([])
})

test('a valid but transparent model PNG is rejected while its finished request survives clearing every draft and closing', async ({ page }, info) => {
  test.setTimeout(120000)
  const { editor, panel } = await openRefinement(page, info)
  const requests: ImageEditRequest[] = []
  await mockConfiguredModelService(page, async (request, route) => {
    requests.push(request)
    await route.fulfill({ status: 200, contentType: 'application/json', headers: serviceCors,
      body: JSON.stringify(controlledModelResponse(request, true)) })
  })
  await configureModel(panel)
  await panel.getByLabel('同意本次图片上传与可能计费', { exact: true }).check()
  await panel.getByRole('button', { name: '上传并生成一次补画候选', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('没有可见像素')
  expect(requests).toHaveLength(1)
  const requestId = requests[0].clientRequestId
  await expect(panel.locator('[aria-label="已完成的补画请求"] code')).toHaveText(requestId)
  await expect(panel.locator('[aria-label="结果未确认的补画请求"] code')).toHaveCount(0)
  await expect(panel.getByLabel('精修候选对照画布', { exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: '丢弃全部精修草稿', exact: true }).click()
  await expect(panel.getByRole('button', { name: '丢弃全部精修草稿', exact: true })).toHaveCount(0)
  await expect(panel.locator('[aria-label="已完成的补画请求"] code')).toHaveText(requestId)
  await expect(panel.getByLabel('模型补画要求', { exact: true })).toHaveValue('')
  await expect(panel.getByLabel('精修候选对照画布', { exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: '关闭素材编辑', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: '关闭素材编辑确认', exact: true })
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText('服务已返回')
  await expect(confirmation.locator('code')).toHaveText(requestId)
  expect(requests).toHaveLength(1)
  await confirmation.getByRole('button', { name: '丢弃本页草稿并关闭', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
})

test('an in-flight POST exposes its request ID before a response and retains it after cancel, route changes and draft clearing', async ({ page }, info) => {
  test.setTimeout(120000)
  const { editor, panel } = await openRefinement(page, info)
  const requests: ImageEditRequest[] = []
  let releasePost = () => {}, finishPost = () => {}
  const responseGate = new Promise<void>(resolve => { releasePost = resolve })
  const responseDone = new Promise<void>(resolve => { finishPost = resolve })
  await mockConfiguredModelService(page, async (request, route) => {
    requests.push(request)
    await responseGate
    try { await route.abort('connectionreset') } finally { finishPost() }
  })
  try {
    await configureModel(panel)
    await panel.getByLabel('同意本次图片上传与可能计费', { exact: true }).check()
    await panel.getByRole('button', { name: '上传并生成一次补画候选', exact: true }).click()
    await expect.poll(() => requests.length).toBe(1)
    const requestId = requests[0].clientRequestId
    const unknown = panel.locator('[aria-label="结果未确认的补画请求"] code')
    await expect(unknown).toHaveText(requestId)
    await expect(panel.getByRole('button', { name: '取消精修处理', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '取消精修处理', exact: true }).click()
    await expect(panel.getByRole('button', { name: '取消精修处理', exact: true })).toHaveCount(0)
    await expect(unknown).toHaveText(requestId)
    await expect(panel).toContainText('服务可能仍在处理或计费')
    await expect(panel.getByLabel('精修候选对照画布', { exact: true })).toHaveCount(0)
    await panel.getByRole('button', { name: '矢量重建', exact: true }).click()
    await panel.getByRole('button', { name: '模型补画', exact: true }).click()
    await expect(unknown).toHaveText(requestId)
    await panel.getByRole('button', { name: '丢弃全部精修草稿', exact: true }).click()
    await expect(unknown).toHaveText(requestId)
    await expect(panel.getByRole('button', { name: '丢弃全部精修草稿', exact: true })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: '上传并生成一次补画候选', exact: true })).toBeDisabled()
    await expect(panel.getByLabel('同意本次图片上传与可能计费', { exact: true })).not.toBeChecked()
    expect(requests).toHaveLength(1)
    await editor.getByRole('button', { name: '关闭素材编辑', exact: true }).click()
    const confirmation = page.getByRole('alertdialog', { name: '关闭素材编辑确认', exact: true })
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('结果未确认')
    await expect(confirmation.locator('code')).toHaveText(requestId)
    await confirmation.getByRole('button', { name: '丢弃本页草稿并关闭', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect(requests).toHaveLength(1)
  } finally {
    releasePost()
    if (requests.length) await responseDone
  }
  await keyboardWorkspaceSaved(page)
  expect(requests).toHaveLength(1)
})
