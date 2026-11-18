import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve('dist')
const port = Number(process.env.PORT ?? 4173)
const host = '127.0.0.1'

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const notFound = (response) => {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end('Not found')
}

/** Minimal static file server for the production build; no directory listing. */
createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`)
    const pathname = decodeURIComponent(url.pathname)
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname
    const file = resolve(join(root, relative))
    if (!file.startsWith(`${root}/`)) {
      notFound(response)
      return
    }
    const info = await stat(file)
    if (!info.isFile()) {
      notFound(response)
      return
    }
    const body = await readFile(file)
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    response.end(body)
  } catch {
    notFound(response)
  }
}).listen(port, host)
