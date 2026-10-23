import { create } from 'zustand'
import type { EntityKind, Operation, SceneDocument } from '../core/types'
import { cloneScene, newId } from '../core/types'
import { createBenchmarkScene, createHouse } from '../core/seed'
import { SceneHistory } from '../core/commands'
import { validateScene } from '../core/schema'
import { SaveCoordinator, SceneRepository } from '../io/storage'
import type { SaveState } from '../io/storage'
import { recordCommit } from './metrics'

export interface Selection { kind: EntityKind; id: string }
type EditorState = {
  document: SceneDocument | null
  history: SceneHistory | null
  selection: Selection | null
  audience: 'gm' | 'player'
  tool: 'select' | 'pan'
  grid: boolean
  save: SaveState
  ready: boolean
  message: { text: string; kind: 'info' | 'error' } | null
  execute: (operations: Operation[], label: string) => boolean
  undo: () => void
  redo: () => void
  select: (selection: Selection | null) => void
  setAudience: (audience: 'gm' | 'player') => void
  setTool: (tool: 'select' | 'pan') => void
  toggleGrid: () => void
  notify: (text: string, kind?: 'info' | 'error') => void
  clearMessage: () => void
}

let repository: SceneRepository | null = null
let saver: SaveCoordinator | null = null
let bootPromise: Promise<void> | null = null
const getRepository = () => repository ??= new SceneRepository()

export const useEditorStore = create<EditorState>((set, get) => ({
  document: null, history: null, selection: null, audience: 'gm', tool: 'select', grid: true,
  save: { status: 'unsaved', persistedRevision: null }, ready: false, message: null,
  execute: (operations, label) => {
    const { history, document } = get()
    if (!history || !document) return false
    const result = history.execute({ batchId: newId(), sceneId: document.sceneId, baseRevision: document.revision,
      source: 'manual', scope: { entityIds: null }, operations, label })
    if (!result.ok) { get().notify(result.errors.map(e=>e.message).join('；'), 'error'); return false }
    recordCommit(result.elapsedMs)
    set({ document: result.document })
    saver?.enqueue(result.document)
    return true
  },
  undo: () => {
    const history = get().history
    if (!history?.canUndo) return
    const result = history.undo()
    if (!result.ok) { get().notify(result.errors.map(e=>e.message).join('；'), 'error'); return }
    set({ document: result.document }); saver?.enqueue(result.document)
  },
  redo: () => {
    const history = get().history
    if (!history?.canRedo) return
    const result = history.redo()
    if (!result.ok) { get().notify(result.errors.map(e=>e.message).join('；'), 'error'); return }
    set({ document: result.document }); saver?.enqueue(result.document)
  },
  select: selection => set({ selection }),
  setAudience: audience => set({ audience, selection: null, tool: 'select' }),
  setTool: tool => set({ tool }),
  toggleGrid: () => set(state=>({ grid: !state.grid })),
  notify: (text, kind = 'info') => set({ message: { text, kind } }),
  clearMessage: () => set({ message: null }),
}))

function attachDocument(document: SceneDocument, expected: number | null) {
  saver?.stop()
  const history = new SceneHistory(document)
  useEditorStore.setState({ document: history.document, history, ready: true,
    selection: document.props['p-b2'] ? { kind: 'prop', id: 'p-b2' } : null,
    audience: 'gm', tool: 'select', grid: document.units.gridVisible,
    save: { status: expected === document.revision ? 'saved' : 'unsaved', persistedRevision: expected },
  })
  const sceneId = document.sceneId
  saver = new SaveCoordinator(getRepository(), history.document, expected, state => {
    if (useEditorStore.getState().document?.sceneId === sceneId) useEditorStore.setState({ save: state })
  })
}

export function bootEditor() {
  return bootPromise ??= (async () => {
    try {
      const saved = await getRepository().latest()
      if (saved) {
        const result = validateScene(saved)
        if (!result.ok) throw new Error('本地工程未通过校验，已保留原存档。请使用工程备份恢复。')
        attachDocument(result.document, result.document.revision)
      } else attachDocument(createHouse(), null)
    } catch (error) {
      // Keep a usable in-memory document without overwriting any existing snapshot.
      const scene = createHouse()
      const history = new SceneHistory(scene)
      useEditorStore.setState({ document: history.document, history, ready: true,
        save: { status: 'error', persistedRevision: null, error: error instanceof Error ? error.message : '无法读取本地存储' },
        message: { kind: 'error', text: '本地存储不可用。可以继续编辑并下载主持人工程备份。' } })
    }
  })()
}

export async function flushSave() {
  await saver?.flush()
  const state = useEditorStore.getState().save
  if (state.status === 'error' || state.status === 'conflict') throw new Error(state.error || '当前分支尚未保存，请先下载备份或另存副本。')
}

/** Explicit departure from the historical M0 editor; persistence must succeed first. */
export async function closeEditorSession() {
  await bootPromise
  await flushSave()
  saver?.stop(); saver = null; bootPromise = null
  useEditorStore.setState({ document: null, history: null, selection: null, ready: false })
}

/** Persist the isolated candidate before changing the open editor. */
export async function openNewDocument(document: SceneDocument) {
  const before = useEditorStore.getState().document
  const checked = validateScene(document)
  if (!checked.ok) throw new Error(checked.errors.map(e=>e.message).join('；'))
  await flushSave()
  await getRepository().save(checked.document, null)
  if (!isStillOpen(before)) throw new Error('新场景已保存，但切换期间当前场景又有修改。已保留当前编辑，请完成修改后重新打开。')
  attachDocument(checked.document, checked.document.revision)
}

export async function newHouse() { await openNewDocument(createHouse()) }

function isStillOpen(before: SceneDocument | null) {
  const now = useEditorStore.getState().document
  return before?.sceneId === now?.sceneId && before?.revision === now?.revision
}

export async function saveAsCopy(snapshot?: SceneDocument) {
  const before = useEditorStore.getState().document
  const source = snapshot ?? before
  if (!source) return
  // Restoring an older snapshot must not abandon a current unsaved branch.
  if (snapshot) await flushSave()
  const copy = cloneScene(source)
  copy.sceneId = newId(); copy.revision = 0
  copy.title = `${source.title} · 副本`
  copy.createdAt = copy.updatedAt = new Date().toISOString()
  await getRepository().save(copy, null)
  if (!isStillOpen(before)) throw new Error('副本已保存；保存期间当前场景又有修改，因此继续保留当前编辑。')
  attachDocument(copy, copy.revision)
  useEditorStore.getState().notify('已另存副本，原场景和此标签的修改都已保留。')
}

export async function reloadPersisted() {
  const before = useEditorStore.getState().document
  const sceneId = before?.sceneId
  if (!sceneId) return
  const saved = await getRepository().load(sceneId)
  if (!saved) throw new Error('未找到可重载的本地工程。请先下载当前内容。')
  const result = validateScene(saved)
  if (!result.ok) throw new Error('本地工程校验失败；保留当前编辑内容。')
  if (!isStillOpen(before)) throw new Error('载入期间当前场景又有修改，已保留当前编辑。请重新选择载入。')
  attachDocument(saved, saved.revision)
}

export function retrySave() {
  if (saver) saver.retry()
  else {
    const document = useEditorStore.getState().document
    if (document) attachDocument(document, null)
  }
}

export async function listSnapshots() {
  const id = useEditorStore.getState().document?.sceneId
  return id ? getRepository().listSnapshots(id) : []
}

/** Explicit laboratory action: save the current scene first, then open a new workload. */
export async function openBenchmark(count: 500 | 2000) { await openNewDocument(createBenchmarkScene(count)) }

export const propNames = { table: '木桌', chair: '木椅', shelf: '书架', rug: '地毯', crate: '木箱' }
export function entityLabel(document: SceneDocument, selection: Selection): string {
  const { kind, id } = selection
  if (kind === 'room') return Object.values(document.notes).find(n=>n.anchor.type === 'entity' && n.anchor.entityId === id && n.kind === 'label')?.text ?? '房间'
  if (kind === 'prop') return propNames[document.props[id]?.symbol] ?? '物件'
  if (kind === 'opening') { const o = document.openings[id]; return o?.secret ? '书架后的暗门' : o?.kind === 'window' ? '窗户' : id === 'o-a1' ? '宅邸入口' : '房间门' }
  if (kind === 'wall') return id === 'w-6a' ? '会客厅 / 书房共用墙' : '墙体'
  if (kind === 'note') return document.notes[id]?.title ?? (document.notes[id]?.kind === 'label' ? '地点标签' : '注记')
  return kind === 'region' ? '未知区域遮罩' : '顶点'
}
