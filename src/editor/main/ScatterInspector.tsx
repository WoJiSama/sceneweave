import { Layers3, LockKeyhole, Sprout } from 'lucide-react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { EditableProject } from '../../application/workspace/project'
import { NumberInput } from '../native-canvas/controls'
import { scatterName } from './terrain-editing'
import { isSupportedScatterAlgorithm } from '../../shared/geometry/scatter-algorithm'

type Props = {
  project: EditableProject; selected: string; busy: boolean
  onSelect: (id: string | null) => void
  onCommit: (commands: SceneCommand[]) => void
  onPreview: (commands: SceneCommand[], description: string) => void
}
const stateLabels = { managed: '自动', manual: '人工', deleted: '已删除', detached: '已退出' }

export default function ScatterInspector({ project, selected, busy, onSelect, onCommit, onPreview }: Props) {
  const scene = project.document, group = scene.scatterGroups[selected], members = Object.values(group.members)
  const live = members.filter(member => member.propId !== null)
  return <><div className="asset-section-heading"><Sprout size={16}/><h2>散布管理</h2></div><h3>{scatterName(scene, group)}</h3>
    <p className="asset-muted">预览新的疏密，采用后整体保存。人工移动、删除和锁定的物件会保留。</p>
    <dl className="asset-facts"><dt>现有物件</dt><dd>{live.length} 件</dd><dt>人工调整</dt><dd>{members.filter(member => member.state === 'manual').length} 件</dd><dt>删除记录</dt><dd>{members.filter(member => member.state === 'deleted').length} 条</dd><dt>保留区域</dt><dd>{group.exclusions.length} 处</dd></dl>
    <fieldset disabled={busy || group.editLocked || !isSupportedScatterAlgorithm(group.algorithmVersion)}>
      <NumberInput label="散布密度" value={Math.round(group.densityFactor * 10000) / 100} unit="%" step={5} onCommit={density => onPreview([{ type: 'regenerateScatter', id: selected, densityFactor: density / 100 }], '调整散布密度')}/>
      <button className="secondary asset-wide" onClick={() => onPreview([{ type: 'regenerateScatter', id: selected }], '重新预览散布')}>预览散布</button>
    </fieldset>
    {!isSupportedScatterAlgorithm(group.algorithmVersion) && <p className="asset-muted">当前版本无法重新生成此组，已保存的物件仍可单独编辑。</p>}
    <button className="asset-group-link asset-wide" disabled={busy} onClick={() => onCommit([{ type: 'setEditLock', kind: 'scatterGroup', id: selected, locked: !group.editLocked }])}><LockKeyhole size={14}/>{group.editLocked ? '解除散布锁定' : '锁定整组散布'}</button>
    <h3>现有成员</h3><div className="asset-member-list">{Object.entries(group.members).flatMap(([key, member]) => member.propId && scene.props[member.propId] ? [<button key={key} disabled={busy} onClick={() => onSelect(member.propId)}>{scene.props[member.propId].definitionRef ? scene.propDefinitions[scene.props[member.propId].definitionRef!.id].name : '散布物件'}<small>{stateLabels[member.state]}{scene.props[member.propId].editLocked ? ' · 已锁定' : ''}</small></button>] : [])}</div>
    <p className="asset-muted"><Layers3 size={12}/> 密度调整保留人工记录；台阶与接入区按组内明确的排除范围保护。</p><button className="asset-clear" onClick={() => onSelect(null)}>返回工程信息</button>
  </>
}
