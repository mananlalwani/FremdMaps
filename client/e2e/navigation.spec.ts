import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

async function chooseRoom(page: import('@playwright/test').Page, inputId: string, room: string) {
  const input = page.locator(`#${inputId}`)
  const wrapperId = inputId === 'start-input' ? 'start-dropdown-wrapper' : 'end-dropdown-wrapper'
  const option = page.locator(`#${wrapperId} [role="option"]`).first()
  await input.fill(room)
  await expect(option).toBeVisible()
  await option.click()
}

async function openApp(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  const onboarding = page.getByRole('button', { name: /get started/i })
  if (await onboarding.isVisible()) await onboarding.click()
  await expect(page.locator('#find-route-btn')).toBeEnabled({ timeout: 15_000 })
}

test('finds an exact single-digit-compatible room result and draws a same-floor route', async ({
  page,
}) => {
  await openApp(page)
  await chooseRoom(page, 'start-input', '129')
  await chooseRoom(page, 'end-input', '115')
  await page.locator('#find-route-btn').click()

  await expect(page.locator('#route-status')).toBeVisible()
  await expect(page.locator('#directions-list li').first()).toContainText('Start at 129')
})

test('draws a cross-floor route and exposes a floor transition', async ({ page }) => {
  await openApp(page)
  await chooseRoom(page, 'start-input', '129')
  await chooseRoom(page, 'end-input', '253')
  await page.locator('#find-route-btn').click()

  await expect(page.locator('#multi-floor-banner')).toBeVisible()
  await page.getByRole('button', { name: /switch to floor 2/i }).click()
  await expect(page.locator('.floor-btn.active')).toHaveAttribute('data-floor', '2')
})

test('clears a displayed route', async ({ page }) => {
  await openApp(page)
  await chooseRoom(page, 'start-input', '129')
  await chooseRoom(page, 'end-input', '115')
  await page.locator('#find-route-btn').click()
  await expect(page.locator('#route-status')).toBeVisible()

  await page.locator('#clear-route-btn').click()
  await expect(page.locator('#route-status')).toBeHidden()
})

test('reloads the precached application shell while offline', async ({ page, context }) => {
  test.setTimeout(75_000)
  await openApp(page)
  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await context.setOffline(true)
  await page.reload()

  await expect(page.locator('#start-input')).toBeVisible()
  await expect(page.locator('#map')).toBeVisible()
})

test('has no automatically detectable accessibility violations', async ({ page }) => {
  await openApp(page)

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})
