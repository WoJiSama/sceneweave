import type { EdgeStyle, SceneDocument, TerrainEdge } from '../model/scene.js'
import { canonicalTerrainEdge, type OutdoorCommand } from './outdoor.js'

const sourceKey = (source: TerrainEdge['source']): string => `${source.areaId}\0${source.segmentId}`

export function defaultShorelineStyle(cliff: boolean): EdgeStyle {
  return { bandWidthMm: cliff ? 700 : 1600, color: '#F2E6BD', strokeWidthMm: cliff ? 29 : 36 }
}

/** Use the native terrain edge, including when the shared edge is stored on the opposite surface. */
export function terrainShorelineCommands(scene: SceneDocument, sources: TerrainEdge['source'][], enabled: boolean,
  nextId: (source: TerrainEdge['source']) => string, style?: EdgeStyle): OutdoorCommand[] {
  const bySource = new Map(Object.values(scene.terrainEdges).map(edge => [sourceKey(edge.source), edge]))
  const visited = new Set<string>()
  const commands: OutdoorCommand[] = []
  for (const requested of sources) {
    const relation = canonicalTerrainEdge(scene, requested), key = sourceKey(relation.source)
    if (visited.has(key)) continue
    visited.add(key)
    const edge = bySource.get(key)
    if (!enabled) {
      if (edge?.kind === 'shore') commands.push({ type: 'updateTerrainEdge', id: edge.id,
        changes: { kind: 'materialTransition', shoreline: false, styleOverride: { bandWidthMm: 0, strokeWidthMm: 0, color: edge.styleOverride?.color ?? '#F2E6BD' } } })
      else if (edge?.shoreline) commands.push({ type: 'updateTerrainEdge', id: edge.id, changes: { shoreline: false } })
      continue
    }
    const shoreStyle = style ?? edge?.shoreStyle ?? defaultShorelineStyle(relation.requiresCliff)
    if (edge) {
      if (edge.shoreline && edge.shoreStyle === shoreStyle) continue
      commands.push({ type: 'updateTerrainEdge', id: edge.id, changes: { shoreline: true, shoreStyle } })
    } else {
      commands.push({ type: 'createTerrainEdge', id: nextId(relation.source), source: relation.source,
        kind: relation.requiresCliff ? 'cliff' : 'shore', shoreline: true, shoreStyle })
    }
  }
  return commands
}
