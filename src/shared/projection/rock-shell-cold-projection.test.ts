import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { CompositionContent } from '../model/appearance.js'
import { certifyCompositionContent } from '../validation/content.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { projectScene } from './projection.js'

const floorId = 'blank-floor'
let sequence = 0
// Production IDs do not have the same lexical order as geometry allocation.
const shuffledRuntime = { clock: runtime.clock, ids: { nextId: () => `shell-projection-${String(++sequence * 7919 % 1_000_000).padStart(6, '0')}` } }
function rock(): CompositionContent {
  const { document } = fixture().project
  for (const id of ['item', 'other']) { delete document.props[id]; delete document.entityLayers[id] }
  let result = certifyCompositionContent(createCompositionContent(document, shuffledRuntime))
  result = applyCompositionDraftCommands(result, [{ type: 'createTerrainArea', id: 'rock', floorId,
    boundaryMm: [{ x: 6000, y: 4000 }, { x: 18000, y: 4000 }, { x: 18000, y: 14000 }, { x: 6000, y: 14000 }],
    groundElevationMm: 2000, visibility: 'public', surfaceStyle: null }], shuffledRuntime)
  result = applyCompositionDraftCommands(result, [{ type: 'setRockBody', id: 'rock', rockBody: { baseElevationMm: -500 } },
    { type: 'createRockShell', id: 'rock', widthMm: 1000, direction: { x: 0, y: 1 }, seed: 'cold-stable-shell', excludedSegmentIds: ['rock:segment:0', 'rock:segment:3'] }], shuffledRuntime)
  return applyCompositionDraftCommands(result, [{ type: 'addAttachmentSurface', id: 'rock-face', owner: { kind: 'terrainArea', id: 'rock' },
    feature: { kind: 'rockSourceFace', sourceSegmentIds: ['rock:segment:0'] }, capabilities: ['embed'] }], shuffledRuntime)
}
const fingerprint = (value: unknown) => sha256Text(canonicalJson(value))
const publicPaint = (value: CompositionContent, cold = false) => {
  const document = cold ? JSON.parse(canonicalJson(value.document)) : value.document
  const projected = projectScene(document, 'player', value.appearance, { floorId })
  return { rocks: projected.rocks, terrain: projected.terrain, connections: projected.connections, masks: projected.masks }
}

describe('rock-shell public projection after canonical cold read', () => {
  it('keeps complete public paint and bounded stratum selection stable when record keys are serialized canonically', () => {
    const prepared = rock()
    const allocated = Object.keys(prepared.document.terrainAreas.rock.rockBody!.shell!.faces)
    expect(allocated).not.toEqual([...allocated].sort())
    expect(fingerprint(publicPaint(prepared, true))).toBe(fingerprint(publicPaint(prepared)))
  })

  it('keeps a private cut absent from player paint both before and after canonical cold read', () => {
    const prepared = rock(), baseline = publicPaint(prepared)
    const result = applyCompositionDraftCommands(prepared, [{ type: 'createCarvedMountainPath', id: 'mountain-path', attachmentId: 'path-embed', walkSurfaceId: 'path-walk', sourceSurfaceId: 'rock-face',
      fromSurfaceRef: { kind: 'floor', id: floorId }, toSurfaceRef: { kind: 'terrainArea', id: 'rock' }, pointsMm: [{ x: 6000, y: 6000, z: 0 }, { x: 16000, y: 6000, z: 2000 }],
      widthMm: 1000, cutSide: 'right', layerId: prepared.document.entityLayers.rock, visibility: 'gm', follow: 'follow' }], shuffledRuntime)
    expect(fingerprint(publicPaint(result))).toBe(fingerprint(baseline))
    expect(fingerprint(publicPaint(result, true))).toBe(fingerprint(baseline))
  })
})
