export const workspaceSampleNames = {
  ocean: '潮影航路 · 海洋成图',
  openOcean: '远洋遭遇 · 巨怪',
  nearshore: '碎潮礁湾 · 近岸海战',
  shipInterior: '逐潮号 · 三层船图',
  naturalIsland: '岬湾苔岛 · 自然岩阶与崖面',
  naturalOutpost: '林中哨站 · 自然编排',
} as const

export const workspaceSamples = [
  { name: workspaceSampleNames.ocean, load: () => import('./ocean-sample.js').then(module => module.createOceanProject) },
  { name: workspaceSampleNames.openOcean, load: () => import('./open-ocean.js').then(module => module.createOpenOceanProject) },
  { name: workspaceSampleNames.nearshore, load: () => import('./nearshore-battle.js').then(module => module.createNearshoreBattleProject) },
  { name: workspaceSampleNames.shipInterior, load: () => import('./ship-interior.js').then(module => module.createShipInteriorProject) },
  { name: workspaceSampleNames.naturalIsland, load: () => import('./natural-detail-samples.js').then(module => module.createNaturalDetailIslandProject) },
  { name: workspaceSampleNames.naturalOutpost, load: async () => {
    const { createNaturalDetailOutpostProject } = await import('./natural-detail-samples.js')
    return (signal: AbortSignal) => createNaturalDetailOutpostProject('balanced', signal)
  } },
]
