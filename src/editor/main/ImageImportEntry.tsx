import { Suspense, useState, type ComponentProps } from 'react'
import { lazyView } from '../main-shell/lazy-view'

const ImageImportTool = lazyView(() => import('./ImageImportTool'),
  () => <p role="alert">图片导入工作台加载失败。</p>)

export default function ImageImportEntry(props: ComponentProps<typeof ImageImportTool>) {
  const [requestedHere, setRequestedHere] = useState(false)
  const requestKey = (props.requestKey ?? 0) + Number(requestedHere)
  if (!requestKey) {
    return <button className="secondary asset-wide" disabled={props.disabled} onClick={() => setRequestedHere(true)}>从图片新建场景</button>
  }
  return <Suspense fallback={<p role="status">正在打开图片导入工作台…</p>}>
    <ImageImportTool {...props} requestKey={requestKey}/>
  </Suspense>
}
