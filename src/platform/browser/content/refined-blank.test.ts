import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument, createRefinedBlankProject, type RefinedVisualPalette } from './refined-blank.js'
import { createRefinedIslandDocument } from './refined-island.js'
import { createRefinedCoastDocument } from './refined-coast.js'
import { createRefinedInteriorDocument } from './refined-interior.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { inspectDependencies } from '../../../shared/commands/dependencies.js'
import { validateProjectData } from '../../../shared/project/validate.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'

const options = { title: '  独立精修空白  ', widthMm: 18000, heightMm: 12000, preset: 'tactical' as const, sceneId: 'new-refined-blank', now: '2026-10-26T00:00:00.000Z' }
const sources = { island: createRefinedIslandDocument, coast: createRefinedCoastDocument, interior: createRefinedInteriorDocument }
describe('new empty scenes expose refined fixed palettes', () => {
  it.each(['island', 'coast', 'interior'] as RefinedVisualPalette[])('copies only the exact %s fixed palette into a new empty scene', palette => {
    const blank = createRefinedBlankDocument(palette, options), source = sources[palette]()
    expect(blank.title).toBe('独立精修空白'); expect(blank.sceneId).toBe('new-refined-blank'); expect(blank.revision).toBe(0)
    expect(blank.floors['visual-floor'].boundsMm).toEqual({ x: 0, y: 0, width: 18000, height: 12000 })
    expect(blank.units).toMatchObject({ display: 'ft', gridSizeMm: 1524, snapMm: 254, gridVisible: true })
    for (const key of ['assets', 'propDefinitions', 'materials', 'styleThemes', 'activeStyleThemeRef', 'prefabDefinitions'] as const) expect(blank[key]).toEqual(source[key])
    for (const key of ['vertices', 'walls', 'openings', 'rooms', 'props', 'regions', 'notes', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups', 'entityLayers'] as const) expect(blank[key]).toEqual({})
    expect(blank.constraints.entranceOpeningIds).toEqual([])
    expect(blank.visual).toEqual(emptyVisualSystem())
    expect(Object.keys(blank.assets).every(id => id.startsWith(`refined-art-${palette}-`))).toBe(true)
    // A metadata check exercises the complete dependency closure including the
    // interior fixed prefab definitions and exact theme references. Pixel proof
    // stays with the actual browser raster/decode test, not this metadata test.
    let counter = 0
    const content = createCompositionContent(blank, { ids: { nextId: () => `empty-${++counter}` }, clock: { now: () => options.now } })
    const hash = '0'.repeat(64), text = 'original fixture licence', licenseHash = sha256Bytes(encodeUtf8(text))
    const project = validateProjectData({ format: 'sceneweave-complete-project', schemaVersion: 2, ...content,
      assets: { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: 100, pixelWidth: 512, pixelHeight: 512 } },
      licenses: { [licenseHash]: { sha256: licenseHash, text } }, licenseBindings: inspectDependencies(blank).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })), authoringSources: {} })
    expect(Object.keys(project.document.props)).toHaveLength(0)
    Object.values(blank.propDefinitions)[0].name = 'mutated independent palette'
    expect(createRefinedBlankDocument(palette, options).propDefinitions).toEqual(source.propDefinitions)
  })
  it('rejects invalid palette/options and cancellation before any rasterization', async () => {
    expect(() => createRefinedBlankDocument('other' as RefinedVisualPalette, options)).toThrow()
    expect(() => createRefinedBlankDocument('island', { ...options, widthMm: 0 })).toThrow()
    const controller = new AbortController(); controller.abort()
    await expect(createRefinedBlankProject('coast', options, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
