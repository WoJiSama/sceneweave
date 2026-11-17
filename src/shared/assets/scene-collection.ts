import { STORAGE_CATEGORIES, STORAGE_DESIGNS, storageAssetId, storageDefinitionId } from './storage-collection.js'
import { TRADE_CATEGORIES, TRADE_DESIGNS, tradeAssetId, tradeDefinitionId } from './trade-collection.js'
import { KITCHEN_CATEGORIES, KITCHEN_DESIGNS, kitchenAssetId, kitchenDefinitionId } from './kitchen-collection.js'
import { WASH_CATEGORIES, WASH_DESIGNS, washAssetId, washDefinitionId } from './wash-collection.js'
import { LIGHTING_CATEGORIES, LIGHTING_DESIGNS, lightingAssetId, lightingDefinitionId } from './lighting-collection.js'
import { FARM_CATEGORIES, FARM_DESIGNS, farmAssetId, farmDefinitionId } from './farm-collection.js'
import { WORKSHOP_CATEGORIES, WORKSHOP_DESIGNS, workshopAssetId, workshopDefinitionId } from './workshop-collection.js'
import { ADVENTURE_CATEGORIES, ADVENTURE_DESIGNS, adventureAssetId, adventureDefinitionId } from './adventure-collection.js'
import { RITUAL_CATEGORIES, RITUAL_DESIGNS, ritualAssetId, ritualDefinitionId } from './ritual-collection.js'
import { FURNISHING_DETAILS_CATEGORIES, FURNISHING_DETAILS_DESIGNS, furnishingDetailsAssetId, furnishingDetailsDefinitionId } from './furnishing-details-collection.js'
import { PERIOD_EQUIPMENT_CATEGORIES, PERIOD_EQUIPMENT_DESIGNS, periodEquipmentAssetId, periodEquipmentDefinitionId } from './period-equipment-collection.js'
import { ARCHITECTURE_CATEGORIES, ARCHITECTURE_DESIGNS, architectureAssetId, architectureDefinitionId } from './architecture-collection.js'
import { NATURE_CATEGORIES, NATURE_DESIGNS, natureAssetId, natureDefinitionId } from './nature-collection.js'
import { TRANSPORT_CATEGORIES, TRANSPORT_DESIGNS, transportAssetId, transportDefinitionId } from './transport-collection.js'
import { SURFACES_TRACES_CATEGORIES, SURFACES_TRACES_DESIGNS, surfacesTracesAssetId, surfacesTracesDefinitionId } from './surfaces-traces-collection.js'
import { FURNITURE_CATEGORIES, FURNITURE_STYLES, furnitureKey, furnitureAssetId, furnitureDefinitionId } from './furniture-collection.js'
import { freezeJson } from '../validation/json.js'
import { MARINE_CATEGORIES, MARINE_DESIGNS, marineAssetId, marineDefinitionId } from './marine-collection.js'

/** Authored candidates, separate from the larger coverage plan and art approval. */
interface Design { key: string; category: string; name: string; era: 'medieval' | 'fantasy' | '1920s'; design: string; widthMm: number; heightMm: number }
const family = (sourceFamily: string, group: string, categories: readonly { id: string; name: string }[], designs: readonly Design[], assetId: (key: string) => string, definitionId: (key: string) => string) => ({
  items: designs.map(row => ({ ...row, group, sourceFamily, assetId: assetId(row.key), definitionId: definitionId(row.key) })),
  categories: categories.map(row => ({ ...row, group, count: designs.filter(item => item.category === row.id).length })),
})
const families = [
  family('marine', 'nature', MARINE_CATEGORIES, MARINE_DESIGNS, marineAssetId, marineDefinitionId),
  family('furniture', 'furnishing', FURNITURE_CATEGORIES, FURNITURE_STYLES.flatMap(style => FURNITURE_CATEGORIES.map(category => ({
    key: furnitureKey(category.id, style.id), category: category.id, name: `${style.name} · ${style.designs[category.id]}`, era: style.era,
    design: style.designs[category.id], widthMm: style.sizes[category.id][0], heightMm: style.sizes[category.id][1],
  }))), furnitureAssetId, furnitureDefinitionId),
  family('storage', 'storage', STORAGE_CATEGORIES, STORAGE_DESIGNS, storageAssetId, storageDefinitionId),
  family('trade', 'storage', TRADE_CATEGORIES, TRADE_DESIGNS, tradeAssetId, tradeDefinitionId),
  family('kitchen', 'kitchen', KITCHEN_CATEGORIES, KITCHEN_DESIGNS, kitchenAssetId, kitchenDefinitionId),
  family('wash', 'wash', WASH_CATEGORIES, WASH_DESIGNS, washAssetId, washDefinitionId),
  family('lighting', 'lighting', LIGHTING_CATEGORIES, LIGHTING_DESIGNS, lightingAssetId, lightingDefinitionId),
  family('farm', 'farm', FARM_CATEGORIES, FARM_DESIGNS, farmAssetId, farmDefinitionId),
  family('workshop', 'workshop', WORKSHOP_CATEGORIES, WORKSHOP_DESIGNS, workshopAssetId, workshopDefinitionId),
  family('adventure', 'adventure', ADVENTURE_CATEGORIES, ADVENTURE_DESIGNS, adventureAssetId, adventureDefinitionId),
  family('ritual', 'ritual', RITUAL_CATEGORIES, RITUAL_DESIGNS, ritualAssetId, ritualDefinitionId),
  family('furnishing-details', 'furnishing', FURNISHING_DETAILS_CATEGORIES, FURNISHING_DETAILS_DESIGNS, furnishingDetailsAssetId, furnishingDetailsDefinitionId),
  family('period-equipment', 'period-equipment', PERIOD_EQUIPMENT_CATEGORIES, PERIOD_EQUIPMENT_DESIGNS, periodEquipmentAssetId, periodEquipmentDefinitionId),
  family('architecture', 'architecture', ARCHITECTURE_CATEGORIES, ARCHITECTURE_DESIGNS, architectureAssetId, architectureDefinitionId),
  family('nature', 'nature', NATURE_CATEGORIES, NATURE_DESIGNS, natureAssetId, natureDefinitionId),
  family('transport', 'transport', TRANSPORT_CATEGORIES, TRANSPORT_DESIGNS, transportAssetId, transportDefinitionId),
  family('surfaces-traces', 'surfaces-traces', SURFACES_TRACES_CATEGORIES, SURFACES_TRACES_DESIGNS, surfacesTracesAssetId, surfacesTracesDefinitionId),
]
export const SCENE_COLLECTION_ITEMS = freezeJson(families.flatMap(row => row.items))
export const SCENE_COLLECTION_AVAILABLE_CATEGORIES = freezeJson(families.flatMap(row => row.categories))
if (new Set(SCENE_COLLECTION_ITEMS.map(row => row.definitionId)).size !== SCENE_COLLECTION_ITEMS.length
  || new Set(SCENE_COLLECTION_AVAILABLE_CATEGORIES.map(row => row.id)).size !== SCENE_COLLECTION_AVAILABLE_CATEGORIES.length) throw new Error('全场景素材注册含重复类别或固定定义身份。')
