import type { PointMm } from '../model/scene.js'
import { terrainRandomUnit } from './field.js'

type Position = readonly [number, number]
interface ForestLayout {
  name: string
  forest: readonly Position[]
  clearing: Position
  radii: Position
  shoulder: readonly Position[]
}
// These are spatial relationships, rather than five rotations of one outline.
// Each clearing retains a broad west shoulder for a full-width ground ramp.
const layouts: readonly ForestLayout[] = [
  { name: '林湾眺台', clearing: [.69,.56], radii: [.18,.19],
    forest: [[.05,.10],[.43,.06],[.62,.18],[.59,.36],[.37,.32],[.32,.58],[.48,.72],[.40,.92],[.13,.86],[.05,.56]],
    shoulder: [[-1,-.5],[-.45,-1],[.35,-.9],[1,-.3],[.85,.55],[.12,1],[-1,.5]] },
  { name: '双肩林隙', clearing: [.50,.69], radii: [.21,.17],
    forest: [[.12,.08],[.75,.05],[.93,.22],[.83,.43],[.65,.29],[.47,.29],[.36,.52],[.10,.39]],
    shoulder: [[-1,-.55],[-.55,-1],[.65,-.80],[1,-.2],[.65,.95],[-.05,1],[-1,.55]] },
  { name: '南弯林缘', clearing: [.30,.35], radii: [.19,.20],
    forest: [[.88,.14],[.96,.37],[.88,.89],[.59,.94],[.35,.82],[.43,.65],[.67,.72],[.72,.44],[.64,.22]],
    shoulder: [[-1,-.6],[-.6,-1],[.2,-.85],[.95,-.45],[1,.3],[.25,1],[-.65,.8],[-1,.6]] },
  { name: '斜脊林坡', clearing: [.78,.75], radii: [.16,.16],
    forest: [[.07,.67],[.24,.45],[.39,.48],[.49,.26],[.78,.06],[.94,.15],[.79,.37],[.66,.43],[.53,.70],[.29,.91],[.12,.87]],
    shoulder: [[-1,-.6],[-.2,-1],[.85,-.6],[1,.15],[.55,1],[-.3,.85],[-1,.6]] },
  { name: '林岬空地', clearing: [.78,.34], radii: [.14,.17],
    forest: [[.06,.20],[.26,.06],[.50,.11],[.60,.30],[.47,.46],[.54,.62],[.90,.67],[.93,.88],[.58,.92],[.32,.74],[.17,.48]],
    shoulder: [[-1,-.6],[-.5,-1],[.35,-.7],[1,-.2],[.8,.65],[.15,1],[-1,.6]] },
]

export interface ForestSkeletonV8 {
  name: string
  forestPointsMm: PointMm[]
  plateauPointsMm: PointMm[]
  plateauCenterMm: PointMm
}
export function forestSkeletonV8(input: { seed: string; widthMm: number; heightMm: number }, variant: number): ForestSkeletonV8 {
  const layout = layouts[variant]
  if (!layout) throw new Error('森林骨架8需要有效的结构族。')
  const { seed, widthMm: width, heightMm: height } = input
  const unit = (key: string, amplitude: number) => (terrainRandomUnit(seed, `forest-layout8/${key}`) - .5) * amplitude
  const xScale = 1 + unit('forest-width', .06), yScale = 1 + unit('forest-height', .04)
  const center = { x: layout.clearing[0] + unit('clearing-x', .012), y: layout.clearing[1] + unit('clearing-y', .012) }
  const rx = layout.radii[0] * (1 + unit('shoulder-width', .04)), ry = layout.radii[1] * (1 + unit('shoulder-height', .04))
  const p = (x: number, y: number): PointMm => ({ x: Math.round(x * width), y: Math.round(y * height) })
  return { name: layout.name,
    forestPointsMm: layout.forest.map(([x,y]) => p(.5 + (x - .5) * xScale, .5 + (y - .5) * yScale)),
    plateauCenterMm: p(center.x, center.y),
    plateauPointsMm: layout.shoulder.map(([x,y]) => p(center.x + x * rx, center.y + y * ry)) }
}
