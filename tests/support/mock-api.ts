import type { Page } from '@playwright/test'

export const API_ORIGIN = 'https://api.deepseek.com'
export const MOCK_REPLY = 'Hello from the mocked stream.'

const USAGE = {
  input_tokens: 12,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 8,
}

const streamEvents = [
  {
    type: 'message_start',
    message: {
      id: 'msg_phase0',
      type: 'message',
      role: 'assistant',
      model: 'deepseek-flash',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: USAGE,
    },
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '', citations: [] },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: MOCK_REPLY },
  },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: USAGE,
  },
  { type: 'message_stop' },
]

const sseBody = streamEvents
  .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join('')

/** Seed localStorage before the app boots (settings store reads it at module init). */
export const seedStorage = async (page: Page, entries: Record<string, string>) => {
  await page.addInitScript((values) => {
    for (const [key, value] of Object.entries(values)) {
      window.localStorage.setItem(key, value)
    }
  }, entries)
}

export const seedApiKey = async (page: Page) => {
  await seedStorage(page, { 'chat-demo:api-key': 'sk-phase0-local-test' })
}

/**
 * Mock every network call the app makes. No test may reach the real API:
 * unhandled requests fail loudly instead of silently using the network.
 */
export const mockApi = async (page: Page) => {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === '/models') {
      await route.fulfill({ status: 200, json: { object: 'list', data: [] } })
      return
    }
    if (request.method() === 'POST' && path === '/anthropic/v1/messages') {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: sseBody,
      })
      return
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: `Unmocked request: ${request.method()} ${path}` } }),
    })
  })
}

/** Type and send one message, then wait until the mocked stream is fully rendered. */
export const sendMessage = async (page: Page, text = 'Hello from Playwright') => {
  await page.getByPlaceholder('Enter a message').fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}
