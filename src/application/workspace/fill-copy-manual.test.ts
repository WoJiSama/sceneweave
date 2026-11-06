import { describe, expect, it } from 'vitest'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { MANUAL_TRANSACTION_BUDGET } from '../../shared/budget/command-budget.js'
import { cloneJson } from '../../shared/validation/json.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { inspectFillCopy, prepareFillCopy } from './fill-copy.js'
import { fromBundle } from './project.js'
import { prepareCompositionCommands } from './prepare.js'

const request = { sourceId: 'camp', count: 100, stepMm: { x: 100, y: 0 }, allowOverlap: true }

describe('manual fill copy budget', () => {
  it('counts every copied prefab member and its new container', async () => {
    const source = fixture({ image: true }), current = await fromBundle(source, validation)
    const grouped = await prepareCompositionCommands(current, [{ type: 'createPrefab', id: 'camp', definitionId: 'camp-definition', name: 'Camp',
      ids: ['item', 'other'], anchorMm: { x: 5000, y: 5000 } }], { runtime, validation })
    expect(inspectFillCopy(grouped.document, request).issues.join(' ')).toMatch(/300.*256/)
    const manual = inspectFillCopy(grouped.document, request, MANUAL_TRANSACTION_BUDGET)
    expect(manual.minimumCost).toBe(300)
    expect(manual.issues.join(' ')).toMatch(/300.*256/)
    const prepared = await prepareFillCopy(grouped, { ...request, count: 2 }, { runtime, validation, budget: MANUAL_TRANSACTION_BUDGET })
    expect(prepared.cost).toEqual({ total: 6, limit: 256 })
    expect(Object.keys(prepared.project.document.prefabInstances)).toHaveLength(3)
    expect(Object.keys(prepared.project.document.props)).toHaveLength(6)
    expect(Object.keys(grouped.document.props)).toHaveLength(2)
  })

  it('keeps the independent candidate limit and rejects more than 256 actual member changes', () => {
    const scene = cloneJson(fixture().project.document), source = cloneJson(scene.props.item)
    const template = (prop: typeof source) => {
      const { id: _id, floorId: _floor, editLocked: _lock, visibility: _visibility, roomId: _room, supportRef: _support, ...value } = cloneJson(prop)
      return value
    }
    scene.prefabDefinitions.definition = { id: 'definition', catalogId: 'manual.fill.group', version: 1, licenseRef: 'MIT',
      origin: { kind: 'original', attribution: 'Test', canEmbed: true }, name: 'Group', tags: [],
      members: [{ key: 'a', propTemplate: template(source) }, { key: 'b', propTemplate: template(scene.props.other) }] }
    scene.prefabInstances.camp = { id: 'camp', floorId: 'blank-floor', editLocked: false, visibility: 'public', definitionRef: { id: 'definition', version: 1 },
      anchorMm: { ...source.positionMm }, rotationDeg: 0, members: { a: { propId: 'item', overrideFields: [] }, b: { propId: 'other', overrideFields: [] } } }
    scene.entityLayers.camp = scene.entityLayers.item
    const content = createCompositionContent(scene, runtime)
    expect(inspectFillCopy(content.document, { ...request, count: 129 }, MANUAL_TRANSACTION_BUDGET).issues.join(' ')).toMatch(/387.*256/)
    expect(inspectFillCopy(content.document, { ...request, count: 257 }, MANUAL_TRANSACTION_BUDGET).issues.join(' ')).toMatch(/最多检查256份/)
  })
})
