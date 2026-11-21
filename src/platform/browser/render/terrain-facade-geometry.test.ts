import { describe, expect, it } from 'vitest'
import { TERRAIN_FACADES } from '../../../shared/appearance/terrain-facade.js'
import type { ProjectedTerrainEdge } from '../../../shared/projection/types.js'
import { facadeBayCount, planFacadeFaces } from './terrain-facade-geometry.js'

const p = (x: number, y: number) => ({ x, y })
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
    expect(near).toMatchObject({ start: from, end: seam, wall: { fromMm: 0, lengthMm: 8400 }, offset: p(0, 800), endCaps: [false, false] })
    expect(exposed).toMatchObject({ start: seam, end, wall: { fromMm: 5900, lengthMm: 8400 }, offset: p(0, 3800), endCaps: [false, false] })
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
    expect(faces.every(face => face.offset.x === facade.depthMm * .42 && face.offset.y === facade.depthMm)).toBe(true)
    expect(facadeBayCount(8000, facade)).toBe(4)
  })
})
