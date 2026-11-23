import { describe, expect, it } from 'vitest'
import { applyCommands } from '../commands/commands.js'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { sampleTerrainRelief, createTerrainRelief, reliefGridPoint } from './terrain-relief.js'
import { createSupportQuery } from './support-sample.js'
import { sculptTerrainRelief, touchedReliefTreads } from './terrain-relief-edit.js'

const box = { x: 2000, y: 2500, width: 6000, height: 6000 }
const boundary = [{ x: 2000, y: 2500 }, { x: 8000, y: 2500 }, { x: 8000, y: 8500 }, { x: 2000, y: 8500 }]

describe('editable relief', () => {
  it('uses the same two triangle sections for vertex heights, slope and support', () => {
    const grid = { version: 1 as const, columns: 2, rows: 2, offsetsMm: [0, 1000, 2000, 4400] }
    expect(reliefGridPoint(grid, box, 1, 1)).toEqual({ x: 8000, y: 8500 })
    const onTop = { x: 6500, y: 4000 }, onBottom = { x: 3500, y: 7000 }
    expect(sampleTerrainRelief(grid, box, onTop).offsetMm).toBe(1600)
    expect(sampleTerrainRelief(grid, box, onBottom).offsetMm).toBe(2100)

    const document = fixture().project.document
    const source = applyCommands(document, Object.keys(document.props).map(id => ({ type: 'deleteProp', id })), runtime)
    const after = applyCommands(source, [{ type: 'createTerrainArea', id: 'hill', floorId: 'blank-floor',
      boundaryMm: boundary, groundElevationMm: 550, relief: grid }], runtime)
    const same = createSupportQuery(after, 'blank-floor').sample(onTop)
    expect(same).toMatchObject({ rootSupportRef: { kind: 'terrainArea', id: 'hill' }, zMm: 2150 })
    expect(same?.normal).toEqual(sampleTerrainRelief(grid, box, onTop).normal)
    expect(createSupportQuery(after, 'blank-floor').sample({ x: 1999, y: 4000 })?.zMm).toBe(0)
  })

  it('marks the crossed tread and keeps its original height while lowering the neighboring ground', () => {
    const grid = createTerrainRelief(box, () => 500, 150)
    const step = [{ x: 4940, y: 5100 }, { x: 5170, y: 5100 }, { x: 5170, y: 5810 }, { x: 4940, y: 5810 }]
    const stroke = { points: [{ x: 5050, y: 5480 }], radiusMm: 1700, amountMm: -700 }
    const marks = touchedReliefTreads(stroke, [{ polygon: step, bounds: { x: 4940, y: 5100, width: 230, height: 710 } }], boundary)
    expect(marks).toEqual([step])
    const result = sculptTerrainRelief(boundary, grid, stroke, marks)
    expect(sampleTerrainRelief(result, box, { x: 5050, y: 5480 }).offsetMm).toBe(500)
    expect(sampleTerrainRelief(result, box, { x: 5750, y: 5500 }).offsetMm).toBeLessThan(450)
    expect(grid.offsetsMm.every(height => height === 500)).toBe(true)
  })
})
