import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { PrivateArtifacts } from './artifacts.js'
import { StaticSvgArtifacts } from './svg-artifacts.js'

const roots: string[] = []
const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 16"><rect x="0" y="0" width="32" height="16" fill="#13579b"/></svg>'
const make = () => {
  const root = mkdtempSync(join(tmpdir(), 'sceneweave-svg-artifacts-')); roots.push(root)
  return { root, artifacts: new StaticSvgArtifacts(new PrivateArtifacts(root)), taskId: randomUUID() }
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })

describe('private static SVG artifacts', () => {
  it('stores an atomically verified, task-local original and normalized source without returning a path', () => {
    const { artifacts, taskId } = make(), stored = artifacts.store(taskId, source), again = artifacts.store(taskId, source)
    expect(stored).toEqual(again)
    expect(stored.record).toMatchObject({ schemaVersion: 1, id: stored.record.sourceSha256, processorId: 'sceneweave-static-svg', processorVersion: 1 })
    expect(stored.sourceSvg).toBe(source)
    expect(stored.normalizedSvg).toContain('viewBox="0 0 32 16"')
    expect(Object.keys(stored)).toEqual(['record', 'sourceSvg', 'normalizedSvg'])
    const base = join(artifacts.root, taskId, 'svg', stored.record.id)
    expect(statSync(base).mode & 0o777).toBe(0o700)
    for (const name of ['source.svg', 'normalized.svg', 'record.json']) expect(statSync(join(base, name)).mode & 0o777).toBe(0o600)
  })

  it('rejects active SVG before creating a task artifact and isolates task namespaces', () => {
    const { artifacts, taskId } = make()
    expect(() => artifacts.store(taskId, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script/></svg>')).toThrow(/SVG/)
    const stored = artifacts.store(taskId, source)
    expect(() => artifacts.read(randomUUID(), stored.record.id)).toThrow()
    expect(() => artifacts.read(taskId, '../' + stored.record.id)).toThrow(/制品ID/)
    expect(() => artifacts.read('not-a-uuid', stored.record.id)).toThrow(/任务ID/)
  })

  it('detects tampered source, normalized bytes, records and symlinked artifact directories', () => {
    const { root, artifacts, taskId } = make(), stored = artifacts.store(taskId, source), base = join(artifacts.root, taskId, 'svg', stored.record.id)
    writeFileSync(join(base, 'normalized.svg'), '<svg/>')
    expect(() => artifacts.read(taskId, stored.record.id)).toThrow(/SVG|一致/)
    rmSync(base, { recursive: true, force: true })
    const target = join(root, 'outside'); mkdirSync(target); symlinkSync(target, base)
    expect(() => artifacts.read(taskId, stored.record.id)).toThrow(/实际目录/)
  })

  it('requires a canonical metadata record and rejects a modified size/hash closure', () => {
    const { artifacts, taskId } = make(), stored = artifacts.store(taskId, source), base = join(artifacts.root, taskId, 'svg', stored.record.id)
    const record = JSON.parse(readFileSync(join(base, 'record.json'), 'utf8')) as Record<string, unknown>
    record.sourceSizeBytes = 1
    writeFileSync(join(base, 'record.json'), JSON.stringify(record))
    expect(() => artifacts.read(taskId, stored.record.id)).toThrow(/规范编码|一致/)
  })
})
