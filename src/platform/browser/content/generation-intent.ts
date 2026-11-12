import type { GenerationBaseIntent, GenerationContentPort } from '../../../application/workspace/generation-intent.js'
import { checkCancelled, type ResourceOptions } from '../../../shared/ports/resources.js'
import { defaultVolcanoInput } from '../../../shared/generation/domains/volcano/index.js'
import { defaultMixedInputV4 } from '../../../shared/generation/domains/mixed/index.js'
import { createRefinedBlankProject } from './refined-blank.js'
import { createShoreBlankProject } from './shore-blank.js'
import { createVolcanoBlankProject, createMixedBlankProject } from './factories.js'

const blankOptions = (input: GenerationBaseIntent) => ({ title: input.title, widthMm: input.widthMm, heightMm: input.heightMm,
  sceneId: input.sceneId, preset: input.preset, gridVisible: input.gridVisible })

/** Adapt the portable cancellation contract at this browser-only boundary. */
async function withNativeSignal<T>(options: ResourceOptions, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  checkCancelled(options.signal)
  const controller = new AbortController(), abort = () => controller.abort()
  options.signal?.addEventListener?.('abort', abort, { once: true })
  try {
    checkCancelled(options.signal)
    const result = await action(controller.signal)
    checkCancelled(options.signal)
    return result
  } finally { options.signal?.removeEventListener?.('abort', abort) }
}

/** Fixed catalogue identities stay beside the factories that supply their real
 * bytes and licences. Application intent only consumes roles and references. */
export const browserGenerationContent: GenerationContentPort = {
  interior: (input, options) => withNativeSignal(options, async signal => {
    const base = await createRefinedBlankProject('interior', blankOptions(input), signal)
    const palette = [
      { role: 'bed' as const, ref: { id: 'refined-prop-interior-bed-indigo', version: 1 } },
      { role: 'seat' as const, ref: { id: 'refined-prop-interior-chair-slat', version: 1 } },
      { role: 'table' as const, ref: { id: 'refined-prop-interior-table-round', version: 1 } },
      { role: 'table' as const, ref: { id: 'refined-prop-interior-table-long', version: 1 } },
      { role: 'storage' as const, ref: { id: 'refined-prop-interior-cupboard-linen', version: 1 } },
      { role: 'work' as const, ref: { id: 'refined-prop-interior-counter-kitchen', version: 1 } },
      { role: 'work' as const, ref: { id: 'refined-prop-interior-desk-writing', version: 1 } },
      { role: 'hearth' as const, ref: { id: 'refined-prop-interior-stove-masonry', version: 1 } },
      { role: 'shelf' as const, ref: { id: 'refined-prop-interior-shelf-books', version: 1 } },
    ].filter(row => base.document.propDefinitions[row.ref.id]?.version === row.ref.version)
    return { base, palette }
  }),
  forest: (input, options) => withNativeSignal(options, async signal => ({
    base: await createShoreBlankProject('island', blankOptions(input), signal, true, true),
    groundMaterial: { id: 'shore-v1-material-grass', version: 1 }, routeMaterial: { id: 'shore-v1-material-sand-dry', version: 1 },
    palettes: {
      tree: [{ key: 'tree-highland-copse', definitionRef: { id: 'terrain-variants-v2-prop-tree-highland-copse', version: 1 }, kind: 'prop' as const, weight: 1 }],
      shrub: [{ key: 'shrub-heath-mound', definitionRef: { id: 'terrain-variants-v1-prop-shrub-heath-mound', version: 1 }, kind: 'decoration' as const, weight: 1 }],
      grass: [{ key: 'grass-sedge-fan', definitionRef: { id: 'terrain-variants-v1-prop-grass-sedge-fan', version: 1 }, kind: 'decoration' as const, weight: 1 }],
    },
  })),
  volcano: (input, options) => withNativeSignal(options, async signal => {
    const base = await createVolcanoBlankProject(blankOptions(input), signal)
    return { base, defaults: defaultVolcanoInput(base.document, input.seed), flowMaterials: {
      cold: { id: 'content-m-lava', version: 1 }, hot: { id: 'content-m-lava-hot', version: 1 },
    } }
  }),
  mixed: (input, options) => withNativeSignal(options, async signal => {
    const base = await createMixedBlankProject(input.environment, blankOptions(input), signal)
    return { base, defaults: defaultMixedInputV4(base.document, input.environment, input.seed) }
  }),
}
