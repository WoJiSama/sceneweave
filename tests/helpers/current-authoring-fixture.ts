import { createCurrentAuthoringStartV4 } from '../../src/shared/ai/current-authoring.js'
import { authoringProjectHash } from '../../src/shared/ai/authoring.js'
import type { AuthoringStartV4, CurrentAuthoringScope } from '../../src/shared/ai/authoring-protocol-v4.js'
import type { AuthoringStart as LegacyStart } from '../../src/shared/ai/authoring-protocol-v1.js'
import { cloneJson } from '../../src/shared/validation/json.js'

/** A fresh explicit test authorization. Never convert a remote source/lease. */
export function currentAuthoringFixture(input: Pick<LegacyStart, 'project' | 'seed' | 'preparedAt' | 'skill' | 'brief'> & { scope: CurrentAuthoringScope | LegacyStart['scope'] }): AuthoringStartV4 {
  const { project } = input
  return cloneJson(createCurrentAuthoringStartV4({ project, scope: input.scope, seed: input.seed, preparedAt: input.preparedAt,
    skill: input.skill, ...(input.brief ? { brief: input.brief } : {}), flowId: `test-${input.seed}`,
    preservation: { sceneId: project.document.sceneId, revision: project.document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 } }))
}
