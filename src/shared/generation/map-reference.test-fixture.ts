/** Static color fields with an open bay, a lake and a detached island. */
export function referenceTerrainPixels() {
  const width = 160, height = 110, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const main = x > 13 + Math.floor(y / 6) && x < 125 && y < 104
    const bay = x > 84 && y > 55 && y < 83
    const lake = x > 36 && x < 52 && y > 69 && y < 87
    const island = Math.hypot(x - 143, y - 66) < 8
    const solid = main && !bay && !lake || island || x === 7 && y === 5
    data.set(solid ? [178, 141, 95, 255] : [45 + Math.floor(x / 18), 153, 177, 255], (y * width + x) * 4)
  }
  return { width, height, data }
}

export const guide = { background: [{ x: 151, y: 30 }, { x: 44, y: 77 }], foreground: [{ x: 143, y: 66 }] }
