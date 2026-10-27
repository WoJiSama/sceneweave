import { visualBase } from '../../../shared/visual/base.js'
import { describe, expect, it } from 'vitest'
import { createVisualSampleDocument, createVisualBlankDocument, createVisualBlankProject, type VisualSampleKind } from './visual-samples.js'
import { VISUAL_SAMPLE_ART } from '../../../shared/visual/sample-art.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { sampleVisualBoundary, terrainBoundaryChain } from '../../../shared/visual/geometry.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { validateProjectData } from '../../../shared/project/validate.js'
import { inspectDependencies } from '../../../shared/commands/dependencies.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { VISUAL_SAMPLE_LICENSE } from '../../../shared/visual/sample-art.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'

describe('original editable visual sample scenes', () => {
  it('normalizes every original bounded vector source with unique assets', () => {
    expect(VISUAL_SAMPLE_ART).toHaveLength(24)
    expect(new Set(VISUAL_SAMPLE_ART.map(art => art.key)).size).toBe(24)
    for (const art of VISUAL_SAMPLE_ART) {
      const normalized = normalizeStaticSvg(art.sourceSvg)
      expect(normalized.viewBox).toEqual({ x: 0, y: 0, width: 512, height: 512 })
      expect(normalized.sourceSizeBytes).toBeGreaterThan(100)
      expect(normalized.normalizedSource).not.toContain('href=')
    }
  })
  for (const kind of ['beach', 'island', 'interior'] as VisualSampleKind[]) it(`keeps ${kind} strict, independent and fully editable`, () => {
    const scene = createVisualSampleDocument(kind), original = structuredClone(scene)
    expect(scene.schemaVersion).toBe(2)
    expect(Object.keys(scene.props).length).toBeGreaterThan(15)
    expect(Object.keys(scene.assets)).toHaveLength(24)
    expect(Object.keys(scene.userLayers)).toHaveLength(4)
    expect(Object.values(scene.props).every(prop => !prop.editLocked && prop.visibility === 'public')).toBe(true)
    expect(Object.values(scene.materials).every(material => material.origin.kind === 'original')).toBe(true)
    const content = createCompositionContent(scene, { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => scene.createdAt } })
    const hash = sha256Bytes(encodeUtf8(VISUAL_SAMPLE_LICENSE))
    const checked = validateProjectData({ format: 'sceneweave-complete-project', schemaVersion: 2, ...content,
      assets: { ['0'.repeat(64)]: { sha256: '0'.repeat(64), mimeType: 'image/png', sizeBytes: 100, pixelWidth: 512, pixelHeight: 512 } },
      licenses: { [hash]: { sha256: hash, text: VISUAL_SAMPLE_LICENSE } }, licenseBindings: inspectDependencies(scene).subjects.map(subject => ({ ...subject, licensePath: `licenses/${hash}.txt`, embedding: 'allowed' })), authoringSources: {} })
    expect(checked.document.schemaVersion).toBe(2)
    expect(scene).toEqual(original)
    scene.props[Object.keys(scene.props)[0]].positionMm.x += 1
    expect(createVisualSampleDocument(kind)).toEqual(original)
  })
  it('uses the same real curve samples on both beach terrain boundaries', () => {
    const scene = createVisualSampleDocument('beach'), curve = visualBase(scene)!.boundaries['beach-coast']
    if (curve.binding.kind !== 'terrain') throw new Error('expected shared terrain curve')
    const sample = sampleVisualBoundary(curve).points
    const sides = curve.binding.sides.map(side => terrainBoundaryChain(scene.terrainAreas[side.areaId], side, false).map(point => point.positionMm))
    expect(sides[0]).toEqual(sample)
    expect(sides[1]).toEqual([...sample].reverse())
    expect(scene.terrainAreas['beach-water'].blocksMovement).toBe(true)
  })
  it('keeps two island elevations with a physical stair, and shared indoor wall and entrance', () => {
    const island = createVisualSampleDocument('island')
    expect(island.terrainAreas['island-high'].groundElevationMm).toBe(2600)
    expect(island.terrainAreas['island-low'].groundElevationMm).toBe(800)
    expect(island.terrainConnections['island-stairs'].kind).toBe('stairs')
    const inn = createVisualSampleDocument('interior')
    expect(Object.keys(inn.rooms)).toHaveLength(2)
    expect(Object.keys(inn.walls)).toHaveLength(7)
    expect(inn.constraints.entranceOpeningIds).toHaveLength(1)
    expect(Object.values(visualBase(inn)!.lights).every(light => light.wallOcclusion)).toBe(true)
    for (const key of ['stove', 'counter', 'cupboard', 'barrel', 'basket']) expect(Object.values(inn.props).some(prop => prop.definitionRef?.id === `visual-prop-${key}`)).toBe(true)
  })
  it('creates a bounded empty visual scene with searchable kitchen and full original palette', () => {
    const scene = createVisualBlankDocument({ title: '  AI视觉空白  ', widthMm: 24000, heightMm: 18000, preset: 'tactical', sceneId: 'visual-blank-test', now: '2026-10-25T00:00:00.000Z' })
    expect(scene.title).toBe('AI视觉空白'); expect(scene.sceneId).toBe('visual-blank-test')
    expect(scene.units).toMatchObject({ gridSizeMm: 1524, snapMm: 254, display: 'ft', gridVisible: true })
    expect(scene.visual).toEqual(emptyVisualSystem())
    for (const collection of ['props', 'rooms', 'walls', 'openings', 'terrainAreas', 'terrainConnections', 'paths', 'notes', 'scatterGroups', 'prefabInstances'] as const) expect(scene[collection]).toEqual({})
    expect(Object.keys(scene.assets)).toHaveLength(24)
    expect(Object.keys(scene.materials)).toHaveLength(7)
    expect(Object.keys(scene.propDefinitions)).toHaveLength(17)
    for (const key of ['stove', 'counter', 'cupboard', 'barrel', 'basket']) expect(scene.propDefinitions[`visual-prop-${key}`].tags).toContain('kitchen')
    expect(scene.materials['visual-material-wood'].tags).toContain('木地板')
    const another = createVisualBlankDocument({ title: '其他', widthMm: 20000, heightMm: 15000, preset: 'narrative' })
    expect(another.sceneId).not.toBe(scene.sceneId)
    expect(another.floors['visual-floor'].boundsMm).toEqual({ x: 0, y: 0, width: 20000, height: 15000 })
  })
  it('rejects invalid blank options and cancellation before any raster work', async () => {
    const options = { title: 'blank', widthMm: 24000, heightMm: 18000, preset: 'narrative' as const }
    expect(() => createVisualBlankDocument({ ...options, widthMm: 0 })).toThrow()
    expect(() => createVisualBlankDocument({ ...options, unknown: true } as never)).toThrow()
    const controller = new AbortController(); controller.abort()
    await expect(createVisualBlankProject(options, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
