import type { EdgeStyle, SceneDocument, SurfaceStyle, TerrainEdge } from '../model/scene.js'
import { canonicalTerrainEdge, findExposedTerrainEdge, type OutdoorCommand } from './outdoor.js'

/** Apply a shared finish to existing edges or their exposed terrain sources. */
export function terrainEdgeFinishCommands(scene: SceneDocument, sources: readonly TerrainEdge['source'][], style: EdgeStyle,
  nextId: () => string, options: { surfaceFor?: (prior: SurfaceStyle | null, source: TerrainEdge['source']) => SurfaceStyle | null; skipCovered?: boolean } = {}): OutdoorCommand[] {
  const key = (source: TerrainEdge['source']) => JSON.stringify([source.areaId, source.segmentId])
  const existing = new Map(Object.values(scene.terrainEdges).map(edge => [key(edge.source), edge]))
  const visited = new Set<string>(), commands: OutdoorCommand[] = []
  for (const requested of sources) {
    const edgeSource = options.skipCovered ? findExposedTerrainEdge(scene, requested) : canonicalTerrainEdge(scene, requested)
    if (!edgeSource) continue
    const { source } = edgeSource
    const identity = key(source)
    if (visited.has(identity)) continue
    visited.add(identity)
    const edge = existing.get(identity)
    const finish = { styleOverride: style, ...(options.surfaceFor ? { surfaceStyle: options.surfaceFor(edge?.surfaceStyle ?? null, source) } : {}) }
    commands.push(edge ? { type: 'updateTerrainEdge', id: edge.id, changes: finish }
      : { type: 'createTerrainEdge', id: nextId(), source, ...finish })
  }
  return commands
}
