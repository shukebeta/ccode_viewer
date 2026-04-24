const express = require('express')
const path = require('path')
const cors = require('cors')
const fsHelpers = require('./fsHelpers')
const fileWatcher = require('./fileWatcher')

const DEFAULT_PORT = 6173

function createApp(options = {}) {
  const publicDir = options.publicDir || path.join(__dirname, 'public')
  const app = express()

  app.use(cors())
  app.use(express.json())
  app.use(express.static(publicDir))

  app.get('/api/projects', async (req, res) => {
    const projects = await fsHelpers.getProjects()
    res.json(projects)
  })

  app.get('/api/sessions', async (req, res) => {
    const project = req.query.project
    if (!project) return res.status(400).json({ error: 'project query required' })
    const sessions = await fsHelpers.getSessions(project)
    res.json(sessions)
  })

  app.get('/api/session', async (req, res) => {
    const file = req.query.file
    if (!file) return res.status(400).json({ error: 'file query required' })
    const messages = await fsHelpers.readSessionFile(file)
    res.json(messages)
  })

  app.get('/api/session-mapping', async (req, res) => {
    const file = req.query.file
    if (!file) return res.status(400).json({ error: 'file query required' })
    const mapping = await fsHelpers.mapSessionMessages(file)
    res.json(mapping)
  })

  app.delete('/api/session', async (req, res) => {
    const file = req.query.file
    if (!file) return res.status(400).json({ error: 'file query required' })
    try {
      await fsHelpers.deleteSession(file)
      res.json({ success: true })
    } catch (err) {
      console.error('Delete session error:', err)
      res.status(500).json({ error: err.message || 'Failed to delete session' })
    }
  })

  // Cross-session search endpoint
  app.get('/api/projects/:projectId/search', async (req, res) => {
    const { projectId } = req.params
    const { q } = req.query
    if (!q || q.length < 3) {
      return res.status(400).json({ error: 'Query must be at least 3 characters' })
    }
    try {
      const results = await fsHelpers.searchInProject(projectId, q)
      res.json(results)
    } catch (err) {
      console.error('Search error:', err)
      res.status(500).json({ error: 'Search failed' })
    }
  })

  // Server-Sent Events endpoint for session file updates
  app.get('/api/events', async (req, res) => {
    const file = req.query.file
    if (!file) return res.status(400).json({ error: 'file query required' })

    // basic headers for SSE
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders && res.flushHeaders()

    // Send a comment to keep connection alive for some proxies
    res.write(': connected\n\n')

    fileWatcher.subscribe(file, res)

    // On client close, fileWatcher will remove the subscriber via res.on('close')
  })

  return app
}

function startServer(options = {}) {
  const port = Number.isInteger(options.port) ? options.port : DEFAULT_PORT
  const host = options.host || '127.0.0.1'
  const app = createApp(options)

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address()
      resolve({
        app,
        server,
        host,
        port: address && typeof address === 'object' ? address.port : port
      })
    })

    server.on('error', reject)
  })
}

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || '', 10)
  const host = process.env.HOST || '127.0.0.1'

  startServer({ port: Number.isNaN(port) ? DEFAULT_PORT : port, host }).then(({ port: actualPort }) => {
    console.log(`Claude webapp listening on http://${host}:${actualPort}`)
  }).catch((err) => {
    console.error('Failed to start Claude webapp:', err)
    process.exit(1)
  })
}

module.exports.createApp = createApp
module.exports.startServer = startServer
