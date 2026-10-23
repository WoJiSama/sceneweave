import { describe, expect, it } from 'vitest'
import { validateSceneV3 } from '../../core/v3/schema'
import { createCompositionContentV6 } from '../../core/v6/graph'
import type { CompleteProjectV6 } from '../../io/v6/types'
import { projectSceneV3 } from '../../render/v3/projection'
import { createOutdoorBlankDocument } from './blank-project'
import { appendThemedCatalogDocument } from './themed-catalog'
import { createThemedSampleDocument, THEMED_SAMPLE_BOUNDS } from './themed-samples'

// Geometry-only checks. Real PNG decode/complete-byte checks run in the browser
// curation builder and the two small sample workflows, not in this provider.
function geometryProvider(): CompleteProjectV6 {
  const document = createOutdoorBlankDocument({ title: 'geometry fixture', widthMm: 20_000, heightMm: 20_000, preset: 'investigation' })
  appendThemedCatalogDocument(document)
  return { ...createCompositionContentV6(document), assets: {}, licenses: {}, licenseBindings: [] }
}
describe('editable content sample geometry', () => {
  it('builds real cemetery members and a paved path without changing the fixed provider', () => {
    const provider = geometryProvider(), before = structuredClone(provider)
    const scene = createThemedSampleDocument('graveyard', provider)
    const checked = validateSceneV3(scene)
    expect(checked.ok, checked.ok ? '' : JSON.stringify(checked.errors)).toBe(true)
    expect(scene.exportBoundsMm).toEqual(THEMED_SAMPLE_BOUNDS)
    expect(Object.keys(scene.prefabInstances)).toHaveLength(4)
    expect(Object.values(scene.prefabInstances).every(group => Object.values(group.members).every(member => member.propId && scene.props[member.propId]))).toBe(true)
    expect(scene.paths['graveyard-walk'].widthMm).toBe(1800)
    expect(projectSceneV3(scene, 'player').notes.some(note => note.id === 'graveyard-gm-clue')).toBe(false)
    expect(scene.sceneId).not.toBe(provider.document.sceneId)
    expect(provider).toEqual(before)
  })
  it('keeps lava visuals, danger and ramp geometry explicit and independently editable', () => {
    const scene = createThemedSampleDocument('volcano', geometryProvider())
    const checked = validateSceneV3(scene)
    expect(checked.ok, checked.ok ? '' : JSON.stringify(checked.errors)).toBe(true)
    expect(scene.terrainAreas['volcano-lava-visual'].blocksMovement).toBe(false)
    expect(scene.regions['volcano-lava-hazard']).toMatchObject({ kind: 'hazard', blocksMovement: true, movementCostMultiplier: 3 })
    expect(scene.terrainConnections['volcano-access-ramp']).toMatchObject({ kind: 'ramp', widthMm: 1800 })
    expect(Object.keys(scene.terrainEdges)).toHaveLength(4)
    expect(Object.keys(scene.prefabInstances)).toHaveLength(2)
    expect(projectSceneV3(scene, 'player').notes.some(note => note.id === 'volcano-gm-clue')).toBe(false)
  })
})
