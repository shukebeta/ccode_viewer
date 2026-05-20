const fs = require('fs')

const DEFAULT_MAX_BYTES = 8192

function parseSessionMetaCwd(buffer) {
  const text = buffer.toString('utf8')
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (!line) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch (e) {
      continue
    }
    if (parsed && parsed.type === 'session_meta' && typeof parsed.payload?.cwd === 'string') {
      const cwd = parsed.payload.cwd.trim()
      if (cwd) return cwd
    }
  }
  return null
}

function readCodexSessionMetaCwd(filePath, { maxBytes = DEFAULT_MAX_BYTES, fsModule = fs } = {}) {
  return new Promise((resolve) => {
    let collected = Buffer.alloc(0)
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      try { stream.destroy() } catch (e) {}
      resolve(value)
    }

    let stream
    try {
      stream = fsModule.createReadStream(filePath, { start: 0, end: Math.max(0, maxBytes - 1) })
    } catch (e) {
      resolve(null)
      return
    }

    stream.on('data', (chunk) => {
      collected = collected.length === 0 ? chunk : Buffer.concat([collected, chunk])
      // Only attempt to parse if at least one newline has been seen, or the file ended.
      if (collected.includes(0x0a)) {
        const cwd = parseSessionMetaCwd(collected)
        if (cwd) finish(cwd)
      }
    })
    stream.on('end', () => finish(parseSessionMetaCwd(collected)))
    stream.on('error', () => finish(null))
  })
}

module.exports = {
  readCodexSessionMetaCwd,
  _private: { parseSessionMetaCwd, DEFAULT_MAX_BYTES }
}
