import type { MaterialPaint, PointMm, SceneDocument, SurfaceOverlay } from '../../../shared/model/scene.js'
import { polygonInside, terrainPoints } from '../../../shared/geometry/geometry.js'
import { polygonBoolean } from '../../../shared/geometry/polygon-boolean.js'

const prefix = 'outpost-transition-'
const loamId = 'theme-pack-wilderness-material-forest-loam-v2'
const round = (x: number, y: number): PointMm => ({ x: Math.round(x), y: Math.round(y) })

/** Saved appearance for the newly constructed, level outpost composition.
 * The road band and camp surfaces remain authoritative for physical geometry.
 * This is a construction step, never an open-time or regeneration hook. */
export function applyOutpostSurfaceTransitions(scene: SceneDocument): void {
  const ground = scene.terrainAreas['sample-ground'], material = scene.materials[loamId]
  const camps = ['sample-camp', 'sample-abandoned-camp'].map(id => scene.terrainAreas[id])
  const paths = Object.values(scene.paths).sort((a, b) => a.id.localeCompare(b.id))
  if (!ground?.surfaceStyle || !material || material.version !== 2 || !scene.openings['watch-entrance']
    || !paths.length || camps.some(camp => !camp)
    || Object.values(scene.terrainAreas).some(area => area.floorId !== ground.floorId || area.groundElevationMm !== 0
      || area.visibility !== 'public' || area.editLocked || scene.userLayers[scene.entityLayers[area.id]]?.editLocked)
    || paths.some(path => path.floorId !== ground.floorId || path.visibility !== 'public' || path.editLocked
      || scene.userLayers[scene.entityLayers[path.id]]?.editLocked || path.surfaceStyle?.base.materialRef.id !== loamId
      || path.supportRefs.some(ref => ref.kind !== 'terrainArea' || !scene.terrainAreas[ref.id]))) {
    throw new Error('地表融合只用于新建的同层、同高程公开哨站样板；道路与营地须保留明确支撑和固定腐土材质。')
  }
  if (ground.surfaceStyle.overlays.some(overlay => overlay.id.startsWith(prefix))) {
    throw new Error('哨站地表过渡已存在，不覆盖已有外观或人工修改。')
  }
  const bounds = terrainPoints(ground), minX = Math.min(...bounds.map(p => p.x)), maxX = Math.max(...bounds.map(p => p.x))
  const minY = Math.min(...bounds.map(p => p.y)), maxY = Math.max(...bounds.map(p => p.y))
  const paint: MaterialPaint = { materialRef: { id: material.id, version: material.version },
    tileSizeMm: { ...material.defaultTileSizeMm }, alignment: 'world', originMm: { x: 0, y: 0 },
    rotationDeg: 0, tint: null, opacity: 1 }
  const overlays: SurfaceOverlay[] = []
  const add = (id: string, boundaryMm: PointMm[], blendWidthMm: number) => {
    if (!polygonInside(boundaryMm, bounds)) throw new Error('哨站地表过渡超出真实地面，未创建任何覆盖。')
    overlays.push({ id: `${prefix}${id}`, boundaryMm, paint: structuredClone(paint), blendWidthMm,
      renderOrder: 10 + overlays.length })
  }
  for (const [pathIndex, path] of paths.entries()) {
    const strips: PointMm[][] = []
    for (let index = 1; index < path.centerlineMm.length; index++) {
      const a = path.centerlineMm[index - 1], b = path.centerlineMm[index], dx = b.x - a.x, dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      if (!length) throw new Error('哨站道路含重合节点，不能创建地表过渡。')
      const tx = dx / length, ty = dy / length, nx = -ty, ny = tx, half = path.widthMm / 2
      const phase = (pathIndex * 3 + index) % 5, extension = Math.min(220, length / 10)
      const at = (t: number, distance: number) => round(a.x + tx * t + nx * distance, a.y + ty * t + ny * distance)
      // Each shoulder changes width along the segment and differs from the other
      // side. The saved integer ring is independent of camera and export scale.
      strips.push([at(-extension, half + 260 + phase * 55),
        at(length * .45, half + 640 - phase * 45), at(length + extension, half + 350 + phase * 25),
        at(length + extension, -half - 520 + phase * 35), at(length * .6, -half - 260 - phase * 65),
        at(-extension, -half - 440 + phase * 30)])
    }
    // One mask per road avoids a new full-canvas raster pass at every bend.
    const merged = polygonBoolean({ operation: 'union', subject: strips, clip: [] })
    if (merged.polygons.length !== 1 || merged.polygons[0].holes.length) throw new Error('哨站道路过渡须形成一个无孔连续外观轮廓。')
    add(path.id, merged.polygons[0].outer, 260 + pathIndex * 60)
  }
  for (const [campIndex, camp] of camps.entries()) {
    const points = terrainPoints(camp), center = points.reduce((value, point) => ({ x: value.x + point.x / points.length,
      y: value.y + point.y / points.length }), { x: 0, y: 0 })
    // The same world-aligned paint continues beneath the true camp boundary;
    // uneven extensions expose patches of soil rather than an equal-width rim.
    const boundaryMm = points.map((point, index) => {
      const dx = point.x - center.x, dy = point.y - center.y, length = Math.hypot(dx, dy)
      const width = [300, 620, 440, 780, 360][(index + campIndex * 2) % 5]
      return round(Math.min(maxX - 20, Math.max(minX + 20, point.x + dx / length * width)),
        Math.min(maxY - 20, Math.max(minY + 20, point.y + dy / length * width)))
    })
    add(camp.id, boundaryMm, campIndex === 0 ? 460 : 580)
  }
  // Publish only after every generated ring has passed the owner-boundary check.
  ground.surfaceStyle.overlays.push(...overlays)
}
