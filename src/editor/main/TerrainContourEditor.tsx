import { useEffect, useMemo, useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { PointMm, SceneDocument } from '../../shared/model/scene'
import { terrainCliffBindings } from '../../shared/visual/terrain-cliff-style'
import type { VisualBoundary } from '../../shared/visual/types'
import type { VisualBoundaryEditor } from './VisualPanel'

export default function TerrainContourEditor({ scene, areaId, disabled, onBoundaryEditor, onFocusCanvas, onPreview }: {
  scene: SceneDocument
  areaId: string
  disabled: boolean
  onBoundaryEditor: (value: VisualBoundaryEditor | null) => void
  onFocusCanvas: (points: PointMm[]) => void
  onPreview: (commands: SceneCommand[], description: string) => void
}) {
  const boundaries = useMemo(() => terrainCliffBindings(scene, areaId).map(item => item.boundary).filter(boundary => !boundary.fence), [scene, areaId])
  const [boundaryId, setBoundaryId] = useState('')
  const [draft, setDraft] = useState<VisualBoundary | null>(null)
  const boundary = boundaries.find(item => item.id === boundaryId) ?? boundaries[0]
  const locked = boundary && (boundary.editLocked || scene.userLayers[boundary.layerId]?.editLocked ||
    boundary.binding.kind === 'terrain' && boundary.binding.sides.some(({ areaId }) =>
      scene.terrainAreas[areaId]?.editLocked || scene.userLayers[scene.entityLayers[areaId]]?.editLocked))
  const changed = !!draft && JSON.stringify(draft.segments) !== JSON.stringify(boundary?.segments)

  useEffect(() => {
    if (!draft || disabled || locked) return
    onBoundaryEditor({ boundary: draft, onChange: setDraft })
    return () => onBoundaryEditor(null)
  }, [draft, disabled, locked, onBoundaryEditor])

  if (!boundary) return null
  return <section aria-label="地形轮廓">
    <h3>地形轮廓</h3>
    <fieldset disabled={disabled}>
      {boundaries.length > 1 && <label>调整哪段边缘<select aria-label="地形轮廓范围" data-outdoor-view-control value={boundary.id} disabled={changed}
        onChange={event => { setBoundaryId(event.target.value); setDraft(null) }}>
        {boundaries.map((row, index) => <option key={row.id} value={row.id}>
          {row.closed ? '整圈轮廓' : `边段 ${index + 1}`}{row.binding.kind === 'terrain' && row.binding.sides.length > 1 ? ' · 与邻地共享' : ''}
        </option>)}
      </select></label>}
      <button type="button" className="secondary asset-wide" disabled={locked} onClick={() => {
        if (!draft) setDraft(boundary)
        onFocusCanvas((draft ?? boundary).segments.flatMap(segment => [segment.start, segment.control1, segment.control2, segment.end]))
      }}>{draft ? '定位轮廓控制点' : '在画布调整轮廓'}</button>
      {locked && <small>该轮廓或与它共边的地形已锁定。</small>}
      {draft && <><p className="asset-muted">拖动节点调整轮廓，预览共边、支撑和崖壁的联动。</p>
        <button type="button" className="primary asset-wide" disabled={locked || !changed}
          onClick={() => onPreview([{ type: 'upsertVisualBoundary', boundary: draft }], '调整地形轮廓')}>预览轮廓修改</button>
        {!changed && <button type="button" className="secondary asset-wide" onClick={() => setDraft(null)}>关闭轮廓控制点</button>}
      </>}
    </fieldset>
  </section>
}
