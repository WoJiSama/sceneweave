import {z} from 'zod'
import {anchor,id,ids,point,positive} from '../validation/primitives.js'

export const PATH_CHECK_LIMITS=Object.freeze({checks:16,nameCharacters:80,hintPoints:128,assumedDoors:128,nodesPerCheck:512,totalNodes:4096})
/** A hint is a candidate route, never an exemption from physical validation. */
export const pathCheckSchema=z.object({id,floorId:id,from:anchor,to:anchor,clearanceMm:positive,
  name:z.string().min(1).max(PATH_CHECK_LIMITS.nameCharacters).refine(value=>value.trim().length>0,'通路名称不能为空。').optional(),
  mode:z.enum(['structural','current']),assumedOpenDoorIds:ids.max(PATH_CHECK_LIMITS.assumedDoors),
  routeHintMm:z.array(point).min(2).max(PATH_CHECK_LIMITS.hintPoints).optional(),
}).strict()
