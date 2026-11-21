import { useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import { terrainEdgeFinishCommands } from '../../shared/commands/terrain-edge-finish'
import type { SceneDocument, TerrainArea, TerrainEdge } from '../../shared/model/scene'
import { NumberInput } from '../native-canvas/controls'
import { outdoorInspectorStyle } from './outdoor-inspector-style'

interface Props {
  scene: SceneDocument
  area: TerrainArea
  edge?: TerrainEdge
  onPreview: (commands: SceneCommand[], description: string) => void
}

export default function TerrainEdgeFinishPanel({ scene, area, edge, onPreview }: Props) {
  const theme = scene.activeStyleThemeRef && scene.styleThemes[scene.activeStyleThemeRef.id]
  const finishFor = (segmentId: string) => {
    const current = edge ?? Object.values(scene.terrainEdges).find(item => item.source.areaId === area.id
      && (!segmentId || item.source.segmentId === segmentId))
    return current?.styleOverride ?? (theme ? theme.edgeStyles[current?.kind ?? 'cliff'] : null)
      ?? { strokeWidthMm: 160, bandWidthMm: 550, color: '#243239' }
  }
  const [segmentId, setSegmentId] = useState(edge?.source.segmentId ?? '')
  const [finish, setFinish] = useState(() => finishFor(segmentId))
  const [material, setMaterial] = useState('')
  const selectScope = (id: string) => { setSegmentId(id); setFinish(finishFor(id)); setMaterial(''); setError('') }
  const [error, setError] = useState('')
  const preview = () => {
    try {
      setError('')
      const segments = segmentId === '' ? area.boundaryMm : area.boundaryMm.filter(point => point.segmentId === segmentId)
      const commands = terrainEdgeFinishCommands(scene, segments.map(point => ({ areaId: area.id, segmentId: point.segmentId })),
        finish, () => 'edge-' + crypto.randomUUID(), { skipCovered: segmentId === '', surfaceFor: material ? prior => {
          const style = outdoorInspectorStyle(scene, material, prior)!
          return prior ? style : { ...style, base: { ...style.base, alignment: 'surface' } }
        } : undefined })
      if (!commands.length) throw new Error('所选地形当前没有外露边缘。')
      onPreview(commands, '设置平台边缘')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <details><summary>平台边缘</summary>
    {!edge && <label>收边范围<select aria-label="收边范围" value={segmentId} onChange={event => selectScope(event.target.value)}>
      <option value="">完整轮廓</option>
      {area.boundaryMm.map((point, index) => <option key={point.segmentId} value={point.segmentId}>边段 {index + 1} · {point.positionMm.x}, {point.positionMm.y}</option>)}
    </select></label>}
    <label>边沿颜色<input aria-label="边沿颜色" type="color" value={finish.color} onChange={event => setFinish({ ...finish, color: event.target.value })}/></label>
    <NumberInput label="边沿线宽" ariaLabel="边沿线宽" displayUnit={scene.units.display} value={finish.strokeWidthMm} onCommit={strokeWidthMm => setFinish(current => ({ ...current, strokeWidthMm }))}/>
    <NumberInput label="收边带宽" ariaLabel="收边带宽" displayUnit={scene.units.display} value={finish.bandWidthMm} onCommit={bandWidthMm => setFinish(current => ({ ...current, bandWidthMm }))}/>
    <label>收边材质<select aria-label="收边材质" value={material} onChange={event => setMaterial(event.target.value)}>
      <option value="">保留各段材质</option>
      {Object.values(scene.materials).filter(definition => definition.applicableSurfaces.includes('terrain')).map(definition =>
        <option key={definition.id} value={definition.id}>{definition.name} · v{definition.version}</option>)}
    </select></label>
    <small>整圈沿外露轮廓铺设。也可以单独调整一段。</small>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
    <button type="button" className="secondary asset-wide" onClick={preview}>预览平台边缘</button>
  </details>
}
