import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { createTerrainInlayCommand } from '../../shared/terrain-inlay/create'
import { effectiveEditLocked } from '../../shared/commands/layers'

export default function TerrainInlayTools({ scene, id, disabled, onPreview }: {
  scene: SceneDocument; id: string; disabled: boolean; onPreview: (commands: SceneCommand[], description: string) => void
}) {
  const connection = scene.terrainConnections[id]
  const [opening, setOpening] = useState(false), [side, setSide] = useState<'left' | 'right'>('right')
  const [start, setStart] = useState('1'), [end, setEnd] = useState(''), [sourceId, setSourceId] = useState(connection?.to.surfaceRef.id ?? '')
  const [first, setFirst] = useState('1'), [last, setLast] = useState('1'), [connectors, setConnectors] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!connection || connection.carvedStrip) return null
  if (connection.terrainInlay) return <details className="asset-details" data-terrain-inlay-tools><summary>连续填切山路</summary>
    <p className="asset-muted">沿原路线平顺爬升，低处补岩基、高处切入。两块源地形和原连接已完整保留。</p>
    <button className="secondary asset-wide" disabled={disabled || effectiveEditLocked(scene, id)} onClick={() => onPreview([
      { type: 'restoreTerrainInlaySource', id, disposition: 'restore-original-connection-and-ground' },
    ], '恢复原连接与填切前地形')}>预览恢复原连接和地形</button></details>
  if (connection.from.surfaceRef.kind !== 'terrainArea' || connection.to.surfaceRef.kind !== 'terrainArea') return null
  const sources = [connection.from, connection.to].map(end => scene.terrainAreas[end.surfaceRef.id]).filter(Boolean)
  const source = sources.find(area => area.id === sourceId) ?? sources.at(-1)
  const stationCount = connection.route?.centerlineMm.length ?? 2
  return <details className="asset-details" data-terrain-inlay-tools><summary>改为连续山路</summary><fieldset disabled={disabled || effectiveEditLocked(scene, id)}>
    <p className="asset-muted">保留完整弯曲走向和净宽，在两端地形高度之间平顺爬升。可先预览，再采用或取消。</p>
    <label><input type="checkbox" checked={opening} onChange={event => setOpening(event.target.checked)}/>同时打开一侧崖壁</label>
    {opening && <><label>开口朝向<select value={side} onChange={event => setSide(event.target.value as typeof side)}><option value="right">沿路线右侧</option><option value="left">沿路线左侧</option></select></label>
      <label>开口从路线第几个点开始<input type="number" min="1" max={stationCount} value={start} onChange={event => setStart(event.target.value)}/></label>
      <label>开口到路线第几个点结束<input type="number" min="2" max={stationCount} placeholder={String(stationCount)} value={end} onChange={event => setEnd(event.target.value)}/></label>
      <label>连接到源崖<select value={source?.id ?? ''} onChange={event => setSourceId(event.target.value)}>{sources.map(area => <option key={area.id} value={area.id}>{area.id}</option>)}</select></label>
      <label>源崖起点序号<input type="number" min="1" max={source?.boundaryMm.length ?? 1} value={first} onChange={event => setFirst(event.target.value)}/></label>
      <label>源崖终点序号<input type="number" min="1" max={source?.boundaryMm.length ?? 1} value={last} onChange={event => setLast(event.target.value)}/></label>
      <p className="asset-muted">按原轮廓顺序连接两点之间的整段崖缘，经过末点后可接回第一点。开口沿所选范围内的附近路段延续爬升；超出路宽的区域不能行走。</p>
      <label>开口末端连接点（可选，每行 X Y，毫米）<textarea rows={2} value={connectors} onChange={event => setConnectors(event.target.value)}/></label></>}
    <button className="secondary asset-wide" onClick={() => {
      try {
        setError(null)
        let intent
        if (opening) {
          if (!source) throw Error('请选择现存源崖。')
          const from = Number(first) - 1, to = Number(last) - 1
          if (![from, to].every(Number.isSafeInteger) || from < 0 || to < 0 || from >= source.boundaryMm.length || to >= source.boundaryMm.length || from === to) throw Error('请选择两个不同的有效源崖点。')
          const sourcePointIds: string[] = []
          for (let index = from;; index = (index + 1) % source.boundaryMm.length) { sourcePointIds.push(source.boundaryMm[index].id); if (index === to) break }
          const connectorsMm = connectors.trim() ? connectors.trim().split(/\n+/).map(line => {
            const values = line.trim().split(/[\s,，]+/).map(Number)
            if (values.length !== 2 || !values.every(Number.isSafeInteger)) throw Error('连接点每行填写两个整数毫米坐标。')
            return { x: values[0], y: values[1] }
          }) : []
          intent = { side, startStation: Number(start) - 1, endStation: (end ? Number(end) : stationCount) - 1, sourceAreaId: source.id, sourcePointIds, connectorsMm }
        }
        const command = createTerrainInlayCommand(scene, id, intent)
        onPreview([command], '连续山路、补岩基与切入高台；保留源岸线，填切域内由新面覆盖、范围外保留')
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    }}>预览连续山路</button>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </fieldset></details>
}
