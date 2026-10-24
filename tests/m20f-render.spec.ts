import { expect, test } from '@playwright/test'

// Reference imports are deliberately confined to this test. The production
// factory, workspace and renderer have no dependency on old scene versions.
test.describe('M2-0f actual native-v1 PNG parity', () => {
  test.describe.configure({ mode: 'serial' })

  for (const sample of ['study', 'island', 'outpost'] as const) {
    test(`${sample}: both native audiences preserve the reference 4K RGBA output`, async ({ page }, testInfo) => {
      test.setTimeout(180_000)
      await page.goto('/')
      const report = await page.evaluate(async sample => {
        const factoryPath = '/src/platform/browser/content/factories.ts', renderPath = '/src/platform/browser/render/renderer.ts'
        const bundlePath = '/src/application/workspace/project.ts', projectionPath = '/src/shared/projection/projection.ts'
        const { createSampleProject } = await import(factoryPath), { exportPng } = await import(renderPath)
        const { toBundle } = await import(bundlePath), { projectScene } = await import(projectionPath)
        const native = await createSampleProject(sample), nativeBefore = JSON.stringify(toBundle(native).project)
        let reference: any, exportReference: (options: { audience: 'gm' | 'player'; longEdgePx: number }) => Promise<Blob>
        if (sample === 'outpost') {
          const referenceFactory = '/src/editor/v6/outpost-project.ts', referenceView = '/src/io/v6/project-file.ts', referenceRender = '/src/render/v3/renderer.ts'
          const { createOutpostProject } = await import(referenceFactory), { toCompleteProjectV3 } = await import(referenceView), { exportPngV3 } = await import(referenceRender)
          reference = await createOutpostProject()
          exportReference = options => exportPngV3(toCompleteProjectV3(reference), options)
        } else {
          const referenceFactory = sample === 'study' ? '/src/editor/v2/study-sample.ts' : '/src/editor/v2/island-sample.ts'
          const referenceRender = '/src/render/v2/renderer.ts', factory = await import(referenceFactory), { exportPngV2 } = await import(referenceRender)
          reference = await (sample === 'study' ? factory.createStudyProject() : factory.createIslandProject())
          exportReference = options => exportPngV2(reference, options)
        }
        const referenceBefore = JSON.stringify(reference.document)
        const sha = async (bytes: Uint8ClampedArray<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
        const readPng = async (blob: Blob) => {
          const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), chunks: string[] = []
          if (blob.type !== 'image/png' || bytes.length < 20) throw new Error('Expected actual encoded PNG')
          let offset = 8
          while (offset + 12 <= bytes.length) {
            const length = view.getUint32(offset), end = offset + length + 12
            if (end > bytes.length) throw new Error('Truncated actual PNG')
            chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset = end
          }
          if (offset !== bytes.length || chunks.at(-1) !== 'IEND') throw new Error('PNG has trailing bytes or no IEND')
          const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
          canvas.width = bitmap.width; canvas.height = bitmap.height
          try {
            const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
            if (!context) throw new Error('Real Canvas context unavailable')
            context.drawImage(bitmap, 0, 0)
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
            return { width: canvas.width, height: canvas.height, pixels, rgbaHash: await sha(pixels), pngBytes: bytes.length,
              metadataChunks: chunks.filter(chunk => ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(chunk)) }
          } finally { bitmap.close(); canvas.width = canvas.height = 0 }
        }
        const results = []
        for (const audience of ['gm', 'player'] as const) {
          // Sequential export and decode keeps the peak bounded to two RGBA
          // arrays and ensures this test never runs simultaneous renderers.
          const old = await readPng(await exportReference({ audience, longEdgePx: 4096 }))
          const current = await readPng(await exportPng(toBundle(native), { audience, longEdgePx: 4096 }))
          let differingChannels = 0, maximumChannelDifference = 0, opaquePixels = 0
          if (old.pixels.length === current.pixels.length) {
            for (let i = 0; i < current.pixels.length; i++) {
              const delta = Math.abs(old.pixels[i] - current.pixels[i])
              if (delta) differingChannels++
              maximumChannelDifference = Math.max(maximumChannelDifference, delta)
            }
          } else differingChannels = Math.max(old.pixels.length, current.pixels.length)
          for (let i = 3; i < current.pixels.length; i += 4) if (current.pixels[i] === 255) opaquePixels++
          results.push({ audience, width: current.width, height: current.height, referenceWidth: old.width, referenceHeight: old.height,
            differingChannels, maximumChannelDifference, nativeRgbaHash: current.rgbaHash, referenceRgbaHash: old.rgbaHash,
            pngBytes: current.pngBytes, metadataChunks: current.metadataChunks, opaquePixels })
        }
        const player = projectScene(native.document, 'player'), gm = projectScene(native.document, 'gm'), playerJson = JSON.stringify(player)
        const privateNotes = Object.values(native.document.notes).filter((note: any) => note.visibility === 'gm') as { id: string; text: string; title?: string }[]
        const privateProps = Object.values(native.document.props).filter((prop: any) => prop.visibility === 'gm') as { id: string }[]
        const gmNoteIds = new Set(gm.notes.map((note: any) => note.id)), playerNoteIds = new Set(player.notes.map((note: any) => note.id))
        const playerPropIds = new Set(player.props.map((prop: any) => prop.id))
        const masks = player.masks.map((ring: { x: number; y: number }[]) => ({
          x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
          y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
        }))
        // Re-read the actual player PNG only when a fixed private geometry mask
        // exists, and verify the final opaque cover at its interior point.
        const maskPixels: number[][] = []
        if (masks.length) {
          const output = await readPng(await exportPng(toBundle(native), { audience: 'player', longEdgePx: 4096 })), bounds = player.bounds
          for (const p of masks) {
            const x = Math.floor((p.x - bounds.x) / bounds.width * output.width), y = Math.floor((p.y - bounds.y) / bounds.height * output.height)
            if (x >= 0 && y >= 0 && x < output.width && y < output.height) maskPixels.push(Array.from(output.pixels.subarray((y * output.width + x) * 4, (y * output.width + x) * 4 + 4)))
          }
        }
        return { sample, format: native.format, sceneFormat: native.document.format, results,
          nativeUnchanged: nativeBefore === JSON.stringify(toBundle(native).project), referenceUnchanged: referenceBefore === JSON.stringify(reference.document),
          privacy: { privateNoteCount: privateNotes.length, privatePropCount: privateProps.length,
            gmRetainsPrivateNotes: privateNotes.every(note => gmNoteIds.has(note.id)),
            playerOmitsPrivateNotes: privateNotes.every(note => !playerNoteIds.has(note.id)),
            playerOmitsPrivateText: privateNotes.every(note => !playerJson.includes(note.text) && (!note.title || !playerJson.includes(note.title))),
            playerOmitsPrivateProps: privateProps.every(prop => !playerPropIds.has(prop.id)),
            playerOnlyPublicProps: player.props.every((prop: any) => prop.visibility === 'public'), maskPixels } }
      }, sample)
      await testInfo.attach(`m20f-${sample}-native-reference-4k-rgba.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
      expect(report.format).toBe('sceneweave-complete-project'); expect(report.sceneFormat).toBe('sceneweave-scene')
      expect(report.nativeUnchanged).toBe(true); expect(report.referenceUnchanged).toBe(true)
      for (const result of report.results) {
        expect(result.width).toBe(4096); expect(result.width).toBe(result.referenceWidth); expect(result.height).toBe(result.referenceHeight)
        expect(result.differingChannels).toBe(0); expect(result.maximumChannelDifference).toBe(0); expect(result.nativeRgbaHash).toBe(result.referenceRgbaHash)
        expect(result.metadataChunks).toEqual([]); expect(result.pngBytes).toBeGreaterThan(1000); expect(result.opaquePixels).toBe(result.width * result.height)
      }
      expect(report.privacy.gmRetainsPrivateNotes).toBe(true); expect(report.privacy.playerOmitsPrivateNotes).toBe(true)
      expect(report.privacy.playerOmitsPrivateText).toBe(true); expect(report.privacy.playerOmitsPrivateProps).toBe(true); expect(report.privacy.playerOnlyPublicProps).toBe(true)
      if (sample === 'outpost') {
        expect(report.privacy.privateNoteCount).toBeGreaterThan(0)
        expect(report.results[0].nativeRgbaHash).not.toBe(report.results[1].nativeRgbaHash)
      }
      for (const pixel of report.privacy.maskPixels) expect(pixel).toEqual([216, 213, 197, 255])
    })
  }

  test('the fixed-mask study privacy fixture omits private geometry, notes and shadows from its actual player PNG', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    await page.goto('/')
    const report = await page.evaluate(async () => {
      const factoriesPath = '/src/platform/browser/content/factories.ts', nativeRenderPath = '/src/platform/browser/render/renderer.ts'
      const projectPath = '/src/application/workspace/project.ts', graphPath = '/src/shared/appearance/graph.ts', projectionPath = '/src/shared/projection/projection.ts'
      const legacyStudyPath = '/src/editor/v2/study-sample.ts', legacyRenderPath = '/src/render/v2/renderer.ts', runtimePath = '/src/platform/browser/runtime.ts'
      const { createSampleProject } = await import(factoriesPath), { exportPng } = await import(nativeRenderPath)
      const { toBundle, fromBundle } = await import(projectPath), { createCompositionContent } = await import(graphPath), { projectScene } = await import(projectionPath)
      const { createStudyProject, createStudyPrivacyDocument } = await import(legacyStudyPath), { exportPngV2 } = await import(legacyRenderPath)
      const { runtime, validation } = await import(runtimePath)
      const ordinary = await createSampleProject('study'), source = await createStudyProject(), privateDocument = createStudyPrivacyDocument('a')
      const scene = structuredClone(ordinary.document), baseLayer = Object.keys(scene.userLayers)[0]
      // Test-only fixture construction keeps the native layer/document model.
      // Ordinary shipped study remains free of GM geometry and fixed masks.
      scene.title = privateDocument.title
      scene.generationMetadata = structuredClone(privateDocument.generationMetadata)
      for (const collection of ['props', 'notes', 'regions'] as const) {
        for (const [id, entity] of Object.entries(privateDocument[collection]) as [string, any][]) {
          if (entity.visibility !== 'gm') continue
          scene[collection][id] = structuredClone(entity); scene.entityLayers[id] = baseLayer
        }
      }
      const bundle = toBundle(ordinary), content = createCompositionContent(scene, runtime)
      const native = await fromBundle({ project: { ...bundle.project, ...content }, resources: bundle.resources }, validation)
      const reference = { ...source, document: privateDocument }, before = JSON.stringify(toBundle(native).project)
      const project = projectScene(native.document, 'player'), gm = projectScene(native.document, 'gm')
      const playerJson = JSON.stringify(project), secret = privateDocument.notes['study-clue'], secretProp = privateDocument.props['study-envelope']
      const read = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
        canvas.width = bitmap.width; canvas.height = bitmap.height
        try {
          const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
          ctx.drawImage(bitmap, 0, 0)
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          const rgbaHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), n => n.toString(16).padStart(2, '0')).join('')
          const bounds = native.document.exportBoundsMm, x = Math.floor((3000 - bounds.x) / bounds.width * canvas.width), y = Math.floor((2700 - bounds.y) / bounds.height * canvas.height)
          return { width: canvas.width, height: canvas.height, rgbaHash, pixels, maskPixel: Array.from(ctx.getImageData(x, y, 1, 1).data) }
        } finally { bitmap.close(); canvas.width = canvas.height = 0 }
      }
      const outputs = []
      for (const audience of ['gm', 'player'] as const) {
        const old = await read(await exportPngV2(reference, { audience, longEdgePx: 4096 })), current = await read(await exportPng(toBundle(native), { audience, longEdgePx: 4096 }))
        let differingChannels = old.pixels.length === current.pixels.length ? 0 : Math.max(old.pixels.length, current.pixels.length)
        if (!differingChannels) for (let i = 0; i < current.pixels.length; i++) if (old.pixels[i] !== current.pixels[i]) differingChannels++
        outputs.push({ audience, width: current.width, height: current.height, referenceWidth: old.width, referenceHeight: old.height,
          nativeRgbaHash: current.rgbaHash, referenceRgbaHash: old.rgbaHash, differingChannels, maskPixel: current.maskPixel })
      }
      return { outputs, unchanged: before === JSON.stringify(toBundle(native).project),
        gmRetainsSecretProp: gm.props.some((prop: any) => prop.id === secretProp.id), gmRetainsSecretNote: gm.notes.some((note: any) => note.id === secret.id),
        playerOmitsSecretProp: !project.props.some((prop: any) => prop.id === secretProp.id), playerOmitsSecretNote: !project.notes.some((note: any) => note.id === secret.id),
        playerOmitsSecretText: !playerJson.includes(secret.text) && !playerJson.includes(secret.title), masks: project.masks.length }
    })
    await testInfo.attach('m20f-study-private-mask-4k-rgba.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
    expect(report.unchanged).toBe(true); expect(report.gmRetainsSecretProp).toBe(true); expect(report.gmRetainsSecretNote).toBe(true)
    expect(report.playerOmitsSecretProp).toBe(true); expect(report.playerOmitsSecretNote).toBe(true); expect(report.playerOmitsSecretText).toBe(true); expect(report.masks).toBe(1)
    for (const output of report.outputs) {
      expect(output.width).toBe(4096); expect(output.width).toBe(output.referenceWidth); expect(output.height).toBe(output.referenceHeight)
      expect(output.differingChannels).toBe(0); expect(output.nativeRgbaHash).toBe(output.referenceRgbaHash)
    }
    expect(report.outputs[1].maskPixel).toEqual([216, 213, 197, 255])
    expect(report.outputs[0].nativeRgbaHash).not.toBe(report.outputs[1].nativeRgbaHash)
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
