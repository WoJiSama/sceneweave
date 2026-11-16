import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { createCarvedStrip, type CarvedStrip } from '../carved-rock/index.js'
import { outdoorIdentityDescriptors } from '../history/identity.js'
import { cloneJson } from '../validation/json.js'

function setup() {
  const scene = fixture().project.document
  const host = { id: 'rock', floorId: 'blank-floor', groundElevationMm: 2000, rockBody: { baseElevationMm: -500 },
    boundaryMm: [{ x: 1000, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 1000, y: 8000 }].map((positionMm, i) => ({ id: `rp-${i}`, segmentId: `rs-${i}`, positionMm })) }
  const strip = createCarvedStrip(host, { attachmentId: 'road-embed', walkSurfaceId: 'road-walk', sourceSegmentIds: ['rs-0'], cutSide: 'right', widthMm: 1000,
    pointsMm: [{ x: 1000, y: 1500, z: 0 }, { x: 10000, y: 1500, z: 2000 }] }, runtime)
  scene.terrainConnections.road = { id: 'road', floorId: 'blank-floor', editLocked: false, visibility: 'public', kind: 'ramp', widthMm: 1000,
    from: { surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 1000, y: 1500 } },
    to: { surfaceRef: { kind: 'terrainArea', id: 'rock' }, positionMm: { x: 10000, y: 1500 } },
    openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null, carvedStrip: strip }
  return scene
}

describe('materialized carved mesh identity topology', () => {
  it('retires continuity for every persisted mesh incidence and provenance change', () => {
    const source = setup(), expected = outdoorIdentityDescriptors(source).road.topologyHash
    const edits: [string, (strip: CarvedStrip) => void][] = [
      ['algorithm', strip => Object.assign(strip, { algorithmId: 'different-algorithm' })],
      ['algorithm version', strip => Object.assign(strip, { algorithmVersion: 2 })],
      ['attachment', strip => { strip.attachmentId = 'different-attachment' }],
      ['walk surface', strip => { strip.walkSurfaceId = 'different-walk' }],
      ['host', strip => { strip.hostAreaId = 'different-host' }],
      ['source chain', strip => { strip.sourceSegmentIds = ['different-source'] }],
      ['cut side', strip => { strip.cutSide = 'left' }],
      ['station identity', strip => { strip.stations[0].id = 'different-station' }],
      ['station incidence', strip => { strip.stations[0].leftVertexId = strip.stations[0].rightVertexId }],
      ['vertex identity', strip => { strip.verticesMm.extra = { x: 1000, y: 1000, z: 0 } }],
      ['face identity', strip => { Object.values(strip.faces)[0].id = 'different-face' }],
      ['face incidence', strip => { const face = Object.values(strip.faces)[0]; face.vertexIds = [face.vertexIds[1], face.vertexIds[0], face.vertexIds[2]] }],
      ['walk membership', strip => { strip.walkFaceIds = strip.walkFaceIds.slice(1) }],
      ['cell identity', strip => { strip.cutCells[0].id = 'different-cell' }],
      ['cell kind', strip => { strip.cutCells[0].kind = strip.cutCells[0].kind === 'walk' ? 'apron' : 'walk' }],
      ['cell face', strip => { strip.cutCells[0].lowerFaceId = strip.cutCells[1].lowerFaceId }],
      ['cell source', strip => { strip.cutCells[0].sourceAreaId = 'different-cell-source' }],
    ]
    for (const [label, edit] of edits) {
      const changed = cloneJson(source); edit(changed.terrainConnections.road.carvedStrip!)
      expect(outdoorIdentityDescriptors(changed).road.topologyHash, label).not.toBe(expected)
    }
  })

  it('retains logical topology through actual XYZ, width, station measurement and manual-state edits', () => {
    const source = setup(), changed = cloneJson(source), strip = changed.terrainConnections.road.carvedStrip!
    for (const vertex of Object.values(strip.verticesMm)) { vertex.x += 200; vertex.y += 100; vertex.z += 50 }
    strip.widthMm += 100; strip.stations[0].state = 'manual'; strip.stations[1].sMm += 10
    expect(outdoorIdentityDescriptors(changed).road).toEqual(outdoorIdentityDescriptors(source).road)
    strip.verticesMm = Object.fromEntries(Object.entries(strip.verticesMm).reverse())
    strip.faces = Object.fromEntries(Object.entries(strip.faces).reverse())
    expect(outdoorIdentityDescriptors(changed).road).toEqual(outdoorIdentityDescriptors(source).road)
  })
})
