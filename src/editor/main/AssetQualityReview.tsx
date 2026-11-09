import { useEffect, useState } from 'react'
import type { AssetQualityAssessment } from '../../shared/assets/quality-review'
import type { ResourceBytePort } from '../../shared/model/project'
import { sha256Bytes } from '../../shared/validation/hash'
import './asset-quality.css'

export default function AssetQualityReview({ assessments, acknowledgedKeys, onAcknowledgedKeysChange, resources, disabled = false }: {
  assessments: readonly AssetQualityAssessment[]; acknowledgedKeys: readonly string[]
  onAcknowledgedKeysChange: (keys: string[]) => void; resources?: ResourceBytePort; disabled?: boolean
}) {
  const [images, setImages] = useState<Record<string, string>>({}), [error, setError] = useState('')
  useEffect(() => {
    let active = true; const urls: string[] = []
    setImages({}); setError('')
    if (resources) void (async () => {
      const next: Record<string, string> = {}
      for (const item of assessments.filter(item => item.report.status !== 'pass')) {
        const bytes = await resources.read(item.sha256)
        if (!active) return
        if (sha256Bytes(bytes) !== item.sha256) throw new Error('初筛预览图片摘要不一致，请重新准备候选。')
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/png' })); urls.push(url); next[item.key] = url
      }
      if (active) setImages(next)
    })().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [assessments, resources])
  if (!assessments.length) return null
  const pending = assessments.filter(item => item.report.status !== 'pass')
  return <section className="asset-quality-review" aria-label="素材质量初筛">
    <strong>素材质量初筛 · {assessments.length} 项</strong>
    <p>{pending.length ? `${pending.length} 项需要处理。请核对下列原因，修改后重新预览，或逐项确认保留。` : '未发现本轮规则覆盖的明显像素问题。'}初筛不代表美术、场景或用户签收通过。</p>
    {pending.map(item => <article key={item.key} aria-label={`初筛素材 ${item.name}`}>
      <strong>{item.name}</strong>
      {images[item.key] && <img src={images[item.key]} alt={`${item.name}初筛图片`} onError={() => setError('初筛图片未能显示，请取消并重新准备候选。')}/>}
      <ul>{item.report.issues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>
      {item.report.status === 'review' && <label><input type="checkbox" aria-label={`复核并保留素材 ${item.name}`} disabled={disabled || !!error || !!resources && !images[item.key]} checked={acknowledgedKeys.includes(item.key)}
        onChange={event => onAcknowledgedKeysChange(event.target.checked ? [...new Set([...acknowledgedKeys, item.key])] : acknowledgedKeys.filter(key => key !== item.key))}/>
        我已查看此素材，确认在当前尺寸和用途下保留</label>}
      {item.report.status === 'blocked' && <p role="alert">此素材不能采用；请更换有效图片。</p>}
    </article>)}
    {error && <p role="alert">{error}</p>}
  </section>
}
