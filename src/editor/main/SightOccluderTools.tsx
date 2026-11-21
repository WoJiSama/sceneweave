import { useState } from 'react'
import { copySightOccluder, readSightOccluderClipboard } from '../../platform/browser/storage/component-clipboard'
import type { SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'

export default function SightOccluderTools({ scene, id, disabled, onDraw, onPreview }: {
  scene: SceneDocument; id: string; disabled: boolean
  onDraw: (id: string) => void
  onPreview: (commands: SceneCommand[], description: string) => void
}) {
  const prop = scene.props[id], current = prop.sightOccluder
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null)
  const preview = (component: NonNullable<typeof current> | null, description: string) =>
    onPreview([{ type: 'setPropSightOccluder', id, component }], description)
  const attempt = (action: () => void) => {
    try { setFeedback(null); action() }
    catch (error) { setFeedback({ error: true, message: error instanceof Error ? error.message : String(error) }) }
  }
  return <details className="asset-details" data-sight-occluder-tools>
    <summary>视线遮挡组件{current ? ' · 已添加' : ''}</summary>
    <fieldset disabled={disabled}>
      <button type="button" className="secondary asset-wide" onClick={() => onDraw(id)}>{current ? '在画布重画遮挡线' : '在画布画遮挡线'}</button>
      {current && <>
        <label>遮挡可见范围<select aria-label="遮挡可见范围" value={current.visibility}
          onChange={event => preview({ ...current, visibility: event.target.value === 'gm' ? 'gm' : 'public' }, '调整遮挡组件可见范围')}>
          <option value="public">跟随物件可见范围</option><option value="gm">仅主持人</option>
        </select></label>
        <button type="button" className="secondary asset-wide" onClick={() => attempt(() => {
          copySightOccluder(scene, prop)
          setFeedback({ error: false, message: '已复制遮挡线。可在此标签页换项目，或去另一个标签页粘贴。' })
        })}>复制遮挡组件</button>
        <button type="button" className="secondary asset-wide" onClick={() => preview(null, '移除视线遮挡组件')}>移除遮挡组件</button>
      </>}
      <button type="button" className="secondary asset-wide" onClick={() => attempt(() =>
        preview(readSightOccluderClipboard(), current ? '粘贴并替换遮挡组件' : '粘贴遮挡组件'))}>
        {current ? '预览粘贴并替换遮挡组件' : '预览粘贴遮挡组件'}
      </button>
      {feedback && <p className={feedback.error ? 'asset-form-error' : 'asset-muted'} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
    </fieldset>
  </details>
}
