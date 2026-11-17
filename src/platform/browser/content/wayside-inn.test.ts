import { describe, expect, it } from 'vitest'
import { createWaysideInnDocument, INN_ROOMS } from './wayside-inn.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { canonicalJson } from '../../../shared/validation/json.js'

describe('complete inn built through ordinary purpose planner', () => {
  it('keeps eight connected uses, full dimensions, actual shared walls, purposeful furniture and GM privacy', () => {
    const result = createWaysideInnDocument()
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(Object.keys(result.document.rooms)).toHaveLength(INN_ROOMS.length)
    expect(Object.values(result.document.openings).filter(row => row.kind === 'door')).toHaveLength(8)
    expect(Object.keys(result.document.props).length).toBeGreaterThanOrEqual(30)
    expect(result.reports.flatMap(report => report.missing)).toEqual([])
    expect(canonicalJson(projectScene(result.document, 'gm'))).toContain('柜台记事')
    expect(canonicalJson(projectScene(result.document, 'player'))).not.toContain('柜台记事')
    expect(result.document.generation!.legacy.recipes).toEqual({})
  })
})
