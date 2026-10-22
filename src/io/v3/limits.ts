import { PROJECT_LIMITS_V2 } from '../v2/limits'

/** V3 changes the document and container contract; resource budgets are unchanged. */
export const PROJECT_LIMITS_V3 = PROJECT_LIMITS_V2
export { checkCancelled, hasExactKeys, isSha256, crc32 } from '../v2/limits'
export function failV3(message: string): never { throw new Error(`M1 工程无效：${message}`) }
