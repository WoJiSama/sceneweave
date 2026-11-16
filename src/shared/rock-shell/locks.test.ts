import { describe, expect, it, vi } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { CompositionCommand } from '../model/appearance.js'
import { certifyCompositionContent } from '../validation/content.js'
import { canonicalJson, cloneJson } from '../validation/json.js'

const createShell: CompositionCommand = { type: 'createRockShell', id: 'rock', widthMm: 1000,
  direction: { x: 0, y: 1 }, seed: 'locked-host-dependencies', excludedSegmentIds: [] }
function source(withShell: boolean) {
  const scene = fixture().project.document
  delete scene.props.item; delete scene.props.other; delete scene.entityLayers.item; delete scene.entityLayers.other
  let value = applyCompositionDraftCommands(createCompositionContent(scene, runtime), [{ type: 'createTerrainArea', id: 'rock', floorId: 'blank-floor',
    boundaryMm: [{ x: 6000, y: 4000 }, { x: 18000, y: 4000 }, { x: 18000, y: 14000 }, { x: 6000, y: 14000 }],
    groundElevationMm: 2000, visibility: 'public', surfaceStyle: null }, { type: 'setRockBody', id: 'rock', rockBody: { baseElevationMm: -500 } }], runtime)
  if (withShell) value = applyCompositionDraftCommands(value, [createShell], runtime)
  return cloneJson(value)
}

describe('rock body and shell commands protect the host dependency closure', () => {
  const commands: CompositionCommand[] = [
    { type: 'setRockBody', id: 'rock', rockBody: { baseElevationMm: -600 } },
    { type: 'setRockBody', id: 'rock', rockBody: null },
    createShell,
    { type: 'removeRockShell', id: 'rock', disposition: 'restore-vertical-body' },
  ]
  for (const protection of ['note', 'recursive-note', 'note-layer'] as const) {
    it(`rejects every body/shell mutation with a locked ${protection} before allocating IDs`, () => {
      for (const command of commands) {
        const value = source(command.type === 'removeRockShell'), scene = value.document, hostLayer = scene.entityLayers.rock
        scene.notes['host-note'] = { id: 'host-note', floorId: 'blank-floor', editLocked: protection === 'note',
          anchor: { type: 'entity', entityKind: 'terrainArea', entityId: 'rock' }, kind: 'note', text: 'Protected rock inspection', visibility: 'gm' }
        scene.entityLayers['host-note'] = hostLayer
        if (protection === 'recursive-note') {
          scene.notes['nested-note'] = { id: 'nested-note', floorId: 'blank-floor', editLocked: true,
            anchor: { type: 'entity', entityKind: 'note', entityId: 'host-note' }, kind: 'note', text: 'Protected nested note', visibility: 'gm' }
          scene.entityLayers['nested-note'] = hostLayer
        } else if (protection === 'note-layer') {
          scene.userLayers['note-layer'] = { id: 'note-layer', floorId: 'blank-floor', name: 'Protected notes',
            order: Object.values(scene.userLayers).filter(layer => layer.floorId === 'blank-floor').length, editLocked: true }
          scene.entityLayers['host-note'] = 'note-layer'
        }
        // Certify the complete legal input first: no malformed lock fixture can
        // masquerade as a successful command refusal.
        const prepared = certifyCompositionContent(value), before = canonicalJson(prepared)
        const nextId = vi.fn(() => `unexpected-${crypto.randomUUID()}`)
        expect(() => applyCompositionDraftCommands(prepared, [command], { ...runtime, ids: { nextId } })).toThrow(/锁定/)
        expect(nextId).not.toHaveBeenCalled()
        expect(canonicalJson(prepared)).toBe(before)
      }
    })
  }
})
