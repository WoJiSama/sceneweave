import { describe, expect, it, vi } from 'vitest'
import data from './scenes-data.json'
import { createVolcanoBlankProject } from './factories.js'
import { validateProjectData } from '../../../shared/project/validate.js'
import { loadFixedResources } from './load-resources.js'

vi.mock('../runtime.js', () => ({
  runtime: { clock: { now: () => '2026-11-05T12:00:00.000Z' }, ids: { nextId: () => crypto.randomUUID() } }, validation: {},
}))
// This is palette assembly evidence. Production Chromium performs real fixed
// byte loading, image decoding and full project validation without these mocks.
vi.mock('./load-resources.js', () => ({ loadFixedResources: vi.fn(async () => new Map()) }))
vi.mock('../../../application/workspace/project.js', () => ({
  fromBundle: vi.fn(async (bundle: { project: object; resources: object }) => ({ ...bundle.project, resources: bundle.resources })),
}))

const options = { title: '火山空白素材', sceneId: 'volcano-blank-fixture', now: '2026-11-05T12:00:00.000Z', widthMm: 32000, heightMm: 24000, preset: 'narrative' as const }
describe('empty fixed volcanic palette', () => {
  it('copies exact immutable material/asset/licence records without sample structure or source graphs', async () => {
    const base = await createVolcanoBlankProject(options), { resources: _resources, ...metadata } = base
    const project = validateProjectData(metadata), source = data.scenes.volcano
    const ids = ['content-m-basalt', 'content-m-volcanic-ash', 'content-m-lava', 'content-m-lava-hot']
    expect(Object.keys(project.document.materials)).toEqual(ids)
    for (const id of ids) {
      const material = source.document.materials[id as keyof typeof source.document.materials]
      expect(project.document.materials[id]).toEqual(material)
      expect(project.document.assets[material.textureAssetId]).toEqual(source.document.assets[material.textureAssetId as keyof typeof source.document.assets])
    }
    for (const collection of ['vertices', 'walls', 'rooms', 'props', 'regions', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'notes', 'prefabInstances', 'scatterGroups', 'decorations', 'decorationClusters', 'surfaceRules'] as const) expect(project.document[collection]).toEqual({})
    expect(project.appearance.sources).toEqual({}); expect(project.historyIdentity.outdoorTokens).toEqual({})
    expect(project.document.styleThemes).toEqual({}); expect(project.document.propDefinitions).toEqual({}); expect(project.document.prefabDefinitions).toEqual({})
    expect(project.licenseBindings).toHaveLength(8)
    expect(Object.keys(project.assets)).toHaveLength(4)
    for (const binding of project.licenseBindings) expect(source.licenseBindings).toContainEqual(binding)
    expect(loadFixedResources).toHaveBeenCalledWith(project.assets, expect.any(Object), expect.any(Object), expect.any(Object))
    expect(project.document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 32000, height: 24000 })
  })
  it('rejects cancelled creation before loading resources', async () => {
    vi.mocked(loadFixedResources).mockClear()
    const controller = new AbortController(); controller.abort()
    await expect(createVolcanoBlankProject(options, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(loadFixedResources).not.toHaveBeenCalled()
  })
})
