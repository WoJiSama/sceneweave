import { useState } from 'react'
import type { AppearanceGraph } from '../../shared/model/appearance.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import type { BuildingPreviewRequest } from './building-privacy-review.js'
import { planRoomPrivacy, roomPrivacyChoices } from './room-privacy-plan.js'
import { newId } from './runtime.js'

export default function RoomPrivacyControls({ scene, appearance, roomId, purpose, accessExpectation, layerId, onPreview }: {
  scene: SceneDocument; appearance?: AppearanceGraph; roomId: string; purpose: string
  accessExpectation: SceneDocument['rooms'][string]['accessExpectation']; layerId: string; onPreview: BuildingPreviewRequest
}) {
  const choices = roomPrivacyChoices(scene, roomId)
  const [openings, setOpenings] = useState<string[]>([]), [notes, setNotes] = useState<string[]>([])
  const [clue, setClue] = useState(''), [error, setError] = useState<string | null>(null)
  const [preservePublicRooms, setPreservePublicRooms] = useState(true)
  const toggle = (values: string[], id: string, checked: boolean) => checked ? [...values.filter(value => value !== id), id] : values.filter(value => value !== id)
  const preview = () => {
    try {
      setError(null)
      const plan = planRoomPrivacy({ scene, appearance, roomId, purpose, accessExpectation, secretOpeningIds: openings,
        privateNoteIds: notes, layerId, nextMaskId: newId, preservePublicRooms })
      const commands = [...plan.commands]
      if (clue.trim()) commands.push({ type: 'createNote', id: newId(), floorId: scene.rooms[roomId].floorId, layerId,
        anchor: { type: 'entity', entityKind: 'room', entityId: roomId }, kind: 'clue', text: clue.trim(), visibility: 'gm' })
      onPreview(commands, plan.description, { floorId: scene.rooms[roomId].floorId, coverageIssues: plan.coverageIssues })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <section className="building-details" aria-label="秘密房间设置">
    <h3>一起设置秘密房间</h3>
    <p className="asset-muted">选择要与房间一起设为秘密的入口和线索。预览会计算所需的玩家遮罩。</p>
    <label className="building-check"><input type="checkbox" aria-label="保留相邻公开房间" checked={preservePublicRooms} onChange={event => setPreservePublicRooms(event.target.checked)}/>保留相邻公开房间的玩家画面</label>
    {!!choices.openings.length && <fieldset><legend>同时隐藏的入口</legend>{choices.openings.map(choice => <label className="building-check" key={choice.id}>
      <input type="checkbox" aria-label={`同时设为秘密入口 ${choice.label}`} checked={openings.includes(choice.id)} onChange={event => setOpenings(current => toggle(current, choice.id, event.target.checked))}/>{choice.label}
    </label>)}</fieldset>}
    {!!choices.notes.length && <details><summary>同时隐藏已有线索</summary>{choices.notes.map(choice => <label className="building-check" key={choice.id}>
      <input type="checkbox" aria-label={`同时设为主持人线索 ${choice.label}`} checked={notes.includes(choice.id)} onChange={event => setNotes(current => toggle(current, choice.id, event.target.checked))}/>{choice.label}
    </label>)}</details>}
    <label className="building-field">新增主持人线索（可选）<textarea aria-label="秘密房间线索" maxLength={100000} rows={2} value={clue} onChange={event => setClue(event.target.value)}/></label>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
    <button className="primary asset-wide" type="button" onClick={preview}>预览房间属性</button>
    <p className="asset-muted">在两种视角中检查秘密和相邻空间。可以一次撤销这笔修改。</p>
  </section>
}
