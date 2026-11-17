import { useEffect, useState } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import { toBundle } from '../../application/workspace/project'
import { renderEditorProject } from '../../platform/browser/render/renderer'

/** Generic multi-Floor overview. Ships and buildings use the same editor. */
export default function FloorOverview({ project, floorId, disabled, onNavigate }: {
  project: EditableProject; floorId: string; disabled: boolean; onNavigate: (id: string) => void
}) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0)
  const [images, setImages] = useState<Record<string, string>>({}), [error, setError] = useState('')
  const floors = Object.values(project.document.floors), rows = floors.slice(page * 12, (page + 1) * 12)
  useEffect(() => setPage(0), [project.document.sceneId, floors.length])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController(); setImages({}); setError('')
    void (async () => {
      for (const floor of Object.values(project.document.floors).slice(page * 12, (page + 1) * 12)) {
        let canvas: HTMLCanvasElement | undefined
        try {
          canvas = await renderEditorProject(toBundle(project), { audience: 'gm', floorId: floor.id, longEdgePx: 512, signal: controller.signal })
          controller.signal.throwIfAborted()
          const url = canvas.toDataURL('image/png'); setImages(current => ({ ...current, [floor.id]: url }))
        } catch (failure) { if (controller.signal.aborted) return; setError(String(failure)); return }
        finally { if (canvas) canvas.width = canvas.height = 0 }
      }
    })()
    return () => controller.abort()
  }, [open, page, project])
  if (floors.length < 2) return null
  return <details className="workspace-advanced" aria-label="楼层地图总览" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>展开楼层地图 · {floors.length} 层</summary>
    {open && <><p className="asset-muted">各层显示完整地图，点击缩略图进入该层编辑。</p>
      <div className="scene-template-gallery">{rows.map(floor => <button type="button" className="secondary scene-template-card" key={floor.id} disabled={disabled} aria-pressed={floor.id === floorId} onClick={() => onNavigate(floor.id)} aria-label={`进入楼层 ${floor.name}`}>
        {images[floor.id] ? <img src={images[floor.id]} alt={`${floor.name}实际楼层地图`}/> : <span>准备楼层预览…</span>}<strong>{floor.name}</strong>
      </button>)}</div>
      {floors.length > 12 && <div><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一组楼层</button><button type="button" disabled={(page + 1) * 12 >= floors.length} onClick={() => setPage(value => value + 1)}>下一组楼层</button></div>}
      {error && <p className="asset-error" role="alert">楼层预览未完成：{error}</p>}</>}
  </details>
}
