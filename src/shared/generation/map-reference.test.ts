import { describe, expect, it } from 'vitest'
import { shapeLandscapeCandidate } from '../../application/workspace/landscape-map.js'
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
    expect(saved.main.reliefFinish).toBe('weathered-v2')
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
    } })
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'design', id: 'wrong', at: invalid }),
      expect.objectContaining({ kind: 'design', id: 'missing-goal' }),
    ]))
    expect(result.regions).toHaveLength(2)
    expect(result.request.recipe).toMatchObject({ landforms: [], routes: [] })
  })
})
