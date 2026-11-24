import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openGenerationTask, openOutdoorTask, openSamples, openTerrainTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

const deferredTools = /^(CatalogLibrary|HistoryPanel|VisualPanel|ArtStylePanel|OutdoorToolsPanel|OutdoorInspector|InteriorGenerationPanel|ForestGenerationPanel|MixedGenerationPanel|TerrainGenerationPanel|TerrainCompositionPanel|RegionalPanel)-/
const deferredActions = /^(AuthoringGuide|atomic|authoring|forest-loop|island-dressing|bridge-template-revisions|generation-local|terrain-local|base-map-client|regional)-[\w-]{8}\.js$/

async function startupScripts(page: Page, since = 0) {
  return page.evaluate(start => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
    .filter(entry => entry.startTime >= start && new URL(entry.name).pathname.endsWith('.js'))
    .map(entry => ({ name: new URL(entry.name).pathname.split('/').at(-1)!, bytes: entry.decodedBodySize })), since)
}

async function skipDevelopmentPage(page: Page) {
  const entry = await page.locator('script[type="module"][src]:not([src$="/@vite/client"])').first().getAttribute('src')
  test.skip(entry?.endsWith('/src/main.tsx') === true, 'Run this check against the production build')
}

async function openProductionPage(page: Page, route: 'tutorial' | 'home') {
  await page.goto(`./#${route}`)
  await skipDevelopmentPage(page)
}

async function holdScript(page: Page, pattern: string) {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(pattern, async route => {
    await gate
    await route.continue()
  })
  return release
}

async function expectCenteredLogo(page: Page, label: string, animated: boolean) {
  const mark = page.getByRole('status').filter({ hasText: label }).locator('.sceneweave-loading-mark')
  const logo = mark.locator('img')
  await expect(mark).toBeVisible()
  await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(logo).toHaveCSS('animation-name', animated ? 'sceneweave-loading-pulse' : 'none')
  expect(await mark.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return [Math.abs(x + width / 2 - innerWidth / 2), Math.abs(y + height / 2 - innerHeight / 2)]
  })).toEqual([0, 0])
}

test('the native logo is centered during bootstrap and page loading and follows reduced motion', async ({ page }) => {
  const [releaseEntry, releaseTutorial, releaseForm, releaseWorkbench] = await Promise.all(
    ['index', 'TutorialPage', 'StartupSceneDialog', 'Workbench'].map(name => holdScript(page, `**/assets/${name}-*.js`)),
  )
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('./#tutorial', { waitUntil: 'commit' })
    await skipDevelopmentPage(page)

    await expectCenteredLogo(page, '正在打开织境…', true)
    releaseEntry()
    await expectCenteredLogo(page, '正在打开使用教程…', true)
    releaseTutorial()
    await expect(page.getByRole('heading', { level: 1, name: '从零制作林边驿站' })).toBeVisible()
    await expect(page.locator('.sceneweave-loading')).toHaveCount(0)

    await page.getByRole('link', { name: '织境首页', exact: true }).click()
    const newScene = page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true })
    await newScene.click()
    await expectCenteredLogo(page, '正在打开新建场景表单…', true)
    releaseForm()
    const dialog = page.getByRole('dialog', { name: '新建空白场景' })
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(newScene).toBeFocused()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => { window.location.hash = '#workspace' })
    await expectCenteredLogo(page, '正在打开统一工作区…', false)
    releaseWorkbench()
    await expect(page.getByRole('heading', { level: 1, name: '织境场景' })).toBeVisible()
    await expect(page.locator('.sceneweave-loading')).toHaveCount(0)
  } finally {
    releaseEntry()
    releaseTutorial()
    releaseForm()
    releaseWorkbench()
  }
})

test('production tutorial and blank workspace stay within their first-load script budgets', async ({ page }) => {
  await openProductionPage(page, 'tutorial')
  await expect(page.getByRole('heading', { level: 1, name: '从零制作林边驿站' })).toBeVisible()
  const tutorial = await startupScripts(page)
  expect(tutorial).not.toHaveLength(0)
  expect(tutorial.reduce((bytes, script) => bytes + script.bytes, 0)).toBeLessThan(380 * 1024)
  expect(tutorial.filter(script => /^(Workbench|WorkspaceHome|repository|resources|development-import)-/.test(script.name))).toEqual([])

  await page.goto('./#home')
  await expect(page.getByTestId('workspace-home').getByText('共 0 个工程', { exact: false })).toBeVisible()
  const since = await page.evaluate(() => performance.now())
  await page.evaluate(() => { window.location.hash = '#workspace' })
  await expect(page.getByRole('heading', { level: 1, name: '织境场景' })).toBeVisible()
  const workspace = await startupScripts(page, since)
  expect(workspace).not.toHaveLength(0)
  expect(workspace.reduce((bytes, script) => bytes + script.bytes, 0)).toBeLessThan(3 * 1024 * 1024)
  const deferred = /^(scenes-data|builtin-data|scene-collection|ImageImportTool|AiConversationPanel|ThemePacksPanel|WorkspaceSampleTools|canvas-renderer|generation)-/
  expect(workspace.filter(script => deferred.test(script.name) || deferredTools.test(script.name) || deferredActions.test(script.name))).toEqual([])
})

test('only visible homepage artwork downloads until the user visits the samples', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  const artwork: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path.includes('/assets/home-scenes/')) artwork.push(path.split('/').at(-1)!)
  })
  await openProductionPage(page, 'home')
  const home = page.getByTestId('workspace-home')
  const hero = home.locator('.home-featured-views img')
  await expect.poll(() => hero.evaluateAll(images => images.length === 2 && images.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true)
  const visibleFiles = await home.locator('img[src*="/assets/home-scenes/"]').evaluateAll(images => images.flatMap(img => {
    const box = img.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0 || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) return []
    return [new URL((img as HTMLImageElement).src).pathname.split('/').at(-1)!]
  }))
  expect([...new Set(artwork)].sort()).toEqual([...new Set(visibleFiles)].sort())
  const sample = home.locator('article[data-sample="volcano"] img').first()
  await expect(sample).not.toHaveAttribute('src', /.+/)
  await sample.scrollIntoViewIfNeeded()
  await expect.poll(() => sample.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(artwork).toContain('volcano-stage1.png')
})

test('homepage creation opens before the editor finishes downloading and saves the exact starter assets', async ({ page }, info) => {
  await openProductionPage(page, 'home')
  await page.setViewportSize({ width: 390, height: 844 })
  const releaseRenderer = await holdScript(page, '**/canvas-renderer-*.js')
  let releaseEditor!: () => void
  const editorGate = new Promise<void>(resolve => { releaseEditor = resolve })
  let editorRequested = false
  await page.route('**/Workbench-*.js', async route => {
    editorRequested = true
    await editorGate
    await route.continue()
  })
  const assets: string[] = []
  const archives: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (/\/assets\/sceneweave-handdrawn[^/]*\/.*\.png$/.test(path)) assets.push(path)
    if (/\/blank-scene-.*\.zip$/.test(path)) archives.push(path)
  })

  try {
    const packedAssets = page.waitForResponse(response => /\/blank-scene-.*\.zip$/.test(response.url()) && response.ok())
    await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建空白场景' })
    const title = '弱网下填写空白场景'
    await dialog.getByLabel('场景名称', { exact: true }).fill(title)
    await expect.poll(() => editorRequested).toBe(true)
    const archive = await packedAssets
    await expect(page.getByTestId('workspace-home').getByText('共 0 个工程', { exact: false })).toBeVisible()
    await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: '正在准备素材…' }).locator('.sceneweave-loading-mark')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeEnabled()
    releaseEditor()
    await expect(page.getByRole('status').filter({ hasText: '正在解码素材并绘制场景…' }).locator('.sceneweave-loading-mark')).toBeVisible()
    releaseRenderer()

    await keyboardWorkspaceSaved(page)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    const backup = await keyboardProjectBackup(page, info.outputPath('starter.sceneweave'))
    const blankContent = JSON.parse(await readFile(new URL('../src/platform/browser/content/scenes-data.json', import.meta.url), 'utf8'))
    const core = ['b2-m-02', 'm1d-m-01'], template = blankContent.scenes.blank.document
    const hashes = core.map(id => template.assets[template.materials[id].textureAssetId].sha256 as string)
    const expected = Object.fromEntries(hashes.map(hash => [`assets/${hash}.png`, hash]))
    expect(Object.fromEntries(Object.entries(backup.hashes).filter(([path]) => path.startsWith('assets/')))).toEqual(expected)
    expect(Object.keys(backup.document.materials).sort()).toEqual(core)
    expect(backup.document.presetSnapshot.starterPalette).toBe('standard-v1')
    expect((await archive.body()).byteLength).toBeLessThan(80_000)
    expect(archives).toHaveLength(1)
    expect(assets).toEqual([])
  } finally {
    releaseEditor()
    releaseRenderer()
  }
})

test('terrain and furniture fetch their selected resources and save them with the edit', async ({ page }, info) => {
  test.setTimeout(90_000)
  await openProductionPage(page, 'home')
  const metadata = JSON.parse(await readFile(new URL('../src/platform/browser/content/scenes-data.json', import.meta.url), 'utf8'))
  const template = metadata.scenes.blank.document
  const grass = template.assets[template.materials['b3-m-01'].textureAssetId].sha256
  const lamp = template.assets[template.propDefinitions['b2-p-10'].defaultAppearance.assetId].sha256
  const paths: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (/\/assets\/sceneweave-handdrawn[^/]*\/[^/]+\.png$/.test(path)) paths.push(path)
  })
  await createKeyboardProject(page, '按工具读取实际素材')
  const shell = page.getByTestId('outdoor-workbench'), revision = await shell.getAttribute('data-revision')
  const terrain = await openOutdoorTask(page)
  await openDetailsBySummary(terrain, /^精确坐标 · 区域轮廓$/)
  await terrain.getByLabel('室外坐标', { exact: true }).fill('1000,1000\n5000,1000\n5000,5000\n1000,5000')
  await terrain.getByLabel('地形材质', { exact: true }).selectOption({ label: '簇生草地' })
  expect(paths).toEqual([])
  const preview = terrain.getByRole('button', { name: '预览室外修改', exact: true })
  const grassUrl = '**/' + metadata.paths[grass]
  await page.route(grassUrl, async route => {
    const response = await route.fetch()
    const damaged = Buffer.from(await response.body())
    damaged[damaged.length - 1] ^= 1
    await route.fulfill({ response, body: damaged })
  })
  await preview.click()
  await expect(page.getByRole('alert').filter({ hasText: '图片摘要不一致' })).toBeVisible()
  await expect(shell).toHaveAttribute('data-revision', revision!)
  await page.unroute(grassUrl)
  await preview.click()
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect(paths).toHaveLength(2)
  expect(paths.every(path => path.endsWith(metadata.paths[grass]))).toBe(true)
  const withTerrain = await keyboardProjectBackup(page, info.outputPath('terrain.sceneweave'))
  expect(withTerrain.hashes['assets/' + grass + '.png']).toBe(grass)
  expect(Object.keys(withTerrain.document.assets)).toHaveLength(3)

  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  const place = library.getByRole('button', { name: '放置组件 铜色桌灯', exact: true })
  await place.click()
  const drop = page.getByRole('button', { name: '在此放置', exact: true })
  await expect(drop).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(drop).toHaveCount(0)
  await expect(shell).toHaveAttribute('data-revision', String(withTerrain.document.revision))
  await place.click()
  await drop.click()
  await keyboardWorkspaceSaved(page)
  const withLamp = await keyboardProjectBackup(page, info.outputPath('room-and-lamp.sceneweave'))
  expect(withLamp.hashes['assets/' + lamp + '.png']).toBe(lamp)
  expect(Object.keys(withLamp.document.assets)).toHaveLength(4)
  expect(Object.values(withLamp.document.props).some(prop => prop.definitionRef?.id === 'b2-p-10')).toBe(true)
  expect(paths.filter(path => path.endsWith(metadata.paths[lamp]))).toHaveLength(1)

  // A fresh JS instance cannot reuse the catalog's in-memory image cache.
  const reopened = await page.context().newPage(), requested: string[] = []
  await reopened.route('**/assets/sceneweave-handdrawn*/**.png', route => {
    requested.push(route.request().url()); return route.abort('internetdisconnected')
  })
  await reopened.goto('./#home')
  await reopened.locator('.home-project-row').filter({ hasText: withLamp.document.title }).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(reopened)
  await expect(reopened.getByRole('button', { name: '选择地图对象', exact: true })).toBeEnabled()
  await expect(reopened.getByRole('group', { name: '地图视口', exact: true })).toHaveAttribute('data-render-count', /^[1-9]/)
  const saved = await keyboardProjectBackup(reopened, info.outputPath('reopened.sceneweave'))
  expect(saved.document).toEqual(withLamp.document)
  expect(keyboardResourceHashes(saved.hashes)).toEqual(keyboardResourceHashes(withLamp.hashes))
  expect(requested).toEqual([])
})

test('searching the built-in catalog reads the two compared images on demand', async ({ page }) => {
  await openProductionPage(page, 'home')
  await createKeyboardProject(page, '按需比较内置素材')
  const panel = await openWorkspaceModule(page, '素材')
  const library = panel.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('阔叶树冠·精修')
  await expect(library.locator('.catalog-entries article')).toHaveCount(0)
  const paths: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (/\/assets\/sceneweave-handdrawn[^/]*\/[^/]+\.png$/.test(path)) paths.push(path)
  })
  await library.getByLabel('素材来源', { exact: true }).selectOption('builtin')
  await library.getByRole('button', { name: '查看素材 阔叶树冠·精修', exact: true }).click()
  const comparison = page.getByRole('group', { name: '精修素材与旧版对照', exact: true })
  await expect.poll(() => comparison.locator('img').evaluateAll(images =>
    images.length === 2 && images.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true)
  const fixed = JSON.parse(await readFile(new URL('../src/platform/browser/content/builtin-data.json', import.meta.url), 'utf8'))
  const scene = fixed.project.document
  const expected = Object.values(scene.propDefinitions as Record<string, { name: string; defaultAppearance: { assetId: string } }>)
    .filter(def => ['阔叶树冠', '阔叶树冠·精修'].includes(def.name))
    .map(def => fixed.paths[scene.assets[def.defaultAppearance.assetId].sha256] as string).sort()
  expect(paths.map(path => path.slice(path.indexOf('assets/'))).sort()).toEqual(expected)
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-revision', '0')
})

test('composing a new woodland loads the selected tree and adopts it together with its scatter group', async ({ page }, info) => {
  await openProductionPage(page, 'home')
  await createKeyboardProject(page, '选择一种树生成群落', { widthMeters: 24, heightMeters: 18 })
  const template = JSON.parse(await readFile(new URL('../src/platform/browser/content/scenes-data.json', import.meta.url), 'utf8'))
  const scene = template.scenes.blank.document
  const tree = Object.values(scene.propDefinitions as Record<string, { id: string; name: string; defaultAppearance: { assetId: string } }>).find(item => item.name === '阔叶树冠')!
  const hash = scene.assets[tree.defaultAppearance.assetId].sha256
  const paths: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (/\/assets\/sceneweave-handdrawn[^/]*\/[^/]+\.png$/.test(path)) paths.push(path)
  })
  await openTerrainTask(page, '布置植被')
  await openDetailsBySummary(page.getByTestId('workspace-resources'), /^植被群落编排/)
  const form = page.getByRole('region', { name: '植被群落编排', exact: true })
  await form.getByLabel('群落适植地形', { exact: true }).selectOption({ index: 1 })
  await form.getByLabel('主树群素材', { exact: true }).selectOption(tree.id)
  expect(paths).toEqual([])
  await form.getByRole('button', { name: '预览植被群落编排', exact: true }).click()
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const result = await keyboardProjectBackup(page, info.outputPath('woodland.sceneweave'))
  expect(paths.map(path => path.slice(path.indexOf('assets/')))).toEqual([template.paths[hash]])
  expect(result.hashes['assets/' + hash + '.png']).toBe(hash)
  expect(Object.keys(result.document.scatterGroups)).toHaveLength(1)
  expect(Object.values(result.document.props).some(prop => prop.definitionRef?.id === tree.id)).toBe(true)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('woodland-undone.sceneweave'))
  expect(Object.keys(undone.document.scatterGroups)).toHaveLength(0)
  expect(Object.keys(undone.document.assets)).toHaveLength(2)
})

test('the first canvas can be edited and optional tools download on their first use', async ({ page }) => {
  await openProductionPage(page, 'home')
  const optional: string[] = []
  page.on('request', request => {
    const name = new URL(request.url()).pathname.split('/').at(-1)!
    if (name.endsWith('.js') && deferredTools.test(name)) optional.push(name)
  })
  await createKeyboardProject(page, '首帧可编辑', { widthMeters: 24, heightMeters: 18 })
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  await expect(canvas).toBeVisible()
  await expect(viewport).toHaveAttribute('data-render-count', /^[1-9]/)
  await expect(page.getByRole('button', { name: '选择地图对象', exact: true })).toBeEnabled()
  expect(optional).toEqual([])

  await page.getByRole('button', { name: '工具：画房间', exact: true }).click()
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width * .1, box.y + box.height * .15)
  await page.mouse.click(box.x + box.width * .35, box.y + box.height * .4)
  await page.getByRole('button', { name: '完成房间', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await page.getByRole('button', { name: '材质与铺装', exact: true }).click()
  await expect(page.getByRole('region', { name: '外观与氛围参数' })).toBeVisible()
  expect(optional).toEqual([expect.stringMatching(/^VisualPanel-/)])
  await page.getByRole('button', { name: '返回所选对象', exact: true }).click()

  await page.getByRole('button', { name: '按用途布置房间', exact: true }).click()
  const target = page.getByLabel('用途布置目标房间', { exact: true })
  await expect(target).toHaveValue(/.+/)
  await expect(target).toBeFocused()
  expect(optional).toContainEqual(expect.stringMatching(/^CatalogLibrary-/))
  await page.getByRole('button', { name: '摆放单件', exact: true }).click()
  await expect(page.getByLabel('搜索组件素材', { exact: true })).toBeFocused()

  const history = await openWorkspaceModule(page, '历史')
  await expect(history.getByRole('region', { name: '命名历史', exact: true })).toBeVisible()
  const terrain = await openWorkspaceModule(page, '地形')
  await expect(terrain.getByRole('group', { name: '室外任务', exact: true })).toBeVisible()
  await openGenerationTask(page, '室内布局')
  const form = page.getByRole('dialog', { name: '室内布局', exact: true })
  await expect(form.getByRole('region', { name: '室内布局生成' })).toBeVisible()
  await form.getByLabel('房间1用途').fill('保留生成草稿')
  await form.getByRole('button', { name: '关闭生成设置' }).click()
  await openGenerationTask(page, '室内布局')
  await expect(form.getByLabel('房间1用途')).toHaveValue('保留生成草稿')
  await form.getByRole('button', { name: '关闭生成设置' }).click()
  expect(optional).toEqual(expect.arrayContaining([
    expect.stringMatching(/^HistoryPanel-/), expect.stringMatching(/^OutdoorToolsPanel-/), expect.stringMatching(/^InteriorGenerationPanel-/),
  ]))
  expect(optional.some(name => /^(ForestGenerationPanel|MixedGenerationPanel|TerrainGenerationPanel)-/.test(name))).toBe(false)
})

test('a damaged starter download keeps the form draft and leaves the project directory empty', async ({ page }) => {
  await openProductionPage(page, 'home')
  const home = page.getByTestId('workspace-home')
  const trigger = home.getByRole('button', { name: '新建场景', exact: true })
  await page.route('**/blank-scene-*.zip', route => route.fulfill({ body: Buffer.from('damaged') }))
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景' })
  const name = dialog.getByLabel('场景名称', { exact: true })
  await name.fill('保留未提交的名称')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('空白场景素材包不完整或摘要不一致')
  await expect(name).toHaveValue('保留未提交的名称')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(home.getByText('共 0 个工程', { exact: false })).toBeVisible()
})

test('a failed image tool download keeps the active project and navigation available', async ({ page }) => {
  await openProductionPage(page, 'home')
  const title = '分包加载失败后仍可编辑'
  await createKeyboardProject(page, title)
  await page.route('**/ImageImportTool-*.js', route => route.abort('failed'))
  const resources = await openWorkspaceModule(page, '场景')
  await resources.getByRole('button', { name: '从图片新建场景', exact: true }).click()
  await expect(resources.getByText('图片导入工作台加载失败。', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(page.getByRole('region', { name: '当前编辑会话' })).toContainText(title)
})

test('deferred panels and sample assets load from their normal workspace entries', async ({ page }) => {
  await openProductionPage(page, 'home')
  const title = '按需加载工作区功能'
  await createKeyboardProject(page, title)

  const ai = await openWorkspaceModule(page, 'AI')
  await expect(ai.getByRole('region', { name: 'AI 对话面板' })).toBeVisible()
  const library = await openWorkspaceModule(page, '素材与布景')
  await expect(library.getByText('主题素材包 · 场景与画风', { exact: true })).toBeVisible()

  await openSamples(page)
  const sampleName = '潮影航路 · 海洋成图'
  await page.getByRole('button', { name: sampleName, exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '确认打开工程' })
  await expect(confirmation).toContainText(sampleName, { timeout: 30_000 })
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
})
