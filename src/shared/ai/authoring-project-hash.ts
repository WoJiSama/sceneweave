import type { ProjectData } from '../model/project.js'
import { sha256Text } from '../validation/hash.js'
import { canonicalJson } from '../validation/json.js'

/** Hash of all persistable metadata, separate from resource validation. */
export const authoringProjectHash = (project: ProjectData): string => sha256Text(canonicalJson(project))
