import { describe, expect, it } from 'vitest'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import type { AggregateEntityRef, AggregateGroup } from '../../shared/model/aggregate.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { openingEndpoints } from '../../shared/geometry/geometry.js'
import { canonicalJson } from '../../shared/validation/json.js'
import { inspectAggregateEdit, type AggregateEditBoundaryImpact } from './aggregate-boundary.js'
import { fromBundle, type EditableProject } from './project.js'
import { prepareCompositionCommands } from './prepare.js'
import { fixture, runtime, validation } from './test-fixtures.js'

async function building(options: { opening?: boolean; openingOffsetMm?: number; notes?: boolean; lockedNote?: boolean } = {}) {
  const bundle = fixture({ building: true }), scene = bundle.project.document, layerId = scene.entityLayers.room
  const group = (id: string, members: AggregateEntityRef[]): AggregateGroup => ({ id, floorId: 'blank-floor', parentId: null,
    editLocked: false, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members })
  scene.aggregateCoordinates = { encoding: 'world', groups: {
    'building-a': group('building-a', [{ kind: 'room', id: 'room' },
      ...Object.keys(scene.vertices).map(id => ({ kind: 'vertex' as const, id })),
      ...['wall-0', 'wall-1', 'wall-3'].map(id => ({ kind: 'wall' as const, id }))]),
    'building-b': group('building-b', [{ kind: 'wall', id: 'wall-2' }]),
  } }
  if (options.opening) {
    scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0',
      offsetReferenceVertexId: 'vertex-0', offsetMm: options.openingOffsetMm ?? 1000, widthMm: 1200,
      kind: 'door', state: 'closed', locked: false, secret: false, revealed: false }
    scene.entityLayers.door = layerId
  }
  if (options.notes) {
    scene.notes['door-note'] = { id: 'door-note', floorId: 'blank-floor', editLocked: false, kind: 'note',
      text: 'Attached to the door', visibility: 'gm', anchor: { type: 'entity', entityKind: 'opening', entityId: 'door' } }
    scene.notes['recursive-note'] = { id: 'recursive-note', floorId: 'blank-floor', editLocked: options.lockedNote ?? false, kind: 'note',
      text: 'Attached recursively', visibility: 'gm', anchor: { type: 'entity', entityKind: 'note', entityId: 'door-note' } }
    scene.entityLayers['door-note'] = layerId; scene.entityLayers['recursive-note'] = layerId
  }
  Object.assign(bundle.project, createCompositionContent(scene, runtime))
  return fromBundle(bundle, validation)
}
async function prepare(project: EditableProject, commands: CompositionCommand[]) {
  const reports: AggregateEditBoundaryImpact[] = []
  const candidate = await prepareCompositionCommands(project, commands, { runtime, validation,
    onAggregateBoundaryImpact: impact => reports.push(impact) })
  expect(reports).toHaveLength(1)
  expect(reports[0].requiresFullDomainValidation).toBe(true)
  expect(Object.isFrozen(reports[0])).toBe(true)
  return { candidate, impact: reports[0] }
}
const ids = (refs: readonly { id: string }[]) => refs.map(ref => ref.id)

describe('aggregate boundary diagnostics for validated structural candidates', () => {
  it('follows implicit wall, room and opening geometry plus recursive notes from a moved vertex', async () => {
    const project = await building({ opening: true, notes: true })
    const commands: CompositionCommand[] = [{ type: 'moveVertex', id: 'vertex-0', positionMm: { x: 3500, y: 3000 } }]
    const { candidate, impact } = await prepare(project, commands)
    // Their records are unchanged, but their materialized geometry and anchors
    // follow the changed vertex and must still be invalidated.
    expect(candidate.document.walls['wall-0']).toEqual(project.document.walls['wall-0'])
    expect(candidate.document.rooms.room).toEqual(project.document.rooms.room)
    expect(candidate.document.openings.door).toEqual(project.document.openings.door)
    expect(openingEndpoints(candidate.document, candidate.document.openings.door))
      .not.toEqual(openingEndpoints(project.document, project.document.openings.door))
    expect(impact.dependencyClosure.roots).toEqual([{ kind: 'vertex', id: 'vertex-0' }])
    expect(ids(impact.dependencyClosure.affected)).toEqual(expect.arrayContaining([
      'wall-0', 'wall-3', 'room', 'door', 'door-note', 'recursive-note',
    ]))
    expect(impact.groups.map(group => group.groupId)).toEqual(['building-a', 'building-b'])
    expect(ids(impact.unboundedTargets)).toEqual(expect.arrayContaining(['door-note', 'recursive-note']))
    expect(impact.requiresSceneWideFallback).toBe(true)
    expect(inspectAggregateEdit(project, candidate.document, commands)!.dependencyClosure).toEqual(impact.dependencyClosure)
    expect(project.document.vertices['vertex-0']).toMatchObject({ xMm: 3000, yMm: 3000 })
  })

  it('finds existing grouped wall context for a fresh opening and both groups on reattachment', async () => {
    const project = await building()
    const added = await prepare(project, [{ type: 'addOpening', id: 'door', wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0',
      offsetMm: 1000, widthMm: 1200, kind: 'door' }])
    expect(added.impact.dependencyClosure.roots).toEqual([{ kind: 'opening', id: 'door' }])
    expect(added.impact.groups.map(group => group.groupId)).toContain('building-a')
    expect(Object.values(added.candidate.document.aggregateCoordinates!.groups).flatMap(group => group.members))
      .not.toContainEqual({ kind: 'opening', id: 'door' })
    const moved = await prepare(added.candidate, [{ type: 'updateOpening', id: 'door', changes: {
      wallId: 'wall-2', offsetReferenceVertexId: 'vertex-2', offsetMm: 1000,
    } }])
    expect(moved.impact.groups.map(group => group.groupId)).toEqual(['building-a', 'building-b'])
    expect(ids(moved.impact.dependencyClosure.affected)).toEqual(expect.arrayContaining(['wall-0', 'wall-2', 'door']))
    expect(moved.candidate.document.openings.door.wallId).toBe('wall-2')
    expect(added.candidate.document.openings.door.wallId).toBe('wall-0')
  })

  it('reports split and merge creations/removals without assigning fresh structures to the old group', async () => {
    const project = await building({ opening: true, openingOffsetMm: 4000 })
    const split = await prepare(project, [{ type: 'splitWall', id: 'wall-0', newVertexId: 'structure-junction',
      newWallId: 'zz-structure-wall', positionMm: { x: 6500, y: 3000 } }])
    expect(split.impact.dependencyClosure.roots).toEqual(expect.arrayContaining([
      { kind: 'vertex', id: 'structure-junction' }, { kind: 'wall', id: 'zz-structure-wall' }, { kind: 'room', id: 'room' },
    ]))
    expect(split.candidate.document.openings.door).toMatchObject({ wallId: 'zz-structure-wall', offsetMm: 500 })
    expect(split.candidate.document.aggregateCoordinates!.groups).toEqual(project.document.aggregateCoordinates!.groups)
    const merged = await prepare(split.candidate, [{ type: 'repairBuildingTopology', id: 'wall-0', operation: 'mergeCollinear' }])
    expect(merged.candidate.document.vertices['structure-junction']).toBeUndefined()
    expect(merged.candidate.document.walls['zz-structure-wall']).toBeUndefined()
    expect(merged.impact.dependencyClosure.roots).toEqual(expect.arrayContaining([
      { kind: 'vertex', id: 'structure-junction' }, { kind: 'wall', id: 'zz-structure-wall' },
    ]))
    expect(merged.impact.dependencyClosure.unknownTargets).toEqual([])
    expect(merged.candidate.document.openings.door).toEqual(project.document.openings.door)
    expect(merged.candidate.document.aggregateCoordinates!.groups).toEqual(project.document.aggregateCoordinates!.groups)
  })

  it('reports entrance-only constraint changes even when all entity records stay equal', async () => {
    const project = await building({ opening: true })
    const { candidate, impact } = await prepare(project, [{ type: 'setEntranceOpenings', ids: ['door'] }])
    expect(candidate.document.openings).toEqual(project.document.openings)
    expect(candidate.document.rooms).toEqual(project.document.rooms)
    expect(candidate.document.constraints.entranceOpeningIds).toEqual(['door'])
    expect(project.document.constraints.entranceOpeningIds).toEqual([])
    expect(impact.dependencyClosure.roots).toEqual([{ kind: 'opening', id: 'door' }])
    expect(impact.groups.map(group => group.groupId)).toContain('building-a')
  })

  it('keeps recursive structure locks and full geometry rejection ahead of diagnostic publication', async () => {
    const project = await building({ opening: true, notes: true, lockedNote: true }), before = canonicalJson(project.document)
    const reports: AggregateEditBoundaryImpact[] = []
    await expect(prepareCompositionCommands(project, [{ type: 'moveVertex', id: 'vertex-0', positionMm: { x: 3500, y: 3000 } }],
      { runtime, validation, onAggregateBoundaryImpact: impact => reports.push(impact) })).rejects.toThrow(/锁/)
    expect(reports).toEqual([])
    expect(canonicalJson(project.document)).toBe(before)
    const unlocked = await building({ opening: true }), unchanged = canonicalJson(unlocked.document)
    await expect(prepareCompositionCommands(unlocked, [{ type: 'moveVertex', id: 'vertex-0', positionMm: { x: 10000, y: 10000 } }],
      { runtime, validation, onAggregateBoundaryImpact: impact => reports.push(impact) })).rejects.toThrow()
    expect(reports).toEqual([])
    expect(canonicalJson(unlocked.document)).toBe(unchanged)
  })
})
