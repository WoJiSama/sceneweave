import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import type { Workspace, CompositionPreview } from '../src/application/workspace/workspace'
import type { SceneDocument } from '../src/shared/model/scene'

type Dev = { workspace: Workspace }

async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 45_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 45_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 45_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 45_000 })
}

async function current(page: Page) {
  return page.evaluate(async () => {
    const helperPath = '/tests/helpers/native-workspace-browser.ts'
    const { readNativeCurrent } = await import(helperPath) as typeof import('./helpers/native-workspace-browser')
    const project = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project
    if (!project) throw new Error('Expected an open refined-island project')
    return { schemaVersion: project.schemaVersion, ...await readNativeCurrent(project),
      sources: structuredClone(project.authoringSources), licenseBindings: structuredClone(project.licenseBindings) }
  })
}

function withoutRevision(document: SceneDocument) {
  const { revision: _revision, updatedAt: _updatedAt, ...rest } = document
  return rest
}

function withoutProp(document: SceneDocument, propId: string) {
  const { props, ...rest } = withoutRevision(document)
  const { [propId]: _selected, ...others } = props
  return { ...rest, props: others }
}

test('Q1 refined island cancels safely, edits one real candidate and preserves its complete offline dual-audience 4K closure', async ({ page, context, browserName }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('/#workspace')
    await page.getByRole('tab', { name: '工程', exact: true }).click()
    await page.getByRole('button', { name: '苔冠岩岛 · 高差与草沿', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '确认打开工程', exact: true })
    await expect(dialog).toBeVisible({ timeout: 45_000 })
    await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await settled(page)
    const prior = await current(page)

    const refinedButton = page.getByRole('button', { name: '岬湾苔岛 · 精修版', exact: true })
    await refinedButton.click()
    await expect(dialog).toBeVisible({ timeout: 45_000 })
    await expect(dialog).toContainText('岬湾苔岛 · 精修版')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await settled(page)
    expect((await current(page)).contentHash).toBe(prior.contentHash)
    const afterCancel = await page.evaluate(async () => {
      const path = '/src/platform/browser/runtime.ts'
      const { projectRepository } = await import(path) as typeof import('../src/platform/browser/runtime')
      return (await projectRepository.list()).map(project => project.sceneId)
    })
    expect(afterCancel).toEqual([prior.sceneId])

    await refinedButton.click()
    await expect(dialog).toBeVisible({ timeout: 45_000 })
    await dialog.getByRole('button', { name: '保存并打开副本', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await settled(page)
    const original = await current(page)
    expect(original.sceneId).not.toBe(prior.sceneId)
    expect(original.title).toBe('岬湾苔岛 · 精修版')
    expect(original.schemaVersion).toBe(2)
    expect(original.document.schemaVersion).toBe(2)
    expect(original.revision).toBe(0)
    expect(Object.keys(original.sources)).toHaveLength(13)
    expect(Object.keys(original.document.props).length).toBeGreaterThan(30)
    expect(original.document.terrainAreas['q1-low'].groundElevationMm).toBe(800)
    expect(original.document.terrainAreas['q1-high'].groundElevationMm).toBe(2600)
    expect(original.document.terrainConnections['q1-stairs']).toMatchObject({ kind: 'stairs', widthMm: 1500, blocksMovement: false })
    expect(Object.keys(original.sources).some(id => id in prior.sources)).toBe(false)

    const preview = await page.evaluate(async () => {
      const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace
      const project = workspace.getState().project!
      const prop = Object.values(project.document.props).find(value => value.id.startsWith('q1-rock-') && !value.editLocked)
      if (!prop) throw new Error('Expected an independently editable Q1 rock')
      const rotationDeg = (prop.rotationDeg + 13) % 360
      const candidate = await workspace.preview([{ type: 'updateProp', id: prop.id, changes: { rotationDeg } }])
      Reflect.set(window, '__q1PropPreview', candidate)
      return { propId: prop.id, rotationDeg, candidateProp: structuredClone(candidate.document.props[prop.id]), revision: candidate.currentRevision }
    })
    expect(preview.revision).toBe(original.revision)
    expect(preview.candidateProp.rotationDeg).toBe(preview.rotationDeg)
    expect(preview.candidateProp).toEqual({ ...original.document.props[preview.propId], rotationDeg: preview.rotationDeg })
    expect((await current(page)).contentHash).toBe(original.contentHash)

    const repeatAdoption = await page.evaluate(async () => {
      const workspace = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace
      const preview = Reflect.get(window, '__q1PropPreview') as CompositionPreview
      await workspace.adoptPreview(preview)
      await workspace.flush()
      try { await workspace.adoptPreview(preview); return null }
      catch (error) { return error instanceof Error ? error.message : String(error) }
    })
    expect(repeatAdoption).toContain('不可重复采用')
    await settled(page)
    const adopted = await current(page)
    expect(adopted.revision).toBe(original.revision + 1)
    expect(adopted.document.props[preview.propId]).toEqual(preview.candidateProp)
    expect(withoutProp(adopted.document, preview.propId)).toEqual(withoutProp(original.document, preview.propId))
    expect(adopted.sources).toEqual(original.sources)
    expect(adopted.assets).toEqual(original.assets)
    expect(adopted.licenses).toEqual(original.licenses)
    expect(adopted.licenseBindings).toEqual(original.licenseBindings)

    await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click()
    await settled(page)
    const undone = await current(page)
    expect(undone.revision).toBe(adopted.revision + 1)
    expect(withoutRevision(undone.document)).toEqual(withoutRevision(original.document))
    await expect(page.getByRole('button', { name: '撤销素材编辑', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '重做素材编辑', exact: true }).click()
    await settled(page)
    const redone = await current(page)
    expect(redone.revision).toBe(undone.revision + 1)
    expect(withoutRevision(redone.document)).toEqual(withoutRevision(adopted.document))
    expect(redone.sources).toEqual(original.sources)

    const stored = await page.evaluate(async ({ priorId, refinedId }) => {
      const runtimePath = '/src/platform/browser/runtime.ts', projectPath = '/src/application/workspace/project.ts'
      const helperPath = '/tests/helpers/visual-authoring-browser.ts', pngPath = '/tests/helpers/m2-joint-browser.ts'
      const svgPath = '/src/shared/ai/svg.ts', hashPath = '/src/shared/project/validate.ts'
      const { projectRepository, validation } = await import(runtimePath) as typeof import('../src/platform/browser/runtime')
      const { fromBundle } = await import(projectPath) as typeof import('../src/application/workspace/project')
      const { inspectVisualResourceClosure } = await import(helperPath) as typeof import('./helpers/visual-authoring-browser')
      const { readActualPng } = await import(pngPath) as typeof import('./helpers/m2-joint-browser')
      const { normalizeStaticSvg } = await import(svgPath) as typeof import('../src/shared/ai/svg')
      const { projectContentHash } = await import(hashPath) as typeof import('../src/shared/project/validate')
      const prior = await projectRepository.load(priorId), saved = await projectRepository.load(refinedId)
      if (!prior || !saved) throw new Error('Opening a refined copy must preserve both saved projects')
      const cold = await fromBundle(saved, validation), closure = await inspectVisualResourceClosure(cold)
      const sources = []
      for (const [id, source] of Object.entries(cold.authoringSources)) {
        const originalText = new TextDecoder().decode(await cold.resources.read(source.sourceSha256))
        const normalizedText = new TextDecoder().decode(await cold.resources.read(source.normalizedSha256))
        const normalized = normalizeStaticSvg(originalText), bytes = await cold.resources.read(source.rasterSha256)
        const raster = await readActualPng(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
        sources.push({ id, sourceHash: normalized.sourceSha256, normalizedHash: normalized.normalizedSha256,
          normalizationMatches: normalized.normalizedSource === normalizedText,
          raster: { width: raster.width, height: raster.height, rgbaHash: raster.rgbaHash, bytes: raster.bytes, chunks: raster.chunks } })
      }
      return { priorHash: projectContentHash(prior.project), contentHash: projectContentHash(saved.project),
        document: cold.document, closure, sources }
    }, { priorId: prior.sceneId, refinedId: original.sceneId })
    expect(stored.priorHash).toBe(prior.contentHash)
    expect(stored.contentHash).toBe(redone.contentHash)
    expect(stored.document).toEqual(redone.document)
    expect(stored.closure.sources).toEqual(original.sources)
    for (const [hash, actual] of Object.entries(stored.closure.hashes)) expect(actual).toBe(hash)
    for (const value of stored.sources) {
      const source = original.sources[value.id]
      expect(value.sourceHash).toBe(source.sourceSha256)
      expect(value.normalizedHash).toBe(source.normalizedSha256)
      expect(value.normalizationMatches).toBe(true)
      expect([value.raster.width, value.raster.height]).toEqual([512, 512])
      expect(value.raster.rgbaHash).toMatch(/^[a-f0-9]{64}$/)
      expect(stored.closure.assets[source.rasterSha256]).toBeDefined()
      expect(stored.closure.licenseBindings).toContainEqual(expect.objectContaining({ subjectKind: 'asset', subjectId: value.id, licenseRef: 'MIT', embedding: 'allowed' }))
    }
    for (const binding of stored.closure.licenseBindings) {
      expect(binding.embedding).toBe('allowed')
      const licenseHash = binding.licensePath.replace(/^licenses\//, '').replace(/\.txt$/, '')
      expect(stored.closure.licenses[licenseHash].text).toContain('Permission is hereby granted, free of charge')
      expect(stored.closure.licenses[licenseHash].text).toContain('No reference-map imagery or third-party assets are embedded.')
    }

    await page.getByRole('button', { name: '重新载入已保存版本', exact: true }).click()
    await settled(page)
    expect((await current(page)).contentHash).toBe(redone.contentHash)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '完整工程', exact: true }).click()
    const download = await downloadPromise
    const backupPath = info.outputPath('q1-edited.sceneweave')
    await download.saveAs(backupPath)
    const backup = await readFile(backupPath)
    expect(backup.subarray(0, 2).toString()).toBe('PK')

    const before = await page.evaluate(async () => {
      const path = '/tests/helpers/visual-authoring-browser.ts'
      const { stageVisualRoundTrip } = await import(path) as typeof import('./helpers/visual-authoring-browser')
      const project = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState().project!
      const stage = await stageVisualRoundTrip(project)
      Reflect.set(window, '__q1VisualOfflineStage', stage)
      return { ...stage, bytes: stage.bytes.length }
    })
    let offlineRequests = 0
    const countNetwork = (request: import('@playwright/test').Request) => { if (/^https?:/.test(request.url())) offlineRequests++ }
    const denyNetwork = (route: import('@playwright/test').Route) => route.abort('internetdisconnected')
    page.on('request', countNetwork)
    if (browserName === 'webkit') await context.route(/^https?:/, denyNetwork)
    else await context.setOffline(true)
    let after: Awaited<ReturnType<typeof import('./helpers/visual-authoring-browser').finishVisualRoundTrip>>
    try {
      after = await page.evaluate(async () => {
        const path = '/tests/helpers/visual-authoring-browser.ts'
        const { finishVisualRoundTrip } = await import(path) as typeof import('./helpers/visual-authoring-browser')
        return finishVisualRoundTrip(Reflect.get(window, '__q1VisualOfflineStage'))
      })
    } finally {
      if (browserName === 'webkit') await context.unroute(/^https?:/, denyNetwork)
      else await context.setOffline(false)
      page.off('request', countNetwork)
    }
    expect(offlineRequests).toBe(0)
    expect(after.contentHash).toBe(before.contentHash)
    expect(after.contentHash).toBe(redone.contentHash)
    expect(after.visual).toBe(before.visual)
    expect(after.hashes).toEqual(before.hashes)
    expect(after.sources).toBe(before.sources)
    expect(after.licenses).toBe(before.licenses)
    expect(after.authoringSources).toBe(13)
    expect(after.assets).toBe(before.assets)
    expect(after.schemaVersion).toBe(2)
    expect(after.sceneSchemaVersion).toBe(2)
    for (const audience of ['gm', 'player'] as const) {
      expect([after[audience].width, after[audience].height]).toEqual([4096, 3072])
      expect(after[audience].rgbaHash).toBe(before[audience].rgbaHash)
      expect(after[audience].containsMetadata).toBe(false)
      expect([...new Set(after[audience].chunks)]).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
    }
    const evidencePath = info.outputPath('q1-refined-island.json')
    await writeFile(evidencePath, JSON.stringify({ priorId: prior.sceneId, sceneId: original.sceneId,
      propId: preview.propId, revisions: [original.revision, adopted.revision, undone.revision, redone.revision],
      sourceClosure: stored.closure, actualSources: stored.sources, backupBytes: backup.length,
      source: before, offline: after, offlineRequests, pageErrors: errors,
      networkDenial: browserName === 'webkit' ? 'all HTTP(S) aborted; local Blob APIs enabled' : 'native browser offline emulation' }, null, 2))
    await info.attach('q1-refined-island.json', { path: evidencePath, contentType: 'application/json' })
  } finally {
    await info.attach('q1-page-errors.json', { body: JSON.stringify(errors), contentType: 'application/json' })
    expect(errors).toEqual([])
  }
})
