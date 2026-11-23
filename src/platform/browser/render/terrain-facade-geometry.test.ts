import { describe, expect, it } from 'vitest'
import { TERRAIN_FACADES } from '../../../shared/appearance/terrain-facade.js'
import { bridgeSideOffset } from '../../../shared/path-assembly/profiles.js'
import type { ProjectedTerrainEdge } from '../../../shared/projection/types.js'
import { facadeBayCount, planFacadeFaces } from './terrain-facade-geometry.js'

const p = (x: number, y: number) => ({ x, y })
const offsetAtDepth = (depth: number) => p(depth * (.35 / .58), depth)
const landing = (region: { outerMm: ReturnType<typeof p>[]; holesMm: never[] }, y: number) => ({
  id: 'factory', contactMm: region.outerMm[0], shoulderCut: [], edgeOpening: [region], girderOffsetMm: offsetAtDepth(y),
})
const edge = (id: string, start: ReturnType<typeof p>, end: ReturnType<typeof p>): ProjectedTerrainEdge => ({
  id, start, end, sourceAreaId: 'factory', neighborAreaId: null, elevationMm: 4200, neighborElevationMm: 0,
  kind: 'cliff', shoreline: false, surfaceStyle: null, style: { strokeWidthMm: 100, bandWidthMm: 200, color: '#121D29' },
})

describe('façade geometry on the visible platform outline', () => {
  it('keeps one window layout as the wall crosses onto neighboring support', () => {
    const facade = { ...TERRAIN_FACADES['glazed-v1'], depthMm: 3800 }
    const from = p(8400, 6500), seam = p(2500, 6500), end = p(0, 6500)
    const supported = { ...edge('joined', seam, from), sourceAreaId: 'landing', neighborAreaId: 'factory',
      elevationMm: 3400, neighborElevationMm: 4200 }
    const [near, exposed] = planFacadeFaces({ edges: [edge('open-air', seam, end), supported] }, { id: 'factory', facade }, [])
    expect(near).toMatchObject({ start: from, end: seam, wall: { fromMm: 0, lengthMm: 8400 }, offsetsMm: [p(0, 800), p(0, 800)], endCaps: [false, false] })
    expect(exposed).toMatchObject({ start: seam, end, wall: { fromMm: 5900, lengthMm: 8400 }, offsetsMm: [p(0, 3800), p(0, 3800)], endCaps: [false, false] })
    const split = p(4700, 6500)
    const replanned = planFacadeFaces({ edges: [edge('open-air', seam, end), { ...supported, end: split }, { ...supported, id: 'joint-split', start: split }] }, { id: 'factory', facade }, [])
    expect(replanned).toEqual([near, exposed])
  })

  it('shares the extrusion at the turn and cuts the complete opening with matching jambs', () => {
    const facade = { ...TERRAIN_FACADES['glazed-v1'], facing: 'right' as const }
    const corner = p(6000, 8000), from = p(6500, 7100), to = p(0, 8000)
    const edges = [edge('chamfer', from, corner), edge('south', corner, to), edge('back', p(0, 0), p(7000, 0))]
    const opening = { outerMm: [p(2300, 7500), p(3900, 7500), p(3900, 8500), p(2300, 8500)], holesMm: [] }
    const faces = planFacadeFaces({ edges }, { id: 'factory', facade }, [opening])
    expect(faces.map(face => [face.start, face.end])).toEqual([[from, corner], [corner, p(3900, 8000)], [p(2300, 8000), to]])
    expect(faces.map(face => face.endCaps)).toEqual([[false, false], [false, true], [true, false]])
    expect(faces.every(face => face.offsetsMm.every(offset => offset.x === facade.depthMm * .42 && offset.y === facade.depthMm))).toBe(true)
    expect(facadeBayCount(8000, facade)).toBe(4)
  })

  it('matches the projected bridge girder at a chamfer and opening', () => {
    const offset = bridgeSideOffset(2200), facade = { ...TERRAIN_FACADES['girder-v1'], depthMm: Math.round(offset.y) }
    const front = p(6500, 7100), corner = p(6000, 8000), end = p(0, 8000)
    const edges = [edge('chamfer', front, corner), edge('south', corner, end)]
    const opening = { outerMm: [p(2300, 7500), p(3900, 7500), p(3900, 8500), p(2300, 8500)], holesMm: [] }
    const faces = planFacadeFaces({ edges }, { id: 'factory', facade }, [opening])
    expect(faces.map(({ start, end }) => [start, end])).toEqual([[front, corner], [corner, p(3900, 8000)], [p(2300, 8000), end]])
    for (const projected of faces.flatMap(face => face.offsetsMm)) {
      expect(projected.x).toBeCloseTo(offset.x)
      expect(projected.y).toBeCloseTo(offset.y)
    }
    expect(faces.map(face => face.endCaps)).toEqual([[false, false], [false, true], [true, false]])
  })

  it('joins thick and flush decks to the same wall without a step in the steel fascia', () => {
    const facade = { ...TERRAIN_FACADES['girder-v1'], depthMm: 460 }
    const wall = edge('front', p(14000, 8000), p(0, 8000))
    const opening = (from: number, to: number) => ({ outerMm: [p(from, 7500), p(to, 7500), p(to, 8500), p(from, 8500)], holesMm: [] })
    const thick = opening(8500, 10100), flush = opening(3000, 4600)
    const landings = [landing(thick, 1800), landing(flush, 0)]
    const faces = planFacadeFaces({ edges: [wall] }, { id: 'factory', facade }, [], landings)
    const depths = (face: typeof faces[number]) => face.offsetsMm.map(offset => offset.y)
    const byStart = faces.slice().sort((a, b) => b.start.x - a.start.x)
    expect(byStart.find(face => face.start.x === 8500)?.offsetsMm[0].y).toBe(1800)
    expect(byStart.find(face => face.end.x === 10100)?.offsetsMm[1].y).toBe(1800)
    expect(byStart.find(face => face.end.x === 4600)?.offsetsMm[1].y).toBe(0)
    expect(byStart.find(face => face.start.x === 3000)?.offsetsMm[0].y).toBe(0)
    for (const [index, face] of byStart.entries()) {
      const next = byStart[index + 1]
      if (next && Math.abs(next.start.x - face.end.x) < 1e-6) {
        expect(depths(face)[1]).toBeCloseTo(depths(next)[0])
        expect(face.wall.lengthMm).toBe(next.wall.lengthMm)
      }
    }
  })

  it('adapts both jambs when a bridge opening starts and ends on a platform turn', () => {
    const facade = { ...TERRAIN_FACADES['girder-v1'], depthMm: 550 }
    const a = p(8500, 7200), b = p(6900, 8400)
    const edges = [edge('side', p(8500, 1000), a), edge('chamfer', a, b), edge('front', b, p(500, 8400))]
    const opening = { outerMm: [a, b, p(6900, 7200)], holesMm: [] }
    const faces = planFacadeFaces({ edges }, { id: 'factory', facade }, [], [landing(opening, 1550)])
    expect(faces).toContainEqual(expect.objectContaining({ end: a, endCaps: [false, true], offsetsMm: [offsetAtDepth(550), offsetAtDepth(1550)] }))
    expect(faces).toContainEqual(expect.objectContaining({ start: b, endCaps: [true, false], offsetsMm: [offsetAtDepth(1550), offsetAtDepth(550)] }))
    expect(faces.some(face => face.start.x === a.x && face.end.x === b.x)).toBe(false)
  })

  it('connects two close steel openings with one continuous depth and keeps the return through a corner', () => {
    const facade = { ...TERRAIN_FACADES['girder-v1'], depthMm: 550 }
    const corner = p(10800, 8600)
    const edges = [edge('chamfer', p(12100, 7600), corner), edge('front', corner, p(0, 8600))]
    const opening = (from: number, to: number) => ({ outerMm: [p(from, 8400), p(to, 8400), p(to, 8800), p(from, 8800)], holesMm: [] })
    const faces = planFacadeFaces({ edges }, { id: 'factory', facade }, [], [
      landing(opening(8800, 10300), 1850), landing(opening(6400, 8100), 1050),
    ])
    const middle = faces.filter(face => face.start.x > 8100 && face.start.x <= 8800)
    expect(middle).toHaveLength(1)
    expect(middle[0].offsetsMm).toEqual([offsetAtDepth(1850), offsetAtDepth(1050)])
    expect(middle[0].endCaps).toEqual([true, true])
    const before = faces.find(face => face.end === corner || face.end.x === corner.x && face.end.y === corner.y)
    const after = faces.find(face => face.start.x === corner.x && face.start.y === corner.y)
    expect(before!.offsetsMm[1].x).toBeCloseTo(after!.offsetsMm[0].x)
    expect(before!.offsetsMm[1].y).toBeCloseTo(after!.offsetsMm[0].y)
    expect(after!.offsetsMm[0].y).toBeGreaterThan(facade.depthMm)
  })

  it('continues a building wall beneath the bridge while cutting a real stair opening', () => {
    const facade = { ...TERRAIN_FACADES['glazed-v1'], depthMm: 4200, facing: 'left' as const }
    const wall = edge('front', p(14000, 8000), p(0, 8000))
    const opening = (from: number, to: number) => ({ outerMm: [p(from, 7600), p(to, 7600), p(to, 8400), p(from, 8400)], holesMm: [] })
    const carrier = { id: 'factory', facade }, stairs = opening(2900, 4700)
    const faces = planFacadeFaces({ edges: [wall] }, carrier, [stairs], [landing(opening(8000, 10200), 1400)])
    expect(faces).toEqual(planFacadeFaces({ edges: [wall] }, carrier, [stairs]))
    expect(faces).toHaveLength(2)
    expect(faces.map(face => [face.offsetsMm[0].y, face.endCaps])).toEqual([[4200, [false, true]], [4200, [true, false]]])
  })

  it('keeps the fascia under a deck with no matching structural section', () => {
    const from = p(14000, 8000), to = p(0, 8000)
    const projection = { edges: [edge('front', from, to)] }
    const carrier = { id: 'factory', facade: TERRAIN_FACADES['girder-v1'] }
    const opening = { outerMm: [p(8000, 7600), p(10200, 7600), p(10200, 8400), p(8000, 8400)], holesMm: [] }
    const { girderOffsetMm: _, ...unmatchedLanding } = landing(opening, 900)
    const faces = planFacadeFaces(projection, carrier, [], [unmatchedLanding])
    expect(faces).toHaveLength(1)
    expect(faces[0]).toMatchObject({ start: from, end: to, endCaps: [false, false] })
  })
})
