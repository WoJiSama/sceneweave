import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import manifest from '../../../assets/sceneweave-handdrawn-outdoor/manifest.json'
import { applyCommandsV2 } from '../../core/v2/commands'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import { pointInPolygonV2, propFootprintV2, supportSurfaceAtV2 } from '../../core/v2/geometry'
import { validateSceneV2 } from '../../core/v2/schema'
import { checkTerrainTravelV2 } from '../../core/v2/terrain-travel'
import { inspectImageBytes } from '../../io/v2/resources'
import { validateIslandEditsV2 } from './island-constraints'
import { createIslandDocument, ISLAND_IDS, islandShallowWaterBoundaryMm } from './island-sample'

const scene = () => createIslandDocument({ sceneId: 'island-fixture', now: '2026-10-20T00:00:00.000Z' })
const file = (name: string) => readFile(new URL(`../../../public/assets/sceneweave-handdrawn-outdoor/${name}`, import.meta.url))
function pngPixels(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts: Uint8Array[] = []
  let cursor = 8
  while (cursor < bytes.length) {
    const length = view.getUint32(cursor), kind = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8))
    if (kind === 'IDAT') parts.push(bytes.subarray(cursor + 8, cursor + 8 + length))
    cursor += length + 12
  }
  const raw = inflateSync(Buffer.concat(parts)), width = view.getUint32(16), height = view.getUint32(20)
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0)
    pixels.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  return { pixels, width, height }
}

describe('VIS-02 complete editable fixture', () => {
  it('uses the prescribed two adjacent plateau contours on one floor and fixed export bounds', () => {
    const document = scene()
    expect(validateSceneV2(document).ok).toBe(true)
    expect(Object.keys(document.floors)).toEqual([ISLAND_IDS.floor])
    expect(document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 30000, height: 27000 })
    expect(document.terrainAreas[ISLAND_IDS.low].boundaryMm.map(point => [point.positionMm.x, point.positionMm.y])).toEqual([[4000, 8000], [9000, 3000], [18000, 4000], [14000, 6000], [14000, 13000], [18000, 19000], [24000, 18000], [18000, 24000], [7000, 22000], [3000, 15000]])
    expect(document.terrainAreas[ISLAND_IDS.high].boundaryMm.map(point => [point.positionMm.x, point.positionMm.y])).toEqual([[14000, 6000], [18000, 4000], [25000, 9000], [24000, 18000], [18000, 19000], [14000, 13000]])
    expect(document.terrainAreas[ISLAND_IDS.low].groundElevationMm).toBe(1000)
    expect(document.terrainAreas[ISLAND_IDS.high].groundElevationMm).toBe(3000)
    expect(document.terrainAreas[ISLAND_IDS.low].coveragePriority).toBe(document.terrainAreas[ISLAND_IDS.high].coveragePriority)
    expect(document.presetSnapshot).toMatchObject({ presetId: 'sceneweave-vis02', presetVersion: 1 })
    expect(document.constraints.pathChecks).toEqual([])
  })

  it('retains each exposed coastline and canonical shared edge exactly once, without the water frame', () => {
    const document = scene(), edges = Object.values(document.terrainEdges)
    expect(edges).toHaveLength(12)
    expect(edges.filter(edge => edge.shoreline)).toHaveLength(8)
    expect(edges.filter(edge => !edge.shoreline)).toHaveLength(4)
    expect(edges.every(edge => edge.kind === 'cliff' && edge.blocksMovement && !edge.blocksSight)).toBe(true)
    expect(edges.some(edge => edge.source.areaId === ISLAND_IDS.water)).toBe(false)
    const sources = edges.map(edge => `${edge.source.areaId}/${edge.source.segmentId}`)
    expect(new Set(sources).size).toBe(edges.length)
    expect(edges.filter(edge => edge.neighborAreaId === ISLAND_IDS.low).map(edge => edge.source.areaId)).toEqual(Array(4).fill(ISLAND_IDS.high))
    expect(edges.every(edge => document.terrainAreas[edge.source.areaId].boundaryMm.some(point => point.segmentId === edge.source.segmentId))).toBe(true)
  })

  it('keeps the explicit 2000 mm stairs, both 2000 mm approaches and nonwalkable water semantics', () => {
    const document = scene(), stairs = document.terrainConnections[ISLAND_IDS.connection]
    expect(stairs).toMatchObject({ kind: 'stairs', widthMm: 2000, openingId: null, blocksMovement: false,
      from: { surfaceRef: { kind: 'terrainArea', id: ISLAND_IDS.low }, positionMm: { x: 12500, y: 10000 } },
      to: { surfaceRef: { kind: 'terrainArea', id: ISLAND_IDS.high }, positionMm: { x: 15500, y: 10000 } } })
    expect(() => validateIslandEditsV2(document)).not.toThrow()
    expect(checkTerrainTravelV2(document, { floorId: ISLAND_IDS.floor, from: { x: 11500, y: 10000 }, to: { x: 16500, y: 10000 }, widthMm: 2000 }).ok).toBe(true)
    expect(document.terrainAreas[ISLAND_IDS.water].blocksMovement).toBe(true)
    expect(checkTerrainTravelV2(document, { floorId: ISLAND_IDS.floor, from: { x: 1000, y: 1000 }, to: { x: 2000, y: 1000 }, widthMm: 500 }).ok).toBe(false)
    expect(supportSurfaceAtV2(document, document.props['island-reef-1'].positionMm, ISLAND_IDS.floor)).toEqual({ kind: 'terrainArea', id: ISLAND_IDS.water })
    expect(Object.keys(document.terrainAreas)).toHaveLength(3)
  })

  it('adopts exactly 6 trees, 12 shrubs, 18 rocks and three separate nonblocking reef props', () => {
    const document = scene()
    expect(Object.values(document.props)).toHaveLength(39)
    expect(Object.fromEntries(Object.values(document.scatterGroups).map(group => [group.id, Object.values(group.members).filter(member => member.propId !== null).length]))).toEqual({ 'island-trees': 6, 'island-shrubs': 12, 'island-rocks': 18 })
    for (const group of Object.values(document.scatterGroups)) {
      expect(group.seed).toBe(`${group.id}-vis02-1`)
      expect(group.algorithmVersion).toBe('scatter-cell-v1')
      expect(group.gridOriginMm).toEqual({ x: 0, y: 0 })
      expect(group.exclusions[0]).toMatchObject({ reason: 'entrance', sourceCandidateKey: null,
        boundaryMm: [{ x: 10500, y: 9000 }, { x: 17500, y: 9000 }, { x: 17500, y: 11000 }, { x: 10500, y: 11000 }] })
      for (const [key, member] of Object.entries(group.members)) {
        expect(key).toMatch(/^[0-9a-f]{64}$/)
        expect(member.state).toBe('managed')
        expect(document.props[member.propId!].definitionRef).not.toBeNull()
        expect(propFootprintV2(document.props[member.propId!]).some(point => pointInPolygonV2(point, group.exclusions[0].boundaryMm))).toBe(false)
      }
    }
    expect(document.scatterGroups[ISLAND_IDS.scatterRocks].domain).toEqual({ kind: 'edgeBand', edgeId: 'island-high-edge-4', widthMm: 6000 })
    expect(Object.values(document.props).filter(prop => prop.id.startsWith('island-reef-'))).toHaveLength(3)
    expect(Object.values(document.props).filter(prop => prop.id.startsWith('island-reef-')).every(prop => !prop.blocksMovement && prop.supportRef.id === ISLAND_IDS.water)).toBe(true)
    expect(scene()).toEqual(document)
    expect(applyCommandsV2(document, [{ type: 'regenerateScatter', id: ISLAND_IDS.scatterRocks }])).toEqual(document)
  })

  it('preserves small physical trunks independently of canopy images and visual variants', () => {
    const document = scene(), definitions = Object.values(document.propDefinitions)
    const tree = definitions.find(definition => definition.catalogId === 'prop.sw.tree-broadleaf')!
    const sparse = definitions.find(definition => definition.catalogId === 'prop.sw.tree-sparse')!
    expect(tree.defaultFootprintMm).toEqual({ width: 600, height: 600 })
    expect(tree.defaultVisualBoundsMm).toEqual({ x: -2250, y: -2250, width: 4500, height: 4500 })
    expect(tree.defaultBlocksMovement).toBe(true); expect(tree.defaultBlocksSight).toBe(false)
    expect(tree.defaultRenderLayer).toBe('canopy'); expect(tree.defaultShadowClass).toBe('vegetation')
    expect(sparse.defaultFootprintMm).toEqual(tree.defaultFootprintMm)
    expect(sparse.defaultAppearance).not.toEqual(tree.defaultAppearance)
    expect(definitions.filter(definition => definition.catalogId.includes('shrub')).every(definition => definition.defaultShadowClass === 'vegetation' && !definition.defaultBlocksMovement)).toBe(true)
    expect(document.styleThemes[ISLAND_IDS.theme].shadowPresets.vegetation).toEqual({ directionDeg: 45, offsetMm: 350, blurMm: 180, opacity: .20, color: '#24313A' })
  })

  it('saves editable grass, bare rock, sand and one explicit shallow-water polygon with world phase', () => {
    const document = scene(), water = document.terrainAreas[ISLAND_IDS.water].surfaceStyle!
    expect(water.base.materialRef.id).toBe(ISLAND_IDS.materials.deep)
    expect(water.overlays[0].paint.materialRef.id).toBe(ISLAND_IDS.materials.shallow)
    expect(water.overlays[0].boundaryMm).toEqual(islandShallowWaterBoundaryMm(document))
    expect(water.overlays[0].boundaryMm).toHaveLength(8)
    expect(document.terrainAreas[ISLAND_IDS.high].surfaceStyle!.overlays[0].id).toBe(ISLAND_IDS.highOverlay)
    expect(document.terrainAreas[ISLAND_IDS.low].surfaceStyle!.overlays[0].id).toBe(ISLAND_IDS.lowOverlay)
    for (const area of Object.values(document.terrainAreas)) for (const paint of [area.surfaceStyle!.base, ...area.surfaceStyle!.overlays.map(overlay => overlay.paint)]) {
      expect(paint.originMm).toEqual({ x: 0, y: 0 }); expect(paint.alignment).toBe('world')
      expect(paint.tileSizeMm).toEqual(document.materials[paint.materialRef.id].defaultTileSizeMm)
    }
    const copy = structuredClone(document)
    copy.terrainAreas[ISLAND_IDS.low].boundaryMm[0].positionMm.x -= 200
    expect(islandShallowWaterBoundaryMm(copy)).not.toEqual(water.overlays[0].boundaryMm)
    expect(document.terrainAreas[ISLAND_IDS.low].boundaryMm[0].positionMm.x).toBe(4000)
  })

  it('retains the complete portable catalogue closure, concrete instance state and no default secrets', () => {
    const document = scene(), dependencies = collectDependenciesV2(document)
    expect(Object.values(document.assets)).toHaveLength(13)
    expect(Object.values(document.materials)).toHaveLength(6)
    expect(Object.values(document.propDefinitions)).toHaveLength(7)
    expect(dependencies.subjects).toHaveLength(27)
    expect(document.regions).toEqual({}); expect(document.notes).toEqual({})
    expect(Object.values(document.props).every(prop => prop.visibility === 'public')).toBe(true)
    const restored = JSON.parse(JSON.stringify(document))
    expect(validateSceneV2(restored).ok).toBe(true)
    expect(() => validateIslandEditsV2(restored)).not.toThrow()
    expect(restored).toEqual(document)
  })
})

describe('retained original outdoor art', () => {
  it('matches all real PNG bytes, headers, retained editable SVG and MIT provenance to their manifest', async () => {
    expect(manifest.status).toBe('P2')
    expect(manifest.longCastShadowBaked).toBe(false)
    expect(manifest.assets).toHaveLength(13)
    for (const asset of manifest.assets) {
      const bytes = await file(asset.file)
      expect(bytes.length, asset.key).toBe(asset.sizeBytes)
      expect(createHash('sha256').update(bytes).digest('hex'), asset.key).toBe(asset.sha256)
      expect(inspectImageBytes(bytes), asset.key).toEqual({ mimeType: 'image/png', width: asset.pixelWidth, height: asset.pixelHeight })
      const source = await readFile(new URL(`../../../assets/sceneweave-handdrawn-outdoor/${asset.sourceFile}`, import.meta.url), 'utf8')
      expect(createHash('sha256').update(source).digest('hex'), asset.key).toBe(asset.sourceSha256)
      expect(source).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
      expect(source).not.toMatch(/<image|<text|https?:\/\/(?!www\.w3\.org)|filter=|<script/)
    }
    expect(await file('manifest.json')).toEqual(await readFile(new URL('../../../assets/sceneweave-handdrawn-outdoor/manifest.json', import.meta.url)))
    expect(await file('LICENSE.txt')).toEqual(await readFile(new URL('../../../LICENSE', import.meta.url)))
  })

  it('verifies actual transparent padding and cleared RGB on every prop and opacity of every material', async () => {
    for (const asset of manifest.assets) {
      const { pixels, width, height } = pngPixels(await file(asset.file))
      let minX = width, minY = height, maxX = -1, maxY = -1, dirtyClearPixels = 0, translucent = 0
      for (let p = 0; p < pixels.length; p += 4) {
        const a = pixels[p + 3], x = (p / 4) % width, y = Math.floor(p / 4 / width)
        if (!a) { if (pixels[p] || pixels[p + 1] || pixels[p + 2]) dirtyClearPixels++ }
        else { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
        if (a < 255) translucent++
      }
      expect(dirtyClearPixels, asset.key).toBe(0)
      expect({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, asset.key).toEqual(asset.alphaContentBoundsPx)
      if (asset.kind === 'material') expect(translucent, asset.key).toBe(0)
      else expect(Math.min(minX, minY, width - maxX - 1, height - maxY - 1), asset.key).toBeGreaterThanOrEqual(8)
    }
  })

  it('keeps the specified 256 px/m sizes, colours and distinct canopy, shrub and stone variants', () => {
    const materials = manifest.assets.filter(asset => asset.kind === 'material')
    expect(materials.map(asset => [asset.key, asset.logicalSizeMm.width, asset.pixelWidth, asset.baseColor])).toEqual([
      ['grass', 4000, 1024, '#71865A'], ['rock', 2000, 512, '#777D72'], ['cliff-rock', 2000, 512, '#525E55'],
      ['sand', 4000, 1024, '#C4B486'], ['water-shallow', 4000, 1024, '#679A9B'], ['water-deep', 4000, 1024, '#345B73'],
    ])
    for (const asset of manifest.assets) {
      expect(asset.pixelWidth * 1000 / asset.logicalSizeMm.width).toBe(256)
      expect(asset.pixelHeight * 1000 / asset.logicalSizeMm.height).toBe(256)
    }
    const props = manifest.assets.filter(asset => asset.kind === 'prop')
    expect(props.map(asset => [asset.key, asset.pixelWidth, asset.pixelHeight])).toEqual([
      ['tree-broadleaf', 1152, 1152], ['tree-sparse', 1152, 1152], ['shrub-round', 448, 384], ['shrub-dry', 448, 384],
      ['rock-small', 320, 256], ['rock-small-worn', 320, 256], ['reef-decoration', 640, 512],
    ])
    expect(new Set(props.map(asset => asset.sha256)).size).toBe(7)
  })
})
