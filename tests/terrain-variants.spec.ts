import { openWorkspaceModule } from './workspace-navigation-helpers'
import { acknowledgeAssetQuality } from './asset-quality-helpers'
import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const lib = (page: Page) => page.getByRole('region', { name: '组件素材库', exact: true })
async function browseCatalog(page: Page) {
  const controls = lib(page).getByRole('group', { name: '素材库操作', exact: true })
  await controls.getByRole('button', { name: '浏览素材', exact: true }).click()
  await expect(controls.getByRole('button', { name: '浏览素材', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(controls.getByRole('button', { name: /^导入\/管理/ })).toHaveAttribute('aria-expanded', 'false')
}
async function manageCatalog(page: Page) {
  const button = lib(page).getByRole('group', { name: '素材库操作', exact: true }).getByRole('button', { name: /^导入\/管理/ })
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(lib(page).getByRole('region', { name: '素材导入与管理', exact: true })).toBeVisible()
}
async function saved(page: Page) {
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 90000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
}
async function current(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/editor/main/Workbench.tsx', bundlePath = '/src/application/workspace/project.ts', hashPath = '/src/shared/project/validate.ts'
    const { nativeWorkspace } = await import(path), { toBundle } = await import(bundlePath), { projectContentHash } = await import(hashPath)
    const p = nativeWorkspace.getState().project!
    return { hash: projectContentHash(toBundle(p).project), revision: p.document.revision, definitions: Object.keys(p.document.propDefinitions), props: Object.keys(p.document.props) }
  })
}

test('twelve original terrain variants retain real alpha, fixed roots and complete offline closures in the UI', async ({ page }, info) => {
  test.setTimeout(300000)
  await page.goto('/#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('地形变体真实浏览器')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await saved(page)
  await openWorkspaceModule(page, '素材')
  const library = lib(page)
  await browseCatalog(page)
  await library.getByLabel('素材来源', { exact: true }).selectOption('variants')
  await expect(library.locator('.catalog-entries > article')).toHaveCount(12, { timeout: 90000 })
  const names = await library.locator('.catalog-entries > article strong').allTextContents()
  expect(new Set(names).size).toBe(12)
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-native-format', 'sceneweave-complete-project@1')
  const original = await current(page)
  for (const name of names) await library.getByRole('checkbox', { name: `选择素材 ${name}`, exact: true }).check()
  await manageCatalog(page)
  if (!await library.locator('.catalog-management').evaluate(element => (element as HTMLDetailsElement).open)) await library.locator('.catalog-management > summary').click()
  await library.getByRole('button', { name: '预览采用到本工程', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消组件预览', exact: true })).toBeVisible({ timeout: 90000 })
  expect((await current(page)).hash).toBe(original.hash)
  await page.getByRole('button', { name: '取消组件预览', exact: true }).click()
  await browseCatalog(page)
  await expect(library.getByRole('checkbox', { checked: true })).toHaveCount(12)
  await library.getByRole('button', { name: '清空选择', exact: true }).click()
  for (const name of names.filter(value => /草|碎岩|碎石/.test(value))) await library.getByRole('checkbox', { name: `选择素材 ${name}`, exact: true }).check()
  await expect(library.getByRole('checkbox', { checked: true })).toHaveCount(4)
  await manageCatalog(page)
  if (!await library.locator('.catalog-management').evaluate(element => (element as HTMLDetailsElement).open)) await library.locator('.catalog-management > summary').click()
  await library.getByRole('button', { name: '预览采用到本工程', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible({ timeout: 90000 })
  await acknowledgeAssetQuality(page)
  await page.getByRole('button', { name: '采用组件修改', exact: true }).click()
  await saved(page)
  expect((await current(page)).definitions.length).toBe(original.definitions.length + 4)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  expect((await current(page)).definitions).toEqual(original.definitions)
  // The same full-v1 blank already supports the fixed upright presentations.
  await openWorkspaceModule(page, '素材')
  await browseCatalog(page)
  await library.getByLabel('素材来源', { exact: true }).selectOption('variants')
  const before = await current(page)
  for (const name of names) await library.getByRole('checkbox', { name: `选择素材 ${name}`, exact: true }).check()
  await manageCatalog(page)
  if (!await library.locator('.catalog-management').evaluate(element => (element as HTMLDetailsElement).open)) await library.locator('.catalog-management > summary').click()
  await library.getByRole('button', { name: '预览采用到本工程', exact: true }).click()
  await expect(page.getByRole('button', { name: '采用组件修改', exact: true })).toBeVisible({ timeout: 90000 })
  expect((await current(page)).hash).toBe(before.hash)
  await acknowledgeAssetQuality(page)
  await page.getByRole('button', { name: '采用组件修改', exact: true }).click(); await saved(page)
  const adopted = await current(page)
  expect(adopted.definitions.length).toBe(before.definitions.length + 12)
  expect(adopted.revision).toBe(before.revision + 1); expect(adopted.props).toEqual(before.props)

  const proof = await page.evaluate(async () => {
    const paths = { art: '/src/shared/visual/terrain-variant-art.ts', pack: '/src/platform/browser/content/terrain-variant-catalog.ts', w: '/src/editor/main/Workbench.tsx', p: '/src/application/workspace/project.ts', r: '/src/platform/browser/runtime.ts', f: '/src/shared/project/file.ts', h: '/src/shared/project/validate.ts', c: '/src/editor/main/catalog.ts', repo: '/src/platform/browser/library/repository.ts', presentation: '/src/shared/appearance/presentation.ts', hash: '/src/shared/validation/hash.ts' }
    const { TERRAIN_VARIANT_ART } = await import(paths.art), { createTerrainVariantCatalogProject, TERRAIN_VARIANT_SPECS } = await import(paths.pack), { nativeWorkspace } = await import(paths.w), { toBundle } = await import(paths.p), { runtime, validation, projectRepository } = await import(paths.r), { exportProject, importProject } = await import(paths.f), { projectContentHash } = await import(paths.h), catalog = await import(paths.c), { LibraryRepository } = await import(paths.repo), { definitionPresentation } = await import(paths.presentation), { sha256Bytes } = await import(paths.hash)
    const provider = await createTerrainVariantCatalogProject(), project = nativeWorkspace.getState().project!, bundle = toBundle(project)
    const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 1110
    const c = canvas.getContext('2d')!; c.fillStyle = '#f4f0e5'; c.fillRect(0, 0, canvas.width, canvas.height)
    c.fillStyle = '#34453d'; c.font = 'bold 28px sans-serif'; c.fillText('Sceneweave · 12 original terrain variants', 28, 42)
    c.font = '17px sans-serif'; c.fillText('Fixed PNG silhouettes · red cross = root anchor · world dimensions in mm', 28, 72)
    const rows = [], entries = []
    for (const [i, spec] of TERRAIN_VARIANT_SPECS.entries()) {
      const d = project.document.propDefinitions[spec.definitionId], a = project.document.assets[spec.assetId], source = project.authoringSources[spec.assetId], art = TERRAIN_VARIANT_ART.find((value: any) => value.key === spec.key)
      if (!d || !source || new TextDecoder().decode(await project.resources.read(source.sourceSha256)) !== art.sourceSvg) throw new Error('Variant source closure missing')
      const actual = definitionPresentation(project.appearance, { id: d.id, version: d.version })
      if (spec.presentation.mode === 'nearSide' && JSON.stringify(actual) !== JSON.stringify(spec.presentation)) throw new Error('Fixed root changed')
      const bytes = await project.resources.read(a.sha256), image = await createImageBitmap(new Blob([bytes.slice().buffer], { type: 'image/png' }))
      const sample = document.createElement('canvas'); sample.width = image.width; sample.height = image.height
      const sc = sample.getContext('2d')!; sc.drawImage(image, 0, 0); const rgba = sc.getImageData(0, 0, image.width, image.height).data, alpha = new Uint8Array(image.width * image.height)
      let clear = 0, filled = 0
      for (let p = 0; p < alpha.length; p++) { alpha[p] = rgba[p * 4 + 3]; if (alpha[p] === 0) clear++; if (alpha[p] > 0) filled++ }
      const x = (i % 4) * 360 + 18, y = Math.floor(i / 4) * 330 + 100
      for (let yy = 0; yy < 240; yy += 20) for (let xx = 0; xx < 320; xx += 20) { c.fillStyle = ((xx + yy) / 20) % 2 ? '#e2e1da' : '#f9f8f1'; c.fillRect(x + xx, y + yy, 20, 20) }
      const fit = Math.min(280 / image.width, 220 / image.height), width = image.width * fit, height = image.height * fit, left = x + (320 - width) / 2, top = y + (240 - height) / 2
      c.drawImage(image, left, top, width, height)
      const root = spec.presentation.rootAnchorMm, rx = left + (root.x - d.defaultVisualBoundsMm.x) / d.defaultVisualBoundsMm.width * width, ry = top + (root.y - d.defaultVisualBoundsMm.y) / d.defaultVisualBoundsMm.height * height
      c.strokeStyle = '#bd4137'; c.lineWidth = 2; c.beginPath(); c.moveTo(rx - 7, ry); c.lineTo(rx + 7, ry); c.moveTo(rx, ry - 7); c.lineTo(rx, ry + 7); c.stroke()
      c.fillStyle = '#34453d'; c.font = 'bold 18px sans-serif'; c.fillText(spec.name, x, y + 268); c.font = '14px sans-serif'; c.fillText(`${spec.widthMm} × ${spec.heightMm} · footprint ${spec.footprintMm.width} × ${spec.footprintMm.height}`, x, y + 292)
      rows.push({ ...spec, sha256: a.sha256, alphaHash: sha256Bytes(alpha), transparentPixels: clear, filledPixels: filled, pixels: alpha.length, sourceExact: true }); image.close()
      entries.push(await catalog.prepareCatalogEntry(provider, { kind: 'prop', definitionId: spec.definitionId }))
    }
    const backup = await catalog.exportCatalogBackup(entries.map((entry: any) => ({ entry, organization: { tags: ['地形变体'], colors: [], favorite: false } }))), restored = await catalog.readCatalogBackup(new File([backup], 'terrain-variants.zip'))
    const repo = new LibraryRepository({ name: `variant-proof-${crypto.randomUUID()}`, runtime, validation })
    try {
      const empty = await repo.read(); if (empty.entries.length) throw new Error('Target library must be empty')
      await repo.commit(empty.revision, { put: restored.records.map((record: any) => record.entry), organization: restored.records.map((record: any) => ({ key: record.entry.item.identity.key, value: record.organization })) })
      const cold = await repo.read(); if (cold.entries.length !== 12) throw new Error('Isolated library lost entries')
      for (const entry of cold.entries) await catalog.readCatalogEntry(await repo.load(entry.item.identity.key))
    } finally { repo.close(); await repo.database.delete() }
    const bytes = await exportProject(bundle, validation), round = await importProject(bytes, validation), cold = await projectRepository.load(project.document.sceneId)
    const hash = projectContentHash(bundle.project)
    if (hash !== projectContentHash(round.project) || hash !== projectContentHash(cold!.project)) throw new Error('Variant package or cold save mismatch')
    const base64 = (input: Uint8Array) => { let text = ''; for (let i = 0; i < input.length; i += 32768) text += String.fromCharCode(...input.subarray(i, i + 32768)); return btoa(text) }
    return { rows, capsules: restored.records.length, completeHash: hash, package: base64(bytes), gallery: canvas.toDataURL('image/png').split(',')[1] }
  })
  expect(proof.rows).toHaveLength(12); expect(proof.capsules).toBe(12)
  for (const row of proof.rows) { expect(row.transparentPixels).toBeGreaterThan(row.pixels * .1); expect(row.filledPixels).toBeGreaterThan(row.pixels * .05) }
  expect(new Set(proof.rows.map(row => row.alphaHash)).size).toBe(12)
  await writeFile(info.outputPath('terrain-variants-gallery.png'), Buffer.from(proof.gallery, 'base64'))
  await writeFile(info.outputPath('terrain-variants.sceneweave'), Buffer.from(proof.package, 'base64'))
  await writeFile(info.outputPath('terrain-variants-proof.json'), JSON.stringify({ ...proof, package: undefined, gallery: undefined }, null, 2))
  await info.attach('terrain-variants-gallery.png', { body: Buffer.from(proof.gallery, 'base64'), contentType: 'image/png' })
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await saved(page)
  expect((await current(page)).definitions).toEqual(before.definitions)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await saved(page)
  expect((await current(page)).definitions).toEqual(adopted.definitions)
})

test('actual placed variants enforce eight fixed upright roots while four ground details rotate', async ({ page }, info) => {
  test.setTimeout(120000)
  await page.goto('/')
  const proof = await page.evaluate(async () => {
    const p = '/src/platform/browser/content/terrain-variant-catalog.ts', a = '/src/shared/appearance/commands.ts', r = '/src/platform/browser/runtime.ts', w = '/src/application/workspace/project.ts', renderer = '/src/platform/browser/render/renderer.ts'
    const { createTerrainVariantCatalogProject, TERRAIN_VARIANT_SPECS } = await import(p), { applyCompositionCommands } = await import(a), { runtime, validation } = await import(r), { validateEditableProject, toBundle } = await import(w), { renderProject } = await import(renderer)
    const base = await createTerrainVariantCatalogProject(), floorId = Object.keys(base.document.floors)[0], layerId = Object.keys(base.document.userLayers)[0]
    let rejectedUprightRotations = 0
    for (const spec of TERRAIN_VARIANT_SPECS.filter((value: any) => value.presentation.mode === 'nearSide')) {
      try {
        applyCompositionCommands({ document: base.document, historyIdentity: base.historyIdentity, appearance: base.appearance }, [{ type: 'addProp', id: 'invalid-rotation', definitionRef: { id: spec.definitionId, version: 1 }, floorId, layerId, positionMm: { x: 3000, y: 3000 }, rotationDeg: 45, supportRef: { kind: 'floor', id: floorId } }], runtime)
      } catch (error) { if (error instanceof Error && error.message.includes('近侧视物件须保持零旋转')) rejectedUprightRotations++; else throw error }
    }
    if (rejectedUprightRotations !== 8) throw new Error('Upright rotation contract was bypassed')
    const images = []
    for (const rotationDeg of [0, 45]) {
      const commands = TERRAIN_VARIANT_SPECS.map((spec: any, index: number) => ({ type: 'addProp', id: `placed-${spec.key}`, definitionRef: { id: spec.definitionId, version: 1 }, floorId, layerId, positionMm: { x: 3000 + (index % 4) * 6000, y: 3000 + Math.floor(index / 4) * 6000 }, rotationDeg: spec.presentation.mode === 'nearSide' ? 0 : rotationDeg, supportRef: { kind: 'floor', id: floorId } }))
      const placed = applyCompositionCommands({ document: base.document, historyIdentity: base.historyIdentity, appearance: base.appearance }, commands, runtime)
      const project = await validateEditableProject({ ...base, ...placed }, validation)
      images.push(await renderProject(toBundle(project), { audience: 'gm', longEdgePx: 1600 }))
    }
    const [before, after] = images, av = before.getContext('2d')!.getImageData(0, 0, before.width, before.height).data, bv = after.getContext('2d')!.getImageData(0, 0, after.width, after.height).data
    const rows = TERRAIN_VARIANT_SPECS.map((spec: any, i: number) => {
      let changed = 0
      for (let y = Math.floor(i / 4) * 400; y < (Math.floor(i / 4) + 1) * 400; y++) for (let x = (i % 4) * 400; x < ((i % 4) + 1) * 400; x++) {
        const offset = (y * before.width + x) * 4
        if (av[offset] !== bv[offset] || av[offset + 1] !== bv[offset + 1] || av[offset + 2] !== bv[offset + 2] || av[offset + 3] !== bv[offset + 3]) changed++
      }
      return { key: spec.key, mode: spec.presentation.mode, changedPixels: changed }
    })
    return { rows, rejectedUprightRotations, width: before.width, height: before.height, placed: before.toDataURL('image/png').split(',')[1], rotated: after.toDataURL('image/png').split(',')[1] }
  })
  expect([proof.width, proof.height]).toEqual([1600, 1200])
  for (const row of proof.rows) if (row.mode === 'nearSide') expect(row.changedPixels, row.key).toBe(0); else expect(row.changedPixels, row.key).toBeGreaterThan(0)
  await writeFile(info.outputPath('terrain-variants-placed.png'), Buffer.from(proof.placed, 'base64'))
  await writeFile(info.outputPath('terrain-variants-rotated.png'), Buffer.from(proof.rotated, 'base64'))
  await writeFile(info.outputPath('rotation-proof.json'), JSON.stringify({ ...proof, placed: undefined, rotated: undefined }, null, 2))
})
