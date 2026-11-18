import { expect, test } from '@playwright/test'
import {
  MOCK_REPLY,
  mockApi,
  seedApiKey,
  seedStorage,
  sendMessage,
} from '../support/mock-api'

/** Wait for webfonts and the settled app shell before taking a baseline. */
const settle = async (page: Parameters<typeof seedApiKey>[0]) => {
  await page.evaluate(() => document.fonts.ready)
}

test.describe('phase 0 visual baseline', () => {
  test('desktop welcome (light)', async ({ page }) => {
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')
    await expect(page.getByText('How can I help you?')).toBeVisible()
    await settle(page)

    await expect(page).toHaveScreenshot('desktop-welcome-light.png', { animations: 'disabled' })
  })

  test('desktop welcome (dark)', async ({ page }) => {
    await seedStorage(page, {
      'chat-demo:api-key': 'sk-phase0-local-test',
      'chat-demo:theme-preference': 'dark',
    })
    await mockApi(page)
    await page.goto('/')
    await expect(page.getByText('How can I help you?')).toBeVisible()
    await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', 'dark')
    await settle(page)

    await expect(page).toHaveScreenshot('desktop-welcome-dark.png', { animations: 'disabled' })
  })

  test('settings dialog (general)', async ({ page }) => {
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')

    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await settle(page)

    await expect(page).toHaveScreenshot('settings-general.png', { animations: 'disabled' })
  })

  test('chat with a streamed reply', async ({ page }) => {
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')

    await sendMessage(page)
    await expect(page.getByText(MOCK_REPLY)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible()
    await settle(page)

    await expect(page).toHaveScreenshot('chat-streamed-reply.png', { animations: 'disabled' })
  })

  test('mobile welcome', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')
    await expect(page.getByText('How can I help you?')).toBeVisible()
    await settle(page)

    await expect(page).toHaveScreenshot('mobile-welcome.png', { animations: 'disabled' })
  })
})
