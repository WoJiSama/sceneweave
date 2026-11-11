import { useState } from 'react'
import type { EditableProject } from '../../application/workspace/project.js'
import type { SceneCommand } from '../../shared/commands/commands.js'
import { effectiveEditLocked } from '../../shared/commands/layers.js'
import { createPublicVisibility } from '../../shared/geometry/visibility.js'
import { NumberInput } from '../native-canvas/controls.js'
import { formatDistanceMm } from '../native-canvas/building-session.js'
import { newId } from './runtime.js'

interface Draft {
  openingId: string
  pathId: string
  end: 'start' | 'end'
  leadLengthMm: number
  maxDisplacementMm: number
}
const initial = (openingId: string): Draft => ({ openingId, pathId: '', end: 'start', leadLengthMm: 1000, maxDisplacementMm: 5000 })
export interface PathAttachmentToolsProps {
  project: EditableProject
  openingId: string
  disabled: boolean
  onDraftChange: () => void
  onPreview: (commands: SceneCommand[], label: string) => void
}

/** User intent only. The normal composition preview constructs and validates
 * the actual endpoint plan, current structure proofs and complete dependencies. */
export default function PathAttachmentTools({ project, openingId, disabled, onDraftChange, onPreview }: PathAttachmentToolsProps) {
  const scene = project.document, opening = scene.openings[openingId], visible = createPublicVisibility(scene)
  const [storedDraft, setDraft] = useState(() => initial(openingId))
  const [failure, setFailure] = useState<{ openingId: string; message: string } | null>(null)
  // A selection change never exposes a previous door's pending intent for one
  // render, and automatic defaults never mark the inspector draft as edited.
  const draft = storedDraft.openingId === openingId ? storedDraft : initial(openingId)
  const patch = (change: Partial<Omit<Draft, 'openingId'>>) => { if (!disabled) setDraft({ ...draft, ...change }) }
  if (!opening || opening.kind !== 'door') return null
  const relations = Object.values(scene.pathAttachments ?? {}).filter(row => row.openingId === openingId).sort((a, b) => a.pathId.localeCompare(b.pathId) || a.id.localeCompare(b.id))
  const attachedPaths = new Set(Object.values(scene.pathAttachments ?? {}).map(row => row.pathId))
  const paths = Object.values(scene.paths).filter(path => path.floorId === opening.floorId && visible.path(path.id)).sort((a, b) => a.id.localeCompare(b.id))
  const selectedPath = paths.find(path => path.id === draft.pathId), initialized = project.historyIdentity.structureTokens !== undefined
  const wall = scene.walls[opening.wallId]
  const rooms = wall ? Object.values(scene.rooms).filter(room => room.boundaryVertexIds.some((id, index, ring) => {
    const next = ring[(index + 1) % ring.length]
    return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId
  })) : []
  const entranceReason = !wall || rooms.length !== 1 ? '请使用只连接一个房间的真实外门。'
    : !visible.opening(openingId) || !visible.room(rooms[0].id) ? '持续附着只支持公开外门及公开支撑。'
      : rooms[0].supportRef.kind !== 'terrainArea' ? '持续附着需要房间明确使用地形面支撑。' : null
  const reason = !initialized ? '请先明确建立当前结构身份，再预览门路绑定。'
    : entranceReason ?? (effectiveEditLocked(scene, openingId) ? '外门或其图层已锁定，请先单独解锁。'
      : !selectedPath ? paths.length ? '请选择同楼层的一条公开道路。' : '此楼层还没有可选公开道路，请先创建道路。'
        : attachedPaths.has(selectedPath.id) ? '这条道路已有附着关系，请先解除；每条道路只绑定一个端点。'
          : effectiveEditLocked(scene, selectedPath.id) ? '选定道路或其图层已锁定，请先单独解锁。'
            : !Number.isSafeInteger(draft.leadLengthMm) || draft.leadLengthMm <= 0 ? '门前直入段长度须为正整数毫米。'
              : !Number.isSafeInteger(draft.maxDisplacementMm) || draft.maxDisplacementMm < 0 ? '最大端点位移须为非负整数毫米。' : null)
  const preview = (commands: SceneCommand[], label: string) => {
    if (disabled) return
    try { setFailure(null); onPreview(commands, label) }
    catch (error) { setFailure({ openingId, message: error instanceof Error ? error.message : String(error) }) }
  }
  return <section className="workspace-control-section" aria-label="门口持续道路关系" onChangeCapture={() => {
    if (!disabled) { setFailure(null); onDraftChange() }
  }}>
    <h3>门路持续附着</h3>
    <p className="asset-muted">门前直入段随门移动，后续人工路线保留。拆墙、改变拓扑或更换支撑等不支持的变化，请先解除关系；接入和随动都受最大位移限制。</p>
    <p className="asset-muted">门当前{opening.state === 'open' ? '打开' : '关闭'}{opening.locked ? '且已上锁' : '且未上锁'}。关门或上锁会保留结构关系，当前通行另行计算。</p>
    {relations.length ? <ul className="asset-result-list" aria-label="此外门的道路附着">{relations.map(row => {
      const path = scene.paths[row.pathId], dependencyLocked = !!path && (effectiveEditLocked(scene, path.id) || effectiveEditLocked(scene, openingId))
      return <li key={row.id}>
        <p><strong>道路 · {row.pathId}</strong> · {row.end === 'start' ? '起点' : '终点'}{row.editLocked ? ' · 关系已锁定' : ''}</p>
        <p className="asset-muted">直入段 {formatDistanceMm(row.leadLengthMm, scene.units.display)} · 最大位移 {formatDistanceMm(row.maxDisplacementMm, scene.units.display)}</p>
        <div className="building-actions">
          {row.editLocked
            ? <button type="button" className="secondary" disabled={disabled} onClick={() => preview([{ type: 'setEditLock', kind: 'pathAttachment', id: row.id, locked: false }], '解锁门路附着关系')}>解锁附着关系</button>
            : <><button type="button" className="secondary" disabled={disabled || dependencyLocked} onClick={() => preview([{ type: 'setEditLock', kind: 'pathAttachment', id: row.id, locked: true }], '锁定门路附着关系')}>锁定附着关系</button>
              <button type="button" className="secondary" disabled={disabled || dependencyLocked} onClick={() => preview([{ type: 'detachPathAttachment', id: row.id }], '解除门路附着，保留道路形状')}>解除关系</button></>}
        </div>
        {!row.editLocked && dependencyLocked && <p className="asset-muted">道路、外门或相关图层已锁定，请先单独处理锁定。</p>}
      </li>
    })}</ul> : <p className="workspace-empty-hint">此外门尚未绑定道路。每条道路可明确绑定一个端点。</p>}
    {!initialized && <><p className="asset-muted">当前工程尚未建立建筑结构身份。明确预览并采用后，只证明当前结构，不倒推历史。</p>
      <button type="button" className="secondary asset-wide" disabled={disabled} onClick={() => preview([{ type: 'initializeStructureIdentity' }], '建立当前结构身份，不追溯历史')}>预览建立当前结构身份</button></>}
    <fieldset disabled={disabled || !initialized || !!entranceReason}>
      <legend>绑定已有公开道路</legend>
      <label className="building-field">道路<select aria-label="门路附着道路" value={draft.pathId} onChange={event => patch({ pathId: event.target.value })}>
        <option value="">明确选择一条道路</option>
        {draft.pathId && !selectedPath && <option value={draft.pathId} disabled>原选道路已改变或不再公开</option>}
        {paths.map(path => <option key={path.id} value={path.id} disabled={attachedPaths.has(path.id) || effectiveEditLocked(scene, path.id)}>道路 · {path.id}{attachedPaths.has(path.id) ? ' · 已有附着' : effectiveEditLocked(scene, path.id) ? ' · 已锁定' : ''}</option>)}
      </select></label>
      <label className="building-field">附着端点<select aria-label="门路附着端点" value={draft.end} onChange={event => patch({ end: event.target.value as Draft['end'] })}><option value="start">道路起点</option><option value="end">道路终点</option></select></label>
      <div className="workspace-field-pair">
        <NumberInput displayUnit={scene.units.display} label="门前直入段长度" value={draft.leadLengthMm} onCommit={leadLengthMm => patch({ leadLengthMm })}/>
        <NumberInput displayUnit={scene.units.display} label="最大端点位移" value={draft.maxDisplacementMm} onCommit={maxDisplacementMm => patch({ maxDisplacementMm })}/>
      </div>
      <button type="button" className="primary asset-wide" disabled={!!reason} onClick={() => {
        if (reason) return
        preview([{ type: 'bindPathAttachment', id: newId(), pathId: draft.pathId, openingId, end: draft.end, leadLengthMm: draft.leadLengthMm, maxDisplacementMm: draft.maxDisplacementMm }], '绑定道路端点到此外门')
      }}>预览绑定门路</button>
    </fieldset>
    {reason && <p className="asset-muted" role="status">{reason}</p>}
    {failure?.openingId === openingId && <p className="asset-error" role="alert">{failure.message}</p>}
  </section>
}
