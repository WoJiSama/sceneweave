import Dexie, { type Table } from 'dexie'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { captureJson } from '../../../shared/validation/json.js'
import { captureSceneTemplateEntries, loadSceneTemplate, SCENE_TEMPLATE_LIMITS, type SceneTemplateEntry } from '../../../shared/scene-templates/content.js'

interface State { id: 'library'; revision: number; entries: SceneTemplateEntry[] }
interface TemplateSnapshot extends State { bridgePredecessors: Record<string, string> }
class TemplateDatabase extends Dexie {
  state!: Table<State, string>
  constructor(name: string) { super(name); this.version(1).stores({ state: '&id' }) }
}
/** Independent local content store; no scene, history or existing asset database is migrated. */
export class SceneTemplateRepository {
  readonly database: TemplateDatabase
  constructor(private readonly validation: CompleteValidationOptions, name = 'sceneweave-scene-templates') { this.database = new TemplateDatabase(name) }
  close() { this.database.close() }
  private async checked(raw: State | undefined): Promise<TemplateSnapshot> {
    const state = raw ?? { id: 'library', revision: 0, entries: [] }
    if (!state || Object.keys(state).sort().join(',') !== 'entries,id,revision' || state.id !== 'library' || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.entries) || state.entries.length > SCENE_TEMPLATE_LIMITS.entries) throw new Error('场景模板库记录损坏。')
    const result = captureSceneTemplateEntries(state.entries), revision = state.revision
    const bridgePredecessors: Record<string, string> = {}
    for (const row of result) {
      const bundle = await loadSceneTemplate(row.bytes, this.validation)
      if (bundle.project.document.title !== row.name) throw new Error('场景模板名称与完整内容不符。')
      const bridge = Object.values(bundle.project.document.paths)[0]?.assembly?.bridge
      if (bridge?.templateKey) bridgePredecessors[row.key] = bridge.templateKey
    }
    checkCancelled(this.validation.signal)
    return { id: 'library', revision, entries: result, bridgePredecessors }
  }
  async read(): Promise<TemplateSnapshot> {
    return this.database.transaction('r', this.database.state, async () => Dexie.waitFor(this.checked(await this.database.state.get('library'))))
  }
  async commit(expectedRevision: number, put: SceneTemplateEntry[], remove: string[] = []): Promise<TemplateSnapshot> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('场景模板库基线无效。')
    const removals = captureJson(remove) as string[]
    if (!Array.isArray(removals) || removals.length > 32 || removals.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) || new Set(removals).size !== removals.length) throw new Error('模板移除范围无效。')
    // Capture bytes and fully validate incoming content before touching the database.
    const incoming = await this.checked({ id: 'library', revision: 0, entries: put })
    return this.database.transaction('rw', this.database.state, async () => {
      const current = await Dexie.waitFor(this.checked(await this.database.state.get('library')))
      if (current.revision !== expectedRevision) throw new Error('场景模板库已被另一个标签修改，请刷新后重新应用；双方内容均保留。')
      if (removals.some(key => !current.entries.some(row => row.key === key))) throw new Error('要移除的模板已变化。')
      const entries = new Map(current.entries.filter(row => !removals.includes(row.key)).map(row => [row.key, row]))
      for (const entry of incoming.entries) entries.set(entry.key, entry)
      if (entries.size > SCENE_TEMPLATE_LIMITS.entries || [...entries.values()].reduce((sum, row) => sum + row.bytes.length, 0) > SCENE_TEMPLATE_LIMITS.storedBytes) throw new Error('场景模板库超过32条／128MiB保护值。')
      const next: State = { id: 'library', revision: current.revision + 1, entries: [...entries.values()] }
      if (!Number.isSafeInteger(next.revision)) throw new Error('模板库revision超出安全范围。')
      const bridgePredecessors = { ...current.bridgePredecessors, ...incoming.bridgePredecessors }
      for (const key of Object.keys(bridgePredecessors)) if (!entries.has(key)) delete bridgePredecessors[key]
      checkCancelled(this.validation.signal); await this.database.state.put(next)
      return { ...next, bridgePredecessors }
    })
  }
}
