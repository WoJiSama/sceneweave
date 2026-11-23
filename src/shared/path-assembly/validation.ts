import { terrainPoints } from '../geometry/geometry.js'
import type { Issue, Path, Prop, SceneDocument } from '../model/scene.js'
import { sha256Text } from '../validation/hash.js'
import { canonicalJson } from '../validation/json.js'
import { bridgeDeckGeometry } from './layout.js'
import type { PathAssembly, PathAssemblyRecipe } from './contracts.js'
import { visualBase } from '../visual/base.js'
import type { VisualBoundary } from '../visual/types.js'
import { fenceRoutePoints } from './fitted-layout.js'
import { blocksPlatformFenceOpening, planBoundPlatformFence } from './platform-fence-binding.js'

export function fenceRouteFingerprint(boundary: Pick<VisualBoundary, 'segments' | 'closed'>): string {
  return sha256Text(canonicalJson([boundary.closed, boundary.segments]))
}

export function assemblyRouteFingerprint(path: Pick<Path, 'centerlineMm' | 'widthMm' | 'widthSections'>): string {
  const input = [path.centerlineMm, path.widthMm]
  return sha256Text(canonicalJson(path.widthSections ? [...input, path.widthSections] : input))
}

export function assemblyMemberFingerprint(prop: Prop, layerId: string): string {
  const { editLocked: _locked, ...instance } = prop
  return sha256Text(canonicalJson([instance, layerId]))
}

export function inspectPathAssemblies(scene: SceneDocument): Issue[] {
  const assemblies = Object.values(scene.paths).filter(path => path.assembly)
  const fences = Object.values(visualBase(scene)?.boundaries ?? {}).filter(boundary => boundary.fence)
  const issues: Issue[] = []
  for (const definition of Object.values(scene.prefabDefinitions)) {
    const lamp = definition.pathStyle?.lamps?.ref
    if (lamp && scene.propDefinitions[lamp.id]?.version !== lamp.version) issues.push({ code: 'PATH_ASSEMBLY', entityId: definition.id,
      message: '固定样式缺少对应版本的灯具。' })
  }
  if (!assemblies.length && !fences.length) return issues
  const ownedDecks = new Set<string>(), ownedProps = new Set<string>()
  for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) {
    for (const member of Object.values(group.members)) if (member.propId) ownedProps.add(member.propId)
  }
  for (const group of Object.values(scene.decorationClusters ?? {})) {
    for (const member of Object.values(group.members)) if (member.kind === 'prop' && member.entityId && member.state !== 'detached') ownedProps.add(member.entityId)
  }
  for (const path of assemblies) {
    const assembly = path.assembly!, { recipe, bridge, members } = assembly
    const issue = (message: string) => issues.push({ code: 'PATH_ASSEMBLY', message, entityId: path.id })
    if (assemblyRouteFingerprint(path) !== assembly.routeFingerprint) issue('路线已变更，请通过沿线装配同步更新路线和构件。')
    checkRecipe(recipe, issue)
    if (recipe.structure && (!bridge || recipe.section.kind === 'none')) issue('工业桥结构需要桥面和连续边梁源节。')
    if (bridge) {
      const deck = scene.terrainAreas[bridge.deckId], support = path.supportRefs[0]
      if (!deck || ownedDecks.has(bridge.deckId) || deck.floorId !== path.floorId || deck.visibility !== bridge.visibility
        || path.visibility !== bridge.visibility || deck.groundElevationMm !== bridge.elevationMm || deck.waterSurface || deck.rockBody
        || deck.blocksMovement || deck.blocksSight || path.supportRefs.length !== 1 || support.kind !== 'terrainArea' || support.id !== bridge.deckId
        || canonicalJson(terrainPoints(deck)) !== canonicalJson(bridgeDeckGeometry(path, recipe.shoulderMm, recipe.structure?.bridgehead).outline)) {
        issue('桥面承托、可见性和高程须与桥梁匹配。请通过桥梁面板编辑。')
      }
      ownedDecks.add(bridge.deckId)
    }
    checkMembers(path.floorId, members, issue)
  }
  for (const boundary of fences) {
    const assembly = boundary.fence!
    const issue = (message: string) => issues.push({ code: 'PATH_ASSEMBLY', message, entityId: boundary.id })
    if (boundary.binding.kind !== 'decoration' || fenceRouteFingerprint(boundary) !== assembly.routeFingerprint) {
      issue('围栏线已变更，请通过围栏面板同步更新实际构件。')
    }
    if (assembly.recipe.section.kind === 'none' || boundary.closed && assembly.recipe.endClearanceMm
      || assembly.recipe.gaps?.some(gap => gap.side !== 'both')) issue('围栏的源节或开口设置无效。')
    if (assembly.platformBinding) {
      try {
        const { route, bands } = planBoundPlatformFence(scene, { ...boundary, recipe: assembly.recipe }, assembly.platformBinding)
        if (assembly.pipeLinks || boundary.closed !== route.closed || canonicalJson(fenceRoutePoints(boundary)) !== canonicalJson(route.centerlineMm)
          || canonicalJson(assembly.recipe.gaps ?? []) !== canonicalJson(route.gaps)) issue('平台护栏路线和开口须匹配当前平台及可见结构。')
        if (bands.length) for (const member of Object.values(assembly.members)) {
          const prop = member.state === 'placed' && scene.props[member.propId]
          if (prop && blocksPlatformFenceOpening(prop, bands)) issues.push({ code: 'PLATFORM_FENCE_OPENING', entityId: prop.id,
            message: `护栏构件 ${prop.id} 的实际占地侵入桥头、楼梯或坡道净空。请移开这件构件。` })
        }
      } catch (cause) { issue(cause instanceof Error ? cause.message : '平台护栏绑定无效。') }
    }
    checkRecipe(assembly.recipe, issue)
    checkMembers(boundary.floorId, assembly.members, issue)
  }
  return issues

  function checkRecipe(recipe: Pick<PathAssemblyRecipe, 'section' | 'lamps'>, issue: (message: string) => void) {
    const section = recipe.section
    if (section.kind === 'prop' && scene.propDefinitions[section.ref.id]?.version !== section.ref.version
      || section.kind === 'prefab' && scene.prefabDefinitions[section.ref.id]?.version !== section.ref.version) issue('沿线构件缺少固定版本的源节。')
    if (recipe.lamps?.ref && scene.propDefinitions[recipe.lamps.ref.id]?.version !== recipe.lamps.ref.version) issue('沿线构件缺少固定版本的灯具。')
  }

  function checkMembers(floorId: string, members: PathAssembly['members'], issue: (message: string) => void) {
    for (const member of Object.values(members)) {
      if (member.state === 'removed') continue
      const prop = scene.props[member.propId]
      if (!prop || prop.floorId !== floorId || ownedProps.has(member.propId)) issue('沿线构件必须是同层且只属于一个装配的真实物件。')
      ownedProps.add(member.propId)
    }
  }
}
