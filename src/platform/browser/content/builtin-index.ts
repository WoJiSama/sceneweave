import type { ProjectData } from '../../../shared/model/project.js'
import fixed from './builtin-data.json'
import { createFixedCatalogIndex } from './fixed-catalog-index.js'

export default createFixedCatalogIndex(fixed.project as unknown as ProjectData, fixed.paths)
