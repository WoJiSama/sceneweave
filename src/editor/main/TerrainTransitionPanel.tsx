import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene.js'
import type { SceneCommand } from '../../shared/commands/commands.js'
import type { TerrainTransition } from '../../shared/terrain-generation/composition-contracts.js'
import { materializeTerrainTransition } from '../../shared/visual/transition.js'
import { newId } from './runtime.js'

const names: Record<TerrainTransition['kind'], string> = {
  shore: '海岸 · 浅水/湿沙', riverMouth: '河口', grassRock: '草岩边界', forestEdge: '森林边缘', cliff: '高差崖边', pathShoulder: '道路路肩',
}
/** T10 controls own only requests. The shared materializer derives actual two
 * sides and frozen geometry before the ordinary candidate transaction. */
export default function TerrainTransitionPanel({ scene, layerId, disabled, onPreview }: {
  scene: SceneDocument; layerId: string; disabled: boolean
  onPreview: (commands: SceneCommand[], label: string) => void
}) {
  const visual = scene.visual?.version === 3 ? scene.visual : null
  const boundaries = Object.values(visual?.base.base.boundaries ?? {}).filter(boundary => boundary.binding.kind !== 'decoration')
  const [boundaryId, setBoundaryId] = useState(boundaries[0]?.id ?? '')
  const [kind, setKind] = useState<TerrainTransition['kind']>('shore')
  const [side, setSide] = useState<TerrainTransition['side']>('both')
  const [widthMm, setWidthMm] = useState(600), [sampleSpacingMm, setSpacing] = useState(300)
  const [error, setError] = useState('')
  if (!visual) return <p>请先在工程面板保存独立的完整 v4 地貌组合副本，再使用严格地形过渡。</p>
  const create = () => {
    try {
      const boundary = visual.base.base.boundaries[boundaryId]
      if (!boundary) throw new Error('请先选择已保存的真实地形或道路边界。')
      const transition = materializeTerrainTransition(scene, {
        id: newId(), floorId: boundary.floorId, layerId, visibility: boundary.visibility, editLocked: false,
        enabled: true, boundaryId, kind, side, widthMm, clipMm: scene.exportBoundsMm,
        sampleSpacingMm, reachMm: widthMm,
      })
      setError(''); onPreview([{ type: 'upsertTerrainTransition', transition }], `预览${names[kind]}过渡`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <section aria-label="地形过渡"><p>基于真实边界与两侧表面生成离散色带。结果随完整工程保存，不新增支撑或通行。</p>
    <fieldset disabled={disabled}>
      <label>来源边界<select aria-label="地形过渡来源边界" value={boundaryId} onChange={event => setBoundaryId(event.target.value)}><option value="">请选择已保存边界</option>{boundaries.map(boundary => <option key={boundary.id} value={boundary.id}>{boundary.binding.kind === 'path' ? '道路' : '地形'} · {boundary.id}</option>)}</select></label>
      <label>过渡类型<select aria-label="地形过渡类型" value={kind} onChange={event => setKind(event.target.value as TerrainTransition['kind'])}>{Object.entries(names).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <label>贴边方向<select aria-label="地形过渡方向" value={side} onChange={event => setSide(event.target.value as TerrainTransition['side'])}><option value="both">两侧</option><option value="left">持久曲线左侧</option><option value="right">持久曲线右侧</option></select></label>
      <label>宽度 mm<input aria-label="地形过渡宽度" type="number" min={1} step={50} value={widthMm} onChange={event => setWidthMm(Number(event.target.value))}/></label>
      <label>距离采样 mm<input aria-label="地形过渡距离采样" type="number" min={1} step={50} value={sampleSpacingMm} onChange={event => setSpacing(Number(event.target.value))}/></label>
      <button className="primary asset-wide" disabled={!boundaryId} onClick={create}>预览地形过渡</button>
      {Object.values(visual.transitions).map(transition => <div key={transition.id}><strong>{names[transition.kind]}</strong><span> · {transition.polygons.length} 片 / {transition.strokes.length} 笔触</span><button onClick={() => {
        try { const next = materializeTerrainTransition(scene, { ...transition, clipMm: transition.distanceSource.clipMm, sampleSpacingMm: transition.distanceSource.sampleSpacingMm, reachMm: transition.distanceSource.reachMm, enabled: !transition.enabled }); setError(''); onPreview([{ type: 'upsertTerrainTransition', transition: next }], transition.enabled ? '停用地形过渡' : '启用地形过渡') }
        catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
      }}>{transition.enabled ? '停用' : '启用'}</button><button onClick={() => onPreview([{ type: 'removeTerrainTransition', id: transition.id }], '移除地形过渡')}>移除</button></div>)}
    </fieldset>{error && <p role="alert">{error}</p>}
  </section>
}
