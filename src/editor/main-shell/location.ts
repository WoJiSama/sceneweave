export const homeSections = {
  artStyle: 'home-art-style',
  oblique: 'home-oblique',
  samples: 'home-samples-title',
  projects: 'home-projects',
} as const

export function isHomeSectionHash(hash: string) {
  return Object.values(homeSections).some(id => hash === `#${id}`)
}
