import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createTerrainVariantCatalogDocument } from '../../platform/browser/content/terrain-variant-catalog.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { generateTerrainDocumentV6, compositionPresetV6, materializeTerrainCompositionV6 } from './surface-rule-generation.js'
import type { SceneDocument } from '../model/scene.js'
const projection = (scene: SceneDocument) => Object.fromEntries(['terrainAreas','terrainEdges','terrainConnections','paths','props','decorations','decorationClusters','surfaceRules','visual','generation','entityLayers'].map(key=>[key,scene[key as keyof SceneDocument]]))
function base(){
 const scene=createShoreBlankDocument('island',{sceneId:'single-v1-replay6',title:'Frozen algorithm6 replay',now:'2026-11-04T00:00:00.000Z',widthMm:24000,heightMm:18000,preset:'narrative'})
 const catalogue=createTerrainVariantCatalogDocument()
 for(const key of ['tree-wind-oak','shrub-heath-mound','grass-sedge-fan']){
 const id=`terrain-variants-v1-prop-${key}`,definition=catalogue.propDefinitions[id]
 scene.propDefinitions[id]=cloneJson(definition)
 const assetId=definition.defaultAppearance.kind==='image'?definition.defaultAppearance.assetId:'missing'
 scene.assets[assetId]=cloneJson(catalogue.assets[assetId])
 }return scene
}
describe('current project v1 preserves frozen algorithm6 domain output',()=>{it('preserves geometry, members, visual and generation hashes across the project-format collapse',()=>{
 const source=base(),result=generateTerrainDocumentV6(source,{sceneId:source.sceneId,seed:'terrain-v1-0',kind:'island',widthMm:24000,heightMm:18000,algorithmVersion:6,budgetProfileId:'standard',quality:'standard'},'single-v1-replay6-birth')
 const request={sceneId:source.sceneId,seed:'single-v1-composition6',preset:'archipelago',widthMm:24000,heightMm:18000,recipeVersion:6,budgetProfileId:'standard',quality:'standard'}
 const preset=compositionPresetV6(request),composition=materializeTerrainCompositionV6(source,preset.input,preset.requirements,preset.name,'plain',6,taskBudgetProfile('standard'))
 expect(result.document.schemaVersion).toBe(1)
 expect(composition.document.schemaVersion).toBe(1)
 expect(sha256Text(canonicalJson(projection(result.document)))).toBe('2ee5e509096069b963d563a3645bd99082a211ee4e7092722c22897f4c49d0ae')
 expect(sha256Text(canonicalJson(projection(composition.document)))).toBe('5ce1063d9b69c4dc4f5e4d9ecd35af0516bc3c313bbc46651c846f22a9c41c4e')
 },30000)})
