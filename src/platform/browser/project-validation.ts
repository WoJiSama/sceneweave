import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { createBrowserImagePort } from './images/index.js'
import { createBrowserSvgPort } from './ai/svg-port.js'

/** One immutable platform capability owner. Session proofs bind its actual
 * methods and processor; render callers must not mint a new adapter per frame. */
export const browserProjectValidation: CompleteValidationOptions = Object.freeze({
  images: Object.freeze(createBrowserImagePort()),
  svg: Object.freeze(createBrowserSvgPort()),
})
