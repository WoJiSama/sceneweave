import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../commands/commands.js'
import { inspectOutdoorChanges } from '../commands/outdoor.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { MANUAL_TRANSACTION_BUDGET } from '../budget/command-budget.js'
import { resolveBuildingStructurePort } from '../generation/building-port.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import type { CompositionContent } from '../model/appearance.js'
import type { SceneCommand } from '../commands/commands.js'

let sequence = 0
const runtime = { clock: { now: () => '2026-11-10T13:00:00.000Z' }, ids: { nextId: () => `sibling-attribute-proof-${++sequence}` } }
const rect = (x: number, y: number, width: number, height: number) => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
const apply = (source: CompositionContent, commands: SceneCommand[]) => applyCompositionCommands(source, commands, runtime, { budget: MANUAL_TRANSACTION_BUDGET })

function siblings(order: readonly string[]) {
  const blank = createShoreBlankDocument('island', { sceneId: 'shared-door-attribute-regression', title: '共享门的独立道路属性',
    widthMm: 40000, heightMm: 40000, now: runtime.clock.now(), preset: 'narrative' })
  let scene = applyCommands(blank, [
    { type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rect(0, 0, 40000, 40000), groundElevationMm: 1200, coveragePriority: 0 },
    { type: 'createRoom', id: 'room', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rect(12000, 12000, 6000, 6000), thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ground' } },
  ], runtime)
  const wall = Object.values(scene.walls).find(row => scene.vertices[row.startVertexId].yMm === 12000 && scene.vertices[row.endVertexId].yMm === 12000)!
  scene = applyCommands(scene, [{ type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 2400, widthMm: 1200, kind: 'door', state: 'closed', locked: true }], runtime)
  const port = resolveBuildingStructurePort(scene, 'door', 1000)
  for (const id of order) scene = applyCommands(scene, [{ type: 'createPath', id, floorId: 'visual-floor', layerId: 'visual-layer-ground', widthMm: 1000,
    centerlineMm: [port.outsideMm, { x: port.outsideMm.x, y: port.outsideMm.y - 4000 }, { x: port.outsideMm.x + (id === 'road-a' ? 2500 : -2500), y: port.outsideMm.y - 6000 }], supportRefs: [port.supportRef] }], runtime)
  let bound = createCompositionContent(scene, runtime)
  for (const id of order) bound = apply(bound, [{ type: 'bindPathAttachment', id: `link-${id}`, pathId: id,
    openingId: 'door', end: 'start', leadLengthMm: 1000, maxDisplacementMm: 1000 }])
  return { source: apply(bound, [{ type: 'setEditLock', kind: 'path', id: 'road-b', locked: true }]), wall }
}

describe('shared-door read dependencies do not become sibling road writes', () => {
  it.each([['road-a', 'road-b'], ['road-b', 'road-a']])('keeps ordinary A attributes/material editable with locked B, insertion order %s then %s', (first, second) => {
    const { source } = siblings([first, second]), frozen = canonicalJson(source)
    const material = Object.values(source.document.materials).find(row => row.applicableSurfaces.includes('path'))!
    expect(material).toBeDefined()
    const next = apply(source, [{ type: 'updatePath', id: 'road-a', changes: { renderOrder: 37, movementCostMultiplier: 1.7,
      surfaceStyle: { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: cloneJson(material.defaultTileSizeMm), alignment: 'world', originMm: { x: 37, y: -81 }, rotationDeg: 17, tint: null, opacity: 1 }, overlays: [] } } }])
    expect(next.document.paths['road-a'].renderOrder).toBe(37)
    expect(next.document.paths['road-a'].movementCostMultiplier).toBe(1.7)
    expect(next.document.paths['road-b']).toEqual(source.document.paths['road-b'])
    expect(next.document.pathAttachments).toEqual(source.document.pathAttachments)
    expect(next.historyIdentity.outdoorTokens['road-b']).toEqual(source.historyIdentity.outdoorTokens['road-b'])
    const impact = inspectOutdoorChanges(source.document, next.document, ['road-a'])
    expect(impact.changedIds).toContain('road-a')
    expect(impact.affectedIds).not.toContain('road-b')
    expect(impact.affectedIds).not.toContain('link-road-b')
    expect(canonicalJson(source)).toBe(frozen)
  })

  it('still rejects an actual shared-wall geometry change that would follow the locked sibling', () => {
    const { source, wall } = siblings(['road-a', 'road-b']), frozen = canonicalJson(source)
    expect(() => apply(source, [{ type: 'setWallThickness', id: wall.id, thicknessMm: 600 }])).toThrow(/锁定/)
    expect(canonicalJson(source)).toBe(frozen)
  })
})
