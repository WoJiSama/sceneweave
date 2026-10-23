import { useState } from 'react'
import { Route } from 'lucide-react'
import type { SceneDocumentV3 } from '../../core/v3/types'
import { checkOutpostRoutesV3, OUTPOST_PRESET_ID, type OutpostRouteCheck } from './outpost-constraints'

export default function OutpostTravelPanel({ scene, disabled }: { scene: SceneDocumentV3; disabled: boolean }) {
  const [result, setResult] = useState<{ sceneId: string; revision: number; checks: OutpostRouteCheck[] } | null>(null)
  const supported = scene.presetSnapshot.presetId === OUTPOST_PRESET_ID && scene.presetSnapshot.presetVersion === 1
  const current = result?.sceneId === scene.sceneId && result.revision === scene.revision ? result.checks : null
  const passed = !!current?.length && current.every(check => check.ok)
  return <section className="asset-travel-panel" aria-label="哨所局部通行">
    <h3><Route size={14}/> 哨所局部通行</h3>
    <p className="asset-muted">逐段检查两处门口、道路和台阶净宽，采用当前门状态与真实占地。仅覆盖列出的走廊。</p>
    {!supported && <p className="asset-travel-blocked">此哨所版本尚无适用的局部通行检查。</p>}
    <button className="secondary asset-wide" disabled={disabled || !supported} onClick={() => setResult({ sceneId: scene.sceneId, revision: scene.revision, checks: checkOutpostRoutesV3(scene) })}>检查哨所局部路线</button>
    {supported && current && <div role="status"><p className={passed ? 'asset-travel-ok' : 'asset-travel-blocked'}>{passed ? '列出的局部走廊均可通行。' : current.length ? '部分局部走廊受阻，请检查下列结果。' : '没有可检查的局部走廊，无法确认通行。'}</p>{current.map(check => <p key={check.id} className={check.ok ? 'asset-travel-ok' : 'asset-travel-blocked'}><strong>{check.label} · {check.widthMm} mm · {check.ok ? '可通行' : '受阻'}</strong>{check.issues.length > 0 && <small>{check.issues.map(issue => issue.message).join('；')}</small>}</p>)}</div>}
  </section>
}
