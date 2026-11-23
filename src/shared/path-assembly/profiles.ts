export const LINE_PROFILE_IDS = [
  'boxGirder', 'industrialSteel', 'neonAlloy', 'safetyBeam', 'glassGuard', 'concreteBarrier',
  'doubleTimber', 'ironPickets', 'wireMesh', 'woodPalisade', 'stoneParapet', 'coolantPipe',
] as const
export type LineProfile = typeof LINE_PROFILE_IDS[number]
export const BRIDGE_ART_IDS = ['steelRail', 'timberRail', 'lamp', 'nodeLamp', 'rivetedSupport', 'alloySupport', 'rivetedCorner', 'alloyCorner', 'pipeManifold', 'pipeSocket', ...LINE_PROFILE_IDS] as const
export type BridgeArt = typeof BRIDGE_ART_IDS[number]

export function bridgeSideOffset(depthMm: number) {
  return { x: depthMm * .35, y: depthMm * .58 }
}

export const LINE_PROFILES: Record<LineProfile, { name: string; pitchMm: number; widthMm: number }> = {
  boxGirder: { name: '箱形工业边梁', pitchMm: 2450, widthMm: 300 },
  industrialSteel: { name: '铆接工业钢梁', pitchMm: 2000, widthMm: 362 },
  neonAlloy: { name: '青光合金护栏', pitchMm: 2200, widthMm: 340 },
  safetyBeam: { name: '斜纹安全路障', pitchMm: 1800, widthMm: 400 },
  glassGuard: { name: '夹层玻璃护栏', pitchMm: 1750, widthMm: 260 },
  concreteBarrier: { name: '拼装混凝土隔离墩', pitchMm: 2300, widthMm: 540 },
  doubleTimber: { name: '双横木护栏', pitchMm: 1600, widthMm: 220 },
  ironPickets: { name: '铸铁细栅', pitchMm: 2100, widthMm: 230 },
  wireMesh: { name: '钢丝网围栏', pitchMm: 2400, widthMm: 280 },
  woodPalisade: { name: '密桩木栅栏', pitchMm: 1800, widthMm: 320 },
  stoneParapet: { name: '压顶石矮墙', pitchMm: 1800, widthMm: 520 },
  coolantPipe: { name: '双道工业冷却管', pitchMm: 3400, widthMm: 980 },
}

const specialArtNames = {
  steelRail: '工业边梁', timberRail: '木护栏', lamp: '琥珀小灯', nodeLamp: '节点灯',
  rivetedSupport: '铆接钢支座', alloySupport: '青光合金支座', rivetedCorner: '铆接钢转角', alloyCorner: '青光合金转角',
  pipeManifold: '转角分流接头', pipeSocket: '管线端口',
}

export const bridgeArtName = (art: BridgeArt) => art in specialArtNames ? specialArtNames[art as keyof typeof specialArtNames] : LINE_PROFILES[art as LineProfile].name
