/** Database schema versions and the development project format are independent. */
export interface CurrentDatabaseNames { projects: string; library: string }
export const CURRENT_DATABASE_SELECTION_KEY = 'sceneweave-current-development-storage'
export const DEFAULT_CURRENT_DATABASES: CurrentDatabaseNames = { projects: 'sceneweave-projects-dev-v1', library: 'sceneweave-library-dev-v1' }
export function currentDatabaseNames(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): CurrentDatabaseNames {
  const raw = storage?.getItem(CURRENT_DATABASE_SELECTION_KEY)
  if (!raw) return { ...DEFAULT_CURRENT_DATABASES }
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('当前开发存储选择损坏，请从独立迁入入口恢复选择。') }
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'library,projects') throw new Error('当前开发存储选择无效。')
  const names = value as CurrentDatabaseNames
  if (!/^sceneweave-projects-dev-v1(?:-[a-f0-9]{64})?$/.test(names.projects) || !/^sceneweave-library-dev-v1(?:-[a-f0-9]{64})?$/.test(names.library)
    || names.projects.slice('sceneweave-projects'.length) !== names.library.slice('sceneweave-library'.length)) throw new Error('当前开发存储选择不能指向旧库或不匹配的工程/素材库。')
  return { projects: names.projects, library: names.library }
}
