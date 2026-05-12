import { afterEach, describe, expect, it, vi } from 'vitest'

const fsHelpers = require('../fsHelpers')
const { startServer } = require('../server')

describe('server routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 500 json when /api/sessions fails internally', async () => {
    const spy = vi.spyOn(fsHelpers, 'getSessions').mockRejectedValue(new Error('session load failed'))
    const { server, port } = await startServer({ port: 0 })

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/sessions?project=test-project`)
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body).toEqual({ error: 'session load failed' })
      expect(spy).toHaveBeenCalledWith('test-project')
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    }
  })
})
