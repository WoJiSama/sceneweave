import { polygonInside, polygonsOverlap, polygonValid } from '../geometry/geometry.js'
import type { ImagePixels } from '../image-import/pixels.js'
import { simplifyRing, traceIndexedContours } from '../image-import/vector.js'
import type { PointMm } from '../model/scene.js'
import { signedVisualArea } from '../visual/geometry.js'
import type { MapCoverZone, MapSceneryZone } from './map-authoring.js'

type Region = { id: string; boundary: PointMm[]; label: number }

/** Read coherent vegetation colors at map scale. Small ink lines and grid
 * marks are ignored. The result is native paint and tagged scenery zones. */
export function inferReferenceGround(image: ImagePixels, land: Int16Array, landWidth: number, regions: Region[], water?: Uint8Array) {
  const ratio = Math.min(1, 180 / Math.max(image.width, image.height))
  const width = Math.max(3, Math.round(image.width * ratio)), height = Math.max(3, Math.round(image.height * ratio))
  const sx = image.width / width, sy = image.height / height, landHeight = land.length / landWidth
  const ground = new Int16Array(width * height).fill(-1), canopy = ground.slice(), sand = ground.slice()
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const lx = Math.floor((x + .5) * landWidth / width), ly = Math.floor((y + .5) * landHeight / height)
    const owner = land[ly * landWidth + lx]
    if (owner < 0) continue
    // Read dry sand only near the open coast. Pale rock or fields inland
    // should not acquire a beach texture just because they have similar hue.
    const reach = Math.max(3, Math.round(landWidth * .026))
    const coast = water && [[lx - reach, ly], [lx + reach, ly], [lx, ly - reach], [lx, ly + reach]]
      .some(([u, v]) => u >= 0 && u < landWidth && v >= 0 && v < landHeight && !!water[v * landWidth + u])
    let green = 0, timber = 0, strand = 0
    for (const dy of [.24, .50, .76]) for (const dx of [.24, .50, .76]) {
      const i = (Math.floor((x + dx) * sx) + Math.floor((y + dy) * sy) * image.width) * 4
      const red = image.data[i], g = image.data[i + 1], blue = image.data[i + 2]
      if (image.data[i + 3] < 128) continue
      if (coast && red >= g - 12 && g - blue >= 13 && g - blue <= 62 && g >= 180 && red >= 181) strand++
      if (g - red >= 6 && g - blue >= 9 && g >= 57) {
        green++
        if ((red + g + blue) / 3 < 148 && g - red >= 13 && g - blue >= 13) timber++
      }
    }
    if (green >= 6) ground[y * width + x] = owner
    if (timber >= 6) canopy[y * width + x] = owner
    if (strand >= 6 && green < 6) sand[y * width + x] = owner
  }

  const zones = (labels: Int16Array, minimum: number, limit: number) => {
    const outlines = traceIndexedContours({ width, height }, labels)
    return regions.flatMap(({ id, boundary: carrier, label }) => {
      const rings = outlines.get(label) ?? []
      const holes = rings.filter(ring => signedVisualArea(ring) < 0)
      return rings.flatMap(ring => {
        const area = signedVisualArea(ring)
        if (area < minimum) return []
        const enclosed = holes.filter(hole => polygonInside(hole, ring))
        // A mask cannot express holes. Leave a large interior clearing to
        // the procedural finish rather than covering it with a single patch.
        if (enclosed.reduce((sum, hole) => sum - signedVisualArea(hole), 0) > area * .19) return []
        for (const tolerance of [1.15, 1.85, 2.7]) {
          const boundary = simplifyRing(ring, tolerance).map(p => ({ x: Math.round(p.x * sx), y: Math.round(p.y * sy) }))
          if (boundary.length <= 128 && polygonValid(boundary, true) && polygonsOverlap(boundary, carrier)) return [{ id, area, boundary }]
        }
        return []
      })
    }).sort((a, b) => b.area - a.area).slice(0, limit)
  }
  const grass: MapCoverZone[] = zones(ground, Math.max(11, width * height * .00072), 14).map(({ id, boundary }, i) => ({
    id: `reference-grass-${i + 1}`, areaId: id, region: { boundary }, cover: 'grass',
  }))
  const strands: MapCoverZone[] = water ? zones(sand, Math.max(10, width * height * .00050), 5).map(({ id, boundary }, i) => ({
    id: `reference-sand-${i + 1}`, areaId: id, region: { boundary }, cover: 'sand',
  })) : []
  const scenery: MapSceneryZone[] = zones(canopy, Math.max(8, width * height * .00046), 5).map(({ id, boundary }, i) => ({
    id: `reference-grove-${i + 1}`, areaId: id, region: { boundary }, palette: 'woodland', pattern: 'grove', density: .90,
  }))
  return { covers: [...grass, ...strands], scenery, grassCount: grass.length, strandCount: strands.length }
}
