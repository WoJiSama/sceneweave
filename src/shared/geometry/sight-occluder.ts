import type { PointMm, Prop } from '../model/scene.js'

export function propSightLine(prop: Pick<Prop, 'positionMm' | 'rotationDeg' | 'sightOccluder'>): PointMm[] {
  const angle = prop.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  return prop.sightOccluder?.pointsLocalMm.map(({ x, y }) => ({
    x: prop.positionMm.x + x * cos - y * sin,
    y: prop.positionMm.y + x * sin + y * cos,
  })) ?? []
}
