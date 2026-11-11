import { cropImageRegion, extractImageLayer, imagePolygonMask, type ImagePixels } from './pixels.js'
import { parseImageImportRecipe } from './recipe.js'
import { assertSourcePreservingRecipe } from './fidelity.js'

/** Coordinates and all comparison masks stay on the captured original pixel grid. */
export function reconstructSourceLayers(source: ImagePixels, input: unknown) {
  const recipe = parseImageImportRecipe(input)
  assertSourcePreservingRecipe(recipe)
  if (recipe.image.pixelWidth !== source.width || recipe.image.pixelHeight !== source.height) throw new Error('拆解提案与原图像素尺寸不符。')
  const boundary = recipe.sourceBoundaryPx ?? recipe.roomPointsPx, scope = imagePolygonMask(source, boundary)
  const scopeMask = new Uint8Array(source.width * source.height), inferenceMask = new Uint8Array(scopeMask.length), edgeMask = new Uint8Array(scopeMask.length)
  for (let y = 0; y < scope.height; y++) for (let x = 0; x < scope.width; x++) {
    const coverage = scope.data[y * scope.width + x], index = (y + scope.boundsPx.y) * source.width + x + scope.boundsPx.x
    scopeMask[index] = coverage > 0 ? 255 : 0
    if (coverage && coverage !== 255) edgeMask[index] = 255
  }
  let remaining = source
  const layers = recipe.layers.map(layer => {
    const extracted = extractImageLayer(remaining, layer.polygon, layer.donor, { repair: layer.repair, fills: layer.fills, cleanupPx: layer.cleanupPx, selectionMask: layer.selectionMask })
    for (let y = 0; y < extracted.mask.height; y++) for (let x = 0; x < extracted.mask.width; x++) {
      const value = extracted.mask.data[y * extracted.mask.width + x]
      if (!value) continue
      const sx = x + extracted.mask.boundsPx.x, sy = y + extracted.mask.boundsPx.y
      const bx = sx - scope.boundsPx.x, by = sy - scope.boundsPx.y
      if (bx < 0 || by < 0 || bx >= scope.width || by >= scope.height || !scope.data[by * scope.width + bx]) throw new Error('物件轮廓超出原图保留范围，请扩大外框；不能裁掉原画细节。')
    }
    for (let y = 0; y < extracted.repairMask.height; y++) for (let x = 0; x < extracted.repairMask.width; x++) {
      if (!extracted.repairMask.data[y * extracted.repairMask.width + x]) continue
      const sx = x + extracted.repairMask.boundsPx.x, sy = y + extracted.repairMask.boundsPx.y, index = sy * source.width + sx
      inferenceMask[index] = 255
      const mx = sx - extracted.mask.boundsPx.x, my = sy - extracted.mask.boundsPx.y
      const coverage = mx < 0 || my < 0 || mx >= extracted.mask.width || my >= extracted.mask.height ? 0 : extracted.mask.data[my * extracted.mask.width + mx]
      // A supplied mask is geometry, never permission to waive arbitrary interior pixels.
      // Partial alpha is an edge exemption only beside an actual unselected neighbour.
      const touchesOutside = () => [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => {
        const x = mx + dx, y = my + dy
        return x < 0 || y < 0 || x >= extracted.mask.width || y >= extracted.mask.height || extracted.mask.data[y * extracted.mask.width + x] === 0
      }))
      if (coverage !== 255 && (!layer.selectionMask || coverage === 0 || touchesOutside())) edgeMask[index] = 255
    }
    remaining = extracted.remaining
    return { ...layer, pixels: extracted.layer, boundsPx: extracted.layer.boundsPx }
  })
  const composite: ImagePixels = { width: source.width, height: source.height, data: remaining.data.slice() }
  for (const layer of [...layers].reverse()) {
    const image = layer.pixels
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const a = (y * image.width + x) * 4, b = ((y + layer.boundsPx.y) * source.width + x + layer.boundsPx.x) * 4
      const alpha = image.data[a + 3] / 255, backgroundAlpha = composite.data[b + 3] / 255, outputAlpha = alpha + backgroundAlpha * (1 - alpha)
      if (!alpha) continue
      for (let channel = 0; channel < 3; channel++) composite.data[b + channel] = outputAlpha ? Math.round((image.data[a + channel] * alpha + composite.data[b + channel] * backgroundAlpha * (1 - alpha)) / outputAlpha) : 0
      composite.data[b + 3] = Math.round(outputAlpha * 255)
    }
  }
  const clip = (image: ImagePixels): ImagePixels => {
    const data = image.data.slice()
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const bx = x - scope.boundsPx.x, by = y - scope.boundsPx.y, coverage = bx < 0 || by < 0 || bx >= scope.width || by >= scope.height ? 0 : scope.data[by * scope.width + bx]
      const index = (y * image.width + x) * 4
      data[index + 3] = Math.round(data[index + 3] * coverage / 255)
      if (!data[index + 3]) data.fill(0, index, index + 3)
    }
    return { width: image.width, height: image.height, data }
  }
  return { recipe, remaining, floor: cropImageRegion(remaining, boundary), layers, source: clip(source), composite: clip(composite), scopeMask, inferenceMask, edgeMask }
}
