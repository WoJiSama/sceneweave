import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { NumberInput } from '../native-canvas/controls'
import { effectiveEditLocked } from '../../shared/commands/layers'
import { newId } from './runtime'
import RockShellTools from './RockShellTools'

export default function CarvedMountainTools({ scene, id, disabled, onPreview }: { scene: SceneDocument; id: string; disabled: boolean; onPreview: (commands: SceneCommand[], description: string) => void }) {
  const area = scene.terrainAreas[id], connection = scene.terrainConnections[id]
  const cuttable = area?.boundaryMm.filter((row, index) => {
    const next = area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm
    return row.positionMm.x === next.x || row.positionMm.y === next.y
  }) ?? []
  const [base, setBase] = useState(area?.rockBody?.baseElevationMm ?? 0), [segment, setSegment] = useState(cuttable[0]?.segmentId ?? '')
  const sourceSegment = cuttable.some(row => row.segmentId === segment) ? segment : cuttable[0]?.segmentId ?? ''
  const [points, setPoints] = useState(''), [width, setWidth] = useState(1000), [side, setSide] = useState<'left' | 'right'>('left')
  const [error, setError] = useState<string | null>(null)
  if (connection?.carvedStrip) return <details className="asset-details"><summary>连续凿岩山路</summary><p className="asset-muted">净宽 {connection.widthMm} mm · {connection.carvedStrip.stations.length} 个实际高程站点。山路与两侧切壁共同生成。</p><button className="secondary asset-wide" disabled={disabled || effectiveEditLocked(scene, id)} onClick={() => onPreview([{ type: 'removeCarvedMountainPath', id, disposition: 'restore-source-rock' }], '移除山路并回填源岩体')}>预览移除并回填岩体</button></details>
  if (!area) return null
  return <details className="asset-details" data-carved-mountain-tools><summary>岩体与连续山路</summary><fieldset disabled={disabled || effectiveEditLocked(scene, id)}>
    <NumberInput label="岩体底高" value={base} displayUnit={scene.units.display} onCommit={setBase}/>
    <button className="secondary asset-wide" disabled={!!area.rockBody?.shell} onClick={() => onPreview([{ type: 'setRockBody', id, rockBody: { baseElevationMm: base } }], '设置有限岩体与动态崖壁')}>预览{area.rockBody ? '修改岩体底高' : '建立岩体'}</button>
    {area.rockBody && <><RockShellTools key={`shell-${id}`} scene={scene} id={id} onPreview={onPreview}/><label>沿崖源边<select aria-label="山路源边" value={sourceSegment} disabled={!sourceSegment} onChange={event => setSegment(event.target.value)}>{area.boundaryMm.map((row, index) => {
      const next = area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm
      const slanted = row.positionMm.x !== next.x && row.positionMm.y !== next.y
      return <option key={row.segmentId} value={row.segmentId} disabled={slanted}>第 {index + 1} 段{slanted ? '（斜边，暂不支持凿路）' : ''}</option>
    })}</select></label>
      <label>朝向原崖外缘<select value={side} onChange={event => setSide(event.target.value as typeof side)}><option value="left">路线左侧朝外缘</option><option value="right">路线右侧朝外缘</option></select></label>
      <NumberInput label="山路净宽" value={width} displayUnit={scene.units.display} onCommit={setWidth}/>
      <label>路线与高程（毫米，每行 X Y Z）<textarea aria-label="山路实际路线" value={points} onChange={event => setPoints(event.target.value)} rows={5}/></label>
      <p className="asset-muted">从基础地面完整进入岩体，再连续爬升到顶面。岩体可含斜边；凿路源边须水平或竖直，入口须等高正交。</p>
      {!sourceSegment && <p className="asset-muted">当前岩体没有水平或竖直源边，暂不能沿斜崖凿路。</p>}
      <button className="secondary asset-wide" disabled={!sourceSegment} onClick={() => {
        try {
          const positions = points.trim().split(/\n+/).map(line => {
            const values = line.trim().split(/[\s,，]+/).map(Number)
            if (values.length !== 3 || !values.every(Number.isSafeInteger)) throw new Error('每行填写三个整数毫米坐标。')
            return { x: values[0], y: values[1], z: values[2] }
          })
          if (positions.length < 2) throw new Error('至少填写两个路线站点。')
          setError(null)
          const source = Object.values(scene.attachmentSurfaces ?? {}).find(row => row.owner.id === area.id && row.feature.kind === 'rockSourceFace' && row.feature.sourceSegmentIds.length === 1 && row.feature.sourceSegmentIds[0] === sourceSegment)
          const sourceId = source?.id ?? newId()
          const commands: SceneCommand[] = source ? [] : [{ type: 'addAttachmentSurface', id: sourceId, owner: { kind: 'terrainArea', id }, feature: { kind: 'rockSourceFace', sourceSegmentIds: [sourceSegment] }, capabilities: ['embed'] }]
          commands.push({ type: 'createCarvedMountainPath', id: newId(), attachmentId: newId(), walkSurfaceId: newId(), sourceSurfaceId: sourceId,
            fromSurfaceRef: { kind: 'floor', id: area.floorId }, toSurfaceRef: { kind: 'terrainArea', id: area.id }, pointsMm: positions, widthMm: width,
            cutSide: side, layerId: scene.entityLayers[id], visibility: area.visibility, follow: 'follow' })
          onPreview(commands, '预览连续山路、真实切壁与平台入口')
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      }}>预览山路与切壁</button></>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </fieldset></details>
}
