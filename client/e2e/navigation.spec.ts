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

test('offers language selection during onboarding', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('#onboarding-language-select')).toBeFocused()
  await page.locator('#onboarding-language-select').selectOption('es')
  await expect(page.locator('.ob-headline')).toHaveText('Encuentra un salón. Llega allí.')
  await expect(page.locator('#nav-panel-title')).toHaveText('Fremd Maps')
  await expect(page.locator('#language-select')).toHaveValue('es')
})

test('keeps primary navigation controls phone-sized and reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page)

  await expect(page.locator('#floor-switcher .floor-btn').first()).toHaveCSS('min-height', '44px')
  await expect(page.locator('#nav-panel')).toHaveCSS('position', 'fixed')
  await expect(page.locator('#nav-panel .panel-handle')).toBeVisible()
})

test('finds an official room through its Spanish search alias', async ({ page }) => {
  await openApp(page)

  await page.locator('#end-input').fill('biblioteca')
  await expect(
    page.locator('#end-dropdown-wrapper [role="option"]').filter({ hasText: 'Library' })
  ).toBeVisible()
})

test('finds an official room when its punctuation is omitted', async ({ page }) => {
  await openApp(page)

  await page.locator('#end-input').fill('boys locker room')
  await expect(
    page.locator('#end-dropdown-wrapper [role="option"]').filter({ hasText: "Boy's Locker Room" })
  ).toBeVisible()
})

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

test('translates the floor switcher when the language changes', async ({ page }) => {
  await openApp(page)

  await page.locator('#language-select').selectOption('es')

  await expect(page.locator('.floor-btn[data-floor="2"]')).toHaveText('Piso 2')
  await expect(page.locator('.floor-btn[data-floor="1"]')).toHaveText('Piso 1')
})

test('translates the cross-floor route switch prompt', async ({ page }) => {
  await openApp(page)
  await chooseRoom(page, 'start-input', '129')
  await chooseRoom(page, 'end-input', '253')
  await page.locator('#find-route-btn').click()
  await expect(page.locator('#multi-floor-banner')).toBeVisible()

  await page.locator('#language-select').selectOption('es')

  await expect(page.locator('#banner-text')).toHaveText('La ruta continúa en otro piso')
  await expect(page.locator('#banner-switch-btn')).toHaveText('Cambiar al piso 2 →')
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
