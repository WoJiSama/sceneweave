import { describe, expect, it } from 'vitest'
import { landscapeLandmarks, shapeLandscapeCandidate } from '../../application/workspace/landscape-map.js'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { pointInPolygon, terrainPoints } from '../geometry/geometry.js'
import { referenceTerrainPixels, guide } from './map-reference.test-fixture.js'
import { mapDimensions } from './map-authoring.js'
import { traceMapReference } from './map-reference.js'

describe('local map reference tracing', () => {
  it('fits an open inlet, cropped edge, offshore island and explicitly sampled inland water', () => {
    const image = referenceTerrainPixels(), result = traceMapReference(image, guide)
    expect(traceMapReference(image, guide)).toEqual(result)
    expect(result.regions.map(row => row.id)).toEqual(['main', 'land-2'])
    const outline = result.regions[0].boundary
    expect(outline.length).toBeLessThan(result.regions[0].rawPoints)
    expect(outline.some(p => p.y === 0)).toBe(true)
    expect(pointInPolygon({ x: 103, y: 71 }, outline)).toBe(false)
    expect(pointInPolygon({ x: 69, y: 67 }, outline)).toBe(true)
    expect(result.lakes).toHaveLength(1)
    const { request } = result
    if (request.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const palette = createShoreBlankDocument('coast', { ...mapDimensions(request), title: request.title, preset: 'narrative' }, false, false, 'naturalStone')
    const floor = Object.values(palette.floors)[0]
    const review = shapeLandscapeCandidate(palette, floor, request, request.recipe, taskBudgetProfile('standard'))
    const saved = review.document.terrainAreas
    const water = terrainPoints(saved['landscape/water'])
    expect(water.filter(p => p.y === 0).length).toBeGreaterThan(2)
    expect(saved[result.lakes[0].id]).toMatchObject({ blocksMovement: true, coveragePriority: 2 })
    expect(saved.main.reliefFinish).toBe('weathered-v3')
    expect(saved.main.groundElevationMm).toBe(0)
    expect(Object.values(review.document.terrainEdges)).toContainEqual(expect.objectContaining({
      source: expect.objectContaining({ areaId: 'main' }), neighborAreaId: 'landscape/water', kind: 'shore', shoreline: true,
    }))
    expect(saved['landscape/water'].blocksMovement).toBe(true)
  })

  it('honors omissions and rejects contradictory or out-of-image samples', () => {
    const image = referenceTerrainPixels()
    const withoutIsland = traceMapReference(image, { ...guide, foreground: [], omit: [{ x: 143, y: 66 }] })
    expect(withoutIsland.regions.map(row => row.id)).toEqual(['main'])
    const bad = [{ x: image.width, y: 1 }]
    expect(() => traceMapReference(image, { ...guide, background: bad })).toThrow('原图像素')
    expect(() => traceMapReference(image, { ...guide, foreground: [guide.background[0]] })).toThrow('同时标为')
  })

  it('applies local land and water strokes before fitting the editable outline', () => {
    const image = referenceTerrainPixels()
    const original = traceMapReference(image, guide).regions[0].boundary
    const reference = traceMapReference(image, { ...guide, corrections: [
      { kind: 'land', radiusPx: 8, points: [{ x: 79, y: 67 }, { x: 99, y: 67 }] },
      { kind: 'background', radiusPx: 7, points: [{ x: 6, y: 36 }, { x: 33, y: 36 }] },
    ] })
    const updated = reference.regions[0].boundary
    expect(pointInPolygon({ x: 96, y: 67 }, original)).toBe(false)
    expect(pointInPolygon({ x: 96, y: 67 }, updated)).toBe(true)
    expect(pointInPolygon({ x: 30, y: 36 }, original)).toBe(true)
    expect(pointInPolygon({ x: 30, y: 36 }, updated)).toBe(false)
  })

  it('lets a correction cover a sample and keeps an explicitly painted little island', () => {
    const image = referenceTerrainPixels()
    const result = traceMapReference(image, { ...guide, corrections: [
      { kind: 'background', radiusPx: 12, points: [guide.foreground[0]] },
      { kind: 'land', radiusPx: 2, points: [{ x: 145, y: 42 }] },
    ] })
    expect(result.regions).toHaveLength(2)
    expect(pointInPolygon(guide.foreground[0], result.regions[1].boundary)).toBe(false)
    expect(pointInPolygon({ x: 145, y: 42 }, result.regions[1].boundary)).toBe(true)
  })

  it('keeps a local land hint out of the palette, flags a distant background sample and assigns vegetation to native regions', () => {
    const image = referenceTerrainPixels()
    for (let y = 15; y < 47; y++) for (let x = 36; x < 83; x++) {
      image.data.set(x > 60 && y > 25 ? [70, 125, 81, 255] : [154, 187, 110, 255], (y * image.width + x) * 4)
    }
    const outlier = { x: 71, y: 38 }
    const result = traceMapReference(image, { background: [...guide.background, { x: 4, y: 22 }, { x: 142, y: 17 }, outlier],
      keep: guide.foreground, design: {
        landforms: [{ id: 'ridge', at: { x: 73, y: 29 }, shape: 'ridge', elevationMm: 4600 }],
        ascents: [{ id: 'approach', from: { x: 46, y: 53 }, to: 'ridge', widthMm: 1700, around: 'north' }],
      } })
    expect(result.issues).toContainEqual(expect.objectContaining({ at: outlier, kind: 'sample' }))
    expect(result.automaticSurface).toEqual({ grassPatches: 1, groves: 1 })
    expect(result.regions[1]).toMatchObject({ id: 'land-2', kept: true })
    expect(result.request.recipe).toMatchObject({
      covers: [{ areaId: 'main', cover: 'grass' }], scenery: [{ areaId: 'main', palette: 'woodland' }],
      landforms: [{ id: 'ridge', areaId: 'main' }],
      routes: [{ id: 'approach', areaId: 'main', widthMm: 1700, around: { landmarkId: 'ridge', side: 'north' } }],
    })
    expect(traceMapReference(image, { ...guide, surfaceFromReference: false }).automaticSurface).toEqual({ grassPatches: 0, groves: 0 })
  })

  it('returns locatable design issues with the valid outline', () => {
    const invalid = { x: 151, y: 30 }
    const result = traceMapReference(referenceTerrainPixels(), { ...guide, design: {
      landforms: [{ id: 'wrong', at: invalid, shape: 'hill', elevationMm: 3800 }],
      ascents: [{ id: 'missing-goal', from: { x: 72, y: 31 }, to: 'wrong' }],
      shallows: [{ id: 'landlocked', boundary: [{ x: 57, y: 20 }, { x: 69, y: 20 }, { x: 69, y: 30 }, { x: 57, y: 30 }] }],
    } })
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'design', id: 'wrong', at: invalid }),
      expect.objectContaining({ kind: 'design', id: 'missing-goal' }),
      expect.objectContaining({ kind: 'design', id: 'landlocked', at: { x: 57, y: 20 } }),
    ]))
    expect(result.regions).toHaveLength(2)
    expect(result.request.recipe).toMatchObject({ landforms: [], routes: [] })
  })

  it('keeps dark coastal land when a water shade sits between the main water and mislabeled cliff samples', () => {
    const image = referenceTerrainPixels()
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4
      if (image.data[index + 2] === 177) {
        image.data.set(x >= 125 && y >= 18 && y <= 45 ? [53, 116, 145, 255] : [160, 224, 232, 255], index)
      } else if (x >= 100 && x < 125 && y >= 18 && y <= 45) image.data.set([49, 74, 104, 255], index)
    }
    const waterShade = { x: 137, y: 30 }, cliff = [{ x: 111, y: 24 }, { x: 114, y: 39 }]
    const result = traceMapReference(image, { ...guide, background: [...guide.background,
      { x: 4, y: 18 }, { x: 6, y: 77 }, { x: 150, y: 95 }, waterShade, ...cliff] })
    const main = result.regions.find(row => row.id === 'main')!
    expect(cliff.every(p => pointInPolygon(p, main.boundary))).toBe(true)
    expect(pointInPolygon(waterShade, main.boundary)).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining(cliff.map(at => expect.objectContaining({ at, kind: 'sample' }))))
  })

  it('keeps a pale bay connected and saves shallows, a dry strand and rocky relief as native geometry', () => {
    const image = referenceTerrainPixels()
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      let rgb: number[] | undefined
      if (x > 84 && x < 126 && y > 55 && y < 83) rgb = x < 104 ? [179, 194, 174] : [118, 169, 162]
      if (x > 14 + Math.floor(y / 6) && x < 21 + Math.floor(y / 6) && y > 24 && y < 72) rgb = [228, 215, 182]
      if (x > 34 && x < 77 && y > 31 && y < 66) rgb = [218, 224, 191]
      if (Math.hypot((x - 62) / 1.15, y - 47) < 8 || Math.hypot(x - 140, y - 22) < 4) rgb = [175, 146, 116]
      if (rgb) image.data.set([...rgb, 255], (y * image.width + x) * 4)
    }
    const results = traceMapReference(image, { ...guide, keep: [{ x: 140, y: 22 }], design: { landforms: [
      { id: 'shelf', at: { x: 47, y: 52 }, radius: { x: 38, y: 30 }, shape: 'lowland', elevationMm: 400 },
    ] } })
    const bay = { x: 94, y: 70 }
    expect(results.regions.some(row => pointInPolygon(bay, row.boundary))).toBe(false)
    expect(results.coastFeatures.shallows.some(row => pointInPolygon(bay, row.boundary))).toBe(true)
    const { reefs, outcrops, dryStrands } = results.coastFeatures
    expect(dryStrands).toBeGreaterThan(0)
    expect(reefs).toHaveLength(1)
    expect(outcrops).toHaveLength(1)
    const { request } = results
    if (request.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const palette = createShoreBlankDocument('coast', { ...mapDimensions(request), title: request.title, preset: 'narrative' }, false, false, 'naturalStone')
    const floor = Object.values(palette.floors)[0]
    const { document } = shapeLandscapeCandidate(palette, floor, request, request.recipe, taskBudgetProfile('standard'))
    const sea = document.terrainAreas['landscape/water']
    expect(sea.blocksMovement).toBe(true)
    expect(sea.surfaceStyle!.overlays.some(row => row.id.startsWith('landscape/shallow/'))).toBe(true)
    expect(document.terrainAreas[reefs[0]].reliefFinish).toBe('weathered-v3')
    const landmarks = landscapeLandmarks(document, floor, request)
    expect(landmarks.find(row => row.id === 'shelf')).toMatchObject({ actualElevationMm: 400, issue: undefined })
    const rock = landmarks.find(row => row.id === outcrops[0])!
    expect(rock.actualElevationMm).toBeGreaterThan(1900)
    expect(rock.riseMm).toBeGreaterThan(500)
  })

  it('keeps a dry sand tongue beside open shallows and limits a blue cliff sample to its own shore', () => {
    const image = referenceTerrainPixels()
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4
      if (x >= 85 && x < 125 && y >= 65 && y <= 78) {
        const color = x < 95 ? [164, 188, 164] : x < 104 ? [170, 191, 171] : [116, 167, 160]
        image.data.set([...color, 255], index)
      } else if (x >= 113 && x < 125 && y >= 20 && y < 43) image.data.set([62, 104, 131, 255], index)
      else if (image.data[index + 2] === 177) image.data.set(x >= 125 && y >= 20 && y < 43 ? [48, 104, 130, 255] : [165, 224, 230, 255], index)
    }
    const cliff = { x: 119, y: 30 }
    const result = traceMapReference(image, { ...guide, background: [{ x: 151, y: 13 }, guide.background[1]],
      foreground: [...guide.foreground, cliff] })
    const main = result.regions[0].boundary
    expect(pointInPolygon({ x: 92, y: 71 }, main)).toBe(true)
    expect(pointInPolygon({ x: 106, y: 71 }, main)).toBe(false)
    expect(pointInPolygon(cliff, main)).toBe(true)
    expect(pointInPolygon({ x: 132, y: 30 }, main)).toBe(false)
    expect(result.regions.find(row => pointInPolygon(guide.foreground[0], row.boundary))?.id).not.toBe('main')
  })

  it('uses a continuous asymmetric plateau and a distinct ridge in an upland reference', () => {
    const image = referenceTerrainPixels()
    const outline = [{ x: 40, y: 22 }, { x: 63, y: 17 }, { x: 82, y: 23 }, { x: 84, y: 33 },
      { x: 63, y: 33 }, { x: 61, y: 48 }, { x: 39, y: 43 }]
    for (let y = 3; y < 52; y++) for (let x = 32; x < 119; x++) {
      const plateau = pointInPolygon({ x, y }, outline)
      const ridge = y >= 12 && y <= 48 && Math.abs(x - 101 - (y - 30) * .26) < 5
      const pixel = plateau || ridge ? [223, 200, 158, 255] : x < 41 ? [210, 194, 153, 255] : [149, 123, 92, 255]
      image.data.set(pixel, (y * image.width + x) * 4)
    }
    const { request, coastFeatures } = traceMapReference(image, { ...guide, environment: 'upland', design: { landforms: [
      { id: 'terrace', at: { x: 53, y: 28 }, radius: { x: 38, y: 27 }, shape: 'plateau', elevationMm: 5600 },
      { id: 'crest', at: { x: 101, y: 31 }, radius: { x: 16, y: 28 }, shape: 'ridge', elevationMm: 3100 },
    ] } })
    expect(coastFeatures.shallows).toHaveLength(0)
    if (request.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const [terrace, crest] = request.recipe.landforms
    expect(terrace.structure).toMatchObject({ kind: 'area' })
    if (terrace.structure?.kind !== 'area') throw new Error('Expected a plateau outline')
    expect(pointInPolygon({ x: 72, y: 27 }, terrace.structure.boundary)).toBe(true)
    expect(pointInPolygon({ x: 75, y: 47 }, terrace.structure.boundary)).toBe(false)
    expect(terrace.structure.breakline?.length).toBeGreaterThanOrEqual(2)
    expect(crest.structure).toMatchObject({ kind: 'ridge' })
    const palette = createShoreBlankDocument('coast', { ...mapDimensions(request), title: request.title, preset: 'narrative' }, false, false, 'naturalStone')
    const floor = Object.values(palette.floors)[0]
    const { document } = shapeLandscapeCandidate(palette, floor, request, request.recipe, taskBudgetProfile('standard'))
    expect(landscapeLandmarks(document, floor, request)).toMatchObject([
      { id: 'terrace', actualElevationMm: 5600 }, { id: 'crest', actualElevationMm: 3100 },
    ])
  })

  it('raises the coast only where a continuous shaded cliff leads to a dry crest', () => {
    const image = referenceTerrainPixels()
    for (let y = 30; y < 70; y++) {
      const bank = 14 + Math.floor(y / 6)
      for (let dx = 0; dx < 19; dx++) {
        image.data.set(dx < 7 ? [89, 104, 133, 255] : [211, 196, 149, 255], (y * image.width + bank + dx) * 4)
      }
    }
    const result = traceMapReference(image, { ...guide, design: { landforms: [
      { id: 'marked', at: { x: 100, y: 23 }, radius: { x: 25, y: 20 }, shape: 'plateau', elevationMm: 4700 },
    ] } })
    expect(result.coastFeatures.cliffs).toHaveLength(1)
    const { request } = result
    if (request.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    expect(request.recipe.landforms[1]).toMatchObject({ areaId: 'main', at: { x: expect.any(Number) },
      shape: 'ridge', structure: { kind: 'ridge', breakline: expect.any(Array) } })
    const palette = createShoreBlankDocument('coast', { ...mapDimensions(request), title: request.title, preset: 'narrative' }, false, false, 'naturalStone')
    const floor = Object.values(palette.floors)[0]
    const { document } = shapeLandscapeCandidate(palette, floor, request, request.recipe, taskBudgetProfile('standard'))
    const [marked, inferred] = landscapeLandmarks(document, floor, request)
    expect(marked.actualElevationMm).toBe(4700)
    expect(inferred.actualElevationMm).toBeGreaterThan(1300)
    expect(inferred.atMm.x).toBeLessThan(17000)
  })
})
