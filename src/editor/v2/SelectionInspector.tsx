import { useEffect, useMemo, useState } from 'react'
import type { SceneDocumentV2 } from '../../core/v2/types'
import type { SelectionActionV2 } from './selection-actions'
import { selectionActionReasonV2 } from './selection-actions'
import { summarizeSelectionV2 } from './selection-summary'
import { NumberInput } from './controls'

function SelectionDetails({ scene, ids }: { scene: SceneDocumentV2; ids: readonly string[] }) {
  const props = ids.map(id => scene.props[id]).filter(Boolean)
  const common = <T,>(values: T[]) => values.length === ids.length && values.every(value => value === values[0]) ? String(values[0]) : '混合'
  return <dl className="asset-facts"><dt>旋转角度</dt><dd>{common(props.map(p => p.rotationDeg))}</dd><dt>可见范围</dt><dd>{common(props.map(p => p.visibility === 'public' ? '公开' : '仅主持人'))}</dd></dl>
}
const typeNames: Record<string, string> = { prop: '物件', prefabInstance: '组合', scatterGroup: '散布', room: '房间', terrainArea: '地形', terrainEdge: '边缘', terrainConnection: '连接', wall: '墙', opening: '门窗', vertex: '顶点', note: '注记', region: '区域', path: '道路', terrainPoint: '地形顶点' }
export default function SelectionInspector({ scene, ids, busy, onAction, onClear, summaryReader = summarizeSelectionV2 }: { scene: SceneDocumentV2; ids: readonly string[]; busy: boolean; onAction: (action: SelectionActionV2, values?: { dx?: number; dy?: number; angle?: number }) => void; onClear: () => void; summaryReader?: typeof summarizeSelectionV2 }) {
  const [dx, setDx] = useState(0), [dy, setDy] = useState(0), [angle, setAngle] = useState(0)
  const [details, setDetails] = useState(false)
  useEffect(() => { setDx(0); setDy(0); setAngle(0); setDetails(false) }, [ids])
  const summary = useMemo(() => summaryReader(scene, ids, true), [scene, ids, summaryReader])
  const reasons = useMemo(() => Object.fromEntries((['move', 'copy', 'delete', 'lock', 'unlock'] as const).map(action => [action, summary.overCommandBudget ? '一次事务最多 256 条命令，请缩小选择范围。' : selectionActionReasonV2(scene, ids, action)])), [scene, ids, summary.overCommandBudget])
  const moveReason = reasons.move
  return <><div className="asset-section-heading"><h2>多选属性</h2></div><h3>已选择 {summary.count} 个对象</h3><dl className="asset-facts"><dt>有效锁定</dt><dd>{summary.effectiveLockedCount} 个</dd><dt>对象类型</dt><dd>{Object.entries(summary.typeCounts).map(([kind, count]) => `${typeNames[kind] ?? kind} ${count}`).join(' · ')}</dd>{summary.boundsMm && <><dt>选择范围</dt><dd>{(summary.boundsMm.width / 1000).toFixed(2)} × {(summary.boundsMm.height / 1000).toFixed(2)} m</dd></>}</dl>
    <details open={details} onToggle={event => setDetails(event.currentTarget.open)}><summary>查看共同属性</summary>{details && <SelectionDetails scene={scene} ids={ids}/>}</details>
    <p className="asset-muted">位移以毫米输入；旋转围绕所选图像范围的共同中心。先预览，再一次采用。</p>
    <fieldset disabled={busy || !!moveReason}><NumberInput label="批量位移 X" value={dx} onCommit={setDx}/><NumberInput label="批量位移 Y" value={dy} onCommit={setDy}/><button className="secondary asset-wide" onClick={() => onAction('move', { dx, dy })}>预览批量移动</button><NumberInput label="批量旋转" value={angle} unit="°" onCommit={setAngle}/><button className="secondary asset-wide" onClick={() => onAction('rotate', { angle })}>预览批量旋转</button></fieldset>{moveReason && <p className="asset-muted">{moveReason}</p>}
    {(['copy', 'delete', 'lock', 'unlock'] as const).map(action => { const reason = reasons[action], label = { copy: '预览复制所选', delete: '预览删除所选', lock: '锁定所选', unlock: '解锁所选' }[action]; return <div key={action}><button className="secondary asset-wide" disabled={busy || !!reason} title={reason ?? ''} onClick={() => onAction(action)}>{label}</button>{reason && <small className="asset-muted">{reason}</small>}</div> })}<button className="asset-clear" onClick={onClear}>清空选择</button></>
}
