import { toBundle } from '../../src/application/workspace/project'
import { createSceneCollectionSelectionDocument, materializeSceneCollectionDocument } from '../../src/platform/browser/content/scene-collection-catalog'
import { browserProjectValidation } from '../../src/platform/browser/project-validation'
import { runtime } from '../../src/platform/browser/runtime'
import { surfacesTracesDefinitionId } from '../../src/shared/assets/surfaces-traces-collection'
import { defaultMaterialPaint } from '../../src/shared/appearance/surface-paint'
import { applyCommands } from '../../src/shared/commands/commands'
import { createTerrainRelief, sampleTerrainRelief } from '../../src/shared/geometry/terrain-relief'
import { extractTerrainContours, simplifyTerrainContour, terrainValueNoise } from '../../src/shared/terrain-generation/field'
import { exportProject } from '../../src/shared/project/file'

const bounds = { x: 0, y: 0, width: 42000, height: 33000 }
const noise = (feature: string, x: number, y: number, scale: number) => terrainValueNoise('snow-pass-ridge', feature, x / scale, y / scale)
const relief = createTerrainRelief(bounds, ({ x, y }) => {
  const ridge = (cx: number, cy: number, width: number, depth: number, height: number, angle: number, phase: number) => {
    const dx = x - cx, dy = y - cy, c = Math.cos(angle), s = Math.sin(angle), u = (dx * c + dy * s) / width, v = (-dx * s + dy * c) / depth
    const bearing = Math.atan2(v, u), radius = Math.hypot(u, v)
    const spur = Math.cos(bearing * 3 + phase) * .14 + Math.cos(bearing * 6 - .4) * .10 + Math.sin(bearing * 9 + phase) * .035
    return Math.max(0, 1 - radius / (1 + spur)) * height
  }
  const crest = ridge(23300, 14500, 17700, 11900, 10900, -.18, 1.6)
  const spur = ridge(30000, 12100, 10400, 7200, 7700, -.58, 2.9)
  const shoulder = ridge(28700, 22100, 12300, 9400, 5390, -.52, 3.8)
  const foothill = ridge(10000, 24000, 8400, 6300, 1820, .35, 4.2)
  const mountain = Math.min(9100, Math.max(crest, spur, shoulder, foothill))
  const stratum = terrainValueNoise('snow-pass-ridge', 'strata', (x * .82 + y * .57) / 1180, (y * .82 - x * .57) / 3900)
  const grain = noise('weather', x, y, 2300) * 355 + noise('chips', x, y, 960) * 135 + stratum * 220
  const meadow = Math.max(0, 160 + noise('meadow', x, y, 7300) * 310)
  return meadow + mountain + Math.min(1, mountain / 1550) * grain
}, 420)

export async function snowPassInput() {
  const meadow = 'grass-surface-meadow-blades', scree = 'sand-surface-stony-desert', rock = 'stone-surface-slate-cleavage'
  const packed = 'snow-surface-packed', snow = 'snow-surface-firn', soil = 'earth-surface-trodden-loam'
  const keys = [meadow, scree, rock, packed, snow, soil]
  const scene = createSceneCollectionSelectionDocument(keys.map(surfacesTracesDefinitionId), { sceneId: 'automatic-road-snow-pass' })
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  scene.title = '雪山盘道'
  scene.units.snapMm = 50
  scene.floors[floorId].name = '风口与积雪沟'
  scene.floors[floorId].boundsMm = scene.exportBoundsMm = bounds
  scene.userLayers[layerId].name = '山体与道路'
  const material = (key: string, tint: string | null = null) => {
    const paint = defaultMaterialPaint(scene.materials[surfacesTracesDefinitionId(key)], 'terrain')
    const scale = key === rock || key === snow ? 1.65 : 1.2
    return { ...paint, tint, tileSizeMm: { width: Math.round(paint.tileSizeMm.width * scale), height: Math.round(paint.tileSizeMm.height * scale) } }
  }
  const terrain = (x: number, y: number) => sampleTerrainRelief(relief, bounds, { x, y })
  const snowCover = (x: number, y: number) => {
    const { offsetMm, normal } = terrain(x, y)
    const leeward = normal.y * 1400 - normal.x * 550
    const bareRock = Math.max(0, .83 - normal.z) * 5600
    const drifts = terrainValueNoise('snow-pass-ridge', 'drifts', (x + y * .34) / 3300, (y - x * .34) / 5600)
    return offsetMm + leeward - bareRock + drifts * 1750 + noise('melt', x, y, 1900) * 650
  }
  const bands = (key: string, tint: string | null, threshold: (x: number, y: number) => number, blendWidthMm: number, renderOrder: number, limit: number) =>
    extractTerrainContours({ widthMm: bounds.width, heightMm: bounds.height, columns: 100, rows: 80 }, threshold)
      .filter(row => row.closed && row.points.length >= 12).slice(0, limit).map((row, i) => ({
        id: `${key}-${i}`, boundaryMm: simplifyTerrainContour(row, 55), paint: material(key, tint), blendWidthMm, renderOrder,
      }))
  const overlays = [
    ...bands(scree, '#b9b8a9', (x, y) => terrain(x, y).offsetMm - 1790 + noise('foothills', x, y, 3400) * 1720, 255, 0, 4),
    ...bands(rock, '#e0dfdc', (x, y) => {
      const { offsetMm, normal } = terrain(x, y)
      return offsetMm - 3940 + noise('outcrop', x, y, 3500) * 2350 + (1 - normal.z) * 2900
    }, 150, 1, 4),
    ...bands(packed, '#aeb9c8', (x, y) => snowCover(x, y) - 5400, 130, 2, 6),
    ...bands(snow, null, (x, y) => snowCover(x, y) - 5660, 88, 3, 6),
  ]
  const document = applyCommands(scene, [{ type: 'createTerrainArea', id: 'snow-pass-hill', floorId, layerId,
    boundaryMm: [{ x: 0, y: 0 }, { x: bounds.width, y: 0 }, { x: bounds.width, y: bounds.height }, { x: 0, y: bounds.height }], relief,
    surfaceStyle: { base: material(meadow, '#e6e5da'), overlays },
  }], runtime)
  const project = await materializeSceneCollectionDocument(document)
  return [...await exportProject(toBundle(project), browserProjectValidation)]
}
