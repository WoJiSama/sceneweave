import { expect, test, type Page } from '@playwright/test'
import type { Workspace } from '../src/application/workspace/workspace.js'
import type { EditableProject } from '../src/application/workspace/project.js'
import { compositionPreset } from '../src/shared/terrain-generation/composition-presets.js'
import { planTerrainComposition } from '../src/shared/terrain-generation/composition-field.js'
import { canonicalJson } from '../src/shared/validation/json.js'
import { sha256Text } from '../src/shared/validation/hash.js'

type Dev = { workspace: Workspace; repository: { load: (sceneId: string) => Promise<EditableProject | null>; list: () => Promise<unknown[]> } }
const families = ['archipelago', 'forestValley', 'grassRidge'] as const
const seeds = ['terrain-compose-0', 'terrain-compose-1', 'terrain-compose-2'] as const
const blockedRequests = new WeakMap<Page, string[]>()

async function state(page: Page) {
  return page.evaluate(async () => {
    const projectPath = '/src/application/workspace/project.ts', hashPath = '/src/shared/project/validate.ts'
    const { toBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { projectContentHash } = await import(hashPath) as typeof import('../src/shared/project/validate')
    const { workspace, repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    const project = workspace.getState().project
    if (!project) throw new Error('Expected current complete project')
    const cold = await repository.load(project.document.sceneId)
    return { sceneId: project.document.sceneId, schemaVersion: project.schemaVersion, checkpoint: workspace.checkpoint(),
      revision: project.document.revision, hash: projectContentHash(toBundle(project).project),
      coldHash: cold ? projectContentHash(toBundle(cold).project) : null, count: (await repository.list()).length,
      generationVersion: project.document.generation?.version, boundsMm: project.document.exportBoundsMm }
  })
}
async function settled(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 120_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 120_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 })
}

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin, blocked: string[] = []
  blockedRequests.set(page, blocked)
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url())
    if ((url.origin === origin && !/^\/api(?:\/|$)/.test(url.pathname)) || ['blob:', 'data:'].includes(url.protocol)) return route.continue()
    blocked.push(url.href); return route.abort()
  })
})
test.afterEach(async ({ page }) => { expect(blockedRequests.get(page) ?? []).toEqual([]) })

test('T9 three families by three seeds have identical complete Node and real Worker plans', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = [], workers: string[] = []
  page.on('pageerror', error => errors.push(error.message)); page.on('worker', worker => workers.push(worker.url()))
  const requests = families.flatMap(preset => seeds.map(seed => ({ sceneId: `t9-parity-${preset}-${seed}`, preset, seed,
    widthMm: 48000, heightMm: 36000, islandCount: 3 })))
  const expected = requests.map(request => {
    const plan = planTerrainComposition(compositionPreset(request).input)
    return { request, hash: sha256Text(canonicalJson(plan)), geometryBudget: plan.geometryBudget }
  })
  await page.goto('/')
  const actual = await page.evaluate(async requests => {
    const presetPath = '/src/shared/terrain-generation/composition-presets.ts', clientPath = '/src/platform/browser/terrain-generation/composition-client.ts'
    const jsonPath = '/src/shared/validation/json.ts', hashPath = '/src/shared/validation/hash.ts'
    const { compositionPreset } = await import(presetPath) as typeof import('../src/shared/terrain-generation/composition-presets')
    const { computeTerrainComposition } = await import(clientPath) as typeof import('../src/platform/browser/terrain-generation/composition-client')
    const { canonicalJson } = await import(jsonPath) as typeof import('../src/shared/validation/json')
    const { sha256Text } = await import(hashPath) as typeof import('../src/shared/validation/hash')
    const rows = []
    for (const request of requests) {
      const plan = await computeTerrainComposition(compositionPreset(request).input, new AbortController().signal)
      rows.push({ request, hash: sha256Text(canonicalJson(plan)), geometryBudget: plan.geometryBudget })
    }
    return rows
  }, requests)
  expect(actual).toEqual(expected)
  expect(workers.filter(url => url.includes('composition-worker.ts'))).toHaveLength(9)
  expect(errors).toEqual([])
  await info.attach('t9-node-worker-parity.json', { body: JSON.stringify(actual, null, 2), contentType: 'application/json' })
})

test('T9 UI cancels unchanged, adopts and cold-loads complete v4, and preserves current project after save or cold-read failure', async ({ page }, info) => {
  test.setTimeout(360_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#workspace'); await page.waitForFunction(() => Boolean(Reflect.get(window, '__sceneweaveOutdoorDev')))
  await page.evaluate(async () => {
    const path = '/src/platform/browser/content/refined-blank.ts'
    const { createRefinedBlankProject } = await import(path) as typeof import('../src/platform/browser/content/refined-blank')
    const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
    const source = await createRefinedBlankProject('island', { title: 'T9保留当前工程', sceneId: 't9-ui-source',
      widthMm: 48000, heightMm: 36000, preset: 'narrative', now: '2026-10-29T00:00:00.000Z' })
    await workspace.adoptNew(source); await workspace.flush()
  })
  await settled(page); await page.getByRole('tab', { name: '工程', exact: true }).click()
  const before = await state(page), panel = page.getByRole('region', { name: '通用地貌组合', exact: true })
  const candidate = page.getByRole('article', { name: '地貌组合候选', exact: true })
  await panel.getByLabel('地貌组合类型', { exact: true }).selectOption('archipelago')
  await panel.getByLabel('组合种子', { exact: true }).fill('terrain-compose-0')
  await expect(panel).toContainText('48 × 36 米')
  const preview = async () => {
    await panel.getByRole('button', { name: '预览地貌组合', exact: true }).click()
    await expect(candidate).toBeVisible({ timeout: 120_000 })
    await expect(candidate.getByRole('button', { name: '采用地貌组合', exact: true })).toBeEnabled({ timeout: 120_000 })
  }
  await preview(); expect(await state(page)).toEqual(before)
  await candidate.getByRole('button', { name: '取消组合预览', exact: true }).click()
  await expect(candidate).toHaveCount(0); expect(await state(page)).toEqual(before)
  await preview(); await candidate.getByRole('button', { name: '采用地貌组合', exact: true }).click()
  await expect(candidate).toHaveCount(0, { timeout: 120_000 }); await settled(page)
  const adopted = await state(page)
  expect(adopted.sceneId).not.toBe(before.sceneId); expect(adopted.schemaVersion).toBe(4)
  expect(adopted.generationVersion).toBe(5); expect(adopted.hash).toBe(adopted.coldHash)
  expect(adopted.count).toBe(before.count + 1)
  expect(adopted.boundsMm).toEqual({ x: 0, y: 0, width: 48000, height: 36000 })
  await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click()
  await expect.poll(async () => (await state(page)).checkpoint, { timeout: 120_000 }).toBeGreaterThan(adopted.checkpoint)
  await settled(page)
  const reloaded = await state(page)
  expect(reloaded.hash).toBe(adopted.hash); expect(reloaded.coldHash).toBe(adopted.hash)
  const failures = []
  for (const failure of ['save', 'coldRead'] as const) {
    const baseline = await state(page)
    await preview()
    await page.evaluate(async failure => {
      const { workspace } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev
      const projectRepository = (workspace as unknown as { repository: { save: Function; load: Function } }).repository
      if (failure === 'save') {
        const save = projectRepository.save.bind(projectRepository)
        projectRepository.save = async () => { projectRepository.save = save; throw new Error('T9 injected target save failure') }
      } else {
        const load = projectRepository.load.bind(projectRepository)
        projectRepository.load = async () => { projectRepository.load = load; return null }
      }
    }, failure)
    await candidate.getByRole('button', { name: '采用地貌组合', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(failure === 'save' ? 'T9 injected target save failure' : '冷读失败', { timeout: 120_000 })
    const retained = await state(page)
    expect(retained.sceneId).toBe(baseline.sceneId); expect(retained.hash).toBe(baseline.hash)
    expect(retained.coldHash).toBe(baseline.coldHash); expect(retained.checkpoint).toBe(baseline.checkpoint)
    expect(retained.count).toBe(baseline.count + (failure === 'coldRead' ? 1 : 0))
    failures.push({ failure, baseline, retained })
    await candidate.getByRole('button', { name: '取消组合预览', exact: true }).click()
    await expect(candidate).toHaveCount(0)
  }
  const sourceHash = await page.evaluate(async sceneId => {
    const path = '/src/shared/project/validate.ts', projectPath = '/src/application/workspace/project.ts'
    const { projectContentHash } = await import(path) as typeof import('../src/shared/project/validate')
    const { toBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
    const { repository } = Reflect.get(window, '__sceneweaveOutdoorDev') as Dev, source = await repository.load(sceneId)
    return source ? projectContentHash(toBundle(source).project) : null
  }, before.sceneId)
  expect(sourceHash).toBe(before.hash); expect(errors).toEqual([])
  await info.attach('t9-ui-transactions.json', { body: JSON.stringify({ before, adopted, reloaded, sourceHash, failures }, null, 2), contentType: 'application/json' })
})
