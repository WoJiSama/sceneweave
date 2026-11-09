import type { SceneDocument } from '../../model/scene.js'
import type { ArtifactInput } from '../contracts.js'
import { volcanoSpaceFacts } from './volcano/facts.js'
import { forestSpaceFacts } from './forest/facts.js'

export type DomainFactProvider = (scene: SceneDocument, key: (kind: string, id: string) => string) => readonly ArtifactInput[]
/** Static composition root. Providers consume validated saved entities; they
 * cannot infer support or travel from images, names or a seed alone. */
export const domainFactProviders: readonly DomainFactProvider[] = Object.freeze([volcanoSpaceFacts, forestSpaceFacts])
