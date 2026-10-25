import { describe, expect, it } from 'vitest'
import { svgProjectFixture, SVG_FIXTURE_SOURCE } from '../../../tests/helpers/m24-svg-fixtures.js'
import { applyAuthoringStep, authoringProjectHash, checkAuthoringDraft, replayAuthoring } from './authoring.js'
import type { AuthoringOperation, AuthoringStart, AuthoringStep } from './authoring-protocol.js'
import { createCompositionContent } from '../appearance/graph.js'
import { canonicalJson, cloneJson } from '../validation/json.js'

function start(): AuthoringStart {
  const project = svgProjectFixture().bundle.project
  project.document.props.other = { ...cloneJson(project.document.props.item), id: 'other', positionMm: { x: 6000, y: 4000 } }
  project.document.entityLayers.other = project.document.entityLayers.item
  let counter = 0
  Object.assign(project, createCompositionContent(project.document, { ids: { nextId: () => `m2-closure-token-${++counter}` }, clock: { now: () => '2026-10-25T00:00:00.000Z' } }))
  return { schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), seed: 'fcb3353d-8c8f-4890-b002-a9f5a464a769',
    preparedAt: '2026-10-25T00:00:00.000Z', skill: { id: 'sceneweave-artwork-authoring', version: 1 }, disclosure: 'complete-metadata/public-model',
    scope: { targetIds: ['item'], operations: ['transform', 'delete'], placement: null,
      artwork: { mode: 'range', targetIds: ['item'], boundsMm: { x: 0, y: 0, width: 7000, height: 7000 }, operations: ['svg', 'style'] } } }
}
const style: AuthoringOperation = { kind: 'style', ids: ['item'], brightness: .5 }
const svg: AuthoringOperation = { kind: 'svg', id: 'item', sourceSvg: SVG_FIXTURE_SOURCE, longEdgePx: 16, name: 'Fixed SVG variation' }
const outside: AuthoringOperation = { kind: 'transform', id: 'item', positionMm: { x: 9000, y: 9000 } }

describe('M2 final artwork range and cumulative ledger closure', () => {
  it.each([style, svg])('rejects a deferred $kind recipe moved outside the range in the same atomic step', operation => {
    const input = start(), initial = replayAuthoring(input, []), before = canonicalJson(input.project)
    expect(() => applyAuthoringStep(input, initial.state, [operation, outside], 'outside')).toThrow(/范围/)
    expect(canonicalJson(input.project)).toBe(before)
    expect(replayAuthoring(input, [])).toEqual(initial)
  })

  it('preserves a successful artwork step when a later step would move its target outside the range', () => {
    const input = start(), first = applyAuthoringStep(input, replayAuthoring(input, []).state, [style], 'artwork')
    const before = canonicalJson(first)
    expect(() => applyAuthoringStep(input, first.state, [outside], 'outside')).toThrow(/范围/)
    expect(canonicalJson(first)).toBe(before)
    expect(checkAuthoringDraft(input, first.state).valid).toBe(true)
  })

  it.each([style, svg])('rejects deleting a deferred $kind target before materialization', operation => {
    const input = start(), initial = replayAuthoring(input, [])
    expect(() => applyAuthoringStep(input, initial.state, [operation, { kind: 'delete', id: 'item' }], 'delete')).toThrow(/删除/)
    expect(input.project.document.props.item).toBeDefined()
    expect(replayAuthoring(input, [])).toEqual(initial)
  })

  it('allows a final in-range move and keeps an unselected same-definition object outside the artwork grant', () => {
    const input = start(), initial = replayAuthoring(input, [])
    const edited = applyAuthoringStep(input, initial.state, [style, { kind: 'transform', id: 'item', positionMm: { x: 5500, y: 5500 } }], 'inside')
    expect(edited.state.operationCost).toBe(5)
    expect(edited.project.document.props.item.positionMm).toEqual({ x: 5500, y: 5500 })
    expect(replayAuthoring(input, edited.state.steps)).toEqual(edited)
    expect(() => applyAuthoringStep(input, initial.state, [{ kind: 'style', ids: ['other'], opacity: .5 }], 'unselected')).toThrow(/冻结外观范围/)
  })

  it('counts repeated styles and SVG recipes together through 256 and rejects the next step atomically', () => {
    const input = start(), operations: AuthoringOperation[] = [svg, ...Array.from({ length: 61 }, () => style),
      ...Array.from({ length: 3 }, (): AuthoringOperation => ({ kind: 'style', ids: ['item'], opacity: 1 }))]
    const steps: AuthoringStep[] = []
    for (let offset = 0; offset < operations.length; offset += 16) steps.push({ index: steps.length + 1, stepId: `budget-${steps.length + 1}`, operations: operations.slice(offset, offset + 16) })
    const full = replayAuthoring(input, steps), before = canonicalJson(full)
    expect(full.state.operationCost).toBe(256)
    expect(() => applyAuthoringStep(input, full.state, [{ kind: 'style', ids: ['item'], opacity: 1 }], 'overflow')).toThrow(/256/)
    expect(canonicalJson(full)).toBe(before)
    expect(replayAuthoring(input, full.state.steps)).toEqual(full)
  })
})
