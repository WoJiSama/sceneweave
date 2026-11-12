import type { ProjectData } from '../../../shared/model/project.js'
import { decodeProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import { checkCancelled, type CancellationSignal } from '../../../shared/ports/resources.js'
import { checkedContentBlock, createProjectMaterializer, isProjectBlockManifest, type ProjectBlockManifest, type ProjectContentBlock } from './content-blocks.js'
import { auditHistoryRecords, type HistoryHead, type HistoryVersion, type HistoryPin } from './history-records.js'

export interface ExpandedHistoryAudit {
  owner: string; head: HistoryHead | null; versions: HistoryVersion[]; pins: HistoryPin[]
}
export type CapturedHistoryVersion = Omit<HistoryVersion, 'checkpoint'> & { checkpoint: ProjectData | ProjectBlockManifest | null }
export interface CapturedHistoryAudit {
  kind: 'captured-history'
  heads: HistoryHead[]
  versions: CapturedHistoryVersion[]
  pins: HistoryPin[]
  blocks: ProjectContentBlock[]
}
export type HistoryAuditMessage = ExpandedHistoryAudit | CapturedHistoryAudit

/** Both the real Worker and the no-Worker fallback run this exact algorithm.
 * The message owns ordinary structured clones; original capture bytes remain
 * on the page for exact confirmation in the eventual database transaction. */
export async function auditHistoryMessage(message: HistoryAuditMessage, signal?: CancellationSignal,
  yieldPage: () => Promise<void> = async () => {}): Promise<{ documentBytes: number }> {
  checkCancelled(signal)
  if (!('kind' in message)) return auditHistoryRecords(message.owner, message.head, message.versions, message.pins)
  if (message.kind !== 'captured-history') throw new Error('完整历史后台请求无效。')
  const blocks = new Map<string, ProjectContentBlock>()
  for (const raw of message.blocks) {
    checkCancelled(signal)
    const block = checkedContentBlock(raw)
    if (blocks.has(block.sha256)) throw new Error('完整历史内容块重复。')
    blocks.set(block.sha256, block); await yieldPage()
  }
  const materializer = createProjectMaterializer(async hash => blocks.get(hash))
  try {
    const owners = new Set(message.heads.map(head => head.ownerSceneId))
    if (owners.size !== message.heads.length) throw new Error('增量历史所属活动分支重复。')
    if (message.versions.some(row => !owners.has(row.ownerSceneId))) throw new Error('增量历史缺少所属活动分支。')
    if (message.pins.some(row => !owners.has(row.ownerSceneId))) throw new Error('增量历史快照缺少所属分支。')
    let documentBytes = 0
    for (const head of message.heads) {
      const versions: HistoryVersion[] = []
      for (const row of message.versions) if (row.ownerSceneId === head.ownerSceneId) {
        checkCancelled(signal)
        let checkpoint = row.checkpoint
        if (isProjectBlockManifest(checkpoint)) checkpoint = await materializer.materialize(checkpoint)
        if (checkpoint?.document.aggregateCoordinates?.encoding === 'local') checkpoint = decodeProjectCoordinates(checkpoint)
        versions.push({ ...row, checkpoint }); await yieldPage()
      }
      checkCancelled(signal)
      documentBytes += auditHistoryRecords(head.ownerSceneId, head, versions, message.pins.filter(pin => pin.ownerSceneId === head.ownerSceneId)).documentBytes
      await yieldPage()
    }
    checkCancelled(signal)
    return { documentBytes }
  } finally { materializer.close(); blocks.clear() }
}
