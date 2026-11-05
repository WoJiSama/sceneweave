import { toCurrentSceneDocument } from '../../shared/model/current-scene.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { runtime } from '../../application/workspace/test-fixtures.js'
import { describe, expect, it } from 'vitest'
import data from '../../platform/browser/content/scenes-data.json'
import type { ProjectData } from '../../shared/model/project'
import { extendedAuthoringScope, initialExtendedScope, sceneOperationLabels } from './AiScopeFields'

const fixed = structuredClone(data.scenes.blank) as unknown as ProjectData
const project: ProjectData = { ...fixed, schemaVersion: 1, ...createCompositionContent(toCurrentSceneDocument(fixed.document), runtime) }

describe('AI terrain and regional authorization scope', () => {
  it('labels all four terrain and regional operations in Chinese', () => {
    expect(sceneOperationLabels.terrainGenerate).toBe('生成自然地形')
    expect(sceneOperationLabels.terrainEdit).toBe('编辑或重生成地形')
    expect(sceneOperationLabels.regionalGenerate).toBe('生成区域地图')
    expect(sceneOperationLabels.regionalEdit).toBe('编辑区域地图')
  })

  it('keeps explicit generation layers and regional definitions in the scene grant', () => {
    const value = { ...initialExtendedScope(), scene: true, generationLayerIds: ['layer-secondary'], regionalDefinitionIds: ['symbol-tree'] }
    const complete = structuredClone(project)
    complete.schemaVersion = 1
    complete.document.schemaVersion = 1
    const scope = extendedAuthoringScope(value, complete, 'floor-ground', 'layer-ground', [])
    expect(scope.scene).toMatchObject({
      generationLayerIds: ['layer-secondary'],
      regionalDefinitionIds: ['symbol-tree'],
    })
  })

  it('does not emit empty optional grants', () => {
    const value = { ...initialExtendedScope(), scene: true }
    const scope = extendedAuthoringScope(value, project, 'floor-ground', 'layer-ground', [])
    expect(scope.scene).not.toHaveProperty('generationLayerIds')
    expect(scope.scene).not.toHaveProperty('regionalDefinitionIds')
  })

  it('uses current capabilities and explicit visual grants without an engineering version gate', () => {
    const value = { ...initialExtendedScope(), scene: true, visual: true }
    const scope = extendedAuthoringScope(value, project, 'floor-ground', 'layer-ground', [], true)
    expect(scope.scene?.operations).toContain('terrainGenerate')
    expect(scope.scene?.operations).toContain('connectionRoute')
    expect(scope.visual).toMatchObject({ floorId: 'floor-ground', layerId: 'layer-ground' })
    expect(scope).not.toHaveProperty('artwork')
  })
})
