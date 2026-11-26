import type { ProjectData } from '../../../shared/model/project.js'
import fixed from './builtin-data.json'
import { createFixedCatalogIndex } from './fixed-catalog-index.js'
import { withBuiltinPropVolumes } from './builtin-prop-volumes.js'

export default createFixedCatalogIndex(withBuiltinPropVolumes(fixed.project as unknown as ProjectData), fixed.paths)
