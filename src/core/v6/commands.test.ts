import { describe, expect, it } from 'vitest'
import { scatterLayerSceneV3 } from '../v3/test-fixtures'
import { createCompositionContentV6 } from './graph'
import { applyCompositionCommandsV6 } from './commands'

describe('C4 outdoor identity tracing through native transactions', () => {
  it('invalidates topology continuity when one atomic batch changes topology and changes it back', () => {
    const source = createCompositionContentV6(scatterLayerSceneV3())
    const area = source.document.terrainAreas.domain, originalSegment = area.boundaryMm[0].segmentId
    const changed = structuredClone(area.boundaryMm)
    ;[changed[0].segmentId, changed[1].segmentId] = [changed[1].segmentId, changed[0].segmentId]

    const result = applyCompositionCommandsV6(source, [
      { type: 'updateTerrainArea', id: area.id, changes: { boundaryMm: changed } },
      { type: 'updateTerrainArea', id: area.id, changes: { boundaryMm: area.boundaryMm } },
    ])

    expect(result.document.terrainAreas.domain.boundaryMm[0].segmentId).toBe(originalSegment)
    expect(result.document.revision).toBe(source.document.revision)
    expect(result.historyIdentity.outdoorTokens.domain.topologyHash).toBe(source.historyIdentity.outdoorTokens.domain.topologyHash)
    expect(result.historyIdentity.outdoorTokens.domain.topologyToken).not.toBe(source.historyIdentity.outdoorTokens.domain.topologyToken)
  })

  it('rejects deleting and reusing an outdoor identity inside one transaction', () => {
    const source = createCompositionContentV6(scatterLayerSceneV3())
    const path = { type: 'createPath' as const, id: 'ephemeral-path', floorId: 'blank-floor',
      centerlineMm: [{ x: 2000, y: 8000 }, { x: 8000, y: 8000 }], widthMm: 500,
      supportRefs: [{ kind: 'terrainArea' as const, id: 'domain' }] }

    expect(() => applyCompositionCommandsV6(source, [path,
      { type: 'deleteOutdoorEntity', kind: 'path', id: path.id }, path,
    ])).toThrow(/不能复用已分配的室外 ID/)

    const created = applyCompositionCommandsV6(source, [path])
    const deleted = applyCompositionCommandsV6(created, [{ type: 'deleteOutdoorEntity', kind: 'path', id: path.id }])
    expect(() => applyCompositionCommandsV6(deleted, [path])).toThrow(/不能复用/)
  })
})
