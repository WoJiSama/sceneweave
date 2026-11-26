import { expect, test } from '@playwright/test'

test.describe('Complete-v1 PNG output', () => {
  test('the fixed-mask study privacy fixture omits private geometry, notes and shadows from its actual player PNG', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    await page.goto('/')
    const report = await page.evaluate(async () => {
      const factoriesPath = '/src/platform/browser/content/factories.ts', nativeRenderPath = '/src/platform/browser/render/renderer.ts'
      const projectPath = '/src/application/workspace/project.ts', graphPath = '/src/shared/appearance/graph.ts', projectionPath = '/src/shared/projection/projection.ts'
      const runtimePath = '/src/platform/browser/runtime.ts'
      const { createSampleProject } = await import(factoriesPath), { exportPng } = await import(nativeRenderPath)
      const { toBundle, fromBundle } = await import(projectPath), { createCompositionContent } = await import(graphPath), { projectScene } = await import(projectionPath)
      const { runtime, validation } = await import(runtimePath)
      const ordinary = await createSampleProject('study'), scene = structuredClone(ordinary.document)
      const floorId = 'study-floor', baseLayer = Object.keys(scene.userLayers)[0], supportRef = { kind: 'room' as const, id: 'study-room' }
      const envelope = Object.values(ordinary.document.propDefinitions as Record<string, any>).find(item => item.catalogId === 'prop.sw.envelope')!
      const secretId = 'study-envelope', noteId = 'study-clue', marker = 'SECRET-STUDY：封蜡完整，落款处留白。'
      scene.props[secretId] = { id: secretId, floorId, editLocked: false, definitionRef: { id: envelope.id, version: envelope.version },
        appearance: structuredClone(envelope.defaultAppearance), visualBoundsMm: envelope.defaultVisualBoundsMm, positionMm: { x: 3080, y: 2700 },
        rotationDeg: 0, footprintMm: envelope.defaultFootprintMm, footprintOffsetMm: envelope.defaultFootprintOffsetMm, blocksMovement: false,
        blocksSight: false, visibility: 'gm', supportRef, roomId: supportRef.id, renderLayer: envelope.defaultRenderLayer, renderOrder: 20,
        shadowClass: envelope.defaultShadowClass, shadowOverride: null }
      scene.regions['study-privacy-mask'] = { id: 'study-privacy-mask', floorId, editLocked: false,
        boundaryMm: [{ x: 1800, y: 1400 }, { x: 4200, y: 1400 }, { x: 4200, y: 4000 }, { x: 1800, y: 4000 }],
        kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }
      scene.notes[noteId] = { id: noteId, floorId, editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: secretId },
        kind: 'clue', title: marker, text: marker, visibility: 'gm', discovered: false }
      for (const id of [secretId, noteId, 'study-privacy-mask']) scene.entityLayers[id] = baseLayer
      const bundle = toBundle(ordinary), content = createCompositionContent(scene, runtime)
      const native = await fromBundle({ project: { ...bundle.project, ...content }, resources: bundle.resources }, validation)
      const before = JSON.stringify(toBundle(native).project)
      const project = projectScene(native.document, 'player'), gm = projectScene(native.document, 'gm')
      const playerJson = JSON.stringify(project)
      const read = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
        canvas.width = bitmap.width; canvas.height = bitmap.height
        try {
          const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
          ctx.drawImage(bitmap, 0, 0)
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          const rgbaHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), n => n.toString(16).padStart(2, '0')).join('')
          const bounds = native.document.exportBoundsMm, x = Math.floor((3000 - bounds.x) / bounds.width * canvas.width), y = Math.floor((2700 - bounds.y) / bounds.height * canvas.height)
          return { width: canvas.width, height: canvas.height, rgbaHash, maskPixel: Array.from(ctx.getImageData(x, y, 1, 1).data) }
        } finally { bitmap.close(); canvas.width = canvas.height = 0 }
      }
      const outputs = []
      for (const audience of ['gm', 'player'] as const) {
        outputs.push({ audience, ...await read(await exportPng(toBundle(native), { audience, longEdgePx: 4096 })) })
      }
      return { outputs, unchanged: before === JSON.stringify(toBundle(native).project),
        gmRetainsSecretProp: gm.props.some((prop: any) => prop.id === secretId), gmRetainsSecretNote: gm.notes.some((note: any) => note.id === noteId),
        playerOmitsSecretProp: !project.props.some((prop: any) => prop.id === secretId), playerOmitsSecretNote: !project.notes.some((note: any) => note.id === noteId),
        playerOmitsSecretText: !playerJson.includes(marker), masks: project.masks.length }
    })
    await testInfo.attach('m20f-study-private-mask-4k-rgba.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
    expect(report.unchanged).toBe(true); expect(report.gmRetainsSecretProp).toBe(true); expect(report.gmRetainsSecretNote).toBe(true)
    expect(report.playerOmitsSecretProp).toBe(true); expect(report.playerOmitsSecretNote).toBe(true); expect(report.playerOmitsSecretText).toBe(true); expect(report.masks).toBe(1)
    for (const output of report.outputs) expect(output.width).toBe(4096)
    expect(report.outputs[1].maskPixel).toEqual([216, 213, 197, 255])
    expect(report.outputs[0].rgbaHash).not.toBe(report.outputs[1].rgbaHash)
  })

  test('missing native resource bytes abort PNG output and retain the full source project', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    const report = await page.evaluate(async () => {
      const factoryPath = '/src/platform/browser/content/factories.ts', renderPath = '/src/platform/browser/render/renderer.ts', bundlePath = '/src/application/workspace/project.ts'
      const { createSampleProject } = await import(factoryPath), { exportPng } = await import(renderPath), { toBundle } = await import(bundlePath)
      const project = await createSampleProject('study'), bundle = toBundle(project), before = JSON.stringify(bundle.project), missingHash = Object.keys(bundle.project.assets)[0]
      let reads = 0, emitted = false, errorMessage = ''
      const missing = { project: bundle.project, resources: { async read(hash: string) { reads++; if (hash === missingHash) throw new Error('M2-0f missing native bytes'); return bundle.resources.read(hash) } } }
      try { await exportPng(missing, { audience: 'player', longEdgePx: 4096 }); emitted = true }
      catch (error) { errorMessage = error instanceof Error ? error.message : String(error) }
      return { emitted, errorMessage, reads, unchanged: before === JSON.stringify(toBundle(project).project), retainedAssets: Object.keys(project.assets).length }
    })
    expect(report.emitted).toBe(false); expect(report.errorMessage).toContain('M2-0f missing native bytes')
    expect(report.reads).toBeGreaterThan(0); expect(report.unchanged).toBe(true); expect(report.retainedAssets).toBeGreaterThan(0)
  })
})
