import assert from 'node:assert/strict'
import test from 'node:test'
import { currentFormalRssMode } from './current-formal-observer.mjs'

test('current formal sampling selects the implemented platform process-tree backend', () => {
  assert.equal(currentFormalRssMode('win32'), 'windows-process-tree')
  assert.equal(currentFormalRssMode('darwin'), 'macos-process-tree')
  assert.throws(() => currentFormalRssMode('linux'), /unsupported.*explicit unavailable RSS mode/)
})
