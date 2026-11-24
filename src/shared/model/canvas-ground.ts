import type { Floor, TerrainArea } from './scene.js'

// New scene creation reserves this ID for the Floor's editable datum.
export const canvasGroundId = (floorId: string) => `canvas-ground-${floorId}`
export const CANVAS_GROUND_PRIORITY = -10000

export function isCanvasGround(area: TerrainArea): boolean {
  return area.id === canvasGroundId(area.floorId) && area.coveragePriority === CANVAS_GROUND_PRIORITY
}

export function isFlatCanvasGround(area: TerrainArea): boolean {
  return isCanvasGround(area) && area.visibility === 'public' && area.groundElevationMm === 0
    && !area.blocksMovement && !area.blocksSight && !area.relief && !area.rockBody && !area.waterSurface
}

export function isFloorSizedCanvasGround(area: TerrainArea, floor: Floor): boolean {
  const { x, y, width, height } = floor.boundsMm
  return isFlatCanvasGround(area) && area.boundaryMm.length === 4 && area.boundaryMm.every(({ positionMm: p }) =>
    (p.x === x || p.x === x + width) && (p.y === y || p.y === y + height))
}
