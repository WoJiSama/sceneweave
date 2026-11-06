import { describe, expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures.js'
import { cloneJson } from '../validation/json.js'
import type { AggregateRelationRef } from '../model/aggregate.js'
import type { SceneDocument } from '../model/scene.js'
import { aggregateAffectedClosure, aggregateEntityRelations } from './relations.js'

function scene(): SceneDocument { return fixture({ building: true }).project.document }
function propScene(): SceneDocument {
  const result = scene(), prop = result.props.item
  prop.supportRef = { kind: 'terrainArea', id: 'distant-ground' }
  result.terrainAreas['distant-ground'] = {
    id: 'distant-ground', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    boundaryMm: [
      { id: 'distant-a', segmentId: 'distant-ab', positionMm: { x: 500_000, y: 500_000 } },
      { id: 'distant-b', segmentId: 'distant-bc', positionMm: { x: 501_000, y: 500_000 } },
      { id: 'distant-c', segmentId: 'distant-cd', positionMm: { x: 501_000, y: 501_000 } },
      { id: 'distant-d', segmentId: 'distant-da', positionMm: { x: 500_000, y: 501_000 } },
    ], groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1,
  }
  result.paths['long-route'] = { id: 'long-route', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    centerlineMm: [{ x: -500_000, y: -500_000 }, { x: 500_000, y: 500_000 }], widthMm: 100,
    supportRefs: [{ kind: 'terrainArea', id: 'distant-ground' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  result.entityLayers['distant-ground'] = result.entityLayers.item
  result.entityLayers['long-route'] = result.entityLayers.item
  result.props.item.supportRef = { kind: 'terrainArea', id: 'distant-ground' }
  result.notes['prop-note'] = { id: 'prop-note', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'Attached note', visibility: 'gm',
    anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
  result.entityLayers['prop-note'] = result.entityLayers.item
  result.prefabInstances['prop-container'] = { id: 'prop-container', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    definitionRef: { id: 'does-not-matter-to-relation-index', version: 1 }, anchorMm: { x: 0, y: 0 }, rotationDeg: 0,
    members: { item: { propId: 'item', overrideFields: [] } } }
  result.entityLayers['prop-container'] = result.entityLayers.item
  return result
}
const entity = (kind: Exclude<AggregateRelationRef['kind'], 'floor'>, id: string): AggregateRelationRef => ({ kind, id })

describe('aggregate dependency impact closure', () => {
  it('propagates long-distance support, annotation and container membership without proximity guesses', () => {
    const value = propScene(), before = cloneJson(value)
    const result = aggregateAffectedClosure(value, [entity('terrainArea', 'distant-ground')])
    const ids = new Set(result.affected.map(ref => `${ref.kind}:${ref.id}`))
    expect(ids).toEqual(new Set([
      'terrainArea:distant-ground', 'prop:item', 'path:long-route', 'prefabInstance:prop-container',
      'note:prop-note',
    ]))
    expect(result.spatialReviewFloors).toEqual(['blank-floor'])
    expect(result.requiresFullDomainValidation).toBe(true)
    expect(result.limitations).toEqual(['spatial-contact', 'visual-system', 'appearance-resources', 'generation-provenance'])
    expect(value).toEqual(before)
    expect(aggregateAffectedClosure(value, [entity('prop', 'item')]).affected.map(ref => ref.kind + ':' + ref.id)).toContain('prefabInstance:prop-container')
    expect(aggregateAffectedClosure(value, [entity('prefabInstance', 'prop-container')]).affected.map(ref => ref.kind + ':' + ref.id)).toContain('prop:item')
  })

  it('indexes real recursive wall, room, opening and vertex relationships deterministically', () => {
    const value = scene()
    value.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0',
      offsetMm: 1000, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
    value.entityLayers.door = value.entityLayers.room
    const first = aggregateAffectedClosure(value, [entity('vertex', 'vertex-0')])
    const second = aggregateAffectedClosure(value, [entity('vertex', 'vertex-0')])
    expect(first).toEqual(second)
    expect(first.affected.map(ref => ref.kind + ':' + ref.id)).toEqual([
      'opening:door', 'room:room', 'vertex:vertex-0', 'vertex:vertex-1', 'vertex:vertex-2', 'vertex:vertex-3',
      'wall:wall-0', 'wall:wall-1', 'wall:wall-2', 'wall:wall-3',
    ])
    expect(aggregateEntityRelations(value).some(edge => edge.from.kind === 'opening' && edge.to.kind === 'wall' && edge.field === 'wallId')).toBe(true)
  })

  it('closes annotation cycles once, rejects node-budget exhaustion and flags unknown targets', () => {
    const value = scene()
    value.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'First', visibility: 'gm',
      anchor: { type: 'entity', entityKind: 'note', entityId: 'second' } }
    value.notes.second = { id: 'second', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'Second', visibility: 'gm',
      anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    value.entityLayers.first = value.entityLayers.item; value.entityLayers.second = value.entityLayers.item
    const cycle = aggregateAffectedClosure(value, [entity('note', 'first')])
    expect(cycle.affected.map(ref => ref.id).filter(id => id === 'first' || id === 'second')).toEqual(['first', 'second'])
    expect(() => aggregateAffectedClosure(value, [entity('note', 'first')], { maxNodes: 1 })).toThrow(/节点保护预算/)
    const unknown = aggregateAffectedClosure(value, [entity('room', 'missing')])
    expect(unknown.unknownTargets).toEqual([entity('room', 'missing')])
    expect(unknown.requiresSceneWideFallback).toBe(true)
    expect(unknown.affected).toEqual([entity('room', 'missing')])
  })
})
