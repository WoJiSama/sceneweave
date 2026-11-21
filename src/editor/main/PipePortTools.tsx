import { useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { Prop } from '../../shared/model/scene'
import { PIPE_PORTS, pipePortLabels, type PipePort } from '../../shared/path-assembly/pipe-geometry'
import { copyPipePorts, readPipePortsClipboard } from '../../platform/browser/storage/component-clipboard'

export default function PipePortTools({ prop, disabled, onMark, onPreview }: {
  prop: Prop
  disabled: boolean
  onMark: (id: string, port: PipePort) => void
  onPreview: (commands: SceneCommand[], description: string) => void
}) {
  const [status, setStatus] = useState<{ text: string; error?: boolean }>()
  const runClipboard = (action: () => void) => {
    try { setStatus(undefined); action() }
    catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), error: true }) }
  }
  return <details className="asset-details">
    <summary>设备管口</summary>
    <fieldset disabled={disabled}>
      {PIPE_PORTS.map(port => {
        const label = pipePortLabels[port], marked = !!prop.pipePorts?.[port]
        return <div className="outdoor-object-list" key={port}>
          <button type="button" className="secondary" onClick={() => onMark(prop.id, port)}>{marked ? '重新标记' : '在画布标记'}{label}</button>
          {marked && <button type="button" className="secondary" onClick={() => {
            const ports = { ...prop.pipePorts }
            delete ports[port]
            onPreview([{ type: 'setPropPipePorts', id: prop.id, ports }], `移除${label}并核对相接管线`)
          }}>预览移除{label}</button>}
        </div>
      })}
      {prop.pipePorts && <button type="button" className="secondary asset-wide" onClick={() => runClipboard(() => {
        copyPipePorts(prop)
        setStatus({ text: '已复制设备管口，可在其他项目的物件上粘贴。' })
      })}>复制设备管口</button>}
      <button type="button" className="secondary asset-wide" onClick={() => runClipboard(() => {
        onPreview([{ type: 'setPropPipePorts', id: prop.id, ports: readPipePortsClipboard() }], '粘贴设备管口并核对相接管线')
      })}>预览粘贴设备管口</button>
      {status && <p role={status.error ? 'alert' : 'status'} className={status.error ? 'asset-form-error' : 'asset-muted'}>{status.text}</p>}
    </fieldset>
  </details>
}
