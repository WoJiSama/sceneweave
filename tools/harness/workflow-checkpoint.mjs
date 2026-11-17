import { readBounded, writeVerified, digest } from './io.mjs'
import path from 'node:path'

/** An immutable companion binds the existing work archive without changing its
 * recipe or guessing the definition used by older, unbound archives. */
export async function readWorkflowCompanion(archiveFile, archiveBytes, assertBinding) {
  let bytes
  try { bytes = await readBounded(`${archiveFile}.workflow.json`, 8192) }
  catch (error) { if (error.code === 'ENOENT') return { status: 'legacy-unbound', binding: null }; throw error }
  const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (record.format !== 'sceneweave-workflow-companion' || record.version !== 1 || record.archiveSha256 !== digest(archiveBytes)
    || !Number.isSafeInteger(record.generation) || record.generation < 0
    || Object.keys(record).sort().join(',') !== 'archiveSha256,binding,format,generation,version') throw new Error('Workflow companion does not match the actual work archive')
  return { status: 'bound', binding: assertBinding(record.binding), generation: record.generation }
}

export async function writeWorkflowCompanion(archiveFile, archiveBytes, binding, generation) {
  const record = { format: 'sceneweave-workflow-companion', version: 1, archiveSha256: digest(archiveBytes), binding, generation }
  return writeVerified(path.dirname(archiveFile), `${path.basename(archiveFile)}.workflow.json`, Buffer.from(JSON.stringify(record, null, 2) + '\n'), 8192)
}
