import { describe, expect, it } from 'vitest'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { aggregateSceneSource } from '../../shared/aggregates/contracts.js'
import { cloneJson } from '../../shared/validation/json.js'
import { inspectAggregateEdit } from './aggregate-boundary.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'

function inspectMove(...args: Parameters<typeof inspectAggregateEdit>) {
  return inspectAggregateEdit(...args)?.groups[0]
}
async function baseline(options: { grouped?: boolean; largeVisual?: boolean; offsetFootprint?: boolean; secondGroup?: boolean; sameGroup?: boolean } = {}): Promise<EditableProject> {
  const bundle = fixture(), project = cloneJson(bundle.project), scene = project.document
  if (options.largeVisual) scene.props.item.visualBoundsMm = { x: -2000, y: -100, width: 4000, height: 200 }
  if (options.offsetFootprint) scene.props.item.footprintOffsetMm = { x: 4000, y: 5000 }
  if (options.grouped !== false) scene.aggregateCoordinates = { encoding: 'world', groups: {
    house: { id: 'house', floorId: 'blank-floor', parentId: null, editLocked: false,
      frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [{ kind: 'prop', id: 'item' }] },
  } }
  if (options.secondGroup) scene.aggregateCoordinates!.groups.neighbor = { ...cloneJson(scene.aggregateCoordinates!.groups.house), id: 'neighbor', members: [{ kind: 'prop', id: 'other' }] }
  if (options.sameGroup) scene.aggregateCoordinates!.groups.house.members.push({ kind: 'prop', id: 'other' })
  Object.assign(project, createCompositionContent(scene, runtime))
  return fromBundle({ project, resources: bundle.resources }, validation)
}
function moved(project: EditableProject, positionMm = { x: 9000, y: 9000 }, rotationDeg = 0) {
  const draft = cloneJson(project.document)
  draft.props.item.positionMm = positionMm; draft.props.item.rotationDeg = rotationDeg
  const commands: CompositionCommand[] = [{ type: 'updateProp', id: 'item', changes: { positionMm, rotationDeg } }]
  return { draft, commands }
}
const containsOther = (rows: NonNullable<ReturnType<typeof inspectMove>>['externalCandidates']['next']) =>
  rows.some(row => row.entity.kind === 'prop' && row.entity.id === 'other')

describe('ordinary aggregate prop move diagnostics', () => {
  it('derives an ordinary member move from the verified baseline and actual draft geometry', async () => {
    const project = await baseline(), { draft, commands } = moved(project)
    const impact = inspectMove(project, draft, commands)!
    expect(impact).toMatchObject({ source: aggregateSceneSource(project.document), groupId: 'house', baselineProofValid: true,
      queryScope: 'supplied-bounds', requiresFullDomainValidation: true })
    expect(impact.dependencyClosure.roots).toEqual([{ kind: 'prop', id: 'item' }])
    expect(containsOther(impact.externalCandidates.previous)).toBe(false)
    expect(containsOther(impact.externalCandidates.next)).toBe(true)
    expect(impact.externalCandidates.next.some(row => row.entity.id === 'item')).toBe(false)
    expect(project.document.props.item.positionMm).toEqual({ x: 4000, y: 4000 })
    expect(Object.isFrozen(impact)).toBe(true)
  })

  it('includes rotated visual bounds as well as physical occupancy', async () => {
    const project = await baseline({ largeVisual: true }), { draft, commands } = moved(project, { x: 7650, y: 7650 }, 45)
    const visual = inspectMove(project, draft, commands)!
    // The 200mm physical footprint is far away; the actual rotated image
    // rectangle reaches the external prop and must still trigger review.
    expect(containsOther(visual.externalCandidates.next)).toBe(true)
    draft.props.item.rotationDeg = 90
    commands[0] = { type: 'updateProp', id: 'item', changes: { positionMm: draft.props.item.positionMm, rotationDeg: 90 } }
    expect(containsOther(inspectMove(project, draft, commands)!.externalCandidates.next)).toBe(false)
    const physicalProject = await baseline({ offsetFootprint: true }), physicalMove = moved(physicalProject, { x: 5000, y: 4000 })
    expect(containsOther(inspectMove(physicalProject, physicalMove.draft, physicalMove.commands)!.externalCandidates.next)).toBe(true)
  })

  it('reuses only the same immutable baseline closure while each moved range is queried afresh', async () => {
    const project = await baseline(), near = moved(project), far = moved(project, { x: 12000, y: 12000 })
    const first = inspectMove(project, near.draft, near.commands)!
    const again = inspectMove(project, near.draft, near.commands)!
    const changed = inspectMove(project, far.draft, far.commands)!
    expect(again.dependencyClosure).toBe(first.dependencyClosure)
    expect(changed.dependencyClosure).toBe(first.dependencyClosure)
    expect(changed).not.toBe(first)
    expect(containsOther(changed.externalCandidates.next)).toBe(false)
    const reopened = await fromBundle(toBundle(project), validation)
    const separate = inspectMove(reopened, near.draft, near.commands)!
    expect(separate.dependencyClosure).not.toBe(first.dependencyClosure)
    const updated = cloneJson(toBundle(project).project)
    updated.document.props.item.positionMm = { x: 5000, y: 5000 }
    updated.document.revision++
    const newer = await fromBundle({ project: updated, resources: project.resources }, validation)
    const newerMove = moved(newer)
    expect(inspectMove(newer, newerMove.draft, newerMove.commands)!.source).not.toEqual(first.source)
    // Retained undo wrappers must not keep an unbounded set of complete spatial
    // snapshots alive; revisiting an older wrapper rebuilds its private context.
    expect(inspectMove(project, near.draft, near.commands)!.dependencyClosure).not.toBe(first.dependencyClosure)
  })

  it('does not extend the path to unverified wrappers, proposal-only membership or other commands', async () => {
    const project = await baseline(), { draft, commands } = moved(project)
    expect(inspectMove({ ...project }, draft, commands)).toBeUndefined()
    expect(inspectMove(project, project.document, commands)).toBeUndefined()
    expect(inspectMove(project, draft, [])).toBeUndefined()
    expect(inspectAggregateEdit(project, draft, [...commands, ...commands])!.groups).toHaveLength(1)
    expect(inspectMove(project, draft, [{ type: 'deleteProp', id: 'item' }])).toBeUndefined()
    expect(inspectMove(project, draft, [{ type: 'updateProp', id: 'item', changes: {} }])).toBeUndefined()
    expect(inspectMove(project, draft, [{ type: 'updateProp', id: 'item', changes: { positionMm: draft.props.item.positionMm, visibility: 'public' } } as never])).toBeUndefined()
    const ungrouped = await baseline({ grouped: false }), proposal = moved(ungrouped)
    proposal.draft.aggregateCoordinates = cloneJson(project.document.aggregateCoordinates)
    expect(inspectMove(ungrouped, proposal.draft, proposal.commands)).toBeUndefined()
    const unowned: SceneDocument = cloneJson(project.document)
    unowned.props.other.positionMm = { x: 8000, y: 8000 }
    expect(inspectMove(project, unowned, [{ type: 'updateProp', id: 'other', changes: { positionMm: unowned.props.other.positionMm } }])).toBeUndefined()
  })
  it('replaces both moved external objects with their real candidate envelopes across groups', async () => {
    const project = await baseline({ secondGroup: true }), draft = cloneJson(project.document)
    const commands: CompositionCommand[] = ['item', 'other'].map(id => ({ type: 'updateProp', id, changes: { positionMm: { x: 7000, y: 7000 } } }))
    draft.props.item.positionMm = { x: 7000, y: 7000 }; draft.props.other.positionMm = { x: 7000, y: 7000 }
    const report = inspectAggregateEdit(project, draft, commands)!
    expect(report.groups.map(group => group.groupId)).toEqual(['house', 'neighbor'])
    for (const group of report.groups) {
      const otherId = group.groupId === 'house' ? 'other' : 'item'
      const near = group.externalCandidates.next.filter(row => row.entity.kind === 'prop')
      expect(near.length).toBeGreaterThan(0)
      expect(near.every(row => row.entity.id === otherId && row.boundsMm.x === 6900 && row.boundsMm.y === 6900)).toBe(true)
    }
    // An object leaving the old location must not linger in the next query.
    draft.props.item.positionMm = { x: 9000, y: 9000 }; draft.props.other.positionMm = { x: 12000, y: 12000 }
    const away = inspectAggregateEdit(project, draft, commands)!
    expect(away.groups[0].externalCandidates.next.some(row => row.entity.kind === 'prop')).toBe(false)
    expect(away.requiresSceneWideFallback).toBe(false)
  })

  it('keeps simultaneously moved same-group candidates internal', async () => {
    const same = await baseline({ sameGroup: true }), draft = cloneJson(same.document)
    const commands: CompositionCommand[] = ['item', 'other'].map(id => ({ type: 'updateProp', id, changes: { rotationDeg: 30 } }))
    draft.props.item.rotationDeg = 30; draft.props.other.rotationDeg = 30
    const report = inspectAggregateEdit(same, draft, commands)!
    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].externalCandidates.next.some(row => row.entity.kind === 'prop')).toBe(false)

  })

})
