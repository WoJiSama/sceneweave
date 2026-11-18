export const tutorialHash = '#tutorial'

export function isTutorialHash(hash: string) {
  return hash === tutorialHash || hash.startsWith(`${tutorialHash}/`)
}

export function tutorialHref(chapter: string, section?: string) {
  if (section) return `${tutorialHash}/${chapter}/${section}`
  return chapter === 'first-map' ? tutorialHash : `${tutorialHash}/${chapter}`
}
