import { expect, it } from 'vitest'
import { fixture } from '../../../application/workspace/test-fixtures.js'
import { buildRoadSurface, ROAD_PPM, type RoadStation } from '../../../shared/geometry/road-surface.js'
import type { MaterialPaint } from '../../../shared/model/scene.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { gradedRoadDecks, roadBankSampler } from './graded-road-paint.js'

const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const paint = (id: string): MaterialPaint => ({
  materialRef: { id, version: 1 }, alignment: 'world', originMm: { x: 0, y: 0 },
  rotationDeg: 0, opacity: 1, tileSizeMm: { width: 1000, height: 1000 }, tint: null,
})

it('uses the neighboring visible material patch, overlay and base independently', () => {
  const projection = projectScene(fixture().project.document, 'gm')
  projection.rooms = []
  projection.terrain = [{ id: 'surface', points: rectangle(0, 0, 6000, 5000), priority: 0, elevationMm: 0,
    style: { base: paint('grass'), overlays: [{ id: 'drift', boundaryMm: rectangle(0, 0, 2500, 5000), paint: paint('snow'), blendWidthMm: 90, renderOrder: 0 }] },
    materialPatches: [{ regionsMm: [{ outerMm: rectangle(1800, 1600, 1700, 1600), holesMm: [rectangle(2100, 1800, 250, 250)] }],
      paint: paint('stone'), blendWidthMm: 110 }],
  }]
  projection.materials = {
    grass: { id: 'grass', textureAssetId: 'grass-image', version: 1, bankMaterial: 'grass' },
    snow: { id: 'snow', textureAssetId: 'snow-image', version: 1, bankMaterial: 'snow' },
    stone: { id: 'stone', textureAssetId: 'stone-image', version: 1, bankMaterial: 'stone' },
  }
  const bankAt = roadBankSampler(projection)
  expect(bankAt({ x: 800, y: 2800 })?.material).toBe('snow')
  expect(bankAt({ x: 2100, y: 2500 })?.material).toBe('stone')
  expect(bankAt({ x: 2220, y: 1900 })?.material).toBe('snow')
  expect(bankAt({ x: 4400, y: 2800 })?.material).toBe('grass')
  expect(roadBankSampler({ ...projection, audience: 'player', masks: [rectangle(2000, 2400, 300, 300)] })({ x: 2100, y: 2500 })).toBeUndefined()
})

it('joins a subdivided tread and landing and splits at actual ascending and descending risers', () => {
  const station = (atPpm: number, kind: RoadStation['kind'], height: number, next?: number): RoadStation => ({
    atPpm, kind, inZMm: [height, height], bankZMm: [height, height], shoulderMm: [100, 220],
    ...(next === undefined ? {} : { outZMm: [next, next] }),
  })
  const geometry = buildRoadSurface({ centerlineMm: [{ x: 0, y: 0 }, { x: 10000, y: 0 }], widthMm: 1600 }, {
    version: 1, stations: [station(0, 'trail', 0), station(130000, 'tread', 0), station(190000, 'tread', 0),
      station(240000, 'tread', 0, 190), station(350000, 'landing', 190), station(440000, 'landing', 190),
      station(590000, 'tread', 190), station(680000, 'tread', 190, 0), station(750000, 'trail', 0), station(ROAD_PPM, 'trail', 0)],
  })
  const decks = gradedRoadDecks(geometry)
  expect(decks.map(deck => [deck.spans[0].aPpm, deck.spans.at(-1)!.bPpm, deck.spans.length])).toEqual([
    [130000, 240000, 2], [240000, 350000, 1], [350000, 590000, 2], [590000, 680000, 1], [680000, 750000, 1],
  ])
  expect(decks[0].blendStart).toBe(true)
  expect(decks[1].startFace?.ascending).toBe(true)
  expect(decks[2]).toMatchObject({ blendStart: false, blendEnd: false })
  expect(decks[3].endFace?.ascending).toBe(false)
  expect(decks[4].blendEnd).toBe(true)
})
