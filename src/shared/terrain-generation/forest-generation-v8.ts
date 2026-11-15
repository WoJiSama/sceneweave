import { z } from 'zod'
import type { SceneDocument } from '../model/scene.js'
import { captureJson } from '../validation/json.js'
import { generateForestGeometryV8, terrainGenerationInputV8Schema } from './generate.js'
import { styleTerrainGeometryV5, terrainGenerationResultV5Schema } from './surface-generation.js'

export { terrainGenerationInputV8Schema }
export const terrainGenerationResultV8Schema = z.object({ ...terrainGenerationResultV5Schema.shape, input:terrainGenerationInputV8Schema }).strict()
  .superRefine((result,context) => {
    const checked=terrainGenerationResultV5Schema.safeParse({...result,input:{...result.input,algorithmVersion:5}})
    if(!checked.success)for(const issue of checked.error.issues)context.addIssue({code:'custom',path:issue.path,message:issue.message})
  })
export type TerrainGenerationResultV8 = z.infer<typeof terrainGenerationResultV8Schema>
export function generateTerrainDocumentV8(base:SceneDocument,raw:unknown):TerrainGenerationResultV8 {
  const input=terrainGenerationInputV8Schema.parse(captureJson(raw)),physical=generateForestGeometryV8(base,input)
  // A larger overview has coarser edge marks under the same finite native
  // limits. Real millimetre paint sizes, physics and all limits remain intact.
  const scale=Math.min(input.widthMm/24000,input.heightMm/18000)
  const edgeDetailScale=Math.max(1,scale/(input.quality==='detailed'?2:1))
  const styled=styleTerrainGeometryV5(base,physical,{...input,algorithmVersion:5},edgeDetailScale)
  return terrainGenerationResultV8Schema.parse({...styled,input})
}
