import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import NewSceneForm, { type NewSceneOptions } from '../main/NewSceneForm'
import { downloadBlankScene } from '../../platform/browser/content/blank-scene-download'
import './startup-scene-dialog.css'

type Stage = 'preparing' | 'saving' | null
type Props = {
  onReady: () => void
  onCreate: (options: NewSceneOptions, signal: AbortSignal, onSaving: () => void, preloadedArchive?: Promise<Uint8Array>) => Promise<void>
  onCancel: () => void
}

export default function StartupSceneDialog({ onReady, onCreate, onCancel }: Props) {
  const title = useId(), dialog = useRef<HTMLDialogElement>(null)
  const operation = useRef<AbortController | null>(null)
  const archive = useRef<{ abort: AbortController; bytes: Promise<Uint8Array> } | null>(null)
  const saving = useRef(false)
  const [stage, setStage] = useState<Stage>(null)
  const [error, setError] = useState<string | null>(null)

  useLayoutEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    return () => {
      if (element.open) element.close()
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const abort = import.meta.env.PROD ? new AbortController() : undefined
    if (abort) {
      const bytes = downloadBlankScene(abort.signal)
      archive.current = { abort, bytes }
      void bytes.catch(() => { if (archive.current?.bytes === bytes) archive.current = null })
    }
    onReady()
    return () => { abort?.abort(); archive.current = null }
  }, [onReady])
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => { window.removeEventListener('beforeunload', protect); operation.current?.abort() }
  }, [])

  const cancel = () => {
    if (saving.current) return
    operation.current?.abort()
    onCancel()
  }
  const create = async (options: NewSceneOptions) => {
    if (operation.current) return
    const abort = new AbortController()
    operation.current = abort
    setStage('preparing')
    setError(null)
    const preloaded = archive.current
    try {
      await onCreate(options, abort.signal, () => { saving.current = true; setStage('saving') }, preloaded?.bytes)
    } catch (failure) {
      if (!abort.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure))
        abort.abort()
      }
    } finally {
      preloaded?.abort.abort()
      if (archive.current === preloaded) archive.current = null
      operation.current = null
      saving.current = false
      if (dialog.current?.open) setStage(null)
    }
  }

  return <dialog ref={dialog} className="modal startup-scene-dialog" aria-labelledby={title}
    onKeyDown={event => { if (event.key === 'Escape' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }}
    onCancel={event => { event.preventDefault(); cancel() }}>
    <div className="modal-heading"><h2 id={title}>新建空白场景</h2><button className="icon-button" type="button" aria-label="取消新建场景" disabled={stage === 'saving'} onClick={cancel}><X size={18}/></button></div>
    <NewSceneForm busy={stage !== null} cancellable={stage === 'preparing'} failure={error} onCreate={options => void create(options)} onCancel={cancel}/>
  </dialog>
}
