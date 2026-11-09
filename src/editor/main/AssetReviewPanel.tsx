import { useEffect, useRef, useState } from 'react'
import type { CatalogItem } from '../../shared/library/types'
import type { ThemePackRegistration } from '../../shared/assets/theme-packs'
import { ASSET_REVIEW_DIMENSIONS, assessThemePackPublication, createThemePackReviewContent,
  type AssetReviewContent, type AssetReviewDeclaration, type ControlledAssetReview,
  type ControlledThemePackReview, type ThemePackReviewDeclaration } from '../../shared/assets/review'
import { AssetReviewRepository } from '../../platform/browser/assets/review-repository'

type CheckStatus = AssetReviewDeclaration['checks']['rights']['status']
const dimensionNames = { rights: '许可与来源', technical: '技术与标定', art: '美术与风格', scene: '场景覆盖与可编辑性' }
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error)
const download = (name: string, value: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Administrative records are explicitly written here, never imported from package declarations. */
export default function AssetReviewPanel({ registration, content, items, selectedKeys, disabled = false, onPendingChange }: {
  registration?: ThemePackRegistration; content: readonly AssetReviewContent[]; items: readonly CatalogItem[]; selectedKeys: readonly string[]; disabled?: boolean; onPendingChange?: (pending: boolean) => void
}) {
  const repository = useRef<AssetReviewRepository | null>(null), mounted = useRef(true), pendingCallback = useRef(onPendingChange)
  pendingCallback.current = onPendingChange
  const [assets, setAssets] = useState<ControlledAssetReview[]>([]), [packs, setPacks] = useState<ControlledThemePackReview[]>([])
  const [reviewer, setReviewer] = useState(''), [reference, setReference] = useState('')
  const [checks, setChecks] = useState<Record<typeof ASSET_REVIEW_DIMENSIONS[number], CheckStatus>>({ rights: 'not-checked', technical: 'not-checked', art: 'not-checked', scene: 'not-checked' })
  const [signoff, setSignoff] = useState<AssetReviewDeclaration['userSignoff']['status']>('not-requested')
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  useEffect(() => {
    mounted.current = true
    try {
      const store = new AssetReviewRepository(); repository.current = store
      void store.read().then(result => { if (mounted.current) { setAssets(result.assets); setPacks(result.packs) } })
        .catch(error => { if (mounted.current) setError(failureText(error)) })
    } catch (error) { setError(failureText(error)) }
    return () => { mounted.current = false; repository.current?.close(); repository.current = null; pendingCallback.current?.(false) }
  }, [])
  const packContent = registration ? createThemePackReviewContent(registration, content) : null
  const packRecord = packs.find(record => record.content.registrationHash === packContent?.registrationHash)
  const currentAssets = assets.filter(record => content.some(item => item.catalogKey === record.content.catalogKey))
  const assessment = registration ? assessThemePackPublication(registration, content, currentAssets, packRecord) : null
  const record = async (wholePack: boolean) => {
    if (disabled || pending || !repository.current || !wholePack && !selectedKeys.length) return
    setPending(true); pendingCallback.current?.(true); setError(''); setMessage('')
    try {
      if (!reviewer.trim() || !reference.trim()) throw new Error('请填写实际评审者与证据位置，再记录审核。')
      const reviewedAt = new Date().toISOString(), evidence = [{ label: '审核证据', reference }]
      const checked = (status: CheckStatus) => status === 'not-checked'
        ? { status, reviewer: null, reviewedAt: null, evidence: [] }
        : { status, reviewer, reviewedAt, evidence }
      const checkRecords = { rights: checked(checks.rights), technical: checked(checks.technical), art: checked(checks.art), scene: checked(checks.scene) }
      const userSignoff = signoff === 'not-requested' ? { status: signoff, reviewer: null, reviewedAt: null, evidence: [] }
        : { status: signoff, reviewer, reviewedAt, evidence }
      if (wholePack) {
        if (!registration || !packContent) throw new Error('当前入口没有完整主题包注册。')
        const declaration: ThemePackReviewDeclaration = { format: 'sceneweave-theme-pack-review', version: 1,
          recordId: crypto.randomUUID(), content: packContent, checks: checkRecords, userSignoff }
        const saved = await repository.current.putPack(declaration)
        if (mounted.current) setPacks(current => [...current.filter(row => row.content.registrationHash !== saved.content.registrationHash), saved])
      } else {
        // Each record is independent; a failure reports how many were durably written.
        let completed = 0
        try {
          for (const item of content.filter(item => selectedKeys.includes(item.catalogKey))) {
            const saved = await repository.current.putAsset({ format: 'sceneweave-asset-review', version: 1,
              recordId: crypto.randomUUID(), content: item, checks: checkRecords, userSignoff })
            completed++
            if (mounted.current) setAssets(current => [...current.filter(row => row.content.catalogKey !== saved.content.catalogKey), saved])
          }
        } catch (error) { throw new Error(`已保存${completed}项独立审核；后续未保存：${failureText(error)}`) }
      }
      if (mounted.current) setMessage(wholePack ? '整包审核已记录到本机。包的发行状态仍由正式流程决定。' : '所选项审核已记录到本机；整包覆盖与签收须另行记录。')
    } catch (error) { if (mounted.current) setError(failureText(error)) }
    finally { if (mounted.current) { setPending(false); pendingCallback.current?.(false) } }
  }
  return <details className="theme-pack-review"><summary>{registration ? '审核记录与覆盖签收' : '所选素材审核记录'}</summary>
    <p>个人使用只需合法许可与技术校验。公开默认包分别核对四项审核和用户签收；单件通过不能代替两份完整场景。记录按确切内容保存于本机，不随素材清单自动取得可信状态。</p>
    {assessment && <p role="status">{assessment.reviewReady ? '当前审核记录齐备，仍需正式资源与发布检查。' : `当前有${assessment.members.filter(item => !item.assessment.reviewReady).length}项素材待审核；${packRecord ? '整包已有记录，须核对结论与完整内容。' : '整包尚无审核与用户签收记录。'}`}</p>}
    <details><summary>逐项审核状态</summary><ul>{items.map(item => {
      const review = currentAssets.find(record => record.content.catalogKey === item.identity.key)
      return <li key={item.identity.key}>{item.name}：{review ? ASSET_REVIEW_DIMENSIONS.map(id => `${dimensionNames[id]}${review.checks[id].status === 'passed' ? '通过' : review.checks[id].status === 'changes-required' ? '需修改' : '未检查'}`).join('，') : '未检查'}</li>
    })}</ul></details>
    <fieldset disabled={disabled || pending}>
      <label>评审者／签收人<input aria-label="素材评审者" value={reviewer} onChange={event => setReviewer(event.target.value)}/></label>
      <label>证据位置<textarea aria-label="素材审核证据" placeholder="实际图像、场景工程、许可记录或签收说明的位置" value={reference} onChange={event => setReference(event.target.value)}/></label>
      {ASSET_REVIEW_DIMENSIONS.map(id => <label key={id}>{dimensionNames[id]}<select aria-label={`${dimensionNames[id]}审核`} value={checks[id]} onChange={event => setChecks(current => ({ ...current, [id]: event.target.value as CheckStatus }))}><option value="not-checked">未检查</option><option value="passed">通过</option><option value="changes-required">需要修改</option></select></label>)}
      <label>用户签收（由签收人明确选择）<select aria-label="素材用户签收" value={signoff} onChange={event => setSignoff(event.target.value as typeof signoff)}><option value="not-requested">尚未签收</option><option value="accepted">我明确签收所记录的确切内容</option><option value="changes-requested">要求修改</option></select></label>
      <button type="button" className="secondary asset-wide" disabled={!selectedKeys.length} onClick={() => void record(false)}>记录所选 {selectedKeys.length} 项审核</button>
      {registration && <button type="button" className="secondary asset-wide" onClick={() => void record(true)}>记录完整主题包审核</button>}
    </fieldset>
    <button type="button" className="secondary asset-wide" disabled={pending} onClick={() => download(`${registration?.id ?? 'project-assets'}-reviews.json`, { registration: registration ?? null, content, assets: currentAssets, pack: packRecord ?? null })}>导出当前审核记录</button>
    <small>导出的JSON是可追溯声明，不是数字签名；导入工程或素材不会把它升级为通过。此处记录不豁免资源、许可和像素校验，也不自动发布。</small>
    {error && <p role="alert" className="asset-form-error">{error}</p>}{message && <p role="status">{message}</p>}
  </details>
}
