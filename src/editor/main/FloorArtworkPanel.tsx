import { useState } from 'react'
import type { FloorArtworkImportRequest } from '../../application/workspace/prepare'
import type { SceneDocument } from '../../shared/model/scene'

export default function FloorArtworkPanel({ scene, floorId, disabled, onDraftChange, onImport, onClear }: {
  scene: SceneDocument
  floorId: string
  disabled: boolean
  onDraftChange: (dirty: boolean) => void
  onImport: (request: FloorArtworkImportRequest) => void
  onClear: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [attribution, setAttribution] = useState('')
  const [licenseText, setLicenseText] = useState('')
  const [canEmbed, setCanEmbed] = useState(false)
  const artwork = scene.floors[floorId]?.artwork
  const current = artwork && scene.assets[artwork.assetId]
  return <details className="workspace-advanced" aria-label="楼层底图"><summary>楼层底图</summary>
    {current && <p className="asset-muted">{current.origin.attribution} · {current.pixelWidth} × {current.pixelHeight} px</p>}
    <form onSubmit={event => { event.preventDefault(); if (file && canEmbed) onImport({ file, attribution, licenseText, canEmbed }) }}>
      <fieldset disabled={disabled}>
        <p className="asset-muted">图片保留宽高比，居中放入本楼层的出图范围，并绘制在本层对象下方。</p>
        <label>底图文件<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
          const selected = event.target.files?.[0] ?? null
          setFile(selected)
          onDraftChange(!!selected)
        }}/></label>
        {file && <>
          <label>底图署名与来源<input value={attribution} required maxLength={500} onChange={event => { setAttribution(event.target.value); onDraftChange(true) }}/></label>
          <label>底图许可<textarea value={licenseText} required onChange={event => { setLicenseText(event.target.value); onDraftChange(true) }}/></label>
          <label className="asset-check"><input type="checkbox" checked={canEmbed} onChange={event => { setCanEmbed(event.target.checked); onDraftChange(true) }}/>允许将底图嵌入工程和出图</label>
          <button className="primary" type="submit" disabled={!canEmbed || !attribution.trim() || !licenseText.trim()}>预览更换底图</button>
        </>}
        {current && <button className="secondary" type="button" onClick={onClear}>预览清除底图</button>}
      </fieldset>
    </form>
  </details>
}
