import { useEffect, useRef, useState } from 'react'
import type { SceneDocument, SceneOutputBackground } from '../../shared/model/scene'
import type { SceneBackgroundCommand } from '../../shared/commands/scene-background'
import { sceneOutputBackgroundSchema } from '../../shared/validation/scene-background'

export default function SceneBackgroundTools({ scene, disabled, onPreview, onDraftChange }: {
  scene: SceneDocument
  disabled: boolean
  onPreview: (commands: SceneBackgroundCommand[], description: string) => void
  onDraftChange?: (active: boolean) => void
}) {
  const [mode, setMode] = useState<'default' | SceneOutputBackground['mode']>(scene.outputBackground?.mode ?? 'default')
  const [color, setColor] = useState(scene.outputBackground?.mode === 'solid' ? scene.outputBackground.color : '#F4F0E5')
  const [error, setError] = useState<string | null>(null)
  const draftChange = useRef(onDraftChange)
  draftChange.current = onDraftChange
  const savedBackground = JSON.stringify(scene.outputBackground ?? null)
  useEffect(() => {
    const background = JSON.parse(savedBackground) as SceneOutputBackground | null
    setMode(background?.mode ?? 'default')
    setColor(background?.mode === 'solid' ? background.color : '#F4F0E5')
    setError(null)
  }, [scene.sceneId, savedBackground])
  const dirty = mode !== (scene.outputBackground?.mode ?? 'default')
    || mode === 'solid' && (scene.outputBackground?.mode !== 'solid' || color !== scene.outputBackground.color)
  useEffect(() => { draftChange.current?.(dirty) }, [dirty])
  useEffect(() => () => draftChange.current?.(false), [])
  return <section className="workspace-control-section" aria-label="输出背景">
    <h3>输出背景</h3>
    <p>预览与 PNG 共同使用此背景。真实地表不会被清除；透明背景中的秘密遮罩仍保持不透明。</p>
    <fieldset disabled={disabled}>
      <label>背景方式<select aria-label="输出背景方式" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setError(null) }}>
        <option value="default">默认背景</option><option value="solid">纯色背景</option><option value="transparent">透明背景</option>
      </select></label>
      {mode === 'solid' && <label>背景颜色<input aria-label="输出背景颜色" type="text" maxLength={7} spellCheck={false} value={color} onChange={event => { setColor(event.target.value); setError(null) }}/></label>}
      <p className="asset-muted">{mode === 'transparent' ? '只有未绘制内容的区域透明；草地、水面、格线和其他真实内容仍会绘制。' : mode === 'solid' ? '输入六位 RGB 颜色，例如 #F4F0E5。' : '使用场景原有的正常底色。'}</p>
      {error && <p role="alert" className="asset-form-error">{error}</p>}
      <button type="button" className="primary asset-wide" disabled={!dirty} onClick={() => {
        const input = mode === 'default' ? null : mode === 'solid' ? { mode, color } : { mode }
        const parsed = input === null ? null : sceneOutputBackgroundSchema.safeParse(input)
        if (parsed && !parsed.success) { setError(parsed.error.issues[0]?.message ?? '请选择有效的背景。'); return }
        setError(null)
        onPreview([{ type: 'setSceneBackground', background: parsed?.success ? parsed.data : null }], '修改输出背景')
      }}>预览输出背景</button>
    </fieldset>
  </section>
}
