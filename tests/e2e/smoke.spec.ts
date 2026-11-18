import { expect, test } from '@playwright/test'
import { MOCK_REPLY, mockApi, seedApiKey, sendMessage } from '../support/mock-api'

test.describe('phase 0 smoke', () => {
  test('app loads to the welcome screen', async ({ page }) => {
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')

    await expect(page.getByText('How can I help you?')).toBeVisible()
    await expect(page.getByPlaceholder('Enter a message')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible()
  })

  test('settings open with the general and data tabs', async ({ page }) => {
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')

    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('tab', { name: 'General' })).toBeVisible()
    await expect(dialog.getByRole('tab', { name: 'Data' })).toBeVisible()
    await expect(dialog.getByRole('radio', { name: 'System' })).toBeVisible()
  })

  test('sends a message and renders the mocked stream', async ({ page }) => {
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')

    await sendMessage(page)

    await expect(page.getByText('Hello from Playwright')).toBeVisible()
    await expect(page.getByText(MOCK_REPLY)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
  })

  test('toggles the theme from settings', async ({ page }) => {
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')

    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })

    await dialog.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', 'dark')

    await dialog.getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('body')).toHaveClass(/(^|\s)light(\s|$)/)
    await expect(page.locator('body')).not.toHaveAttribute('data-ds-dark-theme')
  })

  test('exports the chat history and imports it again', async ({ page }, testInfo) => {
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')

    await sendMessage(page)
    await expect(page.getByText(MOCK_REPLY)).toBeVisible()

    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: 'Data' }).click()

    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download' }).click()
    const download = await downloadPromise
    const archive = testInfo.outputPath('history.zip')
    await download.saveAs(archive)

    await dialog.locator('input[type="file"]').setInputFiles(archive)
    const confirm = page.getByRole('dialog', { name: 'Import chat history?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Import', exact: true }).click()

    await expect(dialog.getByText('Imported 1 chat')).toBeVisible()
  })

  test('mobile layout opens the sidebar drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedApiKey(page)
    await mockApi(page)
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible()
    await page.getByRole('button', { name: 'Open sidebar' }).click()

    const settings = page.getByRole('button', { name: 'Settings' })
    await expect(settings).toBeVisible()
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible()

    await settings.click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  })
})
