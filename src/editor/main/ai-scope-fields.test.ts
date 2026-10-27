import { describe, expect, it } from 'vitest'
import data from '../../platform/browser/content/scenes-data.json'
import type { ProjectData } from '../../shared/model/project'
import { extendedAuthoringScope, initialExtendedScope, sceneOperationLabels } from './AiScopeFields'

const project = structuredClone(data.scenes.blank) as unknown as ProjectData

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
    complete.schemaVersion = 3
    complete.document.schemaVersion = 3
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

  it('keeps T6 operations v3-only and visual grants v2-only', () => {
    const value = { ...initialExtendedScope(), scene: true, visual: true }
    const legacy = extendedAuthoringScope(value, project, 'floor-ground', 'layer-ground', [])
    expect(legacy.scene?.operations).not.toContain('terrainGenerate')
    expect(legacy.visual).toBeUndefined()

    const complete = structuredClone(project)
    complete.schemaVersion = 3
    complete.document.schemaVersion = 3
    const v3 = extendedAuthoringScope(value, complete, 'floor-ground', 'layer-ground', [])
    expect(v3.scene?.operations).toContain('terrainGenerate')
    expect(v3.visual).toBeUndefined()
  })
})
