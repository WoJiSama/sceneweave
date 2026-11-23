import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TERRAIN_FACADES } from '../../../shared/appearance/terrain-facade.js'
import type { PointMm } from '../../../shared/model/scene.js'
import { bridgeSideOffset } from '../../../shared/path-assembly/profiles.js'
import type { ProjectedBridge, ProjectedTerrainEdge } from '../../../shared/projection/types.js'
import { DIRECTIONAL_LIGHT_PRESETS } from '../../../shared/visual/light-geometry.js'
import { industrialFaceLight } from './industrial-face-light.js'
import { drawBridgeSides, paintGirderFlanges } from './path-assembly.js'
import { planFacadeFaces, type FacadeFace } from './terrain-facade-geometry.js'
import { drawTerrainFacadeFace } from './terrain-facade-renderer.js'

const p = (x: number, y: number) => ({ x, y })
const fromSouth = { lightDirectionDeg: 270 }
const fromNorth = { lightDirectionDeg: 90 }
const outline = [p(2000, 1000), p(4000, 1000), p(4000, 5000), p(2000, 5000)]
const eastSide: [PointMm, PointMm] = [outline[1], outline[2]]
const southSide: [PointMm, PointMm] = [outline[2], outline[3]]
const offset = bridgeSideOffset(2000)
const bridge: ProjectedBridge = {
  outline, centerlineMm: [p(3000, 1000), p(3000, 5000)], widthMm: 1600, finish: 'steel',
  structure: { palette: 'alloy', landings: [] },
  relief: { depthMm: 2000, shadowOpacity: .5, elevationMm: 4200, ribSpacingMm: 1700 },
}

class PaintPath {
  readonly polygons: PointMm[][] = []
  moveTo(x: number, y: number) { this.polygons.push([p(x, y)]) }
  lineTo(x: number, y: number) { this.polygons.at(-1)!.push(p(x, y)) }
  closePath() {}
  addPath(path: PaintPath) { this.polygons.push(...path.polygons) }
}

function record(draw: (ctx: CanvasRenderingContext2D) => void) {
  const fills: { color: string | string[]; alpha: number; polygons: PointMm[][] }[] = []
  let current = new PaintPath()
  const ctx = {
    fillStyle: '#000000' as string | { stops: string[] },
    globalAlpha: 1,
    save() {}, restore() {}, transform() {}, rect() {}, clip() {}, arc() {},
    beginPath() { current = new PaintPath() },
    moveTo(x: number, y: number) { current.moveTo(x, y) },
    lineTo(x: number, y: number) { current.lineTo(x, y) },
    closePath() { current.closePath() },
    fill(path = current) {
      fills.push({ color: typeof this.fillStyle === 'string' ? this.fillStyle : this.fillStyle.stops,
        alpha: this.globalAlpha, polygons: path.polygons })
    },
    fillRect(x: number, y: number, width: number, height: number) {
      const path = new PaintPath()
      path.polygons.push([p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)])
      this.fill(path)
    },
    createLinearGradient() {
      return { stops: [] as string[], addColorStop(_offset: number, color: string) { this.stops.push(color) } }
    },
  }
  draw(ctx as unknown as CanvasRenderingContext2D)
  return fills
}

describe('industrial face lighting', () => {
  beforeEach(() => vi.stubGlobal('Path2D', PaintPath))
  afterEach(() => vi.unstubAllGlobals())

  it('lights the normal facing the source opposite the cast shadow', () => {
    const fallback = industrialFaceLight(-4000, 0, 1, fromSouth)
    expect(fallback).toBeGreaterThan(1)
    expect(industrialFaceLight(-4000, 0, 1, fromNorth)).toBeLessThan(1)
    expect(industrialFaceLight(351, 0, -1, fromSouth)).toBe(fallback)
    expect(industrialFaceLight(-4000, 0, 1)).toBe(1)
    const sun = DIRECTIONAL_LIGHT_PRESETS.sun
    expect(industrialFaceLight(-4000, 0, 1, { ...fromSouth, directionalLight: { ...sun, intensity: 0 } })).toBe(1)
    expect(industrialFaceLight(-4000, 0, 1, { ...fromSouth, directionalLight: { ...sun, elevationDeg: 90 } })).toBe(1)
  })

  it('matches bridge flanges along a platform wall cut and tapered at the landing', () => {
    const facade = { ...TERRAIN_FACADES['girder-v1'], depthMm: 460 }
    const edge: ProjectedTerrainEdge = {
      id: 'wall', start: p(6000, 5000), end: p(0, 5000), sourceAreaId: 'platform', neighborAreaId: null,
      elevationMm: 4200, neighborElevationMm: 0, kind: 'cliff', shoreline: false, surfaceStyle: null,
      style: { color: '#303C42', bandWidthMm: 100, strokeWidthMm: 0 },
    }
    const opening = { outerMm: [p(2000, 4750), p(4000, 4750), p(4000, 5250), p(2000, 5250)], holesMm: [] }
    const faces = planFacadeFaces({ edges: [edge] }, { id: 'platform', facade }, [], [
      { id: 'platform', contactMm: p(3000, 5000), shoulderCut: [], edgeOpening: [opening], girderOffsetMm: offset },
    ])
    expect(faces).toHaveLength(4)
    const tapered = faces.filter(({ offsetsMm: [a, b] }) => a.y !== b.y)
    expect(tapered.map(face => face.offsetsMm.map(value => value.y))).toEqual([[460, offset.y], [offset.y, 460]])

    const original: string[] = []
    paintGirderFlanges('steel', (_from, _to, color) => original.push(color))
    const swatches = (fills: ReturnType<typeof record>) => fills.slice(0, original.length).map(fill => fill.color)
    const bridgeFills = record(ctx => drawBridgeSides(ctx, bridge, offset, [southSide], fromSouth))
    expect(swatches(bridgeFills)).not.toEqual(original)
    for (const face of faces) {
      const fills = record(ctx => drawTerrainFacadeFace(ctx, face, facade, true, fromSouth))
      expect(swatches(fills)).toEqual(swatches(bridgeFills))
      if (face.endCaps.some(Boolean)) {
        const jamb = fills.at(-1)!.polygons[0]
        expect(jamb.every(({ y }) => y > 0 && y < offset.y * .78)).toBe(true)
      }
    }
  })

  it('keeps collinear pieces in a single paint and joins differently lit faces at a bend', () => {
    const [corner, end] = southSide, split = p(3000, 5000)
    const [underpaint, east, south] = record(ctx =>
      drawBridgeSides(ctx, bridge, offset, [eastSide, [corner, split], [split, end]], fromSouth))
    expect(underpaint.polygons).toHaveLength(3)
    expect(east.color).not.toBe(south.color)
    expect(south.polygons).toHaveLength(2)
    const foot = p(corner.x + offset.x, corner.y + offset.y)
    for (const fill of [east, south]) {
      expect(fill.polygons[0]).toContainEqual(corner)
      expect(fill.polygons[0]).toContainEqual(foot)
    }
  })

  it.each(['glazed-v1', 'ribbed-v1', 'girder-v1'] as const)('shades %s material without altering its lamps', profile => {
    const facade = { ...TERRAIN_FACADES[profile], lightColor: '#FEA871', lightIntensity: .68 }
    const face: FacadeFace = {
      start: p(8000, 5000), end: p(0, 5000), lengthMm: 8000, offsetsMm: [p(0, facade.depthMm), p(0, facade.depthMm)],
      facing: 1, endCaps: [false, false], wall: { fromMm: 0, lengthMm: 8000 },
    }
    const emissions = (fills: ReturnType<typeof record>) => fills.filter(({ color }) =>
      typeof color === 'string' ? color === facade.lightColor : color.some(stop => stop.startsWith(facade.lightColor)))
    const front = record(ctx => drawTerrainFacadeFace(ctx, face, facade, true, fromSouth))
    const back = record(ctx => drawTerrainFacadeFace(ctx, face, facade, true, fromNorth))
    expect(front[0].color).not.toEqual(back[0].color)
    expect(emissions(front).length).toBeGreaterThan(0)
    expect(emissions(front)).toEqual(emissions(back))
    expect(emissions(record(ctx => drawTerrainFacadeFace(ctx, face, facade, false, fromSouth)))).toEqual([])
  })

  it('keeps the existing compact and timber paints with floor lighting present', () => {
    for (const other of [{ ...bridge, structure: undefined }, { ...bridge, finish: 'timber' as const }]) {
      const original = record(ctx => drawBridgeSides(ctx, other, offset, [eastSide, southSide]))
      expect(record(ctx => drawBridgeSides(ctx, other, offset, [eastSide, southSide], fromSouth))).toEqual(original)
    }
  })
})
