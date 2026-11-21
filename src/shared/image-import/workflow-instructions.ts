import { getWorkflow } from '../ai/workflows/catalog.js'

const { id, version, definitionHash, steps } = getWorkflow('sceneweave-image-items')
const surface = steps.find(step => step.id === 'refine-surface')
if (!surface) throw new Error('图片工作流缺少地面表面细修步骤。')

/** Preserve the image tool's guidance fields using the same versioned step text. */
export const IMAGE_ITEM_WORKFLOW = Object.freeze({
  id, version, definitionHash,
  instructions: steps.filter(step => step !== surface).map(step => step.instructions).join('\n\n'),
  stages: ['source', 'scope', 'selection', 'edge-review', 'background-review', 'ready', 'adopted'],
  surfaceAppearance: surface.instructions,
})
