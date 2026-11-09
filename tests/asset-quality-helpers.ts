import { expect, type Page } from '@playwright/test'

/** Deliberate human-review stand-in for a test's declared fixture only. */
export async function acknowledgeAssetQuality(page: Page): Promise<void> {
  const review = page.getByRole('region', { name: '素材质量初筛', exact: true })
  if (!await review.count()) return
  const choices = review.getByRole('checkbox', { name: /^复核并保留素材 / })
  for (let index = 0; index < await choices.count(); index++) {
    await expect(choices.nth(index)).toBeEnabled()
    await choices.nth(index).check()
  }
}
