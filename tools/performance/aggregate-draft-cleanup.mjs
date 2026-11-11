const cancelLabels = Object.freeze({ building: '取消建筑草稿', natural: '取消室外草稿' })
const check = (value, message) => { if (!value) throw new Error(message) }

// A known refusal ends the aggregate attempt but leaves its form inputs intact.
// Exit only that form through the normal UI, outside measured sample windows.
// An unexpected operation error propagates without cancelling anything.
export async function runAggregateWithDraftCleanup({ operation, page, observer, domain, readProject, assertSameProject }) {
  const label = Object.hasOwn(cancelLabels, domain) ? cancelLabels[domain] : null
  check(label, `Unknown aggregate domain: ${domain}`)
  await operation()
  const cancel = page.getByRole('button', { name: label, exact: true }), count = await cancel.count()
  if (count === 0) return { status: 'not-needed', domain }
  check(count === 1, 'Ambiguous aggregate draft cancellation controls')
  const beforeProject = await readProject('before-draft-dismiss'), before = await observer.snapshot()
  check(Number.isSafeInteger(before.revision) && before.revision >= 0, 'Missing aggregate draft revision')
  observer.setPhase('setup-group-draft-dismiss')
  await cancel.click()
  await cancel.waitFor({ state: 'hidden' })
  await observer.ready()
  const after = await observer.snapshot()
  check(after.revision === before.revision, 'Draft dismissal changed revision')
  check(after.nativeFormat === before.nativeFormat && after.selection === before.selection, 'Draft dismissal changed format or selection')
  const afterProject = await readProject('after-draft-dismiss')
  assertSameProject(beforeProject, afterProject)
  return { status: 'cancelled', domain, button: label, revision: after.revision,
    revisionUnchanged: true, completePackageUnchanged: true }
}
