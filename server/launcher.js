const fs = require('fs')
const net = require('net')
const path = require('path')
const { exec } = require('child_process')
const { startServer } = require('./server')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 6173
const PORT_SCAN_LIMIT = 20
const LOCAL_PUBLIC_DIR = path.join(__dirname, 'public')
const FALLBACK_PACKAGED_PUBLIC_DIR = path.join(__dirname, '..', 'dist', 'package-src', 'server', 'public')

function resolvePublicDir() {
  if (process.env.CCODE_VIEWER_PUBLIC_DIR) return process.env.CCODE_VIEWER_PUBLIC_DIR
  if (fs.existsSync(path.join(LOCAL_PUBLIC_DIR, 'index.html'))) return LOCAL_PUBLIC_DIR
  return FALLBACK_PACKAGED_PUBLIC_DIR
}

function canListenOnPort(port, host = DEFAULT_HOST) {
  return new Promise((resolve) => {
    const tester = net.createServer()

    tester.once('error', () => {
      resolve(false)
    })

    tester.once('listening', () => {
      tester.close(() => resolve(true))
    })

    tester.listen(port, host)
  })
}

async function findAvailablePort(startPort = DEFAULT_PORT) {
  for (let port = startPort; port < startPort + PORT_SCAN_LIMIT; port++) {
    if (await canListenOnPort(port)) return port
  }

  return 0
}

function openBrowser(url) {
  if (process.env.CCODE_VIEWER_NO_OPEN === '1') return

  let command = ''
  if (process.platform === 'win32') {
    command = `start "" "${url}"`
  } else if (process.platform === 'darwin') {
    command = `open "${url}"`
  } else {
    command = `xdg-open "${url}"`
  }

  exec(command, (err) => {
    if (err) {
      console.error(`Failed to open browser automatically. Open ${url} manually.`)
    }
  })
}

async function main() {
  const publicDir = resolvePublicDir()
  const indexPath = path.join(publicDir, 'index.html')
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Built viewer assets were not found at ${publicDir}. Run the packaging build first.`)
  }

  const requestedPort = Number.parseInt(process.env.PORT || '', 10)
  const preferredPort = Number.isNaN(requestedPort) ? DEFAULT_PORT : requestedPort
  const port = await findAvailablePort(preferredPort)
  const { server, port: actualPort } = await startServer({ host: DEFAULT_HOST, port, publicDir })
  const url = `http://${DEFAULT_HOST}:${actualPort}`

  if (process.env.CCODE_VIEWER_URL_FILE) {
    fs.writeFileSync(process.env.CCODE_VIEWER_URL_FILE, url, 'utf8')
  }

  console.log(`Claude Code Viewer is running at ${url}`)
  openBrowser(url)

  const shutdown = () => {
    server.close(() => process.exit(0))
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to launch packaged app:', err)
    process.exit(1)
  })
}

module.exports = { findAvailablePort, resolvePublicDir }
