import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { startServer } = require('../server')
const { _private: listWatcherPrivate } = require('../listWatcher')
const { clearAgentHomeDiscoveryCache } = require('../discovery/agentHomeDiscovery')
const { clearCopilotDiscoveryCache } = require('../discovery/copilotWorkspaceDiscovery')

const ORIGINAL_HOME = process.env.HOME

let tempHome

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'events-list-'))
  process.env.HOME = tempHome
  fs.mkdirSync(path.join(tempHome, '.claude', 'projects'), { recursive: true })
  clearAgentHomeDiscoveryCache()
  clearCopilotDiscoveryCache()
})

afterEach(() => {
  listWatcherPrivate.clearForTest()
  clearAgentHomeDiscoveryCache()
  clearCopilotDiscoveryCache()
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true })
  if (ORIGINAL_HOME === undefined) delete process.env.HOME
  else process.env.HOME = ORIGINAL_HOME
})

async function readInitialChunk(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const { value, done } = await reader.read()
  reader.cancel().catch(() => {})
  if (done) return ''
  return decoder.decode(value)
}

describe('GET /api/events/list', () => {
  it('returns SSE headers and an initial keepalive comment', async () => {
    const { server, port } = await startServer({ port: 0 })

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/events/list`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/)
      expect(res.headers.get('cache-control')).toBe('no-cache')

      const chunk = await readInitialChunk(res)
      expect(chunk.startsWith(': connected')).toBe(true)
    } finally {
      await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
    }
  })

  it('does not shadow the existing per-file /api/events endpoint', async () => {
    const { server, port } = await startServer({ port: 0 })

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/events`)
      // /api/events requires ?file=...; the route still exists and returns its own 400 JSON.
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/file query required/i)
    } finally {
      await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
    }
  })
})
