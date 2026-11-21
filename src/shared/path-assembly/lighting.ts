import type { Prop, PropGlow } from '../model/scene.js'
import { isPathLampMember, type FenceAssembly, type FixtureGlow, type PathAssembly } from './contracts.js'

export function assemblyLampDefaults(assemblies: readonly (PathAssembly | FenceAssembly)[]): Map<string, FixtureGlow | undefined> {
  const defaults = new Map<string, FixtureGlow | undefined>()
  for (const { recipe, members } of assemblies) {
    for (const [key, member] of Object.entries(members)) {
      if (member.state === 'placed' && isPathLampMember(key)) defaults.set(member.propId, recipe.lamps?.glow)
    }
  }
  return defaults
}

/** The saved prop can inherit, replace, or explicitly turn off its glow. */
export function effectiveFixtureGlow(prop: Prop, inherited?: FixtureGlow): PropGlow | null | undefined {
  if (prop.appearance.glow !== undefined) return prop.appearance.glow
  if (!inherited) return undefined
  const smallLamp = prop.appearance.kind === 'symbol' && prop.appearance.bridgeArt === 'lamp'
  return { ...inherited, anchor: { u: .5, v: smallLamp ? .705 : .5 } }
}
