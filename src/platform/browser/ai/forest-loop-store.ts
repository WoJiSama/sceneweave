import Dexie, { liveQuery, type Table } from 'dexie'
import { z } from 'zod'
import { FOREST_WORKFLOW_ID } from '../../../shared/ai/forest-loop.js'
import { WorkflowBindingSchema, workflowBinding } from '../../../shared/ai/workflows/catalog.js'
import { BudgetUsageSchema } from '../../../shared/budget/task-budget.js'
import { mixedGenerationInputSchema } from '../../../shared/generation/domains/mixed/contracts.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { normalizeAiBaseUrl } from './client.js'
import { ForestLoopCheckpointSchema, type ForestLoopCheckpoint } from './forest-loop.js'

const slot = 'active'
const defaultName = 'sceneweave-forest-loop-v1'
const binary = z.custom<Uint8Array>(value => value instanceof Uint8Array).refine(value => value.length > 0 && value.length <= PACKAGE_LIMITS.compressedBytes)
const recordSchema = z.object({ id: z.string(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  workflow: WorkflowBindingSchema.refine(binding => binding.id === FOREST_WORKFLOW_ID),
  endpoint: z.string().refine(value => { try { return normalizeAiBaseUrl(value) === value } catch { return false } }),
  checkpoint: ForestLoopCheckpointSchema,
}).strict()
export type StoredForestLoop = z.infer<typeof recordSchema>
const fileSchema = z.object({ archive: binary, usage: BudgetUsageSchema,
  replay: z.object({ baseArchive: binary, input: mixedGenerationInputSchema, profileHash: WorkflowBindingSchema.shape.definitionHash, preparedAt: z.iso.datetime(),
    identityAllocation: z.array(z.string().min(1).max(256)).max(100000) }).strict().optional(),
}).strict()
export type ForestCandidateFile = z.infer<typeof fileSchema>

class ForestDatabase extends Dexie {
  loops!: Table<StoredForestLoop, string>
  files!: Table<{ id: string; file: ForestCandidateFile }, string>
  constructor(name: string) {
    super(name)
    this.version(1).stores({ loops: 'id', files: 'id' }).upgrade(() => { throw new Error('林中建筑断点数据库版本不兼容。') })
  }
}

const conflict = () => new Error('林中建筑断点已在另一窗口变化，请重新打开当前断点。')
const fileKey = (runId: string, candidateId: string) => `${runId}:${candidateId}`

/** Workflow definitions remain in Git. This repository stores browser execution
 * progress and ZIP bytes; it never opens the editor's project database. */
export class ForestLoopStore {
  private readonly db: ForestDatabase
  constructor(name = defaultName) { this.db = new ForestDatabase(name) }
  async active(): Promise<StoredForestLoop | null> {
    const record = await this.db.loops.get(slot)
    return record ? recordSchema.parse(record) : null
  }
  observe(next: (record: StoredForestLoop | null) => void, error: (error: unknown) => void) {
    return liveQuery(() => this.active()).subscribe({ next, error })
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (!navigator.locks) return action()
    return navigator.locks.request(this.db.name, { ifAvailable: true }, lock => {
      if (!lock) throw new Error('另一窗口正在处理林中建筑，请在该窗口继续或稍后重试。')
      return action()
    })
  }
  async start(checkpoint: ForestLoopCheckpoint, endpoint: string, signal: AbortSignal): Promise<StoredForestLoop> {
    const row = recordSchema.parse({ id: slot, revision: 0, workflow: workflowBinding(FOREST_WORKFLOW_ID), endpoint, checkpoint })
    signal.throwIfAborted()
    await this.db.transaction('rw', this.db.loops, async () => {
      if (await this.db.loops.get(slot)) throw conflict()
      signal.throwIfAborted()
      await this.db.loops.add(row)
      signal.throwIfAborted()
    })
    return row
  }
  async commit(current: StoredForestLoop, checkpoint: ForestLoopCheckpoint, file: ForestCandidateFile | undefined, signal: AbortSignal): Promise<StoredForestLoop> {
    const next = recordSchema.parse({ ...current, revision: current.revision + 1, checkpoint })
    const runId = checkpoint.state.runId, receipt = checkpoint.state.receipts.at(-1)
    const additions = checkpoint.state.receipts.length - current.checkpoint.state.receipts.length
    if (runId !== current.checkpoint.state.runId || additions !== (file ? 1 : 0) || file && (!receipt || !!file.replay === !!receipt.parentCandidateId)) throw conflict()
    const checkedFile = file && fileSchema.parse(file)
    signal.throwIfAborted()
    await this.db.transaction('rw', this.db.loops, this.db.files, async () => {
      const latest = await this.db.loops.get(slot)
      if (latest?.checkpoint.state.runId !== runId || latest.revision !== current.revision) throw conflict()
      signal.throwIfAborted()
      if (receipt && checkedFile) await this.db.files.add({ id: fileKey(runId, receipt.candidateId), file: checkedFile })
      await this.db.loops.put(next)
      signal.throwIfAborted()
    })
    return next
  }
  async candidate(runId: string, id: string): Promise<ForestCandidateFile> {
    const key = fileKey(runId, id), row = await this.db.files.get(key)
    if (!row || row.id !== key) throw new Error('本机断点缺少候选完整工程。')
    return fileSchema.parse(row.file)
  }
  async archive(runId: string, revision: number): Promise<void> {
    await this.db.transaction('rw', this.db.loops, async () => {
      const row = await this.db.loops.get(slot)
      if (row?.checkpoint.state.runId !== runId || row.revision !== revision) throw conflict()
      await this.db.loops.add({ ...row, id: runId })
      await this.db.loops.delete(slot)
    })
  }
  close() { this.db.close() }
}
export const forestLoopStore = new ForestLoopStore()
