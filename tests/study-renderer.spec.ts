import { expect, test } from '@playwright/test'

test('B2 actual bitmap renderer: fixed 4K bounds, private pair pixels, and PNG metadata', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/#assets')
  const result = await page.evaluate(async () => {
    const samplePath = '/src/editor/v2/study-sample.ts', renderPath = '/src/render/v2/renderer.ts'
    const { createStudyProject, createStudyPrivacyDocument } = await import(samplePath)
    const { exportPngV2 } = await import(renderPath)
    const project = await createStudyProject(), options = { audience: 'player', longEdgePx: 4096 }
    const output = await exportPngV2(project, options), decoded = await createImageBitmap(output)
    const size = { width: decoded.width, height: decoded.height, bytes: output.size }; decoded.close()
    const chunks: string[] = [], bytes = new Uint8Array(await output.arrayBuffer()); let offset = 8
    while (offset < bytes.length) { const length = new DataView(bytes.buffer, offset, 4).getUint32(0); chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset += length + 12 }
    const encoded = async (blob: Blob) => { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary) }
    const digest = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close()
      const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); canvas.width = canvas.height = 0; return hash
    }
    const player: string[] = [], gm: string[] = [], metrics: { variant: string; audience: string; bytes: number; ms: number }[] = [], images: Record<string, string> = { 'baseline-player': await encoded(output) }
    const baselineGm = await exportPngV2(project, { audience: 'gm', longEdgePx: 4096 }); images['baseline-gm'] = await encoded(baselineGm)
    const baselineBitmap = await createImageBitmap(baselineGm)
    const nearViews = [{ name: 'diagonal-window', x: 6000, y: 0 }, { name: 'study-desk', x: 1500, y: 1500 }, { name: 'door-terrace', x: 8000, y: 3000 }]
    for (const view of nearViews) {
      const crop = document.createElement('canvas'); crop.width = 1024; crop.height = 768
      crop.getContext('2d')!.drawImage(baselineBitmap, view.x / 14000 * baselineBitmap.width, view.y / 10000 * baselineBitmap.height, 4000 / 14000 * baselineBitmap.width, 3000 / 10000 * baselineBitmap.height, 0, 0, 1024, 768)
      const png = await new Promise<Blob>(resolve => crop.toBlob(value => resolve(value!), 'image/png')); images[`near-${view.name}-256px-per-m`] = await encoded(png); crop.width = crop.height = 0
    }
    baselineBitmap.close()
    for (const variant of ['a', 'b']) {
      const copy = { ...project, document: createStudyPrivacyDocument(variant) }
      for (const audience of ['player', 'gm']) {
        const started = performance.now(), png = await exportPngV2(copy, { audience, longEdgePx: 4096 })
        metrics.push({ variant, audience, bytes: png.size, ms: performance.now() - started }); (audience === 'player' ? player : gm).push(await digest(png))
        if (variant === 'a') images[audience] = await encoded(png)
      }
    }
    const repeatPlayer = await digest(await exportPngV2({ ...project, document: createStudyPrivacyDocument('a') }, options))
    return { size, chunks, player, gm, repeatPlayer, metrics, nearViews: { worldWidthMm: 4000, worldHeightMm: 3000, outputWidthPx: 1024, outputHeightPx: 768, method: 'resampled fixed world crop from 4096x2926 full PNG', views: nearViews }, images }
  })
  expect(result.size.width).toBe(4096); expect(result.size.height).toBe(2926); expect(result.size.bytes).toBeGreaterThan(10000)
  expect(result.chunks.filter(c => ['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(c))).toEqual([])
  expect(result.player[0]).toBe(result.player[1]); expect(result.repeatPlayer).toBe(result.player[0]); expect(result.gm[0]).not.toBe(result.gm[1])
  for (const [name, base64] of Object.entries(result.images)) await testInfo.attach(`b2-${name}${name.startsWith('near-') ? '' : '-4096'}.png`, { body: Buffer.from(base64, 'base64'), contentType: 'image/png' })
  const { images: _images, ...metrics } = result
  await testInfo.attach('b2-real-render-privacy.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' })
})

test('B2 real floor phase and diagonal window are independent of bounds edits and wall direction', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/#assets')
  const result = await page.evaluate(async () => {
    const samplePath = '/src/editor/v2/study-sample.ts', renderPath = '/src/render/v2/renderer.ts'
    const { createStudyProject, STUDY_IDS } = await import(samplePath), { renderProjectV2 } = await import(renderPath)
    const project = await createStudyProject()
    const digest = async (canvas: HTMLCanvasElement, patch = false) => {
      const bytes = patch ? canvas.getContext('2d')!.getImageData(650, 200, 50, 100).data : canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); canvas.width = canvas.height = 0; return hash
    }
    const render = (document: typeof project.document, audience = 'gm') => renderProjectV2({ ...project, document }, { audience, longEdgePx: 1400 })
    const baselinePatch = await digest(await render(project.document), true), moved = structuredClone(project.document)
    moved.vertices['study-v0'].xMm = 750
    const movedPatch = await digest(await render(moved), true), rotated = structuredClone(moved)
    rotated.rooms[STUDY_IDS.room].floorStyle.base.rotationDeg = 90
    const rotatedPatch = await digest(await render(rotated), true)
    const beforeReverse = await digest(await render(project.document)), reverse = structuredClone(project.document), wall = reverse.walls['study-w1']
    ;[wall.startVertexId, wall.endVertexId] = [wall.endVertexId, wall.startVertexId]
    const afterReverse = await digest(await render(reverse))
    const secret = structuredClone(project.document); secret.openings['diagonal-window'].secret = true
    const concealed = await digest(await render(secret, 'player')), solid = structuredClone(project.document); delete solid.openings['diagonal-window']
    const solidWall = await digest(await render(solid, 'player'))
    return { baselinePatch, movedPatch, rotatedPatch, beforeReverse, afterReverse, concealed, solidWall }
  })
  expect(result.baselinePatch).toBe(result.movedPatch); expect(result.rotatedPatch).not.toBe(result.movedPatch)
  expect(result.afterReverse).toBe(result.beforeReverse); expect(result.concealed).toBe(result.solidWall)
  await testInfo.attach('b2-real-render-geometry-material.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})

test('B2 player skips private-only bytes; required failures reject and cancellation closes the actual bitmap', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/#assets')
  const result = await page.evaluate(async () => {
    const samplePath = '/src/editor/v2/study-sample.ts', renderPath = '/src/render/v2/renderer.ts'
    const { createStudyProject, createStudyPrivacyDocument } = await import(samplePath), { renderProjectV2 } = await import(renderPath)
    const project = await createStudyProject(), privateDocument = createStudyPrivacyDocument('a'), privateProp = privateDocument.props['study-envelope'], hash = privateDocument.assets[privateProp.appearance.assetId].sha256
    const privateMissing = { ...project, document: privateDocument, assets: { ...project.assets } }; delete privateMissing.assets[hash]
    const player = await renderProjectV2(privateMissing, { audience: 'player', longEdgePx: 512 }); player.width = player.height = 0
    let gmError = '', requiredError = '', cancelName = '', decoded = 0, closed = 0
    try { await renderProjectV2(privateMissing, { audience: 'gm', longEdgePx: 512 }) } catch (error) { gmError = String(error) }
    const broken = { ...project, assets: { ...project.assets } }, requiredHash = project.document.assets[project.document.materials['b2-m-01'].textureAssetId].sha256
    const badBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }); broken.assets[requiredHash] = { ...broken.assets[requiredHash], blob: badBlob, sizeBytes: badBlob.size }
    try { await renderProjectV2(broken, { audience: 'gm', longEdgePx: 512 }) } catch (error) { requiredError = String(error) }
    const original = window.createImageBitmap.bind(window), controller = new AbortController()
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      const bitmap = await original(source, options); decoded++
      const close = bitmap.close.bind(bitmap); bitmap.close = () => { closed++; close() }
      controller.abort(); return bitmap
    }) as typeof createImageBitmap
    try { await renderProjectV2(project, { audience: 'gm', longEdgePx: 512, signal: controller.signal }) } catch (error) { cancelName = error instanceof DOMException ? error.name : String(error) }
    finally { window.createImageBitmap = original }
    return { gmError, requiredError, cancelName, decoded, closed }
  })
  expect(result.gmError).toContain('缺失'); expect(result.requiredError).toMatch(/PNG|格式|无效/)
  expect(result.cancelName).toBe('AbortError'); expect(result.decoded).toBe(1); expect(result.closed).toBe(1)
  await testInfo.attach('b2-real-render-failure-cleanup.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})

test('B2 alpha shadow remains southeast through four body rotations', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/#assets')
  const observations = await page.evaluate(async () => {
    const samplePath = '/src/editor/v2/study-sample.ts', renderPath = '/src/render/v2/renderer.ts'
    const { createStudyProject } = await import(samplePath), { renderProjectV2 } = await import(renderPath)
    const project = await createStudyProject(), scene = structuredClone(project.document)
    const chair = Object.values(scene.props).find((p: any) => p.definitionRef && scene.propDefinitions[p.definitionRef.id].catalogId === 'prop.sw.chair-oak') as any
    if (!chair) throw new Error('测试需样板木椅。')
    scene.rooms = {}; scene.vertices = {}; scene.walls = {}; scene.openings = {}; scene.notes = {}; scene.regions = {}; scene.terrainAreas = {}; scene.prefabInstances = {}; scene.scatterGroups = {}; scene.constraints.entranceOpeningIds = []
    chair.id = 'isolated-chair'; chair.positionMm = { x: 7000, y: 5000 }; chair.supportRef = { kind: 'floor', id: 'study-floor' }; delete chair.roomId; chair.shadowClass = 'none'; scene.props = { [chair.id]: chair }
    const observations: { rotation: number; dx: number; dy: number; bodyPixels: number; shadowPixels: number }[] = []
    for (const rotation of [0, 90, 180, 270]) {
      chair.rotationDeg = rotation; chair.shadowOverride = { directionDeg: 45, offsetMm: 2000, blurMm: 0, opacity: 0, color: '#24313A' }
      const plain = await renderProjectV2({ ...project, document: scene }, { audience: 'gm', longEdgePx: 1400 }), plainData = plain.getContext('2d')!.getImageData(0, 0, plain.width, plain.height).data
      chair.shadowOverride.opacity = .6
      const shadowed = await renderProjectV2({ ...project, document: scene }, { audience: 'gm', longEdgePx: 1400 }), shadowData = shadowed.getContext('2d')!.getImageData(0, 0, shadowed.width, shadowed.height).data
      let bx = 0, by = 0, bn = 0, sx = 0, sy = 0, sn = 0
      for (let i = 0; i < plainData.length; i += 4) {
        const x = (i / 4) % plain.width, y = Math.floor(i / 4 / plain.width)
        if (Math.abs(plainData[i] - 216) + Math.abs(plainData[i + 1] - 213) + Math.abs(plainData[i + 2] - 197) > 12) { bx += x; by += y; bn++ }
        if (Math.abs(plainData[i] - shadowData[i]) + Math.abs(plainData[i + 1] - shadowData[i + 1]) + Math.abs(plainData[i + 2] - shadowData[i + 2]) > 12) { sx += x; sy += y; sn++ }
      }
      observations.push({ rotation, dx: sx / sn - bx / bn, dy: sy / sn - by / bn, bodyPixels: bn, shadowPixels: sn }); plain.width = plain.height = shadowed.width = shadowed.height = 0
    }
    return observations
  })
  for (const item of observations) { expect(item.bodyPixels).toBeGreaterThan(500); expect(item.shadowPixels).toBeGreaterThan(500); expect(Math.abs(item.dx - 200 / Math.SQRT2)).toBeLessThan(2); expect(Math.abs(item.dy - 200 / Math.SQRT2)).toBeLessThan(2) }
  await testInfo.attach('b2-real-alpha-shadow-rotations.json', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' })
})
