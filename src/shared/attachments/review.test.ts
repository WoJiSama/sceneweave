import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { cloneJson } from '../validation/json.js'
import type { AttachmentCommand } from './commands.js'
import { inspectAttachmentChanges } from './review.js'

describe('exact attachment preview scope', () => {
  it('separates actual host/child/relationship changes from recursive note and both-side layer reads, including a surface-only addition', () => {
    const scene = fixture().project.document, layerId = scene.entityLayers.item
    Object.assign(scene.props.item, { positionMm: { x: 6000, y: 6000 }, footprintMm: { width: 2400, height: 1600 } })
    Object.assign(scene.props.other, { positionMm: { x: 6200, y: 6000 }, footprintMm: { width: 400, height: 200 } })
    scene.notes.childNote = { id: 'childNote', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'note', text: 'child note', anchor: { type: 'entity', entityKind: 'prop', entityId: 'other' } }
    scene.notes.recursiveNote = { id: 'recursiveNote', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'note', text: 'recursive note', anchor: { type: 'entity', entityKind: 'note', entityId: 'childNote' } }
    scene.entityLayers.childNote = layerId; scene.entityLayers.recursiveNote = layerId
    const surface: AttachmentCommand = { type: 'addAttachmentSurface', id: 'top', owner: { kind: 'prop', id: 'item' }, capabilities: ['support'],
      feature: { kind: 'propTop', polygonLocalMm: [{ x: -1000, y: -600 }, { x: 1000, y: -600 }, { x: 1000, y: 600 }, { x: -1000, y: 600 }], heightLocalMm: 800 } }
    const source = createCompositionContent(scene, runtime), onlySurface = applyCompositionDraftCommands(source, [surface], runtime)
    const surfaceScope = inspectAttachmentChanges(source.document, onlySurface.document)
    expect(surfaceScope.changedIds).toEqual(['top'])
    expect(surfaceScope.affectedIds).toEqual(expect.arrayContaining(['top', 'item', layerId]))
    expect(surfaceScope.dependencyIds).toContain('item')
    expect(surfaceScope.commandCost).toBe(1)
    const attached = applyCompositionDraftCommands(onlySurface, [{ type: 'bindPropAttachment', id: 'attached', childId: 'other', surfaceId: 'top', mode: 'support',
      follow: 'follow', anchorState: 'manual', anchor: { kind: 'horizontal', localMm: { x: 200, y: 0 }, heightOffsetMm: 0, rotationOffsetDeg: 0 } }], runtime)
    const moved = applyCompositionDraftCommands(attached, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 7000, y: 6500 }, rotationDeg: 90 } }], runtime)
    const before = cloneJson(attached.document), after = cloneJson(moved.document)
    // A real target-layer move discloses both the old and new owner layers.
    after.userLayers.newLayer = { ...after.userLayers[layerId], id: 'newLayer', name: 'new layer', order: 10 }
    after.entityLayers.other = 'newLayer'
    const scope = inspectAttachmentChanges(before, after)
    expect(scope.changedIds).toEqual(['attached', 'item', 'other'])
    expect(scope.commandCost).toBe(3)
    expect(scope.affectedIds).toEqual(expect.arrayContaining(['attached', 'top', 'item', 'other', 'childNote', 'recursiveNote', layerId, 'newLayer']))
    expect(scope.dependencyIds).toEqual(expect.arrayContaining(['top', 'childNote', 'recursiveNote', layerId, 'newLayer']))
    expect(scope.changedIds.some(id => scope.dependencyIds.includes(id))).toBe(false)
    expect(scope.layerIds).toEqual([layerId, 'newLayer'].sort())
    expect(inspectAttachmentChanges(before, before)).toEqual({ affectedIds: [], layerIds: [], changedIds: [], dependencyIds: [], commandCost: 0 })
  })
})
