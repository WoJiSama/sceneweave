import { expect, test } from '@playwright/test'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'

for (const sample of [
  { mode: 'height', outline: 'coastal' }, { mode: 'natural', outline: 'coastal' }, { mode: 'natural', outline: 'headland' },
  { mode: 'layered', outline: 'coastal' }, { mode: 'layered', outline: 'headland' },
  { mode: 'sculpted', outline: 'coastal' }, { mode: 'sculpted', outline: 'headland' },
] as const) test(`${sample.mode}/${sample.outline} independent full coastal scene preserves height ownership, curved stairs, privacy, crop and cold pixels`, async ({ page, context }, info) => {
  const { mode, outline } = sample
  test.setTimeout(240000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const result = await page.evaluate(async ({ mode, outline }) => {
    const fixturePath = '/tools/testing/terrain-cliff-fixtures.ts', artPath = '/src/platform/browser/content/visual-art-project.ts',
      samplesPath = '/src/shared/visual/sample-art.ts', projectPath = '/src/application/workspace/project.ts',
      rendererPath = '/src/platform/browser/render/renderer.ts', projectionPath = '/src/shared/projection/projection.ts',
      filePath = '/src/shared/project/file.ts', validationPath = '/src/platform/browser/project-validation.ts',
      jsonPath = '/src/shared/validation/json.ts', planPath = '/src/shared/visual/terrain-cliff-plan.ts'
    const { terrainCliffFixture } = await import(fixturePath), { materializeVisualArt } = await import(artPath),
      { VISUAL_SAMPLE_ART, VISUAL_SAMPLE_LICENSE } = await import(samplesPath), { toBundle } = await import(projectPath),
      { exportPng, exportPublicViewportPng } = await import(rendererPath), { projectScene } = await import(projectionPath),
      { exportProject } = await import(filePath), { browserProjectValidation } = await import(validationPath),
      { canonicalJson } = await import(jsonPath), { planTerrainCliffs } = await import(planPath)
    const base64 = (bytes: Uint8Array) => { let result = ''; for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(result) }
    const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
    const image = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bitmap, 0, 0); bitmap.close()
      return { canvas, rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
    }
    const differences = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      if (a.length !== b.length) throw new Error('Compared image sizes differ')
      let count = 0, max = 0
      for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); if (delta) count++; max = Math.max(max, delta) }
      return { count, max }
    }
    const first = await materializeVisualArt(terrainCliffFixture(0, mode, outline), VISUAL_SAMPLE_ART, VISUAL_SAMPLE_LICENSE, (key: string) => `visual-art-${key}`)
    const changed = await materializeVisualArt(terrainCliffFixture(1, mode, outline), VISUAL_SAMPLE_ART, VISUAL_SAMPLE_LICENSE, (key: string) => `visual-art-${key}`)
    const bundle = toBundle(first), alternate = toBundle(changed)
    const projection = projectScene(first.document, 'player', first.appearance), privateProjection = projectScene(changed.document, 'player', changed.appearance)
    const fullBlob = await exportPng(bundle, { audience: 'player', longEdgePx: 1500 }), full = await image(fullBlob)
    const gmBlob = await exportPng(bundle, { audience: 'gm', longEdgePx: 1500 }), gm = await image(gmBlob)
    const privateBlob = await exportPng(alternate, { audience: 'player', longEdgePx: 1500 }), privateImage = await image(privateBlob)
    const changedGm = await image(await exportPng(alternate, { audience: 'gm', longEdgePx: 1500 }))
    const cropBounds = { x: 12000, y: 2000, width: 14000, height: 12000 }
    const cropBlob = await exportPublicViewportPng(bundle, cropBounds, 700), crop = await image(cropBlob)
    const fullPart = full.canvas.getContext('2d', { willReadFrequently: true })!.getImageData(600, 100, 700, 600).data
    const cropDifference = differences(fullPart, crop.rgba)
    const route = projection.connections.find((connection: { id: string }) => connection.id === 'independent-public-climb')!.route!
    const faces: { highId: string | null; lowId: string | null; highMm: number; lowMm: number; rings: { x: number; y: number }[][] }[] = planTerrainCliffs(projection).map((face: { highId: string | null; lowId: string | null; highMm: number; lowMm: number; rings: { x: number; y: number }[][] }) => ({
      highId: face.highId, lowId: face.lowId, highMm: face.highMm, lowMm: face.lowMm, rings: face.rings }))
    const archive = await exportProject(bundle, browserProjectValidation)
    return { publicProjectionEqual: canonicalJson(projection) === canonicalJson(privateProjection),
      privateDifference: differences(full.rgba, privateImage.rgba), changedGmDifference: differences(gm.rgba, changedGm.rgba),
      cropDifference, route: { profile: route.renderProfile, points: route.centerlineMm }, faces,
      dimensions: { width: full.canvas.width, height: full.canvas.height },
      png: base64(await bytes(fullBlob)), gmPng: base64(await bytes(gmBlob)), cropPng: base64(await bytes(cropBlob)), archive: base64(archive) }
  }, { mode, outline })
  await info.attach('independent-coastal-full-player.png', { body: Buffer.from(result.png, 'base64'), contentType: 'image/png' })
  await info.attach('independent-coastal-full-gm.png', { body: Buffer.from(result.gmPng, 'base64'), contentType: 'image/png' })
  await info.attach('independent-coastal-stair-junction.png', { body: Buffer.from(result.cropPng, 'base64'), contentType: 'image/png' })
  await info.attach('independent-coastal-native.sceneweave', { body: Buffer.from(result.archive, 'base64'), contentType: 'application/octet-stream' })
  // A new page has no in-memory source project or certified byte closures.
  const cold = await context.newPage(); cold.on('pageerror', error => errors.push(error.message)); await cold.goto('/')
  const reopened = await cold.evaluate(async ({ archive, expectedPng }) => {
    const filePath = '/src/shared/project/file.ts', validationPath = '/src/platform/browser/project-validation.ts', rendererPath = '/src/platform/browser/render/renderer.ts'
    const { importProject } = await import(filePath), { browserProjectValidation } = await import(validationPath), { exportPng } = await import(rendererPath)
    const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))
    const bundle = await importProject(decode(archive), browserProjectValidation)
    const actual = new Uint8Array(await (await exportPng(bundle, { audience: 'player', longEdgePx: 1500 })).arrayBuffer()), expected = decode(expectedPng)
    let differences = Math.abs(actual.length - expected.length)
    for (let i = 0; i < Math.min(actual.length, expected.length); i++) if (actual[i] !== expected[i]) differences++
    return { byteDifferences: differences, sceneId: bundle.project.document.sceneId,
      profile: bundle.project.document.terrainConnections['independent-public-climb'].route?.renderProfile,
      gridSizeMm: bundle.project.document.units.gridSizeMm }
  }, { archive: result.archive, expectedPng: result.png })
  await cold.close()
  const polygons = result.faces.map(face => {
    const rings = face.rings.map(ring => [ring.map(p => [p.x, p.y])] as Polygon)
    return polygonClipping.xor(rings[0], ...rings.slice(1))
  })
  const area = (polygons: MultiPolygon) => polygons.reduce((sum, polygon) => sum + polygon.reduce((total, ring, index) => {
    const value = Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0) / 2)
    return total + (index ? -value : value)
  }, 0), 0)
  let maximumOverlapMm2 = 0
  for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) {
    maximumOverlapMm2 = Math.max(maximumOverlapMm2, area(polygonClipping.intersection(polygons[i], polygons[j])))
  }
  const report = { ...result, png: undefined, gmPng: undefined, cropPng: undefined, archive: undefined,
    faces: result.faces.map(({ rings: _rings, ...face }) => face), reopened, maximumOverlapMm2, errors }
  await info.attach('full-native-scene-checks.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  expect(result.dimensions).toEqual({ width: 1500, height: 1200 })
  expect(result.publicProjectionEqual).toBe(true); expect(result.privateDifference.count).toBe(0)
  expect(result.changedGmDifference.count).toBeGreaterThan(1000)
  expect(result.cropDifference.count).toBe(0)
  expect(maximumOverlapMm2).toBeLessThan(1)
  expect(result.faces.some(face => face.highMm === (outline === 'headland' ? 5600 : 4200) && face.lowMm === 0)).toBe(true)
  expect(result.faces.some(face => face.highMm === (outline === 'headland' ? 5600 : 4200) && face.lowMm === (outline === 'headland' ? 3100 : 2200))).toBe(true)
  expect(result.route.profile).toBe(mode === 'sculpted' ? 'naturalRockSteps8' : mode === 'layered' ? 'naturalRockSteps7' : mode === 'natural' ? 'naturalRockSteps6' : 'naturalRockSteps5'); expect(result.route.points.length).toBeGreaterThan(20)
  expect(reopened.byteDifferences).toBe(0); expect(reopened.profile).toBe(mode === 'sculpted' ? 'naturalRockSteps8' : mode === 'layered' ? 'naturalRockSteps7' : mode === 'natural' ? 'naturalRockSteps6' : 'naturalRockSteps5'); expect(reopened.gridSizeMm).toBe(1500)
  expect(errors).toEqual([])
})
