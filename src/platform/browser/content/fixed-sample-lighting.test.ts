import { describe, expect, it } from 'vitest'
import data from './scenes-data.json'
import type { ProjectData } from '../../../shared/model/project.js'
import { validateProjectData } from '../../../shared/project/validate.js'
import { visualBase } from '../../../shared/visual/base.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'

describe('fixed ink-drawn sample light direction', () => {
  it.each(['study', 'island', 'outpost'] as const)('%s explicitly preserves its fixed southeast theme light in the current complete document', sample => {
    const input = data.scenes[sample], before = canonicalJson(input), project = validateProjectData(input), scene = project.document
    const theme = scene.styleThemes[scene.activeStyleThemeRef!.id]
    expect(Object.values(theme.shadowPresets).map(shadow => shadow.directionDeg)).toEqual([45, 45, 45, 45])
    expect(theme.terrainCliff.directionDeg).toBe(45)
    expect(visualBase(scene)!.environment.lightDirectionDeg).toBe(45)
    for (const audience of ['gm', 'player'] as const) expect(projectScene(scene, audience, project.appearance).visual!.environment.lightDirectionDeg).toBe(45)
    expect(canonicalJson(input)).toBe(before)
  })

  it('continues to honor an existing saved environment, including explicit instance shadow directions', () => {
    const project = cloneJson(data.scenes.study) as unknown as ProjectData
    visualBase(project.document)!.environment.lightDirectionDeg = 135
    const prop = Object.values(project.document.props).find(prop => prop.shadowClass === 'furniture')!
    prop.shadowOverride = { directionDeg: 225, offsetMm: 120, blurMm: 80, opacity: .22, color: '#24313A' }
    // This test intentionally reads a saved current document. It does not
    // replace a fixed source or claim an appearance graph edit transaction.
    const checked = projectScene(project.document, 'gm')
    expect(checked.visual!.environment.lightDirectionDeg).toBe(135)
    expect(checked.props.find(value => value.id === prop.id)!.shadowOverride!.directionDeg).toBe(225)
  })
})
