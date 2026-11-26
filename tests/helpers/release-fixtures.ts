import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Original bytes from 80162f9176628569f8de38f7188d89c1dd8f7ad6. See docs/testing.md.
const fixtures = {
  'investigation.sceneweave': 'd3d13513b2701914a46e8a7405398867af9d7e060db3da22eacd6436b8ac46aa',
  'selected-history.sceneweave': '722f179e27322316e4f0bee1114b6c7a0d093bcca3cffe5083565091a20a08c7',
  'personal-library.json': '829e7a93be85a7ee88d814945de171628c422560edd139e56eeaf626b9c0045a',
  'project-database.json.gz': '80fd7b1eccb9256ad2a38722dba33496e9f1b1aeb619a24f3f7765845f11861e',
} as const

export async function readReleaseFixture(name: keyof typeof fixtures): Promise<Uint8Array> {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/project-compatibility', name)
  const bytes = await readFile(path)
  if (createHash('sha256').update(bytes).digest('hex') !== fixtures[name]) throw new Error(`历史发布样本字节已变化：${name}`)
  return new Uint8Array(bytes)
}
