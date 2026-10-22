import { expect, test } from '@playwright/test'

test('C1d complete history view preserves both samples and audiences pixel for pixel', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const studyPath = '/src/editor/v2/study-sample.ts', islandPath = '/src/editor/v2/island-sample.ts'
    const layersPath = '/src/io/v3/migration.ts', historyPath = '/src/io/v4/migration.ts'
    const ioPath = '/src/io/v4/project-file.ts', rendererPath = '/src/render/v3/renderer.ts'
    const { createStudyProject } = await import(studyPath), { createIslandProject } = await import(islandPath)
    const { createLayerProject } = await import(layersPath), { migrateProjectV3ToV4 } = await import(historyPath)
    const { toCompleteProjectV3 } = await import(ioPath), { renderProjectV3, exportPngV3 } = await import(rendererPath)
    const results = []
    for (const [name, make] of [['study', createStudyProject], ['island', createIslandProject]] as const) {
      const before = await createLayerProject(await make()), source = JSON.stringify(before.document)
      const history = await migrateProjectV3ToV4(before), view = toCompleteProjectV3(history)
      for (const audience of ['gm', 'player'] as const) {
        const a = await renderProjectV3(before, { audience, longEdgePx: 4096 })
        const b = await renderProjectV3(view, { audience, longEdgePx: 4096 })
        const oldPixels = a.getContext('2d')!.getImageData(0, 0, a.width, a.height).data
        const newPixels = b.getContext('2d')!.getImageData(0, 0, b.width, b.height).data
        let differingChannels = 0
        for (let i = 0; i < oldPixels.length; i++) if (oldPixels[i] !== newPixels[i]) differingChannels++
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', newPixels))].map(value => value.toString(16).padStart(2, '0')).join('')
        const png = await exportPngV3(view, { audience, longEdgePx: 4096 }), text = new TextDecoder('latin1').decode(await png.arrayBuffer())
        results.push({ name, audience, width: b.width, height: b.height, differingChannels, hash,
          viewKeys: Object.keys(view).sort(), sourceUnchanged: source === JSON.stringify(before.document),
          historyMetadataInPng: ['historyIdentity', history.historyIdentity.lineageId, ...Object.values(history.historyIdentity.propTokens)].some(value => text.includes(value)) })
        a.width = a.height = b.width = b.height = 0
      }
    }
    return results
  })
  for (const result of report) {
    expect(result.differingChannels).toBe(0); expect(result.sourceUnchanged).toBe(true)
    expect(result.historyMetadataInPng).toBe(false); expect(result.width).toBe(4096)
    expect(result.viewKeys).toEqual(['assets', 'document', 'licenseBindings', 'licenses'])
  }
  await info.attach('c1d-default-pixel-parity.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
})

for (const name of ['VIS-01-S01', 'VIS-02-S02'] as const) {
  test(`C1d ${name} independent secret restore changes GM pixels while player pixels and PNG remain identical`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.goto('/')
    const report = await page.evaluate(async name => {
      const fixturePath = '/tests/b4-privacy-fixtures.ts', layersPath = '/src/io/v3/migration.ts'
      const identityPath = '/src/core/v4/identity.ts', restorePath = '/src/core/v4/restore.ts'
      const renderPath = '/src/render/v3/renderer.ts', projectPath = '/src/io/v4/project-file.ts'
      const { createPrivacyPairB4 } = await import(fixturePath), { createLayerProject } = await import(layersPath)
      const { createHistoryIdentityV4 } = await import(identityPath), { buildRestorePlanV4 } = await import(restorePath)
      const { renderProjectV3, exportPngV3 } = await import(renderPath), { toCompleteProjectV3 } = await import(projectPath)
      const pair = await createPrivacyPairB4(name), source = await createLayerProject(pair.a)
      // The production fixture includes an anchored clue. This copy removes it to exercise independent-prop restoration.
      delete source.document.notes['b4-secret-note']; delete source.document.entityLayers['b4-secret-note']
      const historic = structuredClone(source.document), current = structuredClone(historic), id = 'b4-secret-object'
      current.props[id].rotationDeg = 137
      const identity = createHistoryIdentityV4(historic)
      const plan = buildRestorePlanV4(current, identity, historic, identity, { ids: [id], mode: 'transform' })
      const before = toCompleteProjectV3({ ...source, document: current, historyIdentity: identity })
      const after = toCompleteProjectV3({ ...source, document: plan.document, historyIdentity: plan.historyIdentity })
      const pixelHash = async (canvas: HTMLCanvasElement) => {
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join('')
        canvas.width = canvas.height = 0; return hash
      }
      const pngHash = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
        canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close()
        return pixelHash(canvas)
      }
      const hashes = []
      for (const audience of ['gm', 'player'] as const) {
        const a = await pixelHash(await renderProjectV3(before, { audience, longEdgePx: 1200 }))
        const b = await pixelHash(await renderProjectV3(after, { audience, longEdgePx: 1200 }))
        const png = await pngHash(await exportPngV3(after, { audience, longEdgePx: 1200 }))
        hashes.push({ audience, before: a, after: b, png })
      }
      return { name, changed: plan.changed, changes: plan.changes.length, visibility: plan.document.props[id].visibility,
        currentVisibility: current.props[id].visibility, restoredRotation: plan.document.props[id].rotationDeg,
        historicRotation: historic.props[id].rotationDeg, masksUnchanged: JSON.stringify(current.regions) === JSON.stringify(plan.document.regions), hashes }
    }, name)
    expect(report.changed).toBe(true); expect(report.changes).toBe(1)
    expect(report.visibility).toBe('gm'); expect(report.currentVisibility).toBe('gm'); expect(report.masksUnchanged).toBe(true)
    expect(report.restoredRotation).toBe(report.historicRotation)
    for (const hashes of report.hashes) {
      expect(hashes.png).toBe(hashes.after)
      if (hashes.audience === 'player') expect(hashes.after).toBe(hashes.before)
      else expect(hashes.after).not.toBe(hashes.before)
    }
    await info.attach(`c1d-secret-${name}.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  })
}
