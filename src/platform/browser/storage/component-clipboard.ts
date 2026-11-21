import { z } from 'zod'
import { createPublicVisibility } from '../../../shared/geometry/visibility.js'
import type { Prop, SceneDocument } from '../../../shared/model/scene.js'
import { pipePortsSchema, sightOccluderSchema } from '../../../shared/validation/primitives.js'

const clipboardKey = 'sceneweave.componentClipboard'
const clipboardEnvelope = { format: z.literal('sceneweave-component'), version: z.literal(1) }
const sightClipboardSchema = z.object({ ...clipboardEnvelope,
  kind: z.literal('sightOccluder'), component: sightOccluderSchema.omit({ id: true }) }).strict()
const pipePortsClipboardSchema = z.object({ ...clipboardEnvelope, kind: z.literal('pipePorts'), component: pipePortsSchema }).strict()

function readComponent() {
  const value = localStorage.getItem(clipboardKey)
  return value && value.length <= 4096 ? JSON.parse(value) : null
}

export function copySightOccluder(scene: SceneDocument, prop: Prop) {
  if (!prop.sightOccluder) throw new Error('此物件没有遮挡组件可复制。')
  const { pointsLocalMm, visibility } = prop.sightOccluder
  const data = sightClipboardSchema.parse({ format: 'sceneweave-component', version: 1, kind: 'sightOccluder',
    component: { pointsLocalMm, visibility: createPublicVisibility(scene).prop(prop) ? visibility : 'gm' } })
  localStorage.setItem(clipboardKey, JSON.stringify(data))
}

export function readSightOccluderClipboard() {
  const parsed = sightClipboardSchema.safeParse(readComponent())
  if (!parsed.success) throw new Error('请先复制一个视线遮挡组件。')
  return { ...parsed.data.component, id: `sight-${crypto.randomUUID()}` }
}

export function copyPipePorts(prop: Prop) {
  if (!prop.pipePorts || !Object.keys(prop.pipePorts).length) throw new Error('请先标记设备管口。')
  const data = pipePortsClipboardSchema.parse({ format: 'sceneweave-component', version: 1, kind: 'pipePorts', component: prop.pipePorts })
  localStorage.setItem(clipboardKey, JSON.stringify(data))
}

export function readPipePortsClipboard() {
  const parsed = pipePortsClipboardSchema.safeParse(readComponent())
  if (!parsed.success || !Object.keys(parsed.data.component).length) throw new Error('请先复制设备管口。')
  return parsed.data.component
}
