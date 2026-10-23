import { PROJECT_LIMITS_V4 } from '../v4/limits'

/** Composition is versioned separately, without increasing existing byte/count budgets. */
export const PROJECT_LIMITS_V6 = Object.freeze({ ...PROJECT_LIMITS_V4 })
export { checkCancelled, hasExactKeys, isSha256, crc32 } from '../v3/limits'
export function failV6(message: string): never { throw new Error(`M1 室外工程无效：${message}`) }
