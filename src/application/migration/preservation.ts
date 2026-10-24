import { importMigrationSet, type MigrationSetFiles } from '../../shared/migration/set.js'
import { CONVERTER_VERSION, type PreservationRecordInput } from '../../shared/migration/types.js'
import { checkCancelled, type ResourceOptions } from '../../shared/ports/resources.js'
import { restoreLegacyCapture } from '../../compat/legacy/capture.js'
import { restoreLegacyCatalogCapture } from '../../compat/legacy/catalog.js'
import { beginCapturedConversion, type ConversionEnvironment, type BegunProjectConversion } from './conversion.js'
import { beginCaptured, type LibraryConversionEnvironment, type BegunLibraryConversion } from './library-conversion.js'

function optionsFor(env: ConversionEnvironment | LibraryConversionEnvironment, options: ResourceOptions): ResourceOptions {
  return { signal: options.signal ?? env.validation.signal ?? env.legacy?.signal }
}
async function reread(files: MigrationSetFiles, options: ResourceOptions) {
  if (!files || ![Object.prototype, null].includes(Object.getPrototypeOf(files))) throw new Error('保全文件包装须为普通数据对象。')
  const fields = Object.getOwnPropertyDescriptors(files)
  if (Reflect.ownKeys(files).length !== 2 || !['index', 'volumes'].every(key => fields[key]?.enumerable && 'value' in fields[key])) throw new Error('保全文件包装含未知、隐藏、访问器或Symbol字段。')
  const recovered = await importMigrationSet(fields.index.value!, fields.volumes.value!, options.signal)
  if (recovered.manifest.converterVersion !== CONVERTER_VERSION) throw new Error('保全集合使用了不支持的转换器版本。')
  const records: PreservationRecordInput[] = recovered.records.map(({ role, recordKey, sourceFormat, contentHash, bytes }) => ({ role, recordKey, sourceFormat, contentHash, bytes }))
  checkCancelled(options.signal)
  return { ...recovered, records }
}

/** Reopen a complete preservation set without touching any old repository.
 * A fresh browser reserves its own durable journal and re-exports a set bound to
 * that journal. The caller must download and reread that new set before continue.
 * Source availability/change policy remains an explicit later continue decision.
 */
export async function beginPreservedProjectConversion(files: MigrationSetFiles, env: ConversionEnvironment, options: ResourceOptions = {}): Promise<BegunProjectConversion> {
  const resourceOptions = optionsFor(env, options), recovered = await reread(files, resourceOptions)
  if (recovered.manifest.scope.kind !== 'project-family') throw new Error('请选择完整工程家族保全集合。')
  const capture = await restoreLegacyCapture(recovered.manifest.scope, recovered.records, resourceOptions.signal)
  if (capture.sourceFingerprint !== recovered.manifest.sourceFingerprint) throw new Error('保全行的实际工程指纹与索引不一致。')
  checkCancelled(resourceOptions.signal)
  return beginCapturedConversion(capture, env, resourceOptions)
}

/** Whole-catalog reopening includes organization-only records and install state. */
export async function beginPreservedLibraryConversion(files: MigrationSetFiles, env: LibraryConversionEnvironment, options: ResourceOptions = {}): Promise<BegunLibraryConversion> {
  const resourceOptions = optionsFor(env, options), recovered = await reread(files, resourceOptions)
  if (recovered.manifest.scope.kind !== 'catalog') throw new Error('请选择完整个人素材库保全集合。')
  const capture = await restoreLegacyCatalogCapture(recovered.manifest.scope, recovered.records, resourceOptions.signal)
  if (capture.sourceFingerprint !== recovered.manifest.sourceFingerprint) throw new Error('保全行的实际目录指纹与索引不一致。')
  checkCancelled(resourceOptions.signal)
  return beginCaptured(capture, env, resourceOptions)
}
