import { createOpenOceanDocument } from '../../src/platform/browser/content/open-ocean.js'
import { materializeSceneCollectionDocument } from '../../src/platform/browser/content/scene-collection-catalog.js'
import { validateSceneDocument } from '../../src/shared/validation/scene.js'
import { exportProject, importProject } from '../../src/shared/project/file.js'
import { toBundle } from '../../src/application/workspace/project.js'
import { validation } from '../../src/platform/browser/runtime.js'

/** Authored validation inputs, prepared before and outside any measurement.
 * Every entry is a complete real-size Prop backed by the original fixed art. */
export async function prepareOceanCapacityFixture(count: 500 | 2000) {
  const scene = structuredClone(createOpenOceanDocument({ sceneId: `ocean-capacity-${count}`, now: '2026-11-17T00:00:00.000Z' }))
  const bounds = { x: 0, y: 0, width: 180000, height: 180000 }, water = scene.terrainAreas['ocean-open-water']
  scene.title = `海洋容量 ${count}`; scene.exportBoundsMm = bounds
  scene.floors['collection-floor'] = { ...scene.floors['collection-floor'], boundsMm: bounds, outputBoundsMm: bounds }
  scene.units.gridSizeMm = 3600; scene.units.gridVisible = true
  water.boundaryMm = [{ x: 0, y: 0 }, { x: 180000, y: 0 }, { x: 180000, y: 180000 }, { x: 0, y: 180000 }]
    .map((positionMm, i) => ({ id: `${water.id}-p${i}`, segmentId: `${water.id}-s${i}`, positionMm }))
  water.waterSurface = { ...water.waterSurface!, waveSpacingMm: 4500 }
  Object.values(scene.props).forEach((prop, index) => { prop.positionMm = { x: 15000 + index % 4 * 15000, y: index < 4 ? 8000 : 19500 }; prop.rotationDeg = 0 })
  const template = scene.props['ocean-dolphin']
  for (let i = 8; i < count; i++) {
    const id = `ocean-load-${i}`, index = i - 8, columns = count === 500 ? 25 : 50, step = count === 500 ? 7000 : 3500
    scene.props[id] = { ...structuredClone(template), id, positionMm: { x: 3000 + index % columns * step, y: 30000 + Math.floor(index / columns) * step },
      rotationDeg: 0, waterAppearance: { mode: 'submerged', depth: .35 } }
    scene.entityLayers[id] = 'collection-props'
  }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(checked.errors.map(e => e.message).join('; '))
  const project = await materializeSceneCollectionDocument(checked.document)
  const bytes = await exportProject(toBundle(project), validation)
  const cold = await importProject(bytes, validation)
  if (Object.keys(cold.project.document.props).length !== count) throw new Error('Cold full-Prop count differs')
  return bytes
}
