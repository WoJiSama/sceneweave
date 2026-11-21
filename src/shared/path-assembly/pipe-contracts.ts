import { z } from 'zod'
import { id, pipePortKind, point } from '../validation/primitives.js'
import { PATH_ENDS } from './bridge-link-contracts.js'

const portRef = z.object({ propId: id, port: pipePortKind }).strict()
export const pipeLinksSchema = z.partialRecord(z.enum(PATH_ENDS), portRef.extend({ restMm: point }).strict())
export type PipeLinks = z.infer<typeof pipeLinksSchema>

export const setPipeLinkSchema = z.object({ type: z.literal('setPipeLink'), id,
  end: z.enum(PATH_ENDS), target: portRef.nullable() }).strict()
export type SetPipeLink = z.infer<typeof setPipeLinkSchema>
