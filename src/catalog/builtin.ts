import { createOutdoorBlankProject } from '../editor/v6/blank-project'
import type { CompleteProjectV6 } from '../io/v6/types'

// This is a resource provider, not a persistent installation or decoded bitmap cache.
// A cancelled consumer cannot publish a late result into a different editor session.
let prepared: Promise<CompleteProjectV6> | undefined
export async function loadBuiltinCatalogV1(signal?: AbortSignal): Promise<CompleteProjectV6> {
  signal?.throwIfAborted()
  prepared ??= createOutdoorBlankProject({ title: '内置素材目录', widthMm: 20_000, heightMm: 20_000, preset: 'investigation' })
    .catch(error => { prepared = undefined; throw error })
  const project = await prepared
  signal?.throwIfAborted()
  return project
}
