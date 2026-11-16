import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { NumberInput } from '../native-canvas/controls'

export default function RockShellTools({ scene, id, onPreview }: { scene: SceneDocument; id: string; onPreview: (commands: SceneCommand[], description: string) => void }) {
  const area = scene.terrainAreas[id]
  const [width, setWidth] = useState(2400), [direction, setDirection] = useState('south')
  const [excluded, setExcluded] = useState<string[]>([area.boundaryMm[0].segmentId, area.boundaryMm.at(-1)!.segmentId])
  const shell = area.rockBody?.shell
  return <details className="asset-details" data-rock-shell-tools><summary>岩肩、主壁与坡脚</summary>
    {shell ? <><p className="asset-muted">已保存实际侧面与脚线。侧坡占用真实地面，默认不可步行；原可站立顶面保持。</p>
      <button className="secondary asset-wide" onClick={() => onPreview([{ type: 'removeRockShell', id, disposition: 'restore-vertical-body' }], '移除侧坡并恢复竖直岩体')}>预览移除岩肩与坡脚</button></>
      : <><NumberInput label="岩体侧坡最大宽度" value={width} displayUnit={scene.units.display} onCommit={setWidth}/>
        <label>较宽坡面朝向<select aria-label="侧坡造型朝向" value={direction} onChange={event => setDirection(event.target.value)}>
          <option value="south">下方</option><option value="east">右方</option><option value="north">上方</option><option value="west">左方</option>
        </select></label>
        <p className="asset-muted">先建立侧坡，再创建山路。为预定的山路源崖和地面入口保留竖直边；首片不自动延长切口穿过侧坡。</p>
        {area.boundaryMm.map((row, index) => <label key={row.segmentId}><input type="checkbox" checked={excluded.includes(row.segmentId)}
          onChange={event => setExcluded(values => event.target.checked ? [...values, row.segmentId] : values.filter(id => id !== row.segmentId))}/>
          第 {index + 1} 段保留竖直（源崖或入口）</label>)}
        <button className="secondary asset-wide" onClick={() => onPreview([{ type: 'createRockShell', id, widthMm: width,
          direction: direction === 'south' ? { x: 0, y: 1 } : direction === 'east' ? { x: 1, y: 0 } : direction === 'north' ? { x: 0, y: -1 } : { x: -1, y: 0 },
          seed: `${id}/rock-shell1`, excludedSegmentIds: excluded }], '生成真实岩肩、主壁与坡脚；复核新增占地和入口')}>预览岩肩与坡脚</button></>}
  </details>
}
