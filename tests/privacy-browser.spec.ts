import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('4K player PNG is pixel-identical across private edits and contains no private metadata', async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const evidence = await page.evaluate(async () => {
    const seedPath = '/src/core/seed.ts'
    const pngPath = '/src/rendering/png.ts'
    const projectionPath = '/src/rendering/projection.ts'
    const { createHouse } = await import(/* @vite-ignore */ seedPath) as typeof import('../src/core/seed')
    const { renderPng } = await import(/* @vite-ignore */ pngPath) as typeof import('../src/rendering/png')
    const { projectScene } = await import(/* @vite-ignore */ projectionPath) as typeof import('../src/rendering/projection')
    const base = createHouse('browser-private-pair')
    const changed = structuredClone(base)
    changed.vertices['v-g7'].yMm = 1800
    changed.vertices['v-h8'].yMm = 1800
    changed.openings['o-c3'].offsetMm = 1800
    changed.openings['o-c3'].widthMm = 1600
    changed.openings['o-c3'].state = 'open'
    changed.props['p-h8'].positionMm = { x: 9300, y: 3000 }
    changed.props['p-h8'].rotationDeg = 35
    changed.notes['n-c3'].text = '秘密剧情 changed-private-passage'
    changed.notes['n-d4'].text = 'different-private-answer: 仅主持人知道的不同答案'
    changed.revision = 9
    const { sourceRevision: ignoredBaseRevision, ...baseProjection } = projectScene(base, 'player')
    const { sourceRevision: ignoredChangedRevision, ...changedProjection } = projectScene(changed, 'player')
    const projectionIsEqual = JSON.stringify(baseProjection) === JSON.stringify(changedProjection)

    const pixels = async (blob: Blob) => {
      const image = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, image.width, image.height).data
      const dimensions = { width: image.width, height: image.height }
      image.close(); canvas.width = 1; canvas.height = 1
      return { data, ...dimensions }
    }
    const mismatchCount = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      if (a.length !== b.length) return -1
      let count = 0
      for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) count++
      return count
    }
    const a = await renderPng(base, 'player', { longEdge: 4096 })
    const b = await renderPng(changed, 'player', { longEdge: 4096 })
    const decodedA = await pixels(a.blob)
    const decodedB = await pixels(b.blob)
    const playerMismatchedChannels = mismatchCount(decodedA.data, decodedB.data)
    // A world-grid intersection inside the unknown northern area must be masked too.
    const maskX = Math.floor((3048 - base.exportBoundsMm.x) / base.exportBoundsMm.width * a.width)
    const maskY = Math.floor((0 - base.exportBoundsMm.y) / base.exportBoundsMm.height * a.height)
    const maskIndex = (maskY * a.width + maskX) * 4
    const maskPixel = Array.from(decodedA.data.slice(maskIndex, maskIndex + 4))
    let opaque = true
    for (let index = 3; index < decodedA.data.length; index += 4) if (decodedA.data[index] !== 255) { opaque = false; break }
    const gmA = await renderPng(base, 'gm', { longEdge: 1024 })
    const gmB = await renderPng(changed, 'gm', { longEdge: 1024 })
    const gmMismatchedChannels = mismatchCount((await pixels(gmA.blob)).data, (await pixels(gmB.blob)).data)

    const bytes = new Uint8Array(await a.blob.arrayBuffer())
    const view = new DataView(bytes.buffer)
    const chunkTypes: string[] = []
    let offset = 8
    let hasTrailingBytes = false
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset)
      if (offset + 12 + length > bytes.length) throw new Error('PNG chunk length exceeds file size')
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8))
      chunkTypes.push(type)
      offset += 12 + length
      if (type === 'IEND') { hasTrailingBytes = offset !== bytes.length; break }
    }
    const privateMarkers = ['changed-private-passage', 'different-private-answer', '旧账册的封底', '未寄出的信', 'SceneDocument', 'schemaVersion', 'generationMetadata', 'n-d4', 'p-h8', 'o-c3']
    const rawText = new TextDecoder().decode(bytes)
    const foundPrivateMarkers = privateMarkers.filter(marker => rawText.includes(marker))
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(a.blob)
    })
    return {
      projectionIsEqual, playerMismatchedChannels, gmMismatchedChannels, opaque, maskPixel,
      comparedSourceRevisions: [ignoredBaseRevision, ignoredChangedRevision],
      decoded: { width: decodedA.width, height: decodedA.height },
      encoded: { width: a.width, height: a.height },
      signature: Array.from(bytes.slice(0, 8)), chunkTypes, hasTrailingBytes, foundPrivateMarkers,
      exportObservation: { durationMs: a.durationMs, bytes: a.blob.size, sourceRevision: a.sourceRevision, longEdge: 4096, width: a.width, height: a.height, pixelsPerGrid: a.width / base.exportBoundsMm.width * base.units.gridSizeMm },
      browser: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio: window.devicePixelRatio, viewport: { width: innerWidth, height: innerHeight } },
      base64,
    }
  })
  expect(evidence.projectionIsEqual).toBe(true)
  expect(evidence.decoded).toEqual({ width: 4096, height: 3234 })
  expect(evidence.encoded).toEqual(evidence.decoded)
  expect(evidence.playerMismatchedChannels).toBe(0)
  expect(evidence.gmMismatchedChannels).toBeGreaterThan(0)
  expect(evidence.opaque).toBe(true)
  expect(evidence.maskPixel).toEqual([232, 223, 202, 255])
  expect(evidence.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(evidence.chunkTypes[0]).toBe('IHDR')
  expect(evidence.chunkTypes.at(-1)).toBe('IEND')
  expect(evidence.chunkTypes).toContain('IDAT')
  expect(evidence.chunkTypes.every(type => ['IHDR', 'IDAT', 'IEND', 'sRGB'].includes(type))).toBe(true)
  expect(evidence.chunkTypes.some(type => ['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(type))).toBe(false)
  expect(evidence.hasTrailingBytes).toBe(false)
  expect(evidence.foundPrivateMarkers).toEqual([])
  const { base64, ...details } = evidence
  const report={browserVersion:browser.version(),...details}
  await writeFile(testInfo.outputPath('player-4k.png'), Buffer.from(base64, 'base64'))
  await writeFile(testInfo.outputPath('privacy-and-export.json'), JSON.stringify(report, null, 2))
  await testInfo.attach('player-4k.png', { body: Buffer.from(base64, 'base64'), contentType: 'image/png' })
  await testInfo.attach('privacy-and-export.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
})

test('PNG encoding preserves the revision snapshot while public edits continue', async ({ page }, testInfo) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const seedPath = '/src/core/seed.ts'
    const pngPath = '/src/rendering/png.ts'
    const { createHouse } = await import(/* @vite-ignore */ seedPath) as typeof import('../src/core/seed')
    const { renderPng } = await import(/* @vite-ignore */ pngPath) as typeof import('../src/rendering/png')
    const pixels = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(bitmap, 0, 0)
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data
      bitmap.close(); canvas.width = 1; canvas.height = 1
      return data
    }
    const equalPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((channel, index) => channel === b[index])
    const scene = createHouse('stable-snapshot')
    scene.revision = 7
    const before = await renderPng(scene, 'player', { longEdge: 1024 })
    const inFlight = renderPng(scene, 'player', { longEdge: 1024 })
    scene.props['p-b2'].positionMm.x += 1000
    scene.notes['n-a1'].text = '已编辑的公开标题'
    scene.revision = 8
    const completed = await inFlight
    const after = await renderPng(scene, 'player', { longEdge: 1024 })
    const originalPixels = await pixels(before.blob)
    return {
      completedRevision: completed.sourceRevision, currentRevision: scene.revision,
      completedMatchesOriginal: equalPixels(originalPixels, await pixels(completed.blob)),
      changedSceneIsDifferent: !equalPixels(originalPixels, await pixels(after.blob)),
    }
  })
  expect(result.completedRevision).toBe(7)
  expect(result.currentRevision).toBe(8)
  expect(result.completedMatchesOriginal).toBe(true)
  expect(result.changedSceneIsDifferent).toBe(true)
  await testInfo.attach('stable-export-snapshot.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})

test('unsafe player masks fail without changing the active document', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const seedPath = '/src/core/seed.ts'
    const pngPath = '/src/rendering/png.ts'
    const { createHouse } = await import(/* @vite-ignore */ seedPath) as typeof import('../src/core/seed')
    const { renderPng } = await import(/* @vite-ignore */ pngPath) as typeof import('../src/rendering/png')
    const scene = createHouse('unsafe-mask')
    scene.regions = {}
    const before = JSON.stringify(scene)
    let errorMessage = ''
    try { await renderPng(scene, 'player') } catch (error) { errorMessage = error instanceof Error ? error.message : String(error) }
    return { errorMessage, unchanged: before === JSON.stringify(scene) }
  })
  expect(result.errorMessage).toContain('玩家导出不安全')
  expect(result.errorMessage).toContain('遮罩未覆盖')
  expect(result.unchanged).toBe(true)
})
