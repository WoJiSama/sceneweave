import { z } from 'zod'
import { id, point } from '../validation/primitives.js'

export const PATH_ENDS = ['start', 'end'] as const
const end = z.enum(PATH_ENDS)
export type PathEnd = z.infer<typeof end>

const roadEndpoint = z.object({ pathId: id, end }).strict()
const bridgeRoadLink = roadEndpoint.extend({ restMm: point }).strict()
export const bridgeRoadLinksSchema = z.partialRecord(end, bridgeRoadLink)
export type BridgeRoadLink = z.infer<typeof bridgeRoadLink>

export const moveBridgeSchema = z.object({ type: z.literal('moveBridge'), id, offsetMm: point,
  attach: roadEndpoint.extend({ bridgeEnd: end }).strict().optional() }).strict()
export type MoveBridge = z.infer<typeof moveBridgeSchema>

export const detachBridgeRoadSchema = z.object({ type: z.literal('detachBridgeRoad'), id, end }).strict()
export type DetachBridgeRoad = z.infer<typeof detachBridgeRoadSchema>
